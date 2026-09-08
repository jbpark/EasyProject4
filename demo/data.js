/* ============================================================
   EasyProject4 데모 — Mock 데이터
   실제 서버(server.py)·DB(server/projects.db)와 무관한 가짜 데이터입니다.
   경로·브랜치·커밋 해시·세션 이름은 모두 예시입니다.
   ============================================================ */
window.DEMO = (function () {
  const D = {};

  /* ---------- 프로젝트 (projects 테이블) ---------- */
  D.projects = [
    {
      id: 1, name: 'shop-web', slug: 'shop-web',
      description: 'Next.js 쇼핑몰 프론트엔드. 결제·장바구니·상품 상세 페이지 리팩터링 진행 중.',
      model: 'sonnet', engine: 'claude', timeout_sec: 1800, retry_count: 1,
      project_root: 'D:\\work\\shop-web', session_name: '', skip_permissions: true, auto_run: true,
      status: 'active', created_at: '2026-08-12 09:40', branch: 'project/shop-web',
    },
    {
      id: 2, name: 'api-server', slug: 'api-server',
      description: 'FastAPI 백엔드. 주문 API·인증 미들웨어·테스트 커버리지 확장.',
      model: 'opus', engine: 'claude', timeout_sec: 2400, retry_count: 2,
      project_root: 'D:\\work\\api-server', session_name: 'api-dev', skip_permissions: false, auto_run: false,
      tool_perms: 'Read,Edit,Bash(pytest*)',
      status: 'active', created_at: '2026-08-20 14:05', branch: 'project/api-server',
    },
    {
      id: 3, name: 'docs-site', slug: 'docs-site',
      description: 'MkDocs 기반 사내 문서 사이트. 가이드 문서 정리와 다국어 번역.',
      model: 'haiku', engine: 'antigravity', timeout_sec: 900, retry_count: 0,
      project_root: 'D:\\work\\docs-site', session_name: '', skip_permissions: true, auto_run: true,
      status: 'active', created_at: '2026-08-28 11:20', branch: 'project/docs-site',
    },
    {
      id: 4, name: 'data-pipeline', slug: 'data-pipeline',
      description: 'Airflow DAG와 dbt 모델. 일별 집계 파이프라인 안정화 (git 없는 폴더 — worktree 미사용).',
      model: 'sonnet', engine: 'claude', timeout_sec: 3600, retry_count: 1,
      project_root: 'D:\\work\\data-pipeline', session_name: '', skip_permissions: true, auto_run: false,
      status: 'paused', created_at: '2026-09-01 16:50', branch: '',
    },
  ];

  /* ---------- 태스크 (project_tasks 테이블) ---------- */
  D.tasks = [
    // shop-web
    { id: 101, project_id: 1, title: '장바구니 수량 변경 시 합계 즉시 반영', status: 'done', trigger_type: 'manual', model_override: '', branch: 'project/shop-web/task001',
      prompt: 'components/Cart.tsx 에서 수량 변경 시 합계가 새로고침 후에만 갱신된다. 상태 업데이트를 즉시 반영하도록 수정하고, 관련 단위 테스트를 추가해줘.',
      test_criteria: 'npm test -- Cart 통과', output: 'Cart.tsx 의 useMemo 의존성 배열에 quantity 누락을 수정했습니다. Cart.test.tsx 에 수량 변경 케이스 3개를 추가했고 전체 테스트 42개 통과.',
      created_at: '2026-09-02 10:12', started_at: '2026-09-02 10:14', ended_at: '2026-09-02 10:21', author: 'jb' },
    { id: 102, project_id: 1, title: '결제 페이지 카드번호 입력 마스킹', status: 'done', trigger_type: 'claude_cli', model_override: '', branch: 'project/shop-web/task002',
      prompt: '결제 페이지의 카드번호 입력란에 4자리마다 공백을 넣고, 뒤 4자리만 보이게 마스킹해줘. 접근성(aria-label)도 챙겨줘.',
      test_criteria: '', output: 'CardInput 컴포넌트를 신설하고 formatCardNumber 유틸을 추가했습니다. Storybook 스토리 2개 포함.',
      created_at: '2026-09-03 15:30', started_at: '2026-09-03 15:31', ended_at: '2026-09-03 15:44', author: 'claude-cli' },
    { id: 103, project_id: 1, title: '상품 상세 이미지 lazy loading', status: 'running', trigger_type: 'manual', model_override: '', branch: 'project/shop-web/task003',
      prompt: '상품 상세 페이지의 이미지 갤러리에 lazy loading 을 적용하고 LCP 를 측정해 개선 전/후를 보고해줘.',
      test_criteria: 'Lighthouse LCP 2.5s 이하', output: '',
      created_at: '2026-09-07 09:02', started_at: '2026-09-07 09:05', ended_at: '', author: 'jb' },
    { id: 104, project_id: 1, title: '리뷰 목록 무한 스크롤', status: 'pending', trigger_type: 'on_dependency', trigger_meta: { depends_on: 103 }, model_override: 'opus', branch: '',
      prompt: '상품 리뷰 목록을 페이지네이션에서 무한 스크롤로 바꿔줘. IntersectionObserver 를 사용하고 로딩 스켈레톤을 넣어줘.',
      test_criteria: '', output: '', created_at: '2026-09-07 09:03', started_at: '', ended_at: '', author: 'jb' },
    { id: 105, project_id: 1, title: '주간 번들 사이즈 리포트', status: 'pending', trigger_type: 'schedule', trigger_meta: { cron: '매주 월 09:00' }, model_override: 'haiku', branch: '',
      prompt: 'npm run build 후 번들 사이즈를 측정해 지난주 대비 증감을 표로 정리해줘. 200KB 이상 늘어난 청크가 있으면 원인을 분석해줘.',
      test_criteria: '', output: '', created_at: '2026-09-01 09:00', started_at: '', ended_at: '', author: 'schedule' },
    // api-server
    { id: 201, project_id: 2, title: 'JWT 리프레시 토큰 회전(rotation) 구현', status: 'done', trigger_type: 'manual', model_override: '', branch: 'project/api-server/task001',
      prompt: 'auth/ 모듈에 리프레시 토큰 회전을 구현해줘. 재사용 감지 시 세션 전체를 무효화하고, pytest 로 시나리오 테스트를 작성해줘.',
      test_criteria: 'pytest tests/auth -q 통과', output: 'RefreshTokenStore 추가, 재사용 감지 로직과 테스트 7개 작성. 전체 128 passed.',
      created_at: '2026-09-04 10:00', started_at: '2026-09-04 10:02', ended_at: '2026-09-04 10:27', author: 'jb' },
    { id: 202, project_id: 2, title: '주문 취소 API 멱등성 보장', status: 'error', trigger_type: 'manual', model_override: '', branch: 'project/api-server/task002',
      prompt: 'POST /orders/{id}/cancel 을 멱등하게 만들어줘. Idempotency-Key 헤더를 지원하고 동일 키 재요청은 첫 응답을 그대로 돌려줘.',
      test_criteria: 'pytest tests/orders -q 통과', output: '❌ 타임아웃(2400s) 초과 — 통합 테스트가 외부 결제 모의 서버 응답을 기다리며 멈춤. 재시도 1/2 예정.',
      created_at: '2026-09-05 13:10', started_at: '2026-09-05 13:12', ended_at: '2026-09-05 13:52', author: 'jb' },
    { id: 203, project_id: 2, title: 'OpenAPI 스키마 예제 값 보강', status: 'done', trigger_type: 'antigravity_cli', model_override: '', branch: 'project/api-server/task003',
      prompt: 'Pydantic 모델마다 Field(example=...) 을 채워 Swagger UI 에서 바로 시험할 수 있게 해줘.',
      test_criteria: '', output: '31개 모델에 예제 값을 추가했습니다. /docs 에서 Try it out 시 기본값이 채워집니다.',
      created_at: '2026-09-06 11:40', started_at: '2026-09-06 11:41', ended_at: '2026-09-06 11:49', author: 'antigravity' },
    { id: 204, project_id: 2, title: '느린 쿼리 로그 기반 인덱스 추천', status: 'pending', trigger_type: 'manual', model_override: '', branch: '',
      prompt: 'logs/slow_query.log 를 분석해 상위 10개 느린 쿼리에 대한 인덱스를 추천하고 Alembic 마이그레이션 초안을 만들어줘. 실제 적용은 하지 말고 리뷰용으로만.',
      test_criteria: '', output: '', created_at: '2026-09-07 08:30', started_at: '', ended_at: '', author: 'jb' },
    // docs-site
    { id: 301, project_id: 3, title: '설치 가이드 스크린샷 최신화', status: 'done', trigger_type: 'manual', model_override: '', branch: 'project/docs-site/task001',
      prompt: 'docs/install.md 의 스크린샷 경로가 깨져 있다. assets/ 폴더의 최신 이미지로 교체하고 alt 텍스트를 넣어줘.',
      test_criteria: 'mkdocs build --strict 통과', output: '12개 이미지 경로 수정, alt 텍스트 추가. mkdocs build --strict 경고 0건.',
      created_at: '2026-09-02 17:00', started_at: '2026-09-02 17:01', ended_at: '2026-09-02 17:06', author: 'jb' },
    { id: 302, project_id: 3, title: 'FAQ 영문 번역', status: 'done', trigger_type: 'antigravity_cli', model_override: '', branch: 'project/docs-site/task002',
      prompt: 'docs/faq.ko.md 를 영어로 번역해 docs/faq.en.md 로 저장해줘. 용어는 glossary.md 를 따라줘.',
      test_criteria: '', output: 'faq.en.md 생성 (48개 Q&A). glossary 용어 17개 일관 적용.',
      created_at: '2026-09-05 09:15', started_at: '2026-09-05 09:15', ended_at: '2026-09-05 09:22', author: 'antigravity' },
    { id: 303, project_id: 3, title: '깨진 외부 링크 점검', status: 'pending', trigger_type: 'schedule', trigger_meta: { cron: '매일 07:00' }, model_override: '', branch: '',
      prompt: '모든 md 파일의 외부 링크를 점검해 404 인 링크 목록을 만들어줘. 수정은 하지 말고 리포트만.',
      test_criteria: '', output: '', created_at: '2026-09-01 07:00', started_at: '', ended_at: '', author: 'schedule' },
    // data-pipeline
    { id: 401, project_id: 4, title: '일별 매출 집계 DAG 재시도 정책', status: 'done', trigger_type: 'manual', model_override: '', branch: '',
      prompt: 'dags/daily_sales.py 의 재시도 정책을 3회·지수 백오프로 바꾸고 실패 시 Slack 알림 태스크를 추가해줘.',
      test_criteria: '', output: 'default_args 수정, on_failure_callback 으로 Slack 알림 연결. (git 없는 폴더라 worktree 없이 직접 실행)',
      created_at: '2026-09-03 13:00', started_at: '2026-09-03 13:01', ended_at: '2026-09-03 13:09', author: 'jb' },
    { id: 402, project_id: 4, title: 'dbt 모델 테스트 추가', status: 'pending', trigger_type: 'manual', model_override: '', branch: '',
      prompt: 'models/marts/ 아래 모델에 not_null, unique 테스트를 추가하고 dbt test 결과를 요약해줘.',
      test_criteria: 'dbt test 통과', output: '', created_at: '2026-09-06 18:20', started_at: '', ended_at: '', author: 'jb' },
  ];

  /* ---------- 실행 로그 (task_runs 테이블) ---------- */
  const L = (t, cls, msg) => ({ t, cls, msg });
  D.runs = [
    {
      id: 9007, task_id: 103, project_id: 1, task_title: '상품 상세 이미지 lazy loading', project_name: 'shop-web', attempt: 1,
      status: 'running', trigger_type: 'manual', model: 'sonnet', started_at: '2026-09-07 09:05:02', ended_at: '',
      trace_id: 'a1f3c9e2d4b8', span_id: '7e21', git_task_branch: 'project/shop-web/task003', git_proj_branch: 'project/shop-web', git_merge_status: '',
      commits: [], diff: [],
      log: [
        L('09:05:02', 'sys', '[harness] 태스크 #103 시작 — project=shop-web model=sonnet timeout=1800s'),
        L('09:05:02', 'git', '[git] worktree add server/worktrees/shop-web/task003 -b project/shop-web/task003'),
        L('09:05:03', 'claude', '[claude] claude -p --model sonnet --dangerously-skip-permissions'),
        L('09:05:11', 'claude', '[claude] 상품 상세 페이지 구조를 파악하기 위해 components/product/ 를 읽고 있습니다.'),
        L('09:05:29', 'claude', '[claude] Gallery.tsx 의 <img> 12개에 loading="lazy" 와 decoding="async" 를 적용합니다.'),
        L('09:05:47', 'claude', '[claude] 첫 이미지는 LCP 대상이므로 fetchpriority="high" 로 예외 처리합니다.'),
        L('09:06:10', '', '[claude] npm run build 실행 중...'),
      ],
    },
    {
      id: 9006, task_id: 203, project_id: 2, task_title: 'OpenAPI 스키마 예제 값 보강', project_name: 'api-server', attempt: 1,
      status: 'done', trigger_type: 'antigravity_cli', model: 'gemini', started_at: '2026-09-06 11:41:10', ended_at: '2026-09-06 11:49:33',
      trace_id: '5b7d0e9a1c22', span_id: '3fa0', git_task_branch: 'project/api-server/task003', git_proj_branch: 'project/api-server', git_merge_status: 'merged→main',
      commits: [{ sha: 'e4a91c7', msg: 'docs(api): add Field examples to 31 pydantic models' }],
      diff: [{ file: 'app/schemas/order.py', add: 48, del: 6 }, { file: 'app/schemas/user.py', add: 22, del: 3 }, { file: 'app/schemas/payment.py', add: 35, del: 4 }],
      log: [
        L('11:41:10', 'sys', '[hook] Antigravity CLI UserPromptSubmit → 태스크 #203 자동 등록 (trigger=antigravity_cli)'),
        L('11:41:11', 'git', '[git] worktree add … -b project/api-server/task003'),
        L('11:48:50', 'sys', '[hook] Stop → 응답 기록 (2,318자)'),
        L('11:49:20', 'git', '[git] commit e4a91c7 · 3 files changed, 105 insertions(+), 13 deletions(-)'),
        L('11:49:31', 'git', '[git] merge project/api-server/task003 → project/api-server → main (fast-forward)'),
        L('11:49:33', 'sys', '[harness] 완료 (8m 23s)'),
      ],
    },
    {
      id: 9005, task_id: 202, project_id: 2, task_title: '주문 취소 API 멱등성 보장', project_name: 'api-server', attempt: 1,
      status: 'error', trigger_type: 'manual', model: 'opus', started_at: '2026-09-05 13:12:00', ended_at: '2026-09-05 13:52:00',
      trace_id: 'c08e2f6b9d41', span_id: '91b7', git_task_branch: 'project/api-server/task002', git_proj_branch: 'project/api-server', git_merge_status: 'skipped (error)',
      commits: [], diff: [{ file: 'app/api/orders.py', add: 61, del: 9 }, { file: 'app/core/idempotency.py', add: 88, del: 0 }],
      log: [
        L('13:12:00', 'sys', '[harness] 태스크 #202 시작 — model=opus timeout=2400s tool_perms=Read,Edit,Bash(pytest*)'),
        L('13:12:01', 'git', '[git] worktree add … -b project/api-server/task002'),
        L('13:14:40', 'claude', '[claude] IdempotencyMiddleware 를 추가하고 Redis 키 TTL 24h 로 저장합니다.'),
        L('13:20:12', 'claude', '[claude] pytest tests/orders -q 실행'),
        L('13:35:00', 'warn', '[harness] 15분간 출력 없음 — 프로세스 대기 중 (외부 결제 모의 서버 응답 대기로 추정)'),
        L('13:52:00', 'err', '[harness] 타임아웃 2400s 초과 → 프로세스 종료. 변경 사항은 worktree 에 보존됨'),
        L('13:52:00', 'err', '[harness] status=error · retry 1/2 는 다음 실행 시 자동 시도'),
      ],
    },
    {
      id: 9004, task_id: 302, project_id: 3, task_title: 'FAQ 영문 번역', project_name: 'docs-site', attempt: 1,
      status: 'done', trigger_type: 'antigravity_cli', model: 'gemini', started_at: '2026-09-05 09:15:20', ended_at: '2026-09-05 09:22:05',
      trace_id: '77d1a4e0bb3c', span_id: 'c2e5', git_task_branch: 'project/docs-site/task002', git_proj_branch: 'project/docs-site', git_merge_status: 'merged→main',
      commits: [{ sha: '1f0be32', msg: 'docs: add English FAQ (48 entries)' }],
      diff: [{ file: 'docs/faq.en.md', add: 312, del: 0 }, { file: 'mkdocs.yml', add: 4, del: 1 }],
      log: [
        L('09:15:20', 'sys', '[hook] Antigravity CLI → 태스크 #302 등록'),
        L('09:21:40', 'git', '[git] commit 1f0be32 · 2 files changed, 316 insertions(+), 1 deletion(-)'),
        L('09:22:05', 'sys', '[harness] 완료 (6m 45s)'),
      ],
    },
    {
      id: 9003, task_id: 201, project_id: 2, task_title: 'JWT 리프레시 토큰 회전(rotation) 구현', project_name: 'api-server', attempt: 1,
      status: 'done', trigger_type: 'manual', model: 'opus', started_at: '2026-09-04 10:02:00', ended_at: '2026-09-04 10:27:41',
      trace_id: 'ee902bd4a7f1', span_id: '58aa', git_task_branch: 'project/api-server/task001', git_proj_branch: 'project/api-server', git_merge_status: 'merged→main',
      commits: [{ sha: '9c3d7a1', msg: 'feat(auth): refresh token rotation with reuse detection' }, { sha: 'b02f4e8', msg: 'test(auth): add 7 rotation scenarios' }],
      diff: [{ file: 'app/auth/tokens.py', add: 96, del: 21 }, { file: 'app/auth/store.py', add: 74, del: 0 }, { file: 'tests/auth/test_rotation.py', add: 141, del: 0 }],
      log: [
        L('10:02:00', 'sys', '[harness] 태스크 #201 시작 — session=api-dev (PTY 세션으로 프롬프트 전달)'),
        L('10:02:01', 'git', '[git] worktree add … -b project/api-server/task001'),
        L('10:09:33', 'claude', '[claude] 재사용 감지: 이미 회전된 refresh 토큰이 다시 오면 family 전체를 폐기합니다.'),
        L('10:25:10', 'claude', '[claude] pytest tests/auth -q → 128 passed in 14.2s'),
        L('10:27:20', 'git', '[git] 2 commits · merge → project/api-server → main'),
        L('10:27:41', 'sys', '[harness] 완료 (25m 41s)'),
      ],
    },
    {
      id: 9002, task_id: 102, project_id: 1, task_title: '결제 페이지 카드번호 입력 마스킹', project_name: 'shop-web', attempt: 1,
      status: 'done', trigger_type: 'claude_cli', model: 'sonnet', started_at: '2026-09-03 15:31:05', ended_at: '2026-09-03 15:44:12',
      trace_id: '3a6f81c2e9d0', span_id: 'd71c', git_task_branch: 'project/shop-web/task002', git_proj_branch: 'project/shop-web', git_merge_status: 'merged→main',
      commits: [{ sha: '4d2e9b0', msg: 'feat(checkout): masked card number input with a11y labels' }],
      diff: [{ file: 'components/checkout/CardInput.tsx', add: 118, del: 0 }, { file: 'lib/formatCardNumber.ts', add: 27, del: 0 }, { file: 'components/checkout/CardInput.stories.tsx', add: 40, del: 0 }],
      log: [
        L('15:31:05', 'sys', '[hook] Claude CLI UserPromptSubmit → 태스크 #102 자동 등록 (trigger=claude_cli)'),
        L('15:43:50', 'sys', '[hook] Stop → 응답 기록'),
        L('15:44:12', 'git', '[git] commit 4d2e9b0 → merge main'),
      ],
    },
    {
      id: 9001, task_id: 401, project_id: 4, task_title: '일별 매출 집계 DAG 재시도 정책', project_name: 'data-pipeline', attempt: 1,
      status: 'done', trigger_type: 'manual', model: 'sonnet', started_at: '2026-09-03 13:01:00', ended_at: '2026-09-03 13:09:12',
      trace_id: 'b5c07e1d3f92', span_id: '2ae9', git_task_branch: '', git_proj_branch: '', git_merge_status: 'no git',
      commits: [], diff: [],
      log: [
        L('13:01:00', 'sys', '[harness] 태스크 #401 시작'),
        L('13:01:00', 'warn', '[git] project_root 에 .git 없음 → worktree 없이 직접 실행'),
        L('13:08:50', 'claude', '[claude] default_args retries=3, retry_exponential_backoff=True 적용'),
        L('13:09:12', 'sys', '[harness] 완료 (8m 12s)'),
      ],
    },
    {
      id: 9000, task_id: 101, project_id: 1, task_title: '장바구니 수량 변경 시 합계 즉시 반영', project_name: 'shop-web', attempt: 1,
      status: 'done', trigger_type: 'manual', model: 'sonnet', started_at: '2026-09-02 10:14:00', ended_at: '2026-09-02 10:21:30',
      trace_id: '0d9e4b2a6c17', span_id: 'f03b', git_task_branch: 'project/shop-web/task001', git_proj_branch: 'project/shop-web', git_merge_status: 'merged→main',
      commits: [{ sha: 'a7c31e5', msg: 'fix(cart): recompute total immediately on quantity change' }],
      diff: [{ file: 'components/Cart.tsx', add: 9, del: 4 }, { file: 'components/Cart.test.tsx', add: 52, del: 0 }],
      log: [
        L('10:14:00', 'sys', '[harness] 태스크 #101 시작'),
        L('10:20:55', 'claude', '[claude] npm test -- Cart → 42 passed'),
        L('10:21:30', 'git', '[git] commit a7c31e5 → merge main'),
      ],
    },
  ];

  /* 데모 "실행" 시 흘려보낼 가짜 로그 (순서대로 재생) */
  D.simLog = [
    ['sys', '[harness] 태스크 시작 — worktree 브랜치 생성'],
    ['git', '[git] worktree add server/worktrees/{slug}/task{n} -b project/{slug}/task{n}'],
    ['claude', '[claude] claude -p --model {model} 실행'],
    ['claude', '[claude] 관련 파일을 읽고 변경 범위를 파악하고 있습니다…'],
    ['claude', '[claude] 코드를 수정하고 테스트를 추가합니다.'],
    ['', '[claude] 테스트 실행 중… 통과'],
    ['git', '[git] commit · merge project/{slug}/task{n} → project/{slug} → main'],
    ['sys', '[harness] 완료 · SSE run_done 발행'],
  ];

  /* ---------- 세션 (PTY / Claude CLI / Antigravity CLI) ---------- */
  D.sessions = [
    { name: 'api-dev', kind: 'claude', status: 'idle', pid: 18240, model: 'opus', cwd: 'D:\\work\\api-server', created_at: '2026-09-07 08:12', last_ts: '2026-09-07 09:01',
      lines: [
        ['p', 'D:\\work\\api-server> claude --model opus'],
        ['c', '╭─ Claude Code · session api-dev ─────────────────╮'],
        ['c', '│ 프로젝트: api-server                            │'],
        ['c', '╰────────────────────────────────────────────────╯'],
        ['', '> 느린 쿼리 로그를 분석해서 인덱스 추천안을 만들어줘'],
        ['d', '  [ep4 hook] 태스크 #204 로 등록됨 (trigger=claude_cli)'],
        ['', '  logs/slow_query.log 에서 상위 10개 쿼리를 추출했습니다…'],
      ] },
    { name: 'shop-term', kind: 'pty', status: 'busy', pid: 20411, model: '', cwd: 'D:\\work\\shop-web', created_at: '2026-09-07 08:55', last_ts: '2026-09-07 09:06',
      lines: [
        ['p', 'D:\\work\\shop-web> npm run build'],
        ['', '> shop-web@2.4.1 build'],
        ['', '> next build'],
        ['d', '   Creating an optimized production build ...'],
        ['', ' ✓ Compiled successfully'],
        ['', ' ✓ Collecting page data'],
        ['d', '   Generating static pages (12/38) ...'],
      ] },
    { name: 'docs-gemini', kind: 'antigravity', status: 'idle', pid: 17093, model: 'gemini', cwd: 'D:\\work\\docs-site', created_at: '2026-09-06 11:30', last_ts: '2026-09-06 11:49',
      lines: [
        ['p', 'D:\\work\\docs-site> gemini'],
        ['c', ' Antigravity CLI · docs-site'],
        ['', '> FAQ 문서를 영어로 번역해줘'],
        ['d', '  [ep4 hook] 태스크 #302 로 등록됨 (trigger=antigravity_cli)'],
        ['', '  docs/faq.en.md 를 생성했습니다 (48개 항목).'],
      ] },
    { name: 'old-term', kind: 'pty', status: 'dead', pid: 0, model: '', cwd: 'D:\\work', created_at: '2026-09-05 17:40', last_ts: '2026-09-05 18:02',
      lines: [['d', '(세션 종료됨 — 프로세스가 존재하지 않습니다)']] },
  ];

  /* ---------- 확장(플러그인) ---------- */
  D.plugins = {
    installed: [
      { id: 'dashboard', type: 'view', name: '대시보드', icon: '📊', version: '1.0.0', enabled: true, required: false, desc: '프로젝트 현황과 태스크 통계를 한눈에 봅니다.' },
      { id: 'plugins', type: 'view', name: '확장', icon: '🧩', version: '2.8.0', enabled: true, required: true, desc: 'View 플러그인·MCP 커넥터·Claude Skill·도우미를 설치·삭제·관리합니다.' },
      { id: 'projects', type: 'view', name: '프로젝트', icon: '🗂', version: '1.0.0', enabled: true, required: false, desc: '프로젝트를 생성·관리하고 태스크를 묶어 순차 실행합니다.' },
      { id: 'tasks', type: 'view', name: '태스크', icon: '✅', version: '1.0.0', enabled: true, required: false, desc: '선택한 프로젝트의 태스크를 등록·수정·실행합니다.' },
      { id: 'runlog', type: 'view', name: '실행 로그', icon: '📋', version: '1.0.0', enabled: true, required: false, desc: '태스크 실행 내역을 시간순으로 보고 로그·diff·커밋을 확인합니다.' },
      { id: 'sessions', type: 'view', name: '세션', icon: '🖥', version: '1.1.0', enabled: true, required: false, desc: '명령프롬프트(PTY)·Claude CLI·Antigravity CLI 세션을 보고 관리합니다.' },
      { id: 'help', type: 'view', name: '도움말', icon: '❓', version: '1.0.0', enabled: true, required: false, desc: 'EP4 사용법과 외부 연동 API를 안내합니다.' },
      { id: 'kanban', type: 'view', name: '칸반 보드', icon: '🗃', version: '0.9.2', enabled: false, required: false, desc: '태스크를 상태별 칸반 보드로 봅니다. (마켓에서 설치한 예시)' },
      { id: 'github-mcp', type: 'mcp', name: 'GitHub MCP', icon: '🐙', version: '1.3.0', enabled: true, required: false, desc: 'Claude CLI 에 GitHub 이슈/PR 도구를 연결하는 MCP 커넥터.' },
      { id: 'code-review-skill', type: 'claude', name: 'Code Review Skill', icon: '🔍', version: '1.0.4', enabled: true, required: false, desc: '/code-review 스킬 — diff 를 정확성·보안 관점으로 점검합니다.' },
      { id: 'octopus', type: 'agent', name: '문어', icon: '🐙', version: '1.0.0', enabled: true, required: false, desc: '귀여운 문어 GIF 마스코트. 화면을 돌아다니며 응원해 줍니다.' },
      { id: 'penguin', type: 'agent', name: '펭귄', icon: '🐧', version: '1.0.0', enabled: false, required: false, desc: '시원한 펭귄 이모지 마스코트. 뿅뿅 빠르게 움직이며 기다립니다.' },
      { id: 'cat', type: 'agent', name: '고양이', icon: '🐱', version: '1.0.0', enabled: false, required: false, desc: '야옹~ 고양이 이모지 마스코트. 꾹꾹이 중에도 곁을 지켜줍니다.' },
      { id: 'dog', type: 'agent', name: '강아지', icon: '🐶', version: '1.0.0', enabled: false, required: false, desc: '멍멍! 강아지 이모지 마스코트. 꼬리 흔들며 늘 대기 중입니다.' },
    ],
    market: [
      { id: 'slack-notify', type: 'mcp', name: 'Slack 알림', icon: '💬', version: '1.2.0', author: 'community', installs: 128, desc: '태스크 완료·실패 시 Slack 채널로 알림을 보냅니다. ep4_on_task_done 훅 사용.' },
      { id: 'notion-sync', type: 'mcp', name: 'Notion 동기화', icon: '📝', version: '0.8.1', author: 'community', installs: 64, desc: '완료된 태스크 출력을 Notion 페이지로 내보냅니다.' },
      { id: 'gantt', type: 'view', name: '간트 차트', icon: '📅', version: '1.0.0', author: 'community', installs: 91, desc: '프로젝트별 태스크 일정을 간트 차트로 표시합니다.' },
      { id: 'kanban', type: 'view', name: '칸반 보드', icon: '🗃', version: '0.9.2', author: 'community', installs: 203, desc: '태스크를 상태별 칸반 보드로 봅니다.', installed: true },
      { id: 'security-review-skill', type: 'claude', name: 'Security Review Skill', icon: '🛡', version: '1.1.0', author: 'community', installs: 77, desc: '/security-review 스킬 — 변경 사항의 보안 취약점을 점검합니다.' },
      { id: 'fox', type: 'agent', name: '여우', icon: '🦊', version: '1.0.0', author: 'community', installs: 45, desc: '영리한 여우 마스코트. 실행 중에는 꼬리를 흔듭니다.' },
    ],
    dataKeys: [
      { key: 'kanban_columns', label: '칸반 컬럼 설정', plugin: '칸반 보드', pluginId: 'kanban', type: 'json', size: '1.2 KB', installed: true },
      { key: 'gantt_zoom', label: '간트 확대 수준', plugin: '간트 차트', pluginId: 'gantt', type: 'string', size: '12 B', installed: false },
    ],
  };

  /* ---------- 대시보드 통계 ---------- */
  D.last7 = [
    { d: '09-01', runs: 2 }, { d: '09-02', runs: 3 }, { d: '09-03', runs: 4 }, { d: '09-04', runs: 2 },
    { d: '09-05', runs: 5 }, { d: '09-06', runs: 3 }, { d: '09-07', runs: 1 },
  ];
  D.system = [
    { name: 'EP4 서버', st: 'localhost:7788', ok: true },
    { name: 'Claude CLI', st: 'v2.1 · 연결됨', ok: true },
    { name: 'Antigravity CLI', st: '연결됨', ok: true },
    { name: 'Git', st: '2.47 · worktree 사용', ok: true },
    { name: 'Cloudflare 터널', st: '꺼짐', ok: false },
  ];

  /* ---------- 도우미 Q&A ---------- */
  D.helper = {
    quick: ['EP4가 뭐예요?', '태스크는 어떻게 실행돼요?', 'worktree는 왜 써요?', 'CLI 훅이 뭐예요?', '모바일에서도 돼요?'],
    answers: [
      { k: ['뭐예요', '무엇', 'ep4', '소개'], a: 'EasyProject4(EP4)는 로컬 PC의 Claude CLI에게 일을 시키는 태스크 하네스예요. 프로젝트별로 할 일을 큐에 쌓아두면 순서대로 Claude CLI를 실행하고, Git 브랜치 격리 → 커밋 → main 머지까지 자동으로 처리해요.' },
      { k: ['실행', '어떻게'], a: '태스크 화면에서 태스크를 등록하고 왼쪽 "실행"을 누르면 하네스가 대기 중인 태스크를 순서대로 처리해요. 실행 중 추가한 태스크는 큐에 쌓여 이어서 실행돼요. 이 데모에서도 "실행"을 눌러 가짜 실행을 볼 수 있어요!' },
      { k: ['worktree', '브랜치', 'git'], a: 'project_root 에 git 이 있으면 태스크마다 project/{slug}/taskNNN 브랜치의 worktree 에서 격리 실행해요. 완료되면 프로젝트 브랜치를 거쳐 main 까지 자동 머지하고, 충돌이 나면 안전하게 멈춰요.' },
      { k: ['훅', 'hook', 'cli', 'mcp'], a: 'Claude CLI 의 UserPromptSubmit / Stop 훅에 EP4 스크립트를 등록하면 터미널에서 나눈 대화가 자동으로 태스크와 실행 로그로 기록돼요. Gemini CLI(Antigravity)도 같은 훅을 재사용해요.' },
      { k: ['모바일', '폰', '터널', 'flutter'], a: 'Flutter 앱이 있어요. tunnel.bat 으로 Cloudflare 임시 터널을 열고 헤더의 📱 QR 을 스캔하면 폰에서 태스크 지시·실행·로그 확인이 가능해요.' },
      { k: ['세션', 'pty'], a: '세션 화면에서 명령프롬프트(PTY)·Claude CLI·Antigravity CLI 세션을 띄워두고, 프로젝트에 session_name 을 지정하면 subprocess 대신 그 세션으로 프롬프트를 전달해요.' },
      { k: ['플러그인', '확장', '마켓'], a: '확장 화면에서 View 플러그인·MCP 커넥터·Claude Skill·도우미를 설치/삭제해요. 백엔드 플러그인은 pluggy 훅(backend.py) 으로, 화면은 plugin.json + view.js 로 만들어요.' },
    ],
    fallback: '데모 도우미라서 정해진 답만 할 수 있어요 🐙 아래 빠른 질문을 눌러보거나, 실제 EP4 에서는 도우미 플러그인을 통해 Claude 가 답해줘요.',
  };

  return D;
})();
