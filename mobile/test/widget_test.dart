import 'package:flutter_test/flutter_test.dart';

import 'package:ep4_mobile/state/app_state.dart';

void main() {
  test('URL 정규화', () {
    expect(AppState.normalize('example.com/'), 'https://example.com');
    expect(AppState.normalize('http://1.2.3.4:7788/'), 'http://1.2.3.4:7788');
    expect(AppState.normalize('  https://x.trycloudflare.com  '),
        'https://x.trycloudflare.com');
  });
}
