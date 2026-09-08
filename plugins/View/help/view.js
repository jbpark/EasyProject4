/**
 * 도움말 View — EP4 사용법 + 외부 연동 API 레퍼런스
 *
 * 섹션 앵커로 이동한다: #/view/help?section=api
 */

const esc = (s) => (window.esc ? window.esc(s)
  : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
const showAlert = (m, o) => (window.showAlert ? window.showAlert(m, o) : alert(m));

// ── i18n ──────────────────────────────────────────────────
const _HELP_I18N = {
  ko: {
    nav_overview: '개요',
    nav_session:  '태스크 세션',
    nav_api:      'API',
    nav_cli:      '실행 명령',

    overview_title: 'EasyProject4',
    overview_desc:  '로컬 PC 에서 Claude CLI 로 프로젝트·태스크를 관리하고 순차 실행하는 하네스입니다. 프로젝트에 태스크를 쌓아 두면 순서대로 실행하고, 실행 내역은 실행 로그에 남습니다.',
    overview_flow:  '프로젝트 만들기 → 태스크 등록 → 실행 → 실행 로그에서 결과 확인',
    overview_root:  '프로젝트에 프로젝트 루트를 지정하고 그 경로에 git 이 있으면, 태스크마다 격리된 worktree 를 만들어 실행한 뒤 프로젝트 브랜치로 머지합니다.',

    session_title: '태스크 실행 세션',
    session_desc:  '태스크를 추가·수정할 때 어느 세션에서 실행할지 고를 수 있습니다.',
    session_default_t: '프로젝트 기본',
    session_default_d: '프로젝트에 설정된 세션으로 실행합니다. 설정이 없으면 CLI 를 직접 실행합니다.',
    session_prev_t: '이전 태스크 세션',
    session_prev_d: '이 프로젝트에서 마지막으로 실행한 세션을 이어서 씁니다. 남아 있는 세션이 없으면 프로젝트 기본으로 실행합니다.',
    session_claude_t: '클로드 세션 (이어서 실행)',
    session_claude_d: '이 프로젝트가 실행했던 Claude 대화를 --resume 으로 이어받습니다. 그 대화가 원래 돌던 디렉토리에서 실행되므로 태스크 worktree 격리는 적용되지 않습니다.',
    session_new_t: '신규 세션 만들기',
    session_new_d: '실행할 때 세션을 새로 만들어 그 안에서 실행합니다.',

    api_title: '외부 연동 API',
    api_auth_t: '인증',
    api_auth_d: '모든 /api/ 요청에는 토큰이 필요합니다. Authorization 헤더나 ep4_token 쿠키로 보냅니다. 토큰은 서버 첫 기동 시 conf/ep4.local.conf 에 만들어지며, 웹은 첫 접속 로그인 화면에서 입력합니다.',
    api_addtask_t: '태스크 추가',
    api_addtask_d: '프로젝트를 이름으로 지정해 태스크를 등록합니다. project_name 과 prompt 만 있으면 되고, 나머지는 비우면 기본값이 적용됩니다.',
    api_gettask_t: '태스크 상태 조회',
    api_projlist_t: '프로젝트 목록',
    api_puttask_t: '태스크 수정',
    api_puttask_d: '보낸 키만 부분 수정합니다. 보내지 않은 필드는 그대로 유지되므로, 바꿀 항목만 담아 보내면 됩니다. 응답은 상태 조회와 같은 형식에 실제로 바뀐 필드 목록(changed)이 더해집니다. 수정만 하고 실행을 걸지는 않습니다.',
    api_projlist_d: '등록된 프로젝트의 이름과 id 를 돌려줍니다. 태스크를 추가할 때 쓸 project_name 을 확인하는 용도입니다.',
    api_projdet_t: '프로젝트 상세',
    api_projdet_d: '프로젝트 설정과 함께 태스크 목록(id · 제목 · 상태)을 돌려줍니다.',
    api_gettask_d: '태스크 추가 응답으로 받은 id 로 현재 상태를 조회합니다. 실행이 끝났는지 폴링할 때 씁니다. output 은 기본 2000자까지만 주고, 전체가 필요하면 full=1 을 붙입니다.',
    api_query: '쿼리 파라미터',
    api_fields: '주요 응답 필드',
    api_params: '파라미터',
    api_req: '필수',
    api_opt: '선택',
    api_default: '기본값',
    api_desc_col: '설명',
    api_name_col: '이름',
    api_example: '요청 예시',
    api_response: '응답',
    api_errors: '오류',
    api_runstate: '자동 실행 (응답의 status 필드)',
    api_runstate_d: "trigger 가 on_dependency 이고 프로젝트의 '자동 실행 활성화' 가 켜져 있으면, 태스크를 넣는 즉시 하네스를 띄워 선행 태스크부터 순서대로 실행합니다. 화면에서 태스크를 추가할 때도 같은 규칙이 적용됩니다. Claude CLI 훅이 남기는 기록(claude_cli)은 이미 실행된 내용이라 자동 실행되지 않습니다.",
    api_copy: '복사',
    api_copied: '복사됨',
    api_copy_failed: '복사 실패',

    cli_title: '실행 명령',
    cli_desc: '프로젝트 루트에서 실행합니다.',
  },
  en: {
    nav_overview: 'Overview',
    nav_session:  'Task session',
    nav_api:      'API',
    nav_cli:      'Commands',

    overview_title: 'EasyProject4',
    overview_desc:  'A harness that manages and sequentially runs projects and tasks with the Claude CLI on your local machine. Queue tasks on a project and they run in order; every run is recorded in the run log.',
    overview_flow:  'Create a project → add tasks → run → check results in the run log',
    overview_root:  'If a project has a project root and that path is a git repo, each task runs in an isolated worktree and is then merged into the project branch.',

    session_title: 'Task execution session',
    session_desc:  'When adding or editing a task you can choose which session it runs in.',
    session_default_t: 'Project default',
    session_default_d: 'Runs in the session configured on the project. With none configured, the CLI is invoked directly.',
    session_prev_t: 'Previous task session',
    session_prev_d: 'Reuses the session the last run of this project used. Falls back to the project default when none is still alive.',
    session_claude_t: 'Claude session (resume)',
    session_claude_d: 'Resumes a Claude conversation this project ran, via --resume. It runs in the directory that conversation originally used, so task worktree isolation does not apply.',
    session_new_t: 'Create new session',
    session_new_d: 'Creates a fresh session at run time and runs inside it.',

    api_title: 'Integration API',
    api_auth_t: 'Authentication',
    api_auth_d: 'Every /api/ request needs a token, sent as an Authorization header or an ep4_token cookie. The token is generated into conf/ep4.local.conf on first server start; the web UI asks for it on first visit.',
    api_addtask_t: 'Add a task',
    api_addtask_d: 'Registers a task, addressing the project by name. Only project_name and prompt are required; anything left out falls back to its default.',
    api_gettask_t: 'Task status',
    api_projlist_t: 'Project list',
    api_puttask_t: 'Update a task',
    api_puttask_d: 'Partially updates only the keys you send; anything omitted keeps its current value. The response matches the status lookup plus a changed list of the fields actually written. Updating never starts a run.',
    api_projlist_d: 'Returns the name and id of every registered project — use it to find the project_name for adding tasks.',
    api_projdet_t: 'Project detail',
    api_projdet_d: 'Returns the project settings along with its task list (id, title, status).',
    api_gettask_d: 'Looks up the current state by the id returned when the task was added — use it to poll for completion. output is capped at 2000 chars unless you pass full=1.',
    api_query: 'Query parameters',
    api_fields: 'Key response fields',
    api_params: 'Parameters',
    api_req: 'required',
    api_opt: 'optional',
    api_default: 'Default',
    api_desc_col: 'Description',
    api_name_col: 'Name',
    api_example: 'Example request',
    api_response: 'Response',
    api_errors: 'Errors',
    api_runstate: 'Auto-run (the status field)',
    api_runstate_d: "When trigger is on_dependency and the project has auto-run enabled, the harness starts as soon as the task is added and works through pending tasks in order. Adding a task from the UI follows the same rule. Records left by the Claude CLI hook (claude_cli) never auto-run, since they describe work that already ran.",
    api_copy: 'Copy',
    api_copied: 'Copied',
    api_copy_failed: 'Copy failed',

    cli_title: 'Commands',
    cli_desc: 'Run these from the project root.',
  },
};
const _hT = (k) => {
  const d = _HELP_I18N[window._EP4_LANG || 'ko'] || _HELP_I18N.ko;
  return d[k] || _HELP_I18N.ko[k] || k;
};

// ── /api/task 파라미터 명세 (표 렌더용) ─────────────────────
const API_TASK_PARAMS = [
  { name: 'project_name', req: true,  def: '—',
    ko: '태스크를 등록할 프로젝트 이름. 대소문자를 가리지 않으며, 같은 이름이 여럿이면 먼저 만든 프로젝트를 씁니다.',
    en: 'Name of the project to add the task to. Case-insensitive; if several share a name the oldest one is used.' },
  { name: 'prompt', req: true, def: '—',
    ko: 'Claude 에게 보낼 프롬프트. 태스크 본문입니다.',
    en: 'The prompt sent to Claude — the task body.' },
  { name: 'title', req: false, def: 'prompt 첫 줄',
    ko: '태스크 제목. 비우면 프롬프트의 첫 줄(100자까지)을 제목으로 씁니다.',
    en: 'Task title. Left empty, the first line of the prompt (up to 100 chars) is used.' },
  { name: 'test', req: false, def: "''",
    ko: '완료 판정 기준. 실행 결과를 사람이 확인할 때 쓰는 메모입니다.',
    en: 'Completion criteria — a note used when reviewing the run.' },
  { name: 'model', req: false, def: '프로젝트 모델',
    ko: '이 태스크만 다른 모델로 실행할 때 지정합니다. 예: claude-opus-5',
    en: 'Overrides the model for this task only. e.g. claude-opus-5' },
  { name: 'trigger', req: false, def: 'on_dependency',
    ko: 'manual · on_dependency · schedule 중 하나. 다른 값을 보내면 400 을 돌려줍니다. on_dependency 면 추가 즉시 자동 실행됩니다(아래 참고).',
    en: 'One of manual, on_dependency, schedule. Any other value returns 400.' },
  { name: 'run', req: false, def: 'trigger 에 따름',
    ko: '자동 실행 강제/억제(요청 파라미터). true 면 트리거·자동 실행 설정과 무관하게 바로 실행하고, false 면 큐에만 넣습니다. 결과는 응답의 status 로 돌아옵니다.',
    en: 'Forces or suppresses the run. true starts immediately regardless of trigger and project settings, false only queues. Omitted, the trigger rule applies.' },
  { name: 'session', req: false, def: "''",
    ko: "실행 세션. '' 프로젝트 기본 · __prev__ 이전 태스크 세션 · __new__ 신규 세션 · claude:<세션ID> 클로드 세션 이어서 실행 · 그 외는 실행 중인 대화형 세션 이름.",
    en: "Execution session. '' project default, __prev__ previous task session, __new__ a new session, claude:<id> resume that Claude session, anything else names a running interactive session." },
];

const API_TASK_CURL = `curl -X POST http://localhost:7788/api/task \\
  -H "Authorization: Bearer <EP4_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_name": "easy_project4",
    "prompt": "README 의 설치 절차를 최신 상태로 고쳐줘"
  }'`;

const API_TASK_RESPONSE = `{
  "ok": true,
  "id": 412,
  "uid": "9f2c…",
  "project_id": 13,
  "project_name": "easy_project4",
  "title": "README 의 설치 절차를 최신 상태로 고쳐줘",
  "status": "started"
}`;

// 추가 응답의 run 필드 — 태스크를 넣은 뒤 실제로 실행이 걸렸는지
const API_RUN_STATES = [
  ['started', '하네스를 새로 띄워 실행을 시작했습니다.'],
  ['queued',  '이미 그 프로젝트가 실행 중이라, 진행 중인 하네스가 선행 태스크를 끝낸 뒤 이어서 처리합니다.'],
  ['auto_run_off', "trigger 는 맞지만 프로젝트의 '자동 실행 활성화' 가 꺼져 있어 걸지 않았습니다."],
  ['skipped', 'run:false 로 명시해 걸지 않았습니다.'],
  ['그 외', 'trigger 값이 그대로 돌아옵니다(manual · schedule · claude_cli 등). 자동 실행은 on_dependency 일 때만 걸립니다.'],
];

// POST /api/task 응답 필드
const API_POST_FIELDS = [
  ['ok', '요청 성공 여부'],
  ['id', '만들어진 태스크 id — 이후 상태 조회·수정에 씁니다'],
  ['uid', '태스크 전역 식별자(동기화용)'],
  ['project_id', '실제로 등록된 프로젝트 id — 같은 이름이 여럿일 때 어느 쪽인지 알려줍니다'],
  ['project_name', '등록된 프로젝트 이름'],
  ['title', '실제 저장된 제목 — 비워 보냈으면 프롬프트 첫 줄이 들어갑니다'],
  ['status', '자동 실행 결과. 아래 표 참고'],
];

const API_TASK_ERRORS = [
  ['400', 'project_name is required', 'project_name 을 보내지 않음'],
  ['400', 'prompt is required', 'prompt 가 비어 있음'],
  ['400', 'invalid trigger: …', 'trigger 값이 허용 목록 밖 (allowed 필드에 가능한 값 동봉)'],
  ['404', 'project not found: …', '그 이름의 프로젝트가 없음'],
  ['401', 'unauthorized', '토큰이 없거나 틀림'],
];

// ── GET /api/task/{id} 명세 ────────────────────────────────
const API_GET_QUERY = [
  { name: 'full', req: false, def: '0',
    ko: '1 이면 output 을 자르지 않고 전체를 돌려줍니다. 기본은 2000자까지.',
    en: 'Set to 1 to get the full output instead of the first 2000 chars.' },
];

const API_GET_FIELDS = [
  ['status', "pending · running · done · error — 태스크의 현재 상태"],
  ['output', '실행 결과. 기본 2000자까지 (full=1 로 전체)'],
  ['output_len', 'output 전체 길이 — 잘렸는지 판단에 사용'],
  ['output_truncated', 'output 이 잘렸으면 true'],
  ['run_count', '지금까지 실행된 횟수'],
  ['last_run', '마지막 실행 요약 — 실행 전이면 null'],
  ['last_run.claude_session_id', '그 실행이 남긴 Claude 세션 ID'],
  ['last_run.session_name', '그 실행이 사용한 대화형 세션 이름'],
  ['last_run.git_merge_status', 'worktree 머지 결과'],
];

const API_GET_CURL = `curl http://localhost:7788/api/task/412 \
  -H "Authorization: Bearer <EP4_TOKEN>"`;

const API_GET_RESPONSE = `{
  "ok": true,
  "id": 412,
  "project_id": 13,
  "project_name": "easy_project4",
  "title": "README 의 설치 절차를 최신 상태로 고쳐줘",
  "status": "done",
  "trigger": "on_dependency",
  "model": "",
  "session": "",
  "created_at": "2026-08-22 11:21:31",
  "started_at": "2026-08-22T11:22:04",
  "ended_at":   "2026-08-22T11:24:41",
  "output_len": 1362,
  "output": "설치 절차를 최신 상태로 정리했습니다 …",
  "output_truncated": false,
  "run_count": 1,
  "last_run": {
    "id": 870,
    "status": "done",
    "model": "claude-fable-5",
    "session_name": "",
    "claude_session_id": "ce038e85-…",
    "git_task_branch": "project/easy-project4/task001",
    "git_merge_status": "merged"
  }
}`;

const API_GET_ERRORS = [
  ['400', 'invalid task id: …', 'id 가 숫자가 아님'],
  ['404', 'task not found: …', '그 id 의 태스크가 없음'],
  ['401', 'unauthorized', '토큰이 없거나 틀림'],
];

// ── PUT /api/task/{id} 명세 ────────────────────────────────
const API_PUT_PARAMS = [
  { name: 'title', req: false, def: '유지',
    ko: '태스크 제목. 빈 문자열로 보내면 프롬프트 첫 줄로 다시 채웁니다.',
    en: 'Task title. Send an empty string to refill it from the first line of the prompt.' },
  { name: 'prompt', req: false, def: '유지', ko: '프롬프트 본문.', en: 'The prompt body.' },
  { name: 'test', req: false, def: '유지', ko: '완료 판정 기준.', en: 'Completion criteria.' },
  { name: 'model', req: false, def: '유지', ko: '태스크별 모델. 빈 문자열이면 프로젝트 모델을 씁니다.',
    en: 'Per-task model. Empty falls back to the project model.' },
  { name: 'trigger', req: false, def: '유지',
    ko: 'manual · on_dependency · schedule 중 하나.', en: 'One of manual, on_dependency, schedule.' },
  { name: 'session', req: false, def: '유지',
    ko: '실행 세션. 추가 API 의 session 과 같은 값 규약입니다.',
    en: 'Execution session — same value rules as the session field when adding.' },
  { name: 'status', req: false, def: '유지',
    ko: 'pending · running · done · error. 끝난 태스크를 pending 으로 되돌리면 다시 실행 대상이 됩니다.',
    en: 'pending, running, done, error. Setting a finished task back to pending re-queues it.' },
];

const API_PUT_CURL = `curl -X PUT http://localhost:7788/api/task/412 \
  -H "Authorization: Bearer <EP4_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "status": "pending", "model": "claude-opus-5" }'`;

const API_PUT_ERRORS = [
  ['400', 'invalid task id: …', 'id 가 숫자가 아님'],
  ['400', 'no updatable field', '수정 가능한 키가 하나도 없음'],
  ['400', 'invalid trigger: …', 'trigger 값이 허용 목록 밖'],
  ['400', 'invalid status: …', 'status 값이 허용 목록 밖'],
  ['400', 'title or prompt required', '제목과 프롬프트가 모두 비게 되는 수정'],
  ['404', 'task not found: …', '그 id 의 태스크가 없음'],
];

// ── 프로젝트 조회 API ──────────────────────────────────────
const API_PROJ_LIST_RESPONSE = `{
  "ok": true,
  "count": 26,
  "projects": [
    { "project_id": 1,  "project_name": "tr-example01" },
    { "project_id": 13, "project_name": "easy_project4" }
  ]
}`;

const API_PROJ_DETAIL_RESPONSE = `{
  "ok": true,
  "project_id": 13,
  "project_name": "easy_project4",
  "description": "",
  "model": "claude-sonnet-4-6",
  "engine": "claude",
  "project_root": "D:\repo_ai\easy_project4",
  "status": "idle",
  "auto_run": false,
  "session_name": "",
  "claude_session_id": "",
  "task_count": 28,
  "task_status_counts": { "done": 23, "pending": 5 },
  "tasks": [
    { "id": 767, "title": "테스트", "status": "done" },
    { "id": 888, "title": "상태 조회 API 추가", "status": "pending" }
  ]
}`;

const API_PROJ_FIELDS = [
  ['status', 'idle · running · done · error — 실행 중이면 메모리의 최신 상태를 씁니다'],
  ['auto_run', "프로젝트의 '자동 실행 활성화' 설정. 꺼져 있으면 on_dependency 태스크도 자동 실행되지 않습니다"],
  ['task_count', '태스크 총 개수'],
  ['task_status_counts', '상태별 개수 — {"done": 23, "pending": 5} 형태'],
  ['tasks', '태스크 목록 — 화면과 같은 순서(폴더·정렬순), 각 항목은 id · title · status'],
];

const API_PROJ_ERRORS = [
  ['400', 'invalid project id: …', 'id 가 숫자가 아님'],
  ['404', 'project not found: …', '그 id 의 프로젝트가 없음'],
  ['401', 'unauthorized', '토큰이 없거나 틀림'],
];

const CLI_COMMANDS = [
  ['run.bat', 'EP4 서버 시작 (localhost:7788)'],
  ['tunnel.bat', 'Cloudflare 임시 터널 — 외부/모바일 접속'],
  ['mobile.bat', 'Flutter 모바일 앱 실행'],
  ['desktop.bat', 'Electron 데스크톱 앱 개발 모드'],
];

// ── CSS ───────────────────────────────────────────────────
function _injectCss() {
  if (document.getElementById('help-view-css')) return;
  const st = document.createElement('style');
  st.id = 'help-view-css';
  st.textContent = `
    .help-wrap { display:flex; gap:22px; padding:20px 24px 60px; align-items:flex-start; }
    .help-toc { position:sticky; top:12px; flex:0 0 150px; display:flex; flex-direction:column; gap:2px; }
    .help-toc a { color:var(--text-mute); text-decoration:none; font-size:.82rem;
                  padding:7px 10px; border-radius:7px; border-left:2px solid transparent; }
    .help-toc a:hover { background:rgba(255,255,255,.05); color:var(--text); }
    .help-body { flex:1; min-width:0; max-width:860px; }
    .help-sec { margin-bottom:34px; scroll-margin-top:16px; }
    .help-sec h2 { font-size:1.05rem; margin:0 0 4px; display:flex; align-items:center; gap:8px; }
    .help-lead { color:var(--text-mute); font-size:.85rem; line-height:1.65; margin:0 0 14px; }
    .help-card { background:var(--bg-soft,rgba(255,255,255,.03)); border:1px solid var(--border);
                 border-radius:9px; padding:12px 14px; margin-bottom:9px; }
    .help-card h3 { font-size:.86rem; margin:0 0 4px; }
    .help-card p { margin:0; color:var(--text-mute); font-size:.8rem; line-height:1.6; }
    .help-table { width:100%; border-collapse:collapse; font-size:.79rem; margin-bottom:10px; }
    .help-table th, .help-table td { text-align:left; padding:7px 9px; border-bottom:1px solid var(--border);
                                     vertical-align:top; line-height:1.55; }
    .help-table th { color:var(--text-mute); font-weight:600; font-size:.74rem; text-transform:uppercase;
                     letter-spacing:.03em; }
    .help-table code { font-family:'Consolas',monospace; }
    .help-scroll { overflow-x:auto; }
    .help-tag { display:inline-block; font-size:.68rem; padding:1px 6px; border-radius:4px;
                border:1px solid var(--border); color:var(--text-mute); white-space:nowrap; }
    .help-tag.req { border-color:#f59e0b; color:#f59e0b; }
    .help-code { position:relative; background:#0a0e17; border:1px solid var(--border); border-radius:8px;
                 padding:12px 14px; margin-bottom:12px; }
    .help-code pre { margin:0; font-family:'Consolas',monospace; font-size:.78rem; line-height:1.6;
                     color:#e2e8f0; white-space:pre; overflow-x:auto; }
    .help-code button { position:absolute; top:8px; right:8px; font-size:.7rem; padding:2px 9px;
                        border-radius:5px; border:1px solid var(--border); background:var(--bg);
                        color:var(--text-mute); cursor:pointer; }
    .help-code button:hover { color:var(--text); }
    .help-kv { font-family:'Consolas',monospace; font-size:.78rem; }
    @media (max-width:820px) { .help-wrap { flex-direction:column; } .help-toc { position:static; flex-basis:auto;
      flex-direction:row; flex-wrap:wrap; } }
  `;
  document.head.appendChild(st);
}

// ── 렌더 조각 ─────────────────────────────────────────────
function _codeBlock(id, text) {
  return `<div class="help-code">
    <button onclick="_helpCopy('${id}')">${_hT('api_copy')}</button>
    <pre id="${id}">${esc(text)}</pre>
  </div>`;
}

function _paramRows(list) {
  const lang = (window._EP4_LANG || 'ko') === 'ko' ? 'ko' : 'en';
  return list.map(p => `<tr>
    <td><code>${esc(p.name)}</code></td>
    <td><span class="help-tag${p.req ? ' req' : ''}">${p.req ? _hT('api_req') : _hT('api_opt')}</span></td>
    <td class="help-kv">${esc(p.def)}</td>
    <td>${esc(p[lang] || p.ko)}</td>
  </tr>`).join('');
}

function _errorTable(rows) {
  return `<div class="help-scroll"><table class="help-table"><tbody>${rows.map(([c, m, d]) => `<tr>
    <td class="help-kv">${esc(c)}</td>
    <td class="help-kv">${esc(m)}</td>
    <td>${esc(d)}</td></tr>`).join('')}</tbody></table></div>`;
}

function _sessionCards() {
  return [
    ['session_default_t', 'session_default_d'],
    ['session_prev_t',    'session_prev_d'],
    ['session_claude_t',  'session_claude_d'],
    ['session_new_t',     'session_new_d'],
  ].map(([t, d]) => `<div class="help-card"><h3>${esc(_hT(t))}</h3><p>${esc(_hT(d))}</p></div>`).join('');
}

function HELP_HTML() {
  return `<div class="help-wrap">
    <div class="help-toc">
      ${[['overview', 'nav_overview'], ['session', 'nav_session'],
         ['api', 'nav_api'], ['cli', 'nav_cli']].map(([id, key]) =>
        // 해시를 바꾸면 셸이 뷰를 다시 마운트하므로 페이지 안에서만 스크롤한다
        `<a href="javascript:void(0)" onclick="_helpGo('${id}')">${esc(_hT(key))}</a>`
      ).join('')}
    </div>

    <div class="help-body">
      <div class="help-sec" id="help-overview">
        <h2>📘 ${esc(_hT('overview_title'))}</h2>
        <p class="help-lead">${esc(_hT('overview_desc'))}</p>
        <div class="help-card"><p>${esc(_hT('overview_flow'))}</p></div>
        <div class="help-card"><p>${esc(_hT('overview_root'))}</p></div>
      </div>

      <div class="help-sec" id="help-session">
        <h2>🖥 ${esc(_hT('session_title'))}</h2>
        <p class="help-lead">${esc(_hT('session_desc'))}</p>
        ${_sessionCards()}
      </div>

      <div class="help-sec" id="help-api">
        <h2>🔌 ${esc(_hT('api_title'))}</h2>

        <h3 style="font-size:.88rem;margin:14px 0 4px;">${esc(_hT('api_auth_t'))}</h3>
        <p class="help-lead">${esc(_hT('api_auth_d'))}</p>

        <h3 style="font-size:.88rem;margin:18px 0 4px;">
          <code>POST /api/task</code> — ${esc(_hT('api_addtask_t'))}
        </h3>
        <p class="help-lead">${esc(_hT('api_addtask_d'))}</p>

        <div class="help-scroll">
          <table class="help-table">
            <thead><tr>
              <th>${esc(_hT('api_name_col'))}</th><th></th>
              <th>${esc(_hT('api_default'))}</th><th>${esc(_hT('api_desc_col'))}</th>
            </tr></thead>
            <tbody>${_paramRows(API_TASK_PARAMS)}</tbody>
          </table>
        </div>

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_example'))}</h3>
        ${_codeBlock('help-code-curl', API_TASK_CURL)}

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_response'))}</h3>
        ${_codeBlock('help-code-resp', API_TASK_RESPONSE)}
        <div class="help-scroll">
          <table class="help-table">
            <tbody>${API_POST_FIELDS.map(([f, d]) => `<tr>
              <td class="help-kv" style="white-space:nowrap;"><code>${esc(f)}</code></td>
              <td>${esc(d)}</td></tr>`).join('')}</tbody>
          </table>
        </div>

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_runstate'))}</h3>
        <p class="help-lead">${esc(_hT('api_runstate_d'))}</p>
        <div class="help-scroll">
          <table class="help-table">
            <tbody>${API_RUN_STATES.map(([v, d]) => `<tr>
              <td class="help-kv" style="white-space:nowrap;"><code>${esc(v)}</code></td>
              <td>${esc(d)}</td></tr>`).join('')}</tbody>
          </table>
        </div>

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_errors'))}</h3>
        ${_errorTable(API_TASK_ERRORS)}

        <h3 style="font-size:.88rem;margin:26px 0 4px;border-top:1px solid var(--border);padding-top:18px;">
          <code>GET /api/task/{id}</code> — ${esc(_hT('api_gettask_t'))}
        </h3>
        <p class="help-lead">${esc(_hT('api_gettask_d'))}</p>

        <h3 style="font-size:.82rem;margin:14px 0 6px;color:var(--text-mute);">${esc(_hT('api_query'))}</h3>
        <div class="help-scroll">
          <table class="help-table">
            <thead><tr>
              <th>${esc(_hT('api_name_col'))}</th><th></th>
              <th>${esc(_hT('api_default'))}</th><th>${esc(_hT('api_desc_col'))}</th>
            </tr></thead>
            <tbody>${_paramRows(API_GET_QUERY)}</tbody>
          </table>
        </div>

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_example'))}</h3>
        ${_codeBlock('help-code-getcurl', API_GET_CURL)}

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_response'))}</h3>
        ${_codeBlock('help-code-getresp', API_GET_RESPONSE)}

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_fields'))}</h3>
        <div class="help-scroll">
          <table class="help-table">
            <tbody>${API_GET_FIELDS.map(([f, d]) => `<tr>
              <td class="help-kv" style="white-space:nowrap;"><code>${esc(f)}</code></td>
              <td>${esc(d)}</td></tr>`).join('')}</tbody>
          </table>
        </div>

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_errors'))}</h3>
        ${_errorTable(API_GET_ERRORS)}

        <h3 style="font-size:.88rem;margin:26px 0 4px;border-top:1px solid var(--border);padding-top:18px;">
          <code>PUT /api/task/{id}</code> — ${esc(_hT('api_puttask_t'))}
        </h3>
        <p class="help-lead">${esc(_hT('api_puttask_d'))}</p>
        <div class="help-scroll">
          <table class="help-table">
            <thead><tr>
              <th>${esc(_hT('api_name_col'))}</th><th></th>
              <th>${esc(_hT('api_default'))}</th><th>${esc(_hT('api_desc_col'))}</th>
            </tr></thead>
            <tbody>${_paramRows(API_PUT_PARAMS)}</tbody>
          </table>
        </div>
        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_example'))}</h3>
        ${_codeBlock('help-code-putcurl', API_PUT_CURL)}
        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_errors'))}</h3>
        ${_errorTable(API_PUT_ERRORS)}

        <h3 style="font-size:.88rem;margin:26px 0 4px;border-top:1px solid var(--border);padding-top:18px;">
          <code>GET /api/project</code> — ${esc(_hT('api_projlist_t'))}
        </h3>
        <p class="help-lead">${esc(_hT('api_projlist_d'))}</p>
        ${_codeBlock('help-code-plist', API_PROJ_LIST_RESPONSE)}

        <h3 style="font-size:.88rem;margin:26px 0 4px;border-top:1px solid var(--border);padding-top:18px;">
          <code>GET /api/project/{id}</code> — ${esc(_hT('api_projdet_t'))}
        </h3>
        <p class="help-lead">${esc(_hT('api_projdet_d'))}</p>
        ${_codeBlock('help-code-pdet', API_PROJ_DETAIL_RESPONSE)}

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_fields'))}</h3>
        <div class="help-scroll">
          <table class="help-table">
            <tbody>${API_PROJ_FIELDS.map(([f, d]) => `<tr>
              <td class="help-kv" style="white-space:nowrap;"><code>${esc(f)}</code></td>
              <td>${esc(d)}</td></tr>`).join('')}</tbody>
          </table>
        </div>

        <h3 style="font-size:.82rem;margin:16px 0 6px;color:var(--text-mute);">${esc(_hT('api_errors'))}</h3>
        ${_errorTable(API_PROJ_ERRORS)}
      </div>

      <div class="help-sec" id="help-cli">
        <h2>⌨ ${esc(_hT('cli_title'))}</h2>
        <p class="help-lead">${esc(_hT('cli_desc'))}</p>
        <div class="help-scroll">
          <table class="help-table">
            <tbody>${CLI_COMMANDS.map(([c, d]) => `<tr>
              <td class="help-kv" style="white-space:nowrap;"><code>${esc(c)}</code></td>
              <td>${esc(d)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
}

// 코드 블록 복사 — 인라인 onclick 에서 부르므로 전역에 노출한다
function _exposeGlobals() {
  window._helpGo = (section) => _scrollTo(section);
  window._helpCopy = async (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.textContent);
      showAlert(_hT('api_copied'), { type: 'success' });
    } catch (e) {
      showAlert(_hT('api_copy_failed'), { type: 'error' });
    }
  };
}

function _scrollTo(section) {
  const el = document.getElementById('help-' + (section || 'overview'));
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 플러그인 계약 ──────────────────────────────────────────
export default {
  async mount(container, ctx) {
    _injectCss();
    _exposeGlobals();
    container.innerHTML = HELP_HTML();
    const sec = (ctx && ctx.query && ctx.query.section) || '';
    if (sec) setTimeout(() => _scrollTo(sec), 0);
  },

  unmount() {
    delete window._helpCopy;
    delete window._helpGo;
  },

  onEvent() {},

  describe() {
    return {
      route: 'help',
      summary: _hT('api_title'),
      actions: [
        { id: 'open', label: _hT('nav_overview') },
        { id: 'open_api', label: _hT('nav_api') },
      ],
    };
  },
};
