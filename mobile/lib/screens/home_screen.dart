import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/app_state.dart';
import '../widgets/connections_sheet.dart';
import 'dashboard_screen.dart';
import 'extensions_screen.dart';
import 'projects_screen.dart';
import 'run_logs_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _idx = 0;

  static const _titles = ['대시보드', '프로젝트', '실행 로그', '확장'];

  /// 서버에 빌드된 APK 를 확인하고 브라우저로 다운로드한다 (앱 업데이트용).
  Future<void> _downloadApk() async {
    final app = context.read<AppState>();
    Map<String, dynamic> info;
    try {
      info = await app.api.apkInfo();
    } catch (e) {
      _toast('APK 정보 조회 실패: $e');
      return;
    }
    if (!mounted) return;
    if (info['exists'] != true) {
      _toast("서버에 빌드된 APK 가 없습니다. PC 에서 'flutter build apk' 로 빌드하세요.");
      return;
    }
    final sizeMb = ((info['size'] ?? 0) as num) / (1024 * 1024);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('APK 다운로드'),
        content: Text('${info['name'] ?? 'ep4.apk'}\n'
            '크기: ${sizeMb.toStringAsFixed(1)} MB\n'
            '빌드: ${info['mtime'] ?? '-'}\n\n'
            '브라우저로 다운로드합니다. 설치하면 앱이 업데이트됩니다.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('다운로드')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final tok = app.token ?? '';
    final url = '${app.baseUrl}/api/apk'
        '${tok.isEmpty ? '' : '?token=${Uri.encodeQueryComponent(tok)}'}';
    final launched =
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!launched) _toast('브라우저를 열지 못했습니다.');
  }

  void _toast(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(m), behavior: SnackBarBehavior.floating));
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardScreen(
        onOpenProjects: () => setState(() => _idx = 1),
        onOpenRuns: () => setState(() => _idx = 2),
      ),
      const ProjectsScreen(),
      const RunLogsScreen(),
      const ExtensionsScreen(),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_idx]),
        actions: [
          IconButton(
            tooltip: 'APK 다운로드',
            icon: const Icon(Icons.android),
            onPressed: _downloadApk,
          ),
          IconButton(
            tooltip: '접속 정보',
            icon: const Icon(Icons.settings_input_antenna),
            onPressed: () => showConnectionsSheet(context),
          ),
          IconButton(
            tooltip: '반응형 웹으로 전환',
            icon: const Icon(Icons.language),
            onPressed: () =>
                context.read<AppState>().setViewMode(ViewMode.webView),
          ),
          IconButton(
            tooltip: '연결 해제',
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<AppState>().disconnect(),
          ),
        ],
      ),
      body: IndexedStack(index: _idx, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _idx,
        onDestinationSelected: (i) => setState(() => _idx = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.dashboard_outlined),
              selectedIcon: Icon(Icons.dashboard),
              label: '대시보드'),
          NavigationDestination(
              icon: Icon(Icons.folder_outlined),
              selectedIcon: Icon(Icons.folder),
              label: '프로젝트'),
          NavigationDestination(
              icon: Icon(Icons.receipt_long_outlined),
              selectedIcon: Icon(Icons.receipt_long),
              label: '실행 로그'),
          NavigationDestination(
              icon: Icon(Icons.extension_outlined),
              selectedIcon: Icon(Icons.extension),
              label: '확장'),
        ],
      ),
    );
  }
}
