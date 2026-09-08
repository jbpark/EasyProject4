import 'dart:convert';
import 'package:http/http.dart' as http;

import '../models/project.dart';
import '../models/task.dart';
import '../models/folder.dart';
import '../models/run_log.dart';

/// 모든 요청에 인증 토큰(Bearer)을 자동 주입하는 http.Client 래퍼.
class _AuthClient extends http.BaseClient {
  final http.Client _inner;
  final String? token;
  _AuthClient(this._inner, this.token);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (token != null && token!.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    return _inner.send(request);
  }

  @override
  void close() => _inner.close();
}

/// EP4 서버(REST) 클라이언트. baseUrl 은 Cloudflare Tunnel HTTPS 주소.
/// peerUrl 이 설정되면 모든 요청을 연결된 서버의 peer-proxy 를 통해
/// 다른 EP4(원격 프로젝트)로 투명하게 라우팅한다.
class ApiClient {
  final String baseUrl;
  final String? token;
  final String? peerUrl;
  final http.Client _http;

  ApiClient(this.baseUrl, {this.token, this.peerUrl, http.Client? client})
      : _http = _AuthClient(client ?? http.Client(), token);

  /// 이 클라이언트와 같은 연결로 다른 EP4(peer) 프로젝트에 접근하는 클라이언트.
  ApiClient forPeer(String peer) => ApiClient(baseUrl, token: token, peerUrl: peer);

  Uri _u(String path) => (peerUrl == null || peerUrl!.isEmpty)
      ? Uri.parse('$baseUrl$path')
      : Uri.parse('$baseUrl/api/peer-proxy'
          '?url=${Uri.encodeQueryComponent(peerUrl!)}'
          '&path=${Uri.encodeQueryComponent(path)}');

  Map<String, String> get _jsonHeaders => {'Content-Type': 'application/json'};

  // ── 연결 확인 ──
  Future<bool> ping() async {
    try {
      final r = await _http
          .get(_u('/api/ping'))
          .timeout(const Duration(seconds: 10));
      return r.statusCode == 200;
    } catch (_) {
      try {
        final r = await _http
            .get(_u('/api/projects'))
            .timeout(const Duration(seconds: 10));
        return r.statusCode == 200;
      } catch (_) {
        return false;
      }
    }
  }

  /// 접속 현황 (내 접속·수신 연결·발신 peer 연결). /api/connections 응답 그대로.
  Future<Map<String, dynamic>> connections() async {
    final r = await _http.get(_u('/api/connections'));
    return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
  }

  /// 접속 히스토리 (연결 종료·서버 재시작 후에도 보존).
  Future<List<dynamic>> connectionsHistory({int limit = 50}) async {
    final r = await _http.get(_u('/api/connections/history?limit=$limit'));
    final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    return (j['history'] ?? []) as List;
  }

  // ── 프로젝트 ──
  Future<List<Project>> projects() async {
    final r = await _http.get(_u('/api/projects'));
    final data = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return data.map((e) => Project.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// 연결된 다른 EP4(peer)의 공유 프로젝트 집계.
  /// 반환: (projects, errors) — errors 는 조회 실패한 peer 의 사유 목록.
  Future<(List<Project>, List<String>)> remoteProjects() async {
    final r = await _http
        .get(_u('/api/remote-projects'))
        .timeout(const Duration(seconds: 20));
    final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    final projs = ((j['projects'] ?? []) as List)
        .map((e) => Project.fromJson(e as Map<String, dynamic>))
        .toList();
    final errs = ((j['errors'] ?? []) as List)
        .map((e) => '${e['peer_name'] ?? e['peer_url']}: ${e['error']}')
        .toList()
        .cast<String>();
    return (projs, errs);
  }

  Future<void> createProject(String name,
          {String description = '', Map<String, dynamic>? extra}) =>
      _post('/api/projects',
          {'name': name, 'description': description, ...?extra});

  /// /update 는 전체 필드를 덮어쓰므로 body 에 Project.raw 기반 전체 필드를 담아 보낸다.
  Future<void> updateProject(int pid, Map<String, dynamic> body) =>
      _post('/api/projects/$pid/update', body);

  Future<void> deleteProject(int pid) =>
      _post('/api/projects/$pid/delete', {});

  Future<void> startProject(int pid, {bool resetAll = false}) =>
      _post('/api/projects/$pid/start', {'reset_all': resetAll});

  Future<void> openProjectFolder(int pid) =>
      _post('/api/projects/$pid/open-folder', {});

  Future<String> claudeMd(int pid) async {
    final r = await _http.get(_u('/api/projects/$pid/claude-md'));
    final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    return (j['content'] ?? '') as String;
  }

  /// 서버에 빌드된 모바일 APK 정보. {exists, name, size, mtime}
  Future<Map<String, dynamic>> apkInfo() async {
    final r = await _http.get(_u('/api/apk-info'));
    return _decodeMap(r);
  }

  Future<void> stopProject(int pid) => _post('/api/projects/$pid/stop', {});

  Future<void> resetProject(int pid) => _post('/api/projects/$pid/reset', {});

  // ── 태스크 ──
  Future<List<Task>> tasks(int pid) async {
    final r = await _http.get(_u('/api/projects/$pid/tasks'));
    final data = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return data.map((e) => Task.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> addTask(int pid,
          {required String title,
          String body = '',
          String test = '',
          String sessionOverride = '',
          int timeoutOverride = 0,
          String modelOverride = ''}) =>
      _post('/api/projects/$pid/tasks', {
        'title': title,
        'body': body,
        'test': test,
        'session_override': sessionOverride,
        'timeout_override': timeoutOverride,
        'model_override': modelOverride,
      });

  Future<void> updateTask(int pid, int tid,
          {required String title,
          String body = '',
          String test = '',
          String sessionOverride = '',
          int timeoutOverride = 0,
          String modelOverride = ''}) =>
      _post('/api/projects/$pid/tasks/$tid/update', {
        'title': title,
        'body': body,
        'test': test,
        'session_override': sessionOverride,
        'timeout_override': timeoutOverride,
        'model_override': modelOverride,
      });

  Future<void> deleteTask(int pid, int tid) =>
      _post('/api/projects/$pid/tasks/$tid/delete', {});

  Future<void> runTask(int pid, int tid) =>
      _post('/api/projects/$pid/tasks/$tid/run', {});

  Future<void> runSelected(int pid, List<int> ids) =>
      _post('/api/projects/$pid/run-selected', {'task_ids': ids});

  Future<void> bulkDeleteTasks(int pid, List<int> ids) =>
      _post('/api/projects/$pid/tasks/bulk-delete', {'task_ids': ids});

  // ── 폴더 ──
  Future<List<Folder>> folders(int pid) async {
    final r = await _http.get(_u('/api/projects/$pid/folders'));
    final data = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return data.map((e) => Folder.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> createFolder(int pid, String name) =>
      _post('/api/projects/$pid/folders', {'name': name});

  Future<void> renameFolder(int pid, int fid, String name) =>
      _post('/api/projects/$pid/folders/$fid/rename', {'name': name});

  Future<void> deleteFolder(int pid, int fid) async {
    await _http.delete(_u('/api/projects/$pid/folders/$fid'));
  }

  /// orders: [{id, sort_order}]
  Future<void> reorderFolders(int pid, List<Map<String, dynamic>> orders) =>
      _post('/api/projects/$pid/folders/reorder', {'orders': orders});

  /// orders: [{id, sort_order, folder_id}]
  Future<void> reorderTasks(int pid, List<Map<String, dynamic>> orders) =>
      _post('/api/projects/$pid/tasks/reorder', {'orders': orders});

  /// folderId == null → 폴더에서 빼내 최상위(언그룹)로 이동
  Future<void> moveTask(int pid, int tid, int? folderId) =>
      _post('/api/projects/$pid/tasks/$tid/move', {'folder_id': folderId});

  // ── 세션 ──
  /// 실행 중/종료된 대화형 세션 목록. 각 항목: {id, name, status, ...}
  /// (peer 프로젝트는 push 캐시로 응답될 수 있음)
  Future<List<Map<String, dynamic>>> sessions() async {
    final r = await _http.get(_u('/api/sessions'));
    final data = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return data.cast<Map<String, dynamic>>();
  }

  /// 이 프로젝트가 실행했던 Claude CLI 세션(전사) 목록.
  /// 각 항목: {session_id, title, last_ts, ...} — 태스크 세션 '이어서 실행'용.
  Future<List<Map<String, dynamic>>> claudeSessions(int pid) async {
    final r = await _http.get(_u('/api/projects/$pid/claude-sessions'));
    final data = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return data.cast<Map<String, dynamic>>();
  }

  // ── 실행 로그 ──
  Future<List<RunLog>> runs(
      {int? projectId, int? taskId, String? status, bool today = false}) async {
    final params = <String, String>{};
    if (projectId != null) params['project_id'] = '$projectId';
    if (taskId != null) params['task_id'] = '$taskId';
    if (status != null && status.isNotEmpty) params['status'] = status;
    if (today) params['date'] = 'today';
    // 쿼리를 path 에 직접 붙인다 — peer-proxy 라우팅 시에도 원격 경로에 포함되도록.
    final qs = params.isEmpty
        ? ''
        : '?${params.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&')}';
    final r = await _http.get(_u('/api/runs$qs'));
    final data = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return data.map((e) => RunLog.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<RunDetail> runDetail(int rid) async {
    final r = await _http.get(_u('/api/runs/$rid'));
    return RunDetail.fromJson(jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>);
  }

  /// 실행의 Git 변경 내용(통합 diff 텍스트). 변경이 없으면 빈 문자열.
  Future<String> gitPatch(int rid) async {
    try {
      final r = await _http.get(_u('/api/runs/$rid/git-patch'));
      final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
      return (j['patch'] ?? '') as String;
    } catch (_) {
      return '';
    }
  }

  // ── 확장(Extensions) > Claude ─────────────────────────────────────────
  // 웹 대시보드(dist/plugins/plugins/view.js)의 마켓 로직을 네이티브로 포팅.
  // 서버 응답(Map/List)을 그대로 돌려주고 화면에서 파싱한다.

  /// 설치됨: 글로벌 + 각 프로젝트의 Claude Skill.
  Future<List<dynamic>> claudeSkills() => _getList('/api/claude/skills', 'skills');

  /// 설치됨: 글로벌 + 각 프로젝트의 서브 에이전트.
  Future<List<dynamic>> claudeAgents() => _getList('/api/claude/agents', 'agents');

  /// 설치됨: 글로벌 + 각 프로젝트의 슬래시 커맨드.
  Future<List<dynamic>> claudeCommands() =>
      _getList('/api/claude/commands', 'commands');

  /// 설치됨: 글로벌 + 각 프로젝트 + peer 공유 CLAUDE.md 목록.
  Future<List<dynamic>> claudeMdList() => _getList('/api/claude/md', 'items');

  /// SKILL.md 내용.
  Future<String> claudeSkillView(String id,
          {String scope = 'global', dynamic projectId}) =>
      _getContent('/api/claude/skills/view'
          '?id=${_q(id)}&scope=${_q(scope)}&project_id=${_q(projectId)}');

  /// 서브 에이전트 .md 내용.
  Future<String> claudeAgentView(String rel,
          {String scope = 'global', dynamic projectId}) =>
      _getContent('/api/claude/agents/view'
          '?rel=${_q(rel)}&scope=${_q(scope)}&project_id=${_q(projectId)}');

  /// 슬래시 커맨드 .md 내용.
  Future<String> claudeCommandView(String rel,
          {String scope = 'global', dynamic projectId}) =>
      _getContent('/api/claude/commands/view'
          '?rel=${_q(rel)}&scope=${_q(scope)}&project_id=${_q(projectId)}');

  /// 글로벌 ~/.claude/CLAUDE.md 내용.
  Future<String> claudeMdGlobal() => _getContent('/api/claude/md/global');

  // ── 마켓(Firebase) 등록 목록 — no_source 면 빈 목록 ──
  Future<(List<dynamic>, bool)> marketRegSkills() =>
      _getListNoSource('/api/marketplace/skills/registered', 'skills');
  Future<(List<dynamic>, bool)> marketRegAgents() =>
      _getListNoSource('/api/marketplace/agents/registered', 'agents');
  Future<(List<dynamic>, bool)> marketCommands() =>
      _getListNoSource('/api/marketplace/commands', 'commands');

  /// 외부 GitHub 저장소의 Claude Skill 목록.
  Future<List<dynamic>> marketGithubSkills() =>
      _getList('/api/marketplace/skills', 'skills');

  // ── 마켓 등록/설치/삭제 (POST) — 서버 응답 Map 그대로 반환 ──
  Future<Map<String, dynamic>> registerSkill(String id,
          {String scope = 'global', dynamic projectId, bool overwrite = false}) =>
      _postJson('/api/claude/skills/register',
          {'id': id, 'scope': scope, 'project_id': projectId, 'overwrite': overwrite});

  Future<Map<String, dynamic>> registerSkillManual(String id, String content,
          {bool overwrite = false}) =>
      _postJson('/api/claude/skills/register-manual',
          {'id': id, 'content': content, 'overwrite': overwrite});

  Future<Map<String, dynamic>> installMarketSkill(String id, String content,
          {String scope = 'global', dynamic projectId}) =>
      _postJson('/api/claude/skills/install-market',
          {'id': id, 'content': content, 'scope': scope, 'project_id': projectId});

  Future<Map<String, dynamic>> installGithubSkill(String repo, String id,
          {String scope = 'global', dynamic projectId, bool overwrite = false}) =>
      _postJson('/api/claude/skills/install', {
        'repo': repo, 'id': id, 'scope': scope,
        'project_id': projectId, 'overwrite': overwrite,
      });

  Future<Map<String, dynamic>> unregisterSkill(String id) =>
      _postJson('/api/claude/skills/unregister', {'id': id});

  Future<Map<String, dynamic>> deleteSkill(String id,
      {String scope = 'global', dynamic projectId}) async {
    final r = await _http.delete(_u('/api/claude/skills/${_q(id)}'
        '?scope=${_q(scope)}&project_id=${_q(projectId)}'));
    return _decodeMap(r);
  }

  Future<Map<String, dynamic>> registerAgent(String id,
          {String scope = 'global', dynamic projectId, bool overwrite = false}) =>
      _postJson('/api/claude/agents/register',
          {'id': id, 'scope': scope, 'project_id': projectId, 'overwrite': overwrite});

  Future<Map<String, dynamic>> registerAgentManual(String id, String content,
          {bool overwrite = false}) =>
      _postJson('/api/claude/agents/register-manual',
          {'id': id, 'content': content, 'overwrite': overwrite});

  Future<Map<String, dynamic>> installMarketAgent(String id, String rel,
          String content, {String scope = 'global', dynamic projectId}) =>
      _postJson('/api/claude/agents/install-market', {
        'id': id, 'rel': rel, 'content': content,
        'scope': scope, 'project_id': projectId,
      });

  Future<Map<String, dynamic>> unregisterAgent(String id) =>
      _postJson('/api/claude/agents/unregister', {'id': id});

  Future<Map<String, dynamic>> deleteAgent(String rel,
      {String scope = 'global', dynamic projectId}) async {
    final r = await _http.delete(_u('/api/claude/agents'
        '?rel=${_q(rel)}&scope=${_q(scope)}&project_id=${_q(projectId)}'));
    return _decodeMap(r);
  }

  Future<Map<String, dynamic>> registerCommand(String rel,
          {String scope = 'global', dynamic projectId, bool overwrite = false}) =>
      _postJson('/api/claude/commands/register',
          {'rel': rel, 'scope': scope, 'project_id': projectId, 'overwrite': overwrite});

  Future<Map<String, dynamic>> registerCommandManual(String id, String content,
          {bool overwrite = false}) =>
      _postJson('/api/claude/commands/register-manual',
          {'id': id, 'content': content, 'overwrite': overwrite});

  Future<Map<String, dynamic>> installMarketCommand(String rel, String content,
          {String scope = 'global', dynamic projectId}) =>
      _postJson('/api/claude/commands/install',
          {'rel': rel, 'content': content, 'scope': scope, 'project_id': projectId});

  Future<Map<String, dynamic>> unregisterCommand(String id) =>
      _postJson('/api/claude/commands/unregister', {'id': id});

  Future<Map<String, dynamic>> deleteCommand(String rel,
          {String scope = 'global', dynamic projectId}) =>
      _postJson('/api/claude/commands/delete',
          {'rel': rel, 'scope': scope, 'project_id': projectId});

  Future<Map<String, dynamic>> installClaudeMd(
          String scope, String name, String content) =>
      _postJson('/api/claude/md/install',
          {'scope': scope, 'name': name, 'content': content});

  // ── 내부 ──
  String _q(dynamic v) => Uri.encodeQueryComponent('${v ?? ''}');

  Future<List<dynamic>> _getList(String path, String key) async {
    final r = await _http.get(_u(path));
    final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    return (j[key] ?? []) as List;
  }

  /// (목록, noSource) — Firebase 마켓 소스 미설정 시 noSource=true.
  Future<(List<dynamic>, bool)> _getListNoSource(String path, String key) async {
    final r = await _http.get(_u(path));
    final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    return ((j[key] ?? []) as List, j['no_source'] == true);
  }

  Future<String> _getContent(String path) async {
    final r = await _http.get(_u(path));
    final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    if (j['ok'] == true) return (j['content'] ?? '') as String;
    throw Exception((j['error'] ?? '불러오기 실패') as String);
  }

  Future<Map<String, dynamic>> _postJson(
      String path, Map<String, dynamic> body) async {
    final r =
        await _http.post(_u(path), headers: _jsonHeaders, body: jsonEncode(body));
    return _decodeMap(r);
  }

  Map<String, dynamic> _decodeMap(http.Response r) {
    try {
      return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      return {'ok': false, 'error': 'HTTP ${r.statusCode}'};
    }
  }

  Future<void> _post(String path, Map<String, dynamic> body) async {
    final r =
        await _http.post(_u(path), headers: _jsonHeaders, body: jsonEncode(body));
    if (r.statusCode >= 400) {
      // peer-proxy 502(원격 EP4 도달 불가) 등 — 조용히 삼키면 삭제/수정이
      // 되지 않은 것처럼 보이므로 예외로 올려 화면에서 알린다.
      String msg = 'HTTP ${r.statusCode}';
      try {
        final j = jsonDecode(utf8.decode(r.bodyBytes));
        final detail = (j is Map) ? (j['error'] ?? j['msg']) : null;
        if (detail != null && '$detail'.isNotEmpty) msg = '$detail';
      } catch (_) {}
      throw Exception(msg);
    }
  }

  void close() => _http.close();
}
