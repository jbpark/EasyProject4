import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../api/sse_client.dart';
import '../model_options.dart';
import '../models/project.dart';
import '../state/app_state.dart';
import '../widgets/status_chip.dart';
import 'tasks_screen.dart';

class ProjectsScreen extends StatefulWidget {
  const ProjectsScreen({super.key});

  @override
  State<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends State<ProjectsScreen> {
  List<Project> _projects = [];
  List<Project> _remoteProjects = [];   // 다른 EP4(peer)의 공유 프로젝트
  List<String> _remoteErrors = [];      // peer 조회 실패 사유
  bool _loading = true;
  String? _error;
  StreamSubscription<SseEvent>? _sub;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = context.read<AppState>().events?.listen((e) {
      if (['status', 'task_done', 'task_start', 'tasks_changed'].contains(e.event)) {
        _load();
      }
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await context.read<AppState>().api.projects();
      if (!mounted) return;
      setState(() {
        _projects = list;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$e';
      });
    }
    // 원격(peer) 프로젝트는 별도로 — 실패해도 로컬 목록 표시엔 영향 없음
    try {
      final (remote, errs) = await context.read<AppState>().api.remoteProjects();
      if (!mounted) return;
      setState(() {
        _remoteProjects = remote;
        _remoteErrors = errs;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _remoteProjects = [];
        _remoteErrors = [];
      });
    }
  }

  Future<void> _openFolder(Project p) async {
    if (p.remote) return; // 원격 PC 의 폴더는 열 수 없음
    try {
      await context.read<AppState>().api.openProjectFolder(p.id);
    } catch (_) {}
  }

  /// 프로젝트 설정 입력 시트 (웹 대시보드 프로젝트 폼과 동일 항목).
  /// 저장 시 변경된 필드를 담은 Map 반환.
  Future<Map<String, dynamic>?> _projectForm(
      {String title = '', Map<String, dynamic> initial = const {}}) {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ProjectEditorSheet(title: title, initial: initial),
    );
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg), duration: const Duration(seconds: 2)));
  }

  Future<void> _createProject() async {
    final api = context.read<AppState>().api;
    final r = await _projectForm(title: '새 프로젝트');
    if (r == null) return;
    try {
      final extra = Map<String, dynamic>.from(r)
        ..remove('name')
        ..remove('description');
      await api.createProject(r['name'] as String,
          description: (r['description'] ?? '') as String, extra: extra);
      await _load();
    } catch (e) {
      _snack('생성 실패: $e');
    }
  }

  Future<void> _editProject(Project p) async {
    final api = context.read<AppState>().api;
    final r = await _projectForm(title: '프로젝트 편집', initial: p.raw);
    if (r == null) return;
    // /update 는 전체 필드를 덮어쓰므로 원본(raw)에 변경분만 얹어 보낸다.
    final body = Map<String, dynamic>.from(p.raw)..addAll(r);
    try {
      await api.updateProject(p.id, body);
      await _load();
    } catch (e) {
      _snack('수정 실패: $e');
    }
  }

  Future<void> _deleteProject(Project p) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('프로젝트 삭제'),
        content: Text("'${p.name}' 프로젝트를 삭제할까요?\n등록된 태스크 목록도 더 이상 표시되지 않습니다."),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('취소')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFF87171)),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('삭제'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    if (!mounted) return;
    final api = context.read<AppState>().api;
    try {
      await api.deleteProject(p.id);
      await _load();
    } catch (e) {
      _snack('삭제 실패: $e');
    }
  }

  Future<void> _viewClaudeMd(Project p) async {
    String content;
    try {
      final api = context.read<AppState>().api;
      // 원격 프로젝트는 peer-proxy 로 상대 EP4 에서 가져온다
      content = await (p.remote ? api.forPeer(p.peerUrl) : api).claudeMd(p.id);
    } catch (e) {
      content = '오류: $e';
    }
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        builder: (_, ctrl) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
              child: Row(
                children: [
                  const Text('CLAUDE.md',
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color: Color(0xFF4ADE80))),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(p.name,
                        style: const TextStyle(color: Colors.grey, fontSize: 13),
                        overflow: TextOverflow.ellipsis),
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy, size: 18),
                    tooltip: '복사',
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: content));
                      ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('복사됨'), duration: Duration(seconds: 1)));
                    },
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                controller: ctrl,
                padding: const EdgeInsets.all(16),
                children: [
                  SelectableText(
                    content.isEmpty ? '(내용 없음)' : content,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(Project p) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: _ProjectCard(
          project: p,
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => TasksScreen(project: p)),
          ),
          onOpenFolder: () => _openFolder(p),
          onViewClaudeMd: () => _viewClaudeMd(p),
          onEdit: () => _editProject(p),
          onDelete: () => _deleteProject(p),
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final hasRemote = _remoteProjects.isNotEmpty || _remoteErrors.isNotEmpty;
    final body = _error != null
        ? _ErrorView(message: _error!, onRetry: _load)
        : RefreshIndicator(
            onRefresh: _load,
            child: (_projects.isEmpty && !hasRemote)
                ? ListView(children: const [
                    SizedBox(height: 120),
                    Center(child: Text('프로젝트가 없습니다')),
                  ])
                : ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      ..._projects.map(_card),
                      // 다른 EP4(peer)의 공유 프로젝트 섹션
                      if (hasRemote) ...[
                        Padding(
                          padding: const EdgeInsets.fromLTRB(4, 14, 4, 8),
                          child: Text('🔗 다른 EP4 공유 프로젝트',
                              style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.grey.shade400)),
                        ),
                        for (final err in _remoteErrors)
                          Card(
                            child: ListTile(
                              dense: true,
                              leading: const Icon(Icons.error_outline,
                                  color: Color(0xFFF87171), size: 20),
                              title: Text(err,
                                  style: const TextStyle(
                                      fontSize: 12.5, color: Color(0xFFF87171))),
                            ),
                          ),
                        ..._remoteProjects.map(_card),
                      ],
                    ],
                  ),
          );
    return Scaffold(
      body: body,
      floatingActionButton: FloatingActionButton(
        tooltip: '새 프로젝트',
        onPressed: _createProject,
        child: const Icon(Icons.add),
      ),
    );
  }
}

class _ProjectCard extends StatelessWidget {
  final Project project;
  final VoidCallback onTap;
  final VoidCallback onOpenFolder;
  final VoidCallback onViewClaudeMd;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ProjectCard({
    required this.project,
    required this.onTap,
    required this.onOpenFolder,
    required this.onViewClaudeMd,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final p = project;
    final s = p.stats;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Dot(p.status),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // 프로젝트명 + 배지 행
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 6,
                      children: [
                        Text(p.name,
                            style: const TextStyle(
                                fontWeight: FontWeight.w600, fontSize: 15)),
                        if (p.remote)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFFA78BFA).withValues(alpha: 0.12),
                              border: Border.all(
                                  color: const Color(0xFFA78BFA).withValues(alpha: 0.35)),
                              borderRadius: BorderRadius.circular(5),
                            ),
                            child: Text(
                                '🔗 ${p.peerName.isNotEmpty ? p.peerName : p.host}',
                                style: const TextStyle(
                                    fontSize: 10,
                                    color: Color(0xFFA78BFA),
                                    fontWeight: FontWeight.w500)),
                          ),
                        if (p.hasClaudeMd)
                          GestureDetector(
                            onTap: onViewClaudeMd,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF4ADE80).withValues(alpha: 0.12),
                                border: Border.all(
                                    color: const Color(0xFF4ADE80).withValues(alpha: 0.35)),
                                borderRadius: BorderRadius.circular(5),
                              ),
                              child: const Text('CLAUDE.md',
                                  style: TextStyle(
                                      fontSize: 10,
                                      color: Color(0xFF4ADE80),
                                      fontWeight: FontWeight.w500)),
                            ),
                          ),
                        if (p.gitProjBranch.isNotEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFF38BDF8).withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text('⎇ ${p.gitProjBranch}',
                                style: const TextStyle(
                                    fontSize: 10,
                                    color: Color(0xFF38BDF8),
                                    fontFamily: 'monospace')),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    // 태스크 통계
                    Text(
                      '태스크 ${s.total} · 완료 ${s.done}'
                      '${s.running > 0 ? ' · 실행 ${s.running}' : ''}'
                      '${s.error > 0 ? ' · 실패 ${s.error}' : ''}',
                      style:
                          TextStyle(color: Colors.grey.shade400, fontSize: 12.5),
                    ),
                    // project_root 경로
                    if (p.projectRoot.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(p.projectRoot,
                          style: TextStyle(
                              color: Colors.grey.shade600, fontSize: 10.5),
                          overflow: TextOverflow.ellipsis),
                    ],
                  ],
                ),
              ),
              // 우측 버튼들
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    if (p.projectRoot.isNotEmpty && !p.remote)
                      IconButton(
                        icon: const Icon(Icons.folder_open, size: 18),
                        tooltip: '폴더 열기',
                        onPressed: onOpenFolder,
                        padding: const EdgeInsets.all(4),
                        constraints: const BoxConstraints(),
                      ),
                    if (!p.remote)
                    PopupMenuButton<String>(
                      padding: const EdgeInsets.all(4),
                      iconSize: 18,
                      onSelected: (v) {
                        if (v == 'edit') onEdit();
                        if (v == 'delete') onDelete();
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(
                            value: 'edit',
                            child: ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                leading: Icon(Icons.edit_outlined, size: 18),
                                title: Text('편집'))),
                        PopupMenuItem(
                            value: 'delete',
                            child: ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                leading: Icon(Icons.delete_outline,
                                    size: 18, color: Color(0xFFF87171)),
                                title: Text('삭제',
                                    style: TextStyle(
                                        color: Color(0xFFF87171))))),
                      ],
                    ),
                  ]),
                  const Icon(Icons.chevron_right, color: Colors.grey),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 프로젝트 설정 시트 — 웹 대시보드 프로젝트 폼과 동일 항목
/// (엔진·모델·재시도·타임아웃·작업 폴더·미리보기 URL·권한/자동실행/공유).
class _ProjectEditorSheet extends StatefulWidget {
  final String title;
  final Map<String, dynamic> initial;
  const _ProjectEditorSheet({required this.title, this.initial = const {}});

  @override
  State<_ProjectEditorSheet> createState() => _ProjectEditorSheetState();
}

class _ProjectEditorSheetState extends State<_ProjectEditorSheet> {
  late final _name =
      TextEditingController(text: (widget.initial['name'] ?? '') as String);
  late final _desc = TextEditingController(
      text: (widget.initial['description'] ?? '') as String);
  late final _retry =
      TextEditingController(text: '${widget.initial['retry_count'] ?? 3}');
  late final _timeout =
      TextEditingController(text: '${widget.initial['timeout_sec'] ?? 1800}');
  late final _root = TextEditingController(
      text: (widget.initial['project_root'] ?? '') as String);
  late final _previewUrl = TextEditingController(
      text: (widget.initial['preview_url'] ?? '') as String);

  late String _engine = (widget.initial['engine'] ?? 'claude') as String;
  late String _model = (widget.initial['model'] ?? kDefaultModel) as String;
  late bool _skipPerms = (widget.initial['skip_permissions'] ?? 0) != 0 &&
      widget.initial['skip_permissions'] != false;
  late bool _autoRun = widget.initial.containsKey('auto_run')
      ? (widget.initial['auto_run'] != 0 && widget.initial['auto_run'] != false)
      : true;
  late bool _shared = (widget.initial['shared'] ?? 0) != 0 &&
      widget.initial['shared'] != false;

  @override
  Widget build(BuildContext context) {
    final models = modelsFor(_engine);
    // 저장된 모델이 현재 엔진 목록에 없으면 항목으로 유지해 값 오류를 막는다
    final modelItems = {
      if (!models.containsKey(_model)) _model: modelLabel(_model),
      ...models,
    };
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (c, scroll) => Padding(
        padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 16,
            bottom: MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.title,
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            Expanded(
              child: ListView(
                controller: scroll,
                children: [
                  TextField(
                    controller: _name,
                    decoration: const InputDecoration(
                        labelText: '프로젝트 이름', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _desc,
                    maxLines: 2,
                    decoration: const InputDecoration(
                        labelText: '설명 (선택)', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: _engine,
                    decoration: const InputDecoration(
                        labelText: '실행 엔진', border: OutlineInputBorder()),
                    items: const [
                      DropdownMenuItem(value: 'claude', child: Text('Claude CLI')),
                      DropdownMenuItem(
                          value: 'antigravity',
                          child: Text('Antigravity (Gemini CLI)')),
                    ],
                    onChanged: (v) => setState(() {
                      _engine = v ?? 'claude';
                      // 엔진 변경 시 현재 모델이 목록에 없으면 기본값으로 보정
                      if (!modelsFor(_engine).containsKey(_model)) {
                        _model = _engine == 'claude' ? kDefaultModel : '';
                      }
                    }),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: _model,
                    decoration: const InputDecoration(
                        labelText: '모델', border: OutlineInputBorder()),
                    items: [
                      for (final e in modelItems.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (v) => setState(() => _model = v ?? _model),
                  ),
                  const SizedBox(height: 10),
                  Row(children: [
                    Expanded(
                      child: TextField(
                        controller: _retry,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                            labelText: '재시도', border: OutlineInputBorder()),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _timeout,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                            labelText: '타임아웃(초)',
                            border: OutlineInputBorder()),
                      ),
                    ),
                  ]),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _root,
                    decoration: const InputDecoration(
                        labelText: '작업 폴더 (project_root)',
                        hintText: r'예: C:\repo\myproject',
                        border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _previewUrl,
                    decoration: const InputDecoration(
                        labelText: '미리보기 URL (선택)',
                        hintText: '예: http://localhost:7788',
                        border: OutlineInputBorder()),
                  ),
                  SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('⚠ 권한 건너뛰기 (--dangerously-skip-permissions)',
                        style: TextStyle(fontSize: 13.5)),
                    value: _skipPerms,
                    onChanged: (v) => setState(() => _skipPerms = v),
                  ),
                  SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('자동 실행 (등록 시 바로 실행)',
                        style: TextStyle(fontSize: 13.5)),
                    value: _autoRun,
                    onChanged: (v) => setState(() => _autoRun = v),
                  ),
                  SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('다른 EP4 에 공유', style: TextStyle(fontSize: 13.5)),
                    value: _shared,
                    onChanged: (v) => setState(() => _shared = v),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('취소')),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: () {
                    final n = _name.text.trim();
                    if (n.isEmpty) return;
                    Navigator.pop(context, <String, dynamic>{
                      'name': n,
                      'description': _desc.text.trim(),
                      'engine': _engine,
                      'model': _model,
                      'retry_count': int.tryParse(_retry.text.trim()) ?? 3,
                      'timeout_sec': int.tryParse(_timeout.text.trim()) ?? 1800,
                      'project_root': _root.text.trim(),
                      'preview_url': _previewUrl.text.trim(),
                      'skip_permissions': _skipPerms,
                      'auto_run': _autoRun,
                      'shared': _shared,
                    });
                  },
                  child: const Text('저장'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});
  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 40, color: Colors.grey),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(message, textAlign: TextAlign.center),
            ),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('다시 시도')),
          ],
        ),
      );
}
