/* ============================================================
   EasyProject4 데모 — 화면 로직
   실제 서버 호출은 없으며, 모든 동작은 data.js 의 Mock 데이터로 재현합니다.
   ============================================================ */
(function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nowT = () => new Date().toTimeString().slice(0, 8);
  const pad = (n) => String(n).padStart(2, '0');
  const nowStamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dur = (a, b) => {
    if (!a || !b) return '—';
    const s = Math.max(0, (new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m ${pad(Math.round(s % 60))}s` : `${Math.round(s)}s`;
  };

  const STATUS = {
    pending: { ico: '⏳', label: '대기 중', tag: '' },
    running: { ico: '▶', label: '실행 중', tag: 'blue' },
    done:    { ico: '✅', label: '완료', tag: 'green' },
    error:   { ico: '❌', label: '오류', tag: 'red' },
  };
  const TRIGGER = { manual: '수동', claude_cli: 'Claude CLI', antigravity_cli: 'Antigravity', schedule: '스케줄', on_dependency: '선행 완료 후' };
  const TRIGGER_TAG = { manual: '', claude_cli: 'orange', antigravity_cli: 'purple', schedule: 'yellow', on_dependency: 'blue' };
  const MODEL = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', gemini: 'Gemini', '': '프로젝트 기본' };
  const KIND = { pty: ['명령프롬프트', ''], claude: ['Claude CLI', 'orange'], antigravity: ['Antigravity CLI', 'purple'] };
  const SESS_ST = { idle: ['대기', 'green'], busy: ['작업 중', 'blue'], dead: ['종료됨', 'red'] };
  const PTYPE = { view: ['View', 'blue'], mcp: ['MCP', 'purple'], claude: ['Claude', 'orange'], agent: ['도우미', 'green'] };

  /* ---------- 상태 ---------- */
  const S = {
    projectId: 1,
    taskFilter: 'all',
    search: '',
    logFilter: 0,
    sessionName: DEMO.sessions[0].name,
    plugTab: 'installed',
    plugFilter: 'all',
    running: null,           // { taskId, runId, step, timer }
    paused: false,
    nextTaskId: 500, nextRunId: 9008,
  };

  /* ---------- 공통 UI: 토스트 / 모달 (네이티브 alert·confirm 미사용) ---------- */
  function toast(msg, kind = '') {
    const wrap = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3000);
  }
  const demoOnly = (what) => toast(`데모 모드: "${what}"은(는) 실제로 실행되지 않습니다. 실제 EP4 에서는 server.py 가 처리합니다.`);

  function openModal(title, bodyHtml, actions = []) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    const act = $('#modal-actions');
    act.innerHTML = '';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.cls) b.className = a.cls;
      b.onclick = () => { const keep = a.onClick && a.onClick() === false; if (!keep) closeModal(); };
      act.appendChild(b);
    });
    $('#modal').classList.add('show');
  }
  function closeModal() { $('#modal').classList.remove('show'); }
  function showAlert(msg, title = '알림') { openModal(title, `<p class="small" style="margin:0 0 4px">${esc(msg)}</p>`, [{ label: '확인', cls: 'primary' }]); }
  function showConfirm(msg, { title = '확인', ok = '확인', cancel = '취소', danger = false, onOk } = {}) {
    openModal(title, `<p class="small" style="margin:0 0 4px">${esc(msg)}</p>`, [{ label: cancel }, { label: ok, cls: danger ? 'danger' : 'primary', onClick: onOk }]);
  }

  /* ---------- 메뉴 정의 (실제 대시보드의 plugin.json menu 순서) ---------- */
  const VIEWS = [
    { key: 'dashboard', icon: '📊', label: '대시보드' },
    { key: 'plugins',   icon: '🧩', label: '확장' },
    { key: 'projects',  icon: '🗂', label: '프로젝트' },
    { key: 'todo',      icon: '✅', label: '태스크', badge: () => DEMO.tasks.filter((t) => t.status === 'pending' || t.status === 'running').length },
    { key: 'log',       icon: '📋', label: '실행 로그', badge: () => (S.running ? '●' : ''), badgeCls: 'red' },
    { key: 'sessions',  icon: '🖥', label: '세션', badge: () => DEMO.sessions.filter((s) => s.status !== 'dead').length, badgeCls: 'green' },
    { key: 'help',      icon: '❓', label: '도움말' },
  ];

  /* ---------- 메뉴별 안내문 ---------- */
  const GUIDE = {
    dashboard: {
      summary: '프로젝트 현황과 태스크 통계를 한눈에 보는 시작 화면입니다. 하네스가 지금 무엇을 하고 있는지, 최근 실행이 어땠는지 요약합니다.',
      shows: ['프로젝트 수 · 태스크 상태별 개수(대기/실행/완료/실패)', '최근 7일 실행 횟수', '프로젝트별 진행률', '서버·Claude CLI·Antigravity·Git·터널 상태'],
      steps: ['프로젝트 카드를 클릭하면 해당 프로젝트의 태스크 화면으로 이동', '실행 중 표시가 있으면 실행 로그 화면에서 실시간 로그 확인'],
      real: '실제로는 /api/projects, /api/runs 를 조회하고 SSE(/api/events) 로 상태 변화가 즉시 반영됩니다.',
      tips: ['왼쪽 "실행"을 눌러 가짜 실행을 시작한 뒤 이 화면의 숫자가 바뀌는 것을 확인하세요'],
    },
    plugins: {
      summary: 'EP4 의 확장 기능을 관리합니다. View 플러그인(화면), MCP 커넥터, Claude Skill/Plugin, 도우미(마스코트)를 설치·삭제·켜고 끕니다.',
      shows: ['설치됨 — 유형별 필터와 활성/비활성 토글', '마켓플레이스 — 공유된 플러그인 설치', '📦 Data — 플러그인이 남긴 로컬 데이터 (언인스톨 후에도 보존)', '설정 — 마켓 연동(Firebase + GitHub) 정보'],
      steps: ['설치됨 탭에서 스위치로 플러그인을 켜거나 끄기 (메뉴가 즉시 바뀜)', '마켓플레이스에서 "설치" 클릭', '필요 없는 플러그인은 "삭제"'],
      real: '플러그인은 plugins/{View,MCP,Data,Helper}/ 폴더에 plugin.json(+view.js, backend.py) 으로 존재하며, 활성 상태는 installed_plugins 테이블에 저장됩니다.',
      tips: ['"대시보드" 스위치를 꺼 보세요 — 왼쪽 메뉴에서 사라집니다', '"확장" 은 필수 플러그인이라 끌 수 없습니다'],
    },
    projects: {
      summary: '작업 단위인 프로젝트를 만들고 관리합니다. 프로젝트마다 저장소 경로(project_root), 기본 모델, 타임아웃, 권한, 세션을 지정합니다.',
      shows: ['프로젝트 이름·설명·기본 모델·엔진(Claude/Antigravity)', 'project_root — git 이 있으면 worktree 격리 자동 적용', 'session_name — 지정 시 subprocess 대신 해당 PTY 세션으로 프롬프트 전달', '태스크 진행률'],
      steps: ['"+ 새 프로젝트" 로 이름과 저장소 경로 입력', '카드를 클릭해 선택 → 태스크 화면에서 할 일 등록', '설정에서 모델·타임아웃·tool_perms 조정'],
      real: 'projects 테이블에 저장되며, 태스크 실행 시 project/{slug} 브랜치가 자동 생성됩니다.',
      tips: ['"data-pipeline" 카드를 보세요 — git 없는 폴더는 worktree 없이 직접 실행됩니다'],
    },
    todo: {
      summary: '선택한 프로젝트의 태스크를 등록·수정·실행합니다. 태스크는 순서대로 큐에서 처리되고, 실행 중 추가한 태스크도 이어서 실행됩니다.',
      shows: ['상태 아이콘 ⏳ 대기 · ▶ 실행 중 · ✅ 완료 · ❌ 오류', '트리거 — 수동 / Claude CLI / Antigravity / 스케줄 / 선행 완료 후', '태스크별 모델 오버라이드, 검증 기준(test_criteria)', '펼치면 프롬프트·출력·브랜치 확인'],
      steps: ['"+ 태스크 추가" 로 제목과 프롬프트 입력', '왼쪽 "실행" 을 누르면 대기 중인 태스크가 순서대로 실행', '실패한 태스크는 "재시도"'],
      real: 'POST /api/projects/{id}/tasks/{tid}/run → harness_runner() 가 worktree 를 만들고 claude CLI subprocess 를 실행합니다.',
      tips: ['태스크를 하나 추가하고 "실행" 을 눌러보세요 — 가짜 로그가 흘러가고 완료되면 실행 로그에 기록됩니다'],
    },
    log: {
      summary: '태스크 실행 내역(task_runs)을 시간순으로 봅니다. 로그 라인, Git 브랜치·커밋·diff 요약, 트레이스 ID 를 확인할 수 있습니다.',
      shows: ['[harness] 하네스 · [git] 브랜치/커밋/머지 · [claude] CLI 출력 · [hook] CLI 훅', '소요 시간, 모델, 트리거, 시도 횟수', '변경 파일과 +/− 라인 수, 커밋 목록', '실행 중인 항목은 로그가 실시간으로 추가'],
      steps: ['항목을 클릭해 펼치기', '프로젝트 필터로 좁히기', '오류 항목의 마지막 로그에서 원인 확인'],
      real: 'SSE 로 log_line 이벤트가 푸시되고, 완료 시 git_diff_json / git_commits_json 이 함께 저장됩니다.',
      tips: ['#9005 오류 항목을 펼쳐 타임아웃 로그를 보세요', '실행 중이면 #9007 (또는 새 실행) 에 로그가 계속 붙습니다'],
    },
    sessions: {
      summary: '명령프롬프트(PTY)·Claude CLI·Antigravity CLI 세션 목록입니다. 세션을 띄워두면 프로젝트가 subprocess 대신 이 세션으로 프롬프트를 보냅니다.',
      shows: ['세션 이름, 종류, 상태(대기/작업 중/종료됨), PID, 모델', '마지막 출력 미리보기', '터미널 출력 (마지막 N 줄)'],
      steps: ['"+ 새 세션" 으로 종류와 이름 선택', '프로젝트 설정의 session_name 에 세션 이름 지정', '종료된 세션은 목록에서 정리'],
      real: 'Windows 에서는 pywinpty 로 PTY 를 열고, 없으면 Popen 으로 대체합니다. 출력은 log/ 폴더에 기록됩니다.',
      tips: ['왼쪽 목록에서 세션을 바꿔 터미널 미리보기를 확인하세요'],
    },
    help: {
      summary: 'EP4 사용법과 외부 연동 API 를 안내합니다. 실제 화면의 도움말 플러그인 내용을 요약했습니다.',
      shows: ['개요 · 세션 · REST API · CLI 훅', 'Bearer 토큰 인증 방식', '태스크 등록·실행 API 예시'],
      steps: ['처음이면 "개요" 순서대로 따라가기', 'API 로 자동화하려면 conf/ep4.local.conf 의 토큰 사용'],
      real: '토큰은 최초 실행 시 자동 생성되며 QR 연결에도 포함됩니다.',
      tips: ['오른쪽 위 📱 버튼으로 모바일 QR 연결 모달을 열어보세요'],
    },
  };

  /* ---------- 데이터 헬퍼 ---------- */
  const project = (id) => DEMO.projects.find((p) => p.id === id);
  const tasksOf = (pid) => DEMO.tasks.filter((t) => t.project_id === pid);
  const counts = (list) => ({ total: list.length, pending: list.filter((t) => t.status === 'pending').length, running: list.filter((t) => t.status === 'running').length, done: list.filter((t) => t.status === 'done').length, error: list.filter((t) => t.status === 'error').length });
  const tag = (txt, cls = '') => `<span class="tag ${cls}">${esc(txt)}</span>`;
  const depDone = (t) => !(t.trigger_type === 'on_dependency' && t.trigger_meta && DEMO.tasks.some((d) => d.id === t.trigger_meta.depends_on && d.status !== 'done'));
  const runnable = (t) => t.status === 'pending' && t.trigger_type !== 'schedule' && depDone(t);
  const enabledView = (id) => { const p = DEMO.plugins.installed.find((x) => x.id === id); return !p || p.enabled; };

  /* ---------- 렌더러 ---------- */
  const R = {};

  R.dashboard = (host) => {
    const c = counts(DEMO.tasks);
    const max = Math.max(...DEMO.last7.map((x) => x.runs), 1);
    const recent = DEMO.runs.slice(0, 5);
    host.innerHTML = `
      <div class="grid c5" style="margin-bottom:14px">
        <div class="card stat"><div class="label">프로젝트</div><div class="value">${DEMO.projects.length}</div><div class="sub">활성 ${DEMO.projects.filter((p) => p.status === 'active').length}</div></div>
        <div class="card stat"><div class="label">대기</div><div class="value">${c.pending}</div><div class="sub">큐에 쌓인 태스크</div></div>
        <div class="card stat"><div class="label">진행 중</div><div class="value accent2">${c.running}</div><div class="sub">${S.running ? '하네스 실행 중' : c.running ? '실행 중' : '유휴'}</div></div>
        <div class="card stat"><div class="label">완료</div><div class="value green">${c.done}</div><div class="sub">전체 ${c.total}개 중</div></div>
        <div class="card stat"><div class="label">실패</div><div class="value red">${c.error}</div><div class="sub">재시도 대기</div></div>
      </div>
      <div class="grid c2" style="margin-bottom:14px">
        <div class="card"><h3>📈 최근 7일 실행 횟수</h3>
          <div class="bars">${DEMO.last7.map((x) => `<div class="bar"><span>${x.runs}</span><div style="height:${Math.round((x.runs / max) * 80)}%"></div><span>${x.d}</span></div>`).join('')}</div>
        </div>
        <div class="card"><h3>🗂 프로젝트별 진행률</h3>
          ${DEMO.projects.map((p) => { const k = counts(tasksOf(p.id)); const pct = k.total ? Math.round((k.done / k.total) * 100) : 0; return `
            <div style="margin-bottom:10px;cursor:pointer" data-goto-project="${p.id}">
              <div class="row between small"><span><b>${esc(p.name)}</b> <span class="muted">${MODEL[p.model]} · ${p.engine === 'antigravity' ? 'Antigravity' : 'Claude'}</span></span><span class="muted">${k.done}/${k.total} · ${pct}%</span></div>
              <div class="progress" style="margin-top:4px"><div style="width:${pct}%"></div></div>
            </div>`; }).join('')}
        </div>
      </div>
      <div class="grid c2">
        <div class="card"><h3>📋 최근 실행</h3>
          <div class="list">${recent.map((r) => `
            <div class="list-item" data-goto-run="${r.id}">
              <div class="row between"><span class="name">${STATUS[r.status].ico} ${esc(r.task_title)}</span>${tag(STATUS[r.status].label, STATUS[r.status].tag)}</div>
              <div class="desc">${esc(r.project_name)} · ${MODEL[r.model] || r.model} · ${TRIGGER[r.trigger_type]} · ${r.status === 'running' ? '진행 중' : dur(r.started_at, r.ended_at)} · ${esc(r.started_at.slice(0, 16))}</div>
            </div>`).join('')}</div>
        </div>
        <div class="card"><h3>🔌 시스템 상태</h3>
          <div class="sys-grid" style="grid-template-columns:repeat(2,1fr)">${DEMO.system.map((s) => `<div class="sys-item"><div class="name">${esc(s.name)}</div><div class="st ${s.ok ? 'green' : 'muted'}">${s.ok ? '●' : '○'} ${esc(s.st)}</div></div>`).join('')}</div>
          <div class="small muted" style="margin-top:12px;line-height:1.6">실제 EP4 는 SSE(/api/events) 로 서버와 연결되어 태스크 상태·로그·진행률을 실시간 수신합니다. 이 데모는 브라우저 안에서만 동작합니다.</div>
        </div>
      </div>`;
    $$('[data-goto-project]', host).forEach((el) => (el.onclick = () => { S.projectId = +el.dataset.gotoProject; location.hash = '#/todo'; }));
    $$('[data-goto-run]', host).forEach((el) => (el.onclick = () => { S.openRun = +el.dataset.gotoRun; location.hash = '#/log'; }));
  };

  R.projects = (host) => {
    host.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <span class="small muted">${DEMO.projects.length}개 프로젝트 · 카드를 클릭하면 태스크 화면으로 이동합니다</span>
        <button class="primary small" id="btn-new-project">+ 새 프로젝트</button>
      </div>
      <div class="grid c2">${DEMO.projects.map((p) => { const k = counts(tasksOf(p.id)); const pct = k.total ? Math.round((k.done / k.total) * 100) : 0; return `
        <div class="card proj-card ${p.id === S.projectId ? 'active' : ''}" data-pid="${p.id}">
          <div class="head">
            <div><div class="name">${esc(p.name)}</div><div class="desc">${esc(p.description)}</div></div>
            ${tag(p.status === 'active' ? '활성' : '일시정지', p.status === 'active' ? 'green' : 'yellow')}
          </div>
          <div class="meta">${tag(MODEL[p.model], 'orange')}${tag(p.engine === 'antigravity' ? 'Antigravity' : 'Claude', p.engine === 'antigravity' ? 'purple' : '')}${tag(`timeout ${p.timeout_sec / 60}m`)}${p.session_name ? tag(`세션 ${p.session_name}`, 'blue') : ''}${p.skip_permissions ? tag('skip-permissions', 'yellow') : tag('tool_perms', 'blue')}${p.branch ? tag('git worktree', 'green') : tag('no git')}</div>
          <div class="path">📁 ${esc(p.project_root)}</div>
          <div class="row between small muted"><span>태스크 ${k.done}/${k.total} 완료${k.error ? ` · <span class="red">실패 ${k.error}</span>` : ''}${k.running ? ` · <span class="accent2">실행 중 ${k.running}</span>` : ''}</span><span>${pct}%</span></div>
          <div class="progress"><div style="width:${pct}%"></div></div>
          <div class="row" style="justify-content:flex-end">
            <button class="small" data-settings="${p.id}">⚙ 설정</button>
            <button class="small primary" data-open="${p.id}">태스크 보기 →</button>
          </div>
        </div>`; }).join('')}</div>`;
    $$('[data-open]', host).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); S.projectId = +b.dataset.open; location.hash = '#/todo'; }));
    $$('.proj-card', host).forEach((c) => (c.onclick = () => { S.projectId = +c.dataset.pid; render(); }));
    $$('[data-settings]', host).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); projectSettingsModal(project(+b.dataset.settings)); }));
    $('#btn-new-project').onclick = newProjectModal;
  };

  function projectSettingsModal(p) {
    openModal(`⚙ ${p.name} 설정`, `
      <div class="grid c2">
        <div class="field"><label>기본 모델</label><select id="pf-model">${['sonnet', 'opus', 'haiku'].map((m) => `<option value="${m}" ${p.model === m ? 'selected' : ''}>${MODEL[m]}</option>`).join('')}</select></div>
        <div class="field"><label>엔진</label><select id="pf-engine"><option value="claude" ${p.engine === 'claude' ? 'selected' : ''}>Claude CLI</option><option value="antigravity" ${p.engine === 'antigravity' ? 'selected' : ''}>Antigravity (Gemini) CLI</option></select></div>
        <div class="field"><label>타임아웃(초)</label><input id="pf-timeout" type="number" value="${p.timeout_sec}" /></div>
        <div class="field"><label>재시도 횟수</label><input id="pf-retry" type="number" value="${p.retry_count}" /></div>
      </div>
      <div class="field"><label>project_root (git 이 있으면 worktree 격리)</label><input value="${esc(p.project_root)}" readonly /></div>
      <div class="field"><label>session_name (비우면 subprocess 실행)</label><input id="pf-session" value="${esc(p.session_name)}" placeholder="예: api-dev" list="sess-list" /><datalist id="sess-list">${DEMO.sessions.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist></div>
      <div class="field"><label>tool_perms (skip-permissions 를 끄면 사용)</label><input id="pf-perms" value="${esc(p.tool_perms || '')}" placeholder="Read,Edit,Bash(npm test*)" /></div>
      <p class="small muted" style="margin:0">실제 EP4 에서는 PUT /api/projects/{id} 로 저장됩니다.</p>`,
      [{ label: '취소' }, { label: '저장', cls: 'primary', onClick: () => {
        p.model = $('#pf-model').value; p.engine = $('#pf-engine').value; p.timeout_sec = +$('#pf-timeout').value || p.timeout_sec; p.retry_count = +$('#pf-retry').value || 0;
        p.session_name = $('#pf-session').value.trim(); p.tool_perms = $('#pf-perms').value.trim();
        toast(`"${p.name}" 설정을 저장했습니다 (데모 — 새로고침 시 초기화)`, 'ok'); render();
      } }]);
  }

  function newProjectModal() {
    openModal('+ 새 프로젝트', `
      <div class="field"><label>이름</label><input id="np-name" placeholder="예: mobile-app" /></div>
      <div class="field"><label>설명</label><input id="np-desc" placeholder="무엇을 하는 프로젝트인지" /></div>
      <div class="field"><label>project_root (저장소 경로)</label><input id="np-root" placeholder="D:\\work\\mobile-app" /></div>
      <div class="grid c2"><div class="field"><label>기본 모델</label><select id="np-model"><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select></div>
      <div class="field"><label>엔진</label><select id="np-engine"><option value="claude">Claude CLI</option><option value="antigravity">Antigravity CLI</option></select></div></div>`,
      [{ label: '취소' }, { label: '만들기', cls: 'primary', onClick: () => {
        const name = $('#np-name').value.trim(); if (!name) { toast('이름을 입력하세요', 'err'); return false; }
        const id = Math.max(...DEMO.projects.map((p) => p.id)) + 1;
        DEMO.projects.push({ id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), description: $('#np-desc').value.trim() || '(설명 없음)', model: $('#np-model').value, engine: $('#np-engine').value, timeout_sec: 1800, retry_count: 1, project_root: $('#np-root').value.trim() || 'D:\\work\\' + name, session_name: '', skip_permissions: true, auto_run: true, status: 'active', created_at: nowStamp(), branch: 'project/' + name });
        S.projectId = id; toast(`프로젝트 "${name}" 을 만들었습니다 (데모)`, 'ok'); render();
      } }]);
  }

  R.todo = (host) => {
    const p = project(S.projectId) || DEMO.projects[0];
    let list = tasksOf(p.id);
    const k = counts(list);
    if (S.taskFilter !== 'all') list = list.filter((t) => t.status === S.taskFilter);
    if (S.search) list = list.filter((t) => (t.title + ' ' + t.prompt).toLowerCase().includes(S.search.toLowerCase()));
    host.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <div class="row">
          <select id="task-project" style="width:auto;min-width:180px">${DEMO.projects.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          ${tag(MODEL[p.model], 'orange')}${p.session_name ? tag('세션 ' + p.session_name, 'blue') : ''}
        </div>
        <div class="row">
          <button class="small" id="btn-run-now" ${S.running ? 'disabled' : ''}>▶ 실행</button>
          <button class="primary small" id="btn-add-task">+ 태스크 추가</button>
        </div>
      </div>
      <div class="filter-chips">
        ${[['all', `전체 ${k.total}`], ['pending', `⏳ 대기 ${k.pending}`], ['running', `▶ 실행 중 ${k.running}`], ['done', `✅ 완료 ${k.done}`], ['error', `❌ 실패 ${k.error}`]].map(([f, l]) => `<button class="small ${S.taskFilter === f ? 'active' : ''}" data-filter="${f}">${l}</button>`).join('')}
        ${S.search ? `<span class="tag yellow">검색: ${esc(S.search)} <span style="cursor:pointer" id="clear-search">✕</span></span>` : ''}
      </div>
      <div class="list" id="task-list">
        ${list.length ? list.map(taskHtml).join('') : `<div class="empty">조건에 맞는 태스크가 없습니다. "+ 태스크 추가" 로 등록해 보세요.</div>`}
      </div>`;
    $('#task-project').onchange = (e) => { S.projectId = +e.target.value; render(); };
    $$('[data-filter]', host).forEach((b) => (b.onclick = () => { S.taskFilter = b.dataset.filter; render(); }));
    const cs = $('#clear-search'); if (cs) cs.onclick = () => { S.search = ''; $('#globalSearch').value = ''; render(); };
    $('#btn-add-task').onclick = () => addTaskModal(p);
    $('#btn-run-now').onclick = () => startHarness();
    $$('.task .head', host).forEach((h) => (h.onclick = () => h.parentElement.classList.toggle('open')));
    $$('[data-run-one]', host).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); startHarness(+b.dataset.runOne); }));
    $$('[data-del]', host).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const t = DEMO.tasks.find((x) => x.id === +b.dataset.del);
      showConfirm(`"${t.title}" 태스크를 삭제할까요?`, { title: '태스크 삭제', ok: '삭제', danger: true, onOk: () => { DEMO.tasks.splice(DEMO.tasks.indexOf(t), 1); toast('삭제했습니다 (데모)', 'ok'); render(); } }); }));
    $$('[data-edit]', host).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); addTaskModal(p, DEMO.tasks.find((x) => x.id === +b.dataset.edit)); }));
    if (S.openTask) { const el = $(`[data-task="${S.openTask}"]`, host); if (el) { el.classList.add('open'); el.scrollIntoView({ block: 'center' }); } S.openTask = null; }
  };

  function taskHtml(t) {
    const st = STATUS[t.status];
    const dep = t.trigger_type === 'on_dependency' && t.trigger_meta ? DEMO.tasks.find((x) => x.id === t.trigger_meta.depends_on) : null;
    return `
      <div class="task ${t.status}" data-task="${t.id}">
        <div class="head">
          <span class="ico">${st.ico}</span>
          <span class="title">${esc(t.title)}</span>
          ${tag(TRIGGER[t.trigger_type], TRIGGER_TAG[t.trigger_type])}
          ${t.model_override ? tag(MODEL[t.model_override], 'orange') : ''}
          ${tag(st.label, st.tag)}
          <span class="small dim">#${t.id}</span>
        </div>
        <div class="body">
          <div class="lbl">프롬프트</div><div class="prompt">${esc(t.prompt)}</div>
          ${t.test_criteria ? `<div class="lbl">검증 기준</div><div class="small">${esc(t.test_criteria)}</div>` : ''}
          ${t.trigger_type === 'schedule' && t.trigger_meta ? `<div class="lbl">스케줄</div><div class="small">${esc(t.trigger_meta.cron)}</div>` : ''}
          ${dep ? `<div class="lbl">선행 태스크</div><div class="small">#${dep.id} ${esc(dep.title)} (${STATUS[dep.status].label})</div>` : ''}
          ${t.output ? `<div class="lbl">출력</div><div class="small" style="white-space:pre-wrap">${esc(t.output)}</div>` : ''}
          <div class="grid c3" style="margin-top:10px">
            <div class="kv"><span class="k">브랜치</span><span class="v mono small">${esc(t.branch || '—')}</span></div>
            <div class="kv"><span class="k">등록</span><span class="v small">${esc(t.created_at)} · ${esc(t.author)}</span></div>
            <div class="kv"><span class="k">소요</span><span class="v small">${t.status === 'running' ? '진행 중' : dur(t.started_at, t.ended_at)}</span></div>
          </div>
          <div class="row" style="justify-content:flex-end;margin-top:10px">
            <button class="small" data-edit="${t.id}">✎ 수정</button>
            ${t.status === 'pending' || t.status === 'error' ? `<button class="small primary" data-run-one="${t.id}">▶ ${t.status === 'error' ? '재시도' : '이 태스크 실행'}</button>` : ''}
            ${t.status !== 'running' ? `<button class="small danger" data-del="${t.id}">삭제</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function addTaskModal(p, t) {
    openModal(t ? `✎ 태스크 수정 #${t.id}` : `+ 태스크 추가 — ${p.name}`, `
      <div class="field"><label>제목</label><input id="tf-title" value="${esc(t ? t.title : '')}" placeholder="예: 로그인 페이지 에러 메시지 개선" /></div>
      <div class="field"><label>프롬프트 (Claude CLI 에 그대로 전달)</label><textarea id="tf-prompt" placeholder="무엇을 어떻게 바꿔야 하는지 구체적으로 적어주세요.">${esc(t ? t.prompt : '')}</textarea></div>
      <div class="grid c2">
        <div class="field"><label>트리거</label><select id="tf-trigger">${Object.entries(TRIGGER).map(([k, v]) => `<option value="${k}" ${t && t.trigger_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>모델 오버라이드</label><select id="tf-model"><option value="">프로젝트 기본 (${MODEL[p.model]})</option>${['sonnet', 'opus', 'haiku'].map((m) => `<option value="${m}" ${t && t.model_override === m ? 'selected' : ''}>${MODEL[m]}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>검증 기준 (선택)</label><input id="tf-test" value="${esc(t ? t.test_criteria : '')}" placeholder="예: npm test 통과" /></div>`,
      [{ label: '취소' }, { label: t ? '저장' : '등록', cls: 'primary', onClick: () => {
        const title = $('#tf-title').value.trim(), prompt = $('#tf-prompt').value.trim();
        if (!title || !prompt) { toast('제목과 프롬프트를 입력하세요', 'err'); return false; }
        if (t) { Object.assign(t, { title, prompt, trigger_type: $('#tf-trigger').value, model_override: $('#tf-model').value, test_criteria: $('#tf-test').value.trim() }); toast('수정했습니다 (데모)', 'ok'); }
        else { DEMO.tasks.push({ id: S.nextTaskId++, project_id: p.id, title, prompt, trigger_type: $('#tf-trigger').value, model_override: $('#tf-model').value, test_criteria: $('#tf-test').value.trim(), status: 'pending', output: '', branch: '', created_at: nowStamp(), started_at: '', ended_at: '', author: 'demo' }); toast(`태스크 "${title}" 를 등록했습니다. 왼쪽 "실행" 을 눌러보세요!`, 'ok'); }
        S.taskFilter = 'all'; render(); refreshNav();
      } }]);
  }

  R.log = (host) => {
    let list = DEMO.runs;
    if (S.logFilter) list = list.filter((r) => r.project_id === S.logFilter);
    host.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <div class="filter-chips" style="margin:0">
          <button class="small ${!S.logFilter ? 'active' : ''}" data-lf="0">전체 ${DEMO.runs.length}</button>
          ${DEMO.projects.map((p) => { const n = DEMO.runs.filter((r) => r.project_id === p.id).length; return n ? `<button class="small ${S.logFilter === p.id ? 'active' : ''}" data-lf="${p.id}">${esc(p.name)} ${n}</button>` : ''; }).join('')}
        </div>
        <span class="small muted">${S.running ? '<span class="accent2">● 실시간 수신 중</span>' : 'SSE 대기 (모의)'}</span>
      </div>
      <div class="list">${list.map(runHtml).join('')}</div>`;
    $$('[data-lf]', host).forEach((b) => (b.onclick = () => { S.logFilter = +b.dataset.lf; render(); }));
    $$('.run .head', host).forEach((h) => (h.onclick = () => h.parentElement.classList.toggle('open')));
    const open = S.openRun || (S.running && S.running.runId);
    if (open) { const el = $(`[data-run="${open}"]`, host); if (el) { el.classList.add('open'); if (S.openRun) el.scrollIntoView({ block: 'center' }); } S.openRun = null; }
  };

  function runHtml(r) {
    const st = STATUS[r.status];
    const adds = r.diff.reduce((a, d) => a + d.add, 0), dels = r.diff.reduce((a, d) => a + d.del, 0);
    return `
      <div class="run" data-run="${r.id}">
        <div class="head">
          <span>${st.ico}</span>
          <div style="min-width:0"><div class="t1">${esc(r.task_title)} <span class="dim small">#${r.id}</span></div>
            <div class="t2"><span>${esc(r.project_name)}</span><span>·</span><span>${MODEL[r.model] || esc(r.model)}</span><span>·</span><span>${TRIGGER[r.trigger_type]}</span><span>·</span><span>${esc(r.started_at)}</span><span>·</span><span>${r.status === 'running' ? '<span class="accent2">진행 중</span>' : dur(r.started_at, r.ended_at)}</span>${r.attempt > 1 ? `<span>· 시도 ${r.attempt}</span>` : ''}</div></div>
          <div class="row" style="gap:6px">${r.git_task_branch ? tag(r.git_merge_status || 'worktree', r.git_merge_status.startsWith('merged') ? 'green' : r.git_merge_status.startsWith('skipped') ? 'red' : 'blue') : tag('no git')}${tag(st.label, st.tag)}</div>
        </div>
        <div class="body">
          <div class="grid c2" style="margin-bottom:10px">
            <div class="kv"><span class="k">태스크 브랜치</span><span class="v mono small">${esc(r.git_task_branch || '—')}</span></div>
            <div class="kv"><span class="k">프로젝트 브랜치</span><span class="v mono small">${esc(r.git_proj_branch || '—')}</span></div>
            <div class="kv"><span class="k">trace / span</span><span class="v mono small">${esc(r.trace_id)} / ${esc(r.span_id)}</span></div>
            <div class="kv"><span class="k">머지</span><span class="v small">${esc(r.git_merge_status || '진행 중')}</span></div>
          </div>
          <div class="lbl small muted" style="margin-bottom:4px">로그</div>
          <div class="log-box" data-logbox="${r.id}">${r.log.map(logLine).join('')}${r.status === 'running' ? '<div class="log-line"><span class="cursor"></span></div>' : ''}</div>
          ${r.diff.length ? `<div class="grid c2" style="margin-top:12px">
            <div><div class="small muted" style="margin-bottom:4px">변경 파일 ${r.diff.length}개 · <span class="green">+${adds}</span> <span class="red">−${dels}</span></div>${r.diff.map((d) => `<div class="diff-row"><span>${esc(d.file)}</span><span><span class="add">+${d.add}</span> <span class="del">−${d.del}</span></span></div>`).join('')}</div>
            <div><div class="small muted" style="margin-bottom:4px">커밋 ${r.commits.length}개</div>${r.commits.length ? r.commits.map((c) => `<div class="commit"><span class="sha">${esc(c.sha)}</span><span>${esc(c.msg)}</span></div>`).join('') : '<div class="small dim">커밋 없음</div>'}</div>
          </div>` : ''}
        </div>
      </div>`;
  }
  const logLine = (l) => `<div class="log-line ${l.cls || ''}"><span class="t">${esc(l.t)}</span>${esc(l.msg)}</div>`;

  R.sessions = (host) => {
    const cur = DEMO.sessions.find((s) => s.name === S.sessionName) || DEMO.sessions[0];
    host.innerHTML = `
      <div class="two-col">
        <div class="stack">
          <div class="row between"><span class="small muted">${DEMO.sessions.filter((s) => s.status !== 'dead').length}개 활성</span><button class="primary small" id="btn-new-session">+ 새 세션</button></div>
          <div class="list">${DEMO.sessions.map((s) => `
            <div class="list-item ${s.name === cur.name ? 'active' : ''}" data-sess="${esc(s.name)}">
              <div class="row between"><span class="name">${esc(s.name)}</span>${tag(SESS_ST[s.status][0], SESS_ST[s.status][1])}</div>
              <div class="desc">${tag(KIND[s.kind][0], KIND[s.kind][1])} ${s.model ? tag(MODEL[s.model] || s.model, 'orange') : ''} <span class="dim">PID ${s.pid || '—'}</span></div>
              <div class="desc mono">${esc(s.cwd)}</div>
            </div>`).join('')}</div>
        </div>
        <div class="card">
          <div class="row between" style="margin-bottom:10px">
            <h3 style="margin:0">🖥 ${esc(cur.name)} ${tag(KIND[cur.kind][0], KIND[cur.kind][1])} ${tag(SESS_ST[cur.status][0], SESS_ST[cur.status][1])}</h3>
            <div class="row" style="gap:6px">
              <button class="small" id="sess-send" ${cur.status === 'dead' ? 'disabled' : ''}>프롬프트 보내기</button>
              <button class="small danger" id="sess-kill">${cur.status === 'dead' ? '목록에서 제거' : '종료'}</button>
            </div>
          </div>
          <div class="grid c3" style="margin-bottom:10px">
            <div class="kv"><span class="k">생성</span><span class="v small">${esc(cur.created_at)}</span></div>
            <div class="kv"><span class="k">마지막 출력</span><span class="v small">${esc(cur.last_ts)}</span></div>
            <div class="kv"><span class="k">사용 프로젝트</span><span class="v small">${DEMO.projects.filter((p) => p.session_name === cur.name).map((p) => esc(p.name)).join(', ') || '—'}</span></div>
          </div>
          <div class="term" id="term">${cur.lines.map(([c, l]) => `<div class="${c}">${esc(l)}</div>`).join('')}${cur.status !== 'dead' ? '<span class="cursor"></span>' : ''}</div>
        </div>
      </div>`;
    $$('[data-sess]', host).forEach((el) => (el.onclick = () => { S.sessionName = el.dataset.sess; render(); }));
    $('#btn-new-session').onclick = () => openModal('+ 새 세션', `
      <div class="opt" data-kind="pty"><b>💻 명령프롬프트 (PTY)</b><span class="small muted">일반 셸. npm run build 같은 장기 명령을 띄워두는 용도</span></div>
      <div class="opt" data-kind="claude"><b>🟠 Claude CLI</b><span class="small muted">claude 대화 세션. 프로젝트 session_name 으로 지정하면 태스크 프롬프트가 이 세션으로 전달됨</span></div>
      <div class="opt" data-kind="antigravity"><b>🟣 Antigravity (Gemini) CLI</b><span class="small muted">gemini 대화 세션. 같은 훅으로 EP4 에 기록됨</span></div>
      <div class="field" style="margin-top:8px"><label>세션 이름</label><input id="ns-name" placeholder="예: web-dev" /></div>`,
      [{ label: '취소' }]);
    $$('#modal .opt').forEach((o) => (o.onclick = () => {
      const name = ($('#ns-name').value.trim() || `${o.dataset.kind}-${Math.floor(Math.random() * 900 + 100)}`);
      if (DEMO.sessions.some((s) => s.name === name)) { toast('같은 이름의 세션이 있습니다', 'err'); return; }
      DEMO.sessions.unshift({ name, kind: o.dataset.kind, status: 'idle', pid: Math.floor(Math.random() * 20000 + 10000), model: o.dataset.kind === 'claude' ? 'sonnet' : o.dataset.kind === 'antigravity' ? 'gemini' : '', cwd: 'D:\\work', created_at: nowStamp(), last_ts: nowStamp(), lines: [['p', `D:\\work> ${o.dataset.kind === 'pty' ? '' : o.dataset.kind === 'claude' ? 'claude' : 'gemini'}`], ['d', '(데모 세션 — 실제 프로세스는 생성되지 않았습니다)']] });
      S.sessionName = name; closeModal(); toast(`세션 "${name}" 을 만들었습니다 (데모)`, 'ok'); render(); refreshNav();
    }));
    $('#sess-send').onclick = () => openModal(`프롬프트 보내기 → ${cur.name}`, `<div class="field"><textarea id="sp-text" placeholder="세션에 입력할 내용"></textarea></div>`,
      [{ label: '취소' }, { label: '보내기', cls: 'primary', onClick: () => { const t = $('#sp-text').value.trim(); if (!t) return false; cur.lines.push(['', '> ' + t], ['d', `  [ep4 hook] 태스크로 등록됨 (trigger=${cur.kind === 'antigravity' ? 'antigravity_cli' : 'claude_cli'})`], ['', '  (데모) 세션 응답은 생략됩니다.']); cur.last_ts = nowStamp(); cur.status = 'busy'; setTimeout(() => { cur.status = 'idle'; if (location.hash.includes('sessions')) render(); }, 2500); render(); } }]);
    $('#sess-kill').onclick = () => showConfirm(cur.status === 'dead' ? `"${cur.name}" 을 목록에서 제거할까요?` : `"${cur.name}" 세션을 종료할까요? 실행 중인 프로세스가 있으면 함께 종료됩니다.`, { title: '세션 종료', ok: cur.status === 'dead' ? '제거' : '종료', danger: true, onOk: () => {
      if (cur.status === 'dead') DEMO.sessions.splice(DEMO.sessions.indexOf(cur), 1); else { cur.status = 'dead'; cur.pid = 0; cur.lines.push(['d', '(세션 종료됨)']); }
      S.sessionName = (DEMO.sessions[0] || {}).name; toast('처리했습니다 (데모)', 'ok'); render(); refreshNav();
    } });
  };

  R.plugins = (host) => {
    const P = DEMO.plugins;
    const tabs = [['installed', '설치됨'], ['market', '마켓플레이스'], ['settings', '⚙ 설정']];
    let body = '';
    if (S.plugTab === 'installed') {
      const filters = [['all', '전체'], ['view', 'View'], ['mcp', 'MCP'], ['claude', 'Claude'], ['agent', '도우미'], ['data', '📦 Data']];
      let list = P.installed;
      if (S.plugFilter !== 'all' && S.plugFilter !== 'data') list = list.filter((p) => p.type === S.plugFilter);
      body = `<div class="filter-chips">${filters.map(([f, l]) => `<button class="small ${S.plugFilter === f ? 'active' : ''}" data-pf="${f}">${l}</button>`).join('')}</div>`;
      if (S.plugFilter === 'data') {
        body += `<div class="small muted" style="margin-bottom:10px">플러그인 데이터는 언인스톨 후에도 보존됩니다. 재설치하면 자동으로 복구됩니다.</div>
          <div class="grid c2">${P.dataKeys.map((d) => `<div class="card plug"><div class="head"><div class="icon">📦</div><div><div class="name">${esc(d.label)}</div><div class="ver mono">${esc(d.key)} · ${esc(d.type)} · ${esc(d.size)}</div></div></div>
            <div class="desc">${esc(d.plugin)} ${d.installed ? tag('설치됨', 'green') : tag('언인스톨됨', 'yellow')}</div>
            <div class="foot"><span></span><div class="row" style="gap:6px">${!d.installed ? `<button class="small" data-restore="${d.pluginId}">복원</button>` : ''}<button class="small danger" data-deldata="${d.key}">데이터 삭제</button></div></div></div>`).join('') || '<div class="empty">보존된 플러그인 데이터가 없습니다.</div>'}</div>`;
      } else {
        body += `<div class="grid c3">${list.map((p) => `
          <div class="card plug" style="${p.enabled ? '' : 'opacity:.7'}">
            <div class="head"><div class="icon">${p.icon}</div><div><div class="name">${esc(p.name)} ${p.required ? tag('필수', 'yellow') : ''}</div><div class="ver">v${p.version} · ${tag(PTYPE[p.type][0], PTYPE[p.type][1])}</div></div></div>
            <div class="desc">${esc(p.desc)}</div>
            <div class="foot"><div class="row" style="gap:6px"><span class="switch ${p.enabled ? 'on' : ''} ${p.required ? 'locked' : ''}" data-toggle="${p.id}"></span><span class="small muted">${p.enabled ? '활성' : '비활성'}</span></div>
              ${p.required ? '<span class="small dim">삭제 불가</span>' : `<button class="small danger" data-uninstall="${p.id}">삭제</button>`}</div>
          </div>`).join('')}</div>`;
      }
    } else if (S.plugTab === 'market') {
      body = `<div class="row between" style="margin-bottom:12px"><span class="small muted">마켓 소스: Firebase + GitHub (모의) · 커뮤니티 플러그인 ${P.market.length}개</span><button class="small" id="mk-refresh">↻ 새로고침</button></div>
        <div class="grid c3">${P.market.map((m) => { const inst = P.installed.some((p) => p.id === m.id); return `
          <div class="card plug">
            <div class="head"><div class="icon">${m.icon}</div><div><div class="name">${esc(m.name)}</div><div class="ver">v${m.version} · ${esc(m.author)} · ${tag(PTYPE[m.type][0], PTYPE[m.type][1])}</div></div></div>
            <div class="desc">${esc(m.desc)}</div>
            <div class="foot"><span class="small dim">⬇ ${m.installs}</span>${inst ? tag('설치됨', 'green') : `<button class="small primary" data-install="${m.id}">설치</button>`}</div>
          </div>`; }).join('')}</div>`;
    } else {
      body = `<div class="card" style="max-width:640px">
        <h3>마켓플레이스 연동</h3>
        <div class="field"><label>소스</label><select><option>firebase+github</option><option>github</option><option>없음</option></select></div>
        <div class="field"><label>Firebase URL</label><input value="https://&lt;프로젝트&gt;.firebasedatabase.app" readonly /></div>
        <div class="field"><label>GitHub 저장소</label><input value="&lt;GitHub 사용자명&gt;/ep4-marketplace" readonly /></div>
        <div class="field"><label>GitHub 토큰</label><input value="ghp_••••••••••••••••••••" readonly /></div>
        <p class="small muted" style="margin:0">실제 EP4 에서는 conf/marketplace.conf 에 저장되며 이 파일은 git 에 커밋되지 않습니다. 데모에는 어떤 실제 값도 들어 있지 않습니다.</p>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="primary small" id="mk-save">저장</button></div>
      </div>`;
    }
    host.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<div class="tab-item ${S.plugTab === k ? 'active' : ''}" data-tab="${k}">${l}</div>`).join('')}</div>${body}`;
    $$('[data-tab]', host).forEach((t) => (t.onclick = () => { S.plugTab = t.dataset.tab; render(); }));
    $$('[data-pf]', host).forEach((b) => (b.onclick = () => { S.plugFilter = b.dataset.pf; render(); }));
    $$('[data-toggle]', host).forEach((sw) => (sw.onclick = () => { const p = P.installed.find((x) => x.id === sw.dataset.toggle); if (p.required) { toast('필수 플러그인은 비활성화할 수 없습니다', 'err'); return; } p.enabled = !p.enabled; toast(`${p.name} ${p.enabled ? '활성화' : '비활성화'} (ep4_on_plugin_toggle 훅 호출 — 모의)`, 'ok'); render(); refreshNav(); }));
    $$('[data-uninstall]', host).forEach((b) => (b.onclick = () => { const p = P.installed.find((x) => x.id === b.dataset.uninstall); showConfirm(`"${p.name}" 플러그인을 삭제할까요? 플러그인 데이터는 보존됩니다.`, { title: '플러그인 삭제', ok: '삭제', danger: true, onOk: () => { P.installed.splice(P.installed.indexOf(p), 1); P.dataKeys.forEach((d) => { if (d.pluginId === p.id) d.installed = false; }); toast(`${p.name} 삭제 (DELETE /api/plugins/${p.id} — 모의)`, 'ok'); render(); refreshNav(); } }); }));
    $$('[data-install]', host).forEach((b) => (b.onclick = () => { const m = P.market.find((x) => x.id === b.dataset.install); P.installed.push({ id: m.id, type: m.type, name: m.name, icon: m.icon, version: m.version, enabled: true, required: false, desc: m.desc }); P.dataKeys.forEach((d) => { if (d.pluginId === m.id) d.installed = true; }); toast(`${m.name} 설치 완료 — 서버가 plugin.json 을 스캔해 메뉴에 반영 (모의)`, 'ok'); render(); refreshNav(); }));
    $$('[data-restore]', host).forEach((b) => (b.onclick = () => { S.plugTab = 'market'; render(); toast('마켓플레이스에서 다시 설치하면 데이터가 자동 복구됩니다'); }));
    $$('[data-deldata]', host).forEach((b) => (b.onclick = () => { const d = P.dataKeys.find((x) => x.key === b.dataset.deldata); showConfirm(`"${d.label}" 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`, { title: '데이터 삭제', ok: '삭제', danger: true, onOk: () => { P.dataKeys.splice(P.dataKeys.indexOf(d), 1); toast('데이터를 삭제했습니다 (localStorage — 모의)', 'ok'); render(); } }); }));
    const mr = $('#mk-refresh'); if (mr) mr.onclick = () => demoOnly('마켓 새로고침');
    const ms = $('#mk-save'); if (ms) ms.onclick = () => demoOnly('마켓 설정 저장');
  };

  R.help = (host) => {
    host.innerHTML = `<div class="stack help">
      <div class="card"><h2>📘 개요</h2>
        <p>EasyProject4(EP4)는 <b>로컬 PC의 Claude CLI에게 일을 시키는 태스크 하네스</b>입니다. 프로젝트별로 할 일을 큐에 쌓아두면 순서대로 Claude CLI 를 실행하고, Git 브랜치 격리 → 커밋 → main 머지까지 자동으로 처리합니다.</p>
        <pre>할 일을 적는다 → 실행을 누른다 → 커피를 마신다 → diff 를 확인한다</pre>
        <ol>
          <li><b>프로젝트</b> 화면에서 프로젝트를 만들고 <code>project_root</code> 에 작업할 저장소 경로를 지정합니다.</li>
          <li><b>태스크</b> 화면에서 할 일과 프롬프트를 등록합니다. 트리거(수동·스케줄·선행 완료 후)와 모델을 태스크별로 바꿀 수 있습니다.</li>
          <li>왼쪽 <b>실행</b> 을 누르면 하네스가 대기 중인 태스크를 순서대로 처리합니다. 실행 중 추가한 태스크는 큐에 쌓여 이어서 실행됩니다.</li>
          <li><b>실행 로그</b> 에서 로그·diff·커밋을 확인합니다. 실패하면 재시도 횟수만큼 자동 재시도합니다.</li>
        </ol>
        <h3>Git 격리</h3>
        <p><code>project_root</code> 에 git 이 있으면 태스크마다 <code>project/{slug}/taskNNN</code> worktree 브랜치에서 격리 실행하고, 완료 시 프로젝트 브랜치를 거쳐 main 까지 자동 머지합니다. 충돌이 나면 안전하게 중단하고 로그에 남깁니다.</p>
      </div>
      <div class="card"><h2>🖥 세션</h2>
        <p>세션 화면에서 명령프롬프트(PTY)·Claude CLI·Antigravity CLI 세션을 띄워둘 수 있습니다. 프로젝트의 <code>session_name</code> 에 세션 이름을 지정하면 subprocess 대신 그 세션으로 프롬프트가 전달되어 대화 맥락이 유지됩니다.</p>
      </div>
      <div class="card"><h2>🔌 외부 연동 API</h2>
        <h3>인증</h3>
        <p>모든 <code>/api/*</code> 요청은 Bearer 토큰이 필요합니다. 토큰은 최초 실행 시 <code>conf/ep4.local.conf</code> 에 자동 생성됩니다 (아래 값은 예시).</p>
        <pre>curl -H "Authorization: Bearer ep4_demo_token_xxxxxxxx" http://localhost:7788/api/projects</pre>
        <h3>주요 엔드포인트</h3>
        <div class="api"><span class="m">GET</span><span>/api/projects <span class="d">— 프로젝트 목록</span></span></div>
        <div class="api"><span class="m post">POST</span><span>/api/projects/{id}/tasks <span class="d">— 태스크 등록 {title, prompt, trigger_type}</span></span></div>
        <div class="api"><span class="m post">POST</span><span>/api/projects/{id}/tasks/{tid}/run <span class="d">— 태스크 실행</span></span></div>
        <div class="api"><span class="m post">POST</span><span>/api/projects/{id}/tasks/{tid}/log-result <span class="d">— CLI 훅이 결과 기록</span></span></div>
        <div class="api"><span class="m">GET</span><span>/api/runs?project_id=1 <span class="d">— 실행 로그</span></span></div>
        <div class="api"><span class="m">GET</span><span>/api/events <span class="d">— SSE 스트림 (run_start, log_line, run_done, plugins_changed…)</span></span></div>
        <div class="api"><span class="m">GET</span><span>/api/plugins <span class="d">— 플러그인 레지스트리</span></span></div>
        <div class="api"><span class="m del">DELETE</span><span>/api/plugins/{id} <span class="d">— 플러그인 삭제</span></span></div>
        <h3>예시 — 태스크 등록 후 실행</h3>
        <pre>curl -X POST http://localhost:7788/api/projects/1/tasks \\
  -H "Authorization: Bearer $EP4_TOKEN" -H "Content-Type: application/json" \\
  -d '{"title":"README 오타 수정","prompt":"README.md 의 오타를 찾아 고쳐줘","trigger_type":"manual"}'

# → {"ok": true, "id": 105}
curl -X POST -H "Authorization: Bearer $EP4_TOKEN" http://localhost:7788/api/projects/1/tasks/105/run</pre>
      </div>
      <div class="card"><h2>⌨ Claude CLI · Antigravity CLI 훅</h2>
        <p><code>~/.claude/settings.json</code> 에 MCP 서버(<code>ep4_mcp.py</code>)와 훅(<code>ep4_hook_prompt.py</code>, <code>ep4_hook_stop.py</code>)을 등록하면 터미널에서 나눈 대화가 자동으로 EP4 태스크·실행 로그로 기록됩니다. Gemini CLI 는 같은 스크립트에 <code>antigravity_cli</code> 인자만 넘겨 재사용합니다.</p>
        <ul>
          <li><b>ep4_find_project</b> — 현재 폴더와 project_root 매칭</li>
          <li><b>ep4_create_task</b> — 태스크 등록 (trigger_type: claude_cli)</li>
          <li><b>ep4_log_result</b> — 응답 완료 시 결과 기록</li>
          <li><b>ep4_list_projects</b> — 전체 프로젝트 목록</li>
        </ul>
        <p class="small muted">훅은 EP4 서버가 꺼져 있으면 조용히 종료하므로 CLI 동작에 영향이 없습니다.</p>
      </div>
    </div>`;
  };

  /* ---------- 하네스 실행 시뮬레이션 ---------- */
  function startHarness(taskId) {
    if (S.running) { toast('이미 실행 중입니다. 완료 후 다음 태스크가 이어서 실행됩니다.'); return; }
    const p = project(S.projectId) || DEMO.projects[0];
    let t = taskId ? DEMO.tasks.find((x) => x.id === taskId) : tasksOf(p.id).find(runnable);
    if (!t) { toast(`"${p.name}" 에 지금 실행할 수 있는 대기 태스크가 없습니다 (스케줄·선행 미완료 제외). 태스크를 추가해 보세요.`); return; }
    if (t.trigger_type === 'on_dependency' && !depDone(t)) { toast(`#${t.id} 는 선행 태스크가 완료된 뒤 실행됩니다`, 'err'); return; }
    const proj = project(t.project_id);
    const n = String(tasksOf(proj.id).indexOf(t) + 1).padStart(3, '0');
    const model = t.model_override || proj.model;
    t.status = 'running'; t.started_at = nowStamp(); t.branch = proj.branch ? `project/${proj.slug}/task${n}` : '';
    const run = { id: S.nextRunId++, task_id: t.id, project_id: proj.id, task_title: t.title, project_name: proj.name, attempt: 1, status: 'running', trigger_type: t.trigger_type, model, started_at: nowStamp() + ':' + pad(new Date().getSeconds()), ended_at: '', trace_id: Math.random().toString(16).slice(2, 14), span_id: Math.random().toString(16).slice(2, 6), git_task_branch: t.branch, git_proj_branch: proj.branch, git_merge_status: '', commits: [], diff: [], log: [] };
    DEMO.runs.unshift(run);
    S.running = { taskId: t.id, runId: run.id, step: 0, timer: null };
    setStatus(true, `실행 중 — ${t.title}`);
    toast(`▶ 태스크 #${t.id} 실행 시작 (데모 — 가짜 로그가 흘러갑니다)`, 'ok');
    render(); refreshNav();
    const tick = () => {
      if (S.paused) { S.running.timer = setTimeout(tick, 500); return; }
      const i = S.running.step++;
      if (i < DEMO.simLog.length) {
        const [cls, raw] = DEMO.simLog[i];
        let msg = raw.replace(/\{slug\}/g, proj.slug).replace(/\{n\}/g, n).replace(/\{model\}/g, model);
        if (!proj.branch && cls === 'git') { msg = '[git] project_root 에 .git 없음 → worktree 없이 직접 실행'; run.log.push({ t: nowT(), cls: 'warn', msg }); }
        else run.log.push({ t: nowT(), cls, msg });
        appendLogLine(run.id, run.log[run.log.length - 1]);
        S.running.timer = setTimeout(tick, 900 + Math.random() * 900);
      } else finishRun(t, run, proj);
    };
    S.running.timer = setTimeout(tick, 700);
  }
  function appendLogLine(runId, line) {
    const box = $(`[data-logbox="${runId}"]`);
    if (!box) return;
    const cur = box.querySelector('.cursor'); const div = document.createElement('div'); div.innerHTML = logLine(line);
    if (cur) cur.parentElement.before(div.firstChild); else box.appendChild(div.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function finishRun(t, run, proj) {
    t.status = 'done'; t.ended_at = nowStamp();
    t.output = '(데모) 요청한 변경을 적용하고 테스트를 통과했습니다. 실제 EP4 에서는 Claude CLI 의 최종 응답이 여기에 기록됩니다.';
    run.status = 'done'; run.ended_at = nowStamp() + ':' + pad(new Date().getSeconds());
    if (proj.branch) { run.git_merge_status = 'merged→main'; run.commits = [{ sha: Math.random().toString(16).slice(2, 9), msg: `feat: ${t.title}` }]; run.diff = [{ file: 'src/example.ts', add: 12 + Math.floor(Math.random() * 60), del: Math.floor(Math.random() * 15) }, { file: 'tests/example.test.ts', add: 20 + Math.floor(Math.random() * 40), del: 0 }]; }
    else run.git_merge_status = 'no git';
    DEMO.last7[DEMO.last7.length - 1].runs += 1;
    S.running = null; setStatus(false, '대기 중');
    toast(`✅ 태스크 #${t.id} 완료 — SSE run_done (모의)`, 'ok');
    render(); refreshNav();
    // 큐에 남은 태스크가 있고 auto_run 이면 이어서 실행
    const next = tasksOf(proj.id).find(runnable);
    if (next && proj.auto_run) setTimeout(() => { if (!S.running) { toast(`다음 대기 태스크 #${next.id} 를 이어서 실행합니다`); startHarness(next.id); } }, 1800);
  }
  function setStatus(running, text) {
    $('#sb-dot').classList.toggle('run', running);
    $('#sb-status-text').textContent = text;
    $('#header-status-text').textContent = running ? '서버 연결됨 · 실행 중 (모의)' : '서버 연결됨 (모의)';
  }

  /* ---------- 라우팅 / 네비 ---------- */
  function currentKey() {
    const k = (location.hash || '#/dashboard').replace(/^#\/?(view\/)?/, '').split(/[/?]/)[0];
    const v = VIEWS.find((x) => x.key === k && enabledView(pluginIdOf(x.key)));
    return v ? v.key : (enabledView('dashboard') ? 'dashboard' : VIEWS.find((x) => enabledView(pluginIdOf(x.key))).key);
  }
  const pluginIdOf = (key) => ({ todo: 'tasks', log: 'runlog' }[key] || key);
  function refreshNav() {
    $('#nav-menu-main').innerHTML = VIEWS.filter((v) => enabledView(pluginIdOf(v.key))).map((v) => {
      const b = v.badge ? v.badge() : ''; return `<a class="nav-item ${currentKey() === v.key ? 'active' : ''}" href="#/${v.key}"><span class="nav-icon">${v.icon}</span><span>${v.label}</span>${b ? `<span class="nav-badge ${v.badgeCls || ''}">${b}</span>` : ''}</a>`;
    }).join('');
    $$('#nav-menu-main .nav-item').forEach((a) => (a.onclick = () => closeSidebar()));
  }
  function renderGuide(key) {
    const g = GUIDE[key], v = VIEWS.find((x) => x.key === key);
    $('#guide').innerHTML = `
      <h3>${v.icon} ${esc(v.label)} <span class="tag orange">안내</span></h3>
      <div class="summary">${esc(g.summary)}</div>
      <h4>무엇을 보여주나</h4><ul>${g.shows.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <h4>사용 순서</h4><ol>${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="note"><b>실제 시스템에서는</b><br/>${esc(g.real)}</div>
      <div class="try"><b>데모에서 해볼 것</b><ul style="margin-top:4px">${g.tips.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`;
  }
  function render() {
    const key = currentKey();
    const v = VIEWS.find((x) => x.key === key);
    $('#page-title').textContent = v.label;
    R[key]($('#content'));
    renderGuide(key);
    refreshNav();
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });

  /* ---------- 헤더 / 설정 / 사이드바 ---------- */
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sb-backdrop').classList.remove('show'); }
  $('#nav-toggle').onclick = () => { $('#sidebar').classList.toggle('open'); $('#sb-backdrop').classList.toggle('show'); };
  $('#sb-backdrop').onclick = closeSidebar;
  $('#nav-run').onclick = () => { if (S.paused) { S.paused = false; toast('일시정지를 해제했습니다', 'ok'); return; } startHarness(); };
  $('#nav-pause').onclick = () => { if (!S.running) { toast('실행 중인 태스크가 없습니다'); return; } S.paused = !S.paused; setStatus(!S.paused, S.paused ? '일시정지 — 현재 태스크 종료 후 대기' : '실행 중'); toast(S.paused ? '⏸ 일시정지 — 실제로는 현재 태스크가 끝난 뒤 큐를 멈춥니다' : '▶ 다시 실행'); };
  $('#nav-reset').onclick = () => showConfirm('데모 데이터를 초기 상태로 되돌릴까요? (페이지 새로고침)', { title: '새로고침', ok: '새로고침', onOk: () => location.reload() });
  $('#globalSearch').oninput = (e) => { S.search = e.target.value.trim(); if (S.search && currentKey() !== 'todo') location.hash = '#/todo'; else render(); };
  $('#globalSearch').onkeydown = (e) => { if (e.key === 'Escape') { S.search = ''; e.target.value = ''; render(); } };
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#globalSearch').focus(); } if (e.key === 'Escape') { closeModal(); $('#settingsDropdown').hidden = true; } });

  $('#btn-settings').onclick = (e) => { e.stopPropagation(); const d = $('#settingsDropdown'); d.hidden = !d.hidden; };
  document.addEventListener('click', (e) => { if (!e.target.closest('.settings-wrap')) $('#settingsDropdown').hidden = true; });
  $$('[data-theme]').forEach((b) => (b.onclick = () => setTheme(b.dataset.theme)));
  $$('[data-lang]').forEach((b) => (b.onclick = () => { $$('[data-lang] .chk').forEach((c) => (c.textContent = '')); b.querySelector('.chk').textContent = '✓'; if (b.dataset.lang !== 'ko') toast('데모는 한국어만 제공합니다. 실제 EP4 는 6개 언어(ko·en·zh·fr·de·es)와 자동 번역을 지원합니다.'); }));
  function setTheme(t) {
    document.body.className = 'theme-' + t;
    $$('[data-theme] .chk').forEach((c) => (c.textContent = ''));
    $(`[data-theme="${t}"] .chk`).textContent = '✓';
    try { localStorage.setItem('ep4_demo_theme', t); } catch { /* ignore */ }
  }
  try { const saved = localStorage.getItem('ep4_demo_theme'); if (saved) setTheme(saved); } catch { /* ignore */ }

  $('#btn-qr').onclick = () => {
    // 결정적 가짜 QR 패턴 (실제 인코딩 아님)
    let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const cells = Array.from({ length: 169 }, (_, i) => { const x = i % 13, y = Math.floor(i / 13); const corner = (x < 4 && y < 4) || (x > 8 && y < 4) || (x < 4 && y > 8); const ring = corner && (x % 8 === 0 || x % 8 === 3 || y % 8 === 0 || y % 8 === 3 || (x % 8 > 0 && x % 8 < 3 && y % 8 > 0 && y % 8 < 3)); return `<i class="${corner ? (ring ? 'b' : '') : (rnd() > .5 ? 'b' : '')}"></i>`; }).join('');
    openModal('📱 모바일 QR 연결', `
      <p class="small muted" style="margin:0 0 6px">Flutter 앱의 "QR 스캔" 으로 이 코드를 읽으면 서버 주소와 인증 토큰이 함께 전달됩니다. 외부에서 접속하려면 <code>tunnel.bat</code> 으로 Cloudflare 임시 터널을 먼저 여세요.</p>
      <div class="qr">${cells}</div>
      <div class="kv"><span class="k">서버</span><span class="v mono small">http://localhost:7788 (모의)</span></div>
      <div class="kv"><span class="k">터널</span><span class="v mono small">https://xxxx.trycloudflare.com (꺼짐)</span></div>
      <div class="kv"><span class="k">토큰</span><span class="v mono small">ep4_demo_••••••••</span></div>
      <p class="small dim" style="margin:8px 0 0">이 QR 은 그림일 뿐이며 실제 데이터를 담고 있지 않습니다.</p>`, [{ label: '닫기', cls: 'primary' }]);
  };
  $('#modal-x').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

  /* ---------- 도우미 ---------- */
  const H = DEMO.helper;
  function helperSay(text, who = 'bot') { const m = document.createElement('div'); m.className = 'msg ' + who; m.textContent = text; $('#helperMsgs').appendChild(m); $('#helperMsgs').scrollTop = 1e9; }
  function helperAsk(q) {
    if (!q) return; helperSay(q, 'user');
    const low = q.toLowerCase();
    const hit = H.answers.find((a) => a.k.some((k) => low.includes(k.toLowerCase())));
    setTimeout(() => helperSay(hit ? hit.a : H.fallback), 350);
  }
  $('#helperBtn').onclick = () => { const p = $('#helper'); p.classList.toggle('show'); if (p.classList.contains('show') && !$('#helperMsgs').children.length) { helperSay('안녕하세요! EP4 문어 도우미예요 🐙 이 데모에서는 정해진 질문에만 답할 수 있어요. 아래 버튼을 눌러보세요.'); $('#helperQuick').innerHTML = H.quick.map((q) => `<button>${esc(q)}</button>`).join(''); $$('#helperQuick button').forEach((b) => (b.onclick = () => helperAsk(b.textContent))); } };
  $('#helperClose').onclick = () => $('#helper').classList.remove('show');
  $('#helperSend').onclick = () => { const v = $('#helperIn').value.trim(); $('#helperIn').value = ''; helperAsk(v); };
  $('#helperIn').onkeydown = (e) => { if (e.key === 'Enter') $('#helperSend').click(); };

  /* ---------- 배너 높이 → CSS 변수 (배너가 줄바꿈되어도 사이드바·헤더 위치 유지) ---------- */
  (function trackBanner() {
    const bn = $('.demo-banner'); if (!bn) return;
    const set = () => document.documentElement.style.setProperty('--banner-h', bn.offsetHeight + 'px');
    set(); if (window.ResizeObserver) new ResizeObserver(set).observe(bn); else window.addEventListener('resize', set);
  })();

  /* ---------- 시작 ---------- */
  // 진행 중인 mock 실행(#9007)에 로그를 천천히 붙여 "실시간" 느낌을 낸다 (사용자 실행과 별개)
  (function liveTail() {
    const r = DEMO.runs.find((x) => x.id === 9007); if (!r || r.status !== 'running') return;
    const extra = [['claude', '[claude] 빌드 완료 · Lighthouse 측정 중 (mobile, 3 runs)'], ['', '[claude] LCP 3.4s → 2.1s · CLS 변화 없음'], ['claude', '[claude] 리포트를 docs/perf/lazy-images.md 로 저장합니다.'], ['git', '[git] commit 7b3e0d2 · 4 files changed, 61 insertions(+), 9 deletions(-)'], ['git', '[git] merge project/shop-web/task003 → project/shop-web → main'], ['sys', '[harness] 완료 (3m 40s)']];
    let i = 0;
    const step = () => {
      if (i < extra.length) { const [cls, msg] = extra[i++]; r.log.push({ t: nowT(), cls, msg }); appendLogLine(r.id, r.log[r.log.length - 1]); setTimeout(step, 6000 + Math.random() * 6000); }
      else { r.status = 'done'; r.ended_at = nowStamp() + ':00'; r.git_merge_status = 'merged→main'; r.commits = [{ sha: '7b3e0d2', msg: 'perf(product): lazy-load gallery images, prioritize LCP image' }]; r.diff = [{ file: 'components/product/Gallery.tsx', add: 31, del: 9 }, { file: 'docs/perf/lazy-images.md', add: 30, del: 0 }]; const t = DEMO.tasks.find((x) => x.id === 103); if (t && t.status === 'running') { t.status = 'done'; t.ended_at = nowStamp(); t.output = 'Gallery 이미지 12개 lazy loading 적용, 첫 이미지는 fetchpriority=high. LCP 3.4s → 2.1s.'; } toast('✅ #103 상품 상세 이미지 lazy loading 완료 (모의 SSE run_done)', 'ok'); render(); refreshNav(); }
    };
    setTimeout(step, 9000);
  })();

  render();
})();
