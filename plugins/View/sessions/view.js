/**
 * 세션 View — 외부 플러그인 (명령프롬프트 PTY 세션 + Claude CLI 세션)
 *
 * app.js에서 완전 이식. 호스트 헬퍼(esc/_timeAgo/showAlert/showConfirm)와
 * 현재 프로젝트 상태(window.EP4App)는 셸/앱에서 참조한다.
 */

// ── 호스트 헬퍼 ────────────────────────────────────────────
const esc = (s) => (window.esc ? window.esc(s)
  : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
const _timeAgo = (t) => (window._timeAgo ? window._timeAgo(t) : t);
const showAlert = (m, o) => (window.showAlert ? window.showAlert(m, o) : alert(m));
const showConfirm = (m, o) => (window.showConfirm ? window.showConfirm(m, o) : Promise.resolve(confirm(m)));
const App = () => window.EP4App || { currentProjectId: null, currentProjectName: '', projects: [] };

// ── i18n ──────────────────────────────────────────────────
const _SESS_I18N = {
  ko: {
    tab_cmd:           '명령프롬프트 세션',
    tab_claude:        '클로드 세션',
    tab_antigravity:   '안티그래비티 세션',
    ag_list:           '안티그래비티 세션 목록',
    ag_inputs:         '입력',
    ag_steps:          '실행 과정',
    session_list:      '세션 목록',
    add:               '+ 추가',
    no_session:        '세션 없음',
    select_or_create:  '세션을 선택하거나 새로 생성하세요',
    select_session:    '세션을 선택하세요',
    session_name_ph:   '세션명',
    input_toggle:      '✏ 입력',
    input_on:          '✏ 입력 ON',
    input_toggle_title:'입력 모드 켜기/끄기',
    log_label:         '📄 로그:',
    copy:              '복사',
    copied:            '복사됨',
    copy_failed:       '복사 실패',
    max_buffer:        '최대 버퍼 (항목)',
    log_file:          '로그 파일 경로',
    save:              '저장',
    auto_scroll:       '자동 스크롤',
    input_placeholder: '메시지 입력 후 Enter…',
    send:              '전송',
    claude_list:       '클로드 세션 목록',
    new_session:       '새 세션 추가',
    session_name:      '세션 이름',
    working_dir:       '실행 디렉토리',
    manual_input:      '— 직접 입력 —',
    working_dir_hint:  '세션이 시작될 작업 디렉토리 (비워두면 서버 기본 경로)',
    command_select:    '커맨드 선택',
    manual_btn:        '직접 입력',
    command:           '커맨드',
    command_hint:      '실행할 명령어를 입력하세요',
    cancel:            '취소',
    start_session:     '▶ 세션 시작',
    loading:           '대화 내용 불러오는 중…',
    load_failed:       '불러오기 실패',
    server_error:      '서버 오류',
    messages:          '메시지',
    tool_calls:        '도구 호출',
    tokens:            '토큰',
    errors:            '오류',
    session_id:        '세션 ID',
    model:             '모델',
    last_active:       '마지막 활동',
    first_message:     '첫 메시지',
    turns_fmt:         '{0}턴 (👤 {1} / 🤖 {2})',
    duration_suffix:   '지속 {0}',
    no_messages:       '표시할 대화가 없습니다.',
    working_path:      '작업 경로: ',
    truncated_notice:  '⚠ 메시지가 많아 최근 {0}개만 표시합니다.',
    conversation_count:'대화 내용 ({0})',
    user_label:        '👤 사용자',
    copied_session_id: '세션 ID가 복사되었습니다.',
    status_running:    '● 실행 중',
    status_dead:       '○ 종료됨',
    kill:              '종료',
    remove:            '제거',
    dead_tooltip:      '종료된 세션 — 입력 불가',
    dead_msg:          '종료된 세션입니다.\n새 세션을 생성하거나 다른 세션을 선택하세요.',
    create_failed:     '세션 생성 실패: {0}',
    kill_confirm:      '세션을 종료하시겠습니까?',
    dur_sec:           '{0}초',
    dur_min:           '{0}분',
    dur_h:             '{0}시간 {1}분',
  },
  en: {
    tab_cmd:           'Terminal Sessions',
    tab_claude:        'Claude Sessions',
    tab_antigravity:   'Antigravity Sessions',
    ag_list:           'Antigravity Sessions',
    ag_inputs:         'Inputs',
    ag_steps:          'Execution Steps',
    session_list:      'Sessions',
    add:               '+ Add',
    no_session:        'No sessions',
    select_or_create:  'Select or create a session',
    select_session:    'Select a session',
    session_name_ph:   'Name',
    input_toggle:      '✏ Input',
    input_on:          '✏ Input ON',
    input_toggle_title:'Toggle input mode',
    log_label:         '📄 Log:',
    copy:              'Copy',
    copied:            'Copied',
    copy_failed:       'Copy failed',
    max_buffer:        'Max buffer (lines)',
    log_file:          'Log file path',
    save:              'Save',
    auto_scroll:       'Auto scroll',
    input_placeholder: 'Type a message and press Enter…',
    send:              'Send',
    claude_list:       'Claude Sessions',
    new_session:       'New Session',
    session_name:      'Session name',
    working_dir:       'Working directory',
    manual_input:      '— Enter manually —',
    working_dir_hint:  'Working directory where the session starts (leave empty for server default)',
    command_select:    'Select command',
    manual_btn:        'Custom',
    command:           'Command',
    command_hint:      'Enter the command to run',
    cancel:            'Cancel',
    start_session:     '▶ Start Session',
    loading:           'Loading conversation…',
    load_failed:       'Load failed',
    server_error:      'Server error',
    messages:          'Messages',
    tool_calls:        'Tool calls',
    tokens:            'Tokens',
    errors:            'Errors',
    session_id:        'Session ID',
    model:             'Model',
    last_active:       'Last active',
    first_message:     'First message',
    turns_fmt:         '{0} turns (👤 {1} / 🤖 {2})',
    duration_suffix:   'Duration: {0}',
    no_messages:       'No conversation to display.',
    working_path:      'Working path: ',
    truncated_notice:  '⚠ Showing last {0} messages only.',
    conversation_count:'Conversation ({0})',
    user_label:        '👤 User',
    copied_session_id: 'Session ID copied.',
    status_running:    '● Running',
    status_dead:       '○ Stopped',
    kill:              'Stop',
    remove:            'Remove',
    dead_tooltip:      'Session stopped — input disabled',
    dead_msg:          'Session has stopped.\nCreate a new session or select another.',
    create_failed:     'Failed to create session: {0}',
    kill_confirm:      'Stop this session?',
    dur_sec:           '{0}s',
    dur_min:           '{0}m',
    dur_h:             '{0}h {1}m',
  },
};

function _sT(key, ...args) {
  const lang = window._EP4_LANG || 'ko';
  const dict = _SESS_I18N[lang] || _SESS_I18N.ko;
  let s = dict[key] !== undefined ? dict[key] : (_SESS_I18N.ko[key] || key);
  args.forEach((a, i) => { s = s.replace('{' + i + '}', a); });
  return s;
}

// ── 모듈 상태 ──────────────────────────────────────────────
let _ctx = null;
let _sessions = [];
let _currentSessionId = null;
let _claudeSessions = [];
let _currentClaudeSessId = null;
let _agSessions = [];
let _currentAgSessId = null;
let _sessAutoScroll = true;
let _sessScreenEl = null;

const SESS_PRESETS = { 'Claude': 'claude --dangerously-skip-permissions' };

// ── 마크업 (함수 - mount 시점에 언어 반영) ─────────────────
const SESS_HTML = () => `
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:16px 20px;gap:0;min-height:0;">
    <div class="sess-subtab-bar">
      <button class="sess-subtab active" id="subtab-cmd" onclick="showSessSubtab('cmd')">${_sT('tab_cmd')}</button>
      <button class="sess-subtab" id="subtab-claude" onclick="showSessSubtab('claude')">${_sT('tab_claude')}</button>
      <button class="sess-subtab" id="subtab-antigravity" onclick="showSessSubtab('antigravity')">${_sT('tab_antigravity')}</button>
    </div>

    <div id="sess-panel-cmd" class="sess-split" style="flex:1;min-height:0;margin-top:12px;">
      <div class="sess-left-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;">
          <span style="font-size:.8rem;font-weight:700;color:var(--text);">${_sT('session_list')}</span>
          <button class="sess-new-btn" style="width:auto;padding:5px 12px;font-size:.78rem;" onclick="openSessCreateModal()">${_sT('add')}</button>
        </div>
        <div class="sess-list-panel" id="sess-list">
          <div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:20px 0;">${_sT('no_session')}</div>
        </div>
      </div>
      <div class="sess-term-panel">
        <div class="sess-empty" id="sess-empty">
          <span style="font-size:2rem;">🖥</span>
          <span>${_sT('select_or_create')}</span>
        </div>
        <div id="sess-term-panel" style="display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0;">
          <div class="sess-term-header">
            <span class="sess-dot running" id="sess-term-dot"></span>
            <span id="sess-term-name">${_sT('session_name_ph')}</span>
            <span id="sess-term-pid" style="font-size:.7rem;color:var(--text-dim);"></span>
            <button class="sess-input-toggle" id="sessInputToggle" onclick="toggleSessInputMode()" title="${_sT('input_toggle_title')}">✏ ${_sT('input_toggle').replace('✏ ','')}</button>
            <button class="sess-hdr-btn" onclick="toggleSessSettings()" title="Settings">⚙</button>
            <button class="sess-hdr-btn" onclick="clearSessOutput()" title="Clear output" style="color:#f87171;">🗑</button>
          </div>
          <div id="sessLogBar" style="display:none;align-items:center;gap:6px;padding:4px 12px;border-bottom:1px solid var(--border);background:var(--bg-soft);flex-shrink:0;font-size:.72rem;color:var(--text-dim);">
            <span style="flex-shrink:0;">${_sT('log_label')}</span>
            <span id="sessLogPath" title="" style="font-family:'Consolas',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;"></span>
            <button class="sess-hdr-btn" onclick="copySessLogPath()" title="Copy path" style="flex-shrink:0;padding:1px 7px;">${_sT('copy')}</button>
          </div>
          <div id="sessSettingsPanel" style="display:none;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--bg-soft);flex-shrink:0;">
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px 12px;align-items:center;font-size:.8rem;">
              <label style="color:var(--text-mute);">${_sT('max_buffer')}</label>
              <input id="sessMaxBuffer" type="number" min="100" max="100000" step="100"
                style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.8rem;outline:none;width:100%;box-sizing:border-box;">
              <label style="color:var(--text-mute);">${_sT('log_file')}</label>
              <input id="sessLogFile" type="text" placeholder="log/session_timestamp.log"
                style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.78rem;outline:none;width:100%;box-sizing:border-box;font-family:'Consolas','Courier New',monospace;">
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:10px;">
              <button class="btn-accent" style="padding:5px 16px;font-size:.78rem;border-radius:7px;" onclick="saveSessSettings()">${_sT('save')}</button>
            </div>
          </div>
          <div class="sess-term-output" id="sess-term-output"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-shrink:0;">
            <label class="sess-autoscroll-label">
              <input type="checkbox" id="sessAutoScrollChk" checked onchange="setSessAutoScroll(this.checked)">
              <span>${_sT('auto_scroll')}</span>
            </label>
            <div class="sess-input-row" id="sessInputRow" style="display:none;flex:1;margin-top:0;">
              <input id="sess-input" placeholder="${_sT('input_placeholder')}"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendSessionInputFromUI();}" />
              <button class="btn-accent" style="padding:8px 14px;font-size:.82rem;border-radius:8px;" onclick="sendSessionInputFromUI()">${_sT('send')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="sess-panel-claude" class="sess-split" style="display:none;flex:1;min-height:0;margin-top:12px;">
      <div class="sess-left-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;">
          <span style="font-size:.8rem;font-weight:700;color:var(--text);">${_sT('claude_list')}</span>
          <button class="sess-new-btn" style="width:auto;padding:5px 12px;font-size:.78rem;" onclick="fetchClaudeSessions()">↺</button>
        </div>
        <div class="sess-list-panel" id="claude-sess-list">
          <div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:20px 0;">${_sT('no_session')}</div>
        </div>
      </div>
      <div class="sess-term-panel">
        <div class="sess-empty" id="claude-sess-empty">
          <span style="font-size:2rem;">🤖</span>
          <span>${_sT('select_session')}</span>
        </div>
        <div id="claude-sess-detail-wrap" style="display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0;">
          <div class="sess-term-header">
            <span class="sess-dot running"></span>
            <span id="claude-sess-title" style="font-size:.85rem;font-weight:600;"></span>
          </div>
          <div class="claude-sess-detail" id="claude-sess-detail"></div>
        </div>
      </div>
    </div>

    <div id="sess-panel-antigravity" class="sess-split" style="display:none;flex:1;min-height:0;margin-top:12px;">
      <div class="sess-left-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;">
          <span style="font-size:.8rem;font-weight:700;color:var(--text);">${_sT('ag_list')}</span>
          <button class="sess-new-btn" style="width:auto;padding:5px 12px;font-size:.78rem;" onclick="fetchAntigravitySessions()">↺</button>
        </div>
        <div class="sess-list-panel" id="ag-sess-list">
          <div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:20px 0;">${_sT('no_session')}</div>
        </div>
      </div>
      <div class="sess-term-panel">
        <div class="sess-empty" id="ag-sess-empty">
          <span style="font-size:2rem;">🪐</span>
          <span>${_sT('select_session')}</span>
        </div>
        <div id="ag-sess-detail-wrap" style="display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0;">
          <div class="sess-term-header">
            <span class="sess-dot running"></span>
            <span id="ag-sess-title" style="font-size:.85rem;font-weight:600;"></span>
          </div>
          <div class="claude-sess-detail" id="ag-sess-detail"></div>
        </div>
      </div>
    </div>
  </div>`;

const SESS_MODAL_HTML = () => `
<div id="sessCreateModal" style="display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);align-items:center;justify-content:center;">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;width:460px;max-width:95vw;position:relative;">
    <button onclick="closeSessCreateModal()" style="position:absolute;top:14px;right:16px;background:none;border:none;color:var(--text-mute);font-size:1.2rem;cursor:pointer;">✕</button>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <span style="font-size:1.4rem;">🖥</span>
      <h3 style="margin:0;font-size:1.05rem;">${_sT('new_session')}</h3>
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:.8rem;color:var(--text-mute);display:block;margin-bottom:4px;">${_sT('session_name')}</label>
      <input id="sessCreateName" type="text" placeholder="my-session"
        style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:.9rem;outline:none;"
        onkeydown="if(event.key==='Enter')document.getElementById('sessCreateCmd').focus()">
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:.8rem;color:var(--text-mute);display:block;margin-bottom:6px;">${_sT('working_dir')}</label>
      <select id="sessCwdProject" onchange="onSessCwdProjectChange()"
        style="width:100%;box-sizing:border-box;margin-bottom:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:.82rem;outline:none;">
        <option value="">${_sT('manual_input')}</option>
      </select>
      <input id="sessCreateCwd" type="text" placeholder="C:\\repo\\my-project"
        style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:.83rem;outline:none;font-family:'Consolas','Courier New',monospace;">
      <span style="font-size:.72rem;color:var(--text-dim);">${_sT('working_dir_hint')}</span>
    </div>
    <div style="margin-bottom:8px;">
      <label style="font-size:.8rem;color:var(--text-mute);display:block;margin-bottom:6px;">${_sT('command_select')}</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;" id="sessPresetBtns">
        <button class="sess-preset-btn active" data-cmd="claude --dangerously-skip-permissions" onclick="selectSessPreset(this)">Claude</button>
        <button class="sess-preset-btn" data-cmd="" onclick="selectSessPreset(this)">${_sT('manual_btn')}</button>
      </div>
    </div>
    <div style="margin-bottom:22px;">
      <label style="font-size:.8rem;color:var(--text-mute);display:block;margin-bottom:4px;">${_sT('command')}</label>
      <input id="sessCreateCmd" type="text" value="claude --dangerously-skip-permissions"
        style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:.85rem;outline:none;font-family:'Consolas','Courier New',monospace;"
        onkeydown="if(event.key==='Enter')submitSessCreate()">
      <span style="font-size:.72rem;color:var(--text-dim);">${_sT('command_hint')}</span>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button class="btn-outline" style="padding:9px 18px;border-radius:10px;" onclick="closeSessCreateModal()">${_sT('cancel')}</button>
      <button class="btn-accent" style="padding:9px 20px;border-radius:10px;" onclick="submitSessCreate()">${_sT('start_session')}</button>
    </div>
  </div>
</div>`;

const SESS_CSS = `
  .sess-split { display:flex; gap:12px; flex:1; min-height:0; overflow:hidden; }
  .sess-left-panel { width:220px; flex-shrink:0; display:flex; flex-direction:column; gap:8px; min-height:0; }
  .sess-list-panel { flex:1; display:flex; flex-direction:column; gap:8px; overflow-y:auto; min-height:0; }
  .sess-new-btn { flex-shrink:0; padding:9px 12px; border-radius:8px; font-size:.82rem; cursor:pointer; background:var(--accent); color:#fff; border:none; width:100%; text-align:center; transition:opacity .15s; }
  .sess-new-btn:hover { opacity:.85; }
  .sess-item { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:10px 12px; cursor:pointer; display:flex; flex-direction:column; gap:4px; transition:border-color .15s; }
  .sess-item:hover { border-color:var(--accent); }
  .sess-item.active { border-color:var(--accent); background:var(--grad-soft); }
  .sess-item.dead { opacity:.55; }
  .sess-item.dead .sess-name { text-decoration:line-through; }
  .sess-item.dead:hover { opacity:.75; border-color:var(--border); }
  .sess-last-out { font-size:.7rem; color:var(--text-dim); font-family:'Consolas','Courier New',monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
  .sess-item-head { display:flex; align-items:center; gap:6px; }
  .sess-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .sess-subtab-bar { display:flex; gap:4px; flex-shrink:0; border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:4px; }
  .sess-subtab { background:none; border:1px solid var(--border); border-radius:8px; padding:5px 14px; font-size:.82rem; color:var(--text-mute); cursor:pointer; transition:all .15s; }
  .sess-subtab:hover { color:var(--text); border-color:var(--accent); }
  .sess-subtab.active { background:var(--accent); color:#fff; border-color:var(--accent); font-weight:600; }
  .claude-sess-detail { flex:1; padding:18px; overflow-y:auto; font-size:.85rem; color:var(--text); }
  .claude-sess-field { display:flex; flex-direction:column; gap:3px; margin-bottom:14px; }
  .claude-sess-label { font-size:.72rem; color:var(--text-mute); font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
  .claude-sess-value { font-size:.85rem; color:var(--text); word-break:break-word; }
  .claude-sess-stat { background:var(--bg-soft); border:1px solid var(--border); border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:3px; }
  .claude-msg { border:1px solid var(--border); border-radius:9px; padding:9px 12px; margin-bottom:8px; background:var(--card); }
  .claude-msg.user { border-left:3px solid var(--accent2, #38bdf8); }
  .claude-msg.assistant { border-left:3px solid var(--accent); }
  .claude-msg-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:5px; }
  .claude-msg-role { font-size:.74rem; font-weight:700; color:var(--text-mute); }
  .claude-msg-ts { font-size:.7rem; color:var(--text-dim); }
  .claude-msg-body { font-size:.8rem; line-height:1.6; color:var(--text); white-space:pre-wrap; word-break:break-word; font-family:'Consolas','Courier New',monospace; max-height:280px; overflow-y:auto; }
  .sess-dot.running { background:var(--green); }
  .sess-dot.dead    { background:var(--text-dim); }
  .sess-name { font-size:.83rem; font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sess-meta { font-size:.7rem; color:var(--text-dim); }
  .sess-kill-btn { margin-top:4px; padding:3px 8px; border-radius:6px; font-size:.72rem; background:transparent; border:1px solid var(--border); color:var(--text-mute); cursor:pointer; align-self:flex-start; }
  .sess-kill-btn:hover { border-color:var(--red); color:var(--red); }
  .sess-term-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; min-height:0; }
  .sess-term-header { padding:8px 12px; font-size:.82rem; font-weight:600; color:var(--text-mute); border-bottom:1px solid var(--border); flex-shrink:0; display:flex; align-items:center; gap:8px; }
  .sess-term-output { flex:1; min-height:0; overflow-y:auto; background:var(--code-bg); border-radius:8px; padding:12px 14px; font-family:'Consolas','Courier New',monospace; font-size:.78rem; line-height:1.6; }
  .sess-line { white-space:pre-wrap; word-break:break-all; }
  .sess-line.stdin { color:var(--accent); }
  .sess-line.stdin::before { content:'> '; font-weight:700; }
  .sess-line.stderr { color:var(--text-dim); }
  .sess-hdr-btn { padding:3px 8px; border-radius:6px; font-size:.8rem; cursor:pointer; border:1px solid var(--border); background:transparent; color:var(--text-mute); transition:background .15s, border-color .15s; }
  .sess-hdr-btn:hover { background:var(--bg); border-color:var(--accent); }
  .sess-input-toggle { margin-left:auto; padding:3px 10px; border-radius:20px; font-size:.72rem; cursor:pointer; border:1px solid var(--border); background:transparent; color:var(--text-mute); transition:background .15s, color .15s, border-color .15s; }
  .sess-input-toggle.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .sess-input-row { display:flex; gap:8px; flex:1; flex-shrink:0; }
  .sess-autoscroll-label { display:flex; align-items:center; gap:4px; font-size:.75rem; color:var(--text-mute); flex-shrink:0; cursor:pointer; white-space:nowrap; }
  .sess-autoscroll-label input[type=checkbox] { cursor:pointer; }
  .sess-input-row input { flex:1; background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:8px 12px; color:var(--text); font-size:.85rem; outline:none; font-family:'Consolas','Courier New',monospace; }
  .sess-input-row input:focus { border-color:var(--accent); }
  .sess-preset-btn { padding:6px 14px; border-radius:20px; font-size:.8rem; cursor:pointer; background:var(--bg); border:1px solid var(--border); color:var(--text-mute); transition:all .15s; }
  .sess-preset-btn:hover { border-color:var(--accent); color:var(--text); }
  .sess-preset-btn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  #sessCreateCwd[readonly] { opacity:.6; cursor:default; }
  .sess-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-dim); gap:10px; font-size:.85rem; }`;

// ── 서브탭 ─────────────────────────────────────────────────
function showSessSubtab(name) {
  document.querySelectorAll('.sess-subtab').forEach(b => b.classList.remove('active'));
  const tabEl = document.getElementById('subtab-' + name);
  if (tabEl) tabEl.classList.add('active');
  const cmdPanel = document.getElementById('sess-panel-cmd');
  const claudePanel = document.getElementById('sess-panel-claude');
  const agPanel = document.getElementById('sess-panel-antigravity');
  if (cmdPanel) cmdPanel.style.display = name === 'cmd' ? 'flex' : 'none';
  if (claudePanel) claudePanel.style.display = name === 'claude' ? 'flex' : 'none';
  if (agPanel) agPanel.style.display = name === 'antigravity' ? 'flex' : 'none';
  if (name === 'claude') fetchClaudeSessions();
  if (name === 'antigravity') fetchAntigravitySessions();
}

// ── Claude 세션 ────────────────────────────────────────────
async function fetchClaudeSessions() {
  const pid = App().currentProjectId;
  if (!pid) return;
  try {
    const r = await fetch(`/api/projects/${pid}/claude-sessions`);
    _claudeSessions = await r.json();
    _renderClaudeSessions(_claudeSessions);
  } catch (e) { /* 서버 없음 */ }
}

function _fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function _fmtDuration(firstTs, lastTs) {
  if (!firstTs || !lastTs) return '';
  const a = new Date(firstTs).getTime();
  const b = new Date(lastTs).getTime();
  if (!a || !b || b < a) return '';
  const sec = Math.round((b - a) / 1000);
  if (sec < 60) return _sT('dur_sec', sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return _sT('dur_min', min);
  const h = Math.floor(min / 60);
  return _sT('dur_h', h, min % 60);
}

function _modelShort(m) {
  return (m || '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

function _renderClaudeSessions(sessions) {
  const list = document.getElementById('claude-sess-list');
  if (!list) return;
  if (!sessions.length) {
    list.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:20px 0;">${_sT('no_session')}</div>`;
    return;
  }
  list.innerHTML = sessions.map((s, i) => {
    const short = esc((s.session_id || '').slice(0, 8));
    const label = s.title ? esc(s.title) : short + '…';
    const model = esc(_modelShort(s.model));
    const fp = esc((s.first_prompt || '').slice(0, 50));
    const ago = s.last_ts ? _timeAgo(s.last_ts) : '';
    const active = _currentClaudeSessId === s.session_id ? ' active' : '';
    const metaBits = [];
    if (s.msg_count) metaBits.push(`💬 ${s.msg_count}`);
    if (s.tool_count) metaBits.push(`🔧 ${s.tool_count}`);
    if (s.total_tokens) metaBits.push(`🪙 ${_fmtTokens(s.total_tokens)}`);
    if (s.error_count) metaBits.push(`<span style="color:var(--red);">⚠ ${s.error_count}</span>`);
    return `<div class="sess-item${active}" onclick="_openClaudeSession(${i})">
      <div class="sess-item-head">
        <span class="sess-dot running"></span>
        <span class="sess-name" title="${esc(s.session_id || '')}">${label}</span>
        ${s.title ? `<span class="sess-meta">${short}…</span>` : ''}
        ${model ? `<span class="sess-meta">${model}</span>` : ''}
      </div>
      ${fp ? `<div class="sess-last-out">${fp}</div>` : ''}
      <div class="sess-meta" style="margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;">
        ${metaBits.join('')}
      </div>
      ${ago ? `<div class="sess-meta" style="margin-top:2px;">${ago}</div>` : ''}
    </div>`;
  }).join('');
}

async function _openClaudeSession(i) {
  const s = _claudeSessions[i];
  if (!s) return;
  _currentClaudeSessId = s.session_id;
  document.querySelectorAll('#claude-sess-list .sess-item').forEach((el, idx) => el.classList.toggle('active', idx === i));
  const empty = document.getElementById('claude-sess-empty');
  const wrap = document.getElementById('claude-sess-detail-wrap');
  const title = document.getElementById('claude-sess-title');
  const detail = document.getElementById('claude-sess-detail');
  if (empty) empty.style.display = 'none';
  if (wrap) { wrap.style.display = 'flex'; }
  if (title) title.textContent = s.title || ((s.session_id || '').slice(0, 8) + '…');
  if (!detail) return;

  detail.innerHTML = _renderClaudeSessSummary(s) +
    `<div id="claude-sess-messages" style="margin-top:6px;color:var(--text-dim);font-size:.8rem;">${_sT('loading')}</div>`;

  const pid = App().currentProjectId;
  if (!pid || !s.file) return;
  try {
    const r = await fetch(`/api/projects/${pid}/claude-session-detail?file=${encodeURIComponent(s.file)}`);
    const d = await r.json();
    const box = document.getElementById('claude-sess-messages');
    if (!box) return;
    if (!d.ok) { box.innerHTML = `<div style="color:var(--red);">⚠ ${esc(d.error || _sT('load_failed'))}</div>`; return; }
    box.innerHTML = _renderClaudeSessMessages(d);
  } catch (e) {
    const box = document.getElementById('claude-sess-messages');
    if (box) box.innerHTML = `<div style="color:var(--red);">⚠ ${_sT('server_error')}</div>`;
  }
}

function _renderClaudeSessSummary(s) {
  const model = esc(_modelShort(s.model)) || '-';
  const ago = s.last_ts ? _timeAgo(s.last_ts) : '-';
  const dur = _fmtDuration(s.first_ts, s.last_ts);
  const stats = [
    { label: _sT('messages'), val: _sT('turns_fmt', s.msg_count || 0, s.user_count || 0, s.assistant_count || 0) },
    { label: _sT('tool_calls'), val: String(s.tool_count || 0) },
    { label: _sT('tokens'), val: `${_fmtTokens(s.total_tokens)} (↓ ${_fmtTokens(s.input_tokens)} / ↑ ${_fmtTokens(s.output_tokens)} / ⚡ ${_fmtTokens(s.cache_tokens)})` },
    { label: _sT('errors'), val: String(s.error_count || 0) },
  ];
  return `
    <div class="claude-sess-field"><div class="claude-sess-label">${_sT('session_id')}</div><div class="claude-sess-value" style="font-family:'Consolas',monospace;display:flex;align-items:center;gap:8px;">
      <span>${esc(s.session_id || '')}</span>
      <button class="sess-hdr-btn" style="padding:1px 8px;" onclick="_copyClaudeSessId('${esc(s.session_id || '')}')" title="${_sT('copy')}">${_sT('copy')}</button>
    </div></div>
    <div class="claude-sess-field"><div class="claude-sess-label">${_sT('model')}</div><div class="claude-sess-value">${model}</div></div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;">
      ${stats.map(st => `<div class="claude-sess-stat"><div class="claude-sess-label">${st.label}</div><div class="claude-sess-value">${st.val}</div></div>`).join('')}
    </div>
    <div class="claude-sess-field"><div class="claude-sess-label">${_sT('last_active')}</div><div class="claude-sess-value">${ago}${dur ? ` · ${_sT('duration_suffix', dur)}` : ''}</div></div>
    ${s.first_prompt ? `<div class="claude-sess-field"><div class="claude-sess-label">${_sT('first_message')}</div><div class="claude-sess-value">${esc(s.first_prompt)}</div></div>` : ''}
  `;
}

function _renderClaudeSessMessages(d) {
  const msgs = d.messages || [];
  if (!msgs.length) return `<div style="color:var(--text-dim);font-size:.8rem;">${_sT('no_messages')}</div>`;
  const cwdLine = d.cwd ? `<div class="claude-sess-label" style="margin-bottom:8px;">${_sT('working_path')}<span style="font-family:'Consolas',monospace;color:var(--text-mute);">${esc(d.cwd)}</span></div>` : '';
  const trunc = d.truncated ? `<div style="color:var(--text-dim);font-size:.75rem;margin-bottom:8px;">${_sT('truncated_notice', msgs.length)}</div>` : '';
  const head = `<div class="claude-sess-label" style="margin-bottom:8px;border-top:1px solid var(--border);padding-top:14px;">${_sT('conversation_count', msgs.length)}</div>`;
  const body = msgs.map(m => {
    const isUser = m.role === 'user';
    const ts = m.ts ? _timeAgo(m.ts) : '';
    return `<div class="claude-msg ${isUser ? 'user' : 'assistant'}">
      <div class="claude-msg-head">
        <span class="claude-msg-role">${isUser ? _sT('user_label') : '🤖 Claude'}</span>
        ${ts ? `<span class="claude-msg-ts">${ts}</span>` : ''}
      </div>
      <div class="claude-msg-body">${esc(m.text)}</div>
    </div>`;
  }).join('');
  return cwdLine + trunc + head + body;
}

function _copyClaudeSessId(id) {
  if (!id) return;
  navigator.clipboard.writeText(id).then(() => {
    showAlert(_sT('copied_session_id'), { type: 'info' });
  }).catch(() => showAlert(_sT('copy_failed') + '\n' + id, { type: 'error' }));
}

// ── Antigravity 세션 ───────────────────────────────────────
async function fetchAntigravitySessions() {
  const pid = App().currentProjectId;
  if (!pid) return;
  try {
    const r = await fetch(`/api/projects/${pid}/antigravity-sessions`);
    _agSessions = await r.json();
    _renderAntigravitySessions(_agSessions);
  } catch (e) { /* 서버 없음 */ }
}

function _renderAntigravitySessions(sessions) {
  const list = document.getElementById('ag-sess-list');
  if (!list) return;
  if (!sessions || !sessions.length) {
    list.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:20px 0;">${_sT('no_session')}</div>`;
    return;
  }
  list.innerHTML = sessions.map((s, i) => {
    const short = esc((s.session_id || '').slice(0, 12));
    const fp = esc((s.first_prompt || '').slice(0, 50));
    const ago = s.last_ts ? _timeAgo(s.last_ts) : '';
    const active = _currentAgSessId === s.session_id ? ' active' : '';
    const metaBits = [];
    if (s.msg_count) metaBits.push(`💬 ${s.msg_count}`);
    if (s.tool_count) metaBits.push(`🔧 ${s.tool_count}`);
    return `<div class="sess-item${active}" onclick="_openAntigravitySession(${i})">
      <div class="sess-item-head">
        <span class="sess-dot running"></span>
        <span class="sess-name">🪐 ${short}…</span>
      </div>
      ${fp ? `<div class="sess-last-out">${fp}</div>` : ''}
      <div class="sess-meta" style="margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;">${metaBits.join('')}</div>
      ${ago ? `<div class="sess-meta" style="margin-top:2px;">${ago}</div>` : ''}
    </div>`;
  }).join('');
}

async function _openAntigravitySession(i) {
  const s = _agSessions[i];
  if (!s) return;
  _currentAgSessId = s.session_id;
  document.querySelectorAll('#ag-sess-list .sess-item').forEach((el, idx) => el.classList.toggle('active', idx === i));
  const empty = document.getElementById('ag-sess-empty');
  const wrap = document.getElementById('ag-sess-detail-wrap');
  const title = document.getElementById('ag-sess-title');
  const detail = document.getElementById('ag-sess-detail');
  if (empty) empty.style.display = 'none';
  if (wrap) wrap.style.display = 'flex';
  if (title) title.textContent = '🪐 ' + (s.session_id || '').slice(0, 12) + '…';
  if (!detail) return;
  detail.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;">${_sT('loading')}</div>`;
  const pid = App().currentProjectId;
  if (!pid) return;
  try {
    const r = await fetch(`/api/projects/${pid}/antigravity-session-detail?conv=${encodeURIComponent(s.session_id)}`);
    const d = await r.json();
    if (!d.ok) { detail.innerHTML = `<div style="color:var(--red);">⚠ ${esc(d.error || _sT('load_failed'))}</div>`; return; }
    let html = '';
    if (d.inputs && d.inputs.length) {
      html += `<div style="font-weight:700;font-size:.82rem;margin:4px 0 6px;">${_sT('ag_inputs')}</div>`;
      html += d.inputs.map(t => `<div class="sess-last-out" style="margin-bottom:4px;white-space:pre-wrap;">${esc(t)}</div>`).join('');
    }
    if (d.steps && d.steps.length) {
      html += `<div style="font-weight:700;font-size:.82rem;margin:12px 0 6px;">${_sT('ag_steps')}</div>`;
      html += '<ol style="margin:0;padding-left:20px;font-size:.82rem;color:var(--text);line-height:1.6;">'
            + d.steps.map(t => `<li>${esc(t)}</li>`).join('') + '</ol>';
    }
    if (!html) html = `<div style="color:var(--text-dim);">${_sT('no_session')}</div>`;
    detail.innerHTML = html;
  } catch (e) {
    detail.innerHTML = `<div style="color:var(--red);">⚠ ${_sT('server_error')}</div>`;
  }
}

// ── PTY 세션 목록 ──────────────────────────────────────────
async function fetchSessions() {
  try {
    const r = await fetch('/api/sessions');
    _sessions = await r.json();
  } catch (e) { _sessions = []; }
  renderSessionList();
  _updateSessionBadge();
}

function renderSessionList() {
  const list = document.getElementById('sess-list');
  if (!list) return;
  if (!_sessions.length) {
    list.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:20px 0;">${_sT('no_session')}</div>`;
    return;
  }
  const lang = window._EP4_LANG || 'ko';
  const locale = lang === 'ko' ? 'ko-KR' : lang === 'zh' ? 'zh-CN' : 'en-US';
  list.innerHTML = _sessions.map(s => {
    const ts = s.created_at ? new Date(s.created_at).toLocaleTimeString(locale, {hour:'2-digit',minute:'2-digit'}) : '';
    const isActive = s.id === _currentSessionId;
    const isDead   = s.status !== 'running';
    return `<div class="sess-item${isActive?' active':''}${isDead?' dead':''}" onclick="openSession('${s.id}')">
      <div class="sess-item-head">
        <span class="sess-dot ${s.status}"></span>
        <span class="sess-name" title="${esc(s.name)}">${esc(s.name)}</span>
      </div>
      <div class="sess-meta">${s.status === 'running' ? _sT('status_running') : _sT('status_dead')} · ${ts}${s.pid?' · PID '+s.pid:''}</div>
      ${s.last_output ? `<div class="sess-last-out">${esc(s.last_output.slice(0,60))}</div>` : ''}
      ${s.status === 'running'
        ? `<button class="sess-kill-btn" onclick="event.stopPropagation();killSession('${s.id}')">${_sT('kill')}</button>`
        : `<button class="sess-kill-btn" onclick="event.stopPropagation();removeSession('${s.id}')" style="border-color:var(--border)">${_sT('remove')}</button>`}
    </div>`;
  }).join('');
}

function _updateSessionBadge() {
  const badge = document.getElementById('sb-badge-sessions');
  if (!badge) return;
  const running = _sessions.filter(s => s.status === 'running').length;
  if (running > 0) { badge.textContent = running; badge.style.display = ''; }
  else badge.style.display = 'none';
}

async function openSession(id) {
  _currentSessionId = id;
  const sess = _sessions.find(s => s.id === id);
  renderSessionList();
  const emptyEl = document.getElementById('sess-empty');
  const termPanel = document.getElementById('sess-term-panel');
  if (emptyEl) emptyEl.style.display = 'none';
  if (termPanel) termPanel.style.display = 'flex';
  _sessAutoScroll = true;
  _syncAutoScrollCheckbox();
  const inputRow    = document.getElementById('sessInputRow');
  const inputToggle = document.getElementById('sessInputToggle');
  if (inputRow)    { inputRow.style.display = 'none'; }
  if (inputToggle) {
    inputToggle.classList.remove('on');
    inputToggle.textContent = _sT('input_toggle');
    const isDead = sess && sess.status !== 'running';
    inputToggle.style.opacity = isDead ? '0.4' : '';
    inputToggle.title = isDead ? _sT('dead_tooltip') : _sT('input_toggle_title');
  }
  const settingsPanel = document.getElementById('sessSettingsPanel');
  if (settingsPanel) settingsPanel.style.display = 'none';
  if (sess) {
    const mbEl = document.getElementById('sessMaxBuffer');
    const lfEl = document.getElementById('sessLogFile');
    if (mbEl) mbEl.value = sess.max_buffer ?? 2000;
    if (lfEl) lfEl.value = sess.log_file ?? '';
  }
  _updateSessLogBar(sess);
  if (sess) {
    const nameEl = document.getElementById('sess-term-name');
    const dotEl  = document.getElementById('sess-term-dot');
    const pidEl  = document.getElementById('sess-term-pid');
    if (nameEl) nameEl.textContent = sess.name;
    if (dotEl)  dotEl.className = `sess-dot ${sess.status}`;
    if (pidEl)  pidEl.textContent = sess.pid ? `PID ${sess.pid}` : '';
    const inputEl = document.getElementById('sess-input');
    if (inputEl) inputEl.disabled = sess.status !== 'running';
  }
  try {
    const r = await fetch(`/api/sessions/${id}/output`);
    const data = await r.json();
    const box = document.getElementById('sess-term-output');
    if (box) {
      _sessScreenEl = null;
      box.innerHTML = (data.entries || []).map(_sessRenderEntry).join('');
      _sessSetScreen(box, data.screen_html || '');
      box.scrollTop = box.scrollHeight;
    }
  } catch(e) {}
}

function _sessRenderEntry(e) {
  const cls = e.type === 'stdin' ? 'stdin' : e.type === 'stderr' ? 'stderr' : '';
  const content = (e.html != null) ? e.html : esc(e.text || '');
  return `<div class="sess-line ${cls}">${content}</div>`;
}

// ── 세션 생성 모달 ─────────────────────────────────────────
function openSessCreateModal(defaultName) {
  const modal = document.getElementById('sessCreateModal');
  if (!modal) return;
  const nameInput = document.getElementById('sessCreateName');
  const cmdInput  = document.getElementById('sessCreateCmd');
  nameInput.value = defaultName || (App().currentProjectName || '');
  cmdInput.value = SESS_PRESETS['Claude'];
  cmdInput.readOnly = true;
  document.querySelectorAll('.sess-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.trim() === 'Claude');
  });
  const projSel = document.getElementById('sessCwdProject');
  const cwdInput = document.getElementById('sessCreateCwd');
  const projects = App().projects || [];
  if (projSel) {
    projSel.innerHTML = `<option value="">${_sT('manual_input')}</option>`;
    projects.forEach(pj => {
      const opt = document.createElement('option');
      opt.value = pj.project_root || '';
      opt.textContent = pj.name + (pj.project_root ? '  (' + pj.project_root + ')' : '');
      opt.dataset.id = pj.id;
      projSel.appendChild(opt);
    });
    const curId = App().currentProjectId;
    const curPj = curId ? projects.find(p => p.id === curId) : null;
    if (curPj && curPj.project_root) {
      projSel.value = curPj.project_root;
      cwdInput.value = curPj.project_root;
      cwdInput.readOnly = true;
    } else {
      projSel.value = '';
      cwdInput.value = '';
      cwdInput.readOnly = false;
    }
  }
  modal.style.display = 'flex';
  setTimeout(() => nameInput.focus(), 50);
}

function onSessCwdProjectChange() {
  const projSel  = document.getElementById('sessCwdProject');
  const cwdInput = document.getElementById('sessCreateCwd');
  const nameInput = document.getElementById('sessCreateName');
  if (!projSel || !cwdInput) return;
  if (projSel.value) {
    cwdInput.value = projSel.value;
    cwdInput.readOnly = true;
    if (nameInput && !nameInput.value.trim()) {
      const parts = projSel.value.replace(/[/\\]+$/, '').split(/[/\\]/);
      nameInput.value = parts[parts.length - 1] || '';
    }
  } else {
    cwdInput.value = '';
    cwdInput.readOnly = false;
    setTimeout(() => cwdInput.focus(), 50);
  }
}

function closeSessCreateModal() {
  const modal = document.getElementById('sessCreateModal');
  if (modal) modal.style.display = 'none';
}

function selectSessPreset(btn) {
  document.querySelectorAll('.sess-preset-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const cmd = btn.dataset.cmd;
  const cmdInput = document.getElementById('sessCreateCmd');
  if (cmd) {
    cmdInput.value = cmd;
    cmdInput.readOnly = true;
  } else {
    cmdInput.value = '';
    cmdInput.readOnly = false;
    setTimeout(() => cmdInput.focus(), 50);
  }
}

async function submitSessCreate() {
  const name = (document.getElementById('sessCreateName').value || '').trim();
  const cmd  = (document.getElementById('sessCreateCmd').value  || '').trim();
  const cwd  = (document.getElementById('sessCreateCwd').value  || '').trim();
  if (!name) { document.getElementById('sessCreateName').focus(); return; }
  if (!cmd)  { document.getElementById('sessCreateCmd').focus();  return; }
  closeSessCreateModal();
  const sess = await createSession(name, cwd, cmd);
  if (sess && sess.id) openSession(sess.id);
}

async function createSession(name, cwd, command) {
  try {
    const r = await fetch('/api/sessions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, cwd: cwd || '', command: command || ''})
    });
    const d = await r.json();
    if (d.error) { await showAlert(d.error, {type:'error'}); return null; }
    await fetchSessions();
    return d;
  } catch(e) { await showAlert(_sT('create_failed', e.message), {type:'error'}); return null; }
}

async function killSession(id) {
  const ok = await showConfirm(_sT('kill_confirm'), {type:'warning', ok: _sT('kill')});
  if (!ok) return;
  await fetch(`/api/sessions/${id}`, {method:'DELETE'});
  if (_currentSessionId === id) {
    _currentSessionId = null;
    const termPanel = document.getElementById('sess-term-panel');
    const emptyEl   = document.getElementById('sess-empty');
    if (termPanel) termPanel.style.display = 'none';
    if (emptyEl)   emptyEl.style.display = '';
  }
  await fetchSessions();
}

async function removeSession(id) {
  _sessions = _sessions.filter(s => s.id !== id);
  if (_currentSessionId === id) {
    _currentSessionId = null;
    const termPanel = document.getElementById('sess-term-panel');
    const emptyEl   = document.getElementById('sess-empty');
    if (termPanel) termPanel.style.display = 'none';
    if (emptyEl)   emptyEl.style.display = '';
  }
  renderSessionList();
  _updateSessionBadge();
}

async function _reloadCurrentSessionOutput() {
  if (!_currentSessionId) return;
  try {
    const r = await fetch(`/api/sessions/${_currentSessionId}/output`);
    const data = await r.json();
    const box = document.getElementById('sess-term-output');
    if (!box) return;
    _sessScreenEl = null;
    box.innerHTML = (data.entries || []).map(_sessRenderEntry).join('');
    _sessSetScreen(box, data.screen_html || '');
    if (_sessAutoScroll) box.scrollTop = box.scrollHeight;
  } catch(e) {}
}

function toggleSessSettings() {
  const panel = document.getElementById('sessSettingsPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function saveSessSettings() {
  if (!_currentSessionId) return;
  const maxBuf  = parseInt(document.getElementById('sessMaxBuffer')?.value || '2000');
  const logFile = (document.getElementById('sessLogFile')?.value || '').trim();
  const r = await fetch(`/api/sessions/${_currentSessionId}/settings`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({max_buffer: maxBuf, log_file: logFile})
  });
  const d = await r.json();
  if (d.ok) {
    const idx = _sessions.findIndex(s => s.id === _currentSessionId);
    if (idx >= 0) Object.assign(_sessions[idx], {max_buffer: d.max_buffer, log_file: d.log_file});
    document.getElementById('sessSettingsPanel').style.display = 'none';
    _updateSessLogBar(idx >= 0 ? _sessions[idx] : null);
  }
}

function _updateSessLogBar(sess) {
  const bar  = document.getElementById('sessLogBar');
  const path = document.getElementById('sessLogPath');
  if (!bar || !path) return;
  const lf = sess && sess.log_file ? sess.log_file : '';
  if (lf) {
    path.textContent = lf;
    path.title = lf;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

async function copySessLogPath() {
  const path = document.getElementById('sessLogPath');
  if (!path || !path.textContent) return;
  const btn = document.querySelector('#sessLogBar button');
  try {
    await navigator.clipboard.writeText(path.textContent);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = _sT('copied');
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  } catch {
    showAlert(_sT('copy_failed') + '\n' + path.textContent, {type: 'error'});
  }
}

async function clearSessOutput() {
  if (!_currentSessionId) return;
  await fetch(`/api/sessions/${_currentSessionId}/output`, {method: 'DELETE'});
  const box = document.getElementById('sess-term-output');
  _sessScreenEl = null;
  if (box) box.innerHTML = '';
  const idx = _sessions.findIndex(s => s.id === _currentSessionId);
  if (idx >= 0) { _sessions[idx].last_output = ''; renderSessionList(); }
}

function _syncAutoScrollCheckbox() {
  const cb = document.getElementById('sessAutoScrollChk');
  if (cb) cb.checked = _sessAutoScroll;
}

function setSessAutoScroll(checked) {
  _sessAutoScroll = checked;
  if (checked) {
    const box = document.getElementById('sess-term-output');
    if (box) box.scrollTop = box.scrollHeight;
  }
}

function toggleSessInputMode() {
  if (_currentSessionId) {
    const sess = _sessions.find(s => s.id === _currentSessionId);
    if (sess && sess.status !== 'running') {
      showAlert(_sT('dead_msg'), {type: 'warning'});
      return;
    }
  }
  const row    = document.getElementById('sessInputRow');
  const toggle = document.getElementById('sessInputToggle');
  if (!row || !toggle) return;
  const on = row.style.display === 'none';
  row.style.display = on ? 'flex' : 'none';
  toggle.classList.toggle('on', on);
  toggle.textContent = on ? _sT('input_on') : _sT('input_toggle');
  if (on) setTimeout(() => document.getElementById('sess-input')?.focus(), 50);
}

async function sendSessionInputFromUI() {
  if (!_currentSessionId) return;
  const input = document.getElementById('sess-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  await fetch(`/api/sessions/${_currentSessionId}/input`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text})
  });
}

// ── SSE 핸들러 ─────────────────────────────────────────────
function _sessOnOutput(d) {
  const sid = d.session_id;
  const kind = d.kind || 'commit';
  const sessIdx = _sessions.findIndex(s => s.id === sid);
  if (sessIdx >= 0) {
    let last = '';
    if (kind === 'screen') {
      const lines = (d.text || '').split('\n').filter(x => x.trim());
      last = lines.length ? lines[lines.length - 1].trim() : '';
    } else if (d.entry && d.entry.type !== 'stdin') {
      last = (d.entry.text || '').trim();
    }
    if (last) { _sessions[sessIdx].last_output = last; renderSessionList(); }
  }
  if (sid !== _currentSessionId) return;
  const box = document.getElementById('sess-term-output');
  if (!box) return;
  if (kind === 'screen') {
    _sessSetScreen(box, d.html || '');
  } else {
    const e = d.entry || {};
    const cls = 'sess-line' + (e.type === 'stdin' ? ' stdin' : e.type === 'stderr' ? ' stderr' : '');
    const div = document.createElement('div');
    div.className = cls;
    div.innerHTML = (e.html != null) ? e.html : esc(e.text || '');
    if (_sessScreenEl && _sessScreenEl.parentNode === box) box.insertBefore(div, _sessScreenEl);
    else box.appendChild(div);
  }
  if (_sessAutoScroll) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function _sessSetScreen(box, html) {
  if (!html) {
    if (_sessScreenEl) { _sessScreenEl.remove(); _sessScreenEl = null; }
    return;
  }
  if (!_sessScreenEl || _sessScreenEl.parentNode !== box) {
    _sessScreenEl = document.createElement('div');
    _sessScreenEl.className = 'sess-screen';
    box.appendChild(_sessScreenEl);
  }
  if (box.lastChild !== _sessScreenEl) box.appendChild(_sessScreenEl);
  _sessScreenEl.innerHTML = html;
}

function _sessOnStatus(d) {
  const idx = _sessions.findIndex(s => s.id === d.session_id);
  if (d.action === 'created') {
    if (idx < 0) {
      _sessions.push({id: d.session_id, name: d.name, status: d.status, pid: d.pid, created_at: d.created_at, cwd: d.cwd || '', last_output: d.last_output || ''});
    } else {
      Object.assign(_sessions[idx], d);
    }
  } else if (idx >= 0) {
    _sessions[idx].status = d.status;
    if (d.last_output) _sessions[idx].last_output = d.last_output;
    if (_currentSessionId === d.session_id) {
      const dotEl = document.getElementById('sess-term-dot');
      const inputEl = document.getElementById('sess-input');
      if (dotEl) dotEl.className = `sess-dot ${d.status}`;
      if (inputEl) inputEl.disabled = d.status !== 'running';
      const toggleEl = document.getElementById('sessInputToggle');
      if (toggleEl) {
        const isDead = d.status !== 'running';
        toggleEl.style.opacity = isDead ? '0.4' : '';
        toggleEl.title = isDead ? _sT('dead_tooltip') : _sT('input_toggle_title');
      }
    }
  }
  renderSessionList();
  _updateSessionBadge();
}

// ── 전역 노출 (HTML onclick 호환) ──────────────────────────
function _exposeGlobals() {
  Object.assign(window, {
    showSessSubtab, fetchClaudeSessions, _openClaudeSession, _copyClaudeSessId,
    fetchAntigravitySessions, _openAntigravitySession,
    openSession, killSession, removeSession,
    openSessCreateModal, onSessCwdProjectChange, closeSessCreateModal,
    selectSessPreset, submitSessCreate,
    toggleSessInputMode, toggleSessSettings, clearSessOutput, copySessLogPath,
    saveSessSettings, setSessAutoScroll, sendSessionInputFromUI,
  });
}

function _injectCss() {
  if (document.getElementById('sess-plugin-css')) return;
  const st = document.createElement('style');
  st.id = 'sess-plugin-css';
  st.textContent = SESS_CSS;
  document.head.appendChild(st);
}

function _ensureModal() {
  if (document.getElementById('sessCreateModal')) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = SESS_MODAL_HTML().trim();
  document.body.appendChild(tmp.firstElementChild);
}

// ── 플러그인 계약 ──────────────────────────────────────────
export default {
  async mount(container, ctx) {
    _ctx = ctx;
    _injectCss();
    _ensureModal();
    _exposeGlobals();
    container.innerHTML = SESS_HTML();
    await fetchSessions();
    showSessSubtab('cmd');
  },

  unmount() {
    const modal = document.getElementById('sessCreateModal');
    if (modal) modal.style.display = 'none';
  },

  onEvent(evt) {
    if (!evt) return;
    const { event, data } = evt;
    if (event === 'session_output') _sessOnOutput(data);
    else if (event === 'session_status') _sessOnStatus(data);
    else if (event === 'task_done' && _currentSessionId) {
      setTimeout(() => _reloadCurrentSessionOutput(), 300);
    }
  },

  describe() {
    return {
      route: 'sessions',
      summary: 'Terminal (PTY) sessions and Claude CLI sessions.',
      actions: [{ id: 'create', label: 'New Session', deeplink: '/#/view/sessions' }],
    };
  },
};
