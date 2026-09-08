import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/sse_client.dart';
import '../models/project.dart';
import '../models/run_log.dart';
import '../state/app_state.dart';
import '../widgets/status_chip.dart';
import 'run_log_detail_screen.dart';

/// 전체 프로젝트·태스크·오늘 실행 현황을 한눈에 보여주는 대시보드.
class DashboardScreen extends StatefulWidget {
  /// '프로젝트'·'태스크' 카드 탭 시 하단 프로젝트 메뉴로 전환하는 콜백.
  final VoidCallback? onOpenProjects;

  /// '실행 중/실패 태스크' 카드 탭 시 하단 실행 로그 메뉴로 전환하는 콜백.
  final VoidCallback? onOpenRuns;

  const DashboardScreen({super.key, this.onOpenProjects, this.onOpenRuns});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  List<Project> _projects = [];
  List<RunLog> _todayRuns = [];
  bool _loading = true;
  String? _error;
  StreamSubscription<SseEvent>? _sub;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = context.read<AppState>().events?.listen((e) {
      if (['status', 'task_start', 'task_done', 'tasks_changed', 'run_done']
          .contains(e.event)) {
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
      final api = context.read<AppState>().api;
      final results = await Future.wait([
        api.projects(),
        api.runs(today: true),
      ]);
      if (!mounted) return;
      setState(() {
        _projects = results[0] as List<Project>;
        _todayRuns = results[1] as List<RunLog>;
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
  }

  String _fmtTime(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    try {
      final t = DateTime.parse(iso).toLocal();
      return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cloud_off, size: 40, color: Colors.grey),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(_error!, textAlign: TextAlign.center),
          ),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: _load, child: const Text('다시 시도')),
        ]),
      );
    }

    final taskTotal = _projects.fold<int>(0, (s, p) => s + p.stats.total);
    final taskDone = _projects.fold<int>(0, (s, p) => s + p.stats.done);
    final taskRunning = _projects.fold<int>(0, (s, p) => s + p.stats.running);
    final taskError = _projects.fold<int>(0, (s, p) => s + p.stats.error);
    final runningProjects =
        _projects.where((p) => p.status == 'running').length;
    final runsDone = _todayRuns.where((r) => r.status == 'done').length;
    final runsError = _todayRuns.where((r) => r.status == 'error').length;
    final recentRuns = _todayRuns.take(10).toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 2.2,
            children: [
              _StatCard(
                label: '프로젝트',
                value: '${_projects.length}',
                color: const Color(0xFF38BDF8),
                sub: runningProjects > 0 ? '실행 중 $runningProjects' : '',
                onTap: widget.onOpenProjects,
              ),
              _StatCard(
                label: '태스크',
                value: '$taskTotal',
                color: const Color(0xFFA78BFA),
                sub: '완료 $taskDone',
                onTap: widget.onOpenProjects,
              ),
              _StatCard(
                label: '실행 중 태스크',
                value: '$taskRunning',
                color: const Color(0xFFFBBF24),
                onTap: widget.onOpenRuns,
              ),
              _StatCard(
                label: '실패 태스크',
                value: '$taskError',
                color: const Color(0xFFF87171),
                onTap: widget.onOpenRuns,
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(children: [
            Text('오늘 실행',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade300)),
            const SizedBox(width: 8),
            Text(
              '${_todayRuns.length}회 · 성공 $runsDone · 실패 $runsError',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
            ),
          ]),
          const SizedBox(height: 8),
          if (recentRuns.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Center(
                child: Text('오늘 실행된 태스크가 없습니다',
                    style: TextStyle(color: Colors.grey.shade600)),
              ),
            )
          else
            ...recentRuns.map((r) => Card(
                  margin: const EdgeInsets.only(bottom: 6),
                  child: ListTile(
                    dense: true,
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => RunLogDetailScreen(runId: r.id)),
                    ),
                    leading: StatusChip(r.status),
                    title: Text(r.taskTitle.isEmpty ? '(제목 없음)' : r.taskTitle,
                        style: const TextStyle(fontSize: 13.5),
                        overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      '${r.projectName}'
                      '${r.durationSec != null ? ' · ${r.durationSec}s' : ''}',
                      style: TextStyle(
                          fontSize: 11.5, color: Colors.grey.shade500),
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: Text(_fmtTime(r.startedAt),
                        style: TextStyle(
                            fontSize: 11, color: Colors.grey.shade600)),
                  ),
                )),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final String sub;
  final VoidCallback? onTap;
  const _StatCard({
    required this.label,
    required this.value,
    required this.color,
    this.sub = '',
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final card = Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF161B22),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label,
              style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
          const SizedBox(height: 2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(value,
                  style: TextStyle(
                      fontSize: 20, fontWeight: FontWeight.bold, color: color)),
              if (sub.isNotEmpty) ...[
                const SizedBox(width: 8),
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Text(sub,
                      style: TextStyle(
                          fontSize: 10.5, color: Colors.grey.shade500),
                      overflow: TextOverflow.ellipsis),
                ),
              ],
            ],
          ),
        ],
      ),
    );
    if (onTap == null) return card;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: card,
    );
  }
}
