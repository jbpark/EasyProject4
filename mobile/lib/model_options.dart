/// 엔진별 선택 가능한 모델 목록 — 웹 대시보드(pjFormModel)와 동일하게 유지한다.
/// 성능이 좋은 모델부터 정렬.
const Map<String, String> kClaudeModels = {
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
};

/// 프로젝트 기본 모델.
const String kDefaultModel = 'claude-fable-5';

const Map<String, String> kAntigravityModels = {
  '': '기본값 (CLI 설정)',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};

/// 엔진에 맞는 모델 목록.
Map<String, String> modelsFor(String engine) =>
    engine == 'antigravity' ? kAntigravityModels : kClaudeModels;

/// 모델 id → 표시 라벨 (목록에 없으면 id 그대로).
String modelLabel(String id) =>
    kClaudeModels[id] ?? kAntigravityModels[id] ?? (id.isEmpty ? '기본' : id);
