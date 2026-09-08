import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/sse_client.dart';
import '../models/project.dart';
import '../state/app_state.dart';

/// 확장 > Claude 마켓의 네이티브 포팅.
/// 웹 대시보드(dist/plugins/plugins/view.js)의 Skill·Agent·Command·CLAUDE.md
/// 설치/등록/삭제/수동등록/위치선택 흐름을 Flutter 로 옮긴 화면.
class ExtensionsScreen extends StatefulWidget {
  const ExtensionsScreen({super.key});

  @override
  State<ExtensionsScreen> createState() => _ExtensionsScreenState();
}

/// Skill·Agent·Command 는 마켓 등록/설치/삭제/수동등록 구조가 대칭이라
/// 하나의 종류(kind)로 추상화한다. CLAUDE.md 는 구조가 달라 별도 처리.
enum ClaudeKind { skill, agent, command, md }

extension _KindMeta on ClaudeKind {
  String get label => switch (this) {
        ClaudeKind.skill => 'Skill',
        ClaudeKind.agent => 'Agent',
        ClaudeKind.command => 'Command',
        ClaudeKind.md => 'CLAUDE.md',
      };
  String get icon => switch (this) {
        ClaudeKind.skill => '✦',
        ClaudeKind.agent => '🤖',
        ClaudeKind.command => '⌨',
        ClaudeKind.md => '📄',
      };
  Color get color => switch (this) {
        ClaudeKind.skill => const Color(0xFF9C27B0),
        ClaudeKind.agent => const Color(0xFF5C6BC0),
        ClaudeKind.command => const Color(0xFFEC407A),
        ClaudeKind.md => const Color(0xFF26A69A),
      };
  /// 글로벌 설치 경로 표기 (위치 선택 라벨용)
  String get globalPath => switch (this) {
        ClaudeKind.skill => '~/.claude/skills',
        ClaudeKind.agent => '~/.claude/agents',
        ClaudeKind.command => '~/.claude/commands',
        ClaudeKind.md => '~/.claude',
      };
  String get projectSub => switch (this) {
        ClaudeKind.skill => '.claude\\skills',
        ClaudeKind.agent => '.claude\\agents',
        ClaudeKind.command => '.claude\\commands',
        ClaudeKind.md => '',
      };
}

class _ExtensionsScreenState extends State<ExtensionsScreen> {
  bool _market = false; // false=설치됨, true=마켓
  ClaudeKind _sub = ClaudeKind.skill;

  bool _loading = true;
  String? _error;
  StreamSubscription<SseEvent>? _sseSub;

  // 설치됨
  List<dynamic> _skills = [];
  List<dynamic> _agents = [];
  List<dynamic> _commands = [];
  List<dynamic> _mds = []; // 로컬 + peer(remote) 모두 포함

  // 마켓(Firebase 등록분)
  List<dynamic> _regSkills = [];
  List<dynamic> _regAgents = [];
  List<dynamic> _marketCommands = [];
  bool _regSkillsNoSrc = false;
  bool _regAgentsNoSrc = false;
  bool _cmdsNoSrc = false;
  List<dynamic> _githubSkills = []; // 외부 GitHub 저장소 스킬

  ApiClient get _api => context.read<AppState>().api;

  @override
  void initState() {
    super.initState();
    _loadAll();
    _sseSub = context.read<AppState>().events?.listen((e) {
      if (e.event == 'plugins_changed') _loadAll();
    });
  }

  @override
  void dispose() {
    _sseSub?.cancel();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.claudeSkills(),
        _api.claudeAgents(),
        _api.claudeCommands(),
        _api.claudeMdList(),
        _api.marketRegSkills(),
        _api.marketRegAgents(),
        _api.marketCommands(),
        _api.marketGithubSkills().catchError((_) => <dynamic>[]),
      ]);
      if (!mounted) return;
      final (rs, rsNo) = results[4] as (List<dynamic>, bool);
      final (ra, raNo) = results[5] as (List<dynamic>, bool);
      final (mc, mcNo) = results[6] as (List<dynamic>, bool);
      setState(() {
        _skills = results[0] as List;
        _agents = results[1] as List;
        _commands = results[2] as List;
        _mds = results[3] as List;
        _regSkills = rs;
        _regSkillsNoSrc = rsNo;
        _regAgents = ra;
        _regAgentsNoSrc = raNo;
        _marketCommands = mc;
        _cmdsNoSrc = mcNo;
        _githubSkills = results[7] as List;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$e';
      });
    }
  }

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? Colors.red.shade700 : null,
      behavior: SnackBarBehavior.floating,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('설치됨'), icon: Icon(Icons.inventory_2_outlined)),
              ButtonSegment(value: true, label: Text('마켓'), icon: Icon(Icons.storefront_outlined)),
            ],
            selected: {_market},
            onSelectionChanged: (s) => setState(() => _market = s.first),
          ),
        ),
        _subChips(),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _subChips() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: ClaudeKind.values.map((k) {
          // 마켓 탭에서 CLAUDE.md 는 peer 공유분으로 표시 (등록 개념 없음)
          final selected = _sub == k;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              label: Text('${k.icon} ${k.label}'),
              selected: selected,
              onSelected: (_) => setState(() => _sub = k),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return _centered('불러오기 실패\n$_error', action: _loadAll);
    }
    return RefreshIndicator(
      onRefresh: _loadAll,
      child: _market ? _marketList() : _installedList(),
    );
  }

  // ── 설치됨 ──────────────────────────────────────────────
  Widget _installedList() {
    switch (_sub) {
      case ClaudeKind.skill:
        return _cards(_skills, (s) => _installedTile(ClaudeKind.skill, s));
      case ClaudeKind.agent:
        return _cards(_agents, (a) => _installedTile(ClaudeKind.agent, a));
      case ClaudeKind.command:
        return _cards(_commands, (c) => _installedTile(ClaudeKind.command, c));
      case ClaudeKind.md:
        final local = _mds.where((m) => m['remote'] != true).toList();
        return _cards(local, (m) => _mdTile(m, installed: true));
    }
  }

  Widget _installedTile(ClaudeKind kind, Map item) {
    final scope = (item['scope'] ?? 'global') as String;
    final scopeLabel = scope == 'project'
        ? '📁 ${item['project_name'] ?? 'Project'}'
        : '🌐 Global';
    final title = kind == ClaudeKind.command
        ? '/${item['id'] ?? item['name']}'
        : (item['name'] ?? item['id']) as String;
    return _card(
      kind: kind,
      title: title,
      subtitle: scopeLabel,
      desc: (item['description'] ?? '') as String,
      onTap: () => _showInstalledDetail(kind, item),
    );
  }

  Widget _mdTile(Map m, {required bool installed}) {
    final scope = (m['scope'] ?? '') as String;
    final base = scope == 'global'
        ? '🌐 Global'
        : ((m['projects'] as List?)?.map((p) => p['name']).join(', ') ??
            m['name'] ??
            'Project');
    final title = m['remote'] == true
        ? '$base @ ${m['peer_name'] ?? m['peer_url']}'
        : '$base';
    return _card(
      kind: ClaudeKind.md,
      title: title,
      subtitle: (m['path'] ?? '') as String,
      desc: '',
      onTap: () => installed ? _showMdInstalledDetail(m) : _showMdMarketDetail(m),
    );
  }

  // ── 마켓 ────────────────────────────────────────────────
  Widget _marketList() {
    switch (_sub) {
      case ClaudeKind.skill:
        if (_regSkillsNoSrc && _githubSkills.isEmpty) return _noSource();
        return ListView(children: [
          _sectionHeader('✦ Skill (마켓)', () => _showManualRegister(ClaudeKind.skill)),
          ..._regSkills.map((s) => _marketRegTile(ClaudeKind.skill, s)),
          if (_regSkills.isEmpty)
            _emptyRow("마켓에 등록된 스킬이 없습니다."),
          if (_githubSkills.isNotEmpty) ...[
            _sectionHeader('✦ Claude Skill (외부 저장소)', null),
            ..._githubSkills.map(_githubSkillTile),
          ],
        ]);
      case ClaudeKind.agent:
        if (_regAgentsNoSrc) return _noSource();
        return ListView(children: [
          _sectionHeader('🤖 Agent (마켓)', () => _showManualRegister(ClaudeKind.agent)),
          ..._regAgents.map((a) => _marketRegTile(ClaudeKind.agent, a)),
          if (_regAgents.isEmpty) _emptyRow("마켓에 등록된 서브 에이전트가 없습니다."),
        ]);
      case ClaudeKind.command:
        if (_cmdsNoSrc) return _noSource();
        return ListView(children: [
          _sectionHeader('⌨ Command (마켓)', () => _showManualRegister(ClaudeKind.command)),
          ..._marketCommands.map((c) => _marketRegTile(ClaudeKind.command, c)),
          if (_marketCommands.isEmpty) _emptyRow("마켓에 등록된 커맨드가 없습니다."),
        ]);
      case ClaudeKind.md:
        final remote = _mds.where((m) => m['remote'] == true).toList();
        return _cards(remote, (m) => _mdTile(m, installed: false),
            emptyMsg: '연결된 peer EP4 가 공유한 CLAUDE.md 가 없습니다.');
    }
  }

  Widget _marketRegTile(ClaudeKind kind, Map item) {
    final title = kind == ClaudeKind.command
        ? '/${item['id'] ?? ''}'
        : (item['name'] ?? item['id']) as String;
    final host = (item['host'] ?? '') as String;
    return _card(
      kind: kind,
      title: title,
      subtitle: host.isEmpty ? '' : '@ $host',
      desc: (item['description'] ?? '') as String,
      onTap: () => _showMarketDetail(kind, item),
    );
  }

  Widget _githubSkillTile(dynamic s) {
    final installed = _skills.any((x) => x['id'] == s['id']);
    return _card(
      kind: ClaudeKind.skill,
      title: (s['name'] ?? s['id']) as String,
      subtitle: (s['repo'] ?? '') as String,
      desc: (s['description'] ?? '') as String,
      trailing: installed
          ? const Text('설치됨', style: TextStyle(fontSize: 12, color: Colors.green))
          : TextButton(
              onPressed: () => _installGithubSkill(s),
              child: const Text('설치')),
      onTap: () => _installGithubSkill(s),
    );
  }

  // ── 상세: 설치됨 (내용 보기 + 마켓 등록 + 삭제) ──────────
  Future<void> _showInstalledDetail(ClaudeKind kind, Map item) async {
    String content = '불러오는 중...';
    final sheet = await _openContentSheet(
      kind: kind,
      title: (kind == ClaudeKind.command)
          ? '/${item['id'] ?? item['name']}'
          : (item['name'] ?? item['id']) as String,
      subtitle: (item['path'] ?? '') as String,
      contentFuture: _fetchInstalledContent(kind, item),
      actions: (ctx, setSheet) => [
        FilledButton.tonalIcon(
          icon: const Icon(Icons.cloud_upload_outlined, size: 18),
          label: const Text('마켓에 등록'),
          onPressed: () async {
            Navigator.pop(ctx);
            await _registerToMarket(kind, item);
          },
        ),
        OutlinedButton.icon(
          icon: const Icon(Icons.delete_outline, size: 18),
          style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
          label: const Text('삭제'),
          onPressed: () async {
            Navigator.pop(ctx);
            await _deleteInstalled(kind, item);
          },
        ),
      ],
    );
    content = sheet ?? content;
  }

  Future<String> _fetchInstalledContent(ClaudeKind kind, Map item) {
    final scope = (item['scope'] ?? 'global') as String;
    final pid = item['project_id'];
    switch (kind) {
      case ClaudeKind.skill:
        return _api.claudeSkillView(item['id'] as String, scope: scope, projectId: pid);
      case ClaudeKind.agent:
        return _api.claudeAgentView(item['rel'] as String, scope: scope, projectId: pid);
      case ClaudeKind.command:
        return _api.claudeCommandView(item['rel'] as String, scope: scope, projectId: pid);
      case ClaudeKind.md:
        return Future.value('');
    }
  }

  Future<void> _registerToMarket(ClaudeKind kind, Map item, {bool overwrite = false}) async {
    try {
      final scope = (item['scope'] ?? 'global') as String;
      final pid = item['project_id'];
      Map<String, dynamic> res;
      switch (kind) {
        case ClaudeKind.skill:
          res = await _api.registerSkill(item['id'] as String,
              scope: scope, projectId: pid, overwrite: overwrite);
          break;
        case ClaudeKind.agent:
          res = await _api.registerAgent(item['id'] as String,
              scope: scope, projectId: pid, overwrite: overwrite);
          break;
        case ClaudeKind.command:
          res = await _api.registerCommand(item['rel'] as String,
              scope: scope, projectId: pid, overwrite: overwrite);
          break;
        case ClaudeKind.md:
          return;
      }
      if (res['ok'] == true) {
        _toast('${kind.label} 마켓 등록 완료: ${item['id']}');
        await _loadAll();
      } else if (res['already'] == true) {
        _toast('이미 같은 내용으로 등록되어 있습니다.');
      } else if (res['conflict'] == true) {
        final ok = await _confirm('마켓 등록본 갱신',
            "마켓의 '${item['id']}'${res['market_host'] != null ? ' (등록: ${res['market_host']})' : ''} 등록본과 내용이 다릅니다. 현재 버전으로 갱신할까요?");
        if (ok) await _registerToMarket(kind, item, overwrite: true);
      } else {
        _toast((res['error'] ?? '등록 실패') as String, error: true);
      }
    } catch (e) {
      _toast('$e', error: true);
    }
  }

  Future<void> _deleteInstalled(ClaudeKind kind, Map item) async {
    final name = (item['id'] ?? item['name']) as String;
    final ok = await _confirm('${kind.label} 삭제',
        "'$name' 을(를) 삭제할까요?\n\n${item['path'] ?? ''}\n\n되돌릴 수 없습니다.",
        destructive: true);
    if (!ok) return;
    try {
      final scope = (item['scope'] ?? 'global') as String;
      final pid = item['project_id'];
      Map<String, dynamic> res;
      switch (kind) {
        case ClaudeKind.skill:
          res = await _api.deleteSkill(item['id'] as String, scope: scope, projectId: pid);
          break;
        case ClaudeKind.agent:
          res = await _api.deleteAgent(item['rel'] as String, scope: scope, projectId: pid);
          break;
        case ClaudeKind.command:
          res = await _api.deleteCommand(item['rel'] as String, scope: scope, projectId: pid);
          break;
        case ClaudeKind.md:
          return;
      }
      if (res['ok'] == true) {
        _toast('삭제됨: $name');
        await _loadAll();
      } else {
        _toast((res['error'] ?? '삭제 실패') as String, error: true);
      }
    } catch (e) {
      _toast('$e', error: true);
    }
  }

  // ── 상세: 마켓 (내용 보기 + 설치[위치선택] + 마켓삭제) ────
  Future<void> _showMarketDetail(ClaudeKind kind, Map item) async {
    await _openContentSheet(
      kind: kind,
      title: (kind == ClaudeKind.command)
          ? '/${item['id'] ?? ''}'
          : (item['name'] ?? item['id']) as String,
      subtitle: (item['host'] ?? '') == ''
          ? (item['id'] ?? '') as String
          : '${item['id']} · @ ${item['host']}',
      contentFuture: Future.value((item['content'] ?? '(내용 없음)') as String),
      actions: (ctx, setSheet) => [
        FilledButton.icon(
          icon: const Icon(Icons.download_outlined, size: 18),
          label: const Text('설치'),
          onPressed: () async {
            Navigator.pop(ctx);
            await _installFromMarket(kind, item);
          },
        ),
        OutlinedButton.icon(
          icon: const Icon(Icons.delete_outline, size: 18),
          style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
          label: const Text('마켓에서 삭제'),
          onPressed: () async {
            Navigator.pop(ctx);
            await _unregisterFromMarket(kind, item);
          },
        ),
      ],
    );
  }

  Future<void> _installFromMarket(ClaudeKind kind, Map item) async {
    // CLAUDE.md·커맨드는 위치 선택 방식이 다르므로 분기
    if (kind == ClaudeKind.command) {
      final dest = await _pickInstallDest(kind, '${item['id']}');
      if (dest == null) return;
      await _handleInstallResult(
        () => _api.installMarketCommand(item['rel'] as String, item['content'] as String,
            scope: dest.scope, projectId: dest.projectId),
        kind,
      );
      return;
    }
    final dest = await _pickInstallDest(kind, '${item['name'] ?? item['id']}');
    if (dest == null) return;
    if (kind == ClaudeKind.skill) {
      await _handleInstallResult(
        () => _api.installMarketSkill(item['id'] as String, item['content'] as String,
            scope: dest.scope, projectId: dest.projectId),
        kind,
      );
    } else if (kind == ClaudeKind.agent) {
      await _handleInstallResult(
        () => _api.installMarketAgent(item['id'] as String,
            (item['rel'] ?? '') as String, item['content'] as String,
            scope: dest.scope, projectId: dest.projectId),
        kind,
      );
    }
  }

  Future<void> _installGithubSkill(dynamic s) async {
    final ok = await _confirm('스킬 설치',
        "'${s['id']}' 스킬을 설치할까요?\n설치 위치는 다음 단계에서 선택합니다.\n\n⚠ 서드파티 스킬은 Claude 가 실행할 스크립트를 포함할 수 있습니다.");
    if (!ok) return;
    final dest = await _pickInstallDest(ClaudeKind.skill, '${s['id']} — [${s['repo']}]');
    if (dest == null) return;
    try {
      var res = await _api.installGithubSkill(s['repo'] as String, s['id'] as String,
          scope: dest.scope, projectId: dest.projectId);
      if (res['ok'] != true && res['exists'] == true) {
        final ow = await _confirm('덮어쓰기', "'${s['id']}' 스킬이 이미 있습니다. 덮어쓸까요?",
            destructive: true);
        if (!ow) return;
        res = await _api.installGithubSkill(s['repo'] as String, s['id'] as String,
            scope: dest.scope, projectId: dest.projectId, overwrite: true);
      }
      if (res['ok'] == true) {
        _toast('스킬 설치 완료: ${s['id']}');
        await _loadAll();
      } else {
        _toast((res['error'] ?? '설치 실패') as String, error: true);
      }
    } catch (e) {
      _toast('$e', error: true);
    }
  }

  Future<void> _handleInstallResult(
      Future<Map<String, dynamic>> Function() call, ClaudeKind kind) async {
    try {
      final res = await call();
      if (res['ok'] == true) {
        _toast('${kind.label} 설치 완료: ${res['path'] ?? res['id']}');
        await _loadAll();
      } else if (res['exists'] == true) {
        // 이미 존재 — diff 를 요약해서 보여주고 안내
        final same = res['same'] == true;
        await _showInfo('이미 설치됨',
            same ? '동일한 내용이 이미 설치되어 있습니다.' : '대상 파일이 이미 있고 내용이 다릅니다.\n덮어쓰려면 설치된 항목을 먼저 삭제하세요.\n\n${res['path'] ?? ''}');
      } else {
        _toast((res['error'] ?? '설치 실패') as String, error: true);
      }
    } catch (e) {
      _toast('$e', error: true);
    }
  }

  Future<void> _unregisterFromMarket(ClaudeKind kind, Map item) async {
    final id = (item['id'] ?? '') as String;
    final ok = await _confirm('마켓에서 삭제', "마켓에서 '$id' 등록을 삭제할까요?",
        destructive: true);
    if (!ok) return;
    try {
      Map<String, dynamic> res;
      switch (kind) {
        case ClaudeKind.skill:
          res = await _api.unregisterSkill(id);
          break;
        case ClaudeKind.agent:
          res = await _api.unregisterAgent(id);
          break;
        case ClaudeKind.command:
          res = await _api.unregisterCommand(id);
          break;
        case ClaudeKind.md:
          return;
      }
      if (res['ok'] == true) {
        _toast('마켓에서 삭제 완료: $id');
        await _loadAll();
      } else {
        _toast((res['error'] ?? '삭제 실패') as String, error: true);
      }
    } catch (e) {
      _toast('$e', error: true);
    }
  }

  // ── 수동 등록 ───────────────────────────────────────────
  Future<void> _showManualRegister(ClaudeKind kind) async {
    final idCtrl = TextEditingController();
    final contentCtrl = TextEditingController();
    final ph = switch (kind) {
      ClaudeKind.skill => '예: my-skill',
      ClaudeKind.agent => '예: my-agent 또는 team:reviewer',
      ClaudeKind.command => '예: push 또는 review:pr',
      ClaudeKind.md => '',
    };
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => Padding(
        padding: EdgeInsets.only(
            left: 16, right: 16, top: 16,
            bottom: MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${kind.icon} ${kind.label} 수동 등록',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            TextField(
              controller: idCtrl,
              autofocus: true,
              decoration: InputDecoration(
                  labelText: '${kind.label} 이름', hintText: ph,
                  border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: contentCtrl,
              maxLines: 8,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              decoration: const InputDecoration(
                  labelText: '내용 (markdown, frontmatter name·description 자동 인식)',
                  border: OutlineInputBorder(), alignLabelWithHint: true),
            ),
            const SizedBox(height: 12),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
              const SizedBox(width: 8),
              FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('등록')),
            ]),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final id = idCtrl.text.trim().replaceAll(RegExp(r'^/'), '');
    final content = contentCtrl.text;
    if (id.isEmpty || content.trim().isEmpty) {
      _toast('이름과 내용을 모두 입력하세요.', error: true);
      return;
    }
    await _submitManual(kind, id, content);
  }

  Future<void> _submitManual(ClaudeKind kind, String id, String content,
      {bool overwrite = false}) async {
    try {
      Map<String, dynamic> res;
      switch (kind) {
        case ClaudeKind.skill:
          res = await _api.registerSkillManual(id, content, overwrite: overwrite);
          break;
        case ClaudeKind.agent:
          res = await _api.registerAgentManual(id, content, overwrite: overwrite);
          break;
        case ClaudeKind.command:
          res = await _api.registerCommandManual(id, content, overwrite: overwrite);
          break;
        case ClaudeKind.md:
          return;
      }
      if (res['ok'] == true) {
        _toast('${kind.label} 마켓 등록 완료: $id');
        await _loadAll();
      } else if (res['already'] == true) {
        _toast('이미 같은 내용으로 등록되어 있습니다.');
      } else if (res['conflict'] == true) {
        final ok = await _confirm('마켓 등록본 갱신',
            "마켓의 '$id'${res['market_host'] != null ? ' (등록: ${res['market_host']})' : ''} 등록본과 내용이 다릅니다. 갱신할까요?");
        if (ok) await _submitManual(kind, id, content, overwrite: true);
      } else {
        _toast((res['error'] ?? '등록 실패') as String, error: true);
      }
    } catch (e) {
      _toast('$e', error: true);
    }
  }

  // ── CLAUDE.md 상세 ──────────────────────────────────────
  Future<void> _showMdInstalledDetail(Map m) async {
    final scope = (m['scope'] ?? '') as String;
    final future = scope == 'global'
        ? _api.claudeMdGlobal()
        : _api.claudeMd(m['project_id'] as int);
    await _openContentSheet(
      kind: ClaudeKind.md,
      title: scope == 'global' ? '🌐 Global CLAUDE.md' : (m['name'] ?? 'Project') as String,
      subtitle: (m['path'] ?? '') as String,
      contentFuture: future,
      actions: (ctx, setSheet) => const [],
    );
  }

  Future<void> _showMdMarketDetail(Map m) async {
    await _openContentSheet(
      kind: ClaudeKind.md,
      title: '${m['name'] ?? 'CLAUDE.md'} @ ${m['peer_name'] ?? m['peer_url']}',
      subtitle: (m['path'] ?? '') as String,
      contentFuture: Future.value((m['content'] ?? '') as String),
      actions: (ctx, setSheet) => [
        FilledButton.icon(
          icon: const Icon(Icons.download_outlined, size: 18),
          label: const Text('설치'),
          onPressed: () async {
            Navigator.pop(ctx);
            final res = await _api.installClaudeMd(
                (m['scope'] ?? 'global') as String,
                (m['name'] ?? '') as String,
                (m['content'] ?? '') as String);
            if (res['ok'] == true) {
              _toast('CLAUDE.md 설치 완료: ${res['path']}');
              await _loadAll();
            } else if (res['exists'] == true) {
              await _showInfo('이미 있음',
                  res['same'] == true ? '동일한 내용이 이미 있습니다.' : '로컬에 다른 내용의 파일이 이미 있습니다.\n${res['path'] ?? ''}');
            } else {
              _toast((res['error'] ?? '설치 실패') as String, error: true);
            }
          },
        ),
      ],
    );
  }

  // ── 위치 선택 ───────────────────────────────────────────
  Future<_InstallDest?> _pickInstallDest(ClaudeKind kind, String subtitle) async {
    List<Project> projects = [];
    try {
      projects = (await _api.projects()).where((p) => p.projectRoot.trim().isNotEmpty).toList();
    } catch (_) {}
    if (!mounted) return null;
    return showModalBottomSheet<_InstallDest>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('설치 위치 선택',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              Text(subtitle, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
              const SizedBox(height: 12),
              ListTile(
                leading: const Text('🌐', style: TextStyle(fontSize: 20)),
                title: Text('Global — ${kind.globalPath}'),
                onTap: () => Navigator.pop(c, const _InstallDest('global', null)),
              ),
              if (projects.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(8),
                  child: Text('project_root 가 설정된 프로젝트가 없습니다.',
                      style: TextStyle(fontSize: 12, color: Colors.grey)),
                ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: projects
                      .map((p) => ListTile(
                            leading: const Text('📁', style: TextStyle(fontSize: 20)),
                            title: Text(p.name),
                            subtitle: Text('${p.projectRoot}\\${kind.projectSub}',
                                style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
                            onTap: () => Navigator.pop(c, _InstallDest('project', p.id)),
                          ))
                      .toList(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── 공통 위젯/다이얼로그 ─────────────────────────────────
  /// 내용 미리보기 시트. 반환값은 로드된 content(없으면 null).
  Future<String?> _openContentSheet({
    required ClaudeKind kind,
    required String title,
    required String subtitle,
    required Future<String> contentFuture,
    required List<Widget> Function(BuildContext, void Function(void Function())) actions,
  }) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.95,
        builder: (c, scroll) => StatefulBuilder(
          builder: (c, setSheet) => Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(kind.icon, style: const TextStyle(fontSize: 22)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                            maxLines: 2, overflow: TextOverflow.ellipsis),
                        if (subtitle.isNotEmpty)
                          Text(subtitle,
                              style: TextStyle(fontSize: 11, color: Colors.grey.shade600, fontFamily: 'monospace'),
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                ]),
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 4, children: actions(c, setSheet)),
                const Divider(),
                Expanded(
                  child: FutureBuilder<String>(
                    future: contentFuture,
                    builder: (c, snap) {
                      if (snap.connectionState != ConnectionState.done) {
                        return const Center(child: CircularProgressIndicator());
                      }
                      if (snap.hasError) {
                        return SingleChildScrollView(
                          controller: scroll,
                          child: Text('${snap.error}', style: const TextStyle(color: Colors.red)),
                        );
                      }
                      final text = snap.data?.isEmpty == true ? '(비어 있음)' : (snap.data ?? '');
                      return SingleChildScrollView(
                        controller: scroll,
                        child: SelectableText(text,
                            style: const TextStyle(fontFamily: 'monospace', fontSize: 12, height: 1.5)),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _card({
    required ClaudeKind kind,
    required String title,
    required String subtitle,
    required String desc,
    required VoidCallback onTap,
    Widget? trailing,
  }) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: kind.color.withValues(alpha: 0.15),
          child: Text(kind.icon, style: TextStyle(color: kind.color)),
        ),
        title: Row(children: [
          Flexible(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis)),
          if (subtitle.isNotEmpty) ...[
            const SizedBox(width: 6),
            Text(subtitle,
                style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ]),
        subtitle: desc.isEmpty
            ? null
            : Text(desc, maxLines: 2, overflow: TextOverflow.ellipsis),
        trailing: trailing ?? const Icon(Icons.chevron_right, size: 20),
        onTap: onTap,
      ),
    );
  }

  Widget _cards(List<dynamic> items, Widget Function(Map) builder,
      {String? emptyMsg}) {
    if (items.isEmpty) {
      return ListView(children: [
        _emptyRow(emptyMsg ?? '항목이 없습니다.'),
      ]);
    }
    return ListView(
      children: items.map((e) => builder(e as Map)).toList(),
    );
  }

  Widget _sectionHeader(String title, VoidCallback? onManual) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 6),
      child: Row(children: [
        Expanded(
          child: Text(title,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
        ),
        if (onManual != null)
          TextButton.icon(
            icon: const Icon(Icons.add, size: 16),
            label: const Text('수동 등록'),
            onPressed: onManual,
          ),
      ]),
    );
  }

  Widget _emptyRow(String msg) => Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text(msg,
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
        ),
      );

  Widget _noSource() => _centered(
      'Firebase 마켓 소스가 설정되지 않았습니다.\n웹 대시보드 > 확장 > ⚙ 설정에서 설정하세요.');

  Widget _centered(String msg, {VoidCallback? action}) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(msg, textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey.shade600)),
            ),
            if (action != null)
              OutlinedButton(onPressed: action, child: const Text('다시 시도')),
          ],
        ),
      );

  Future<bool> _confirm(String title, String msg, {bool destructive = false}) async {
    final r = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(child: Text(msg)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
          FilledButton(
            style: destructive
                ? FilledButton.styleFrom(backgroundColor: Colors.red)
                : null,
            onPressed: () => Navigator.pop(c, true),
            child: Text(destructive ? '삭제' : '확인'),
          ),
        ],
      ),
    );
    return r == true;
  }

  Future<void> _showInfo(String title, String msg) => showDialog(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(child: Text(msg)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('확인')),
          ],
        ),
      );
}

class _InstallDest {
  final String scope;
  final dynamic projectId;
  const _InstallDest(this.scope, this.projectId);
}
