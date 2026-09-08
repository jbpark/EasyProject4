import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/sse_client.dart';
import '../models/run_log.dart';
import '../state/app_state.dart';
import '../widgets/status_chip.dart';

/// api 를 넘기면 그 클라이언트로 조회한다 (원격 프로젝트의 peer-proxy 라우팅용).
class RunLogDetailScreen extends StatefulWidget {
  final int runId;
  final ApiClient? api;
  const RunLogDetailScreen({super.key, required this.runId, this.api});

  @override
  State<RunLogDetailScreen> createState() => _RunLogDetailScreenState();
}

class _RunLogDetailScreenState extends State<RunLogDetailScreen>
    with SingleTickerProviderStateMixin {
  RunDetail? _detail;
  String _patch = '';
  bool _loading = true;
  StreamSubscription<SseEvent>? _sub;
  late TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 6, vsync: this); // 로그/입력/출력/Claude/Git/미리보기
    _load();
    _sub = context.read<AppState>().events?.listen((e) {
      if (['run_log', 'task_done'].contains(e.event)) _load();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = widget.api ?? context.read<AppState>().api;
      final d = await api.runDetail(widget.runId);
      String patch = '';
      if (d.gitDiff.isNotEmpty || d.gitCommits.isNotEmpty) {
        patch = await api.gitPatch(widget.runId);
      }
      if (!mounted) return;
      setState(() {
        _detail = d;
        _patch = patch;
        _loading = false;
        // Claude 탭이 없는데 선택돼 있으면 로그로 이동
        if (d.claudeSession == null && _tabs.index == 3) {
          _tabs.animateTo(0);
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Color _levelColor(String lv) {
    switch (lv.toUpperCase()) {
      case 'ERROR':
        return const Color(0xFFF87171);
      case 'WARN':
        return const Color(0xFFFBBF24);
      case 'CLAUDE':
        return const Color(0xFF7EE787);
      case 'TOOL':
        return const Color(0xFFFBBF24);
      case 'RESULT':
        return const Color(0xFF8B949E);
      case 'INFO':
        return const Color(0xFF38BDF8);
      default:
        return Colors.grey;
    }
  }

  String _modelShort(String m) {
    var s = m.replaceFirst(RegExp(r'^claude-'), '');
    s = s.replaceAll(RegExp(r'-\d{8}$'), '');
    return s;
  }

  String _fmtTokens(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }

  String _fmtDuration(String firstTs, String lastTs) {
    try {
      final a = DateTime.parse(firstTs);
      final b = DateTime.parse(lastTs);
      final diff = b.difference(a);
      if (diff.inHours > 0) return '${diff.inHours}h ${diff.inMinutes.remainder(60)}m';
      if (diff.inMinutes > 0) return '${diff.inMinutes}m ${diff.inSeconds.remainder(60)}s';
      return '${diff.inSeconds}s';
    } catch (_) {
      return '';
    }
  }

  String _fmtTs(String iso) {
    try {
      final t = DateTime.parse(iso).toLocal();
      return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}:${t.second.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso.length > 8 ? iso.substring(11, 19) : iso;
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    final hasClaude = d?.claudeSession != null;
    final hasShot = (d?.screenshot ?? '').isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: Text(d?.summary.taskTitle ?? '실행 로그 상세',
            overflow: TextOverflow.ellipsis),
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [
            const Tab(text: '로그'),
            const Tab(text: '입력'),
            const Tab(text: '출력'),
            Tab(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Text('🤖 클로드 세션'),
                if (!hasClaude)
                  const Padding(
                    padding: EdgeInsets.only(left: 4),
                    child: Icon(Icons.lock_outline, size: 12, color: Colors.grey),
                  ),
              ]),
            ),
            Tab(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Text('⎇ Git'),
                if ((d?.gitDiff.length ?? 0) > 0)
                  Padding(
                    padding: const EdgeInsets.only(left: 5),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: const Color(0xFF38BDF8).withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Text('${d!.gitDiff.length}',
                          style: const TextStyle(fontSize: 11, color: Color(0xFF38BDF8))),
                    ),
                  ),
              ]),
            ),
            Tab(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Text('📷 미리보기'),
                if (!hasShot)
                  const Padding(
                    padding: EdgeInsets.only(left: 4),
                    child: Icon(Icons.lock_outline, size: 12, color: Colors.grey),
                  ),
              ]),
            ),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : d == null
              ? const Center(child: Text('로그를 찾을 수 없습니다'))
              : Column(
                  children: [
                    _MetaBar(detail: d),
                    Expanded(
                      child: TabBarView(
                        controller: _tabs,
                        children: [
                          _LogTab(lines: d.logLines, levelColor: _levelColor),
                          _MonoTab(text: d.prompt, emptyMsg: '(입력 없음)'),
                          _MonoTab(text: d.output, emptyMsg: '(출력 없음)'),
                          hasClaude
                              ? _ClaudeTab(
                                  session: d.claudeSession!,
                                  modelShort: _modelShort,
                                  fmtTokens: _fmtTokens,
                                  fmtDuration: _fmtDuration,
                                  fmtTs: _fmtTs,
                                )
                              : const Center(
                                  child: Text('클로드 세션 정보 없음',
                                      style: TextStyle(color: Colors.grey))),
                          _GitTab(detail: d, patch: _patch),
                          _PreviewTab(detail: d),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}

// ── 미리보기(스크린샷) 탭 ─────────────────────────────────────────────────────

class _PreviewTab extends StatelessWidget {
  final RunDetail detail;
  const _PreviewTab({required this.detail});

  @override
  Widget build(BuildContext context) {
    final d = detail;
    if (d.screenshot.isEmpty) {
      return Center(
        child: Text('스크린샷이 없습니다',
            style: TextStyle(color: Colors.grey.shade600)),
      );
    }
    final app = context.read<AppState>();
    final url = '${app.baseUrl}${d.screenshot}';
    final headers = <String, String>{
      if ((app.token ?? '').isNotEmpty) 'Authorization': 'Bearer ${app.token}',
    };
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (d.previewUrl.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: GestureDetector(
              onTap: () {
                Clipboard.setData(ClipboardData(text: d.previewUrl));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('미리보기 주소 복사됨'),
                    duration: Duration(seconds: 1)));
              },
              child: Row(children: [
                const Icon(Icons.link, size: 15, color: Color(0xFF38BDF8)),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(d.previewUrl,
                      style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF38BDF8),
                          fontFamily: 'monospace'),
                      overflow: TextOverflow.ellipsis),
                ),
                const Icon(Icons.copy, size: 14, color: Colors.grey),
              ]),
            ),
          ),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: InteractiveViewer(
            maxScale: 5,
            child: Image.network(
              url,
              headers: headers,
              fit: BoxFit.contain,
              loadingBuilder: (_, child, progress) => progress == null
                  ? child
                  : const Padding(
                      padding: EdgeInsets.symmetric(vertical: 60),
                      child: Center(child: CircularProgressIndicator()),
                    ),
              errorBuilder: (_, __, ___) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 60),
                child: Center(
                  child: Text('스크린샷을 불러오지 못했습니다',
                      style: TextStyle(color: Colors.grey.shade600)),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

// ── 메타 정보 바 ─────────────────────────────────────────────────────────────

class _MetaBar extends StatelessWidget {
  final RunDetail detail;
  const _MetaBar({required this.detail});

  @override
  Widget build(BuildContext context) {
    final d = detail;
    final s = d.summary;
    final branch = d.gitTaskBranch.isNotEmpty
        ? d.gitTaskBranch
        : d.gitProjBranch;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
      color: const Color(0xFF161B22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            StatusChip(s.status),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${s.projectName} · ${s.model}'
                '${s.durationSec != null ? ' · ${s.durationSec}s' : ''}',
                style: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ]),
          if (branch.isNotEmpty || s.claudeSessionId.isNotEmpty) ...[
            const SizedBox(height: 4),
            Wrap(spacing: 8, children: [
              if (branch.isNotEmpty)
                _chip('⎇ $branch', const Color(0xFF38BDF8)),
              if (s.claudeSessionId.isNotEmpty)
                GestureDetector(
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: s.claudeSessionId));
                    ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text('세션 ID 복사됨'),
                            duration: Duration(seconds: 1)));
                  },
                  child: _chip(
                      '🤖 ${s.claudeSessionId.substring(0, 8)}…',
                      const Color(0xFFA78BFA)),
                ),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _chip(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 10.5, color: color, fontFamily: 'monospace')),
      );
}

// ── 로그 탭 ──────────────────────────────────────────────────────────────────

class _LogTab extends StatelessWidget {
  final List<RunLogLine> lines;
  final Color Function(String) levelColor;
  const _LogTab({required this.lines, required this.levelColor});

  @override
  Widget build(BuildContext context) {
    if (lines.isEmpty) {
      return Center(child: Text('(로그 없음)', style: TextStyle(color: Colors.grey.shade600)));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(10),
      itemCount: lines.length,
      itemBuilder: (_, i) {
        final l = lines[i];
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 1),
          child: SelectableText.rich(
            TextSpan(children: [
              TextSpan(
                  text: '${l.ts} ',
                  style: TextStyle(
                      color: Colors.grey.shade600,
                      fontSize: 11,
                      fontFamily: 'monospace')),
              TextSpan(
                  text: '${l.level} ',
                  style: TextStyle(
                      color: levelColor(l.level),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      fontFamily: 'monospace')),
              TextSpan(
                  text: l.msg,
                  style: const TextStyle(
                      fontSize: 12, fontFamily: 'monospace')),
            ]),
          ),
        );
      },
    );
  }
}

// ── 텍스트 탭 (입력/출력) ─────────────────────────────────────────────────────

class _MonoTab extends StatelessWidget {
  final String text;
  final String emptyMsg;
  const _MonoTab({required this.text, required this.emptyMsg});

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty) {
      return Center(child: Text(emptyMsg, style: TextStyle(color: Colors.grey.shade600)));
    }
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        SelectableText(text,
            style: const TextStyle(fontSize: 12.5, fontFamily: 'monospace')),
      ],
    );
  }
}

// ── 클로드 세션 탭 ─────────────────────────────────────────────────────────────

class _ClaudeTab extends StatelessWidget {
  final ClaudeSessionDetail session;
  final String Function(String) modelShort;
  final String Function(int) fmtTokens;
  final String Function(String, String) fmtDuration;
  final String Function(String) fmtTs;

  const _ClaudeTab({
    required this.session,
    required this.modelShort,
    required this.fmtTokens,
    required this.fmtDuration,
    required this.fmtTs,
  });

  @override
  Widget build(BuildContext context) {
    final s = session;
    final duration = s.firstTs.isNotEmpty && s.lastTs.isNotEmpty
        ? fmtDuration(s.firstTs, s.lastTs)
        : '';
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        // 세션 이름 (Claude가 생성한 제목)
        if (s.title.isNotEmpty) ...[
          _SessField(label: '세션 이름', value: s.title),
          const SizedBox(height: 8),
        ],
        // 세션 ID
        _SessField(
          label: '세션 ID',
          value: s.sessionId,
          onCopy: () {
            Clipboard.setData(ClipboardData(text: s.sessionId));
            ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                    content: Text('세션 ID 복사됨'),
                    duration: Duration(seconds: 1)));
          },
        ),
        const SizedBox(height: 8),
        // 모델
        _SessField(label: '모델', value: modelShort(s.model)),
        const SizedBox(height: 12),
        // 통계 그리드
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 8,
          mainAxisSpacing: 8,
          childAspectRatio: 2.6,
          children: [
            _StatBox(label: '메시지', value: '${s.msgCount}'),
            _StatBox(label: '도구 호출', value: '${s.toolCount}'),
            _StatBox(
                label: '총 토큰',
                value: fmtTokens(s.totalTokens),
                sub: '입력 ${fmtTokens(s.inputTokens)} · 출력 ${fmtTokens(s.outputTokens)}'),
            _StatBox(
                label: '캐시 토큰',
                value: fmtTokens(s.cacheTokens),
                sub: duration.isNotEmpty ? '⏱ $duration' : ''),
          ],
        ),
        const SizedBox(height: 12),
        // 첫 프롬프트
        if (s.firstPrompt.isNotEmpty) ...[
          Text('첫 프롬프트',
              style: TextStyle(
                  fontSize: 11,
                  color: Colors.grey.shade500,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF0A0E14),
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(
              s.firstPrompt.length > 300
                  ? '${s.firstPrompt.substring(0, 300)}…'
                  : s.firstPrompt,
              style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
            ),
          ),
          const SizedBox(height: 14),
        ],
        // cwd
        if (s.cwd.isNotEmpty) ...[
          Text('작업 경로',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
          const SizedBox(height: 2),
          Text(s.cwd,
              style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
              overflow: TextOverflow.ellipsis),
          const SizedBox(height: 12),
        ],
        // 잘림 경고
        if (s.truncated)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text('⚠ 메시지가 너무 많아 일부만 표시됩니다',
                style: TextStyle(color: Colors.amber.shade400, fontSize: 12)),
          ),
        // 구분선
        const Divider(),
        const SizedBox(height: 4),
        // 메시지 목록
        ...s.messages.map((m) => _MsgBubble(
              msg: m,
              fmtTs: fmtTs,
            )),
      ],
    );
  }
}

class _SessField extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback? onCopy;
  const _SessField({required this.label, required this.value, this.onCopy});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Text('$label: ',
          style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
      Expanded(
        child: Text(value,
            style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
            overflow: TextOverflow.ellipsis),
      ),
      if (onCopy != null)
        GestureDetector(
          onTap: onCopy,
          child: const Icon(Icons.copy, size: 15, color: Colors.grey),
        ),
    ]);
  }
}

class _StatBox extends StatelessWidget {
  final String label;
  final String value;
  final String sub;
  const _StatBox({required this.label, required this.value, this.sub = ''});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF161B22),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label,
              style: TextStyle(fontSize: 10, color: Colors.grey.shade500)),
          Text(value,
              style: const TextStyle(
                  fontSize: 16, fontWeight: FontWeight.bold)),
          if (sub.isNotEmpty)
            Text(sub,
                style: TextStyle(fontSize: 9.5, color: Colors.grey.shade500),
                overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

// ── Git 탭 ───────────────────────────────────────────────────────────────────

class _GitTab extends StatelessWidget {
  final RunDetail detail;
  final String patch;
  const _GitTab({required this.detail, required this.patch});

  @override
  Widget build(BuildContext context) {
    final d = detail;
    final single = d.gitTaskBranch.isNotEmpty ? d.gitTaskBranch : d.gitProjBranch;
    final hasFlow = d.gitTaskBranch.isNotEmpty && d.gitProjBranch.isNotEmpty;
    if (d.gitDiff.isEmpty && d.gitCommits.isEmpty && patch.isEmpty) {
      return Center(
        child: Text('Git 변경 내역이 없습니다',
            style: TextStyle(color: Colors.grey.shade600)),
      );
    }
    final totalAdd = d.gitDiff.fold<int>(0, (s, f) => s + f.added);
    final totalDel = d.gitDiff.fold<int>(0, (s, f) => s + f.removed);
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        // 브랜치 흐름 (task → proj) / 머지 상태 / PR
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          if (hasFlow) ...[
            _chip('⎇ ${d.gitTaskBranch}', const Color(0xFF38BDF8)),
            const Text('→', style: TextStyle(color: Colors.grey)),
            _chip('⎇ ${d.gitProjBranch}', const Color(0xFF38BDF8)),
          ] else if (single.isNotEmpty)
            _chip('⎇ $single', const Color(0xFF38BDF8)),
          if (d.gitMergeStatus.isNotEmpty && d.gitMergeStatus != 'no_git')
            _chip(_mergeLabel(d.gitMergeStatus), const Color(0xFFA78BFA)),
          if (d.gitPrUrl.isNotEmpty)
            GestureDetector(
              onTap: () {
                Clipboard.setData(ClipboardData(text: d.gitPrUrl));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('PR 주소 복사됨'), duration: Duration(seconds: 1)));
              },
              child: _chip('🔗 PR', const Color(0xFF4ADE80)),
            ),
        ]),
        const SizedBox(height: 14),

        // 변경된 파일 목록
        if (d.gitDiff.isNotEmpty) ...[
          _label('변경된 파일 ${d.gitDiff.length}'),
          const SizedBox(height: 6),
          ...d.gitDiff.map((f) => _fileRow(f)),
          const SizedBox(height: 6),
          Text('${d.gitDiff.length}파일 · +$totalAdd -$totalDel'
              '${d.gitCommits.isNotEmpty ? ' · ${d.gitCommits.length}커밋' : ''}',
              style: TextStyle(fontSize: 11.5, color: Colors.grey.shade500)),
          const SizedBox(height: 14),
        ],

        // 커밋
        if (d.gitCommits.isNotEmpty) ...[
          _label('커밋 ${d.gitCommits.length}'),
          const SizedBox(height: 6),
          ...d.gitCommits.map((c) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${c.hash}  ',
                      style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 12,
                          color: Color(0xFFFBBF24))),
                  Expanded(
                    child: Text(c.msg,
                        style: const TextStyle(fontSize: 12.5)),
                  ),
                ]),
              )),
          const SizedBox(height: 14),
        ],

        // 변경 내용 (diff)
        if (patch.isNotEmpty) ...[
          _label('변경 내용 (diff)'),
          const SizedBox(height: 6),
          _DiffView(patch: patch),
        ],
      ],
    );
  }

  String _mergeLabel(String s) {
    switch (s) {
      case 'merged':
        return '✓ 머지됨';
      case 'conflict':
        return '⚠ 충돌';
      case 'pending':
        return '머지 대기';
      case 'committed':
        return '커밋됨';
      default:
        return s;
    }
  }

  Widget _label(String t) => Text(t,
      style: TextStyle(
          fontSize: 12, color: Colors.grey.shade400, fontWeight: FontWeight.w600));

  Widget _fileRow(GitDiffFile f) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          const Icon(Icons.insert_drive_file_outlined, size: 15, color: Colors.grey),
          const SizedBox(width: 6),
          Expanded(
            child: Text(f.file,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5),
                overflow: TextOverflow.ellipsis),
          ),
          if (f.added > 0) ...[
            const SizedBox(width: 6),
            Text('+${f.added}',
                style: const TextStyle(
                    color: Color(0xFF4ADE80), fontSize: 12, fontFamily: 'monospace')),
          ],
          if (f.removed > 0) ...[
            const SizedBox(width: 6),
            Text('-${f.removed}',
                style: const TextStyle(
                    color: Color(0xFFF87171), fontSize: 12, fontFamily: 'monospace')),
          ],
        ]),
      );

  Widget _chip(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(label,
            style: TextStyle(fontSize: 11.5, color: color, fontFamily: 'monospace')),
      );
}

// 통합 diff 텍스트를 줄별 색상으로 렌더링
class _DiffView extends StatelessWidget {
  final String patch;
  const _DiffView({required this.patch});

  Color _lineColor(String ln) {
    if (ln.startsWith('diff --git') ||
        ln.startsWith('index ') ||
        ln.startsWith('--- ') ||
        ln.startsWith('+++ ') ||
        ln.startsWith('new file') ||
        ln.startsWith('deleted file') ||
        ln.startsWith('rename ')) {
      return const Color(0xFF8B949E);
    }
    if (ln.startsWith('@@')) return const Color(0xFF38BDF8);
    if (ln.startsWith('+')) return const Color(0xFF4ADE80);
    if (ln.startsWith('-')) return const Color(0xFFF87171);
    return const Color(0xFFC9D1D9);
  }

  @override
  Widget build(BuildContext context) {
    final lines = patch.split('\n');
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFF0A0E14),
        borderRadius: BorderRadius.circular(8),
      ),
      padding: const EdgeInsets.all(10),
      child: SelectableText.rich(
        TextSpan(
          style: const TextStyle(
              fontFamily: 'monospace', fontSize: 11.5, height: 1.4),
          children: [
            for (final ln in lines)
              TextSpan(text: '$ln\n', style: TextStyle(color: _lineColor(ln))),
          ],
        ),
      ),
    );
  }
}

class _MsgBubble extends StatelessWidget {
  final ClaudeSessionMessage msg;
  final String Function(String) fmtTs;
  const _MsgBubble({required this.msg, required this.fmtTs});

  @override
  Widget build(BuildContext context) {
    final isUser = msg.role == 'user';
    final accent = isUser
        ? const Color(0xFF38BDF8)
        : const Color(0xFFFF6A3D);
    final label = isUser ? '👤 사용자' : '🤖 Claude';
    final ts = msg.ts.isNotEmpty ? fmtTs(msg.ts) : '';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFF0D1117),
          borderRadius: BorderRadius.circular(9),
          border: Border(left: BorderSide(color: accent, width: 3)),
        ),
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Text(label,
                  style: TextStyle(
                      fontSize: 11,
                      color: accent,
                      fontWeight: FontWeight.w600)),
              if (ts.isNotEmpty) ...[
                const Spacer(),
                Text(ts,
                    style: TextStyle(
                        fontSize: 10, color: Colors.grey.shade600)),
              ],
            ]),
            const SizedBox(height: 5),
            SelectableText(
              msg.text.length > 600
                  ? '${msg.text.substring(0, 600)}…'
                  : msg.text,
              style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
            ),
          ],
        ),
      ),
    );
  }
}
