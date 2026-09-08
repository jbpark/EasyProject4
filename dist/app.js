// ── 인증 게이트: /api/* 가 401 을 반환하면 토큰 로그인 오버레이 표시 ──
// 토큰은 쿠키(ep4_token)로 저장되어 이후 모든 fetch/EventSource 요청에 자동 첨부된다.
(function () {
  // QR/링크의 ?token= 파라미터로 자동 로그인 — 쿠키로 저장 후 주소창에서 제거.
  // (모바일 QR 을 폰 카메라나 EP4 앱 웹뷰로 열었을 때 로그인 화면 없이 바로 접속)
  try {
    const _q = new URLSearchParams(location.search);
    const _t = (_q.get('token') || '').trim();
    if (_t) {
      document.cookie = 'ep4_token=' + encodeURIComponent(_t) + ';path=/;max-age=31536000;samesite=Lax';
      _q.delete('token');
      const _rest = _q.toString();
      history.replaceState(null, '', location.pathname + (_rest ? '?' + _rest : '') + location.hash);
    }
  } catch (e) { /* noop */ }

  const _origFetch = window.fetch.bind(window);
  let _authPrompting = false;

  function _showTokenLogin() {
    if (_authPrompting) return;
    _authPrompting = true;
    const ov = document.createElement('div');
    ov.id = '_ep4_auth_overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(10,14,23,.92);' +
      'display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif';
    ov.innerHTML =
      '<div style="background:#1a2535;border:1px solid #2a3f5a;border-radius:12px;padding:28px 32px;' +
        'width:min(90vw,380px);color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
        '<div style="font-size:18px;font-weight:700;margin-bottom:6px">EasyProject4 로그인</div>' +
        '<div style="font-size:13px;color:#7b92aa;margin-bottom:18px;line-height:1.5">' +
          '서버 콘솔에 표시된 인증 토큰을 입력하세요.</div>' +
        '<input id="_ep4_token_in" type="password" placeholder="인증 토큰" autocomplete="off" ' +
          'style="width:100%;box-sizing:border-box;padding:11px 13px;border-radius:8px;border:1px solid #2a3f5a;' +
          'background:#0a0e17;color:#e2e8f0;font-size:14px;outline:none"/>' +
        '<div id="_ep4_token_err" style="color:#ef4444;font-size:12px;min-height:16px;margin:8px 2px"></div>' +
        '<button id="_ep4_token_btn" style="width:100%;padding:11px;border:none;border-radius:8px;' +
          'background:#10b981;color:#04140d;font-weight:700;font-size:14px;cursor:pointer">접속</button>' +
      '</div>';
    (document.body || document.documentElement).appendChild(ov);
    const inp = ov.querySelector('#_ep4_token_in');
    const btn = ov.querySelector('#_ep4_token_btn');
    const err = ov.querySelector('#_ep4_token_err');
    inp.focus();
    async function submit() {
      const tok = inp.value.trim();
      if (!tok) return;
      btn.disabled = true; err.textContent = '';
      try {
        const r = await _origFetch('/api/ping', { headers: { 'Authorization': 'Bearer ' + tok } });
        if (r.ok) {
          document.cookie = 'ep4_token=' + encodeURIComponent(tok) + ';path=/;max-age=31536000;samesite=Lax';
          location.reload();
          return;
        }
        err.textContent = '토큰이 올바르지 않습니다.';
      } catch (e) {
        err.textContent = '서버 연결 실패: ' + e;
      }
      btn.disabled = false;
    }
    btn.addEventListener('click', submit);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  window.fetch = async function (...args) {
    const resp = await _origFetch(...args);
    try {
      if (resp.status === 401) {
        const u = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || '';
        if (u.indexOf('/api/') !== -1) _showTokenLogin();
      }
    } catch (e) { /* noop */ }
    return resp;
  };
  window._ep4ShowLogin = _showTokenLogin;
})();

let tasks = [];
let es = null;
let logLines = [];
let spFocused = -1;
let projects = [];
let currentProjectId = null;
let currentProjectName = '';
// 다른 EP4(peer) 연동: 원격 프로젝트 열람/실행 시 _peerBase 에 peer URL 설정.
// _peerBase 가 있으면 프로젝트 데이터 호출이 /api/peer-proxy 로 라우팅된다.
let _remoteProjects = [];
let _remotePeerErrors = [];   // peer 조회 실패 사유(인증 실패 등) — 프로젝트 목록에 표시
let _peerBase = null;
function apiUrl(p) {
  return _peerBase
    ? ('/api/peer-proxy?url=' + encodeURIComponent(_peerBase) + '&path=' + encodeURIComponent(p))
    : p;
}
// SSE 이벤트 출처(peer_url: 원격 EP4 릴레이 이벤트)와 현재 보고 있는
// 컨텍스트(_peerBase)가 일치할 때만 태스크/실행 뷰를 상세 갱신한다.
// 로컬-원격 간 project_id/run_id 숫자 충돌 오동작 방지.
function _ssePeerMatch(d) {
  return (d.peer_url || null) === (_peerBase || null);
}
let _taskFilter = 'all';
let _selectedTaskIds = new Set();
let _taskSearch = '';
let _rlSearch = '';
let _projSearch = '';
let _pluginSearch = '';
let _currentView = 'projects';
let _folders = [];
let _collapsedFolders = new Set();
let _folderSeq = 0;   // fetchTasks() 호출 순서 추적 (폴더 낙관적 업데이트 경쟁 방지)
let _folderDone = 0;  // 마지막으로 _folders를 갱신한 seq

function _isPluginViewActive() {
  const h = document.getElementById('plugin-view-host');
  return h && h.style.display !== 'none';
}

// 외부 플러그인(ESM)이 app.js의 let 전역 상태를 읽기 위한 노출 게이트웨이
window.EP4App = {
  get currentProjectId() { return currentProjectId; },
  get currentProjectName() { return currentProjectName; },
  get projects() { return projects; },
};

// ── 커스텀 알림/확인 모달 ──────────────────────────────────
function _showCustomModal(msg, {title='', type='info', buttons, inputDefault, inputPlaceholder} = {}) {
  if (!buttons) buttons = [{label:'확인', value:true, primary:true}];
  const cfg = {
    success: {icon:'✓', bg:'#4ade8022', color:'#4ade80', border:'#4ade8055'},
    error:   {icon:'✕', bg:'#f8717122', color:'#f87171', border:'#f8717155'},
    warning: {icon:'!', bg:'#f59e0b22', color:'#f59e0b', border:'#f59e0b55'},
    info:    {icon:'i', bg:'#38bdf822', color:'#38bdf8', border:'#38bdf855'},
    confirm: {icon:'?', bg:'#6b8aff22', color:'#6b8aff', border:'#6b8aff55'},
    delete:  {icon:'🗑', bg:'#f8717122', color:'#f87171', border:'#f8717155'},
    input:   {icon:'✏', bg:'#6b8aff22', color:'#6b8aff', border:'#6b8aff55'},
  };
  const c = cfg[type] || cfg.info;
  const wrap = document.getElementById('caIconWrap');
  wrap.style.cssText = `width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${type==='delete'?'1.3':'1.6'}rem;font-weight:700;margin:0 auto 16px;background:${c.bg};color:${c.color};border:1px solid ${c.border};`;
  wrap.textContent = c.icon;
  const titleEl = document.getElementById('caTitle');
  titleEl.textContent = title;
  titleEl.style.display = title ? '' : 'none';
  const msgEl = document.getElementById('caMsg');
  msgEl.textContent = msg;
  msgEl.style.marginBottom = inputDefault !== undefined ? '16px' : '24px';
  const inputEl = document.getElementById('caInput');
  const hasInput = inputDefault !== undefined;
  if (hasInput) {
    inputEl.value = inputDefault || '';
    inputEl.placeholder = inputPlaceholder || '';
    inputEl.style.display = 'block';
  } else {
    inputEl.style.display = 'none';
  }
  return new Promise(resolve => {
    const el = document.getElementById('customAlertModal');
    const btnsEl = document.getElementById('caBtns');
    btnsEl.innerHTML = '';
    const close = (val) => {
      el.classList.add('closing');
      setTimeout(() => { el.style.display = 'none'; el.classList.remove('closing'); resolve(val); }, 140);
    };
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = b.primary ? 'btn-accent' : 'btn-outline';
      btn.style.cssText = 'flex:1;max-width:140px;padding:10px 20px;font-size:0.9rem;';
      btn.textContent = b.label;
      btn.onclick = () => {
        if (b.value && hasInput) close(inputEl.value);
        else if (hasInput) close(null);
        else close(b.value);
      };
      btnsEl.appendChild(btn);
    });
    if (hasInput) {
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') { close(inputEl.value); }
        if (e.key === 'Escape') { close(null); }
      };
      setTimeout(() => inputEl.focus(), 80);
    } else {
      inputEl.onkeydown = null;
    }
    el.classList.remove('closing');
    el.style.display = 'flex';
  });
}

function showAlert(msg, {title='', type='info'} = {}) {
  return _showCustomModal(msg, {title, type, buttons:[{label:'확인', value:true, primary:true}]});
}

function showConfirm(msg, {title='', type='confirm', ok='확인', cancel='취소'} = {}) {
  return _showCustomModal(msg, {title, type, buttons:[
    {label:cancel, value:false, primary:false},
    {label:ok, value:true, primary:true},
  ]});
}

function showInput(msg, {title='', type='input', ok='확인', cancel='취소', defaultValue='', placeholder=''} = {}) {
  return _showCustomModal(msg, {
    title, type,
    inputDefault: defaultValue,
    inputPlaceholder: placeholder,
    buttons:[
      {label:cancel, value:false, primary:false},
      {label:ok, value:true, primary:true},
    ],
  });
}

// ── 모바일 QR 연결 ──────────────────────────────────────
async function showQrConnect() {
  let info = {};
  try { info = await (await fetch('/api/connect-info')).json(); } catch (_) {}
  let apk = {};
  try { apk = await (await fetch('/api/apk-info')).json(); } catch (_) {}
  const hasConn = !!(info && (info.url || info.id));
  const mode = info.mode === 'direct' ? 'direct' : 'tunnel';
  const old = document.getElementById('qrConnectModal');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'qrConnectModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:120;';
  const qrSrc = '/api/qr?ts=' + Date.now();
  const safeUrl = (info.url || '').replace(/[<>"']/g, '');
  const noConnMsg = mode === 'direct'
    ? '직접 접속 URL이 설정되지 않았습니다.<br>아래 <b>접속 설정</b>에서 외부 접속 URL을 입력하세요.'
    : '터널이 실행 중이 아닙니다.<br><b>tunnel.bat</b>을 먼저 실행한 뒤 다시 열어주세요.<br>공유기 포트포워딩(NAT)을 쓰면 아래에서 <b>직접 URL</b>로 설정할 수 있습니다.';
  ov.innerHTML = `
    <div style="background:var(--bg-soft);border:1px solid var(--border-hi);border-radius:16px;padding:24px;width:360px;max-width:90vw;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);">
      <div style="font-size:1.05rem;font-weight:700;margin-bottom:4px;">📱 모바일 QR 연결</div>
      <div style="font-size:.8rem;color:var(--text-mute);margin-bottom:16px;">EP4 모바일 앱의 <b>QR 스캔</b>으로 이 코드를 찍으면 연결됩니다.</div>
      ${hasConn ? `
        <div style="background:#fff;border-radius:12px;padding:12px;display:inline-block;">
          <img src="${qrSrc}" alt="QR" width="220" height="220" style="display:block;"
               onerror="this.style.display='none';this.nextElementSibling.style.display='block';"/>
          <div style="display:none;color:#b91c1c;font-size:.8rem;padding:20px;line-height:1.5;">QR 생성 실패<br>서버에 qrcode 설치 필요:<br><code>pip install qrcode</code></div>
        </div>
        <div style="margin-top:14px;font-family:monospace;font-size:.72rem;color:var(--accent2);word-break:break-all;">${esc(info.url || '')}</div>
        ${info.id ? `<div style="margin-top:4px;font-family:monospace;font-size:.7rem;color:var(--text-mute);">ID: ${esc(info.id)}</div>` : ''}
      ` : `
        <div style="color:#f59e0b;font-size:.85rem;padding:24px 8px;line-height:1.6;">${noConnMsg}</div>
      `}
      <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:14px;text-align:left;">
        <div style="font-size:.82rem;font-weight:700;margin-bottom:8px;">📦 모바일 앱 설치 (APK)</div>
        ${apk.exists ? `
          <a href="/api/apk" class="btn-outline btn-sm"
             style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;width:100%;">
            APK 다운로드 (${(apk.size / 1048576).toFixed(1)} MB)
          </a>
          <div style="font-size:.7rem;color:var(--text-mute);margin-top:5px;">빌드: ${esc((apk.mtime || '').replace('T', ' '))}</div>
        ` : `
          <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;">
            빌드된 APK가 없습니다.<br>PC에서 <code>mobile\\build_apk.bat</code> 실행 후 다시 열어주세요.
          </div>
        `}
      </div>
      <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:14px;text-align:left;">
        <div style="font-size:.82rem;font-weight:700;margin-bottom:8px;">⚙️ EP4 접속 설정</div>
        <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;margin-bottom:6px;cursor:pointer;">
          <input type="radio" name="qrConnMode" value="tunnel" ${mode !== 'direct' ? 'checked' : ''} onchange="_qrModeChanged()">
          Cloudflare 터널 (tunnel.bat)
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;margin-bottom:6px;cursor:pointer;">
          <input type="radio" name="qrConnMode" value="direct" ${mode === 'direct' ? 'checked' : ''} onchange="_qrModeChanged()">
          직접 URL (공유기 NAT/포트포워딩)
        </label>
        <input id="qrDirectUrl" type="text" placeholder="예: http://myhome.iptime.org:7788"
               value="${esc(info.direct_url || '')}"
               style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:.78rem;font-family:monospace;
                      background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);
                      margin:2px 0 8px;display:${mode === 'direct' ? 'block' : 'none'};">
        <button class="btn-outline btn-sm" style="width:100%;" onclick="_qrSaveConnMode()">접속 설정 저장</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        ${hasConn && safeUrl ? `<button class="btn-outline" style="flex:1;" onclick="_qrCopyUrl('${safeUrl}')">주소 복사</button>` : ''}
        <button class="btn-accent" style="flex:1;" onclick="document.getElementById('qrConnectModal').remove()">닫기</button>
      </div>
    </div>`;
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
}

function _qrModeChanged() {
  const sel = document.querySelector('input[name="qrConnMode"]:checked');
  const inp = document.getElementById('qrDirectUrl');
  if (inp) inp.style.display = (sel && sel.value === 'direct') ? 'block' : 'none';
}

async function _qrSaveConnMode() {
  const sel = document.querySelector('input[name="qrConnMode"]:checked');
  const modeVal = sel ? sel.value : 'tunnel';
  const url = (document.getElementById('qrDirectUrl')?.value || '').trim().replace(/\/+$/, '');
  if (modeVal === 'direct' && !url) {
    showAlert('직접 접속 URL을 입력하세요.', {type: 'warning'}); return;
  }
  if (modeVal === 'direct' && !/^https?:\/\//.test(url)) {
    showAlert('http:// 또는 https:// 로 시작하는 URL을 입력하세요.', {type: 'warning'}); return;
  }
  try {
    await fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({key: 'connect_mode', value: modeVal})});
    await fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({key: 'connect_direct_url', value: url})});
  } catch (_) {
    showAlert('설정 저장에 실패했습니다.', {type: 'error'}); return;
  }
  showQrConnect();   // 모달을 다시 그려 QR 을 새 주소로 갱신
}

function _qrCopyUrl(url) {
  if (navigator.clipboard) navigator.clipboard.writeText(url);
  showAlert('서버 주소를 복사했습니다.', {type: 'success'});
}

// ── Spotlight ──────────────────────────────────────────
function filterTasksInline(q) {
  if (_isPluginViewActive()) {
    _pluginSearch = q.trim();
    const host = document.getElementById('plugin-view-host');
    if (host) host.dispatchEvent(new CustomEvent('ep4:search', { detail: { q: _pluginSearch } }));
    _updateSearchWrap();
    return;
  }
  const v = _currentView;
  if (v === 'log')           { _rlSearch   = q.trim(); _renderRlRows(); }
  else if (v === 'projects') { _projSearch = q.trim(); renderProjects(); }
  else                       { _taskSearch = q.trim(); renderTasks(); }
  _updateSearchWrap();
}

function clearTaskSearch() {
  _taskSearch = ''; _rlSearch = ''; _projSearch = ''; _pluginSearch = '';
  const inp = document.getElementById('globalSearch');
  if (inp) inp.value = '';
  _updateSearchWrap();
  if (_isPluginViewActive()) {
    const host = document.getElementById('plugin-view-host');
    if (host) host.dispatchEvent(new CustomEvent('ep4:search', { detail: { q: '' } }));
    return;
  }
  if (_currentView === 'log') _renderRlRows();
  else if (_currentView === 'projects') renderProjects();
  else renderTasks();
}

function _updateSearchWrap() {
  const q = _isPluginViewActive() ? _pluginSearch
          : _currentView === 'log' ? _rlSearch
          : _currentView === 'projects' ? _projSearch
          : _taskSearch;
  const wrap = document.getElementById('search-wrap');
  const clearBtn = document.getElementById('search-clear-btn');
  if (wrap) wrap.classList.toggle('search-active', q.length > 0);
  if (clearBtn) clearBtn.style.display = q.length > 0 ? 'block' : 'none';
}

function _hlText(text, q) {
  if (!q) return esc(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return esc(text);
  return esc(text.slice(0, idx)) + `<mark class="tk-hl">${esc(text.slice(idx, idx + q.length))}</mark>` + esc(text.slice(idx + q.length));
}

function openSpotlight() {
  const overlay = document.getElementById('spotlight');
  overlay.classList.add('open');
  const inp = document.getElementById('spotlight-input');
  inp.value = '';
  filterSpotlight('');
  setTimeout(() => inp.focus(), 50);
}
function closeSpotlight(e) {
  if (!e || e.target === document.getElementById('spotlight')) {
    document.getElementById('spotlight').classList.remove('open');
    spFocused = -1;
  }
}
function filterSpotlight(q) {
  const box = document.getElementById('spotlight-results');
  const filtered = q.trim()
    ? tasks.filter(tk => tk.text.toLowerCase().includes(q.toLowerCase()))
    : tasks;
  spFocused = -1;
  if (!filtered.length) {
    box.innerHTML = `<div class="sp-empty">${t('sp.empty')}</div>`;
    return;
  }
  const statusLabel = { pending:t('task.pending'), running:t('task.running'), done:t('task.done'), error:t('task.error') };
  const statusIcon  = { pending:'⏳', running:'▶', done:'✅', error:'❌' };
  box.innerHTML = filtered.map((tk, i) => `
    <div class="sp-item" data-idx="${i}" data-id="${tk.id}"
         onclick="spSelect(${tk.id})" onmouseenter="spHover(${i})">
      <span class="sp-item-icon">${statusIcon[tk.status]||'⏳'}</span>
      <span class="sp-item-text">${esc(tk.text)}</span>
      <span class="sp-item-status">${statusLabel[tk.status]||tk.status}</span>
    </div>`).join('');
}
function spHover(i) { spFocused = i; updateSpFocus(); }
function updateSpFocus() {
  document.querySelectorAll('.sp-item').forEach((el, i) =>
    el.classList.toggle('focused', i === spFocused));
}
function spotlightKey(e) {
  const items = document.querySelectorAll('.sp-item');
  if (e.key === 'Escape') { closeSpotlight(); return; }
  if (e.key === 'ArrowDown') { spFocused = Math.min(spFocused + 1, items.length - 1); updateSpFocus(); e.preventDefault(); }
  if (e.key === 'ArrowUp')   { spFocused = Math.max(spFocused - 1, 0); updateSpFocus(); e.preventDefault(); }
  if (e.key === 'Enter' && spFocused >= 0) { items[spFocused]?.click(); }
}
function spSelect(id) {
  closeSpotlight();
  showView('todo');
  setTimeout(() => {
    const el = document.querySelector(`[data-task-id="${id}"]`);
    if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.add('highlight'); setTimeout(()=>el.classList.remove('highlight'),1500); }
  }, 100);
}

// ── Settings dropdown ──────────────────────────────────
function toggleSettingsDropdown() {
  const dd = document.getElementById('settingsDropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', (e) => {
  const dd = document.getElementById('settingsDropdown');
  if (!dd || dd.style.display === 'none') return;
  if (!e.target.closest('#btn-settings') && !e.target.closest('#settingsDropdown')) {
    dd.style.display = 'none';
  }
});

// ── Theme ──────────────────────────────────────────────
const _ALL_THEMES = ['dark','light','midnight','forest','sunset'];

function _resolveAutoTheme() {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
}

function _applyTheme(th) {
  const resolved = th === 'auto' ? _resolveAutoTheme() : th;
  _ALL_THEMES.forEach(th => document.body.classList.remove('theme-' + th));
  document.body.classList.add('theme-' + resolved);
  document.documentElement.style.colorScheme = resolved === 'light' ? 'light' : 'dark';
}

function setTheme(th) {
  document.body.classList.add('theme-switching');
  setTimeout(() => _applyTheme(th), 50);
  setTimeout(() => document.body.classList.remove('theme-switching'), 550);
  document.querySelectorAll('.theme-check').forEach(el => {
    el.style.display = el.dataset.theme === th ? '' : 'none';
  });
  try { localStorage.setItem('ep4-theme', th); } catch {}
  try {
    if (window._themeMql) { window._themeMql.onchange = null; window._themeMql = null; }
    if (th === 'auto' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      mql.onchange = () => _applyTheme('auto');
      window._themeMql = mql;
    }
  } catch {}
  toggleSettingsDropdown();
}

(function _initTheme() {
  try {
    const saved = localStorage.getItem('ep4-theme') || 'dark';
    _applyTheme(saved);
    document.querySelectorAll('.theme-check').forEach(el => {
      el.style.display = el.dataset.theme === saved ? '' : 'none';
    });
    if (saved === 'auto' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      mql.onchange = () => _applyTheme('auto');
      window._themeMql = mql;
    }
  } catch {}
})();

// ── Language / i18n ────────────────────────────────────
let _curLang = 'ko';

const _I18N = {
  ko: {
    'nav.section.main': '메인',
    'nav.section.run':  '실행',
    'nav.projects':     '프로젝트',
    'nav.project':      '태스크',
    'view.title.projects': '프로젝트',
    'view.sub.projects':   '프로젝트 목록',
    'view.pj.section':     '프로젝트 목록',
    'project.new':     '새 프로젝트',
    'project.list':    '태스크 목록',
    'project.save':    '프로젝트 생성',
    'project.update':  '수정 저장',
    'project.modal.title': '새 프로젝트',
    'project.form.name':   '프로젝트 이름',
    'project.form.desc':   '설명',
    'project.harness':     '기본 하네스',
    'project.harness.desc':'이 프로젝트에 등록되는 모든 태스크가 상속합니다 (태스크별 변경 가능)',
    'project.harness.model':   '모델',
    'project.harness.preset':  '프리셋',
    'project.harness.retry':   '재시도',
    'project.harness.timeout': '타임아웃',
    'project.root':            '프로젝트 루트',
    'project.root.browse':     '📁 경로 선택',
    'project.root.hint':       'Claude가 파일을 쓰고 코드를 실행하는 기준 경로',
    'project.skipPerms':       '▲ 권한 확인 건너뛰기 (위험)',
    'project.skipPerms.chip':  '⚠ 권한 건너뛰기',
    'project.skipPerms.desc':  'Claude가 모든 도구를 확인 없이 실행합니다. 의도치 않은 변경·삭제가 적용될 수 있습니다.',
    'project.skipPerms.confirm.title': '권한을 건너뛸까요?',
    'project.skipPerms.confirm.desc':  '이 옵션을 켜면 작업 디렉터리 안에서 모든 명령이 사람 확인 없이 실행됩니다. 격리된 신뢰 환경에서만 사용하세요.',
    'project.skipPerms.confirm.ok':    '위험을 이해했고 켭니다',
    'project.notify':          '알림 전송',
    'project.notify.desc':     '태스크 완료·실패 시 선택한 채널로 알림을 보냅니다 (새 프로젝트는 기본 채널 ★ 자동 선택)',
    'project.datasource':      '데이터 소스 연결',
    'project.datasource.desc': '태스크가 읽어 들일 입력의 출처. 비우면 작업 디렉터리를 사용합니다.',
    'project.datasource.local':'🗂 로컬 경로',
    'project.autoRun':         '자동 실행 활성화',
    'project.autoRun.desc':    '끄면 트리거가 무시되고 수동으로만 실행됩니다',
    'tool.read':  '파일 읽기',
    'tool.write': '파일 쓰기',
    'tool.bash':  '코드 실행',
    'project.badge.auto':  '자동 실행',
    'project.badge.manual':'수동',
    'btn.search':          '검색',
    'btn.run':             '실행',
    'task.filter.all':     '전체',
    'task.filter.running': '실행 중',
    'task.filter.pending': '대기',
    'task.filter.done':    '완료',
    'task.filter.error':   '실패',
    'task.col.task':       '태스크',
    'task.col.harness':    '모델',
    'task.col.trigger':    '트리거',
    'task.col.session':    '세션 ID',
    'task.col.status':     '상태',
    'task.stop':           '중지',
    'task.retry':          '재시도',
    'btn.run.all':         '전체 실행',
    'nav.log':          '실행 로그',
    'nav.run':          '전체 실행',
    'nav.pause':        '일시정지',
    'nav.reset':        '새로고침',
    'nav.status':       '대기 중',
    'header.connected': '서버 연결됨',
    'header.disconnected': '서버 연결 끊김',
    'view.title.todo':     '태스크',
    'view.title.log':      '실행 로그',
    'view.title.sessions': '세션',
    'view.sub.todo':       '태스크 목록',
    'view.sub.log':        '실시간 실행 출력',
    'view.sub.sessions':   '실행 중인 Claude 세션',
    'btn.stop':         '⏸ 일시정지',
    'btn.reset':        '↺ 새로고침',
    'btn.start':        '▶ 전체 실행',
    'stat.total':       '전체 작업',
    'stat.done':        '완료',
    'stat.running':     '진행 중',
    'stat.error':       '실패',
    'task.list':        '작업 목록',
    'task.add':         '새 태스크',
    'task.detail':      '상세',
    'task.edit':        '수정',
    'task.delete':      '삭제',
    'task.pending':     '대기 중',
    'task.running':     '실행 중',
    'task.done':        '완료',
    'task.error':       '오류',
    'log.title':        '실행 로그',
    'log.full':         '실행 로그 전체',
    'log.waiting':      '대기 중',
    'modal.save':       '저장',
    'modal.cancel':     '취소',
    'chat.title':       '🤖 EasyProject4 도우미',
    'chat.clear':       '대화 삭제',
    'chat.placeholder': '질문을 입력하세요…',
    'chat.send':        '전송',
    'chat.welcome':     '안녕하세요! EasyProject4 사용에 대해 무엇이든 물어보세요.',
    'settings.theme':   '테마',
    'settings.lang':    '언어',
    'settings.reload':  '페이지 재로드',
    'search.placeholder': '검색… /',
    'sp.empty':         '검색 결과가 없습니다.',
    'sp.hint':          '<kbd>↑↓</kbd> 이동 &nbsp; <kbd>Enter</kbd> 상세보기 &nbsp; <kbd>Esc</kbd> 닫기',
    'cli.connected':    'Claude CLI 연결됨',
    'cli.disconnected': 'Claude CLI 미연결',
    'cli.not_installed':'Claude CLI 미설치',
    'cli.switch':            '🔄 전환',
    'cli.logout':            '🚪 로그아웃',
    'cli.login':             '🚀 로그인',
    'cli.chip.connected':    '✓ 연결',
    'cli.chip.not_installed':'✗ 미설치',
    'cli.chip.not_logged_in':'✗ 미로그인',
    'task.stop':   '중지',
    'task.retry':  '재실행',
    'task.test':   '테스트',
    'task.branch': '브랜치',
    'settings.section.theme': '테마',
    'settings.section.lang':  '언어',
    'settings.section.chat':  '채팅',
    'settings.autoTranslate': '자동 번역',
    'chat.translating': '🌐 번역 중…',
    'settings.channels': '알림 채널',
    'channel.title': '알림 채널',
    'channel.desc':  '등록한 채널은 알림 전송 대상으로 선택할 수 있습니다.',
    'channel.addSlack':   'Slack 채널 추가',
    'channel.addDiscord': 'Discord 채널 추가',
    'channel.form.name':    '채널 이름 (예: #alerts)',
    'channel.form.server':  '서버/워크스페이스 이름',
    'channel.form.webhook': 'Webhook URL',
    'theme.auto':    '자동 (OS)',
    'theme.dark':    '다크',
    'theme.light':   '라이트',
    'theme.midnight':'미드나잇',
    'theme.forest':  '포레스트',
    'theme.sunset':  '선셋',
    'trig.manual':   '수동 실행',
    'trig.schedule': '스케줄',
    'trig.auto':     '자동 실행',
    'rl.all_projects':   '모든 프로젝트',
    'rl.select_toggle':  '☑ 선택',
    'rl.select_cancel':  '✕ 취소',
    'rl.selected_suffix':'개 선택됨',
    'rl.delete_warn':    '삭제할 항목을 선택하세요.',
    'rl.delete_title':   '로그 삭제',
    'rl.delete_ok':      '삭제',
    'rl.no_runs':        '실행 기록이 없습니다.',
    'rl.no_results':     '검색 결과가 없습니다.',
    'rl.no_trace':       '이 trace에 실행 기록이 없습니다.',
    'rl.status.running': '실행 중',
    'rl.status.done':    '완료',
    'rl.status.error':   '실패',
    'rl.elapsed':        '{0} 소요',
    'rl.running_dots':   '실행 중…',
    'rl.no_prompt':      '(프롬프트 없음)',
    'rl.no_output':      '(출력 없음)',
    'rl.screenshot_caption': '태스크 완료 시점의 미리보기 화면',
    'rl.screenshot_open':    '원본 열기 ↗',
    'rl.screenshot_alt':     '실행 스크린샷',
    'rl.no_log':             '로그가 없습니다.',
    'rl.git.merged':     '머지됨',
    'rl.git.conflict':   '충돌',
    'rl.git.pending':    '대기',
    'rl.git.no_changes': '변경없음',
    'rl.git.task_failed':'태스크 실패',
    'rl.git.wt_error':   'Worktree 오류',
    'rl.git.no_git':     'Git 없음',
    'rl.git.pr_label':   'Pull Request 생성',
    'rl.git.mr_label':   'Merge Request 생성',
    'rl.git.code_view':  '코드 보기',
    'rl.git.commits':    '{0}커밋',
    'rl.git.files':      '{0}파일 변경',
    'rl.git.summary':    '{0}파일 · +{1} -{2} · {3}커밋',
    'rl.git.no_main':    'main 미반영',
    'rl.git.no_changes_detail': 'Git 변경 내역이 없습니다.',
    'rl.attempt':        '#{0} {1} · {2}',
    'run.session_copied':'세션 ID가 복사되었습니다.',
    'run.run_failed':    '실행 실패',
    'run.rerun_error':   '재실행 요청 중 오류가 발생했습니다.',
    'run.retry_count':   '재시도 0/3',
    'claude.messages':         '메시지',
    'claude.tool_calls':       '도구 호출',
    'claude.tokens':           '토큰',
    'claude.errors':           '오류',
    'claude.session_id':       '세션 ID',
    'claude.model':            '모델',
    'claude.last_active':      '마지막 활동',
    'claude.first_message':    '첫 메시지',
    'claude.turns_fmt':        '{0}턴 (👤 {1} / 🤖 {2})',
    'claude.duration_suffix':  '지속 {0}',
    'claude.no_messages':      '표시할 대화가 없습니다.',
    'claude.working_path':     '작업 경로: ',
    'claude.truncated':        '⚠ 메시지가 많아 최근 {0}개만 표시합니다.',
    'claude.conversation':     '대화 내용 ({0})',
    'claude.user_label':       '👤 사용자',
    'dur.sec':  '{0}초',
    'dur.min':  '{0}분',
    'dur.h':    '{0}시간 {1}분',
  },
  en: {
    'nav.section.main': 'Main',
    'nav.section.run':  'Actions',
    'nav.projects':     'Projects',
    'nav.project':      'Tasks',
    'view.title.projects': 'Projects',
    'view.sub.projects':   'Project list',
    'view.pj.section':     'Project list',
    'project.new':     'New Project',
    'project.list':    'Project List',
    'project.save':    'Create Project',
    'project.update':  'Save Changes',
    'project.modal.title': 'New Project',
    'project.form.name':   'Project Name',
    'project.form.desc':   'Description',
    'project.harness':     'Default Harness',
    'project.harness.desc':'All tasks inherit these settings (overridable per task)',
    'project.harness.model':   'Model',
    'project.harness.preset':  'Preset',
    'project.harness.retry':   'Retry',
    'project.harness.timeout': 'Timeout',
    'project.root':            'Project Root',
    'project.root.browse':     '📁 Browse',
    'project.root.hint':       'Working directory for Claude file writes and code execution',
    'project.skipPerms':       '▲ Skip Permission Checks (Danger)',
    'project.skipPerms.chip':  '⚠ Skip Permissions',
    'project.skipPerms.desc':  'Claude will run all tools without confirmation. Unintended changes may be applied.',
    'project.skipPerms.confirm.title': 'Skip permissions?',
    'project.skipPerms.confirm.desc':  'All commands will run without human confirmation. Only use in isolated trusted environments.',
    'project.skipPerms.confirm.ok':    'I understand the risk',
    'project.notify':          'Send Notifications',
    'project.notify.desc':     'Send alerts to selected channels on task completion/failure (new projects auto-select the default channel ★)',
    'project.datasource':      'Data Source',
    'project.datasource.desc': 'The source of input data for tasks. Defaults to working directory if empty.',
    'project.datasource.local':'🗂 Local path',
    'project.autoRun':         'Enable Auto Run',
    'project.autoRun.desc':    'Disable to ignore triggers and run manually only',
    'tool.read':  'Read Files',
    'tool.write': 'Write Files',
    'tool.bash':  'Run Code',
    'project.badge.auto':  'Auto Run',
    'project.badge.manual':'Manual',
    'btn.search':          'Search',
    'btn.run':             'Run',
    'task.filter.all':     'All',
    'task.filter.running': 'Running',
    'task.filter.pending': 'Pending',
    'task.filter.done':    'Done',
    'task.filter.error':   'Failed',
    'task.col.task':       'Task',
    'task.col.harness':    'Model',
    'task.col.trigger':    'Trigger',
    'task.col.session':    'Session ID',
    'task.col.status':     'Status',
    'task.stop':           'Stop',
    'task.retry':          'Retry',
    'btn.run.all':         'Run All',
    'nav.log':          'Run Log',
    'nav.run':          'Run All',
    'nav.pause':        'Pause',
    'nav.reset':        'Refresh',
    'nav.status':       'Idle',
    'header.connected': 'Connected',
    'header.disconnected': 'Disconnected',
    'view.title.todo':     'Projects',
    'view.title.log':      'Run Log',
    'view.title.sessions': 'Sessions',
    'view.sub.todo':       'Automate & monitor tasks',
    'view.sub.log':        'Live execution output',
    'view.sub.sessions':   'Running Claude sessions',
    'btn.stop':         '⏸ Pause',
    'btn.reset':        '↺ Refresh',
    'btn.start':        '▶ Run All',
    'stat.total':       'Total',
    'stat.done':        'Done',
    'stat.running':     'Running',
    'stat.error':       'Failed',
    'task.list':        'Task List',
    'task.add':         'New Task',
    'task.detail':      'Detail',
    'task.edit':        'Edit',
    'task.delete':      'Delete',
    'task.pending':     'Pending',
    'task.running':     'Running',
    'task.done':        'Done',
    'task.error':       'Error',
    'log.title':        'Run Log',
    'log.full':         'Full Run Log',
    'log.waiting':      'Idle',
    'modal.save':       'Save',
    'modal.cancel':     'Cancel',
    'chat.title':       '🤖 EP4 Assistant',
    'chat.clear':       'Clear chat',
    'chat.placeholder': 'Ask anything…',
    'chat.send':        'Send',
    'chat.welcome':     'Hello! Ask me anything about EasyProject4.',
    'settings.theme':   'Theme',
    'settings.lang':    'Language',
    'settings.reload':  'Reload page',
    'search.placeholder': 'Search… /',
    'sp.empty':         'No results found.',
    'sp.hint':          '<kbd>↑↓</kbd> navigate &nbsp; <kbd>Enter</kbd> open &nbsp; <kbd>Esc</kbd> close',
    'cli.connected':    'Claude CLI connected',
    'cli.disconnected': 'Claude CLI disconnected',
    'cli.not_installed':'Claude CLI not installed',
    'cli.switch':            '🔄 Switch',
    'cli.logout':            '🚪 Logout',
    'cli.login':             '🚀 Login',
    'cli.chip.connected':    '✓ Connected',
    'cli.chip.not_installed':'✗ Not installed',
    'cli.chip.not_logged_in':'✗ Not logged in',
    'task.stop':   'Stop',
    'task.retry':  'Retry',
    'task.test':   'Test',
    'task.branch': 'Branch',
    'settings.section.theme': 'Theme',
    'settings.section.lang':  'Language',
    'settings.section.chat':  'Chat',
    'settings.autoTranslate': 'Auto Translate',
    'chat.translating': '🌐 Translating…',
    'settings.channels': 'Notification Channels',
    'channel.title': 'Notification Channels',
    'channel.desc':  'Registered channels can be selected as notification targets.',
    'channel.addSlack':   'Add Slack Channel',
    'channel.addDiscord': 'Add Discord Channel',
    'channel.form.name':    'Channel name (e.g. #alerts)',
    'channel.form.server':  'Server / Workspace name',
    'channel.form.webhook': 'Webhook URL',
    'theme.auto':    'Auto (OS)',
    'theme.dark':    'Dark',
    'theme.light':   'Light',
    'theme.midnight':'Midnight',
    'theme.forest':  'Forest',
    'theme.sunset':  'Sunset',
    'trig.manual':   'Manual',
    'trig.schedule': 'Schedule',
    'trig.auto':     'Auto',
    'rl.all_projects':   'All Projects',
    'rl.select_toggle':  '☑ Select',
    'rl.select_cancel':  '✕ Cancel',
    'rl.selected_suffix':' selected',
    'rl.delete_warn':    'Select items to delete first.',
    'rl.delete_title':   'Delete Logs',
    'rl.delete_ok':      'Delete',
    'rl.no_runs':        'No run history.',
    'rl.no_results':     'No results found.',
    'rl.no_trace':       'No runs for this trace.',
    'rl.status.running': 'Running',
    'rl.status.done':    'Done',
    'rl.status.error':   'Failed',
    'rl.elapsed':        '{0} elapsed',
    'rl.running_dots':   'Running…',
    'rl.no_prompt':      '(No prompt)',
    'rl.no_output':      '(No output)',
    'rl.screenshot_caption': 'Preview at task completion',
    'rl.screenshot_open':    'Open original ↗',
    'rl.screenshot_alt':     'Run screenshot',
    'rl.no_log':             'No log entries.',
    'rl.git.merged':     'Merged',
    'rl.git.conflict':   'Conflict',
    'rl.git.pending':    'Pending',
    'rl.git.no_changes': 'No changes',
    'rl.git.task_failed':'Task failed',
    'rl.git.wt_error':   'Worktree error',
    'rl.git.no_git':     'No git',
    'rl.git.pr_label':   'Create Pull Request',
    'rl.git.mr_label':   'Create Merge Request',
    'rl.git.code_view':  'View code',
    'rl.git.commits':    '{0} commits',
    'rl.git.files':      '{0} files changed',
    'rl.git.summary':    '{0} files · +{1} -{2} · {3} commits',
    'rl.git.no_main':    'not merged to main',
    'rl.git.no_changes_detail': 'No git changes.',
    'rl.attempt':        '#{0} {1} · {2}',
    'run.session_copied':'Session ID copied.',
    'run.run_failed':    'Run failed',
    'run.rerun_error':   'Error requesting rerun.',
    'run.retry_count':   'Retry 0/3',
    'claude.messages':         'Messages',
    'claude.tool_calls':       'Tool calls',
    'claude.tokens':           'Tokens',
    'claude.errors':           'Errors',
    'claude.session_id':       'Session ID',
    'claude.model':            'Model',
    'claude.last_active':      'Last active',
    'claude.first_message':    'First message',
    'claude.turns_fmt':        '{0} turns (👤 {1} / 🤖 {2})',
    'claude.duration_suffix':  'Duration: {0}',
    'claude.no_messages':      'No conversation to display.',
    'claude.working_path':     'Working path: ',
    'claude.truncated':        '⚠ Showing last {0} messages only.',
    'claude.conversation':     'Conversation ({0})',
    'claude.user_label':       '👤 User',
    'dur.sec':  '{0}s',
    'dur.min':  '{0}m',
    'dur.h':    '{0}h {1}m',
  },
  zh: {
    'nav.section.main': '主菜单',
    'nav.section.run':  '操作',
    'nav.projects':     '项目',
    'nav.project':      '任务',
    'view.title.projects': '项目',
    'view.sub.projects':   '项目列表',
    'project.new':     '新建项目',
    'project.list':    '项目列表',
    'project.save':    '创建项目',
    'project.update':  '保存修改',
    'project.modal.title': '新建项目',
    'project.form.name':   '项目名称',
    'project.form.desc':   '描述',
    'project.harness':     '默认配置',
    'project.harness.model': '模型',
    'project.harness.preset': '预设',
    'project.harness.retry':  '重试',
    'project.harness.timeout':'超时',
    'project.root':           '项目根目录',
    'project.root.browse':    '📁 选择路径',
    'project.root.hint':      'Claude 写入文件和执行代码的工作目录',
    'project.skipPerms':      '▲ 跳过权限检查（危险）',
    'project.skipPerms.chip': '⚠ 跳过权限',
    'project.skipPerms.desc': 'Claude 将无需确认即可运行所有工具。',
    'project.skipPerms.confirm.title': '跳过权限？',
    'project.skipPerms.confirm.desc':  '所有命令将在没有人工确认的情况下运行。仅在隔离的可信环境中使用。',
    'project.skipPerms.confirm.ok':    '我了解风险',
    'project.datasource.desc': '任务读取输入数据的来源。留空则使用工作目录。',
    'project.notify':    '发送通知',
    'project.autoRun':   '启用自动运行',
    'tool.read':  '读取文件',
    'tool.write': '写入文件',
    'tool.bash':  '执行代码',
    'project.badge.auto':  '自动运行',
    'project.badge.manual':'手动',
    'btn.search':          '搜索',
    'btn.run':             '运行',
    'task.filter.all':     '全部',
    'task.filter.running': '运行中',
    'task.filter.pending': '等待',
    'task.filter.done':    '完成',
    'task.filter.error':   '失败',
    'task.col.task':       '任务',
    'task.col.harness':    '工具',
    'task.col.trigger':    '触发器',
    'task.col.status':     '状态',
    'task.stop':           '停止',
    'task.retry':          '重试',
    'btn.run.all':         '全部运行',
    'nav.log':          '运行日志',
    'nav.run':          '全部运行',
    'nav.pause':        '暂停',
    'nav.reset':        '刷新',
    'nav.status':       '空闲',
    'header.connected': '已连接',
    'header.disconnected': '已断开',
    'view.title.todo':  '项目',
    'view.title.log':   '运行日志',
    'view.sub.todo':    '自动执行并监控任务',
    'view.sub.log':     '实时执行输出',
    'btn.stop':         '⏸ 暂停',
    'btn.reset':        '↺ 刷新',
    'btn.start':        '▶ 全部运行',
    'stat.total':       '全部任务',
    'stat.done':        '完成',
    'stat.running':     '运行中',
    'stat.error':       '失败',
    'task.list':        '任务列表',
    'task.add':         '新任务',
    'task.detail':      '详情',
    'task.edit':        '编辑',
    'task.delete':      '删除',
    'task.pending':     '等待中',
    'task.running':     '运行中',
    'task.done':        '完成',
    'task.error':       '错误',
    'log.title':        '运行日志',
    'log.full':         '完整运行日志',
    'log.waiting':      '空闲',
    'modal.save':       '保存',
    'modal.cancel':     '取消',
    'chat.title':       '🤖 EP4 助手',
    'chat.clear':       '清除对话',
    'chat.placeholder': '请输入问题…',
    'chat.send':        '发送',
    'chat.welcome':     '您好！请随时询问有关EasyProject4的问题。',
    'settings.theme':   '主题',
    'settings.lang':    '语言',
    'settings.reload':  '重新加载页面',
    'search.placeholder': '搜索… /',
    'sp.empty':         '未找到结果。',
    'sp.hint':          '<kbd>↑↓</kbd> 导航 &nbsp; <kbd>Enter</kbd> 打开 &nbsp; <kbd>Esc</kbd> 关闭',
    'cli.connected':    'Claude CLI 已连接',
    'cli.disconnected': 'Claude CLI 已断开',
    'cli.not_installed':'Claude CLI 未安装',
    'cli.switch':            '🔄 切换',
    'cli.logout':            '🚪 退出',
    'cli.login':             '🚀 登录',
    'cli.chip.connected':    '✓ 已连接',
    'cli.chip.not_installed':'✗ 未安装',
    'cli.chip.not_logged_in':'✗ 未登录',
    'task.stop':   '停止',
    'task.retry':  '重试',
    'task.test':   '测试',
    'task.branch': '分支',
    'settings.section.theme': '主题',
    'settings.section.lang':  '语言',
    'settings.section.chat':  '聊天',
    'settings.autoTranslate': '自动翻译',
    'chat.translating': '🌐 翻译中…',
    'settings.channels': '通知频道',
    'channel.title': '通知频道',
    'channel.desc':  '已注册的频道可以选择为通知发送目标。',
    'channel.addSlack':   '添加 Slack 频道',
    'channel.addDiscord': '添加 Discord 频道',
    'channel.form.name':    '频道名称（如 #alerts）',
    'channel.form.server':  '服务器/工作区名称',
    'channel.form.webhook': 'Webhook URL',
    'theme.auto':    '自动 (OS)',
    'theme.dark':    '暗色',
    'theme.light':   '亮色',
    'theme.midnight':'午夜',
    'theme.forest':  '森林',
    'theme.sunset':  '日落',
  },
  fr: {
    'nav.section.main': 'Menu',
    'nav.section.run':  'Actions',
    'nav.projects':     'Projets',
    'nav.project':      'Tâches',
    'view.title.projects': 'Projets',
    'view.sub.projects':   'Liste des projets',
    'project.new':     'Nouveau Projet',
    'project.list':    'Liste des projets',
    'project.save':    'Créer le projet',
    'project.update':  'Enregistrer',
    'project.modal.title': 'Nouveau Projet',
    'project.form.name':   'Nom du projet',
    'project.form.desc':   'Description',
    'project.harness':     'Harnais par défaut',
    'project.harness.model': 'Modèle',
    'project.harness.preset': 'Préréglage',
    'project.harness.retry':  'Retry',
    'project.harness.timeout':'Délai',
    'project.root':           'Racine du projet',
    'project.root.browse':    '📁 Choisir',
    'project.root.hint':      'Répertoire de travail pour les fichiers et l\'exécution de code',
    'project.skipPerms':      '▲ Ignorer les permissions (Danger)',
    'project.skipPerms.chip': '⚠ Ignorer permissions',
    'project.skipPerms.desc': 'Claude exécutera tous les outils sans confirmation.',
    'project.skipPerms.confirm.title': 'Ignorer les permissions ?',
    'project.skipPerms.confirm.desc':  'Toutes les commandes s\'exécuteront sans confirmation humaine. Utilisez uniquement dans un environnement isolé.',
    'project.skipPerms.confirm.ok':    'Je comprends le risque',
    'project.datasource.desc': 'Source des données d\'entrée pour les tâches. Laissez vide pour utiliser le répertoire de travail.',
    'project.notify':    'Envoyer des notifications',
    'project.autoRun':   'Activer l\'exécution auto',
    'tool.read':  'Lire les fichiers',
    'tool.write': 'Écrire les fichiers',
    'tool.bash':  'Exécuter du code',
    'project.badge.auto':  'Auto',
    'project.badge.manual':'Manuel',
    'btn.search':          'Rechercher',
    'btn.run':             'Exécuter',
    'task.filter.all':     'Tout',
    'task.filter.running': 'En cours',
    'task.filter.pending': 'En attente',
    'task.filter.done':    'Terminé',
    'task.filter.error':   'Échec',
    'task.col.task':       'Tâche',
    'task.col.harness':    'Harnais',
    'task.col.trigger':    'Déclencheur',
    'task.col.status':     'Statut',
    'task.stop':           'Arrêter',
    'task.retry':          'Réessayer',
    'btn.run.all':         'Tout exécuter',
    'nav.log':          'Journal',
    'nav.run':          'Tout exécuter',
    'nav.pause':        'Pause',
    'nav.reset':        'Actualiser',
    'nav.status':       'Inactif',
    'header.connected': 'Connecté',
    'header.disconnected': 'Déconnecté',
    'view.title.todo':  'Projets',
    'view.title.log':   'Journal',
    'view.sub.todo':    'Automatiser et surveiller les tâches',
    'view.sub.log':     'Sortie en temps réel',
    'btn.stop':         '⏸ Pause',
    'btn.reset':        '↺ Actualiser',
    'btn.start':        '▶ Tout exécuter',
    'stat.total':       'Total',
    'stat.done':        'Terminé',
    'stat.running':     'En cours',
    'stat.error':       'Échec',
    'task.list':        'Liste des tâches',
    'task.add':         'Nouvelle tâche',
    'task.detail':      'Détail',
    'task.edit':        'Modifier',
    'task.delete':      'Supprimer',
    'task.pending':     'En attente',
    'task.running':     'En cours',
    'task.done':        'Terminé',
    'task.error':       'Erreur',
    'log.title':        'Journal',
    'log.full':         'Journal complet',
    'log.waiting':      'Inactif',
    'modal.save':       'Enregistrer',
    'modal.cancel':     'Annuler',
    'chat.title':       '🤖 Assistant EP4',
    'chat.clear':       'Effacer',
    'chat.placeholder': 'Posez une question…',
    'chat.send':        'Envoyer',
    'chat.welcome':     'Bonjour ! Posez-moi n\'importe quelle question sur EasyProject4.',
    'settings.theme':   'Thème',
    'settings.lang':    'Langue',
    'settings.reload':  'Recharger la page',
    'search.placeholder': 'Rechercher… /',
    'sp.empty':         'Aucun résultat.',
    'sp.hint':          '<kbd>↑↓</kbd> naviguer &nbsp; <kbd>Enter</kbd> ouvrir &nbsp; <kbd>Esc</kbd> fermer',
    'cli.connected':    'Claude CLI connecté',
    'cli.disconnected': 'Claude CLI déconnecté',
    'cli.not_installed':'Claude CLI non installé',
    'cli.switch':            '🔄 Changer',
    'cli.logout':            '🚪 Déconnexion',
    'cli.login':             '🚀 Connexion',
    'cli.chip.connected':    '✓ Connecté',
    'cli.chip.not_installed':'✗ Non installé',
    'cli.chip.not_logged_in':'✗ Non connecté',
    'task.stop':   'Arrêter',
    'task.retry':  'Réessayer',
    'task.test':   'Test',
    'task.branch': 'Branche',
    'settings.section.theme': 'Thème',
    'settings.section.lang':  'Langue',
    'settings.section.chat':  'Chat',
    'settings.autoTranslate': 'Traduction auto',
    'chat.translating': '🌐 Traduction…',
    'settings.channels': 'Canaux de notification',
    'channel.title': 'Canaux de notification',
    'channel.desc':  'Les canaux enregistrés peuvent être sélectionnés comme cibles de notification.',
    'channel.addSlack':   'Ajouter un canal Slack',
    'channel.addDiscord': 'Ajouter un canal Discord',
    'channel.form.name':    'Nom du canal (ex : #alerts)',
    'channel.form.server':  'Nom du serveur / espace de travail',
    'channel.form.webhook': 'URL Webhook',
    'theme.auto':    'Automatique (OS)',
    'theme.dark':    'Sombre',
    'theme.light':   'Clair',
    'theme.midnight':'Minuit',
    'theme.forest':  'Forêt',
    'theme.sunset':  'Coucher de soleil',
  },
  de: {
    'nav.section.main': 'Menü',
    'nav.section.run':  'Aktionen',
    'nav.projects':     'Projekte',
    'nav.project':      'Aufgaben',
    'view.title.projects': 'Projekte',
    'view.sub.projects':   'Projektliste',
    'project.new':     'Neues Projekt',
    'project.list':    'Projektliste',
    'project.save':    'Projekt erstellen',
    'project.update':  'Speichern',
    'project.modal.title': 'Neues Projekt',
    'project.form.name':   'Projektname',
    'project.form.desc':   'Beschreibung',
    'project.harness':     'Standard-Konfiguration',
    'project.harness.model': 'Modell',
    'project.harness.preset': 'Voreinstellung',
    'project.harness.retry':  'Wiederholung',
    'project.harness.timeout':'Zeitlimit',
    'project.root':           'Projektwurzel',
    'project.root.browse':    '📁 Pfad wählen',
    'project.root.hint':      'Arbeitsverzeichnis für Dateischreibvorgänge und Codeausführung',
    'project.skipPerms':      '▲ Berechtigungen überspringen (Gefahr)',
    'project.skipPerms.chip': '⚠ Berechtig. überspr.',
    'project.skipPerms.desc': 'Claude führt alle Werkzeuge ohne Bestätigung aus.',
    'project.skipPerms.confirm.title': 'Berechtigungen überspringen?',
    'project.skipPerms.confirm.desc':  'Alle Befehle laufen ohne menschliche Bestätigung. Nur in isolierten Umgebungen verwenden.',
    'project.skipPerms.confirm.ok':    'Ich verstehe das Risiko',
    'project.datasource.desc': 'Quelle der Eingabedaten für Aufgaben. Leer lassen für Arbeitsverzeichnis.',
    'project.notify':    'Benachrichtigungen senden',
    'project.autoRun':   'Automatische Ausführung',
    'tool.read':  'Dateien lesen',
    'tool.write': 'Dateien schreiben',
    'tool.bash':  'Code ausführen',
    'project.badge.auto':  'Auto',
    'project.badge.manual':'Manuell',
    'btn.search':          'Suchen',
    'btn.run':             'Ausführen',
    'task.filter.all':     'Alle',
    'task.filter.running': 'Läuft',
    'task.filter.pending': 'Ausstehend',
    'task.filter.done':    'Erledigt',
    'task.filter.error':   'Fehler',
    'task.col.task':       'Aufgabe',
    'task.col.harness':    'Harness',
    'task.col.trigger':    'Auslöser',
    'task.col.status':     'Status',
    'task.stop':           'Stoppen',
    'task.retry':          'Wiederholen',
    'btn.run.all':         'Alle ausführen',
    'nav.log':          'Protokoll',
    'nav.run':          'Alle ausführen',
    'nav.pause':        'Pause',
    'nav.reset':        'Aktualisieren',
    'nav.status':       'Bereit',
    'header.connected': 'Verbunden',
    'header.disconnected': 'Getrennt',
    'view.title.todo':  'Projekte',
    'view.title.log':   'Protokoll',
    'view.sub.todo':    'Aufgaben automatisieren und überwachen',
    'view.sub.log':     'Echtzeit-Ausgabe',
    'btn.stop':         '⏸ Pause',
    'btn.reset':        '↺ Aktualisieren',
    'btn.start':        '▶ Alle ausführen',
    'stat.total':       'Gesamt',
    'stat.done':        'Erledigt',
    'stat.running':     'Läuft',
    'stat.error':       'Fehler',
    'task.list':        'Aufgabenliste',
    'task.add':         'Neue Aufgabe',
    'task.detail':      'Details',
    'task.edit':        'Bearbeiten',
    'task.delete':      'Löschen',
    'task.pending':     'Ausstehend',
    'task.running':     'Läuft',
    'task.done':        'Erledigt',
    'task.error':       'Fehler',
    'log.title':        'Protokoll',
    'log.full':         'Vollständiges Protokoll',
    'log.waiting':      'Bereit',
    'modal.save':       'Speichern',
    'modal.cancel':     'Abbrechen',
    'chat.title':       '🤖 EP4 Assistent',
    'chat.clear':       'Löschen',
    'chat.placeholder': 'Frage eingeben…',
    'chat.send':        'Senden',
    'chat.welcome':     'Hallo! Fragen Sie mich alles über EasyProject4.',
    'settings.theme':   'Design',
    'settings.lang':    'Sprache',
    'settings.reload':  'Seite neu laden',
    'search.placeholder': 'Suchen… /',
    'sp.empty':         'Keine Ergebnisse.',
    'sp.hint':          '<kbd>↑↓</kbd> navigieren &nbsp; <kbd>Enter</kbd> öffnen &nbsp; <kbd>Esc</kbd> schließen',
    'cli.connected':    'Claude CLI verbunden',
    'cli.disconnected': 'Claude CLI getrennt',
    'cli.not_installed':'Claude CLI nicht installiert',
    'cli.switch':            '🔄 Wechseln',
    'cli.logout':            '🚪 Abmelden',
    'cli.login':             '🚀 Anmelden',
    'cli.chip.connected':    '✓ Verbunden',
    'cli.chip.not_installed':'✗ Nicht installiert',
    'cli.chip.not_logged_in':'✗ Nicht angemeldet',
    'task.stop':   'Stoppen',
    'task.retry':  'Wiederholen',
    'task.test':   'Test',
    'task.branch': 'Zweig',
    'settings.section.theme': 'Design',
    'settings.section.lang':  'Sprache',
    'settings.section.chat':  'Chat',
    'settings.autoTranslate': 'Automatisch übersetzen',
    'chat.translating': '🌐 Übersetzen…',
    'settings.channels': 'Benachrichtigungskanäle',
    'channel.title': 'Benachrichtigungskanäle',
    'channel.desc':  'Registrierte Kanäle können als Benachrichtigungsziele ausgewählt werden.',
    'channel.addSlack':   'Slack-Kanal hinzufügen',
    'channel.addDiscord': 'Discord-Kanal hinzufügen',
    'channel.form.name':    'Kanalname (z. B. #alerts)',
    'channel.form.server':  'Server-/Workspace-Name',
    'channel.form.webhook': 'Webhook-URL',
    'theme.auto':    'Automatisch (OS)',
    'theme.dark':    'Dunkel',
    'theme.light':   'Hell',
    'theme.midnight':'Mitternacht',
    'theme.forest':  'Wald',
    'theme.sunset':  'Sonnenuntergang',
  },
  es: {
    'nav.section.main': 'Menú',
    'nav.section.run':  'Acciones',
    'nav.projects':     'Proyectos',
    'nav.project':      'Tareas',
    'view.title.projects': 'Proyectos',
    'view.sub.projects':   'Lista de proyectos',
    'project.new':     'Nuevo Proyecto',
    'project.list':    'Lista de proyectos',
    'project.save':    'Crear proyecto',
    'project.update':  'Guardar cambios',
    'project.modal.title': 'Nuevo Proyecto',
    'project.form.name':   'Nombre del proyecto',
    'project.form.desc':   'Descripción',
    'project.harness':     'Configuración predeterminada',
    'project.harness.model': 'Modelo',
    'project.harness.preset': 'Preajuste',
    'project.harness.retry':  'Reintentos',
    'project.harness.timeout':'Tiempo límite',
    'project.root':           'Raíz del proyecto',
    'project.root.browse':    '📁 Elegir ruta',
    'project.root.hint':      'Directorio de trabajo para escritura de archivos y ejecución de código',
    'project.skipPerms':      '▲ Omitir permisos (Peligro)',
    'project.skipPerms.chip': '⚠ Omitir permisos',
    'project.skipPerms.desc': 'Claude ejecutará todas las herramientas sin confirmación.',
    'project.skipPerms.confirm.title': '¿Omitir permisos?',
    'project.skipPerms.confirm.desc':  'Todos los comandos se ejecutarán sin confirmación humana. Úselo solo en entornos aislados de confianza.',
    'project.skipPerms.confirm.ok':    'Entiendo el riesgo',
    'project.datasource.desc': 'Fuente de datos de entrada para las tareas. Vacío usa el directorio de trabajo.',
    'project.notify':    'Enviar notificaciones',
    'project.autoRun':   'Activar ejecución automática',
    'tool.read':  'Leer archivos',
    'tool.write': 'Escribir archivos',
    'tool.bash':  'Ejecutar código',
    'project.badge.auto':  'Auto',
    'project.badge.manual':'Manual',
    'btn.search':          'Buscar',
    'btn.run':             'Ejecutar',
    'task.filter.all':     'Todo',
    'task.filter.running': 'En ejecución',
    'task.filter.pending': 'Pendiente',
    'task.filter.done':    'Completado',
    'task.filter.error':   'Error',
    'task.col.task':       'Tarea',
    'task.col.harness':    'Harness',
    'task.col.trigger':    'Disparador',
    'task.col.status':     'Estado',
    'task.stop':           'Detener',
    'task.retry':          'Reintentar',
    'btn.run.all':         'Ejecutar todo',
    'nav.log':          'Registro',
    'nav.run':          'Ejecutar todo',
    'nav.pause':        'Pausar',
    'nav.reset':        'Actualizar',
    'nav.status':       'Inactivo',
    'header.connected': 'Conectado',
    'header.disconnected': 'Desconectado',
    'view.title.todo':  'Proyectos',
    'view.title.log':   'Registro',
    'view.sub.todo':    'Automatizar y monitorear tareas',
    'view.sub.log':     'Salida en tiempo real',
    'btn.stop':         '⏸ Pausar',
    'btn.reset':        '↺ Actualizar',
    'btn.start':        '▶ Ejecutar todo',
    'stat.total':       'Total',
    'stat.done':        'Completado',
    'stat.running':     'En ejecución',
    'stat.error':       'Error',
    'task.list':        'Lista de tareas',
    'task.add':         'Nueva tarea',
    'task.detail':      'Detalle',
    'task.edit':        'Editar',
    'task.delete':      'Eliminar',
    'task.pending':     'Pendiente',
    'task.running':     'En ejecución',
    'task.done':        'Completado',
    'task.error':       'Error',
    'log.title':        'Registro',
    'log.full':         'Registro completo',
    'log.waiting':      'Inactivo',
    'modal.save':       'Guardar',
    'modal.cancel':     'Cancelar',
    'chat.title':       '🤖 Asistente EP4',
    'chat.clear':       'Borrar',
    'chat.placeholder': 'Escribe una pregunta…',
    'chat.send':        'Enviar',
    'chat.welcome':     '¡Hola! Pregúntame cualquier cosa sobre EasyProject4.',
    'settings.theme':   'Tema',
    'settings.lang':    'Idioma',
    'settings.reload':  'Recargar página',
    'search.placeholder': 'Buscar… /',
    'sp.empty':         'Sin resultados.',
    'sp.hint':          '<kbd>↑↓</kbd> navegar &nbsp; <kbd>Enter</kbd> abrir &nbsp; <kbd>Esc</kbd> cerrar',
    'cli.connected':    'Claude CLI conectado',
    'cli.disconnected': 'Claude CLI desconectado',
    'cli.not_installed':'Claude CLI no instalado',
    'cli.switch':            '🔄 Cambiar',
    'cli.logout':            '🚪 Cerrar sesión',
    'cli.login':             '🚀 Iniciar sesión',
    'cli.chip.connected':    '✓ Conectado',
    'cli.chip.not_installed':'✗ No instalado',
    'cli.chip.not_logged_in':'✗ No conectado',
    'task.stop':   'Detener',
    'task.retry':  'Reintentar',
    'task.test':   'Prueba',
    'task.branch': 'Rama',
    'settings.section.theme': 'Tema',
    'settings.section.lang':  'Idioma',
    'settings.section.chat':  'Chat',
    'settings.autoTranslate': 'Traducción automática',
    'chat.translating': '🌐 Traduciendo…',
    'settings.channels': 'Canales de notificación',
    'channel.title': 'Canales de notificación',
    'channel.desc':  'Los canales registrados se pueden seleccionar como destinos de notificación.',
    'channel.addSlack':   'Agregar canal de Slack',
    'channel.addDiscord': 'Agregar canal de Discord',
    'channel.form.name':    'Nombre del canal (ej: #alerts)',
    'channel.form.server':  'Nombre del servidor / espacio de trabajo',
    'channel.form.webhook': 'URL de Webhook',
    'theme.auto':    'Automático (OS)',
    'theme.dark':    'Oscuro',
    'theme.light':   'Claro',
    'theme.midnight':'Medianoche',
    'theme.forest':  'Bosque',
    'theme.sunset':  'Atardecer',
  },
};

function t(key) {
  return (_I18N[_curLang] || _I18N.ko)[key] || (_I18N.ko[key] || key);
}

function _applyI18n() {
  // data-i18n → innerHTML
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key) el.innerHTML = t(key);
  });
  // data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });

  // Header status (초기값만)
  const hsTxt = document.getElementById('header-status-text');
  if (hsTxt) hsTxt.textContent = t('header.connected');

  // View title/sub (현재 active view)
  const activeView = document.querySelector('.nav-item.active')?.id?.replace('nav-', '') || 'todo';
  const vTitle = document.getElementById('view-title');
  if (vTitle) vTitle.textContent = t('view.title.' + activeView);
  const vSub = document.getElementById('view-sub');
  if (vSub) vSub.textContent = t('view.sub.' + activeView);

  // Action buttons
  const btnStop  = document.getElementById('btn-stop');
  const btnStart = document.getElementById('btn-start');
  if (btnStop)  btnStop.textContent  = t('btn.stop');
  if (btnStart) btnStart.textContent = t('btn.start');

  // Progress labels
  ['progress-label','progress-label2'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.textContent === '대기 중' || (el && el.textContent === 'Idle') || (el && el.textContent === '空闲')) {
      el.textContent = t('log.waiting');
    }
  });
}

function setLang(lang) {
  document.cookie = `ep4-lang=${lang};path=/;max-age=${365*86400}`;
  location.reload();
}

(function _initLang() {
  try {
    const m = document.cookie.match(/ep4-lang=(\w+)/);
    if (m) _curLang = m[1];
  } catch {}
  window._EP4_LANG = _curLang;
  document.querySelectorAll('.lang-check').forEach(el => {
    el.style.display = el.dataset.lang === _curLang ? '' : 'none';
  });
  document.addEventListener('DOMContentLoaded', _applyI18n);
})();

// ── Auto Translate ─────────────────────────────────────
const _BRANCH_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" style="fill:currentColor;display:inline-block;vertical-align:middle;margin-right:3px;margin-top:-2px;"><path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 0h-3zM5 3a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 0H2.75zm1.5 5.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 0H2.25zM4.25 5.25a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0V6a.75.75 0 01.75-.75zm7.5.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0V6.5a.75.75 0 01.75-.75z"></path></svg>`;
let _autoTranslate = false;

const _LANG_NAMES = {
  ko: '한국어', en: 'English', zh: '中文',
  fr: 'Français', de: 'Deutsch', es: 'Español',
};

// { lang: { originalText: translatedText } }
const _txCache = {};
let _txPending = false;

function _txd(text) {
  if (!_autoTranslate || _curLang === 'ko' || !text) return text;
  return (_txCache[_curLang] && _txCache[_curLang][text]) || text;
}

// ── 알림 채널 ───────────────────────────────────────────
let _channels = [];
let _channelAddType = 'slack';

async function openChannelModal() {
  const modal = document.getElementById('channelModal');
  modal.style.display = 'flex';
  await _loadChannels();
}

function closeChannelModal() {
  document.getElementById('channelModal').style.display = 'none';
}

// ── 접속 정보 (연결된 클라이언트 / EP4 수·발신) ────────────────────────────
const _connKindColor = {
  '내부 호스트': '#4ade80',
  '외부 호스트': '#facc15',
  '외부 EP4':   '#38bdf8',
  '내부 EP4':   '#a78bfa',
};

function _connChip(text, color) {
  return `<span style="font-size:.7rem;color:${color};background:${color}1a;border:1px solid ${color}44;border-radius:8px;padding:1px 8px;white-space:nowrap;">${esc(text)}</span>`;
}

function _connTime(s) { return (s || '').slice(5); }  // 'YYYY-MM-DD HH:MM:SS' → 'MM-DD HH:MM:SS'

let _connTab = 'now';   // 'now' | 'history'

async function openConnectionsModal() {
  const modal = document.getElementById('connectionsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  await _renderConnections();
}

function closeConnectionsModal() {
  const modal = document.getElementById('connectionsModal');
  if (modal) modal.style.display = 'none';
}

function setConnTab(t) {
  _connTab = t;
  _renderConnections();
}

const _connRow = (cells) => `<div style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:.82rem;">${cells}</div>`;
const _connDim = (t) => `<span style="color:var(--text-mute);font-size:.74rem;">${t}</span>`;

async function _renderConnections() {
  const box = document.getElementById('connectionsBody');
  if (!box) return;
  document.querySelectorAll('.conn-tab').forEach(b => b.classList.remove('active'));
  const tabBtn = document.getElementById(`connTab-${_connTab}`);
  if (tabBtn) tabBtn.classList.add('active');
  box.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;">불러오는 중…</div>';
  const html = _connTab === 'history'
    ? await _connHistoryHtml()
    : await _connNowHtml();
  if (html === null) {
    box.innerHTML = '<div style="color:#f87171;font-size:.85rem;">접속 정보를 불러오지 못했습니다.</div>';
    return;
  }
  box.innerHTML = html + `
    <div style="text-align:right;">
      <button class="btn-outline btn-sm" onclick="_renderConnections()">↺ 새로고침</button>
    </div>`;
}

// 현재 접속 탭: 내 접속 + 수신 + 발신 (서버 시작 이후 기준)
async function _connNowHtml() {
  let d;
  try {
    const r = await fetch('/api/connections');
    d = await r.json();
  } catch { return null; }
  const row = _connRow, dim = _connDim;

  let html = `
    <div>
      <div style="font-size:.8rem;font-weight:700;color:var(--text-mute);margin-bottom:6px;">🖥 내 접속</div>
      ${row(`${_connChip(d.me.client || '?', '#4ade80')}
        <span style="font-family:Consolas,monospace;">${esc(d.me.ip || '')}</span>
        <span style="flex:1;"></span>
        ${dim('서버: ' + esc(d.host || ''))}`)}
    </div>`;

  const inb = d.inbound || [];
  html += `<div style="display:flex;flex-direction:column;gap:6px;">
    <div style="font-size:.8rem;font-weight:700;color:var(--text-mute);">📥 수신 연결 ${inb.length}</div>
    ${inb.length ? inb.map(c => {
      const color = _connKindColor[c.kind] || '#94a3b8';
      const idparts = [];
      if (c.hostname) idparts.push(esc(c.hostname));
      if (c.local_ip && c.local_ip !== c.ip) idparts.push(esc(c.local_ip));
      return row(`${_connChip(c.kind, color)}
        ${_connChip(c.client || '?', '#94a3b8')}
        <span style="font-family:Consolas,monospace;">${esc(c.ip)}${c.via ? ` <span style="color:var(--text-dim);">(경유 ${esc(c.via)})</span>` : ''}</span>
        ${idparts.length ? dim(idparts.join(' · ')) : ''}
        <span style="flex:1;"></span>
        ${dim(`${c.count}회 · ${_connTime(c.last)}`)}`);
    }).join('') : row(dim('수신 연결 없음'))}
  </div>`;

  const out = d.outbound || [];
  html += `<div style="display:flex;flex-direction:column;gap:6px;">
    <div style="font-size:.8rem;font-weight:700;color:var(--text-mute);">📤 발신 연결 (다른 EP4) ${out.length}</div>
    ${out.length ? out.map(c => row(`
        <span>${c.ok ? '✅' : '❌'}</span>
        <span style="font-family:Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.url)}</span>
        ${c.host ? _connChip(c.host, '#38bdf8') : ''}
        ${!c.ok && c.error ? `<span style="color:#f87171;font-size:.72rem;overflow:hidden;text-overflow:ellipsis;">${esc(c.error)}</span>` : ''}
        <span style="flex:1;"></span>
        ${dim(`${c.count}회 · ${_connTime(c.last)}`)}`)).join('') : row(dim('발신 연결 없음'))}
  </div>`;
  return html;
}

// 접속 히스토리 탭: 연결 종료·서버 재시작 후에도 보존된 기록
async function _connHistoryHtml() {
  let hist;
  try {
    const hr = await fetch('/api/connections/history?limit=100');
    hist = (await hr.json()).history || [];
  } catch { return null; }
  const row = _connRow, dim = _connDim;
  return `<div style="display:flex;flex-direction:column;gap:6px;">
    <div style="font-size:.8rem;font-weight:700;color:var(--text-mute);">🕓 접속 히스토리 ${hist.length}${hist.length >= 100 ? '+' : ''} <span style="font-weight:400;font-size:.72rem;">(연결 종료·서버 재시작 후에도 보존)</span></div>
    ${hist.length ? hist.map(c => {
      const isOut = c.direction === 'out';
      const color = isOut ? '#38bdf8' : (_connKindColor[c.kind] || '#94a3b8');
      const main = isOut ? esc(c.url) : esc(c.ip);
      const subparts = [];
      if (isOut) {
        if (c.host) subparts.push(esc(c.host));
        if (!c.ok && c.error) subparts.push(esc(c.error));
      } else {
        if (c.hostname) subparts.push(esc(c.hostname));
        if (c.local_ip && c.local_ip !== c.ip) subparts.push(esc(c.local_ip));
      }
      return row(`
        <span title="${isOut ? '발신' : '수신'}">${isOut ? '📤' : '📥'}</span>
        ${_connChip(isOut ? (c.ok ? '발신' : '발신 실패') : c.kind, isOut && !c.ok ? '#f87171' : color)}
        ${!isOut ? _connChip(c.client || '?', '#94a3b8') : ''}
        <span style="font-family:Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${main}</span>
        ${subparts.length ? dim(subparts.join(' · ')) : ''}
        <span style="flex:1;"></span>
        ${dim(`${c.count}회 · ${_connTime(c.first)} ~ ${_connTime(c.last)}`)}`);
    }).join('') : row(dim('히스토리 없음'))}
  </div>`;
}

// ── 다른 EP4 연결(peer) ────────────────────────────────────
async function openPeersModal() {
  const m = document.getElementById('ep4PeersModal');
  if (!m) return;
  m.style.display = 'flex';
  document.getElementById('peerTestResult').textContent = '';
  await loadPeers();
}
function closePeersModal() {
  const m = document.getElementById('ep4PeersModal');
  if (m) m.style.display = 'none';
  fetchProjects();  // 연결 변경 반영 위해 프로젝트 목록 갱신
}
async function loadPeers() {
  const box = document.getElementById('peerList');
  if (!box) return;
  try {
    const d = await (await fetch('/api/peers')).json();
    const peers = d.peers || [];
    if (!peers.length) {
      box.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:14px 0;">연결된 EP4가 없습니다.</div>`;
      return;
    }
    box.innerHTML = peers.map(p => `
      <div style="display:flex;align-items:center;gap:10px;background:var(--bg-soft);border:1px solid var(--border);border-radius:8px;padding:8px 12px;">
        <span style="font-size:.9rem;">🔗</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.84rem;font-weight:600;">${esc(p.name || p.url)}</div>
          <div style="font-size:.74rem;color:var(--text-mute);font-family:'Consolas',monospace;overflow:hidden;text-overflow:ellipsis;">${esc(p.url)}</div>
        </div>
        <button class="cli-btn" onclick="removePeer(${p.id})" title="삭제" style="color:#f87171;">✕</button>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = `<div style="color:var(--red);font-size:.8rem;">목록 로드 실패</div>`;
  }
}
async function testPeer() {
  const url = (document.getElementById('peerUrlInput').value || '').trim();
  const token = (document.getElementById('peerTokenInput').value || '').trim();
  const res = document.getElementById('peerTestResult');
  if (!url) { res.textContent = 'URL을 입력하세요.'; res.style.color = 'var(--text-mute)'; return; }
  res.textContent = '연결 확인 중…'; res.style.color = 'var(--text-mute)';
  try {
    const d = await (await fetch('/api/peers/test', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url, token})})).json();
    if (d.ok) { res.textContent = `✓ 연결됨 · ${d.host || ''}`; res.style.color = 'var(--green,#4ade80)'; }
    else { res.textContent = `✗ 연결 실패: ${d.error || ''}`; res.style.color = '#f87171'; }
  } catch { res.textContent = '✗ 연결 실패'; res.style.color = '#f87171'; }
}
async function addPeer() {
  const url = (document.getElementById('peerUrlInput').value || '').trim();
  const name = (document.getElementById('peerNameInput').value || '').trim();
  const token = (document.getElementById('peerTokenInput').value || '').trim();
  if (!url) return;
  const d = await (await fetch('/api/peers', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url, name, token})})).json();
  if (d.ok) {
    document.getElementById('peerUrlInput').value = '';
    document.getElementById('peerNameInput').value = '';
    document.getElementById('peerTokenInput').value = '';
    document.getElementById('peerTestResult').textContent = '';
    await loadPeers();
  } else {
    await showAlert(d.error || '추가 실패', {type:'error'});
  }
}
async function removePeer(id) {
  if (!await showConfirm('이 EP4 연결을 삭제할까요?', {type:'delete', ok:'삭제'})) return;
  await fetch(`/api/peers/${id}`, {method:'DELETE'});
  await loadPeers();
}

let _chEditId = null;

function openAddChannel(type) {
  _chEditId = null;
  _channelAddType = type;
  const title = document.getElementById('channelAddTitle');
  title.textContent = type === 'slack' ? '🔗 Slack 채널 추가' : '🎮 Discord 채널 추가';
  document.getElementById('chFormName').value = '';
  document.getElementById('chFormWebhook').value = '';
  document.getElementById('chFormWebhook').placeholder =
    type === 'slack' ? 'https://hooks.slack.com/services/...' : 'https://discord.com/api/webhooks/...';
  document.getElementById('channelAddModal').style.display = 'flex';
  setTimeout(() => document.getElementById('chFormName').focus(), 50);
}

function editChannel(id) {
  const ch = _channels.find(c => c.id === id);
  if (!ch) return;
  _chEditId = id;
  _channelAddType = ch.type;
  const title = document.getElementById('channelAddTitle');
  title.textContent = ch.type === 'slack' ? '🔗 Slack 채널 수정' : '🎮 Discord 채널 수정';
  document.getElementById('chFormName').value = ch.name;
  document.getElementById('chFormWebhook').value = ch.webhook_url;
  document.getElementById('chFormWebhook').placeholder =
    ch.type === 'slack' ? 'https://hooks.slack.com/services/...' : 'https://discord.com/api/webhooks/...';
  document.getElementById('channelAddModal').style.display = 'flex';
  setTimeout(() => document.getElementById('chFormName').focus(), 50);
}

function closeAddChannel() {
  document.getElementById('channelAddModal').style.display = 'none';
  _chEditId = null;
}

async function saveChannel() {
  const name    = document.getElementById('chFormName').value.trim();
  const server  = '';
  const webhook = document.getElementById('chFormWebhook').value.trim();
  if (!name || !webhook) { await showAlert('채널 이름과 Webhook URL은 필수입니다.', {type:'warning'}); return; }
  const btn = document.getElementById('chFormSave');
  btn.disabled = true;
  try {
    let r;
    if (_chEditId) {
      r = await fetch(`/api/channels/${_chEditId}/update`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, webhook_url: webhook, server_name: server}),
      });
    } else {
      r = await fetch('/api/channels', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({type: _channelAddType, name, webhook_url: webhook, server_name: server}),
      });
    }
    const d = await r.json();
    if (d.ok) { closeAddChannel(); await _loadChannels(); }
    else await showAlert(d.error || '저장 실패', {type:'error'});
  } catch { await showAlert('서버 오류', {type:'error'}); }
  btn.disabled = false;
}

async function deleteChannel(id) {
  if (!await showConfirm('채널을 삭제할까요?', {type:'delete', ok:'삭제'})) return;
  await fetch(`/api/channels/${id}/delete`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  await _loadChannels();
}

async function toggleChannel(id) {
  await fetch(`/api/channels/${id}/toggle`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  await _loadChannels();
}

async function testChannel(id) {
  const ch = _channels.find(c => c.id === id);
  if (!ch) return;
  if (!ch.tested) {
    if (!await showConfirm(`"${ch.name}" 채널로 테스트 알림을 전송할까요?\n성공 시 채널이 자동으로 활성화됩니다.`, {type:'confirm', ok:'테스트 전송'})) return;
  }
  try {
    const r = await fetch(`/api/channels/${id}/test`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    const d = await r.json();
    if (d.ok) {
      await showAlert(d.message || '테스트 성공!', {type:'success'});
      await _loadChannels();
    } else {
      await showAlert('테스트 실패: ' + (d.error || '알 수 없는 오류'), {type:'error'});
    }
  } catch { await showAlert('서버 오류', {type:'error'}); }
}

async function _loadChannels() {
  try {
    const r = await fetch('/api/channels');
    _channels = await r.json();
    _renderChannels();
  } catch {}
}

async function setDefaultChannel(id) {
  try {
    await fetch(`/api/channels/${id}/set-default`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    await _loadChannels();
  } catch { await showAlert('서버 오류', {type:'error'}); }
}

function _renderChannels() {
  const ul = document.getElementById('channelList');
  if (!ul) return;
  if (!_channels.length) {
    ul.innerHTML = `<li style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:16px 0;">등록된 채널이 없습니다.</li>`;
    return;
  }
  ul.innerHTML = _channels.map(ch => `
    <li style="display:flex;align-items:center;gap:12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
      <span style="font-size:1.4rem;flex-shrink:0;">${ch.type === 'slack' ? '🔗' : '🎮'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ch.name)}
          ${ch.effective_default ? '<span style="font-size:0.68rem;color:#facc15;background:#facc1518;border:1px solid #facc1544;border-radius:8px;padding:1px 7px;margin-left:6px;vertical-align:1px;">★ 기본</span>' : ''}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${ch.type === 'slack' ? 'Slack' : 'Discord'}${ch.server_name ? ' · ' + esc(ch.server_name) : ''}</div>
      </div>
      <button onclick="setDefaultChannel(${ch.id})" title="${ch.effective_default ? '기본 채널' : '기본 채널로 설정'}"
        style="background:none;border:none;cursor:pointer;font-size:1rem;padding:2px 4px;color:${ch.effective_default ? '#facc15' : 'var(--text-muted)'};">
        ${ch.effective_default ? '★' : '☆'}
      </button>
      <button onclick="testChannel(${ch.id})" title="${ch.tested ? '테스트 완료 (재테스트)' : '테스트 필요'}"
        style="background:none;border:none;cursor:pointer;font-size:0.8rem;padding:2px 6px;border-radius:6px;border:1px solid ${ch.tested ? '#4ade8055' : '#f59e0b55'};color:${ch.tested ? '#4ade80' : '#f59e0b'};">
        ${ch.tested ? '✓ 테스트' : '🧪 테스트'}
      </button>
      <button onclick="toggleChannel(${ch.id})" title="${ch.active ? '비활성화' : '활성화'}"
        style="background:none;border:none;cursor:pointer;font-size:1rem;padding:2px 4px;">
        <span style="color:${ch.active ? '#4ade80' : 'var(--text-muted)'}">${ch.active ? '●' : '○'}</span>
      </button>
      <button onclick="editChannel(${ch.id})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.85rem;padding:2px 4px;" title="수정">✏</button>
      <button onclick="deleteChannel(${ch.id})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.95rem;padding:2px 4px;" title="삭제">🗑</button>
    </li>`).join('');
}

// ── 실행 로그 뷰 ──────────────────────────────────────────
let _rlStatus = '';
let _rlRuns = [];
let _currentRunId = null;
let _currentRunTaskId = null;
let _currentRunProjectId = null;
let _currentTraceId = null;
let _currentRunSessionId = null;
let _rlTab = 'log';

function _fmtDur(sec) {
  if (sec == null) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function _fmtTime(iso) {
  if (!iso) return '';
  try { return iso.slice(11, 16); } catch { return ''; }
}
function _trigLabel(v) {
  const key = {manual:'trig.manual', schedule:'trig.schedule', auto:'trig.auto'}[v];
  return key ? t(key) : (v || '');
}

async function loadRuns() {
  const pid = document.getElementById('rl-proj-sel')?.value || '';
  const date = document.getElementById('rl-date-sel')?.value || '';
  let url = '/api/runs?';
  if (pid) url += 'project_id=' + pid + '&';
  if (_rlStatus) url += 'status=' + _rlStatus + '&';
  if (date) url += 'date=' + date;
  try {
    const r = await fetch(apiUrl(url));
    _rlRuns = await r.json();
  } catch { _rlRuns = []; }
  _renderRlRows();
  _populateRlProjectSel();
}

function _populateRlProjectSel() {
  const sel = document.getElementById('rl-proj-sel');
  if (!sel) return;
  const cur = sel.value;
  const seen = new Set();
  const opts = [`<option value="">${t('rl.all_projects')}</option>`];
  _rlRuns.forEach(r => {
    if (!seen.has(r.project_id)) {
      seen.add(r.project_id);
      opts.push(`<option value="${r.project_id}" ${cur==r.project_id?'selected':''}>${esc(r.project_name)}</option>`);
    }
  });
  projects.forEach(p => {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      opts.push(`<option value="${p.id}" ${cur==p.id?'selected':''}>${esc(p.name)}</option>`);
    }
  });
  sel.innerHTML = opts.join('');
}

function setRlStatus(el, status) {
  _rlStatus = status;
  document.querySelectorAll('.rl-chip').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  loadRuns();
}

let _rlSelectMode = false;
let _rlSelected = new Set();

function toggleRlSelectMode() {
  _rlSelectMode = !_rlSelectMode;
  _rlSelected.clear();
  const bar = document.getElementById('rl-sel-bar');
  const btn = document.getElementById('rl-sel-toggle');
  if (bar) bar.classList.toggle('active', _rlSelectMode);
  if (btn) btn.textContent = _rlSelectMode ? t('rl.select_cancel') : t('rl.select_toggle');
  _renderRlRows();
}

function toggleRlSelectAll(checked) {
  if (checked) _rlRuns.forEach(r => _rlSelected.add(r.id));
  else _rlSelected.clear();
  _updateRlSelCount();
  _renderRlRows();
}

function _updateRlSelCount() {
  const el = document.getElementById('rl-sel-count');
  if (el) el.textContent = `${_rlSelected.size}${t('rl.selected_suffix')}`;
  const all = document.getElementById('rl-sel-all');
  if (all) all.checked = _rlRuns.length > 0 && _rlSelected.size === _rlRuns.length;
}

function toggleRlRow(id, e) {
  e.stopPropagation();
  if (_rlSelected.has(id)) _rlSelected.delete(id);
  else _rlSelected.add(id);
  _updateRlSelCount();
  _renderRlRows();
}

async function deleteSelectedRuns() {
  if (!_rlSelected.size) { await showAlert(t('rl.delete_warn'), {type:'warning'}); return; }
  const _rlDelMsg = _curLang === 'ko'
    ? `선택한 ${_rlSelected.size}개의 로그를 삭제할까요?\n삭제 후 복구할 수 없습니다.`
    : `Delete ${_rlSelected.size} selected log(s)?\nThis cannot be undone.`;
  const ok = await showConfirm(_rlDelMsg, {title: t('rl.delete_title'), ok: t('rl.delete_ok'), cancel: t('modal.cancel'), type:'delete'});
  if (!ok) return;
  await fetch(apiUrl('/api/runs/bulk-delete'), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ids: [..._rlSelected]})
  });
  _rlSelected.clear();
  _rlSelectMode = false;
  const bar = document.getElementById('rl-sel-bar');
  const btn = document.getElementById('rl-sel-toggle');
  if (bar) bar.classList.remove('active');
  if (btn) btn.textContent = t('rl.select_toggle');
  await loadRuns();
}

function _renderRlRows() {
  const box = document.getElementById('rl-rows');
  if (!box) return;
  const q = _rlSearch;
  const filtered = q
    ? _rlRuns.filter(r =>
        r.task_title.toLowerCase().includes(q.toLowerCase()) ||
        r.project_name.toLowerCase().includes(q.toLowerCase()))
    : _rlRuns;
  if (!filtered.length) {
    box.innerHTML = `<div class="rl-empty">${q ? t('rl.no_results') : t('rl.no_runs')}</div>`;
    return;
  }
  box.innerHTML = filtered.map(run => {
    const isErr = run.status === 'error';
    const isSel = _rlSelected.has(run.id);
    const dotCls = {running:'running', done:'done', error:'error'}[run.status] || 'done';
    const _rlStatusKey = {running:'rl.status.running', done:'rl.status.done', error:'rl.status.error'}[run.status];
    const badgeTxt = _rlStatusKey ? t(_rlStatusKey) : run.status;
    const dur = run.duration_sec != null ? _fmtDur(run.duration_sec) : (run.status === 'running' ? '…' : '');
    const chk = _rlSelectMode
      ? `<input type="checkbox" class="rl-row-check" ${isSel?'checked':''} onclick="toggleRlRow(${run.id},event)">`
      : `<span class="rl-dot ${dotCls}">●</span>`;
    const click = _rlSelectMode ? `onclick="toggleRlRow(${run.id},event)"` : `onclick="openRun(${run.id})"`;
    return `<div class="rl-row${isErr?' rl-error':''}${isSel?' rl-selected':''}" ${click}>
      ${chk}
      <span class="rl-time">${_fmtTime(run.started_at)}</span>
      <div class="rl-info">
        <div class="rl-title">${_hlText(run.task_title, q)}</div>
        <div class="rl-sub${isErr?' error':''}">${_hlText(run.project_name, q)} · ${_trigLabel(run.trigger_type)}</div>
      </div>
      <span class="rl-badge ${run.status}">${badgeTxt}</span>
      <span class="rl-dur">${dur}</span>
      ${_rlSelectMode ? '' : '<span class="rl-chevron">›</span>'}
    </div>`;
  }).join('');
}

async function openRun(id) {
  try {
    const r = await fetch(apiUrl(`/api/runs/${id}`));
    if (!r.ok) return;
    const run = await r.json();
    _currentRunId = run.id;
    _currentRunTaskId = run.task_id;
    _currentRunProjectId = run.project_id;

    document.getElementById('rl-list').style.display = 'none';
    document.getElementById('rl-trace').style.display = 'none';
    const det = document.getElementById('rl-detail');
    det.style.display = 'flex';

    document.getElementById('rl-d-project').textContent = run.project_name;
    document.getElementById('rl-d-title').textContent = run.task_title;
    const dot = document.getElementById('rl-d-dot');
    dot.className = 'rl-dot ' + (run.status === 'error' ? 'error' : run.status === 'running' ? 'running' : 'done');
    const badge = document.getElementById('rl-d-badge');
    badge.className = 'rl-badge ' + run.status;
    const _sk = {running:'rl.status.running', done:'rl.status.done', error:'rl.status.error'}[run.status];
    badge.textContent = _sk ? t(_sk) : run.status;
    document.getElementById('rl-d-model').textContent = run.model || '-';
    document.getElementById('rl-d-start').textContent = _fmtTime(run.started_at);
    document.getElementById('rl-d-dur').textContent = run.duration_sec != null ? t('rl.elapsed').replace('{0}', _fmtDur(run.duration_sec)) : (run.status === 'running' ? t('rl.running_dots') : '-');
    document.getElementById('rl-d-retry').textContent = t('run.retry_count');

    // Claude 세션 ID
    const sessWrap = document.getElementById('rl-d-session-wrap');
    if (sessWrap) {
      if (run.claude_session_id) {
        _currentRunSessionId = run.claude_session_id;
        document.getElementById('rl-d-session').textContent = run.claude_session_id.slice(0, 8) + '…';
        sessWrap.style.display = '';
        sessWrap.title = run.claude_session_id;
      } else {
        _currentRunSessionId = null;
        sessWrap.style.display = 'none';
      }
    }

    // Trace 바
    const traceBar = document.getElementById('rl-d-trace-bar');
    if (run.trace_id) {
      _currentTraceId = run.trace_id;
      traceBar.style.display = 'flex';
      document.getElementById('rl-d-trace-id').textContent = run.trace_id;
      const spanShort = (run.span_id || '').slice(0, 4);
      const parentShort = (run.parent_span_id || '').slice(0, 4);
      const spanInfo = `span <code style="color:#79c0ff">${spanShort || '—'}</code>` +
        (parentShort ? ` · parent <code style="color:#6e7681">${parentShort}</code>` : ' · root');
      document.getElementById('rl-d-span-info').innerHTML = spanInfo;
    } else {
      _currentTraceId = null;
      traceBar.style.display = 'none';
    }

    const _atkSk = {running:'rl.status.running', done:'rl.status.done', error:'rl.status.error'}[run.status];
    document.getElementById('rl-d-attempts').innerHTML =
      `<button class="rl-attempt-chip active">#1 ${_atkSk ? t(_atkSk) : run.status} · ${_fmtTime(run.started_at)}</button>`;

    _renderRlConsole(run.log_lines || [], run.status === 'running');
    document.getElementById('rl-tab-input').textContent = run.prompt || t('rl.no_prompt');
    document.getElementById('rl-tab-output').textContent = run.output || t('rl.no_output');

    // Git 탭
    const gitBtn = document.getElementById('rl-tab-git-btn');
    const hasGit = run.git_task_branch && run.git_merge_status !== 'no_git';
    if (gitBtn) gitBtn.style.display = hasGit ? '' : 'none';
    if (hasGit) _renderGitTab(run);

    // 스크린샷 탭
    const shotBtn = document.getElementById('rl-tab-shot-btn');
    const shotBox = document.getElementById('rl-tab-shot');
    if (run.screenshot) {
      if (shotBtn) shotBtn.style.display = '';
      const _purl = run.preview_url || '';
      const _urlRow = _purl
        ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;background:var(--bg2);border-radius:6px;border:1px solid var(--border);">
             <span style="font-size:0.75rem;color:var(--text-mute);white-space:nowrap;">URL</span>
             <a href="${_purl}" target="_blank" style="color:var(--accent);font-size:0.85rem;word-break:break-all;">${_purl}</a>
           </div>`
        : '';
      if (shotBox) shotBox.innerHTML =
        `<div style="padding:12px;">
           ${_urlRow}
           <div style="font-size:0.75rem;color:var(--text-mute);margin-bottom:8px;">${t('rl.screenshot_caption')} · <a href="${run.screenshot}" target="_blank" style="color:var(--accent);">${t('rl.screenshot_open')}</a></div>
           <a href="${run.screenshot}" target="_blank">
             <img src="${run.screenshot}" style="max-width:100%;border:1px solid var(--border);border-radius:8px;display:block;" alt="${t('rl.screenshot_alt')}">
           </a>
         </div>`;
    } else {
      if (shotBtn) shotBtn.style.display = 'none';
      if (shotBox) shotBox.innerHTML = '';
    }

    // 클로드 세션 탭
    const claudeBtn = document.getElementById('rl-tab-claude-btn');
    const hasClaude = run.claude_session && (run.claude_session.messages || []).length;
    if (claudeBtn) claudeBtn.style.display = hasClaude ? '' : 'none';
    if (hasClaude) _renderRlClaudeTab(run.claude_session);

    // 안티그래비티 세션 탭
    const agBtn = document.getElementById('rl-tab-ag-btn');
    const agSes = run.antigravity_session;
    const hasAg = agSes && ((agSes.inputs || []).length || (agSes.steps || []).length);
    if (agBtn) agBtn.style.display = hasAg ? '' : 'none';
    if (hasAg) _renderRlAgTab(agSes);

    switchRlTab('log');
  } catch(e) { console.error(e); }
}

function closeRun() {
  _currentRunId = null;
  _currentRunTaskId = null;
  _currentRunProjectId = null;
  _currentTraceId = null;
  document.getElementById('rl-detail').style.display = 'none';
  document.getElementById('rl-list').style.display = 'flex';
  loadRuns();
}

async function rerunCurrentTask() {
  if (!_currentRunTaskId || !_currentRunProjectId) return;
  try {
    const r = await fetch(`/api/projects/${_currentRunProjectId}/tasks/${_currentRunTaskId}/run`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'
    });
    const d = await r.json();
    if (!d.ok) { await showAlert(d.msg || t('run.run_failed')); return; }
    closeRun();
  } catch(e) { await showAlert(t('run.rerun_error')); }
}

function copyTraceId() {
  if (_currentTraceId) {
    navigator.clipboard.writeText(_currentTraceId).catch(() => {});
  }
}

function copyRunSessionId() {
  if (_currentRunSessionId) {
    navigator.clipboard.writeText(_currentRunSessionId)
      .then(() => showAlert(t('run.session_copied'), {type:'info'}))
      .catch(() => {});
  }
}

async function openTrace(traceId) {
  if (!traceId) return;
  _currentTraceId = traceId;
  try {
    const r = await fetch(apiUrl(`/api/runs/trace/${traceId}`));
    if (!r.ok) return;
    const runs = await r.json();
    document.getElementById('rl-list').style.display = 'none';
    document.getElementById('rl-detail').style.display = 'none';
    const tv = document.getElementById('rl-trace');
    tv.style.display = 'flex';
    document.getElementById('rl-trace-id-display').textContent = traceId;
    _renderTraceView(runs);
  } catch(e) { console.error(e); }
}

function closeTrace() {
  document.getElementById('rl-trace').style.display = 'none';
  _currentTraceId = null;
  document.getElementById('rl-list').style.display = 'flex';
  loadRuns();
}

function searchByTrace(traceId) {
  const val = (traceId || document.getElementById('rl-trace-search')?.value || '').trim();
  if (val) openTrace(val);
}

function _renderTraceView(runs) {
  const box = document.getElementById('rl-trace-runs');
  if (!box) return;
  if (!runs.length) {
    box.innerHTML = `<div class="rl-empty">${t('rl.no_trace')}</div>`;
    return;
  }
  // span_id → children 맵 구성
  const spanMap = {};
  runs.forEach(r => { spanMap[r.span_id] = r; });
  const childMap = {};
  runs.forEach(r => {
    if (r.parent_span_id && spanMap[r.parent_span_id]) {
      (childMap[r.parent_span_id] = childMap[r.parent_span_id] || []).push(r);
    }
  });
  const roots = runs.filter(r => !r.parent_span_id || !spanMap[r.parent_span_id]);

  function renderRun(run, level) {
    const isErr = run.status === 'error';
    const dotCls = run.status === 'error' ? 'error' : run.status === 'running' ? 'running' : 'done';
    const _bsk = {running:'rl.status.running', done:'rl.status.done', error:'rl.status.error'}[run.status];
    const badgeTxt = _bsk ? t(_bsk) : run.status;
    const dur = run.duration_sec != null ? _fmtDur(run.duration_sec) : '';
    const spanShort = (run.span_id || '').slice(0, 4);
    const parentShort = (run.parent_span_id || '').slice(0, 4);
    const indent = level > 0 ? `margin-left:${level * 24}px;` : '';
    const meta = `span <code style="color:#79c0ff;font-size:.72rem">${spanShort}</code>` +
      (parentShort ? ` · parent <code style="color:#6e7681;font-size:.72rem">${parentShort}</code>` : ' · <span style="color:#4ade80;font-size:.72rem">root</span>');
    let html = `<div class="rl-trace-run${isErr?' rl-error':''}" style="${indent}" onclick="openRun(${run.id})">
      <span class="rl-dot ${dotCls}">●</span>
      <div class="rl-info">
        <div class="rl-title">${esc(run.task_title)}</div>
        <div class="rl-sub" style="font-size:.73rem;">${meta}</div>
      </div>
      <span class="rl-badge ${run.status}">${badgeTxt}</span>
      <span class="rl-dur">${dur}</span>
      <span class="rl-chevron">›</span>
    </div>`;
    (childMap[run.span_id] || []).forEach(child => { html += renderRun(child, level + 1); });
    return html;
  }

  box.innerHTML = roots.map(r => renderRun(r, 0)).join('');
}

function switchRlTab(tab) {
  _rlTab = tab;
  ['log','input','output','git','shot','claude','ag'].forEach(t => {
    const el = document.getElementById('rl-tab-' + t);
    if (el) el.style.display = t === tab ? (['log','claude','shot','ag'].includes(t) ? 'block' : 'flex') : 'none';
  });
  document.querySelectorAll('.rl-tab').forEach(btn => {
    const t = btn.getAttribute('onclick')?.match(/'(\w+)'/)?.[1];
    btn.classList.toggle('active', t === tab);
  });
}

// ── 클로드 세션 탭 (세션 상세와 동일 형식) ──────────────────
function _rlFmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function _rlFmtSessDuration(firstTs, lastTs) {
  if (!firstTs || !lastTs) return '';
  const a = new Date(firstTs).getTime();
  const b = new Date(lastTs).getTime();
  if (!a || !b || b < a) return '';
  const sec = Math.round((b - a) / 1000);
  if (sec < 60) return t('dur.sec').replace('{0}', sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return t('dur.min').replace('{0}', min);
  const h = Math.floor(min / 60);
  return t('dur.h').replace('{0}', h).replace('{1}', min % 60);
}

function _rlModelShort(m) {
  return (m || '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

function _renderRlClaudeTab(s) {
  const box = document.getElementById('rl-tab-claude');
  if (!box) return;
  box.innerHTML = _renderRlClaudeSummary(s) + _renderRlClaudeMessages(s);
}

function _renderRlAgTab(ses) {
  const box = document.getElementById('rl-tab-ag');
  if (!box) return;
  const inputs = ses.inputs || [];
  const steps = ses.steps || [];
  let html = `<div style="padding:12px 14px;">`;
  html += `<div style="font-size:0.8rem;color:var(--text-mute);margin-bottom:10px;">🪐 ${esc(ses.session_id || '')}</div>`;
  if (inputs.length) {
    html += `<div style="font-weight:700;font-size:.85rem;margin:4px 0 8px;">입력</div>`;
    html += inputs.map(txt =>
      `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:6px;white-space:pre-wrap;font-size:.85rem;">${esc(txt)}</div>`
    ).join('');
  }
  if (steps.length) {
    html += `<div style="font-weight:700;font-size:.85rem;margin:14px 0 8px;">실행 과정</div>`;
    html += `<ol style="margin:0;padding-left:22px;font-size:.85rem;line-height:1.7;color:var(--text);">`
          + steps.map(x => `<li>${esc(x)}</li>`).join('') + `</ol>`;
  }
  if (!inputs.length && !steps.length) {
    html += `<div style="color:var(--text-dim);font-size:.85rem;">세션 내용이 없습니다.</div>`;
  }
  html += `</div>`;
  box.innerHTML = html;
}

function _renderRlClaudeSummary(s) {
  const model = esc(_rlModelShort(s.model)) || '-';
  const ago = s.last_ts ? _timeAgo(s.last_ts) : '-';
  const dur = _rlFmtSessDuration(s.first_ts, s.last_ts);
  const _turnsFmt = t('claude.turns_fmt').replace('{0}', s.msg_count||0).replace('{1}', s.user_count||0).replace('{2}', s.assistant_count||0);
  const stats = [
    { label: t('claude.messages'), val: _turnsFmt },
    { label: t('claude.tool_calls'), val: String(s.tool_count || 0) },
    { label: t('claude.tokens'), val: `${_rlFmtTokens(s.total_tokens)} (↓ ${_rlFmtTokens(s.input_tokens)} / ↑ ${_rlFmtTokens(s.output_tokens)} / ⚡ ${_rlFmtTokens(s.cache_tokens)})` },
    { label: t('claude.errors'), val: String(s.error_count || 0) },
  ];
  return `
    <div class="claude-sess-field"><div class="claude-sess-label">${t('claude.session_id')}</div><div class="claude-sess-value" style="font-family:'Consolas',monospace;display:flex;align-items:center;gap:8px;">
      <span>${esc(s.session_id || '')}</span>
      <button class="rl-copy-btn" onclick="copyRunSessionId()" title="${t('claude.session_id')}">⧉</button>
    </div></div>
    <div class="claude-sess-field"><div class="claude-sess-label">${t('claude.model')}</div><div class="claude-sess-value">${model}</div></div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;">
      ${stats.map(st => `<div class="claude-sess-stat"><div class="claude-sess-label">${st.label}</div><div class="claude-sess-value">${st.val}</div></div>`).join('')}
    </div>
    <div class="claude-sess-field"><div class="claude-sess-label">${t('claude.last_active')}</div><div class="claude-sess-value">${ago}${dur ? ` · ${t('claude.duration_suffix').replace('{0}', dur)}` : ''}</div></div>
    ${s.first_prompt ? `<div class="claude-sess-field"><div class="claude-sess-label">${t('claude.first_message')}</div><div class="claude-sess-value">${esc(s.first_prompt)}</div></div>` : ''}
  `;
}

function _renderRlClaudeMessages(d) {
  const msgs = d.messages || [];
  if (!msgs.length) return `<div style="color:var(--text-dim);font-size:.8rem;">${t('claude.no_messages')}</div>`;
  const cwdLine = d.cwd ? `<div class="claude-sess-label" style="margin-bottom:8px;">${t('claude.working_path')}<span style="font-family:'Consolas',monospace;color:var(--text-mute);">${esc(d.cwd)}</span></div>` : '';
  const trunc = d.truncated ? `<div style="color:var(--text-dim);font-size:.75rem;margin-bottom:8px;">${t('claude.truncated').replace('{0}', msgs.length)}</div>` : '';
  const head = `<div class="claude-sess-label" style="margin-bottom:8px;border-top:1px solid var(--border);padding-top:14px;">${t('claude.conversation').replace('{0}', msgs.length)}</div>`;
  const body = msgs.map(m => {
    const isUser = m.role === 'user';
    const ts = m.ts ? _timeAgo(m.ts) : '';
    return `<div class="claude-msg ${isUser ? 'user' : 'assistant'}">
      <div class="claude-msg-head">
        <span class="claude-msg-role">${isUser ? t('claude.user_label') : '🤖 Claude'}</span>
        ${ts ? `<span class="claude-msg-ts">${ts}</span>` : ''}
      </div>
      <div class="claude-msg-body">${esc(m.text)}</div>
    </div>`;
  }).join('');
  return cwdLine + trunc + head + body;
}

function _renderRlConsole(entries, isRunning) {
  const box = document.getElementById('rl-tab-log');
  if (!box) return;
  if (!entries.length) {
    box.innerHTML = isRunning ? '<span class="rl-cursor"></span>' : `<span style="color:#6e7681">${t('rl.no_log')}</span>`;
    return;
  }
  const lines = entries.map(e => {
    const lvl = e.level || 'INFO';
    const isEnd = e.msg && e.msg.startsWith('—');
    if (isEnd) return `<span class="rl-log-end">${esc(e.msg)}</span>`;
    const spanShort = e.span_id ? e.span_id.slice(0, 4) : '    ';
    return `<span class="rl-log-ts">${esc(e.ts)}</span> <span style="color:#444c56">${spanShort}</span> <span class="rl-log-${lvl}">${lvl.padEnd(5)}</span> ${esc(e.msg)}`;
  });
  if (isRunning) lines.push('<span class="rl-cursor"></span>');
  box.innerHTML = lines.join('\n');
  box.scrollTop = box.scrollHeight;
}

function _renderGitTab(run) {
  const box = document.getElementById('rl-tab-git');
  if (!box) return;

  const _gitStatusKey = {
    merged:'rl.git.merged', conflict:'rl.git.conflict', pending:'rl.git.pending',
    no_changes:'rl.git.no_changes', task_failed:'rl.git.task_failed',
    wt_error:'rl.git.wt_error', no_git:'rl.git.no_git',
  }[run.git_merge_status];
  const statusLabel = _gitStatusKey ? t(_gitStatusKey) : (run.git_merge_status || '');

  const statusCls = run.git_merge_status || 'no_git';

  // 브랜치 흐름 카드
  let html = `<div class="rl-git-flow">
    <span class="rl-git-branch"><span>${_BRANCH_SVG}</span>${esc(run.git_task_branch)}</span>
    <span class="rl-git-arrow">→</span>
    <span class="rl-git-branch"><span>${_BRANCH_SVG}</span>${esc(run.git_proj_branch)}</span>
    <span class="rl-git-status ${statusCls}">${statusLabel}</span>
  </div>`;

  // PR/MR 링크
  if (run.git_pr_url) {
    const prLabel = run.git_pr_url.includes('github.com') ? t('rl.git.pr_label') : t('rl.git.mr_label');
    html += `<div class="rl-git-mr" onclick="_toggleGitPatch(${run.id})" style="cursor:pointer;">
      <div class="rl-git-mr-icon">${_BRANCH_SVG}</div>
      <div class="rl-git-mr-info">
        <div class="rl-git-mr-title">${prLabel} — ${esc(run.task_title)}</div>
        <div class="rl-git-mr-url">${esc(run.git_pr_url)}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="btn-outline btn-sm" id="gp-toggle-btn-${run.id}" style="padding:3px 9px;font-size:.78rem;" onclick="event.stopPropagation();_toggleGitPatch(${run.id})">${t('rl.git.code_view')}</button>
        <a href="${esc(run.git_pr_url)}" target="_blank" onclick="event.stopPropagation()" style="color:#8b949e;font-size:.9rem;text-decoration:none;">↗</a>
      </div>
    </div>
    <div id="gp-patch-${run.id}" class="rl-git-patch" style="display:none;"></div>`;
  }

  // 커밋 목록
  const commits = run.git_commits || [];
  if (commits.length) {
    const hasPrRow = !!run.git_pr_url;
    html += `<div class="rl-git-commits">
      <div class="rl-git-commits-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span>${t('rl.git.commits').replace('{0}', commits.length)}</span>
        ${!hasPrRow ? `<button class="btn-outline btn-sm" id="gp-toggle-btn-${run.id}" style="padding:3px 9px;font-size:.78rem;" onclick="_toggleGitPatch(${run.id})">${t('rl.git.code_view')}</button>` : ''}
      </div>
      ${commits.map(c => `<div class="rl-git-commit">
        <code>${esc(c.hash)}</code>
        <span style="flex:1">${esc(c.msg)}</span>
      </div>`).join('')}
    </div>
    ${!hasPrRow ? `<div id="gp-patch-${run.id}" class="rl-git-patch" style="display:none;"></div>` : ''}`;
  }

  // 변경 파일 목록
  const diff = run.git_diff || [];
  if (diff.length) {
    const totalAdd = diff.reduce((s, f) => s + (f.added || 0), 0);
    const totalDel = diff.reduce((s, f) => s + (f.removed || 0), 0);
    html += `<div class="rl-git-files">
      <div class="rl-git-files-head">${t('rl.git.files').replace('{0}', diff.length)}</div>
      ${diff.map(f => `<div class="rl-git-file">
        <span style="color:#8b949e;font-size:.78rem;">📄</span>
        <span class="rl-git-fname">${esc(f.file)}</span>
        <span class="rl-git-add">+${f.added}</span>
        <span class="rl-git-del">-${f.removed}</span>
      </div>`).join('')}
    </div>
    <div class="rl-git-foot">
      <span>${t('rl.git.summary').replace('{0}',diff.length).replace('{1}',totalAdd).replace('{2}',totalDel).replace('{3}',commits.length)}</span>
      <span>${_BRANCH_SVG}${esc(run.git_proj_branch)} · ${t('rl.git.no_main')}</span>
    </div>`;
  }

  if (!commits.length && !diff.length && run.git_merge_status !== 'merged') {
    html += `<div class="rl-empty" style="padding:32px;">${t('rl.git.no_changes_detail')}</div>`;
  }

  box.innerHTML = html;
}

// ── Git patch 뷰어 ──────────────────────────────────────
const _gpCache = {};

async function _toggleGitPatch(runId) {
  const panel = document.getElementById(`gp-patch-${runId}`);
  const btn   = document.getElementById(`gp-toggle-btn-${runId}`);
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    if (btn) btn.textContent = '코드 보기';
    return;
  }

  if (_gpCache[runId]) {
    panel.innerHTML = _gpCache[runId];
    panel.style.display = 'block';
    if (btn) btn.textContent = '코드 접기';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:.82rem;">불러오는 중...</div>';
  if (btn) btn.textContent = '코드 접기';

  try {
    const r = await fetch(apiUrl(`/api/runs/${runId}/git-patch`));
    const d = await r.json();
    if (!d.ok || !d.patch) {
      panel.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:.82rem;">코드 변경 내역이 없습니다.</div>';
      return;
    }
    const rendered = _renderPatch(d.patch);
    _gpCache[runId] = rendered;
    panel.innerHTML = rendered;
  } catch (e) {
    panel.innerHTML = `<div style="padding:16px;color:#f87171;font-size:.82rem;">오류: ${esc(e.message)}</div>`;
  }
}

function _renderPatch(patch) {
  const lines = patch.split('\n');
  let html = '<div class="gp-file-list">';
  let inFile = false;

  for (const raw of lines) {
    const line = raw;
    if (line.startsWith('diff --git ')) {
      if (inFile) html += '</div>';
      const fname = line.replace(/^diff --git a\/\S+ b\//, '');
      html += `<div class="gp-file-header">${esc(fname)}</div><div class="gp-hunk">`;
      inFile = true;
    } else if (line.startsWith('@@')) {
      html += `<div class="gp-line gp-hunk-head">${esc(line)}</div>`;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      html += `<div class="gp-line gp-add"><span class="gp-lc">+</span>${esc(line.slice(1))}</div>`;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      html += `<div class="gp-line gp-del"><span class="gp-lc">-</span>${esc(line.slice(1))}</div>`;
    } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      // skip meta lines
    } else if (inFile) {
      html += `<div class="gp-line gp-ctx"><span class="gp-lc"> </span>${esc(line.slice(1) || '')}</div>`;
    }
  }
  if (inFile) html += '</div>';
  html += '</div>';
  return html;
}

// ── 프로젝트 관리 ────────────────────────────────────────
let _pjEditId = null;  // null=신규, number=수정

async function fetchProjects() {
  try {
    const r = await fetch('/api/projects');
    projects = await r.json();
    renderProjects();
    _autoSelectProject();
    if (currentProjectId != null) _updateProjectNameHeader(currentProjectId, currentProjectName);
  } catch {}
  // 연결된 다른 EP4의 공유 프로젝트도 가져와 함께 표시(실패해도 무시)
  try {
    const rr = await fetch('/api/remote-projects');
    const dd = await rr.json();
    _remoteProjects = (dd && dd.projects) || [];
    _remotePeerErrors = (dd && dd.errors) || [];
    renderProjects();
  } catch { _remoteProjects = []; _remotePeerErrors = []; }
}

function _autoSelectProject() {
  // 이미 프로젝트가 선택되어 있으면 아무것도 하지 않음
  if (currentProjectId != null) return;
  if (!projects || projects.length === 0) return;
  let target = null;
  try {
    const saved = localStorage.getItem('ep4-last-project');
    if (saved) target = projects.find(p => String(p.id) === saved) || null;
  } catch {}
  if (!target) target = projects[0];
  openProject(target.id, target.name);
}

function _pjIcon(id) {
  const icons  = ['□', '≡', '</>', '◎', '△', '◇', '⊞', '✦'];
  const bgs    = ['#6b8aff22','#50c87822','#ff965022','#f8717122','#facc1522','#38bdf822','#a78bfa22','#fb923c22'];
  const colors = ['#6b8aff',  '#50c878',  '#ff9650',  '#f87171',  '#facc15',  '#38bdf8',  '#a78bfa',  '#fb923c'];
  const i = (id - 1) % icons.length;
  return { bg: bgs[i], color: colors[i], icon: icons[i] };
}

function _timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr + (isoStr.includes('Z') ? '' : 'Z')).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return m + '분 전';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '시간 전';
  return Math.floor(h / 24) + '일 전';
}

function renderProjects() {
  const list = document.getElementById('project-list');
  if (!list) return;
  const q = _projSearch;
  const filtered = q
    ? projects.filter(pj => pj.name.toLowerCase().includes(q.toLowerCase()))
    : projects;
  const countEl = document.getElementById('pj-count');
  if (countEl) countEl.textContent = (q ? `${filtered.length} / ` : '') + projects.length + '개';
  if (!filtered.length) {
    list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-mute);">
      <div style="font-size:2.5rem;margin-bottom:12px;">${q ? '🔍' : '🗂'}</div>
      <div>${q ? '검색 결과가 없습니다.' : '프로젝트가 없습니다. 새 프로젝트를 만들어보세요.'}</div>
    </div>`;
    return;
  }
  list.innerHTML = filtered.map(pj => {
    const {stats} = pj;
    const total   = stats.total   || 0;
    const running = stats.running || 0;
    const error   = stats.error   || 0;
    const done    = stats.done    || 0;
    const {bg, color, icon} = _pjIcon(pj.id);
    const dotColor = {idle:'#64748b', running:'#38bdf8', done:'#4ade80', error:'#f87171'}[pj.status] || '#64748b';
    const dotGlow  = {running:'0 0 5px #38bdf880', done:'0 0 5px #4ade8060', error:'0 0 5px #f8717160'}[pj.status] || 'none';
    const badge    = pj.auto_run
      ? `<span class="pj-badge auto">${t('project.badge.auto') || '자동 실행'}</span>`
      : `<span class="pj-badge manual">${t('project.badge.manual') || '수동'}</span>`;
    const bell = (pj.channel_ids && pj.channel_ids.length)
      ? `<span class="pj-bell">🔔 ${pj.channel_ids.length}</span>` : '';
    const pjBranch = pj.git_proj_branch
      ? `<span class="pj-branch">${_BRANCH_SVG} ${esc(pj.git_proj_branch)}</span>` : '';
    const claudeMdBadge = pj.has_claude_md
      ? `<span class="pj-claude-md-badge" onclick="event.stopPropagation();viewClaudeMd(${pj.id},'${esc(pj.name)}')" title="CLAUDE.md 보기">CLAUDE.md</span>` : '';
    let sub = `태스크 ${total}`;
    if (running > 0) sub += ` · 실행 중 ${running}`;
    if (error   > 0) sub += ` · 실패 ${error}`;
    if (done === total && total > 0) sub += ` · 모두 완료`;
    if (pj.project_root) sub += ` · <span style="font-size:.68rem;font-family:'Consolas',monospace;opacity:.6;">${esc(pj.project_root)}</span>`;
    return `
    <div class="pj-row" onclick="openProject(${pj.id},'${esc(pj.name)}')">
      <div class="pj-icon-box" style="background:${bg};color:${color};">${icon}</div>
      <div class="pj-info">
        <div class="pj-name-line">
          <span class="pj-name">${_hlText(pj.name, q)}</span>
          ${badge}${bell}${claudeMdBadge}${pjBranch}
        </div>
        <div class="pj-sub">${sub}</div>
      </div>
      <div class="pj-right">
        <span class="pj-sdot" style="background:${dotColor};box-shadow:${dotGlow};"></span>
        <button class="pj-act-btn" onclick="event.stopPropagation();openProjectDetail(${pj.id})" title="프로젝트 상세 (Claude 구성)">🔍 상세</button>
        <button class="pj-act-btn" onclick="event.stopPropagation();openProject(${pj.id},'${esc(pj.name)}')" title="태스크 목록 열기">✅ 태스크</button>
        ${pj.project_root ? `<button class="pj-act-btn" onclick="event.stopPropagation();openProjectFolder(${pj.id})" title="폴더 열기">📁 폴더</button>` : ''}
        <button class="pj-more-btn" onclick="event.stopPropagation();openProjectModal(${pj.id})" title="설정">⋯</button>
        <span class="pj-chevron">›</span>
      </div>
    </div>`;
  }).join('');

  // ── 연결된 다른 EP4의 원격 프로젝트 ──
  const rfiltered = q ? _remoteProjects.filter(pj => (pj.name||'').toLowerCase().includes(q.toLowerCase())) : _remoteProjects;
  if (rfiltered.length || _remotePeerErrors.length) {
    list.innerHTML += `<div class="settings-section-label" style="margin-top:14px;">🔗 연결된 EP4 프로젝트</div>`;
    // peer 조회 실패 사유 표시 (인증 실패 등) — 조용히 숨기지 않는다
    list.innerHTML += _remotePeerErrors.map(er => `
      <div class="pj-row" style="border-left:2px solid #f8717155;cursor:default;">
        <div class="pj-icon-box" style="background:#f871711a;color:#f87171;">!</div>
        <div class="pj-info">
          <div class="pj-name-line"><span class="pj-name">🔗 ${esc(er.peer_name || er.peer_url)}</span></div>
          <div class="pj-sub" style="color:#f87171;">${esc(er.error || '')} · <span style="font-size:.68rem;font-family:'Consolas',monospace;opacity:.6;">${esc(er.peer_url || '')}</span></div>
        </div>
      </div>`).join('');
    list.innerHTML += rfiltered.map(pj => {
      const stats = pj.stats || {};
      const total = stats.total || 0, running = stats.running || 0, error = stats.error || 0, done = stats.done || 0;
      const {bg, color, icon} = _pjIcon(pj.id || 1);
      let sub = `태스크 ${total}`;
      if (running > 0) sub += ` · 실행 중 ${running}`;
      if (error > 0) sub += ` · 실패 ${error}`;
      const hostBadge = `<span class="pj-badge" style="background:#a78bfa22;color:#a78bfa;">🔗 ${esc(pj.host || pj.peer_name || '')}</span>`;
      const args = `${pj.id},'${esc(pj.name)}','${esc(pj.peer_url)}'`;
      return `
      <div class="pj-row" style="border-left:2px solid #a78bfa55;" onclick="openRemoteProject(${args})">
        <div class="pj-icon-box" style="background:${bg};color:${color};">${icon}</div>
        <div class="pj-info">
          <div class="pj-name-line">
            <span class="pj-name">${_hlText(pj.name, q)}</span>
            ${hostBadge}
          </div>
          <div class="pj-sub">${sub} · <span style="font-size:.68rem;font-family:'Consolas',monospace;opacity:.6;">${esc(pj.peer_url)}</span></div>
        </div>
        <div class="pj-right"><span class="pj-chevron">›</span></div>
      </div>`;
    }).join('');
  }
}

function openRemoteProject(id, name, peerUrl) {
  _peerBase = peerUrl;
  openProject(id, name, peerUrl);
}

function openProject(id, name, peerBase) {
  _peerBase = peerBase || null;   // 로컬 프로젝트면 null, 원격이면 peer URL
  currentProjectId = id;
  currentProjectName = name;
  _taskFilter = 'all';
  _selectedTaskIds.clear();
  _taskSearch = '';
  const _gs = document.getElementById('globalSearch');
  if (_gs) _gs.value = '';
  _updateSearchWrap();
  try { localStorage.setItem('ep4-last-project', String(id)); } catch {}
  _updateProjectNameHeader(id, name);
  showView('todo');
  fetchTasks();
}

async function openProjectFolder(id) {
  const r = await fetch(`/api/projects/${id}/open-folder`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  const d = await r.json();
  if (!d.ok) showAlert(d.error || '폴더를 열 수 없습니다.');
}

// ── 프로젝트 Claude 상세 모달 ──────────────────────────────────────────────
function closeProjectDetail() {
  const m = document.getElementById('projectDetailModal');
  if (m) m.style.display = 'none';
}

function _pjdSection(title, count, bodyHtml, dlHtml) {
  const badge = count != null
    ? ` <span style="font-size:.7rem;color:var(--text-dim);background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:1px 7px;">${count}</span>`
    : '';
  return `<div style="margin-bottom:16px;">
    <div style="font-size:.82rem;font-weight:700;color:var(--text-mute);margin-bottom:6px;display:flex;align-items:center;gap:4px;">
      <span>${title}${badge}</span>${dlHtml || ''}
    </div>
    ${bodyHtml}
  </div>`;
}

function _pjdDownload(pid, part) {
  location.href = `/api/projects/${pid}/claude-detail/download?part=${encodeURIComponent(part)}`;
}

function _pjdDlBtn(pid, part, enabled) {
  if (!enabled) return '';
  return `<button class="pj-folder-btn" style="margin-left:4px;" onclick="_pjdDownload(${pid},'${part}')" title="다운로드">⬇</button>`;
}

function _pjdEmpty(msg) {
  return `<div style="font-size:.76rem;color:var(--text-dim);">${esc(msg)}</div>`;
}

function _pjdPre(text) {
  return `<pre style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.5;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">${esc(text)}</pre>`;
}

async function openProjectDetail(id) {
  const modal = document.getElementById('projectDetailModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const body = document.getElementById('pjDetailBody');
  const nameEl = document.getElementById('pjDetailName');
  const pathEl = document.getElementById('pjDetailPath');
  body.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;">불러오는 중…</div>';
  nameEl.textContent = '';
  pathEl.textContent = '';
  let d;
  try {
    const r = await fetch(`/api/projects/${id}/claude-detail`);
    d = await r.json();
  } catch {
    body.innerHTML = _pjdEmpty('상세 정보를 불러오지 못했습니다.');
    return;
  }
  const pjName = d.name || (projects.find(p => p.id === id) || {}).name || '';
  const actions = `
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <button class="pj-act-btn" onclick="closeProjectDetail();openProject(${id},'${esc(pjName)}')">✅ 태스크</button>
      ${d.ok ? `<button class="pj-act-btn" onclick="openProjectFolder(${id})">📁 폴더 열기</button>` : ''}
      ${d.ok ? `<button class="pj-act-btn" onclick="_pjdDownload(${id},'all')" title="CLAUDE.md·.claude 구성·claude.json 엔트리를 zip 으로 다운로드">⬇ 전체 다운로드 (zip)</button>` : ''}
      <button class="pj-act-btn" style="margin-left:auto;color:#f87171;border-color:#f8717166;" onclick="deleteProjectFromDetail(${id})" title="프로젝트와 관련 태스크·실행 로그를 모두 삭제">🗑 삭제</button>
    </div>`;
  if (!d.ok) {
    nameEl.textContent = pjName;
    body.innerHTML = actions + _pjdEmpty(d.error === 'no_project_root'
      ? '프로젝트 루트(project_root)가 설정되지 않아 Claude 구성을 읽을 수 없습니다. 프로젝트 설정(⋯)에서 경로를 지정하세요.'
      : `오류: ${d.error || '알 수 없음'}`);
    return;
  }
  const repo = d.repo || {};
  nameEl.textContent = pjName;
  pathEl.textContent = d.cwd || '';

  const chip = (t, color) => `<span style="font-size:.7rem;color:${color};background:${color}1a;border:1px solid ${color}44;border-radius:8px;padding:1px 8px;">${esc(t)}</span>`;
  const itemCard = (inner) => `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">${inner}</div>`;

  // 좌측 열: CLAUDE.md / 에이전트 / 스킬 / 명령어 / hooks
  let left = _pjdSection('📜 프로젝트 CLAUDE.md', null,
    repo.claude_md ? _pjdPre(repo.claude_md) : _pjdEmpty('CLAUDE.md 없음'),
    _pjdDlBtn(id, 'claude_md', !!repo.claude_md));

  left += _pjdSection('🤝 프로젝트 에이전트', (repo.agents || []).length,
    (repo.agents || []).length ? repo.agents.map(a => itemCard(`
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:600;font-size:.84rem;">${esc(a.name)}</span>
        ${chip(a.model || 'inherit', '#a78bfa')}
      </div>
      ${a.description ? `<div style="font-size:.74rem;color:var(--text-mute);margin-top:3px;">${esc(a.description)}</div>` : ''}
      ${(a.tools || []).length ? `<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;">${a.tools.map(tl => chip(tl, '#38bdf8')).join('')}</div>` : ''}
    `)).join('') : _pjdEmpty('.claude/agents 비어있음'),
    _pjdDlBtn(id, 'agents', (repo.agents || []).length > 0));

  left += _pjdSection('✨ 프로젝트 스킬', (repo.skills || []).length,
    (repo.skills || []).length ? repo.skills.map(s => itemCard(`
      <span style="font-weight:600;font-size:.84rem;">${esc(s.name)}</span>
      ${s.description ? `<div style="font-size:.74rem;color:var(--text-mute);margin-top:3px;">${esc(s.description)}</div>` : ''}
    `)).join('') : _pjdEmpty('—'),
    _pjdDlBtn(id, 'skills', (repo.skills || []).length > 0));

  left += _pjdSection('/ 프로젝트 명령어', (repo.commands || []).length,
    (repo.commands || []).length ? repo.commands.map(c => itemCard(`
      <span style="font-weight:600;font-size:.84rem;font-family:'Consolas',monospace;">/${esc(c.id)}</span>
      ${c.description ? `<div style="font-size:.74rem;color:var(--text-mute);margin-top:3px;">${esc(c.description)}</div>` : ''}
    `)).join('') : _pjdEmpty('—'),
    _pjdDlBtn(id, 'commands', (repo.commands || []).length > 0));

  left += _pjdSection('🪝 .claude/hooks 파일', (repo.hooks || []).length,
    (repo.hooks || []).length
      ? `<div style="display:flex;gap:5px;flex-wrap:wrap;">${repo.hooks.map(h => chip(h.name, '#facc15')).join('')}</div>`
      : _pjdEmpty('—'),
    _pjdDlBtn(id, 'hooks', (repo.hooks || []).length > 0));

  // 우측 열: settings.local.json / ~/.claude.json 엔트리
  let right = _pjdSection('⚙️ .claude/settings.local.json', null,
    repo.settings_local != null
      ? _pjdPre(JSON.stringify(repo.settings_local, null, 2))
      : _pjdEmpty('.claude/settings.local.json 없음'),
    _pjdDlBtn(id, 'settings_local', repo.settings_local != null));

  const entry = d.claude_json_entry || {};
  const entryKeys = Object.keys(entry);
  right += _pjdSection('🗂 ~/.claude.json 프로젝트 엔트리', null,
    entryKeys.length
      ? `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:8px 12px;">${entryKeys.map(k => {
          let v = entry[k];
          v = (v === null || v === undefined) ? 'null' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
          return `<div style="display:flex;gap:10px;padding:3px 0;font-size:.76rem;border-bottom:1px solid var(--border);">
            <span style="color:var(--text-mute);">${esc(k)}</span>
            <span style="flex:1;text-align:right;font-family:'Consolas',monospace;overflow:hidden;text-overflow:ellipsis;">${esc(v)}</span>
          </div>`;
        }).join('')}</div>`
      : _pjdEmpty('~/.claude.json 에 이 프로젝트 엔트리 없음'),
    _pjdDlBtn(id, 'claude_json', entryKeys.length > 0));

  body.innerHTML = actions + `
    <div style="margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;">
      ${chip(repo.exists ? '.claude 존재' : '.claude 없음', repo.exists ? '#4ade80' : '#94a3b8')}
      ${chip(`에이전트 ${(repo.agents || []).length}`, '#a78bfa')}
      ${chip(`스킬 ${(repo.skills || []).length}`, '#38bdf8')}
      ${chip(`명령어 ${(repo.commands || []).length}`, '#facc15')}
      ${chip(`훅 ${(repo.hooks || []).length}`, '#fb923c')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <div>${left}</div>
      <div>${right}</div>
    </div>`;
}

async function viewClaudeMd(id, name) {
  const modal = document.getElementById('claude-md-modal');
  if (!modal) return;
  document.getElementById('claude-md-proj-name').textContent = name || '';
  document.getElementById('claude-md-path').textContent = '로딩 중...';
  document.getElementById('claude-md-content').textContent = '';
  modal.classList.add('open');
  try {
    const r = await fetch(`/api/projects/${id}/claude-md`);
    const d = await r.json();
    if (d.ok) {
      document.getElementById('claude-md-path').textContent = d.path || '';
      document.getElementById('claude-md-content').textContent = d.content || '';
    } else {
      document.getElementById('claude-md-path').textContent = '';
      document.getElementById('claude-md-content').textContent = '⚠ ' + (d.error || 'CLAUDE.md를 읽을 수 없습니다.');
    }
  } catch {
    document.getElementById('claude-md-content').textContent = '⚠ 서버 오류';
  }
}

function closeClauseMdModal() {
  const modal = document.getElementById('claude-md-modal');
  if (modal) modal.classList.remove('open');
}

function _updateProjectNameHeader(id, name) {
  const nameEl = document.getElementById('current-project-name');
  if (!nameEl) return;
  const caret = `<span class="proj-caret">▾</span>`;
  // 원격(다른 EP4) 프로젝트: 접속 호스트 배지로 구분 (로컬 git 칩은 표시하지 않음)
  if (_peerBase) {
    const rp = _remoteProjects.find(p => String(p.id) === String(id) && p.peer_url === _peerBase);
    const host = rp ? (rp.host || rp.peer_name || _peerBase) : _peerBase;
    nameEl.innerHTML = esc(name) + caret +
      `<span class="proj-branch-chip" style="color:#a78bfa;background:#a78bfa1a;border-color:#a78bfa44;">🔗 ${esc(host)}</span>`;
    return;
  }
  const pj = projects.find(p => p.id === id);
  const branchChip = (pj && pj.git_proj_branch)
    ? `<span class="proj-branch-chip">${_BRANCH_SVG} ${esc(pj.git_proj_branch)}</span>`
    : '';
  nameEl.innerHTML = esc(name) + caret + branchChip;
}

// ── 헤더 프로젝트 전환 드롭다운 ────────────────────────────────────────────
let _projSwitchRemote = [];   // 메뉴 렌더 시점의 원격 프로젝트 스냅샷 (클릭 핸들러용)

function toggleProjSwitchMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('proj-switch-menu');
  if (!menu) return;
  if (menu.style.display === 'block') { _closeProjSwitchMenu(); return; }
  const dotColor = s => s === 'running' ? '#38bdf8' : (s === 'error' ? '#f87171' : '#64748b');
  const check = '<span style="color:var(--accent);font-size:.78rem;">✓</span>';
  let html = projects.map(pj => {
    const active = !_peerBase && pj.id === currentProjectId;
    const total = (pj.stats && pj.stats.total) || 0;
    return `<div class="proj-switch-item${active ? ' active' : ''}" onclick="_switchProjectFromMenu(${pj.id})">
      <span class="proj-switch-dot" style="background:${dotColor(pj.status)};"></span>
      <span class="proj-switch-name">${esc(pj.name)}</span>
      ${total ? `<span class="proj-switch-cnt">${total}</span>` : ''}
      ${active ? check : ''}
    </div>`;
  }).join('');
  // 연결된 다른 EP4(peer)의 공유 프로젝트 — 호스트별 구분선 아래에 표시
  _projSwitchRemote = _remoteProjects || [];
  const byHost = {};
  _projSwitchRemote.forEach((pr, i) => {
    const h = pr.host || pr.peer_name || pr.peer_url || '';
    (byHost[h] = byHost[h] || []).push(i);
  });
  for (const host of Object.keys(byHost)) {
    html += `<div class="proj-switch-sep">🔗 ${esc(host)}</div>`;
    html += byHost[host].map(i => {
      const pr = _projSwitchRemote[i];
      const active = _peerBase === pr.peer_url && String(currentProjectId) === String(pr.id);
      const total = (pr.stats && pr.stats.total) || 0;
      return `<div class="proj-switch-item${active ? ' active' : ''}" onclick="_switchRemoteFromMenu(${i})">
        <span class="proj-switch-dot" style="background:#a78bfa;"></span>
        <span class="proj-switch-name">${esc(pr.name)}</span>
        ${total ? `<span class="proj-switch-cnt">${total}</span>` : ''}
        ${active ? check : ''}
      </div>`;
    }).join('');
  }
  menu.innerHTML = html || '<div class="proj-switch-item" style="cursor:default;color:var(--text-dim);">프로젝트 없음</div>';
  menu.style.display = 'block';
  setTimeout(() => document.addEventListener('click', _closeProjSwitchMenu, { once: true }), 0);
}

function _switchRemoteFromMenu(idx) {
  _closeProjSwitchMenu();
  const pr = (_projSwitchRemote || [])[idx];
  if (!pr) return;
  if (_peerBase === pr.peer_url && String(currentProjectId) === String(pr.id)) return;
  openRemoteProject(pr.id, pr.name, pr.peer_url);
}

function _closeProjSwitchMenu() {
  const menu = document.getElementById('proj-switch-menu');
  if (menu) menu.style.display = 'none';
}

function _switchProjectFromMenu(id) {
  _closeProjSwitchMenu();
  const pj = projects.find(p => p.id === id);
  if (!pj) return;
  if (!_peerBase && currentProjectId === id) return; // 같은 프로젝트면 무시
  openProject(pj.id, pj.name);
}

async function startProject(id) {
  await fetch(`/api/projects/${id}/start`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  await fetchProjects();
}

async function deleteProject(id) {
  if (!await showConfirm('프로젝트를 삭제할까요?\n관련 태스크와 실행 로그도 함께 삭제됩니다.', {type:'delete', ok:'삭제'})) return false;
  await fetch(`/api/projects/${id}/delete`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  if (currentProjectId === id) {
    currentProjectId = null;
    currentProjectName = '';
    const bar = document.getElementById('project-context-bar');
    if (bar) bar.style.display = 'none';
  }
  await fetchProjects();
  return true;
}

async function deleteProjectFromDetail(id) {
  if (await deleteProject(id)) closeProjectDetail();
}

// 엔진 선택에 따라 모델 드롭다운의 표시 옵션 그룹을 전환한다.
function _onEngineChange() {
  const eng = (document.getElementById('pjFormEngine') || {}).value || 'claude';
  const modelSel = document.getElementById('pjFormModel');
  if (!modelSel) return;
  const claudeGrp = modelSel.querySelector('.pj-model-claude');
  const agGrp = modelSel.querySelector('.pj-model-antigravity');
  if (claudeGrp) claudeGrp.style.display = (eng === 'claude') ? '' : 'none';
  if (agGrp) agGrp.style.display = (eng === 'antigravity') ? '' : 'none';
  // 현재 선택값이 활성 그룹에 없으면 활성 그룹 첫 옵션으로 보정
  const sel = modelSel.options[modelSel.selectedIndex];
  const inActive = sel && sel.parentElement &&
    sel.parentElement.classList.contains(eng === 'claude' ? 'pj-model-claude' : 'pj-model-antigravity');
  if (!inActive) {
    const grp = eng === 'claude' ? claudeGrp : agGrp;
    if (grp) {
      const def = eng === 'claude' ? 'claude-fable-5' : '';
      modelSel.value = def;
      if (modelSel.selectedIndex < 0 && grp.querySelector('option')) {
        grp.querySelector('option').selected = true;
      }
    }
  }
}

async function openProjectModal(editId = null) {
  _pjEditId = editId;
  await _loadChannels();
  const channelBox = document.getElementById('pjChannelList');
  if (channelBox) {
    channelBox.innerHTML = _channels.map(ch => `
      <label style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;cursor:pointer;">
        <input type="checkbox" data-ch-id="${ch.id}" style="accent-color:var(--accent);" onchange="syncNotifyCheckbox()">
        <span style="font-size:1.1rem;">${ch.type==='slack'?'🔗':'🎮'}</span>
        <span style="font-size:0.88rem;flex:1;">${esc(ch.name)}</span>
        <span style="font-size:0.75rem;color:var(--text-mute);">${ch.type==='slack'?'Slack':'Discord'}</span>
      </label>`).join('');
  }
  // 세션 목록 갱신
  await refreshSessionOptions();

  if (editId) {
    const pj = projects.find(p => p.id === editId);
    if (pj) {
      document.getElementById('pjFormName').value = pj.name;
      document.getElementById('pjFormDesc').value = pj.description || '';
      document.getElementById('pjFormEngine').value = pj.engine || 'claude';
      document.getElementById('pjFormModel').value = pj.model || 'claude-fable-5';
      _onEngineChange();
      document.getElementById('pjFormRetry').value = pj.retry_count ?? 3;
      document.getElementById('pjFormTimeout').value = pj.timeout_sec ?? 1800;
      document.getElementById('pjFormRoot').value = pj.project_root || '';
      document.getElementById('pjFormPreviewUrl').value = pj.preview_url || '';
      document.getElementById('pjFormDatasource').value = pj.datasource || '';
      _setSkipPermsUI(!!pj.skip_permissions);
      _setAutoRunUI(pj.auto_run);
      const _shEl = document.getElementById('pjFormShared'); if (_shEl) _shEl.checked = !!pj.shared;
      document.getElementById('pjFormSession').value = pj.session_name || '';
      // 클로드 세션 복원
      const _csid = pj.claude_session_id || '';
      const _csInp = document.getElementById('pjClaudeSessionId');
      if (_csInp) _csInp.value = _csid;
      if (_csid) { setPjSessType('claude'); refreshClaudeSessionOptions().then(() => { const _csSel = document.getElementById('pjClaudeSessionSelect'); if (_csSel) _csSel.value = _csid; }); }
      else setPjSessType('cmd');
      document.getElementById('pjSaveBtnText').setAttribute('data-i18n', 'project.update');
      document.getElementById('pjSaveBtnText').textContent = '✓ 수정 저장';
      const _delBtn = document.getElementById('pjDeleteBtn'); if (_delBtn) _delBtn.style.display = '';
      (pj.channel_ids || []).forEach(cid => {
        const cb = channelBox && channelBox.querySelector(`[data-ch-id="${cid}"]`);
        if (cb) cb.checked = true;
      });
      syncNotifyCheckbox();
    }
  } else {
    document.getElementById('pjFormName').value = '';
    document.getElementById('pjFormDesc').value = '';
    document.getElementById('pjFormEngine').value = 'claude';
    document.getElementById('pjFormModel').value = 'claude-fable-5';
    _onEngineChange();
    document.getElementById('pjFormRetry').value = '3';
    document.getElementById('pjFormTimeout').value = '1800';
    document.getElementById('pjFormRoot').value = '';
    document.getElementById('pjFormPreviewUrl').value = '';
    document.getElementById('pjFormDatasource').value = '';
    document.getElementById('pjFormSession').value = '';
    const _csInpNew = document.getElementById('pjClaudeSessionId');
    if (_csInpNew) _csInpNew.value = '';
    setPjSessType('cmd');
    _setSkipPermsUI(false);
    _setAutoRunUI(true);
    const _shEl2 = document.getElementById('pjFormShared'); if (_shEl2) _shEl2.checked = false;
    document.getElementById('pjSaveBtnText').setAttribute('data-i18n', 'project.save');
    document.getElementById('pjSaveBtnText').textContent = '✓ 프로젝트 생성';
    const _delBtn2 = document.getElementById('pjDeleteBtn'); if (_delBtn2) _delBtn2.style.display = 'none';
    // 새 프로젝트: 기본 채널(★)을 미리 선택 — 등록 즉시 기본 채널로 알림 전송
    const _defCh = _channels.find(c => c.effective_default);
    if (_defCh && channelBox) {
      const _defCb = channelBox.querySelector(`[data-ch-id="${_defCh.id}"]`);
      if (_defCb) _defCb.checked = true;
    }
    syncNotifyCheckbox();
  }
  const modal = document.getElementById('projectModal');
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('pjFormName').focus(), 50);
}

function closeProjectModal() {
  document.getElementById('projectModal').style.display = 'none';
}

function syncNotifyCheckbox() {
  const channelBox = document.getElementById('pjChannelList');
  const notify = document.getElementById('pjNotifyEnabled');
  if (!channelBox || !notify) return;
  const anyChecked = channelBox.querySelectorAll('input[data-ch-id]:checked').length > 0;
  notify.checked = anyChecked;
}

// 자동 실행 토글 — 숨은 checkbox 가 실제 상태이고 슬라이더/노브는 그 표시다.
// 값을 바꾸는 모든 경로(폼 열기·클릭)에서 이 함수로 표시를 맞춘다.
function _setAutoRunUI(on) {
  on = !!on;
  const cb = document.getElementById('pjFormAutoRun');
  if (cb && cb.checked !== on) cb.checked = on;
  const slider = document.getElementById('pjAutoRunSlider');
  if (slider) slider.style.background = on ? 'var(--accent)' : 'var(--border)';
  const knob = document.getElementById('pjAutoRunKnob');
  if (knob) knob.style.transform = on ? 'translateX(20px)' : 'translateX(0)';
}

function _setSkipPermsUI(enabled) {
  const cb = document.getElementById('pjFormSkipPerms');
  if (cb) cb.checked = enabled;
}

function onSkipPermsClick(e, cb) {
  if (cb.checked) {
    cb.checked = false;
    e.preventDefault();
    document.getElementById('skipPermsConfirm').style.display = 'flex';
  }
}

function confirmSkipPerms() {
  document.getElementById('skipPermsConfirm').style.display = 'none';
  document.getElementById('pjFormSkipPerms').checked = true;
}

function cancelSkipPerms() {
  document.getElementById('skipPermsConfirm').style.display = 'none';
}

async function browseFolder(targetId = 'pjFormDatasource') {
  const btn = document.querySelector(`[onclick="browseFolder('${targetId}')"]`) || document.querySelector('[onclick="browseFolder()"]');
  const orig = btn ? btn.textContent : '';
  if (btn) btn.textContent = '…';
  try {
    const r = await fetch('/api/browse-folder', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    const d = await r.json();
    if (d.ok && d.path) {
      const el = document.getElementById(targetId);
      if (el) el.value = d.path;
    }
  } catch {}
  if (btn) btn.textContent = orig;
}

async function saveProject() {
  const name = document.getElementById('pjFormName').value.trim();
  if (!name) { await showAlert('프로젝트 이름을 입력해주세요.', {type:'warning'}); return; }
  const channelBox = document.getElementById('pjChannelList');
  const channelIds = channelBox
    ? [...channelBox.querySelectorAll('input[data-ch-id]:checked')].map(el => parseInt(el.dataset.chId))
    : [];
  const toolPerms = [...document.querySelectorAll('input[data-tool]:checked')].map(el => el.dataset.tool);
  const payload = {
    name,
    description: document.getElementById('pjFormDesc').value.trim(),
    engine: document.getElementById('pjFormEngine').value,
    model: document.getElementById('pjFormModel').value,
    retry_count: parseInt(document.getElementById('pjFormRetry').value) || 3,
    timeout_sec: parseInt(document.getElementById('pjFormTimeout').value) || 1800,
    tool_perms: toolPerms,
    datasource: document.getElementById('pjFormDatasource').value.trim(),
    project_root: document.getElementById('pjFormRoot').value.trim(),
    preview_url: document.getElementById('pjFormPreviewUrl').value.trim(),
    skip_permissions: document.getElementById('pjFormSkipPerms').checked,
    auto_run: document.getElementById('pjFormAutoRun').checked,
    shared: (document.getElementById('pjFormShared') || {}).checked || false,
    session_name: document.getElementById('pjFormSession').value || '',
    claude_session_id: (document.getElementById('pjClaudeSessionId') || {}).value || '',
    channel_ids: channelIds,
  };
  const btn = document.getElementById('pjSaveBtn');
  btn.disabled = true;
  try {
    const url = _pjEditId ? `/api/projects/${_pjEditId}/update` : '/api/projects';
    const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    const d = await r.json();
    if (d.ok) { closeProjectModal(); await fetchProjects(); }
    else await showAlert(d.error || '저장 실패', {type:'error'});
  } catch { await showAlert('서버 오류', {type:'error'}); }
  btn.disabled = false;
}

// ── 번역 상태 표시 ──────────────────────────────────────
function _setTxStatus(msg) {
  let el = document.getElementById('tx-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tx-status';
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:6px 16px;border-radius:20px;font-size:0.8rem;z-index:9999;pointer-events:none;transition:opacity .3s';
    document.body.appendChild(el);
  }
  if (msg) { el.textContent = msg; el.style.opacity = '1'; }
  else { el.style.opacity = '0'; }
}

async function _translateTasks() {
  if (!_autoTranslate || _curLang === 'ko' || !tasks.length) return;
  if (_txPending) return;
  if (!_txCache[_curLang]) _txCache[_curLang] = {};

  const allTexts = tasks.flatMap(tk => [tk.text, tk.body, tk.test].filter(Boolean));
  const unique = [...new Set(allTexts)];
  const uncached = unique.filter(s => !_txCache[_curLang][s]);
  if (!uncached.length) return;

  _txPending = true;
  _setTxStatus(t('chat.translating'));
  try {
    const resp = await fetch('/api/translate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ texts: uncached, lang: _curLang }),
    });
    if (resp.ok) {
      const data = await resp.json();
      (data.translations || []).forEach((tr, i) => {
        if (uncached[i]) _txCache[_curLang][uncached[i]] = tr;
      });
      renderTasks();
    } else {
      console.error('[AutoTranslate] /api/translate status:', resp.status, '— 서버를 재시작해주세요.');
    }
  } catch (err) {
    console.error('[AutoTranslate] fetch error:', err);
  }
  _txPending = false;
  _setTxStatus('');
}

function toggleAutoTranslate() {
  _autoTranslate = !_autoTranslate;
  try { localStorage.setItem('ep4-auto-translate', _autoTranslate ? '1' : '0'); } catch {}
  const check = document.getElementById('auto-translate-check');
  if (check) check.style.display = _autoTranslate ? '' : 'none';
  if (_autoTranslate) { _translateTasks(); _translateChatHistory(); }
  else { renderTasks(); _renderChatMessages(); }
}

(function _initAutoTranslate() {
  try {
    _autoTranslate = localStorage.getItem('ep4-auto-translate') === '1';
  } catch {}
  document.addEventListener('DOMContentLoaded', () => {
    const check = document.getElementById('auto-translate-check');
    if (check) check.style.display = _autoTranslate ? '' : 'none';
  });
})();

// keyboard shortcut: '/' focuses search input
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const inp = document.getElementById('globalSearch');
    if (inp) inp.focus();
  }
  if (e.key === 'Escape') {
    closeSpotlight();
    if (document.activeElement === document.getElementById('globalSearch')) {
      clearTaskSearch();
      document.getElementById('globalSearch').blur();
    }
  }
});

// ── Header status sync ─────────────────────────────────
function toggleServerInfo() {
  const pop = document.getElementById('serverInfoPopover');
  if (!pop) return;
  pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#btn-server-info') && !e.target.closest('#serverInfoPopover')) {
    const pop = document.getElementById('serverInfoPopover');
    if (pop) pop.style.display = 'none';
  }
});

function setHeaderStatus(ok, text) {
  const chip = document.getElementById('header-status');
  const dot  = document.getElementById('header-dot');
  const lbl  = document.getElementById('header-status-text');
  chip.className = 'chip ' + (ok ? 'chip-ok' : 'chip-err');
  dot.className  = 'pulse-dot' + (ok ? '' : ' off');
  lbl.textContent = text;
}

function showView(name) {
  _currentView = name;
  _taskSearch = ''; _rlSearch = ''; _projSearch = ''; _pluginSearch = '';
  const gs = document.getElementById('globalSearch');
  if (gs) gs.value = '';
  _updateSearchWrap();
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  document.querySelectorAll('.view-pane').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const viewEl = document.getElementById('view-' + name);
  if (viewEl) {
    viewEl.classList.add('active');
    viewEl.style.display = (name === 'todo') ? 'flex' : (name === 'log' ? 'flex' : 'flex');
  }
  document.getElementById('view-title').textContent = t('view.title.' + name) || name;
  document.getElementById('view-sub').textContent   = t('view.sub.' + name) || '';
  const actions = document.getElementById('view-actions');
  if (actions) actions.style.display = 'none';
  if (name === 'log') loadRuns();
}

async function _loadFolders(pid) {
  if (!pid) { _folders = []; return; }
  try {
    const r = await fetch(apiUrl(`/api/projects/${pid}/folders`));
    _folders = await r.json();
  } catch { _folders = []; }
}

async function fetchTasks() {
  if (!currentProjectId) { tasks = []; _folders = []; renderTasks(); setRunning(false); return; }
  const seq = ++_folderSeq;
  try {
    const [fRes, tRes] = await Promise.all([
      fetch(apiUrl(`/api/projects/${currentProjectId}/folders`)),
      fetch(apiUrl(`/api/projects/${currentProjectId}/tasks`)),
    ]);
    // seq > _folderDone: 이보다 나중에 시작된 fetchTasks가 이미 완료되지 않은 경우만 _folders 갱신
    if (seq > _folderDone) {
      _folders = await fRes.json();
      _folderDone = seq;
    } else {
      await fRes.json();  // 응답 본문 소비 (메모리 해제)
    }
    tasks = await tRes.json();
    _unifyTopOrderInMemory();   // 레거시 데이터면 최상위 통합 순서로 정규화(인메모리)
    renderTasks();
    _translateTasks();
    if (tasks.some(t => t.status === 'running')) setRunning(true);
  } catch {}
}

// 언그룹 태스크와 폴더의 sort_order가 별도 공간(충돌)인 레거시 데이터를
// "태스크 먼저 → 폴더" 순서의 통합 번호로 정규화한다(인메모리). 사용자가 한 번
// 드래그하면 통합 순서가 서버에 영속되어 이후로는 충돌이 사라진다.
function _unifyTopOrderInMemory() {
  const ung = tasks.filter(t => t.folder_id == null);
  if (!_folders.length || !ung.length) return;
  const tset = new Set(ung.map(t => t.sort_order));
  if (!_folders.some(f => tset.has(f.sort_order))) return;  // 이미 통합됨(충돌 없음)
  const seqU = ung.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const seqF = _folders.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  let i = 1;
  for (const t of seqU) t.sort_order = (i++) * 10;
  for (const f of seqF) f.sort_order = (i++) * 10;
}

function toggleTaskSelection(id, checked) {
  if (checked) _selectedTaskIds.add(id);
  else _selectedTaskIds.delete(id);
  const row = document.getElementById('task-' + id);
  if (row) row.classList.toggle('tk-selected', checked);
  _updateRunBtnLabel();
  const chkAll = document.getElementById('chk-all');
  if (chkAll) {
    const visible = tasks.map(tk => tk.id);
    chkAll.checked = visible.length > 0 && visible.every(tid => _selectedTaskIds.has(tid));
    chkAll.indeterminate = !chkAll.checked && _selectedTaskIds.size > 0;
  }
}

function selectAll(checked) {
  tasks.forEach(tk => { if (checked) _selectedTaskIds.add(tk.id); else _selectedTaskIds.delete(tk.id); });
  renderTasks();
  _updateRunBtnLabel();
}

function _updateRunBtnLabel() {
  const n = _selectedTaskIds.size;
  document.querySelectorAll('.run-btn-label').forEach(el => { el.textContent = n > 0 ? `실행 (${n})` : '실행'; });
  document.querySelectorAll('.del-btn-label, .del-btn-label2').forEach(el => { el.textContent = n > 0 ? `삭제 (${n})` : '삭제'; });
  ['btn-delete-sel', 'btn-delete-sel2'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = n > 0 ? '' : 'none';
  });
}

async function deleteSelectedTasks() {
  const ids = [..._selectedTaskIds];
  if (!ids.length || !currentProjectId) return;
  const ok = await showConfirm(`선택한 ${ids.length}개 태스크를 삭제할까요?\n삭제 후 복구할 수 없습니다.`, {title:'태스크 삭제', ok:'삭제', cancel:'취소', type:'delete'});
  if (!ok) return;
  try {
    await fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/bulk-delete`), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({task_ids: ids})
    });
  } catch (e) {
    appendLog(`✗ 삭제 오류: ${e.message}`);
    return;
  }
  _selectedTaskIds.clear();
  _updateRunBtnLabel();
  const chkAll = document.getElementById('chk-all');
  if (chkAll) { chkAll.checked = false; chkAll.indeterminate = false; }
  await fetchTasks();
}

function setTaskFilter(f) {
  _taskFilter = f;
  renderTasks();
}

// ── 웹 문서 (태스크 프롬프트·답변 → 웹페이지) ──
async function buildWebDoc() {
  if (!currentProjectId) return;
  const ids = [..._selectedTaskIds];
  if (!ids.length) {
    showAlert('웹 문서로 만들 태스크를 목록에서 먼저 선택하세요.', {title:'웹 만들기', type:'warning'});
    return;
  }
  try {
    const res = await fetch(apiUrl(`/api/projects/${currentProjectId}/webdoc/build`), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({task_ids: ids})
    });
    const d = await res.json();
    if (!d.ok) {
      showAlert(d.error || '웹 문서 생성에 실패했습니다.', {title:'웹 만들기', type:'error'});
      return;
    }
    let msg = `${d.added}개 태스크를 웹 문서에 추가했습니다.`;
    if (d.skipped) msg += `\n이미 웹 문서에 있는 ${d.skipped}개는 건너뛰었습니다.`;
    msg += ` (총 ${d.count}개 항목)\n지금 웹 문서를 열까요?`;
    const go = await showConfirm(msg,
      {title:'웹 만들기', ok:'웹 보기', cancel:'닫기'});
    if (go) window.open(`/webdoc/${currentProjectId}`, '_blank');
  } catch (e) {
    showAlert('웹 문서 생성 오류: ' + e.message, {title:'웹 만들기', type:'error'});
  }
}

function openWebDoc() {
  if (!currentProjectId) return;
  window.open(`/webdoc/${currentProjectId}`, '_blank');
}

function renderTasks() {
  const tbody = document.getElementById('task-tbody');
  if (!tbody) return;

  const total   = tasks.length;
  const done    = tasks.filter(tk => tk.status === 'done').length;
  const running = tasks.filter(tk => tk.status === 'running').length;
  const error   = tasks.filter(tk => tk.status === 'error').length;
  const pending = tasks.filter(tk => tk.status === 'pending').length;

  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stat-done').textContent    = done;
  document.getElementById('stat-running').textContent = running;
  document.getElementById('stat-error').textContent   = error;
  const sbBadgeTotal = document.getElementById('sb-badge-total');
  if (sbBadgeTotal) sbBadgeTotal.textContent = total;

  const pct = total ? Math.round(done / total * 100) : 0;
  ['prog-bar','prog-bar2'].forEach(id => { const el = document.getElementById(id); if(el) el.style.width = pct + '%'; });
  ['progress-pct','progress-pct2'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = total ? pct + '%' : ''; });

  const runningTask = tasks.find(tk => tk.status === 'running');
  const sbDot  = document.getElementById('sb-dot');
  const sbTxt  = document.getElementById('sb-status-text');
  const sbBadgeRun = document.getElementById('sb-badge-run');
  const rlabel = document.getElementById('running-task-label');

  const allSucceeded = total > 0 && done === total && error === 0 && running === 0;
  const btnMerge = document.getElementById('btn-merge');
  if (btnMerge) btnMerge.style.display = allSucceeded ? '' : 'none';

  if (runningTask) {
    ['progress-label','progress-label2'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = t('task.running') + ' · ' + _txd(runningTask.text); });
    if (rlabel) rlabel.textContent = '● ' + _txd(runningTask.text);
    if (sbDot) sbDot.className = 'status-dot running';
    if (sbTxt) sbTxt.textContent = t('task.running');
    if (sbBadgeRun) sbBadgeRun.style.display = '';
    const footer = document.getElementById('tk-footer');
    if (footer) footer.style.display = '';
  } else {
    const lbl = done === total && total > 0 ? t('task.done') : t('log.waiting');
    ['progress-label','progress-label2'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = lbl; });
    if (rlabel) rlabel.textContent = '';
    if (sbDot) sbDot.className = 'status-dot' + (error > 0 ? ' error' : (done === total && total > 0 ? ' done' : ''));
    if (sbTxt) sbTxt.textContent = error > 0 ? t('task.error') : lbl;
    if (sbBadgeRun) sbBadgeRun.style.display = 'none';
    const footer = document.getElementById('tk-footer');
    if (footer) footer.style.display = pct > 0 ? '' : 'none';
  }

  // ── Filter tabs ──
  const tabsEl = document.getElementById('task-filter-tabs');
  if (tabsEl) {
    const tabs = [
      {key:'all',     label:`${t('task.filter.all')||'전체'} ${total}`},
      {key:'running', label:`${t('task.filter.running')||'실행 중'} ${running}`},
      {key:'pending', label:`${t('task.filter.pending')||'대기'} ${pending}`},
      {key:'done',    label:`${t('task.filter.done')||'완료'} ${done}`},
      {key:'error',   label:`${t('task.filter.error')||'실패'} ${error}`},
    ];
    tabsEl.innerHTML = tabs.map(tab =>
      `<button class="tk-tab${_taskFilter===tab.key?' active':''}" onclick="setTaskFilter('${tab.key}')">${tab.label}</button>`
    ).join('');
  }

  // ── Filter & render rows ──
  let filtered = _taskFilter === 'all' ? tasks : tasks.filter(tk => tk.status === _taskFilter);
  if (_taskSearch) filtered = filtered.filter(tk => tk.text.toLowerCase().includes(_taskSearch.toLowerCase()));

  // 검색 중이 아니고 폴더가 있으면 태스크가 없어도 폴더(빈 헤더)는 계속 렌더링한다.
  // (검색 중에는 빈 폴더를 숨기므로 이 경우엔 안내 메시지를 표시)
  const _willShowFolders = !_taskSearch && _folders.length > 0;
  if (!filtered.length && !_willShowFolders) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-mute);">${total===0?'태스크가 없습니다. + 태스크 등록을 눌러 추가하세요.':'해당 상태의 태스크가 없습니다.'}</td></tr>`;
    _updateToggleFoldersBtn();
    return;
  }

  const triggerLabel = {manual:'수동', on_dependency:'선행 완료', schedule:'스케줄', claude_cli:'Claude CLI', antigravity_cli:'Antigravity'};
  const dotColor     = {pending:'#64748b', running:'#38bdf8', done:'#4ade80', error:'#f87171'};
  const badgeLabel   = {pending: t('task.pending')||'대기', running: t('task.running')||'실행 중', done: t('task.done')||'완료', error: t('stat.error')||'실패'};

  function _mkTaskRow(tk, inFolder) {
    const dot  = `<span class="tk-dot" style="background:${dotColor[tk.status]||'#64748b'};${tk.status==='running'?'box-shadow:0 0 5px #38bdf880;':''}"></span>`;
    const name = _hlText(_txd(tk.text), _taskSearch);
    let sub = '';
    if (tk.status === 'running' && tk.started_at) sub = '방금 시작';
    else if (tk.status === 'done' && tk.ended_at) sub = _timeAgo(tk.ended_at) + (tk.output ? ' · ' + esc(tk.output.slice(0,40)) : '');
    else if (tk.status === 'error') sub = tk.output ? esc(tk.output.slice(0,50)) : '실패';
    else if (tk.trigger_type === 'on_dependency') sub = '선행 태스크 완료 후 실행';
    else if (tk.trigger_type === 'schedule' && tk.trigger_meta) { try { const m = JSON.parse(tk.trigger_meta); sub = m.cron || ''; } catch {} }
    const _pj = projects.find(p => p.id === currentProjectId);
    const _modelShort = m => (m || '').replace(/^claude-/,'').replace(/-\d{8}$/,'');
    // 실제 사용 모델(최근 실행 기준) > 태스크 지정 모델 > 프로젝트 기본 모델
    const _usedModel = tk.last_run_model || tk.model_override;
    const harness = _usedModel
      ? `<span class="tk-chip">${esc(_modelShort(_usedModel))}</span>`
      : `<span style="color:var(--text-mute);font-size:.8rem;">${esc(_modelShort((_pj && _pj.model) || 'claude-fable-5'))}</span>`;
    const trig  = `<span class="tk-trig">${triggerLabel[tk.trigger_type] || tk.trigger_type}</span>`;
    const sessId = tk.claude_session_id
      ? `<span style="font-size:.75rem;color:var(--text-mute);font-family:monospace;" title="${esc(tk.claude_session_id)}">${esc(tk.claude_session_id.slice(0,8))}…</span>`
      : `<span style="color:var(--border);">—</span>`;
    const badge = `<span class="tk-badge ${tk.status}">${badgeLabel[tk.status] || tk.status}</span>`;
    const actBtn = tk.status === 'running'
      ? `<button class="tk-act" onclick="stopHarness()" title="${t('task.stop')||'중지'}">⏸</button>`
      : `<button class="tk-act" onclick="runTask(${tk.id})" title="${t('btn.run')||'실행'}" style="${tk.status==='error'?'color:#f87171;':''}">▷</button>`;
    const tkBranch = tk.git_task_branch
      ? `<div class="tk-branch">${_BRANCH_SVG} ${esc(tk.git_task_branch)}</div>`
      : '';
    const isChecked = _selectedTaskIds.has(tk.id);
    const indent = inFolder ? 'padding-left:20px;' : '';
    return `<tr id="task-${tk.id}" data-task-id="${tk.id}" data-dnd-id="task-${tk.id}" data-fid="${tk.folder_id == null ? '' : tk.folder_id}"
      class="tk-row-click${tk.status==='error'?' tr-error':''}${isChecked?' tk-selected':''}${inFolder?' tk-in-folder':''}"
      onclick="openTaskDetail(${tk.id})"
      onpointerdown="_pdDown(event,'task',${tk.id},${tk.folder_id})">
      <td class="tk-c-check" onclick="event.stopPropagation()"><input type="checkbox" class="tk-check" ${isChecked?'checked':''} onchange="toggleTaskSelection(${tk.id},this.checked)"></td>
      <td class="tk-c-task" style="${indent}">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          ${dot}
          <div>
            <div class="tk-tname">${name}${tk.author ? ` <span class="tk-author" title="등록자: ${esc(tk.author)}">👤 ${esc(tk.author)}</span>` : ''}</div>
            ${sub ? `<div class="tk-tsub">${sub}</div>` : ''}
            ${tkBranch}
          </div>
        </div>
      </td>
      <td class="tk-c-harness">${harness}</td>
      <td class="tk-c-trigger">${trig}</td>
      <td class="tk-c-session">${sessId}</td>
      <td class="tk-c-status">${badge}</td>
      <td class="tk-c-action" onclick="event.stopPropagation()">
        <div style="display:flex;gap:2px;justify-content:flex-end;">
          ${actBtn}
          <button class="tk-act" onclick="openMoveToFolder(${tk.id},event)" title="폴더로 이동">📁</button>
          <button class="tk-act" onclick="openEdit(${tk.id})" title="${t('task.edit')||'수정'}">✎</button>
          <button class="tk-act" onclick="deleteTask(${tk.id})" title="${t('task.delete')||'삭제'}" style="color:#f87171;">✕</button>
        </div>
      </td>
    </tr>`;
  }

  // ── 폴더별 그룹화 ──
  const byFolder = {};
  const ungrouped = [];
  for (const tk of filtered) {
    if (tk.folder_id != null) {
      if (!byFolder[tk.folder_id]) byFolder[tk.folder_id] = [];
      byFolder[tk.folder_id].push(tk);
    } else {
      ungrouped.push(tk);
    }
  }

  // 최상위 항목(언그룹 태스크 + 폴더)을 sort_order 통합 정렬로 병합 → 폴더를 태스크 사이에 배치 가능
  const topItems = [
    ...ungrouped.map(tk => ({kind: 'task', sort: tk.sort_order ?? 0, tk})),
    ..._folders.map(f  => ({kind: 'folder', sort: f.sort_order ?? 0, f})),
  ].sort((a, b) => (a.sort - b.sort) || (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1));

  let html = '';
  for (const it of topItems) {
    if (it.kind === 'task') { html += _mkTaskRow(it.tk, false); continue; }
    const f = it.f;
    const folderTasks = byFolder[f.id] || [];
    // 검색 중이면 태스크가 없는 폴더는 숨김
    if (_taskSearch && folderTasks.length === 0) continue;
    const collapsed = _collapsedFolders.has(f.id);
    const cnt = folderTasks.length;
    const arrow = collapsed ? '▶' : '▼';
    html += `<tr class="tk-folder-row" data-dnd-id="folder-${f.id}" data-fid=""
      onclick="toggleFolder(${f.id})"
      onpointerdown="_pdDown(event,'folder',${f.id},null)">
      <td colspan="7">
        <div class="tk-folder-hd">
          <span class="tk-dnd-handle" title="드래그하여 순서 변경">⠿</span>
          <span class="tk-folder-arrow">${arrow}</span>
          <span class="tk-folder-icon">📁</span>
          <span class="tk-folder-name">${esc(f.name)}</span>
          <span class="tk-folder-count">${cnt}</span>
          <button class="tk-folder-btn" onclick="event.stopPropagation();renameFolder(${f.id})" title="이름 변경">✎</button>
          <button class="tk-folder-btn tk-folder-del" onclick="event.stopPropagation();deleteFolder(${f.id})" title="폴더 삭제">✕</button>
        </div>
      </td>
    </tr>`;
    if (!collapsed) {
      html += folderTasks.map(tk => _mkTaskRow(tk, true)).join('');
    }
  }

  tbody.innerHTML = html;
  _updateToggleFoldersBtn();
}

// ── 드래그 앤 드롭 (포인터 이벤트 기반) ─────────────────────
// HTML5 네이티브 DnD(draggable + ondrag*)는 브라우저/입력장치에 따라
// dragstart·drop 이벤트가 발생하지 않는 경우가 잦아 "드롭해도 원위치 복귀"
// 현상이 생긴다. 그래서 pointerdown/move/up으로 직접 구현한다.
let _dndJustDropped = false;   // 드래그 직후 click(toggleFolder/openTaskDetail) 억제
let _pd = null;                // 진행 중인 포인터 드래그 상태

function _pdDown(e, type, id, folderId) {
  if (e.button != null && e.button !== 0) return;                       // 좌클릭(주 버튼)만
  if (e.target.closest('button,input,a,.tk-check,.tk-c-action')) return; // 컨트롤 위에서는 드래그 시작 안 함
  if (_taskSearch) return;                                              // 검색 중엔 비활성
  _pd = {
    type, id: Number(id),
    folderId: (folderId == null) ? null : Number(folderId),
    startX: e.clientX, startY: e.clientY,
    row: e.currentTarget, started: false,
    tgtType: null, tgtId: null, tgtFolderId: null, pos: null, tgtEl: null,
  };
  window.addEventListener('pointermove', _pdMove, true);
  window.addEventListener('pointerup', _pdUp, true);
  window.addEventListener('pointercancel', _pdUp, true);
}

function _pdMove(e) {
  if (!_pd) return;
  // 임계값(5px)을 넘기 전엔 드래그로 보지 않음 — 클릭과 구분
  if (!_pd.started) {
    if (Math.abs(e.clientX - _pd.startX) + Math.abs(e.clientY - _pd.startY) < 5) return;
    _pd.started = true;
    _pd.row.classList.add('tk-dragging');
    document.body.style.userSelect = 'none';
  }
  e.preventDefault();

  // 커서 아래의 행 탐색
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const row = under && under.closest('tr[data-dnd-id]');

  // 이전 하이라이트 제거 + 타겟 초기화
  if (_pd.tgtEl && _pd.tgtEl !== row) {
    _pd.tgtEl.classList.remove('tk-drop-before', 'tk-drop-after', 'tk-drop-folder');
  }
  _pd.tgtType = _pd.tgtId = _pd.tgtFolderId = _pd.pos = null;
  if (!row) { _pd.tgtEl = null; return; }

  const did  = row.dataset.dndId;          // "task-60" | "folder-1"
  const dash = did.indexOf('-');
  const tType = did.slice(0, dash);
  const tId   = Number(did.slice(dash + 1));
  const fa    = row.dataset.fid;
  const tFid  = (fa == null || fa === '') ? null : Number(fa);

  // 폴더는 어떤 폴더의 하위 태스크 사이로도 옮길 수 없음 → 폴더 내부 태스크 위는 무시
  if (_pd.type === 'folder' && tType === 'task' && tFid != null) { _pd.tgtEl = null; return; }
  // 자기 자신 위 → 무시
  if (_pd.type === tType && _pd.id === tId) { _pd.tgtEl = null; return; }

  const rect = row.getBoundingClientRect();
  let pos;
  if (_pd.type === 'task' && tType === 'folder') {
    pos = 'into';
  } else {
    pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }
  row.classList.remove('tk-drop-before', 'tk-drop-after', 'tk-drop-folder');
  row.classList.add(pos === 'into' ? 'tk-drop-folder' : pos === 'before' ? 'tk-drop-before' : 'tk-drop-after');

  _pd.tgtType = tType; _pd.tgtId = tId; _pd.tgtFolderId = tFid; _pd.pos = pos; _pd.tgtEl = row;
}

function _pdUp() {
  window.removeEventListener('pointermove', _pdMove, true);
  window.removeEventListener('pointerup', _pdUp, true);
  window.removeEventListener('pointercancel', _pdUp, true);
  const pd = _pd; _pd = null;
  document.body.style.userSelect = '';
  if (!pd) return;
  if (pd.tgtEl) pd.tgtEl.classList.remove('tk-drop-before', 'tk-drop-after', 'tk-drop-folder');
  pd.row.classList.remove('tk-dragging');
  if (!pd.started) return;   // 이동 없이 떼었으면 단순 클릭 — onclick(toggle/open)에 맡김
  // 드래그였으면 직후 click(folder toggle / task open) 억제
  _dndJustDropped = true;
  setTimeout(() => { _dndJustDropped = false; }, 400);
  _dndPerform(pd.type, pd.id, pd.tgtType, pd.tgtId, pd.tgtFolderId, pd.pos);
}

// 최상위 항목(언그룹 태스크 + 폴더)을 sort_order 통합 순서로 반환
function _topLevelItems() {
  const items = [];
  for (const t of tasks) if (t.folder_id == null) items.push({kind: 'task', id: t.id, sort: t.sort_order ?? 0});
  for (const f of _folders) items.push({kind: 'folder', id: f.id, sort: f.sort_order ?? 0});
  items.sort((a, b) => (a.sort - b.sort) || (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1));
  return items.map(it => ({kind: it.kind, id: it.id}));
}

// 최상위 순서를 통합 번호(10 간격)로 부여하고 폴더+언그룹 태스크를 함께 영속
function _persistTopOrder(items) {
  const fOrders = [], tOrders = [];
  items.forEach((it, i) => {
    const so = (i + 1) * 10;
    if (it.kind === 'folder') fOrders.push({id: it.id, sort_order: so});
    else tOrders.push({id: it.id, sort_order: so, folder_id: null});
  });
  // 낙관적 인메모리 반영
  fOrders.forEach(o => { const f = _folders.find(x => x.id === o.id); if (f) f.sort_order = o.sort_order; });
  tOrders.forEach(o => { const t = tasks.find(x => x.id === o.id); if (t) { t.sort_order = o.sort_order; t.folder_id = null; } });
  _folders.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  _folderDone = ++_folderSeq;  // 이전에 시작된 fetchTasks 결과가 _folders를 되돌리지 못하게
  renderTasks();
  const reqs = [
    fetch(apiUrl(`/api/projects/${currentProjectId}/folders/reorder`), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({orders: fOrders}),
    }),
  ];
  if (tOrders.length) reqs.push(fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/reorder`), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({orders: tOrders}),
  }));
  Promise.all(reqs).then(() => fetchTasks()).catch(() => fetchTasks());
}

// 실제 이동 로직 (포인터 드래그 종료 시 호출)
function _dndPerform(srcType, srcId, tgtType, tgtId, tgtFolderId, pos) {
  if (!srcType || !tgtType || !pos) return;
  if (srcType === tgtType && srcId === tgtId) return;
  const before = pos === 'before';

  // ── 태스크 → 폴더 헤더('into'): 해당 폴더 맨 끝으로 이동 ──
  if (srcType === 'task' && tgtType === 'folder') {
    const tk = tasks.find(t => t.id === srcId);
    if (!tk) return;
    const cnt = tasks.filter(t => t.folder_id === tgtId && t.id !== srcId).length;
    tk.folder_id = tgtId;
    tk.sort_order = (cnt + 1) * 10;
    renderTasks();
    fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/reorder`), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({orders: [{id: srcId, sort_order: tk.sort_order, folder_id: tgtId}]}),
    }).then(() => fetchTasks()).catch(() => fetchTasks());
    return;
  }

  // ── 태스크 → 폴더 내부 태스크: 그 폴더로 이동 + 폴더 내 위치 지정 ──
  if (srcType === 'task' && tgtType === 'task' && tgtFolderId != null) {
    const dest = tgtFolderId;
    const src = tasks.find(t => t.id === srcId);
    if (!src) return;
    const ft = tasks.filter(t => t.folder_id === dest && t.id !== srcId);
    const toIdx = ft.findIndex(t => t.id === tgtId);
    ft.splice(toIdx < 0 ? ft.length : (before ? toIdx : toIdx + 1), 0, src);
    src.folder_id = dest;
    ft.forEach((t, i) => { t.sort_order = (i + 1) * 10; });
    renderTasks();
    fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/reorder`), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({orders: ft.map(t => ({id: t.id, sort_order: t.sort_order, folder_id: dest}))}),
    }).then(() => fetchTasks()).catch(() => fetchTasks());
    return;
  }

  // ── 최상위 재배치: 폴더 또는 언그룹 태스크를 태스크/폴더 사이로 ──
  let items = _topLevelItems();
  let moved = null;
  const fromIdx = items.findIndex(it => it.kind === srcType && it.id === srcId);
  if (fromIdx >= 0) {
    [moved] = items.splice(fromIdx, 1);
  } else if (srcType === 'task') {
    // 폴더 내부 태스크를 최상위(언그룹)로 빼냄
    const tk = tasks.find(t => t.id === srcId);
    if (!tk) return;
    tk.folder_id = null;
    items = items.filter(it => !(it.kind === 'task' && it.id === srcId));
    moved = {kind: 'task', id: srcId};
  } else {
    return;
  }
  // 타겟의 최상위 슬롯(anchor) 결정
  let aKind, aId;
  if (tgtType === 'folder')      { aKind = 'folder'; aId = tgtId; }
  else if (tgtFolderId == null)  { aKind = 'task';   aId = tgtId; }       // 언그룹 태스크
  else                           { aKind = 'folder'; aId = tgtFolderId; } // 폴더 내부 태스크 → 그 폴더 슬롯
  const toIdx = items.findIndex(it => it.kind === aKind && it.id === aId);
  if (toIdx < 0) items.push(moved);
  else items.splice(before ? toIdx : toIdx + 1, 0, moved);
  _persistTopOrder(items);
}

// ── 폴더 기능 ─────────────────────────────────────────────
function toggleFolder(fid) {
  if (_dndJustDropped) return;  // DnD 직후 spurious click 무시
  if (_collapsedFolders.has(fid)) _collapsedFolders.delete(fid);
  else _collapsedFolders.add(fid);
  renderTasks();
}

// 모든 폴더 펼치기/접기 토글 (하나라도 접혀 있으면 전체 펼침, 아니면 전체 접힘)
function toggleAllFolders() {
  if (!_folders.length) return;
  const anyCollapsed = _folders.some(f => _collapsedFolders.has(f.id));
  if (anyCollapsed) _collapsedFolders.clear();
  else _folders.forEach(f => _collapsedFolders.add(f.id));
  renderTasks();
}

// 전체 펼치기/접기 버튼 라벨을 현재 상태에 맞게 갱신
function _updateToggleFoldersBtn() {
  const btn = document.getElementById('btn-toggle-folders');
  if (!btn) return;
  if (!_folders.length) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const anyCollapsed = _folders.some(f => _collapsedFolders.has(f.id));
  btn.innerHTML = anyCollapsed ? '⊞ 전체 펼치기' : '⊟ 전체 접기';
}

async function createFolder() {
  if (!currentProjectId) return;
  const name = await showInput('폴더 이름을 입력하세요.', {title:'새 폴더', ok:'만들기', placeholder:'폴더 이름'});
  if (!name || !name.trim()) return;
  await fetch(apiUrl(`/api/projects/${currentProjectId}/folders`), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name: name.trim() }),
  });
  await fetchTasks();
}

async function renameFolder(fid) {
  if (!currentProjectId) return;
  const f = _folders.find(x => x.id === fid);
  const cur = f ? f.name : '';
  const name = await showInput('폴더 이름을 변경합니다.', {title:'폴더 이름 변경', ok:'변경', defaultValue: cur, placeholder:'폴더 이름'});
  if (!name || !name.trim() || name.trim() === cur) return;
  await fetch(apiUrl(`/api/projects/${currentProjectId}/folders/${fid}/rename`), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name: name.trim() }),
  });
  await fetchTasks();
}

async function deleteFolder(fid) {
  const f = _folders.find(x => x.id === fid);
  const name = f ? `"${f.name}"` : '이 폴더';
  if (!await showConfirm(`${name} 폴더를 삭제할까요?\n태스크는 폴더 없음으로 이동됩니다.`, {type:'delete', ok:'삭제'})) return;
  await fetch(apiUrl(`/api/projects/${currentProjectId}/folders/${fid}`), { method: 'DELETE' });
  _collapsedFolders.delete(fid);
  // 낙관적 제거 + seq 가드: 진행 중이거나 이전에 시작된 fetchTasks 가
  // 서버의 (아직 반영 전) 폴더 목록으로 삭제된 폴더를 되살려 행이 남는 것을 막는다.
  _folders = _folders.filter(x => x.id !== fid);
  _folderDone = ++_folderSeq;
  renderTasks();
  await fetchTasks();
}

function openMoveToFolder(tid, event) {
  event.stopPropagation();
  const existing = document.getElementById('_folder-dropdown');
  if (existing) { existing.remove(); return; }
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const items = [
    `<div class="fmd-item" onclick="moveTaskToFolder(${tid},null)">📭 폴더 없음</div>`,
    ..._folders.map(f => `<div class="fmd-item" onclick="moveTaskToFolder(${tid},${f.id})">${esc(f.name)}</div>`),
    _folders.length === 0 ? `<div class="fmd-empty">폴더가 없습니다</div>` : '',
  ].join('');
  const div = document.createElement('div');
  div.id = '_folder-dropdown';
  div.className = 'fmd-popup';
  div.style.cssText = `position:fixed;top:${rect.bottom+4}px;right:${Math.max(0, window.innerWidth-rect.right)}px;`;
  div.innerHTML = items;
  document.body.appendChild(div);
  setTimeout(() => {
    document.addEventListener('click', function h() { div.remove(); document.removeEventListener('click', h); }, { once: true });
  }, 10);
}

async function moveTaskToFolder(tid, folderId) {
  const drop = document.getElementById('_folder-dropdown');
  if (drop) drop.remove();
  await fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/${tid}/move`), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ folder_id: folderId }),
  });
  await fetchTasks();
}

function toggleDetail(id) {
  const el = document.getElementById('detail-' + id);
  if (el) el.classList.toggle('open');
}

// ── 태스크 상세 팝업 ───────────────────────────────────────
let _tdTaskId = null;

function openTaskDetail(id) {
  if (_dndJustDropped) return;  // 드래그 직후 spurious click 무시
  const tk = tasks.find(t => t.id === id);
  if (!tk) return;
  _tdTaskId = id;

  const dotColor = {pending:'#64748b', running:'#38bdf8', done:'#4ade80', error:'#f87171'};
  const badgeLabel = {pending:'대기', running:'실행 중', done:'완료', error:'실패'};
  const trigLabel = {manual:'수동', on_dependency:'선행 완료 후', schedule:'스케줄'};

  document.getElementById('td-dot').style.background = dotColor[tk.status] || '#64748b';
  document.getElementById('td-title').textContent = tk.text;
  const badge = document.getElementById('td-badge');
  badge.className = 'tk-badge ' + tk.status;
  badge.textContent = badgeLabel[tk.status] || tk.status;

  // 메타 정보
  const metaParts = [];
  metaParts.push(`<span>🔀 트리거: ${trigLabel[tk.trigger_type] || tk.trigger_type}</span>`);
  if (tk.last_run_model || tk.model_override) metaParts.push(`<span>🤖 모델: ${esc(tk.last_run_model || tk.model_override)}</span>`);
  if (tk.timeout_override > 0) metaParts.push(`<span>⏱ 타임아웃: ${tk.timeout_override}s</span>`);
  if (tk.started_at) metaParts.push(`<span>🕐 시작: ${_fmtTime(tk.started_at)}</span>`);
  if (tk.ended_at) metaParts.push(`<span>✓ 완료: ${_fmtTime(tk.ended_at)}</span>`);
  document.getElementById('td-meta').innerHTML = metaParts.join('');

  // 프롬프트
  const bodyWrap = document.getElementById('td-body-wrap');
  const bodyEl = document.getElementById('td-body');
  if (tk.body && tk.body.trim()) {
    bodyEl.textContent = tk.body;
    bodyWrap.style.display = '';
  } else {
    bodyWrap.style.display = 'none';
  }

  // 테스트 기준
  const testWrap = document.getElementById('td-test-wrap');
  const testEl = document.getElementById('td-test');
  if (tk.test && tk.test.trim()) {
    testEl.textContent = tk.test;
    testWrap.style.display = '';
  } else {
    testWrap.style.display = 'none';
  }

  // 답변 (마지막 실행의 최종 응답)
  const outWrap = document.getElementById('td-output-wrap');
  const outEl = document.getElementById('td-output');
  if (tk.output && tk.output.trim()) {
    outEl.textContent = tk.output;
    outWrap.style.display = '';
  } else {
    outWrap.style.display = 'none';
  }

  // 실행 버튼 상태
  const runBtn = document.getElementById('td-run-btn');
  if (runBtn) {
    if (tk.status === 'running') {
      runBtn.textContent = '⏸ 중지';
      runBtn.onclick = () => { closeTaskDetail(); stopHarness(); };
    } else {
      runBtn.textContent = '▷ 실행';
      runBtn.onclick = () => _tdRun();
    }
  }

  document.getElementById('task-detail-modal').style.display = 'flex';
}

function closeTaskDetail() {
  document.getElementById('task-detail-modal').style.display = 'none';
  _tdTaskId = null;
}

async function _tdOpenLog() {
  if (!_tdTaskId) return;
  const id = _tdTaskId;
  closeTaskDetail();
  try {
    const r = await fetch(apiUrl(`/api/runs?task_id=${id}`));
    const runs = await r.json();
    if (!runs.length) {
      await showAlert('이 태스크의 실행 기록이 없습니다.');
      return;
    }
    showView('log');
    openRun(runs[0].id); // 가장 최근 실행
  } catch(e) {
    await showAlert('로그를 불러오지 못했습니다.');
  }
}

function _tdEdit() {
  const id = _tdTaskId;
  closeTaskDetail();
  openEdit(id);
}

function _tdRun() {
  const id = _tdTaskId;
  closeTaskDetail();
  runTask(id);
}

function elapsed(start, end) {
  if (!start || !end) return '';
  const s = Math.round((new Date(end) - new Date(start)) / 1000);
  return s >= 60 ? Math.floor(s/60) + '분 ' + (s%60) + '초' : s + '초';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function appendLog(msg) {
  const now = new Date().toLocaleTimeString('ko-KR', {hour12:false});
  const line = `[${now}] ${msg}\n`;
  logLines.push(line);
  ['log-box','log-box2'].forEach(id => {
    const box = document.getElementById(id);
    if (box) { box.textContent += line; box.scrollTop = box.scrollHeight; }
  });
}

function setRunning(isRunning) {
  document.querySelectorAll('#btn-start').forEach(b => b.disabled = isRunning);
  document.querySelectorAll('#btn-stop').forEach(b => b.disabled = !isRunning);
}

// ── run_done 상태 즉시 반영 ────────────────────────────────
async function _applyRunDone(d) {
  const status = d.status || 'done';
  // 배지 + 점 업데이트
  const dot = document.getElementById('rl-d-dot');
  if (dot) dot.className = 'rl-dot ' + (status === 'error' ? 'error' : 'done');
  const badge = document.getElementById('rl-d-badge');
  if (badge) {
    badge.className = 'rl-badge ' + status;
    badge.textContent = {done:'완료', error:'실패'}[status] || status;
  }
  // 커서 제거
  document.querySelectorAll('#rl-tab-log .rl-cursor').forEach(el => el.remove());
  // 소요 시간
  const durEl = document.getElementById('rl-d-dur');
  if (durEl && d.duration_sec != null) durEl.textContent = _fmtDur(d.duration_sec) + ' 소요';
  // 시도 칩 업데이트
  const attEl = document.getElementById('rl-d-attempts');
  if (attEl) {
    const startTxt = attEl.querySelector('.rl-attempt-chip')?.textContent?.match(/\d{2}:\d{2}/)?.[0] || '';
    attEl.innerHTML = `<button class="rl-attempt-chip active">#1 ${status === 'error' ? '실패' : '완료'}${startTxt ? ' · ' + startTxt : ''}</button>`;
  }
  // 완료/보강 후 최신 run 데이터로 로그·출력·Git·스크린샷 탭을 재렌더한다.
  // (antigravity 등 비동기 보강으로 git/스크린샷이 나중에 채워지는 경우 대응)
  try {
    const r = await fetch(apiUrl(`/api/runs/${d.run_id}`));
    const run = await r.json();
    if (!run || !run.id) return;
    _renderRlConsole(run.log_lines || [], false);
    const outEl = document.getElementById('rl-tab-output');
    if (outEl) outEl.textContent = run.output || t('rl.no_output');
    // Git 탭
    const gitBtn = document.getElementById('rl-tab-git-btn');
    const hasGit = run.git_task_branch && run.git_merge_status !== 'no_git';
    if (gitBtn) gitBtn.style.display = hasGit ? '' : 'none';
    if (hasGit) _renderGitTab(run);
    // 스크린샷 탭
    const shotBtn = document.getElementById('rl-tab-shot-btn');
    const shotBox = document.getElementById('rl-tab-shot');
    if (run.screenshot) {
      if (shotBtn) shotBtn.style.display = '';
      const _purl = run.preview_url || '';
      const _urlRow = _purl
        ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;background:var(--bg2);border-radius:6px;border:1px solid var(--border);">
             <span style="font-size:0.75rem;color:var(--text-mute);white-space:nowrap;">URL</span>
             <a href="${_purl}" target="_blank" style="color:var(--accent);font-size:0.85rem;word-break:break-all;">${_purl}</a>
           </div>`
        : '';
      if (shotBox) shotBox.innerHTML =
        `<div style="padding:12px;">
           ${_urlRow}
           <div style="font-size:0.75rem;color:var(--text-mute);margin-bottom:8px;">${t('rl.screenshot_caption')} · <a href="${run.screenshot}" target="_blank" style="color:var(--accent);">${t('rl.screenshot_open')}</a></div>
           <a href="${run.screenshot}" target="_blank">
             <img src="${run.screenshot}" style="max-width:100%;border:1px solid var(--border);border-radius:8px;display:block;" alt="${t('rl.screenshot_alt')}">
           </a>
         </div>`;
    } else {
      if (shotBtn) shotBtn.style.display = 'none';
      if (shotBox) shotBox.innerHTML = '';
    }
    // 안티그래비티 세션 탭
    const agBtn = document.getElementById('rl-tab-ag-btn');
    const agSes = run.antigravity_session;
    const hasAg = agSes && ((agSes.inputs || []).length || (agSes.steps || []).length);
    if (agBtn) agBtn.style.display = hasAg ? '' : 'none';
    if (hasAg) _renderRlAgTab(agSes);
  } catch {}
}

// ── 서버 재시작 감지 ──────────────────────────────────────
let _serverStartedAt = null;
let _toastTimer = null;

let _reloadScheduled = false;
async function _checkServerRestart() {
  try {
    const r = await fetch('/api/ping');
    if (!r.ok) return;
    const d = await r.json();
    if (_serverStartedAt && d.started_at !== _serverStartedAt && !_reloadScheduled) {
      // 서버가 재시작되면 갱신된 프론트 코드(dist/app.js·index.html)를 받기 위해
      // 페이지를 자동 새로고침한다. (SPA 라 해시 이동만으론 옛 코드가 메모리에 남음)
      _reloadScheduled = true;
      _showRestartToast();
      setRunning(false);
      setTimeout(() => location.reload(), 2000);
      return;
    }
    if (!_serverStartedAt) _serverStartedAt = d.started_at;
  } catch {}
}

function _showRestartToast() {
  clearTimeout(_toastTimer);
  const el = document.getElementById('server-restart-toast');
  if (!el) return;
  el.classList.remove('hiding');
  el.style.display = 'flex';
  _toastTimer = setTimeout(() => dismissRestartToast(), 8000);
}

function dismissRestartToast() {
  clearTimeout(_toastTimer);
  const el = document.getElementById('server-restart-toast');
  if (!el) return;
  el.classList.add('hiding');
  setTimeout(() => { el.style.display = 'none'; el.classList.remove('hiding'); }, 220);
}

function startSSE() {
  if (es) { es.close(); }
  es = new EventSource('/api/events');
  es.onopen = () => { setHeaderStatus(true, t('header.connected')); _checkServerRestart(); fetchTasks(); };
  // 셸/플러그인으로 이벤트 포워딩 (기존 핸들러와 병행)
  ['status','task_start','task_done','tasks_changed','run_done','plugins_changed','shell_navigate','session_output','session_status'].forEach(ev => {
    es.addEventListener(ev, e => {
      let d = {}; try { d = JSON.parse(e.data); } catch (_) {}
      if (window.EP4Shell) {
        EP4Shell.dispatchSSE(ev, d);
        if (ev === 'plugins_changed') EP4Shell.reload();
        if (ev === 'shell_navigate' && d.route) {
          const q = Object.assign({}, d.params || {});
          if (d.action) q.action = d.action;
          EP4Shell.navigate(d.route, q);
        }
      }
    });
  });
  es.addEventListener('status', e => {
    const d = JSON.parse(e.data);
    if (!_ssePeerMatch(d) || (d.project_id && d.project_id !== currentProjectId)) { fetchProjects(); return; }
    setRunning(d.status === 'running');
    if (d.message) appendLog('◆ ' + d.message);
    fetchTasks();
    fetchProjects();
  });
  es.addEventListener('task_start', e => {
    const d = JSON.parse(e.data);
    if (!_ssePeerMatch(d) || (d.project_id && d.project_id !== currentProjectId)) { fetchProjects(); return; }
    appendLog('▶ ' + (d.title || d.text || ''));
    fetchTasks();
  });
  es.addEventListener('tasks_changed', e => {
    // 로컬 변경 또는 peer 릴레이 수신으로 태스크가 변경됨
    const d = JSON.parse(e.data);
    fetchProjects();
    if (_ssePeerMatch(d) && d.project_id === currentProjectId) fetchTasks();
  });
  es.addEventListener('gate_collab_request', e => {
    // 공동작업 요청 도착(소유자) — 공유 모달이 열려 있으면 목록 갱신
    const d = JSON.parse(e.data);
    appendLog(`🤝 공동작업 요청: ${d.name || d.user_id}`);
    const modal = document.getElementById('gate-modal');
    if (modal && modal.classList.contains('open') && d.project_id === currentProjectId) {
      _gateLoadRequests();
    }
  });
  es.addEventListener('gate_member_update', e => {
    // 내 권한 변경됨 — 공유 모달 상태 갱신
    const d = JSON.parse(e.data);
    const modal = document.getElementById('gate-modal');
    if (modal && modal.classList.contains('open') && d.project_id === currentProjectId) {
      _gateRenderState();
    }
  });
  es.addEventListener('task_done', e => {
    const d = JSON.parse(e.data);
    if (!_ssePeerMatch(d) || (d.project_id && d.project_id !== currentProjectId)) { fetchProjects(); return; }
    appendLog((d.status === 'done' ? '✓ 완료' : '✗ 실패') + ' · ' + (d.output||'').slice(0, 120));
    fetchTasks();
    fetchProjects();
    // 세션 출력 재로드는 sessions 플러그인의 onEvent(task_done)가 처리
  });
  es.addEventListener('task_log', e => {
    const d = JSON.parse(e.data);
    if (!_ssePeerMatch(d)) return;
    if (d.project_id && d.project_id !== currentProjectId) return;
    appendLog(d.message || '');
  });
  es.addEventListener('run_log', e => {
    const d = JSON.parse(e.data);
    if (!_ssePeerMatch(d)) return;
    if (d.run_id && d.run_id === _currentRunId) {
      const box = document.getElementById('rl-tab-log');
      if (box && _rlTab === 'log') {
        const entry = d.entry || {};
        const lvl = entry.level || 'INFO';
        const isEnd = (entry.msg || '').startsWith('—');
        const cur = box.querySelector('.rl-cursor');
        if (cur) cur.remove();
        const line = document.createElement('div');
        if (isEnd) {
          line.innerHTML = `<span class="rl-log-end">${esc(entry.msg)}</span>`;
        } else {
          line.innerHTML = `<span class="rl-log-ts">${esc(entry.ts||'')}</span> <span class="rl-log-${lvl}">${lvl.padEnd(5)}</span> ${esc(entry.msg||'')}`;
        }
        box.appendChild(line);
        const cursor = document.createElement('span');
        cursor.className = 'rl-cursor';
        box.appendChild(cursor);
        box.scrollTop = box.scrollHeight;
      }
    }
    if (document.getElementById('rl-list')?.style.display !== 'none') {
      loadRuns();
    }
  });

  es.addEventListener('run_done', e => {
    const d = JSON.parse(e.data);
    if (!_ssePeerMatch(d)) return;
    // 현재 열려있는 run 이 완료되면 상태 즉시 갱신
    if (d.run_id && d.run_id === _currentRunId) {
      _applyRunDone(d);
    }
    // 목록이 보이는 경우 목록도 갱신
    if (document.getElementById('rl-list')?.style.display !== 'none') {
      loadRuns();
    }
  });

  es.onerror = () => { setHeaderStatus(false, t('header.disconnected')); setTimeout(startSSE, 3000); };
}

async function startHarness() {
  if (!currentProjectId) { appendLog('⚠ 프로젝트를 먼저 선택하세요.'); return; }

  const selectedIds = [..._selectedTaskIds];
  if (selectedIds.length > 0) {
    // 선택된 태스크만 실행
    try {
      const resp = await fetch(apiUrl(`/api/projects/${currentProjectId}/run-selected`), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({task_ids: selectedIds})
      });
      const data = await resp.json();
      if (!data.ok) {
        appendLog(`✗ 시작 실패: ${data.msg || '서버 오류'}`);
        return;
      }
    } catch (e) {
      appendLog(`✗ 요청 오류: ${e.message}`);
      return;
    }
    setRunning(true);
    appendLog(`=== ${selectedIds.length}개 태스크 실행 시작 ===`);
    _selectedTaskIds.clear();
    _updateRunBtnLabel();
    await fetchTasks();
    return;
  }

  // 전체 실행
  await fetchTasks();
  const allFinished = tasks.length > 0 && tasks.every(tk => tk.status === 'done' || tk.status === 'error');
  const anyRunning  = tasks.some(tk => tk.status === 'running');
  let resetAll = false;
  if (anyRunning) {
    const ok = await showConfirm(
      '현재 실행 중인 태스크가 있습니다. 중지하고 처음부터 다시 실행할까요?',
      {title: '재실행', ok: '재실행', cancel: '취소', type: 'warning'}
    );
    if (!ok) return;
    resetAll = true;
  } else if (allFinished) {
    const ok = await showConfirm(
      `완료된 태스크 ${tasks.length}개를 처음부터 다시 실행할까요?`,
      {title: '재실행', ok: '재실행', cancel: '취소', type: 'confirm'}
    );
    if (!ok) return;
    resetAll = true;
  }
  try {
    const resp = await fetch(apiUrl(`/api/projects/${currentProjectId}/start`), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({reset_all: resetAll})
    });
    const data = await resp.json();
    if (!data.ok) {
      if (data.msg === 'already running') {
        appendLog('⚠ 이미 실행 중입니다. 잠시 후 다시 시도하거나 중지 후 실행하세요.');
      } else {
        appendLog(`✗ 시작 실패: ${data.msg || '서버 오류'}`);
      }
      return;
    }
  } catch (e) {
    appendLog(`✗ 요청 오류: ${e.message}`);
    return;
  }
  setRunning(true);
  appendLog('=== 실행 시작 ===');
  await fetchTasks();
}

async function stopHarness() {
  if (!currentProjectId) return;
  const ok = await showConfirm('실행 중인 태스크를 중지할까요?', {title: '중지 확인', ok: '중지', cancel: '취소', type: 'warning'});
  if (!ok) return;
  await fetch(apiUrl(`/api/projects/${currentProjectId}/stop`), {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  setRunning(false);
  appendLog('=== 중지됨 ===');
  await fetchTasks();
}

// ── Git 머지 모달 ─────────────────────────────────────────
let _gmProjBranch = '';

async function openGitMergeModal() {
  if (!currentProjectId) return;
  const modal = document.getElementById('git-merge-modal');
  const srcLabel = document.getElementById('gm-src-label');
  const sel = document.getElementById('gm-target-select');
  const result = document.getElementById('gm-result');
  const mergeBtn = document.getElementById('gm-merge-btn');
  if (!modal) return;

  srcLabel.textContent = '불러오는 중...';
  sel.innerHTML = '';
  result.style.display = 'none';
  mergeBtn.disabled = false;
  modal.classList.add('open');

  try {
    const r = await fetch(apiUrl(`/api/projects/${currentProjectId}/git-info`));
    const d = await r.json();
    if (!d.ok || !d.has_git) {
      srcLabel.textContent = 'Git 저장소가 설정되지 않았습니다.';
      mergeBtn.disabled = true;
      return;
    }
    if (!d.proj_branch) {
      srcLabel.textContent = '프로젝트 브랜치가 없습니다. 먼저 태스크를 실행하세요.';
      mergeBtn.disabled = true;
      return;
    }
    _gmProjBranch = d.proj_branch;
    srcLabel.textContent = `소스: ${d.proj_branch}`;
    const targets = d.branches.length ? d.branches : [d.default_branch];
    sel.innerHTML = targets.map(b =>
      `<option value="${esc(b)}"${b === d.default_branch ? ' selected' : ''}>${esc(b)}</option>`
    ).join('');
  } catch (e) {
    srcLabel.textContent = '정보를 불러오지 못했습니다: ' + e.message;
    mergeBtn.disabled = true;
  }
}

function closeGitMergeModal() {
  const modal = document.getElementById('git-merge-modal');
  if (modal) modal.classList.remove('open');
}

// ── Gate 공유 ─────────────────────────────────────────────
function _gateSession() {
  try { return JSON.parse(localStorage.getItem('ep4_gate') || '{}'); } catch { return {}; }
}
function _gateSaveSession(s) {
  try { localStorage.setItem('ep4_gate', JSON.stringify(s)); } catch {}
}
function _gateMsg(text, kind) {
  const el = document.getElementById('gate-msg');
  if (!el) return;
  if (!text) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent = text;
  el.style.background = kind === 'error' ? '#7f1d1d' : kind === 'ok' ? '#14532d' : 'var(--bg-soft)';
  el.style.color = '#fff';
}

async function openGateModal() {
  if (!currentProjectId) { showAlert('프로젝트를 먼저 선택하세요.'); return; }
  const modal = document.getElementById('gate-modal');
  if (!modal) return;
  _gateMsg('');
  const s = _gateSession();
  const urlEl = document.getElementById('gate-url');
  if (urlEl && s.url) urlEl.value = s.url;
  _gateRenderAuth();
  await _gateRenderState();
  modal.classList.add('open');
}
function closeGateModal() {
  const modal = document.getElementById('gate-modal');
  if (modal) modal.classList.remove('open');
}

function _gateRenderAuth() {
  const s = _gateSession();
  const loggedIn = !!s.token;
  document.getElementById('gate-login-fields').style.display = loggedIn ? 'none' : '';
  const li = document.getElementById('gate-logged-in');
  li.style.display = loggedIn ? 'flex' : 'none';
  if (loggedIn) document.getElementById('gate-me').textContent = s.user || s.email || '사용자';
  document.getElementById('gate-share-box').style.display = loggedIn ? '' : 'none';
  document.getElementById('gate-download-box').style.display = loggedIn ? '' : 'none';
}

async function gateLogin(isRegister) {
  const url = (document.getElementById('gate-url').value || '').trim().replace(/\/$/, '');
  const email = (document.getElementById('gate-email').value || '').trim();
  const pw = document.getElementById('gate-pw').value || '';
  const name = (document.getElementById('gate-name').value || '').trim();
  if (!url || !email || !pw) { _gateMsg('서버 URL, 이메일, 비밀번호를 입력하세요.', 'error'); return; }
  if (isRegister && !name) { _gateMsg('가입하려면 이름이 필요합니다.', 'error'); return; }
  const path = isRegister ? '/api/auth/register' : '/api/auth/login';
  const body = isRegister ? {name, email, password: pw} : {email, password: pw};
  try {
    const r = await fetch(url + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const d = await r.json();
    if (!d.ok) { _gateMsg(d.error || '실패', 'error'); return; }
    _gateSaveSession({url, token: d.token, user: d.name, user_id: d.user_id, email});
    _gateMsg('로그인되었습니다.', 'ok');
    _gateRenderAuth();
    await _gateRenderState();
  } catch (e) { _gateMsg('연결 실패: ' + e.message, 'error'); }
}

function gateLogout() {
  _gateSaveSession({url: _gateSession().url});
  _gateRenderAuth();
  _gateRenderState();
}

async function _gateRenderState() {
  const s = _gateSession();
  const pubBox = document.getElementById('gate-publish-box');
  const linkBox = document.getElementById('gate-linked-box');
  if (!s.token) { pubBox.style.display = 'none'; linkBox.style.display = 'none'; return; }
  let info = {};
  try {
    const r = await fetch(`/api/projects/${currentProjectId}/gate/info`);
    info = await r.json();
  } catch {}
  if (info && info.sync_enabled) {
    pubBox.style.display = 'none';
    linkBox.style.display = '';
    document.getElementById('gate-link-role').textContent =
      ({owner: '소유자', collaborator: '공동작업자', viewer: '읽기 전용(요청 가능)', pending: '승인 대기'}[info.gate_role] || info.gate_role);
    document.getElementById('gate-link-id').textContent = info.gate_project_id || '';
    document.getElementById('gate-viewer-actions').style.display =
      (info.gate_role === 'viewer' || info.gate_role === 'pending') ? '' : 'none';
    const ownerBox = document.getElementById('gate-owner-requests');
    if (info.gate_role === 'owner') {
      ownerBox.style.display = '';
      await _gateLoadRequests();
    } else {
      ownerBox.style.display = 'none';
    }
  } else {
    pubBox.style.display = '';
    linkBox.style.display = 'none';
  }
}

async function _gateLoadRequests() {
  const list = document.getElementById('gate-req-list');
  list.innerHTML = '<span style="font-size:.76rem;color:var(--text-mute);">불러오는 중…</span>';
  try {
    const r = await fetch(`/api/projects/${currentProjectId}/gate/requests`);
    const reqs = await r.json();
    if (!reqs.length) { list.innerHTML = '<span style="font-size:.76rem;color:var(--text-mute);">대기 중 요청 없음</span>'; return; }
    list.innerHTML = reqs.map(rq => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;">
        <span style="font-size:.8rem;">👤 ${esc(rq.name || rq.user_id)}</span>
        <span style="display:flex;gap:4px;">
          <button class="btn-accent btn-sm" onclick="gateApprove('${rq.user_id}', true)">승인</button>
          <button class="btn-outline btn-sm" onclick="gateApprove('${rq.user_id}', false)">거절</button>
        </span>
      </div>`).join('');
  } catch { list.innerHTML = '<span style="font-size:.76rem;color:#f87171;">요청 조회 실패</span>'; }
}

async function gatePublish() {
  const s = _gateSession();
  if (!s.token) { _gateMsg('먼저 로그인하세요.', 'error'); return; }
  _gateMsg('게시 중…');
  try {
    const r = await fetch(`/api/projects/${currentProjectId}/gate/publish`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({gate_url: s.url, token: s.token, gate_user: s.user, gate_user_id: s.user_id})
    });
    const d = await r.json();
    if (!d.ok) { _gateMsg(d.error || '게시 실패', 'error'); return; }
    _gateMsg('게시되었습니다. 공유 코드: ' + d.gate_project_id, 'ok');
    await _gateRenderState();
    fetchProjects();
  } catch (e) { _gateMsg('오류: ' + e.message, 'error'); }
}

async function gateDownload(mode) {
  const s = _gateSession();
  if (!s.token) { _gateMsg('먼저 로그인하세요.', 'error'); return; }
  const gpid = (document.getElementById('gate-dl-id').value || '').trim();
  if (!gpid) { _gateMsg('공유 코드를 입력하세요.', 'error'); return; }
  _gateMsg('가져오는 중…');
  try {
    const r = await fetch('/api/projects/connect-gate', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({gate_url: s.url, token: s.token, gate_project_id: gpid, mode,
                            gate_user: s.user, gate_user_id: s.user_id})
    });
    const d = await r.json();
    if (!d.ok) { _gateMsg(d.error || '가져오기 실패', 'error'); return; }
    _gateMsg(`가져왔습니다 (태스크 ${d.task_count}개). ${mode === 'collab' ? '동기화 시작됨.' : '독립 복사.'}`, 'ok');
    fetchProjects();
  } catch (e) { _gateMsg('오류: ' + e.message, 'error'); }
}

async function gateRequestCollab() {
  _gateMsg('요청 전송 중…');
  try {
    const r = await fetch(`/api/projects/${currentProjectId}/gate/request`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    const d = await r.json();
    if (!d.ok) { _gateMsg(d.error || '요청 실패', 'error'); return; }
    _gateMsg('공동작업을 요청했습니다. 소유자 승인을 기다리세요.', 'ok');
  } catch (e) { _gateMsg('오류: ' + e.message, 'error'); }
}

async function gateApprove(userId, approve) {
  try {
    const r = await fetch(`/api/projects/${currentProjectId}/gate/approve`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user_id: userId, approve})});
    const d = await r.json();
    if (!d.ok) { _gateMsg(d.error || '처리 실패', 'error'); return; }
    _gateMsg(approve ? '승인했습니다.' : '거절했습니다.', 'ok');
    await _gateLoadRequests();
  } catch (e) { _gateMsg('오류: ' + e.message, 'error'); }
}

async function doGitMerge() {
  if (!currentProjectId) return;
  const sel = document.getElementById('gm-target-select');
  const result = document.getElementById('gm-result');
  const mergeBtn = document.getElementById('gm-merge-btn');
  const target = sel ? sel.value : '';
  if (!target) { await showAlert('타겟 브랜치를 선택하세요.', {type: 'warning'}); return; }

  const ok = await showConfirm(
    `${_gmProjBranch} 를\n${target} 브랜치로 머지할까요?`,
    {title: '브랜치 머지', ok: '머지', cancel: '취소', type: 'confirm'}
  );
  if (!ok) return;

  mergeBtn.disabled = true;
  result.style.display = 'none';
  try {
    const r = await fetch(apiUrl(`/api/projects/${currentProjectId}/git-merge`), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({target_branch: target})
    });
    const d = await r.json();
    result.style.display = 'block';
    if (d.ok) {
      result.style.background = 'rgba(74,222,128,.1)';
      result.style.border = '1px solid rgba(74,222,128,.3)';
      result.style.color = '#4ade80';
      result.textContent = '✓ ' + (d.msg || '머지 완료');
    } else {
      result.style.background = 'rgba(248,113,113,.1)';
      result.style.border = '1px solid rgba(248,113,113,.3)';
      result.style.color = '#f87171';
      result.textContent = '✗ ' + (d.msg || '머지 실패');
      mergeBtn.disabled = false;
    }
  } catch (e) {
    result.style.display = 'block';
    result.style.background = 'rgba(248,113,113,.1)';
    result.style.border = '1px solid rgba(248,113,113,.3)';
    result.style.color = '#f87171';
    result.textContent = '✗ 요청 오류: ' + e.message;
    mergeBtn.disabled = false;
  }
}

async function resetHarness() {
  if (!currentProjectId) return;
  await fetch(apiUrl(`/api/projects/${currentProjectId}/reset`), {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  appendLog('=== 새로고침 ===');
  await fetchTasks();
}

async function runTask(id) {
  if (!currentProjectId) return;
  const r = await fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/${id}/run`), {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  const d = await r.json();
  if (!d.ok) { appendLog(d.msg || '실행 실패'); return; }
  setRunning(true);
  appendLog(`=== 태스크 실행 (id=${id}) ===`);
  await fetchTasks();
}

// 태스크 실행 세션 옵션. 값 규약은 서버 harness_runner 와 동일하다.
//   '' = 프로젝트 기본 · '__prev__' = 이전 태스크 세션 · '__new__' = 신규 세션
//   'claude:<id>' = 그 Claude 세션을 --resume 으로 이어서 실행
//   그 외 = 실행 중 대화형 세션 이름
const TASK_SESSION_HINTS = {
  '':         '프로젝트에 설정된 세션으로 실행합니다.',
  '__prev__': '이 프로젝트에서 마지막으로 실행한 세션을 이어서 씁니다. 없거나 종료됐으면 프로젝트 기본으로 실행합니다.',
  '__new__':  '실행할 때 세션을 새로 만들어 그 안에서 실행합니다.',
};

function _updateTaskSessionHint() {
  const sel  = document.getElementById('editSession');
  const hint = document.getElementById('editSessionHint');
  if (!sel || !hint) return;
  const v = sel.value;
  if (v.startsWith('claude:')) {
    const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
    hint.textContent = `이 클로드 세션의 대화를 이어서 실행합니다 (--resume). 세션이 기록된 디렉토리에서 실행되므로 태스크 worktree 는 쓰지 않습니다. · ${label}`;
    return;
  }
  hint.textContent = TASK_SESSION_HINTS[v] ?? `실행 중인 세션 '${v}'으로 프롬프트를 보냅니다.`;
}

function _addSessionOptGroup(sel, label, items) {
  if (!items.length) return;
  const grp = document.createElement('optgroup');
  grp.label = label;
  items.forEach(it => {
    const o = document.createElement('option');
    o.value = it.value;
    o.textContent = it.label;
    grp.appendChild(o);
  });
  sel.appendChild(grp);
}

async function _loadTaskSessionOptions(selected) {
  const sel = document.getElementById('editSession');
  if (!sel) return;
  const want = selected || '';
  sel.innerHTML = `<option value="">프로젝트 기본</option>
    <option value="__prev__">이전 태스크 세션</option>
    <option value="__new__">신규 세션 만들기</option>`;

  const [runningRes, claudeRes] = await Promise.allSettled([
    fetch(apiUrl('/api/sessions')).then(r => r.json()),
    currentProjectId
      ? fetch(apiUrl(`/api/projects/${currentProjectId}/claude-sessions`)).then(r => r.json())
      : Promise.resolve([]),
  ]);

  // 이 프로젝트가 실행했던 Claude 세션 — 이어서 실행할 대상
  let claudeItems = [];
  if (claudeRes.status === 'fulfilled' && Array.isArray(claudeRes.value)) {
    claudeItems = claudeRes.value.filter(s => s.session_id).map(s => {
      const short = s.session_id.slice(0, 8);
      const when  = s.last_ts ? ` · ${s.last_ts.slice(0, 10)}` : '';
      return { value: `claude:${s.session_id}`, label: `${s.title || short + '…'}${when}` };
    });
  } else if (claudeRes.status === 'rejected') {
    console.warn('클로드 세션 목록 로드 실패', claudeRes.reason);
  }
  // 저장된 값이 목록에 없으면(전사 삭제 등) 값이 유실되므로 되살려 둔다.
  if (want.startsWith('claude:') && !claudeItems.some(i => i.value === want)) {
    claudeItems.unshift({ value: want, label: `${want.slice(7, 15)}… (목록에 없음)` });
  }
  _addSessionOptGroup(sel, '클로드 세션 (이어서 실행)', claudeItems);

  // 실행 중인 대화형(명령프롬프트) 세션
  let running = [];
  if (runningRes.status === 'fulfilled' && Array.isArray(runningRes.value)) {
    running = runningRes.value.filter(s => s.status === 'running' && s.name).map(s => s.name);
  } else if (runningRes.status === 'rejected') {
    console.warn('세션 목록 로드 실패', runningRes.reason);
  }
  const isSpecial = want === '' || want === '__prev__' || want === '__new__' || want.startsWith('claude:');
  if (!isSpecial && !running.includes(want)) running.push(want);
  _addSessionOptGroup(sel, '대화형 세션', running.map(n => ({ value: n, label: n })));

  sel.value = want;
  if (sel.value !== want) sel.value = '';   // 값이 사라진 경우 기본으로
  _updateTaskSessionHint();
}

function openAdd() {
  document.getElementById('modal-title').textContent = '태스크 추가';
  document.getElementById('edit-id').value   = '';
  document.getElementById('edit-text').value = '';
  document.getElementById('edit-body').value = '';
  document.getElementById('edit-test').value = '';
  const pj = projects.find(p => p.id === currentProjectId);
  const editModel = document.getElementById('editModel');
  if (editModel) editModel.value = (pj && pj.model) || 'claude-fable-5';
  // 추가 시 기본 트리거는 '선행 태스크 완료 후' — 직전 수정에서 고른 값이 남지 않게 매번 초기화
  const trigEl = document.getElementById('editTrigger');
  if (trigEl) trigEl.value = 'on_dependency';
  _loadTaskSessionOptions('');
  document.getElementById('edit-modal').classList.add('open');
  document.getElementById('edit-body').focus();
}

function openEdit(id) {
  const tk = tasks.find(x => x.id === id);
  if (!tk) return;
  document.getElementById('modal-title').textContent = '태스크 수정';
  document.getElementById('edit-id').value   = id;
  document.getElementById('edit-text').value = tk.text;
  document.getElementById('edit-body').value = tk.body || '';
  document.getElementById('edit-test').value = tk.test || '';
  const trigEl = document.getElementById('editTrigger');
  if (trigEl) trigEl.value = tk.trigger_type || 'on_dependency';
  const editModel = document.getElementById('editModel');
  if (editModel) {
    const pj = projects.find(p => p.id === currentProjectId);
    editModel.value = tk.model_override || (pj && pj.model) || 'claude-fable-5';
  }
  _loadTaskSessionOptions(tk.session_override || '');
  document.getElementById('edit-modal').classList.add('open');
}

function closeModal() { document.getElementById('edit-modal').classList.remove('open'); }

async function saveModal() {
  const idVal = document.getElementById('edit-id').value;
  const text  = document.getElementById('edit-text').value.trim();
  const tbody = document.getElementById('edit-body').value;
  const test  = document.getElementById('edit-test').value;
  const trigger = (document.getElementById('editTrigger') || {}).value || 'on_dependency';
  const modelOverride = (document.getElementById('editModel') || {}).value || '';
  const sessionOverride = (document.getElementById('editSession') || {}).value || '';
  // 제목·테스트는 선택 입력. 제목이 비면 서버가 프롬프트 첫 줄을 제목으로 쓴다.
  if (!text && !tbody.trim()) { await showAlert('제목이나 프롬프트 중 하나는 입력하세요.', {type:'warning'}); return; }
  if (!currentProjectId) { await showAlert('프로젝트를 먼저 선택하세요.', {type:'warning'}); return; }
  const payload = {title: text, prompt: tbody, test_criteria: test, trigger_type: trigger,
                   model_override: modelOverride, session_override: sessionOverride};
  if (idVal === '') {
    await fetch(apiUrl(`/api/projects/${currentProjectId}/tasks`), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
  } else {
    await fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/${parseInt(idVal)}/update`), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
  }
  closeModal();
  fetchTasks();
}

async function deleteTask(id) {
  if (!await showConfirm('이 태스크를 삭제할까요?', {type:'delete', ok:'삭제'})) return;
  if (!currentProjectId) return;
  await fetch(apiUrl(`/api/projects/${currentProjectId}/tasks/${id}/delete`), {
    method:'POST', headers:{'Content-Type':'application/json'}, body:'{}',
  });
  fetchTasks();
}

async function loadCliStatus() {
  const wrap = document.getElementById('cli-status-wrap');
  if (!wrap) return;
  try {
    const r = await fetch('/api/cli-status');
    const d = await r.json();
    const ok = d.installed && d.connected;
    const dotCls = ok ? 'ok' : (d.installed ? 'warn' : 'err');
    const title = ok ? t('cli.connected')
                 : d.installed ? t('cli.disconnected')
                 : t('cli.not_installed');
    const ver = (d.version || '').replace('Claude Code','').replace(/[()]/g,'').trim().split(/\s+/)[0] || '';
    const notInstalled = t('cli.chip.not_installed');
    const notLoggedIn  = t('cli.chip.not_logged_in');
    const actions = ok
      ? `<div class="cli-actions">
           <button class="cli-btn" onclick="cliSwitch()">${t('cli.switch')}</button>
           <button class="cli-btn" onclick="cliLogout()">${t('cli.logout')}</button>
         </div>`
      : d.installed
      ? `<div class="cli-actions">
           <button class="cli-btn primary" onclick="cliLogin()">${t('cli.login')}</button>
         </div>`
      : '';
    wrap.innerHTML = `
      <div class="cli-card">
        <div class="cli-card-head">
          <span class="cli-card-title">${title}</span>
          <span class="cli-glow ${dotCls}"></span>
        </div>
        <div class="cli-badges">
          <span class="cli-chip ${d.installed?'ok':'err'}">${d.installed?'✓ CLI'+(ver?' '+ver:''):notInstalled}</span>
          <span class="cli-chip ${d.connected?'ok':'err'}">${d.connected?t('cli.chip.connected'):notLoggedIn}</span>
        </div>
        ${d.email?`<div class="cli-email">${esc(d.email)}</div>`:''}
        ${actions}
      </div>`;
  } catch {
    document.getElementById('cli-status-wrap').innerHTML =
      `<div style="font-size:.7rem;color:var(--text-dim);margin-bottom:6px">CLI ${t('stat.error')}</div>`;
  }
}

async function cliLogin() {
  const r = await fetch('/api/cli-login', {method:'POST'}).then(x=>x.json()).catch(()=>({ok:false}));
  if (r.ok) {
    appendLog('🔐 Claude 로그인 터미널을 열었습니다. 완료 후 잠시 기다리세요.');
    setTimeout(loadCliStatus, 8000);
  }
}

async function cliLogout() {
  if (!await showConfirm('Claude CLI에서 로그아웃 하시겠습니까?', {type:'confirm', ok:'로그아웃'})) return;
  const r = await fetch('/api/cli-logout', {method:'POST'}).then(x=>x.json()).catch(()=>({ok:false}));
  appendLog(r.ok ? '🚪 Claude CLI 로그아웃 완료' : '✗ 로그아웃 실패: ' + (r.msg||''));
  loadCliStatus();
}

async function cliSwitch() {
  if (!await showConfirm('다른 계정으로 전환하시겠습니까?\n로그아웃 후 로그인 터미널이 열립니다.', {type:'confirm', ok:'전환'})) return;
  await fetch('/api/cli-logout', {method:'POST'});
  const r = await fetch('/api/cli-login', {method:'POST'}).then(x=>x.json()).catch(()=>({ok:false}));
  if (r.ok) {
    appendLog('🔄 계정 전환: 터미널에서 로그인하세요.');
    setTimeout(loadCliStatus, 8000);
  }
  loadCliStatus();
}

// ── Antigravity(Gemini) CLI 연결 상태 카드 ─────────────────
function _agLabel(key) {
  // 기존 Claude CLI i18n 문구를 재사용하되 'Claude CLI' → 'Antigravity' 로 치환
  return t(key).replace('Claude CLI', 'Antigravity').replace('Claude Code', 'Antigravity');
}
async function loadAntigravityStatus() {
  const wrap = document.getElementById('antigravity-status-wrap');
  if (!wrap) return;
  try {
    const r = await fetch('/api/antigravity-status');
    const d = await r.json();
    const ok = d.installed && d.connected;
    const dotCls = ok ? 'ok' : (d.installed ? 'warn' : 'err');
    const title = ok ? _agLabel('cli.connected')
                 : d.installed ? _agLabel('cli.disconnected')
                 : _agLabel('cli.not_installed');
    const cmd = d.command || 'gemini';
    const ver = (d.version || '').split(/\s+/)[0] || '';
    const cliChip = d.installed ? `✓ ${esc(cmd)}${ver?' '+esc(ver):''}` : t('cli.chip.not_installed');
    const actions = ok
      ? `<div class="cli-actions">
           <button class="cli-btn" onclick="agSwitch()">${t('cli.switch')}</button>
           <button class="cli-btn" onclick="agLogout()">${t('cli.logout')}</button>
         </div>`
      : d.installed
      ? `<div class="cli-actions">
           <button class="cli-btn primary" onclick="agLogin()">${t('cli.login')}</button>
         </div>`
      : '';
    wrap.innerHTML = `
      <div class="cli-card">
        <div class="cli-card-head">
          <span class="cli-card-title">${title}</span>
          <span class="cli-glow ${dotCls}"></span>
        </div>
        <div class="cli-badges">
          <span class="cli-chip ${d.installed?'ok':'err'}">${cliChip}</span>
          <span class="cli-chip ${d.connected?'ok':'err'}">${d.connected?t('cli.chip.connected'):t('cli.chip.not_logged_in')}</span>
        </div>
        ${d.email?`<div class="cli-email">${esc(d.email)}</div>`:''}
        ${actions}
      </div>`;
  } catch {
    wrap.innerHTML = `<div style="font-size:.7rem;color:var(--text-dim);margin-bottom:6px">Antigravity ${t('stat.error')}</div>`;
  }
}
async function agLogin() {
  const r = await fetch('/api/antigravity-login', {method:'POST'}).then(x=>x.json()).catch(()=>({ok:false}));
  if (r.ok) {
    appendLog('🔐 Antigravity 로그인 터미널을 열었습니다. 완료 후 잠시 기다리세요.');
    setTimeout(loadAntigravityStatus, 8000);
  } else {
    appendLog('✗ Antigravity 로그인 실패: ' + (r.msg||''));
  }
}
async function agLogout() {
  if (!await showConfirm('Antigravity(Gemini)에서 로그아웃 하시겠습니까?', {type:'confirm', ok:'로그아웃'})) return;
  const r = await fetch('/api/antigravity-logout', {method:'POST'}).then(x=>x.json()).catch(()=>({ok:false}));
  appendLog(r.ok ? '🚪 Antigravity 로그아웃 완료' : '✗ 로그아웃 실패: ' + (r.msg||''));
  loadAntigravityStatus();
}
async function agSwitch() {
  if (!await showConfirm('다른 계정으로 전환하시겠습니까?\n로그아웃 후 로그인 터미널이 열립니다.', {type:'confirm', ok:'전환'})) return;
  await fetch('/api/antigravity-logout', {method:'POST'});
  const r = await fetch('/api/antigravity-login', {method:'POST'}).then(x=>x.json()).catch(()=>({ok:false}));
  if (r.ok) {
    appendLog('🔄 Antigravity 계정 전환: 터미널에서 로그인하세요.');
    setTimeout(loadAntigravityStatus, 8000);
  }
  loadAntigravityStatus();
}

fetchProjects();
showView('projects');
startSSE();
loadCliStatus();
loadAntigravityStatus();
_checkServerRestart(); // 초기 start_time 등록 (이후 변경 시 토스트 표시)

// ── 채팅 ──────────────────────────────────────────────
const _chatHistory = [];
let _chatStreaming = false;
let _chatLoaded = false;
const _chatTxCache = {}; // { lang: { text: translatedText } }
let _chatTxPending = false;

function _renderChatMessages() {
  if (_chatStreaming) return;
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return;
  msgs.innerHTML = '';
  _chatHistory.forEach(h => {
    const cached = _autoTranslate && _curLang !== 'ko' && _chatTxCache[_curLang];
    const display = (cached && _chatTxCache[_curLang][h.text]) || h.text;
    _appendChatMsg(h.role, esc(display));
  });
  msgs.scrollTop = msgs.scrollHeight;
}

async function _translateChatHistory() {
  if (!_autoTranslate || _curLang === 'ko' || !_chatHistory.length) return;
  if (_chatTxPending) return;
  if (!_chatTxCache[_curLang]) _chatTxCache[_curLang] = {};

  const allTexts = _chatHistory.map(h => h.text).filter(Boolean);
  const uncached = [...new Set(allTexts)].filter(s => !_chatTxCache[_curLang][s]);
  if (!uncached.length) { _renderChatMessages(); return; }

  _chatTxPending = true;
  _setTxStatus(t('chat.translating'));
  try {
    const resp = await fetch('/api/translate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ texts: uncached, lang: _curLang }),
    });
    if (resp.ok) {
      const data = await resp.json();
      (data.translations || []).forEach((tr, i) => {
        if (uncached[i]) _chatTxCache[_curLang][uncached[i]] = tr;
      });
    } else {
      console.error('[AutoTranslate] chat /api/translate status:', resp.status);
    }
  } catch (err) {
    console.error('[AutoTranslate] chat error:', err);
  }
  _chatTxPending = false;
  _setTxStatus('');
  _renderChatMessages();
}

async function _loadChatHistory() {
  if (_chatLoaded) return;
  _chatLoaded = true;
  try {
    const r = await fetch('/api/chat/history');
    const msgs = await r.json();
    if (!Array.isArray(msgs) || msgs.length === 0) return;
    msgs.forEach(h => { _chatHistory.push(h); _appendChatMsg(h.role, esc(h.text)); });
    document.getElementById('chatMsgs').scrollTop = 999999;
    _translateChatHistory();
  } catch {}
}

async function _executeAction(action, bubble) {
  if (!action || !action.type) return;
  try {
    if (action.type === 'add_task') {
      const r = await fetch('/api/tasks', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: action.text || '', body: action.body || '', test: action.test || ''}),
      });
      const d = await r.json();
      if (d.ok) {
        fetchTasks();
        bubble.textContent += '\n✅ 태스크가 추가됐습니다.';
      } else {
        bubble.textContent += '\n❌ 태스크 추가 실패';
      }
    } else if (action.type === 'delete_task') {
      const r = await fetch('/api/tasks/delete-by-title', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title: action.title || ''}),
      });
      const d = await r.json();
      if (d.ok && d.deleted > 0) {
        fetchTasks();
        bubble.textContent += `\n✅ 태스크 ${d.deleted}개가 삭제됐습니다.`;
      } else {
        bubble.textContent += '\n❌ 일치하는 태스크를 찾지 못했습니다.';
      }
    }
  } catch (e) {
    bubble.textContent += '\n❌ 오류: ' + e.message;
  }
}

async function _saveChatMessage(role, text) {
  try {
    await fetch('/api/chat/message', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({role, text}),
    });
  } catch {}
}

async function clearChat() {
  if (!await showConfirm('대화 내용을 모두 삭제할까요?', {type:'delete', ok:'삭제'})) return;
  _chatHistory.length = 0;
  _chatLoaded = false;
  Object.keys(_chatTxCache).forEach(k => delete _chatTxCache[k]);
  try { await fetch('/api/chat/clear', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}); } catch {}
  document.getElementById('chatMsgs').innerHTML =
    '<div class="chat-msg-bot"><div class="chat-bubble-bot">안녕하세요! EasyProject4 사용에 대해 무엇이든 물어보세요.</div></div>';
}

function toggleChat() {
  const win = document.getElementById('chatWin');
  const isHidden = win.style.display === 'none';
  if (isHidden) {
    win.style.display = 'flex';
    win.classList.remove('chat-win-exit');
    win.classList.add('chat-win-enter');
    hideMascotBubble();
    _stopMascotWander();
    _loadChatHistory();
    setTimeout(() => {
      _mascotJumpOnChat();
      document.getElementById('chatInput').focus();
    }, 150);
  } else {
    win.classList.remove('chat-win-enter');
    win.classList.add('chat-win-exit');
    setTimeout(() => { win.style.display = 'none'; win.classList.remove('chat-win-exit'); }, 200);
    _mascotLeaveChat();
  }
}

function _appendChatMsg(role, html) {
  const msgs = document.getElementById('chatMsgs');
  const wrap = document.createElement('div');
  wrap.className = role === 'user' ? 'chat-msg-user' : 'chat-msg-bot';
  wrap.innerHTML = role === 'user'
    ? `<div class="chat-bubble-user">${html}</div>`
    : `<div class="chat-bubble-bot">${html}</div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

async function sendChat() {
  if (_chatStreaming) return;
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  _appendChatMsg('user', esc(msg));
  _chatHistory.push({role: 'user', text: msg});
  _saveChatMessage('user', msg);

  const botWrap = _appendChatMsg('bot', _autoTranslate ? t('chat.translating') : '…');
  const bubble = botWrap.querySelector('.chat-bubble-bot');
  const sendBtn = document.getElementById('chatSendBtn');
  sendBtn.disabled = true;
  _chatStreaming = true;

  try {
    const resp = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        message: msg,
        history: _chatHistory.slice(-6),
        lang: _autoTranslate ? _curLang : null,
        auto_translate: _autoTranslate,
      }),
    });
    if (!resp.ok || !resp.body) throw new Error('스트리밍 응답 실패');

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', fullText = '', event = '', pendingAction = null;
    bubble.textContent = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
        if (!line.startsWith('data: ')) { event = ''; continue; }
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { event = ''; continue; }
        if (event === 'delta') {
          fullText += data.text || '';
          bubble.textContent = fullText;
        } else if (event === 'replace') {
          fullText = data.text || fullText;
          bubble.textContent = fullText;
        } else if (event === 'done') {
          if (data.text) { fullText = data.text; bubble.textContent = fullText; }
          if (data.action) pendingAction = data.action;
        } else if (event === 'error') {
          bubble.textContent = '오류: ' + (data.error || '응답 실패');
        }
        event = '';
        document.getElementById('chatMsgs').scrollTop = 999999;
      }
    }
    if (fullText) { _chatHistory.push({role: 'assistant', text: fullText}); _saveChatMessage('assistant', fullText); }
    if (pendingAction) await _executeAction(pendingAction, bubble);
  } catch(e) {
    bubble.textContent = '오류: ' + e.message;
  } finally {
    _chatStreaming = false;
    sendBtn.disabled = false;
    document.getElementById('chatInput').focus();
  }
}

async function refreshSessionOptions() {
  let sessions = [];
  try { sessions = await (await fetch('/api/sessions')).json(); } catch (e) { sessions = []; }
  const sel = document.getElementById('pjFormSession');
  if (!sel) return;
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  sessions.filter(s => s.status === 'running').forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name; opt.textContent = `🟢 ${s.name}`;
    sel.appendChild(opt);
  });
  sessions.filter(s => s.status === 'dead').forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name; opt.textContent = `⚫ ${s.name} (종료됨)`;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

function setPjSessType(type) {
  const isCmd = type === 'cmd';
  document.getElementById('pjSessTypeCmd').style.background    = isCmd ? 'var(--accent)' : 'var(--bg)';
  document.getElementById('pjSessTypeCmd').style.color         = isCmd ? '#fff' : 'var(--text-mute)';
  document.getElementById('pjSessTypeClaude').style.background = isCmd ? 'var(--bg)' : 'var(--accent)';
  document.getElementById('pjSessTypeClaude').style.color      = isCmd ? 'var(--text-mute)' : '#fff';
  document.getElementById('pjSessPanelCmd').style.display    = isCmd ? '' : 'none';
  document.getElementById('pjSessPanelClaude').style.display = isCmd ? 'none' : '';
  if (!isCmd) refreshClaudeSessionOptions();
}

async function refreshClaudeSessionOptions() {
  const root = (document.getElementById('pjFormRoot') || {}).value || '';
  const sel = document.getElementById('pjClaudeSessionSelect');
  if (!sel) return;
  const cur = (document.getElementById('pjClaudeSessionId') || {}).value || '';
  while (sel.options.length > 1) sel.remove(1);
  if (!root) return;
  try {
    const r = await fetch(`/api/claude-sessions?root=${encodeURIComponent(root)}`);
    const data = await r.json();
    const sessions = Array.isArray(data) ? data : (data.sessions || []);
    sessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.session_id;
      const name = s.title || `${(s.session_id || '').slice(0,8)}…`;
      const preview = !s.title && s.first_prompt ? ` — ${s.first_prompt.slice(0, 40)}` : '';
      opt.textContent = `${name}${s.last_ts ? ` · ${s.last_ts.slice(0, 10)}` : ''}${preview}`;
      sel.appendChild(opt);
    });
  } catch (e) { console.warn('claude-sessions 로드 실패', e); }
  if (cur) sel.value = cur;
}

function onPjClaudeSessionSelect(val) {
  const inp = document.getElementById('pjClaudeSessionId');
  if (inp && val) inp.value = val;
}

// ── Mascot ─────────────────────────────────────────────
const MASCOT_DEFS = {
  octopus: {
    label: '문어', icon: '🐙', useGif: true,
    gifWander: ['basic','basic2','bird','cool','flag','idea','run','stand','worker','party'],
    stateEmoji: { basic: '🐙', run: '🐙', headset: '🐙', error: '🐙' },
    idleMsgs: [
      '안녕하세요! 무엇이든 물어보세요.',
      '태스크 실행 중에 도움이 필요하신가요?',
      '✨ 작업을 자동화해 드릴게요!',
      '궁금한 점이 있으면 클릭하세요.',
      '오늘도 열심히 일하고 있어요!',
      '태스크 상태를 확인해 보세요.',
    ],
  },
  penguin: {
    label: '펭귄', icon: '🐧', useGif: false,
    emojiWander: ['🐧', '❄️🐧', '🐧✨', '💙🐧', '🐧🎵'],
    stateEmoji: { basic: '🐧', run: '🐧', headset: '🐧', error: '🐧' },
    idleMsgs: [
      '뿅! 안녕하세요! 🐧',
      '❄️ 무엇이든 도와드릴게요!',
      '펭귄이 열심히 일하고 있어요~',
      '꽥꽥! 태스크를 클릭해보세요.',
      '빙글빙글 돌며 기다리고 있어요!',
    ],
  },
  cat: {
    label: '고양이', icon: '🐱', useGif: false,
    emojiWander: ['🐱', '😸', '😺', '😻', '🐱✨'],
    stateEmoji: { basic: '🐱', run: '🐱', headset: '🐱', error: '🙀' },
    idleMsgs: [
      '냐옹~ 무엇이 필요하신가요? 🐱',
      '😸 태스크를 실행해 드릴게요!',
      '고양이 도우미가 도착했어요~',
      '꾹꾹이 중... 잠깐만요.',
      '냐! 무엇이든 물어보세요.',
    ],
  },
  dog: {
    label: '강아지', icon: '🐶', useGif: false,
    emojiWander: ['🐶', '🐕', '🦮', '🐩', '🐶💫'],
    stateEmoji: { basic: '🐶', run: '🐕', headset: '🐶', error: '🐶' },
    idleMsgs: [
      '멍멍! 안녕하세요! 🐶',
      '🦴 태스크가 준비됐어요!',
      '강아지 도우미예요, 왈왈~',
      '꼬리 흔드는 중... 도움이 필요하신가요?',
      '멍! 무엇이든 물어보세요.',
    ],
  },
};

let _currentMascot = 'octopus';

let _mascotWanderTimer = null;
let _mascotBubbleTimer = null;
let _mascotIdleTimer   = null;
let _mascotDragging        = false;
let _mascotDragMoved       = false;
let _mascotLastTouchTs     = 0;
let _mascotOnChat          = false;
let _mascotChatBounceTimer = null;

// right/bottom 기반 위치
let _mascotPos = { right: 22, bottom: 22 };

function mascotSetGif(name) {
  const def = MASCOT_DEFS[_currentMascot];
  const img = document.getElementById('mascotImg');
  const emojiEl = document.getElementById('mascotEmoji');
  if (!img || !emojiEl) return;
  if (def.useGif) {
    img.src = '/mascots/' + name + '.gif';
  } else {
    emojiEl.textContent = def.stateEmoji[name] || def.stateEmoji.basic;
  }
}

function showMascotBubble(text) {
  const bubble = document.getElementById('mascotBubble');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.style.display = 'block';
  clearTimeout(_mascotBubbleTimer);
  _mascotBubbleTimer = setTimeout(hideMascotBubble, 3500);
}

function hideMascotBubble() {
  const bubble = document.getElementById('mascotBubble');
  if (bubble) bubble.style.display = 'none';
}

function _stopMascotWander() {
  clearTimeout(_mascotWanderTimer);
  _mascotWanderTimer = null;
}

function _startMascotWander() {
  _stopMascotWander();
  if (_mascotOnChat) return;
  _mascotWanderTimer = setTimeout(mascotWander, 6000 + Math.random() * 6000);
}

function _mascotJumpOnChat() {
  const el = document.getElementById('ep4Mascot');
  const wr = document.getElementById('chatWin')?.getBoundingClientRect();
  if (!el || !wr) return;
  _mascotOnChat = true;

  // left/top 기반으로 전환
  el.style.right  = 'auto';
  el.style.bottom = 'auto';

  function _bounce() {
    if (!_mascotOnChat) return;
    const w = document.getElementById('chatWin')?.getBoundingClientRect();
    if (!w) return;
    const minX = w.left + 10;
    const maxX = w.right - 70;
    const topY  = w.top - 56;
    const tx = minX + Math.random() * Math.max(0, maxX - minX);
    el.style.transition = 'left .4s cubic-bezier(.34,1.56,.64,1), top .4s cubic-bezier(.34,1.56,.64,1)';
    el.style.left = tx + 'px';
    el.style.top  = topY + 'px';
    if (_mascotChatBounceTimer) clearInterval(_mascotChatBounceTimer);
    _mascotChatBounceTimer = setInterval(() => {
      if (!_mascotOnChat) { clearInterval(_mascotChatBounceTimer); _mascotChatBounceTimer = null; return; }
      const cw = document.getElementById('chatWin')?.getBoundingClientRect();
      if (!cw) return;
      const nx = cw.left + 10 + Math.random() * Math.max(0, cw.right - 70 - (cw.left + 10));
      el.style.left = nx + 'px';
      el.style.top  = (cw.top - 56) + 'px';
      if (nx < parseFloat(el.style.left || '0')) el.classList.add('facing-left');
      else el.classList.remove('facing-left');
    }, 2500);
  }

  // 초기 점프: 채팅창 중앙 위
  el.style.transition = 'none';
  el.style.left = (wr.left + wr.width / 2 - 32) + 'px';
  el.style.top  = (wr.top - 56) + 'px';
  requestAnimationFrame(() => { requestAnimationFrame(() => { _bounce(); }); });
  mascotSetGif('headset');
}

function _mascotLeaveChat() {
  _mascotOnChat = false;
  if (_mascotChatBounceTimer) { clearInterval(_mascotChatBounceTimer); _mascotChatBounceTimer = null; }
  const el = document.getElementById('ep4Mascot');
  if (el) {
    // left/top → right/bottom 재변환
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    _mascotPos.right  = Math.max(16, vw - rect.right);
    _mascotPos.bottom = Math.max(16, vh - rect.bottom);
    el.style.transition = 'right .5s cubic-bezier(.16,1,.3,1), bottom .5s cubic-bezier(.16,1,.3,1)';
    el.style.left   = 'auto';
    el.style.top    = 'auto';
    el.style.right  = _mascotPos.right  + 'px';
    el.style.bottom = _mascotPos.bottom + 'px';
  }
  mascotSetGif('basic');
  _startMascotWander();
}

function mascotWander() {
  if (_mascotDragging || _mascotOnChat) return;
  const el = document.getElementById('ep4Mascot');
  if (!el) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const margin = 16, size = 64;
  _mascotPos.right  = Math.max(margin, Math.min(vw  - size - margin, _mascotPos.right  + (Math.random() - 0.5) * 120));
  _mascotPos.bottom = Math.max(margin, Math.min(vh  - size - margin, _mascotPos.bottom + (Math.random() - 0.5) * 80));
  el.style.transition = 'right 1.2s cubic-bezier(.16,1,.3,1), bottom 1.2s cubic-bezier(.16,1,.3,1)';
  el.style.right  = _mascotPos.right  + 'px';
  el.style.bottom = _mascotPos.bottom + 'px';

  const def = MASCOT_DEFS[_currentMascot];
  if (def.useGif) {
    const gif = def.gifWander[Math.floor(Math.random() * def.gifWander.length)];
    mascotSetGif(gif);
  } else {
    const emojiEl = document.getElementById('mascotEmoji');
    if (emojiEl) emojiEl.textContent = def.emojiWander[Math.floor(Math.random() * def.emojiWander.length)];
  }
  setTimeout(() => mascotSetGif('basic'), 4000);

  _startMascotWander();
}

function mascotIdleTalk() {
  if (_mascotDragging) return;
  const chatWin = document.getElementById('chatWin');
  if (chatWin && chatWin.style.display !== 'none') return;
  const msgs = MASCOT_DEFS[_currentMascot].idleMsgs;
  const msg = msgs[Math.floor(Math.random() * msgs.length)];
  showMascotBubble(msg);
  clearTimeout(_mascotIdleTimer);
  _mascotIdleTimer = setTimeout(mascotIdleTalk, 18000 + Math.random() * 12000);
}

// right/bottom → left/top 변환 (드래그는 left/top 기반)
function _mascotRBtoLT(el) {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

function setMascot(id) {
  if (id !== 'none' && !MASCOT_DEFS[id]) return;
  _currentMascot = id;
  localStorage.setItem('ep4_mascot', id);
  const mascotEl = document.getElementById('ep4Mascot');
  const img = document.getElementById('mascotImg');
  const emojiEl = document.getElementById('mascotEmoji');
  if (id === 'none') {
    if (mascotEl) mascotEl.style.display = 'none';
    _stopMascotWander();
    clearTimeout(_mascotIdleTimer);
  } else {
    const def = MASCOT_DEFS[id];
    if (mascotEl) mascotEl.style.display = '';
    if (img && emojiEl) {
      if (def.useGif) {
        img.style.display = 'block';
        emojiEl.style.display = 'none';
        mascotSetGif('basic');
      } else {
        img.style.display = 'none';
        emojiEl.style.display = 'flex';
        emojiEl.textContent = def.stateEmoji.basic;
      }
    }
    showMascotBubble(def.idleMsgs[0]);
  }
  document.querySelectorAll('.mascot-check').forEach(el => {
    el.style.display = el.dataset.mascot === id ? '' : 'none';
  });
  toggleSettingsDropdown();
}

function initMascot() {
  const el = document.getElementById('ep4Mascot');
  if (!el) return;

  // 저장된 마스코트 불러오기
  const saved = localStorage.getItem('ep4_mascot');
  if (saved === 'none') {
    _currentMascot = 'none';
    el.style.display = 'none';
    document.querySelectorAll('.mascot-check').forEach(chk => {
      chk.style.display = chk.dataset.mascot === 'none' ? '' : 'none';
    });
    return;
  } else if (saved && MASCOT_DEFS[saved]) {
    _currentMascot = saved;
    const def = MASCOT_DEFS[saved];
    const img = document.getElementById('mascotImg');
    const emojiEl = document.getElementById('mascotEmoji');
    if (img && emojiEl) {
      if (def.useGif) {
        img.style.display = 'block';
        emojiEl.style.display = 'none';
      } else {
        img.style.display = 'none';
        emojiEl.style.display = 'flex';
        emojiEl.textContent = def.stateEmoji.basic;
      }
    }
    document.querySelectorAll('.mascot-check').forEach(chk => {
      chk.style.display = chk.dataset.mascot === _currentMascot ? '' : 'none';
    });
  }

  el.style.right  = _mascotPos.right  + 'px';
  el.style.bottom = _mascotPos.bottom + 'px';

  // ── Mouse drag ──────────────────────────────────────
  el.addEventListener('mousedown', (e) => {
    if (Date.now() - _mascotLastTouchTs < 500) return;
    e.preventDefault();
    _mascotDragging = true;
    _mascotDragMoved = false;
    _stopMascotWander();
    hideMascotBubble();

    const lt = _mascotRBtoLT(el);
    const offsetX = e.clientX - lt.left;
    const offsetY = e.clientY - lt.top;
    const startX  = e.clientX;
    const startY  = e.clientY;

    // right/bottom → left/top 전환
    el.style.transition = 'none';
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
    el.style.left   = lt.left + 'px';
    el.style.top    = lt.top  + 'px';

    mascotSetGif('run');

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!_mascotDragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        _mascotDragMoved = true;
      }
      const vw = window.innerWidth, vh = window.innerHeight;
      const size = 64;
      const newLeft = Math.max(0, Math.min(vw - size, ev.clientX - offsetX));
      const newTop  = Math.max(0, Math.min(vh - size, ev.clientY - offsetY));
      el.style.left = newLeft + 'px';
      el.style.top  = newTop  + 'px';
      if (dx < -2) el.classList.add('facing-left');
      else if (dx > 2) el.classList.remove('facing-left');
    }

    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _mascotDragging = false;

      // left/top → right/bottom 재변환
      const vw = window.innerWidth, vh = window.innerHeight;
      const rect = el.getBoundingClientRect();
      _mascotPos.right  = vw  - rect.right;
      _mascotPos.bottom = vh  - rect.bottom;
      el.style.left   = 'auto';
      el.style.top    = 'auto';
      el.style.right  = _mascotPos.right  + 'px';
      el.style.bottom = _mascotPos.bottom + 'px';

      mascotSetGif('basic');

      if (_mascotDragMoved) {
        _startMascotWander();
      } else {
        toggleChat();
        _startMascotWander();
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── Touch drag ──────────────────────────────────────
  el.addEventListener('touchstart', (e) => {
    _mascotLastTouchTs = Date.now();
    e.preventDefault();
    _mascotDragging  = true;
    _mascotDragMoved = false;
    _stopMascotWander();
    hideMascotBubble();

    const touch = e.touches[0];
    const lt = _mascotRBtoLT(el);
    const offsetX = touch.clientX - lt.left;
    const offsetY = touch.clientY - lt.top;
    const startX  = touch.clientX;
    const startY  = touch.clientY;

    el.style.transition = 'none';
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
    el.style.left   = lt.left + 'px';
    el.style.top    = lt.top  + 'px';

    mascotSetGif('run');

    function onTouchMove(ev) {
      ev.preventDefault();
      const tc = ev.touches[0];
      const dx = tc.clientX - startX;
      const dy = tc.clientY - startY;
      if (!_mascotDragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        _mascotDragMoved = true;
      }
      const vw = window.innerWidth, vh = window.innerHeight;
      const size = 64;
      el.style.left = Math.max(0, Math.min(vw - size, tc.clientX - offsetX)) + 'px';
      el.style.top  = Math.max(0, Math.min(vh - size, tc.clientY - offsetY)) + 'px';
      if (dx < -2) el.classList.add('facing-left');
      else if (dx > 2) el.classList.remove('facing-left');
    }

    function onTouchEnd() {
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      _mascotDragging = false;

      const vw = window.innerWidth, vh = window.innerHeight;
      const rect = el.getBoundingClientRect();
      _mascotPos.right  = vw  - rect.right;
      _mascotPos.bottom = vh  - rect.bottom;
      el.style.left   = 'auto';
      el.style.top    = 'auto';
      el.style.right  = _mascotPos.right  + 'px';
      el.style.bottom = _mascotPos.bottom + 'px';

      mascotSetGif('basic');

      if (_mascotDragMoved) {
        _startMascotWander();
      } else {
        toggleChat();
        _startMascotWander();
      }
    }

    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
  }, { passive: false });

  _mascotWanderTimer = setTimeout(mascotWander, 8000 + Math.random() * 4000);
  _mascotIdleTimer   = setTimeout(mascotIdleTalk, 12000 + Math.random() * 6000);
}

document.addEventListener('DOMContentLoaded', initMascot);
