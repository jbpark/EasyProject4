import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/sse_client.dart';
import '../models/run_log.dart';
import '../state/app_state.dart';
import '../widgets/status_chip.dart';
import 'run_log_detail_screen.dart';

/// 특정 태스크의 실행 로그(run) 목록. 항목을 누르면 상세(RunLogDetailScreen)로 이동.
/// api 를 넘기면 그 클라이언트로 조회한다 (원격 프로젝트의 peer-proxy 라우팅용).
class TaskRunsScreen extends StatefulWidget {
  final int taskId;
  final String taskTitle;
  final ApiClient? api;
  const TaskRunsScreen(
      {super.key, required this.taskId, required this.taskTitle, this.api});

  @override
  State<TaskRunsScreen> createState() => _TaskRunsScreenState();
}

class _TaskRunsScreenState extends State<TaskRunsScreen> {
  List<RunLog> _runs = [];
  bool _loading = true;
  StreamSubscription<SseEvent>? _sub;

  ApiClient get _api => widget.api ?? context.read<AppState>().api;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = context.read<AppState>().events?.listen((e) {
      if (['task_start', 'task_done', 'run_log'].contains(e.event)) _load();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await _api.runs(taskId: widget.taskId);
      if (!mounted) return;
      setState(() {
        _runs = list;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('실행 로그'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(28),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(widget.taskTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12.5, color: Colors.grey)),
            ),
          ),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _runs.isEmpty
                  ? ListView(children: const [
                      SizedBox(height: 120),
                      Center(child: Text('이 태스크의 실행 로그가 없습니다')),
                    ])
                  : ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: _runs.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) => _runCard(_runs[i]),
                    ),
            ),
    );
  }

  Widget _runCard(RunLog r) {
    return Card(
      child: ListTile(
        leading: Dot(r.status),
        title: Text(
          '${r.model.replaceAll('claude-', '')}'
          '${r.durationSec != null ? ' · ${r.durationSec}s' : ''}',
          style: const TextStyle(fontSize: 13.5),
        ),
        subtitle: r.startedAt != null
            ? Text(r.startedAt!, style: const TextStyle(fontSize: 12))
            : null,
        trailing: StatusChip(r.status),
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => RunLogDetailScreen(runId: r.id, api: widget.api)),
        ),
      ),
    );
  }
}
