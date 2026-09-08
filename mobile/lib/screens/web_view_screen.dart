import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../state/app_state.dart';

class WebViewScreen extends StatefulWidget {
  const WebViewScreen({super.key});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> {
  WebViewController? _ctrl;
  bool _loading = true;

  // webview_flutter 공식 지원: Android / iOS / macOS
  static bool get _supported {
    if (kIsWeb) return false;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS;
  }

  /// 접속 URL — 토큰이 있으면 ?token= 으로 붙여 웹 대시보드가 자동 로그인된다.
  static String _authedUrl(AppState st) {
    final url = st.baseUrl ?? '';
    final tok = (st.token ?? '').trim();
    if (url.isEmpty || tok.isEmpty) return url;
    return '$url/?token=${Uri.encodeQueryComponent(tok)}';
  }

  @override
  void initState() {
    super.initState();
    if (_supported) {
      final url = _authedUrl(context.read<AppState>());
      _ctrl = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(NavigationDelegate(
          onPageStarted: (_) => setState(() => _loading = true),
          onPageFinished: (_) => setState(() => _loading = false),
          onWebResourceError: (_) => setState(() => _loading = false),
        ))
        ..loadRequest(Uri.parse(url));
    } else {
      // 미지원 플랫폼(Windows 등): 브라우저 자동 열기
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (!mounted) return;
        final url = _authedUrl(context.read<AppState>());
        if (url.isNotEmpty) {
          await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
        }
      });
    }
  }

  void _switchToApp() =>
      context.read<AppState>().setViewMode(ViewMode.nativeApp);

  void _disconnect() => context.read<AppState>().disconnect();

  @override
  Widget build(BuildContext context) {
    final url = context.select<AppState, String?>((s) => s.baseUrl) ?? '';

    return Scaffold(
      appBar: AppBar(
        title: const Text('EasyProject4'),
        actions: [
          if (_supported)
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: '새로고침',
              onPressed: () => _ctrl?.reload(),
            ),
          IconButton(
            icon: const Icon(Icons.phone_android),
            tooltip: '모바일 앱으로 전환',
            onPressed: _switchToApp,
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: '연결 해제',
            onPressed: _disconnect,
          ),
        ],
      ),
      body: _supported
          ? Stack(children: [
              WebViewWidget(controller: _ctrl!),
              if (_loading)
                const Center(child: CircularProgressIndicator()),
            ])
          : _BrowserFallback(
              url: url, openUrl: _authedUrl(context.read<AppState>())),
    );
  }
}

// ── 지원 안 되는 플랫폼(Windows 등) 폴백 ──────────────────────────────────────

class _BrowserFallback extends StatelessWidget {
  final String url;      // 표시용 (토큰 미포함)
  final String openUrl;  // 브라우저로 여는 주소 (자동 로그인 토큰 포함)
  const _BrowserFallback({required this.url, required this.openUrl});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle_outline,
                size: 64, color: Color(0xFF4ADE80)),
            const SizedBox(height: 20),
            const Text(
              'EP4 연결 성공!',
              style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF4ADE80)),
            ),
            const SizedBox(height: 8),
            const Text(
              '이 플랫폼에서는 인앱 웹뷰를 지원하지 않아\n브라우저를 자동으로 열었습니다.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF94A3B8), height: 1.6),
            ),
            const SizedBox(height: 12),
            SelectableText(
              url,
              style: const TextStyle(
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: Color(0xFF4ADE80)),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => launchUrl(Uri.parse(openUrl),
                  mode: LaunchMode.externalApplication),
              icon: const Icon(Icons.open_in_browser),
              label: const Text('브라우저 다시 열기'),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () =>
                  context.read<AppState>().setViewMode(ViewMode.nativeApp),
              icon: const Icon(Icons.phone_android),
              label: const Text('앱 모드로 돌아가기'),
            ),
          ],
        ),
      ),
    );
  }
}
