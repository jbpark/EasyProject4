import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'state/app_state.dart';
import 'screens/connect_screen.dart';
import 'screens/home_screen.dart';
import 'screens/web_view_screen.dart';

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => AppState()..loadSaved(),
      child: const Ep4App(),
    ),
  );
}

const _accent   = Color(0xFFFF6A3D);
const _bg       = Color(0xFF0D1117);
const _surface  = Color(0xFF161B22);

class Ep4App extends StatelessWidget {
  const Ep4App({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _accent,
      brightness: Brightness.dark,
    ).copyWith(surface: _surface, primary: _accent);

    return MaterialApp(
      title: 'EasyProject4',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: _bg,
        appBarTheme: const AppBarTheme(
          backgroundColor: _surface,
          elevation: 0,
          centerTitle: false,
        ),
        cardTheme: CardThemeData(
          color: _surface,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: Color(0xFF2A323C)),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: _bg,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      home: const _Root(),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    if (state.restoring) return const _RestoreSplash();
    if (!state.connected) return const ConnectScreen();
    if (state.viewMode == ViewMode.webView) return const WebViewScreen();
    return const HomeScreen();
  }
}

/// 앱 시작 시 저장된 접속 정보로 자동 재접속하는 동안 표시.
class _RestoreSplash extends StatelessWidget {
  const _RestoreSplash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('🗂', style: TextStyle(fontSize: 56)),
            SizedBox(height: 20),
            CircularProgressIndicator(strokeWidth: 2.5),
            SizedBox(height: 16),
            Text('저장된 서버에 연결 중…',
                style: TextStyle(color: Colors.grey, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
