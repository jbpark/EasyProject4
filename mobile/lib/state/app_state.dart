import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/sse_client.dart';

enum ViewMode { nativeApp, webView }

/// 앱 전역 상태: 서버 연결, API/SSE 클라이언트, 접속 모드 보유.
class AppState extends ChangeNotifier {
  static const _kBaseUrl  = 'ep4_base_url';
  static const _kViewMode = 'ep4_view_mode';
  static const _kToken    = 'ep4_token';
  static const kPrefEp4Id = 'ep4_id';
  /// Firebase Realtime DB 주소. 빌드 시 --dart-define=EP4_FIREBASE_DB=... 로 주입한다
  /// (mobile.bat 이 conf/ep4.local.conf 의 firebase_db_url 을 읽어 전달).
  /// 비어 있으면 EP4 ID 로 터널 URL 을 조회하는 기능만 비활성화되고, 직접 주소 입력은 그대로 동작한다.
  static const kDbBase =
      String.fromEnvironment('EP4_FIREBASE_DB', defaultValue: '');

  String?   _baseUrl;
  String?   _token;
  ApiClient? _api;
  SseClient? _sse;
  bool       _connected = false;
  bool       _restoring = true;
  ViewMode   _viewMode  = ViewMode.nativeApp;

  String?   get baseUrl   => _baseUrl;
  String?   get token     => _token;
  bool      get connected => _connected;
  bool      get restoring => _restoring;
  ApiClient get api       => _api!;
  Stream<SseEvent>? get events => _sse?.stream;
  ViewMode  get viewMode  => _viewMode;

  Future<void> loadSaved() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_kBaseUrl);
    if (url != null && url.isNotEmpty) _baseUrl = url;
    final tok = prefs.getString(_kToken);
    if (tok != null && tok.isNotEmpty) _token = tok;

    final vmStr = prefs.getString(_kViewMode) ?? ViewMode.nativeApp.name;
    _viewMode = ViewMode.values.firstWhere(
      (e) => e.name == vmStr,
      orElse: () => ViewMode.nativeApp,
    );
    notifyListeners();

    // 저장된 접속 정보로 자동 재접속 (QR 재스캔 불필요)
    if (_baseUrl != null) {
      var ok = await connect(_baseUrl!, token: _token);
      if (!ok) {
        // 임시 터널 URL이 바뀐 경우: 저장된 EP4 ID로 최신 URL 재조회 후 재시도
        final id = prefs.getString(kPrefEp4Id) ?? '';
        final fresh = id.isEmpty ? null : await fetchTunnelUrl(id);
        if (fresh != null && fresh != _baseUrl) {
          ok = await connect(fresh, token: _token);
        }
      }
    }
    _restoring = false;
    notifyListeners();
  }

  /// Firebase에서 EP4 ID로 현재 터널 URL 조회. 실패하면 null.
  static Future<String?> fetchTunnelUrl(String id) async {
    if (kDbBase.isEmpty) return null;
    try {
      final uri = Uri.parse('$kDbBase/ep4_tunnels/$id.json');
      final res = await http.get(uri).timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return null;
      final j = jsonDecode(res.body);
      if (j is! Map<String, dynamic>) return null;
      final url = (j['url'] ?? '') as String;
      return url.isEmpty ? null : url;
    } catch (_) {
      return null;
    }
  }

  Future<void> setViewMode(ViewMode mode) async {
    if (_viewMode == mode) return;
    _viewMode = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kViewMode, mode.name);
    notifyListeners();
  }

  /// 주소 정규화: 끝 슬래시 제거, scheme 없으면 https 가정.
  static String normalize(String url) {
    var u = url.trim();
    if (u.isEmpty) return u;
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = 'https://$u';
    }
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    return u;
  }

  /// 연결 시도. 성공하면 SSE 시작 + 주소·토큰 저장.
  Future<bool> connect(String rawUrl, {String? token}) async {
    final url = normalize(rawUrl);
    final tok = (token ?? '').trim();
    final normTok = tok.isEmpty ? null : tok;
    final api = ApiClient(url, token: normTok);
    final ok = await api.ping();
    if (!ok) {
      api.close();
      return false;
    }
    _disposeClients();
    _baseUrl = url;
    _token = normTok;
    _api = api;
    _sse = SseClient(url, token: normTok)..start();
    _connected = true;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBaseUrl, url);
    if (normTok != null) {
      await prefs.setString(_kToken, normTok);
    } else {
      await prefs.remove(_kToken);
    }
    notifyListeners();
    return true;
  }

  Future<void> disconnect() async {
    _disposeClients();
    _connected = false;
    notifyListeners();
  }

  void _disposeClients() {
    _sse?.dispose();
    _api?.close();
    _sse = null;
    _api = null;
  }

  @override
  void dispose() {
    _disposeClients();
    super.dispose();
  }
}
