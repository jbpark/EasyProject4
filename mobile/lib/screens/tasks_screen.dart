import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/sse_client.dart';
import '../model_options.dart';
import '../models/project.dart';
import '../models/task.dart';
import '../models/folder.dart';
import '../state/app_state.dart';
import '../widgets/status_chip.dart';
import 'task_runs_screen.dart';

class TasksScreen extends StatefulWidget {
  final Project project;
  const TasksScreen({super.key, required this.project});

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  List<Task> _tasks = [];
  List<Folder> _folders = [];
  final Set<int> _collapsed = {}; // 접힌 폴더 id
  String _filter = 'all'; // all | running | pending | done | error
  bool _loading = true;
  bool _running = false;
  StreamSubscription<SseEvent>? _sub;
  final Set<int> _selectedIds = {};
  bool _selectionMode = false;

  late Project _project = widget.project; // 드롭다운으로 전환 가능한 현재 프로젝트
  List<Project> _allProjects = [];

  int get _pid => _project.id;

  /// 현재 프로젝트가 원격(다른 EP4)이면 peer-proxy 로 라우팅되는 클라이언트.
  ApiClient get _api {
    final api = context.read<AppState>().api;
    return _project.remote ? api.forPeer(_project.peerUrl) : api;
  }

  /// 로컬/원격 프로젝트 id 충돌을 피하는 드롭다운 키.
  static String _keyOf(Project p) =>
      p.remote ? 'r:${p.peerUrl}:${p.id}' : 'l:${p.id}';

  @override
  void initState() {
    super.initState();
    _allProjects = [widget.project];
    _load();
    _loadProjects();
    _sub = context.read<AppState>().events?.listen((e) {
      // 이벤트 출처(peer_url)와 현재 보는 프로젝트의 출처가 같을 때만 갱신
      // (로컬-원격 간 project_id 숫자 충돌 오동작 방지)
      final epeer = (e.data['peer_url'] ?? '') as String;
      final mypeer = _project.remote ? _project.peerUrl : '';
      if (epeer != mypeer) return;
      final epid = e.data['project_id'];
      if (epid != null && epid != _pid) return;
      if (['status', 'task_start', 'task_done', 'tasks_changed'].contains(e.event)) {
        _load();
      }
    });
  }

  Future<void> _loadProjects() async {
    final api = context.read<AppState>().api;
    var list = <Project>[];
    try {
      list = await api.projects();
    } catch (_) {}
    // 다른 EP4(peer)의 공유 프로젝트도 드롭다운에 포함 (실패해도 무시)
    try {
      final (remote, _) = await api.remoteProjects();
      list = [...list, ...remote];
    } catch (_) {}
    if (!mounted || list.isEmpty) return;
    // 현재 프로젝트가 목록에 없으면(삭제 등) 맨 앞에 유지
    if (!list.any((p) => _keyOf(p) == _keyOf(_project))) {
      list = [_project, ...list];
    }
    setState(() => _allProjects = list);
  }

  void _switchProject(String? key) {
    if (key == null || key == _keyOf(_project)) return;
    final p = _allProjects.where((e) => _keyOf(e) == key).firstOrNull;
    if (p == null) return;
    setState(() {
      _project = p;
      _loading = true;
      _tasks = [];
      _folders = [];
      _collapsed.clear();
      _selectedIds.clear();
      _selectionMode = false;
    });
    _load();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = _api;
      final results = await Future.wait([api.tasks(_pid), api.folders(_pid)]);
      if (!mounted) return;
      final list = results[0] as List<Task>;
      final fld = results[1] as List<Folder>;
      setState(() {
        _tasks = list;
        _folders = fld;
        _loading = false;
        _running = list.any((t) => t.status == 'running');
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  // ── 최상위 항목(언그룹 태스크 + 폴더)을 sort_order 통합 순서로 병합 ──
  List<Object> _topItems() {
    final ung = _tasks.where((t) => t.folderId == null).toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    final fld = [..._folders]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    // 레거시(폴더·태스크 sort_order 충돌)면 "태스크 먼저 → 폴더" 순서
    final tset = ung.map((t) => t.sortOrder).toSet();
    if (fld.any((f) => tset.contains(f.sortOrder))) {
      return [...ung, ...fld];
    }
    final items = <Object>[...ung, ...fld];
    items.sort((a, b) {
      final sa = a is Task ? a.sortOrder : (a as Folder).sortOrder;
      final sb = b is Task ? b.sortOrder : (b as Folder).sortOrder;
      if (sa != sb) return sa.compareTo(sb);
      return (a is Task ? 0 : 1).compareTo(b is Task ? 0 : 1); // 동률이면 태스크 먼저
    });
    return items;
  }

  List<Task> _tasksOf(int folderId) =>
      _tasks.where((t) => t.folderId == folderId).toList()
        ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

  bool _matchesFilter(Task t) => _filter == 'all' || t.status == _filter;

  List<Task> _visibleTasksOf(int folderId) =>
      _tasksOf(folderId).where(_matchesFilter).toList();

  // 필터가 적용된 최상위 표시 목록 (filter == all 이면 _topItems 와 동일)
  List<Object> _visibleTopItems() {
    final items = _topItems();
    if (_filter == 'all') return items;
    final out = <Object>[];
    for (final it in items) {
      if (it is Task) {
        if (_matchesFilter(it)) out.add(it);
      } else if (it is Folder) {
        if (_visibleTasksOf(it.id).isNotEmpty) out.add(it);
      }
    }
    return out;
  }

  // ── 최상위 재배치(폴더를 태스크 사이로 등): 통합 번호 부여 + 영속 ──
  void _onReorderTop(int oldIndex, int newIndex) {
    final items = _topItems();
    if (newIndex > oldIndex) newIndex -= 1;
    if (oldIndex < 0 || oldIndex >= items.length) return;
    final moved = items.removeAt(oldIndex);
    items.insert(newIndex.clamp(0, items.length), moved);
    _persistTop(items);
  }

  Future<void> _persistTop(List<Object> items) async {
    final fOrders = <Map<String, dynamic>>[];
    final tOrders = <Map<String, dynamic>>[];
    final newTasks = [..._tasks];
    final newFolders = <Folder>[];
    for (var i = 0; i < items.length; i++) {
      final so = (i + 1) * 10;
      final it = items[i];
      if (it is Folder) {
        fOrders.add({'id': it.id, 'sort_order': so});
        newFolders.add(it.copyWith(sortOrder: so));
      } else if (it is Task) {
        tOrders.add({'id': it.id, 'sort_order': so, 'folder_id': null});
        final idx = newTasks.indexWhere((t) => t.id == it.id);
        if (idx >= 0) newTasks[idx] = newTasks[idx].copyWith(sortOrder: so, clearFolder: true);
      }
    }
    setState(() {
      _tasks = newTasks;
      _folders = newFolders;
    });
    final api = _api;
    try {
      await api.reorderFolders(_pid, fOrders);
      if (tOrders.isNotEmpty) await api.reorderTasks(_pid, tOrders);
    } catch (_) {}
    _load();
  }

  // ── 폴더 펼치기/접기 ──
  void _toggleFolder(int fid) {
    setState(() {
      if (_collapsed.contains(fid)) {
        _collapsed.remove(fid);
      } else {
        _collapsed.add(fid);
      }
    });
  }

  void _toggleAllFolders() {
    setState(() {
      final anyCollapsed = _folders.any((f) => _collapsed.contains(f.id));
      if (anyCollapsed) {
        _collapsed.clear();
      } else {
        _collapsed.addAll(_folders.map((f) => f.id));
      }
    });
  }

  // ── 폴더 CRUD ──
  Future<String?> _promptText(String title, String label, {String initial = ''}) {
    final ctrl = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(labelText: label),
          onSubmitted: (v) => Navigator.pop(c, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(c, ctrl.text), child: const Text('확인')),
        ],
      ),
    );
  }

  Future<void> _createFolder() async {
    final name = await _promptText('새 폴더', '폴더 이름');
    if (name == null || name.trim().isEmpty || !mounted) return;
    await _api.createFolder(_pid, name.trim());
    _load();
    _toast('폴더 "${name.trim()}" 생성');
  }

  Future<void> _renameFolder(Folder f) async {
    final name = await _promptText('폴더 이름 변경', '폴더 이름', initial: f.name);
    if (name == null || name.trim().isEmpty || name.trim() == f.name || !mounted) return;
    await _api.renameFolder(_pid, f.id, name.trim());
    _load();
  }

  Future<void> _deleteFolder(Folder f) async {
    final cnt = _tasksOf(f.id).length;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('폴더 삭제'),
        content: Text('폴더 "${f.name}"를 삭제할까요?'
            '${cnt > 0 ? "\n포함된 태스크 $cnt개는 폴더에서 빠집니다." : ""}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('삭제'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await _api.deleteFolder(_pid, f.id);
    _load();
  }

  // ── 태스크 실행 로그 보기 ──
  void _openTaskRuns(Task t) {
    final api = _api; // 원격 프로젝트면 peer-proxy 라우팅 클라이언트 전달
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TaskRunsScreen(taskId: t.id, taskTitle: t.text, api: api),
      ),
    );
  }

  Future<void> _runAll() async {
    await _api.startProject(_pid);
    _toast('전체 실행 시작');
  }

  Future<void> _runSelected() async {
    final ids = _selectedIds.toList();
    await _api.runSelected(_pid, ids);
    setState(() { _selectedIds.clear(); _selectionMode = false; });
    _toast('${ids.length}개 태스크 실행');
  }

  Future<void> _deleteSelected() async {
    final ids = _selectedIds.toList();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('태스크 삭제'),
        content: Text('선택한 ${ids.length}개 태스크를 삭제할까요?\n삭제 후 복구할 수 없습니다.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('삭제'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await _api.bulkDeleteTasks(_pid, ids);
    } catch (e) {
      _toast('삭제 실패: $e');
      return;
    }
    setState(() { _selectedIds.clear(); _selectionMode = false; });
    _load();
    _toast('${ids.length}개 태스크 삭제');
  }

  void _exitSelection() {
    setState(() { _selectedIds.clear(); _selectionMode = false; });
  }

  void _toggleSelection(Task t) {
    setState(() {
      if (_selectedIds.contains(t.id)) {
        _selectedIds.remove(t.id);
      } else {
        _selectedIds.add(t.id);
      }
      if (_selectedIds.isEmpty) _selectionMode = false;
    });
  }

  void _enterSelection(Task t) {
    setState(() { _selectionMode = true; _selectedIds.add(t.id); });
  }

  Future<void> _stop() async {
    await _api.stopProject(_pid);
    _toast('중지 요청');
  }

  Future<void> _runTask(Task t) async {
    await _api.runTask(_pid, t.id);
    _toast('"${t.text}" 실행');
  }

  Future<void> _deleteTask(Task t) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('태스크 삭제'),
        content: Text('"${t.text}" 를 삭제할까요?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('삭제')),
        ],
      ),
    );
    if (ok == true && mounted) {
      try {
        await _api.deleteTask(_pid, t.id);
      } catch (e) {
        _toast('삭제 실패: $e');
        return;
      }
      _load();
    }
  }

  Future<void> _editTask([Task? t]) async {
    final api = _api;
    // 세션 옵션 드롭다운용 실행 중 세션 목록 (조회 실패 시 빈 목록)
    var sessionNames = <String>[];
    try {
      final list = await api.sessions();
      sessionNames = [
        for (final s in list)
          if ((s['status'] ?? '') == 'running' &&
              ((s['name'] ?? '') as String).isNotEmpty)
            (s['name'] ?? '') as String
      ];
    } catch (_) {}
    // 태스크 삭제 시 서버가 보존한 세션 정보(session_name·claude_session_id)가
    // 화면 진입 시점 스냅샷(_project)에 없으므로 최신 값을 다시 조회한다
    var projectSession = _project.sessionName;
    var claudeSessionId = (_project.raw['claude_session_id'] ?? '') as String;
    try {
      final fresh = (await api.projects()).where((p) => p.id == _pid).firstOrNull;
      if (fresh != null) {
        projectSession = fresh.sessionName;
        claudeSessionId = (fresh.raw['claude_session_id'] ?? '') as String;
      }
    } catch (_) {}
    // 이 프로젝트가 실행했던 Claude 세션 — 'claude:<id>' 로 이어서 실행
    var claudeSessions = <MapEntry<String, String>>[];
    try {
      claudeSessions = [
        for (final s in await api.claudeSessions(_pid))
          if (((s['session_id'] ?? '') as String).isNotEmpty)
            MapEntry(
              'claude:${s['session_id']}',
              ((s['title'] ?? '') as String).isNotEmpty
                  ? s['title'] as String
                  : '${(s['session_id'] as String).substring(0, 8)}…',
            )
      ];
    } catch (_) {}
    if (!mounted) return;
    final result = await showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _TaskEditor(
          task: t,
          sessionNames: sessionNames,
          projectSession: projectSession,
          claudeSessionId: claudeSessionId,
          claudeSessions: claudeSessions,
          defaultModel: _project.model,
          engine: (_project.raw['engine'] ?? 'claude') as String),
    );
    if (result == null || !mounted) return;
    try {
      final timeoutOv = int.tryParse(result['timeout'] ?? '') ?? 0;
      if (t == null) {
        await api.addTask(_pid,
            title: result['title']!,
            body: result['body']!,
            test: result['test']!,
            sessionOverride: result['session'] ?? '',
            timeoutOverride: timeoutOv,
            modelOverride: result['model'] ?? '');
      } else {
        await api.updateTask(_pid, t.id,
            title: result['title']!,
            body: result['body']!,
            test: result['test']!,
            sessionOverride: result['session'] ?? '',
            timeoutOverride: timeoutOv,
            modelOverride: result['model'] ?? '');
      }
    } catch (e) {
      _toast(t == null ? '추가 실패: $e' : '수정 실패: $e');
      return;
    }
    _load();
  }

  void _toast(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(m), duration: const Duration(seconds: 2)));
  }

  void _showOutput(Task t) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, ctrl) => Padding(
          padding: const EdgeInsets.all(16),
          child: ListView(
            controller: ctrl,
            children: [
              Text(t.text, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              SelectableText(
                t.output.isEmpty ? '(출력 없음)' : t.output,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasFolders = _folders.isNotEmpty;
    final allCollapsed = hasFolders && _folders.every((f) => _collapsed.contains(f.id));
    return Scaffold(
      appBar: _selectionMode
          ? AppBar(
              leading: IconButton(icon: const Icon(Icons.close), onPressed: _exitSelection),
              title: Text('${_selectedIds.length}개 선택'),
              actions: [
                IconButton(
                  icon: const Icon(Icons.play_circle),
                  tooltip: '선택 실행',
                  onPressed: _selectedIds.isEmpty ? null : _runSelected,
                ),
                IconButton(
                  icon: const Icon(Icons.delete, color: Colors.red),
                  tooltip: '선택 삭제',
                  onPressed: _selectedIds.isEmpty ? null : _deleteSelected,
                ),
              ],
            )
          : AppBar(
              title: _projectDropdown(),
              actions: [
                IconButton(
                  icon: const Icon(Icons.add),
                  tooltip: '태스크 추가',
                  onPressed: () => _editTask(),
                ),
                if (_tasks.isNotEmpty)
                  IconButton(
                    icon: const Icon(Icons.checklist),
                    tooltip: '선택 모드',
                    onPressed: () => setState(() => _selectionMode = true),
                  ),
                if (hasFolders)
                  IconButton(
                    icon: Icon(allCollapsed ? Icons.unfold_more : Icons.unfold_less),
                    tooltip: allCollapsed ? '폴더 전체 펼치기' : '폴더 전체 접기',
                    onPressed: _toggleAllFolders,
                  ),
                IconButton(
                  icon: const Icon(Icons.create_new_folder_outlined),
                  tooltip: '새 폴더',
                  onPressed: _createFolder,
                ),
                if (_running)
                  IconButton(icon: const Icon(Icons.pause_circle), tooltip: '중지', onPressed: _stop)
                else
                  IconButton(icon: const Icon(Icons.play_circle), tooltip: '실행', onPressed: _runAll),
              ],
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (_tasks.isNotEmpty) _filterBar(),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: (_tasks.isEmpty && _folders.isEmpty)
                        ? ListView(children: const [
                            SizedBox(height: 120),
                            Center(child: Text('태스크가 없습니다. 상단 + 버튼으로 추가하세요.')),
                          ])
                        : _buildList(),
                  ),
                ),
              ],
            ),
    );
  }

  // ── 앱바 프로젝트 전환 드롭다운 (다른 EP4 공유 프로젝트 포함) ──
  Widget _projectDropdown() {
    if (_allProjects.length <= 1) return Text(_project.name);
    final titleStyle = Theme.of(context).textTheme.titleLarge;
    return DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: _keyOf(_project),
        isDense: true,
        isExpanded: true,
        style: titleStyle,
        icon: const Icon(Icons.arrow_drop_down),
        dropdownColor: Theme.of(context).colorScheme.surface,
        onChanged: _switchProject,
        items: [
          for (final p in _allProjects)
            DropdownMenuItem(
              value: _keyOf(p),
              child: Row(children: [
                Dot(p.status),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                      p.remote
                          ? '🔗 ${p.name} · ${p.peerName.isNotEmpty ? p.peerName : p.host}'
                          : p.name,
                      overflow: TextOverflow.ellipsis),
                ),
                if (p.stats.total > 0)
                  Text('${p.stats.total}',
                      style: TextStyle(
                          fontSize: 12, color: Colors.grey.shade500)),
              ]),
            ),
        ],
      ),
    );
  }

  // ── 상태별 카운트 + 필터 바 ──
  Widget _filterBar() {
    int cnt(String s) =>
        s == 'all' ? _tasks.length : _tasks.where((t) => t.status == s).length;
    const order = ['all', 'running', 'pending', 'done', 'error'];
    const labels = {
      'all': '전체',
      'running': '실행 중',
      'pending': '대기',
      'done': '완료',
      'error': '실패',
    };
    const colors = {
      'running': Color(0xFF38BDF8),
      'pending': Color(0xFF94A3B8),
      'done': Color(0xFF4ADE80),
      'error': Color(0xFFF87171),
    };
    return SizedBox(
      height: 46,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        children: [
          for (final k in order)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                visualDensity: VisualDensity.compact,
                selected: _filter == k,
                onSelected: (_) => setState(() {
                  // 선택 모드에서 '전체' 탭 → 전체 선택/해제 토글
                  if (_selectionMode && k == 'all') {
                    if (_selectedIds.length == _tasks.length) {
                      _selectedIds.clear();
                    } else {
                      _selectedIds
                        ..clear()
                        ..addAll(_tasks.map((t) => t.id));
                    }
                  }
                  _filter = k;
                }),
                avatar: k == 'all'
                    ? null
                    : CircleAvatar(radius: 5, backgroundColor: colors[k]),
                label: Text('${labels[k]} ${cnt(k)}'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildList() {
    final items = _visibleTopItems();
    // 드래그 재배치는 필터가 '전체'일 때만 허용 (부분 목록 재배치는 순서가 어긋남)
    final canDrag = _filter == 'all';
    if (items.isEmpty) {
      return ListView(children: const [
        SizedBox(height: 120),
        Center(child: Text('해당 상태의 태스크가 없습니다.')),
      ]);
    }
    return ReorderableListView.builder(
      buildDefaultDragHandles: false,
      padding: const EdgeInsets.all(12),
      itemCount: items.length,
      onReorder: _onReorderTop,
      itemBuilder: (ctx, i) {
        final it = items[i];
        if (it is Folder) {
          return _folderCard(it, i, canDrag: canDrag, key: ValueKey('f${it.id}'));
        }
        return _topTaskCard(it as Task, i, canDrag: canDrag, key: ValueKey('t${it.id}'));
      },
    );
  }

  Widget _dragHandle(int index) => ReorderableDragStartListener(
        index: index,
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Icon(Icons.drag_indicator, color: Colors.grey),
        ),
      );

  Widget _folderCard(Folder f, int index, {required bool canDrag, required Key key}) {
    final children = _filter == 'all' ? _tasksOf(f.id) : _visibleTasksOf(f.id);
    final total = _tasksOf(f.id).length;
    final collapsed = _collapsed.contains(f.id);
    return Card(
      key: key,
      margin: const EdgeInsets.only(bottom: 8),
      color: Theme.of(context).colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
      child: Column(
        children: [
          ListTile(
            leading: Icon(collapsed ? Icons.chevron_right : Icons.expand_more),
            title: Row(children: [
              const Text('📁 '),
              Expanded(
                child: Text(f.name,
                    style: const TextStyle(fontWeight: FontWeight.bold),
                    overflow: TextOverflow.ellipsis),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(
                  color: Colors.grey.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('$total', style: const TextStyle(fontSize: 12)),
              ),
            ]),
            onTap: () => _toggleFolder(f.id),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.edit, size: 20),
                  tooltip: '이름 변경',
                  onPressed: () => _renameFolder(f),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, size: 20, color: Colors.redAccent),
                  tooltip: '폴더 삭제',
                  onPressed: () => _deleteFolder(f),
                ),
                if (canDrag && !_selectionMode) _dragHandle(index),
              ],
            ),
          ),
          if (!collapsed)
            ...children.map((t) => _taskTile(t, isChild: true)),
          if (!collapsed && children.isEmpty)
            const Padding(
              padding: EdgeInsets.only(left: 28, bottom: 10, top: 2),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('(비어 있음)', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _topTaskCard(Task t, int index, {required bool canDrag, required Key key}) {
    return Card(
      key: key,
      margin: const EdgeInsets.only(bottom: 8),
      child: _taskTile(t, dragIndex: canDrag ? index : null),
    );
  }

  Widget _taskTile(Task t, {bool isChild = false, int? dragIndex}) {
    final selected = _selectedIds.contains(t.id);
    return ListTile(
      contentPadding: isChild
          ? const EdgeInsets.only(left: 24, right: 4)
          : const EdgeInsets.only(left: 16, right: 4),
      tileColor: selected
          ? Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.3)
          : null,
      leading: _selectionMode
          ? Checkbox(value: selected, onChanged: (_) => _toggleSelection(t))
          : Dot(t.status),
      onLongPress: _selectionMode ? null : () => _enterSelection(t),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text(t.text, style: const TextStyle(fontWeight: FontWeight.w600))),
            if (t.author.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: Text('👤 ${t.author}',
                    style: TextStyle(fontSize: 11, color: Colors.grey.shade400)),
              ),
          ]),
          if (t.gitTaskBranch.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFF38BDF8).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('⎇ ${t.gitTaskBranch}',
                    style: const TextStyle(
                        fontSize: 10, color: Color(0xFF38BDF8), fontFamily: 'monospace')),
              ),
            ),
        ],
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(children: [
          StatusChip(t.status),
          if (t.output.isNotEmpty) ...[
            const SizedBox(width: 8),
            Expanded(
              child: Text(t.output.replaceAll('\n', ' '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
            ),
          ],
        ]),
      ),
      onTap: _selectionMode ? () => _toggleSelection(t) : () => _showOutput(t),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'run') _runTask(t);
              if (v == 'edit') _editTask(t);
              if (v == 'delete') _deleteTask(t);
              if (v == 'output') _showOutput(t);
              if (v == 'logs') _openTaskRuns(t);
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'run', child: Text('▷ 실행')),
              PopupMenuItem(value: 'output', child: Text('🗒 출력 보기')),
              PopupMenuItem(value: 'logs', child: Text('🧾 실행 로그')),
              PopupMenuItem(value: 'edit', child: Text('✎ 수정')),
              PopupMenuItem(value: 'delete', child: Text('✕ 삭제')),
            ],
          ),
          if (dragIndex != null && !_selectionMode) _dragHandle(dragIndex),
        ],
      ),
    );
  }
}

class _TaskEditor extends StatefulWidget {
  final Task? task;

  /// 실행 중 세션 이름 목록 — 세션 옵션 드롭다운 항목.
  final List<String> sessionNames;

  /// 프로젝트에 설정된 기본 세션 이름 — '기존 세션' 항목에 어떤 세션인지 표시.
  final String projectSession;

  /// 태스크 전체 삭제 시 보존된 마지막 Claude 세션 ID —
  /// 기본 세션이 비어 있을 때 '기존 세션' 항목에 이전 세션 기록으로 표시.
  final String claudeSessionId;

  /// 이 프로젝트가 실행했던 Claude 세션 — key: 'claude:<id>', value: 표시 이름.
  final List<MapEntry<String, String>> claudeSessions;

  /// 프로젝트 기본 모델·엔진 — 모델 드롭다운 기본 표시/옵션 구성용.
  final String defaultModel;
  final String engine;
  const _TaskEditor(
      {this.task,
      this.sessionNames = const [],
      this.projectSession = '',
      this.claudeSessionId = '',
      this.claudeSessions = const [],
      this.defaultModel = '',
      this.engine = 'claude'});

  @override
  State<_TaskEditor> createState() => _TaskEditorState();
}

class _TaskEditorState extends State<_TaskEditor> {
  late final TextEditingController _title =
      TextEditingController(text: widget.task?.text ?? '');
  late final TextEditingController _body =
      TextEditingController(text: widget.task?.body ?? '');
  late final TextEditingController _test =
      TextEditingController(text: widget.task?.test ?? '');

  // '' = 프로젝트 기본, '__prev__' = 이전 태스크 세션, '__new__' = 신규 세션,
  // 'claude:<id>' = 그 Claude 세션 이어서 실행, 그 외 = 대화형 세션 이름
  late String _session = widget.task?.sessionOverride ?? '';

  // '' = 프로젝트 기본 모델, 그 외 = 태스크별 model_override
  late String _model = widget.task?.modelOverride ?? '';
  late final TextEditingController _timeout = TextEditingController(
      text: (widget.task?.timeoutOverride ?? 0) > 0
          ? '${widget.task!.timeoutOverride}'
          : '');

  // '기존 세션' 항목 라벨 — 태스크 실행 용도 설명과 함께 프로젝트 기본 세션이
  // 무엇인지, 실행 중인지까지 표시. 기본 세션이 없어도 태스크 전체 삭제 시
  // 보존된 마지막 Claude 세션 기록이 있으면 함께 표시한다.
  String _defaultSessionLabel() {
    final ps = widget.projectSession;
    if (ps.isNotEmpty) {
      final alive = widget.sessionNames.contains(ps);
      return '기존 세션 (태스크 실행: $ps${alive ? '' : ' · 종료됨'})';
    }
    final cs = widget.claudeSessionId;
    if (cs.isNotEmpty) {
      final short = cs.length > 8 ? '${cs.substring(0, 8)}…' : cs;
      return '기존 세션 (태스크 실행 — 이전 세션 기록: $short)';
    }
    return '기존 세션 (태스크 실행 — 미설정, CLI 직접 실행)';
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.task != null;
    // 저장된 세션이 목록에 없으면(종료됨 등) 항목으로 유지해 값 오류를 막는다
    final names = [
      ...widget.sessionNames,
      if (_session.isNotEmpty &&
          _session != '__new__' &&
          _session != '__prev__' &&
          !_session.startsWith('claude:') &&
          !widget.sessionNames.contains(_session))
        _session,
    ];
    // 저장된 Claude 세션이 목록에 없으면(전사 삭제 등) 값 오류가 나므로 되살린다
    final claudeItems = [
      ...widget.claudeSessions,
      if (_session.startsWith('claude:') &&
          !widget.claudeSessions.any((e) => e.key == _session))
        MapEntry(_session,
            '${_session.substring(7).padRight(8).substring(0, 8).trim()}… (목록에 없음)'),
    ];
    // 키보드가 올라오면 남는 높이가 줄어 아래 필드(모델·타임아웃)가 잘리므로
    // 시트 내용 전체를 스크롤 가능하게 감싼다
    return SingleChildScrollView(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(isEdit ? '태스크 수정' : '태스크 추가',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 14),
          // 추가 시트는 제목 입력 없이 내용 첫 줄을 제목으로 쓴다 (수정 시트만 표시)
          if (isEdit) ...[
            TextField(controller: _title, decoration: const InputDecoration(labelText: '제목 (명령어 포함 가능)')),
            const SizedBox(height: 10),
          ],
          TextField(
              controller: _body,
              maxLines: isEdit ? 4 : 6,
              autofocus: !isEdit,
              decoration: InputDecoration(
                  labelText: isEdit
                      ? '상세 설명 (프롬프트)'
                      : '내용 (프롬프트 — 첫 줄이 제목으로 표시됩니다)')),
          const SizedBox(height: 10),
          TextField(controller: _test, decoration: const InputDecoration(labelText: '완료 판정 기준 (선택)')),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _session,
            decoration: const InputDecoration(labelText: '실행 세션'),
            items: [
              DropdownMenuItem(
                  value: '',
                  child: Text(_defaultSessionLabel(),
                      overflow: TextOverflow.ellipsis)),
              const DropdownMenuItem(
                  value: '__prev__', child: Text('이전 태스크 세션')),
              for (final c in claudeItems)
                DropdownMenuItem(
                    value: c.key,
                    child: Text('이어서: ${c.value}',
                        overflow: TextOverflow.ellipsis)),
              for (final n in names)
                DropdownMenuItem(
                    value: n,
                    child: Text(
                        widget.sessionNames.contains(n) ? '세션: $n' : '세션: $n (종료됨)',
                        overflow: TextOverflow.ellipsis)),
              const DropdownMenuItem(value: '__new__', child: Text('신규 세션 생성')),
            ],
            onChanged: (v) => setState(() => _session = v ?? ''),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _model,
            decoration: const InputDecoration(labelText: '모델'),
            items: [
              DropdownMenuItem(
                  value: '',
                  child: Text('프로젝트 기본 (${modelLabel(widget.defaultModel)})',
                      overflow: TextOverflow.ellipsis)),
              // 현재 저장된 override 가 목록에 없으면 항목으로 유지
              if (_model.isNotEmpty &&
                  !modelsFor(widget.engine).containsKey(_model))
                DropdownMenuItem(value: _model, child: Text(modelLabel(_model))),
              for (final e in modelsFor(widget.engine).entries)
                if (e.key.isNotEmpty)
                  DropdownMenuItem(value: e.key, child: Text(e.value)),
            ],
            onChanged: (v) => setState(() => _model = v ?? ''),
          ),
          const SizedBox(height: 10),
          TextField(
              controller: _timeout,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                  labelText: '타임아웃(초) — 비우면 프로젝트 기본값')),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () {
              final bodyText = _body.text.trim();
              // 추가: 내용 첫 줄을 제목으로 자동 사용 / 수정: 입력된 제목 유지
              final title = isEdit
                  ? _title.text.trim()
                  : bodyText
                      .split('\n')
                      .map((l) => l.trim())
                      .firstWhere((l) => l.isNotEmpty, orElse: () => '');
              if (title.isEmpty) return;
              Navigator.pop(context, {
                'title': title.length > 100 ? title.substring(0, 100) : title,
                'body': bodyText,
                'test': _test.text.trim(),
                'session': _session,
                'timeout': '${int.tryParse(_timeout.text.trim()) ?? 0}',
                'model': _model,
              });
            },
            child: Text(isEdit ? '저장' : '추가'),
          ),
        ],
      ),
    );
  }
}
