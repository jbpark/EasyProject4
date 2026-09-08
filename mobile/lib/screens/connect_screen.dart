import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart'
    show kIsWeb, defaultTargetPlatform, TargetPlatform;
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../state/app_state.dart';

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key});

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;

  // 직접 입력 탭
  final _urlCtrl = TextEditingController();
  // 인증 토큰 (두 탭 공통)
  final _tokenCtrl = TextEditingController();

  // EP4 ID 탭
  final _idCtrl = TextEditingController();
  String? _fetchedUrl;
  String? _fetchedName;
  String? _fetchedLastSeen;

  bool _busy = false;
  String? _error;

  static const _kDefaultUrl =
      String.fromEnvironment('EP4_DEFAULT_URL', defaultValue: '');
  static const _kDbBase = AppState.kDbBase;
  static const _kPrefEp4Id = AppState.kPrefEp4Id;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _loadSaved();
  }

  Future<void> _loadSaved() async {
    final saved = context.read<AppState>().baseUrl;
    if (saved != null) {
      _urlCtrl.text = saved;
    } else if (_kDefaultUrl.isNotEmpty) {
      _urlCtrl.text = _kDefaultUrl;
    }
    final savedToken = context.read<AppState>().token;
    if (savedToken != null) _tokenCtrl.text = savedToken;

    final prefs = await SharedPreferences.getInstance();
    final savedId = prefs.getString(_kPrefEp4Id) ?? '';
    if (savedId.isNotEmpty && mounted) {
      setState(() => _idCtrl.text = savedId);
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _urlCtrl.dispose();
    _tokenCtrl.dispose();
    _idCtrl.dispose();
    super.dispose();
  }

  // ── 직접 입력 연결 ──────────────────────────────────────────────────────────

  Future<void> _connectDirect() async {
    final url = _urlCtrl.text.trim();
    if (url.isEmpty) {
      setState(() => _error = '서버 주소를 입력하세요.');
      return;
    }
    await _doConnect(url);
  }

  // ── EP4 ID → Firebase → 연결 ────────────────────────────────────────────────

  Future<void> _fetchAndConnect() async {
    final id = _idCtrl.text.trim();
    if (id.isEmpty) {
      setState(() => _error = 'EP4 ID를 입력하세요.');
      return;
    }
    if (_kDbBase.isEmpty) {
      setState(() => _error =
          'EP4 ID 연결이 설정되지 않았습니다. PC 의 conf/ep4.local.conf 에 firebase_db_url 을 넣고 앱을 다시 빌드하세요. '
          '설정 없이 연결하려면 "직접 입력" 탭에서 서버 주소를 넣으세요.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _fetchedUrl = null;
      _fetchedName = null;
      _fetchedLastSeen = null;
    });
    try {
      final uri = Uri.parse('$_kDbBase/ep4_tunnels/$id.json');
      final res = await http.get(uri).timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) throw Exception('Firebase 응답 오류 (${res.statusCode})');

      final j = jsonDecode(res.body);
      if (j == null) throw Exception('EP4 ID를 찾을 수 없습니다. ID를 확인하세요.');
      final data = j as Map<String, dynamic>;

      final url = (data['url'] ?? '') as String;
      if (url.isEmpty) throw Exception('URL이 없습니다. 터널이 실행 중인지 확인하세요.');

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kPrefEp4Id, id);

      if (!mounted) return;
      setState(() {
        _fetchedUrl = url;
        _fetchedName = (data['name'] ?? data['pc'] ?? '') as String;
        _fetchedLastSeen = (data['last_seen'] ?? '') as String;
        _busy = false;
      });

      await _doConnect(url);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = '$e';
      });
    }
  }

  Future<void> _doConnect(String url) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final token = _tokenCtrl.text.trim();
    final ok = await context.read<AppState>().connect(url, token: token.isEmpty ? null : token);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!ok) {
      setState(() => _error = '연결 실패. 주소·토큰·터널 상태를 확인하세요.');
    }
  }

  // ── QR 스캔 → 연결 ──────────────────────────────────────────────────────────

  // QR 스캔은 카메라가 있는 모바일(Android/iOS)에서만 지원
  bool get _scanSupported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  Future<void> _openScanner() async {
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _QrScanScreen()),
    );
    if (code == null || code.isEmpty || !mounted) return;
    await _handleScan(code);
  }

  /// QR 페이로드 해석: 접속 URL(?token= 포함) / JSON({url,id,token}) / EP4 ID 모두 처리.
  Future<void> _handleScan(String raw) async {
    raw = raw.trim();
    String url = '';
    String id = '';
    if (raw.startsWith('{')) {
      try {
        final j = jsonDecode(raw) as Map<String, dynamic>;
        url = (j['url'] ?? '') as String;
        id = (j['id'] ?? '') as String;
        final tok = (j['token'] ?? '') as String;
        if (tok.isNotEmpty) _tokenCtrl.text = tok;
      } catch (_) {}
    } else if (raw.startsWith('http://') || raw.startsWith('https://')) {
      // 접속 URL 형식 — ?token= 이 있으면 추출해 자동 인증
      try {
        final u = Uri.parse(raw);
        final tok = (u.queryParameters['token'] ?? '').trim();
        if (tok.isNotEmpty) _tokenCtrl.text = tok;
        url = u.hasPort
            ? '${u.scheme}://${u.host}:${u.port}'
            : '${u.scheme}://${u.host}';
      } catch (_) {
        url = raw;
      }
    } else {
      id = raw;
    }
    if (url.isNotEmpty) {
      setState(() {
        _urlCtrl.text = url;
        _tabs.index = 0;
      });
      await _doConnect(url);
    } else if (id.isNotEmpty) {
      setState(() {
        _idCtrl.text = id;
        _tabs.index = 1;
      });
      await _fetchAndConnect();
    } else if (mounted) {
      setState(() => _error = 'QR에서 연결 정보를 찾지 못했습니다.');
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('🗂', style: TextStyle(fontSize: 56)),
              const SizedBox(height: 12),
              const Text('EasyProject4',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
              const SizedBox(height: 20),

              // 탭 헤더
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF161B22),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: TabBar(
                  controller: _tabs,
                  indicatorSize: TabBarIndicatorSize.tab,
                  dividerHeight: 0,
                  indicator: BoxDecoration(
                    color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  tabs: const [
                    Tab(text: '🔗 직접 입력'),
                    Tab(text: '🔥 EP4 ID'),
                  ],
                  onTap: (_) => setState(() => _error = null),
                ),
              ),
              const SizedBox(height: 20),

              // 탭 내용
              SizedBox(
                height: 220,
                child: TabBarView(
                  controller: _tabs,
                  children: [
                    _DirectTab(
                      ctrl: _urlCtrl,
                      defaultUrl: _kDefaultUrl,
                      onSubmit: _connectDirect,
                    ),
                    _Ep4IdTab(
                      ctrl: _idCtrl,
                      fetchedUrl: _fetchedUrl,
                      fetchedName: _fetchedName,
                      fetchedLastSeen: _fetchedLastSeen,
                    ),
                  ],
                ),
              ),

              // 인증 토큰 (두 탭 공통 · 인증을 사용하는 서버만 필요)
              const SizedBox(height: 12),
              TextField(
                controller: _tokenCtrl,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: '인증 토큰',
                  hintText: '서버 콘솔에 표시된 토큰 (인증 사용 시)',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),

              // QR 스캔 연결 (모바일 전용)
              if (_scanSupported) ...[
                const SizedBox(height: 6),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _openScanner,
                  icon: const Icon(Icons.qr_code_scanner),
                  label: const Text('QR 스캔으로 연결'),
                  style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12)),
                ),
              ],

              // 접속 모드 선택
              const SizedBox(height: 16),
              _ViewModeSelector(),

              // 오류 메시지
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!,
                    style: const TextStyle(color: Colors.redAccent),
                    textAlign: TextAlign.center),
              ],
              const SizedBox(height: 16),

              // 연결 버튼
              FilledButton.icon(
                onPressed: _busy
                    ? null
                    : () {
                        if (_tabs.index == 0) {
                          _connectDirect();
                        } else {
                          _fetchAndConnect();
                        }
                      },
                icon: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.power_settings_new),
                label: Text(_busy
                    ? '연결 중…'
                    : (_tabs.index == 1 ? 'URL 가져와서 연결' : '연결')),
                style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── 직접 입력 탭 ──────────────────────────────────────────────────────────────

class _DirectTab extends StatelessWidget {
  final TextEditingController ctrl;
  final String defaultUrl;
  final VoidCallback onSubmit;

  const _DirectTab({
    required this.ctrl,
    required this.defaultUrl,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          defaultUrl.isNotEmpty
              ? '로컬 EP4 서버 또는 Cloudflare Tunnel 주소'
              : 'Cloudflare Tunnel 주소로 연결',
          style: TextStyle(color: Colors.grey.shade500, fontSize: 12.5),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: ctrl,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: InputDecoration(
            labelText: '서버 주소',
            hintText: defaultUrl.isNotEmpty
                ? defaultUrl
                : 'https://xxxx.trycloudflare.com',
            prefixIcon: const Icon(Icons.link),
          ),
          onSubmitted: (_) => onSubmit(),
        ),
      ],
    );
  }
}

// ── EP4 ID 탭 ─────────────────────────────────────────────────────────────────

class _Ep4IdTab extends StatelessWidget {
  final TextEditingController ctrl;
  final String? fetchedUrl;
  final String? fetchedName;
  final String? fetchedLastSeen;

  const _Ep4IdTab({
    required this.ctrl,
    this.fetchedUrl,
    this.fetchedName,
    this.fetchedLastSeen,
  });

  String _fmtLastSeen(String iso) {
    try {
      final t = DateTime.parse(iso).toLocal();
      final now = DateTime.now();
      final diff = now.difference(t);
      if (diff.inSeconds < 60) return '방금 전';
      if (diff.inMinutes < 60) return '${diff.inMinutes}분 전';
      if (diff.inHours < 24) return '${diff.inHours}시간 전';
      return '${diff.inDays}일 전';
    } catch (_) {
      return iso;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'EP4 PC에서 tunnel.bat 실행 시 표시되는 ID를 입력하세요.',
          style: TextStyle(color: Colors.grey.shade500, fontSize: 12.5),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: ctrl,
          autocorrect: false,
          decoration: InputDecoration(
            labelText: 'EP4 ID',
            hintText: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            prefixIcon: const Icon(Icons.fingerprint),
            suffixIcon: IconButton(
              icon: const Icon(Icons.paste, size: 18),
              tooltip: '붙여넣기',
              onPressed: () async {
                final data = await Clipboard.getData('text/plain');
                if (data?.text != null) ctrl.text = data!.text!.trim();
              },
            ),
          ),
        ),
        // 가져온 URL 미리보기
        if (fetchedUrl != null) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFF0D1117),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFF4ADE80).withValues(alpha: 0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (fetchedName != null && fetchedName!.isNotEmpty)
                  Text('💻 $fetchedName',
                      style: const TextStyle(
                          fontSize: 12, fontWeight: FontWeight.w600)),
                Text(fetchedUrl!,
                    style: const TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: Color(0xFF4ADE80))),
                if (fetchedLastSeen != null && fetchedLastSeen!.isNotEmpty)
                  Text('최근 업데이트: ${_fmtLastSeen(fetchedLastSeen!)}',
                      style: TextStyle(
                          fontSize: 10, color: Colors.grey.shade500)),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

// ── QR 스캔 화면 ──────────────────────────────────────────────────────────────

class _QrScanScreen extends StatefulWidget {
  const _QrScanScreen();

  @override
  State<_QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<_QrScanScreen> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('EP4 QR 스캔')),
      body: Stack(
        children: [
          MobileScanner(
            onDetect: (capture) {
              if (_done) return;
              final codes = capture.barcodes;
              if (codes.isEmpty) return;
              final v = codes.first.rawValue;
              if (v == null || v.isEmpty) return;
              _done = true;
              Navigator.of(context).pop(v);
            },
          ),
          // 스캔 가이드 프레임 + 안내
          IgnorePointer(
            child: Center(
              child: Container(
                width: 230,
                height: 230,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.white70, width: 3),
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ),
          const Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.only(bottom: 40),
              child: Text(
                'EP4 대시보드의 📱 QR 코드를 비추세요',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    backgroundColor: Colors.black54),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── 접속 모드 선택 위젯 ───────────────────────────────────────────────────────

class _ViewModeSelector extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final mode = context.select<AppState, ViewMode>((s) => s.viewMode);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '접속 후 보기 모드',
          style: TextStyle(
              fontSize: 12, color: Colors.grey.shade500, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: _ModeButton(
              selected: mode == ViewMode.nativeApp,
              icon: Icons.phone_android,
              label: '모바일 앱',
              desc: '네이티브 앱 UI',
              onTap: () => context.read<AppState>().setViewMode(ViewMode.nativeApp),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _ModeButton(
              selected: mode == ViewMode.webView,
              icon: Icons.language,
              label: '반응형 웹',
              desc: '웹 대시보드',
              onTap: () => context.read<AppState>().setViewMode(ViewMode.webView),
            ),
          ),
        ]),
      ],
    );
  }
}

class _ModeButton extends StatelessWidget {
  final bool selected;
  final IconData icon;
  final String label;
  final String desc;
  final VoidCallback onTap;

  const _ModeButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.desc,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
        decoration: BoxDecoration(
          color: selected
              ? accent.withValues(alpha: 0.15)
              : const Color(0xFF161B22),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? accent : const Color(0xFF2A323C),
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(icon,
                size: 20,
                color: selected ? accent : Colors.grey.shade500),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: selected ? accent : Colors.grey.shade300)),
                  Text(desc,
                      style: TextStyle(
                          fontSize: 11, color: Colors.grey.shade600)),
                ],
              ),
            ),
            if (selected)
              Icon(Icons.check_circle, size: 16, color: accent),
          ],
        ),
      ),
    );
  }
}
