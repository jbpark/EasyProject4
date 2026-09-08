class Task {
  final int id;
  final String text;
  final String body;
  final String test;
  final String status;
  final String triggerType;
  final String modelOverride;

  /// 태스크별 실행 세션: '' = 프로젝트 기본(기존 세션), '__new__' = 신규 세션,
  /// 그 외 = 지정한 이름의 실행 중 세션.
  final String sessionOverride;

  /// 태스크별 실행 타임아웃(초). 0 = 프로젝트 기본값 사용.
  final int timeoutOverride;
  final String author;
  final String output;
  final String? startedAt;
  final String? endedAt;
  final String gitTaskBranch;
  final int sortOrder;
  final int? folderId;

  const Task({
    required this.id,
    required this.text,
    required this.body,
    required this.test,
    required this.status,
    required this.triggerType,
    required this.modelOverride,
    this.sessionOverride = '',
    this.timeoutOverride = 0,
    required this.author,
    required this.output,
    this.startedAt,
    this.endedAt,
    this.gitTaskBranch = '',
    this.sortOrder = 0,
    this.folderId,
  });

  factory Task.fromJson(Map<String, dynamic> j) => Task(
        id: j['id'] as int,
        text: (j['text'] ?? '') as String,
        body: (j['body'] ?? '') as String,
        test: (j['test'] ?? '') as String,
        status: (j['status'] ?? 'pending') as String,
        triggerType: (j['trigger_type'] ?? 'manual') as String,
        modelOverride: (j['model_override'] ?? '') as String,
        sessionOverride: (j['session_override'] ?? '') as String,
        timeoutOverride: (j['timeout_override'] ?? 0) as int,
        author: (j['author'] ?? '') as String,
        output: (j['output'] ?? '') as String,
        startedAt: j['started_at'] as String?,
        endedAt: j['ended_at'] as String?,
        gitTaskBranch: (j['git_task_branch'] ?? '') as String,
        sortOrder: (j['sort_order'] ?? 0) as int,
        folderId: j['folder_id'] as int?,
      );

  Task copyWith({int? sortOrder, int? folderId, bool clearFolder = false}) => Task(
        id: id,
        text: text,
        body: body,
        test: test,
        status: status,
        triggerType: triggerType,
        modelOverride: modelOverride,
        sessionOverride: sessionOverride,
        timeoutOverride: timeoutOverride,
        author: author,
        output: output,
        startedAt: startedAt,
        endedAt: endedAt,
        gitTaskBranch: gitTaskBranch,
        sortOrder: sortOrder ?? this.sortOrder,
        folderId: clearFolder ? null : (folderId ?? this.folderId),
      );
}
