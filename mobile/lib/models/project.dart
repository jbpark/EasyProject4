class ProjectStats {
  final int total, done, running, error;
  const ProjectStats(this.total, this.done, this.running, this.error);

  factory ProjectStats.fromJson(Map<String, dynamic> j) => ProjectStats(
        (j['total'] ?? 0) as int,
        (j['done'] ?? 0) as int,
        (j['running'] ?? 0) as int,
        (j['error'] ?? 0) as int,
      );
}

class Project {
  final int id;
  final String name;
  final String description;
  final String status;
  final String model;
  final String sessionName;
  final ProjectStats stats;
  final String gitProjBranch;
  final bool hasClaudeMd;
  final String projectRoot;

  /// 다른 EP4(peer)의 공유 프로젝트 여부와 출처 정보
  final bool remote;
  final String peerUrl;
  final String peerName;
  final String host;

  /// 서버가 내려준 원본 JSON. /update 는 전체 필드를 덮어쓰므로
  /// 부분 수정 시 나머지 필드를 이 값에서 그대로 되돌려 보낸다.
  final Map<String, dynamic> raw;

  const Project({
    required this.id,
    required this.name,
    required this.description,
    required this.status,
    required this.model,
    required this.sessionName,
    required this.stats,
    this.gitProjBranch = '',
    this.hasClaudeMd = false,
    this.projectRoot = '',
    this.remote = false,
    this.peerUrl = '',
    this.peerName = '',
    this.host = '',
    this.raw = const {},
  });

  factory Project.fromJson(Map<String, dynamic> j) => Project(
        id: j['id'] as int,
        name: (j['name'] ?? '') as String,
        description: (j['description'] ?? '') as String,
        status: (j['status'] ?? 'idle') as String,
        model: (j['model'] ?? '') as String,
        sessionName: (j['session_name'] ?? '') as String,
        stats: ProjectStats.fromJson(
            (j['stats'] ?? const {}) as Map<String, dynamic>),
        gitProjBranch: (j['git_proj_branch'] ?? '') as String,
        hasClaudeMd: (j['has_claude_md'] ?? false) as bool,
        projectRoot: (j['project_root'] ?? '') as String,
        remote: (j['remote'] ?? false) as bool,
        peerUrl: (j['peer_url'] ?? '') as String,
        peerName: (j['peer_name'] ?? '') as String,
        host: (j['host'] ?? '') as String,
        raw: j,
      );
}
