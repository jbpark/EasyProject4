import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/sse_client.dart';
import '../models/run_log.dart';
import '../state/app_state.dart';
import '../widgets/status_chip.dart';
import 'run_log_detail_screen.dart';

class RunLogsScreen extends StatefulWidget {
  const RunLogsScreen({super.key});

  @override
  State<RunLogsScreen> createState() => _RunLogsScreenState();
}

class _RunLogsScreenState extends State<RunLogsScreen> {
  List<RunLog> _runs = [];
  bool _loading = true;
  String _filter = ''; // '', running, done, error
  StreamSubscription<SseEvent>? _sub;

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
      final list = await context
          .read<AppState>()
          .api
          .runs(status: _filter.isEmpty ? null : _filter);
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
    return Column(
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              _chip('전체', ''),
              _chip('실행 중', 'running'),
              _chip('완료', 'done'),
              _chip('실패', 'error'),
            ],
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _runs.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 120),
                          Center(child: Text('실행 로그가 없습니다')),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: _runs.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) => _runCard(_runs[i]),
                        ),
                ),
        ),
      ],
    );
  }

  Widget _chip(String label, String value) {
    final sel = _filter == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: sel,
        onSelected: (_) {
          setState(() {
            _filter = value;
            _loading = true;
          });
          _load();
        },
      ),
    );
  }

  Widget _runCard(RunLog r) {
    return Card(
      child: ListTile(
        leading: Dot(r.status),
        title: Text(r.taskTitle.isEmpty ? '(제목 없음)' : r.taskTitle,
            maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          '${r.projectName} · ${r.model.replaceAll('claude-', '')}'
          '${r.durationSec != null ? ' · ${r.durationSec}s' : ''}'
          '${r.startedAt != null ? '\n${r.startedAt}' : ''}',
          style: const TextStyle(fontSize: 12),
        ),
        isThreeLine: r.startedAt != null,
        trailing: StatusChip(r.status),
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => RunLogDetailScreen(runId: r.id)),
        ),
      ),
    );
  }
}
