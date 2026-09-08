class RunLog {
  final int id;
  final int? taskId;
  final int? projectId;
  final String taskTitle;
  final String projectName;
  final String status;
  final String triggerType;
  final String model;
  final String? startedAt;
  final String? endedAt;
  final int? durationSec;
  final String? traceId;
  final String claudeSessionId;

  const RunLog({
    required this.id,
    this.taskId,
    this.projectId,
    required this.taskTitle,
    required this.projectName,
    required this.status,
    required this.triggerType,
    required this.model,
    this.startedAt,
    this.endedAt,
    this.durationSec,
    this.traceId,
    this.claudeSessionId = '',
  });

  factory RunLog.fromJson(Map<String, dynamic> j) => RunLog(
        id: j['id'] as int,
        taskId: j['task_id'] as int?,
        projectId: j['project_id'] as int?,
        taskTitle: (j['task_title'] ?? '') as String,
        projectName: (j['project_name'] ?? '') as String,
        status: (j['status'] ?? '') as String,
        triggerType: (j['trigger_type'] ?? '') as String,
        model: (j['model'] ?? '') as String,
        startedAt: j['started_at'] as String?,
        endedAt: j['ended_at'] as String?,
        durationSec: j['duration_sec'] as int?,
        traceId: j['trace_id'] as String?,
        claudeSessionId: (j['claude_session_id'] ?? '') as String,
      );
}

class RunLogLine {
  final String ts;
  final String level;
  final String msg;
  const RunLogLine(this.ts, this.level, this.msg);

  factory RunLogLine.fromJson(Map<String, dynamic> j) => RunLogLine(
        (j['ts'] ?? '') as String,
        (j['level'] ?? 'INFO') as String,
        (j['msg'] ?? '') as String,
      );
}

class ClaudeSessionMessage {
  final String role;
  final String ts;
  final String text;

  const ClaudeSessionMessage({
    required this.role,
    required this.ts,
    required this.text,
  });

  factory ClaudeSessionMessage.fromJson(Map<String, dynamic> j) =>
      ClaudeSessionMessage(
        role: (j['role'] ?? 'assistant') as String,
        ts: (j['ts'] ?? '') as String,
        text: (j['text'] ?? '') as String,
      );
}

class ClaudeSessionDetail {
  final String sessionId;
  final String model;
  final String firstPrompt;
  final String title;
  final String firstTs;
  final String lastTs;
  final int msgCount;
  final int userCount;
  final int assistantCount;
  final int toolCount;
  final int totalTokens;
  final int inputTokens;
  final int outputTokens;
  final int cacheTokens;
  final String cwd;
  final bool truncated;
  final List<ClaudeSessionMessage> messages;

  const ClaudeSessionDetail({
    required this.sessionId,
    required this.model,
    required this.firstPrompt,
    this.title = '',
    required this.firstTs,
    required this.lastTs,
    required this.msgCount,
    required this.userCount,
    required this.assistantCount,
    required this.toolCount,
    required this.totalTokens,
    required this.inputTokens,
    required this.outputTokens,
    required this.cacheTokens,
    required this.cwd,
    required this.truncated,
    required this.messages,
  });

  factory ClaudeSessionDetail.fromJson(Map<String, dynamic> j) =>
      ClaudeSessionDetail(
        sessionId: (j['session_id'] ?? '') as String,
        model: (j['model'] ?? '') as String,
        firstPrompt: (j['first_prompt'] ?? '') as String,
        title: (j['title'] ?? '') as String,
        firstTs: (j['first_ts'] ?? '') as String,
        lastTs: (j['last_ts'] ?? '') as String,
        msgCount: (j['msg_count'] ?? 0) as int,
        userCount: (j['user_count'] ?? 0) as int,
        assistantCount: (j['assistant_count'] ?? 0) as int,
        toolCount: (j['tool_count'] ?? 0) as int,
        totalTokens: (j['total_tokens'] ?? 0) as int,
        inputTokens: (j['input_tokens'] ?? 0) as int,
        outputTokens: (j['output_tokens'] ?? 0) as int,
        cacheTokens: (j['cache_tokens'] ?? 0) as int,
        cwd: (j['cwd'] ?? '') as String,
        truncated: (j['truncated'] ?? false) as bool,
        messages: ((j['messages'] ?? []) as List)
            .map((e) => ClaudeSessionMessage.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class GitDiffFile {
  final String file;
  final int added;
  final int removed;
  const GitDiffFile({required this.file, this.added = 0, this.removed = 0});

  factory GitDiffFile.fromJson(Map<String, dynamic> j) => GitDiffFile(
        file: (j['file'] ?? '') as String,
        added: (j['added'] ?? 0) as int,
        removed: (j['removed'] ?? 0) as int,
      );
}

class GitCommit {
  final String hash;
  final String msg;
  const GitCommit({required this.hash, required this.msg});

  factory GitCommit.fromJson(Map<String, dynamic> j) => GitCommit(
        hash: (j['hash'] ?? '') as String,
        msg: (j['msg'] ?? '') as String,
      );
}

class RunDetail {
  final RunLog summary;
  final String prompt;
  final String output;
  final List<RunLogLine> logLines;
  final String gitMergeStatus;
  final String gitTaskBranch;
  final String gitProjBranch;
  final List<GitDiffFile> gitDiff;
  final List<GitCommit> gitCommits;
  final String gitPrUrl;
  final ClaudeSessionDetail? claudeSession;

  /// 완료 시점 스크린샷 경로(예: /api/runs/{id}/screenshot). 없으면 빈 문자열.
  final String screenshot;
  final String previewUrl;

  const RunDetail({
    required this.summary,
    required this.prompt,
    required this.output,
    required this.logLines,
    required this.gitMergeStatus,
    this.gitTaskBranch = '',
    this.gitProjBranch = '',
    this.gitDiff = const [],
    this.gitCommits = const [],
    this.gitPrUrl = '',
    this.claudeSession,
    this.screenshot = '',
    this.previewUrl = '',
  });

  factory RunDetail.fromJson(Map<String, dynamic> j) {
    ClaudeSessionDetail? sess;
    try {
      final raw = j['claude_session'];
      if (raw != null && raw is Map<String, dynamic>) {
        sess = ClaudeSessionDetail.fromJson(raw);
      }
    } catch (_) {}
    return RunDetail(
      summary: RunLog.fromJson(j),
      prompt: (j['prompt'] ?? '') as String,
      output: (j['output'] ?? '') as String,
      logLines: ((j['log_lines'] ?? []) as List)
          .map((e) => RunLogLine.fromJson(e as Map<String, dynamic>))
          .toList(),
      gitMergeStatus: (j['git_merge_status'] ?? 'no_git') as String,
      gitTaskBranch: (j['git_task_branch'] ?? '') as String,
      gitProjBranch: (j['git_proj_branch'] ?? '') as String,
      gitDiff: ((j['git_diff'] ?? []) as List)
          .map((e) => GitDiffFile.fromJson(e as Map<String, dynamic>))
          .toList(),
      gitCommits: ((j['git_commits'] ?? []) as List)
          .map((e) => GitCommit.fromJson(e as Map<String, dynamic>))
          .toList(),
      gitPrUrl: (j['git_pr_url'] ?? '') as String,
      claudeSession: sess,
      screenshot: (j['screenshot'] ?? '') as String,
      previewUrl: (j['preview_url'] ?? '') as String,
    );
  }
}
