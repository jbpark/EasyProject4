import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';

/// 접속 정보 바텀시트: [현재 접속] / [접속 히스토리] 탭.
/// 현재 접속 — 내 접속 IP·수신 연결·발신 peer 연결 (서버 시작 이후 기준).
/// 접속 히스토리 — 연결 종료·서버 재시작 후에도 보존되는 기록.
void showConnectionsSheet(BuildContext context) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _ConnectionsSheet(),
  );
}

const _kindColor = {
  '내부 호스트': Color(0xFF4ADE80),
  '외부 호스트': Color(0xFFFACC15),
  '외부 EP4': Color(0xFF38BDF8),
  '내부 EP4': Color(0xFFA78BFA),
};

class _ConnectionsSheet extends StatefulWidget {
  const _ConnectionsSheet();

  @override
  State<_ConnectionsSheet> createState() => _ConnectionsSheetState();
}

class _ConnectionsSheetState extends State<_ConnectionsSheet> {
  Map<String, dynamic>? _data;
  List<dynamic> _history = [];
  String? _error;
  int _tab = 0; // 0: 현재 접속, 1: 접속 히스토리

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _data = null;
      _history = [];
      _error = null;
    });
    try {
      final api = context.read<AppState>().api;
      final results = await Future.wait([
        api.connections(),
        api.connectionsHistory(limit: 100),
      ]);
      if (!mounted) return;
      setState(() {
        _data = results[0] as Map<String, dynamic>;
        _history = results[1] as List<dynamic>;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    }
  }

  Widget _chip(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          border: Border.all(color: color.withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(text, style: TextStyle(fontSize: 10.5, color: color)),
      );

  Widget _sectionTitle(String t) => Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 6),
        child: Text(t,
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Colors.grey.shade400)),
      );

  Widget _row(List<Widget> children) => Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: const Color(0xFF0D1117),
          border: Border.all(color: const Color(0xFF2A323C)),
          borderRadius: BorderRadius.circular(9),
        ),
        child: Row(children: children),
      );

  Widget _emptyRow(String msg) => _row([
        Text(msg,
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
      ]);

  String _time(String? s) =>
      (s == null || s.length < 16) ? (s ?? '') : s.substring(5);

  // ── 현재 접속 탭 ──────────────────────────────────────────────────────────
  List<Widget> _nowChildren(Map<String, dynamic> d) => [
        _sectionTitle('🖥 내 접속'),
        _row([
          _chip((d['me']?['client'] ?? '?') as String, const Color(0xFF4ADE80)),
          const SizedBox(width: 8),
          Expanded(
            child: Text((d['me']?['ip'] ?? '') as String,
                style:
                    const TextStyle(fontFamily: 'monospace', fontSize: 12.5)),
          ),
          Text('서버: ${d['host'] ?? ''}',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
        ]),
        _sectionTitle('📥 수신 연결 ${(d['inbound'] as List?)?.length ?? 0}'),
        ...((d['inbound'] as List?) ?? []).map((c) {
          final kind = (c['kind'] ?? '') as String;
          final color = _kindColor[kind] ?? Colors.grey;
          final idparts = <String>[
            if ((c['hostname'] ?? '') != '') c['hostname'] as String,
            if ((c['local_ip'] ?? '') != '' && c['local_ip'] != c['ip'])
              c['local_ip'] as String,
          ];
          return _row([
            _chip(kind, color),
            const SizedBox(width: 6),
            _chip((c['client'] ?? '?') as String, Colors.grey),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${c['ip']}',
                      style: const TextStyle(
                          fontFamily: 'monospace', fontSize: 12)),
                  if (idparts.isNotEmpty)
                    Text(idparts.join(' · '),
                        style: TextStyle(
                            fontSize: 10.5, color: Colors.grey.shade500)),
                ],
              ),
            ),
            Text('${c['count']}회\n${_time(c['last'] as String?)}',
                textAlign: TextAlign.right,
                style: TextStyle(fontSize: 10, color: Colors.grey.shade600)),
          ]);
        }),
        if (((d['inbound'] as List?) ?? []).isEmpty) _emptyRow('수신 연결 없음'),
        _sectionTitle(
            '📤 발신 연결 (다른 EP4) ${(d['outbound'] as List?)?.length ?? 0}'),
        ...((d['outbound'] as List?) ?? []).map((c) => _row([
              Text((c['ok'] ?? false) as bool ? '✅' : '❌',
                  style: const TextStyle(fontSize: 13)),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${c['url']}',
                        style: const TextStyle(
                            fontFamily: 'monospace', fontSize: 11.5),
                        overflow: TextOverflow.ellipsis),
                    if ((c['host'] ?? '') != '')
                      Text('${c['host']}',
                          style: const TextStyle(
                              fontSize: 10.5, color: Color(0xFF38BDF8))),
                    if ((c['ok'] ?? false) != true && (c['error'] ?? '') != '')
                      Text('${c['error']}',
                          style: const TextStyle(
                              fontSize: 10.5, color: Color(0xFFF87171)),
                          overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              Text('${c['count']}회\n${_time(c['last'] as String?)}',
                  textAlign: TextAlign.right,
                  style: TextStyle(fontSize: 10, color: Colors.grey.shade600)),
            ])),
        if (((d['outbound'] as List?) ?? []).isEmpty) _emptyRow('발신 연결 없음'),
      ];

  // ── 접속 히스토리 탭 ──────────────────────────────────────────────────────
  List<Widget> _historyChildren() => [
        _sectionTitle(
            '🕓 접속 히스토리 ${_history.length}${_history.length >= 100 ? '+' : ''} (연결 종료·서버 재시작 후에도 보존)'),
        ..._history.map((c) {
          final isOut = (c['direction'] ?? '') == 'out';
          final kind = (c['kind'] ?? '') as String;
          final ok = (c['ok'] ?? true) as bool;
          final color = isOut
              ? (ok ? const Color(0xFF38BDF8) : const Color(0xFFF87171))
              : (_kindColor[kind] ?? Colors.grey);
          final main = isOut ? '${c['url']}' : '${c['ip']}';
          final subparts = <String>[
            if (isOut && (c['host'] ?? '') != '') c['host'] as String,
            if (isOut && !ok && (c['error'] ?? '') != '') c['error'] as String,
            if (!isOut && (c['hostname'] ?? '') != '') c['hostname'] as String,
            if (!isOut &&
                (c['local_ip'] ?? '') != '' &&
                c['local_ip'] != c['ip'])
              c['local_ip'] as String,
          ];
          return _row([
            Text(isOut ? '📤' : '📥', style: const TextStyle(fontSize: 12)),
            const SizedBox(width: 6),
            _chip(isOut ? (ok ? '발신' : '발신 실패') : kind, color),
            if (!isOut) ...[
              const SizedBox(width: 5),
              _chip((c['client'] ?? '?') as String, Colors.grey),
            ],
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(main,
                      style: const TextStyle(
                          fontFamily: 'monospace', fontSize: 11.5),
                      overflow: TextOverflow.ellipsis),
                  if (subparts.isNotEmpty)
                    Text(subparts.join(' · '),
                        style: TextStyle(
                            fontSize: 10, color: Colors.grey.shade500),
                        overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            Text(
                '${c['count']}회\n${_time(c['first'] as String?)}\n~ ${_time(c['last'] as String?)}',
                textAlign: TextAlign.right,
                style: TextStyle(fontSize: 9, color: Colors.grey.shade600)),
          ]);
        }),
        if (_history.isEmpty) _emptyRow('히스토리 없음'),
      ];

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      builder: (_, ctrl) => Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 8, 4),
          child: Row(children: [
            const Text('📡 접속 정보',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const Spacer(),
            IconButton(
                icon: const Icon(Icons.refresh, size: 20),
                tooltip: '새로고침',
                onPressed: _load),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 0, label: Text('현재 접속')),
              ButtonSegment(value: 1, label: Text('접속 히스토리')),
            ],
            selected: {_tab},
            onSelectionChanged: (s) => setState(() => _tab = s.first),
            style: const ButtonStyle(
              visualDensity: VisualDensity.compact,
              textStyle: WidgetStatePropertyAll(TextStyle(fontSize: 12.5)),
            ),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: d == null
              ? Center(
                  child: _error != null
                      ? Text('불러오기 실패: $_error',
                          style: const TextStyle(color: Colors.grey))
                      : const CircularProgressIndicator())
              : ListView(
                  controller: ctrl,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  children: _tab == 0 ? _nowChildren(d) : _historyChildren(),
                ),
        ),
      ]),
    );
  }
}
