import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// SSE 이벤트 한 건.
class SseEvent {
  final String event;
  final Map<String, dynamic> data;
  const SseEvent(this.event, this.data);
}

/// EP4 /api/events 를 구독하는 SSE 클라이언트.
/// 끊기면 자동 재접속하며, broadcast stream 으로 이벤트를 흘려보낸다.
class SseClient {
  final String baseUrl;
  final String? token;
  final _controller = StreamController<SseEvent>.broadcast();
  http.Client? _client;
  bool _stopped = false;

  SseClient(this.baseUrl, {this.token});

  Stream<SseEvent> get stream => _controller.stream;

  void start() {
    _stopped = false;
    _connectLoop();
  }

  Future<void> _connectLoop() async {
    while (!_stopped) {
      try {
        _client = http.Client();
        final req = http.Request('GET', Uri.parse('$baseUrl/api/events'));
        req.headers['Accept'] = 'text/event-stream';
        if (token != null && token!.isNotEmpty) {
          req.headers['Authorization'] = 'Bearer $token';
        }
        final resp = await _client!.send(req);
        String event = '';
        await for (final line in resp.stream
            .transform(utf8.decoder)
            .transform(const LineSplitter())) {
          if (_stopped) break;
          if (line.startsWith('event:')) {
            event = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            final raw = line.substring(5).trim();
            Map<String, dynamic> data = {};
            try {
              final d = jsonDecode(raw);
              if (d is Map<String, dynamic>) data = d;
            } catch (_) {}
            if (event.isNotEmpty && event != 'ping') {
              _controller.add(SseEvent(event, data));
            }
            event = '';
          } else if (line.isEmpty) {
            event = '';
          }
        }
      } catch (_) {
        // 네트워크 오류 → 재접속
      }
      _client?.close();
      if (_stopped) break;
      await Future.delayed(const Duration(seconds: 3));
    }
  }

  void stop() {
    _stopped = true;
    _client?.close();
  }

  void dispose() {
    stop();
    _controller.close();
  }
}
