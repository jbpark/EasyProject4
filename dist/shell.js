/**
 * EP4 Shell — 플러그인 기반 셸 골격
 *
 * 역할:
 *  1) /api/plugins 레지스트리를 읽어 메뉴바를 동적으로 렌더링
 *  2) View 플러그인이 사용할 호스트 서비스(ctx) 제공
 *  3) 라우팅 (showView 위임) + 딥링크(action/query) 전달
 *
 * 내장(builtin) 뷰는 기존 app.js의 showView(route)를 그대로 재사용한다.
 * 추후 외부 View 플러그인은 view.js(ESM)를 import()해서 mount/unmount 한다.
 */
(function () {
  'use strict';

  // 부트 버전 캐시버스터: index.html 이 shell.js src 에 주입한 ?v=<_BOOT_VER> 를 읽어
  // 플러그인 view.js import 에 함께 붙인다. 서버를 재시작하면 _BOOT_VER 가 바뀌므로
  // plugin.json version 을 올리지 않아도 수정된 플러그인 모듈이 새로 로드된다.
  const _BOOT_VER = (function () {
    try {
      const src = (document.currentScript && document.currentScript.src) || '';
      const m = src.match(/[?&]v=([^&]+)/);
      if (m) return m[1];
    } catch (e) {}
    return String(Date.now());
  })();

  const Shell = {
    plugins: [],
    byRoute: {},
    _mounted: null,        // 현재 mount된 외부 플러그인 인스턴스
    _sseHandlers: {},      // event -> Set<fn>

    // ── 호스트 서비스 (플러그인에 주입되는 ctx) ──────────────
    ctx: {
      async api(path, opts) {
        const r = await fetch(path, opts);
        const ct = r.headers.get('content-type') || '';
        return ct.includes('json') ? r.json() : r.text();
      },
      sse: {
        on(event, fn) {
          (Shell._sseHandlers[event] = Shell._sseHandlers[event] || new Set()).add(fn);
          return () => Shell._sseHandlers[event] && Shell._sseHandlers[event].delete(fn);
        },
      },
      navigate(route, query) { Shell.navigate(route, query); },
      t(key) { return (typeof t === 'function') ? t(key) : key; },
      notify(msg, opts) {
        if (typeof showAlert === 'function') showAlert(msg, opts);
        else console.log('[notify]', msg);
      },
      confirm(msg, opts) {
        if (typeof showConfirm === 'function') return showConfirm(msg, opts);
        return Promise.resolve(window.confirm(msg));
      },
    },

    // ── 부팅 ────────────────────────────────────────────────
    async init() {
      this._wrapShowView();
      await this.loadRegistry();
      this.renderMenu();
      this.syncActiveNav();
      this._bootRoute();
    },

    // app.js의 showView를 래핑: 내장 뷰로 전환되면 외부 플러그인을 먼저 정리한다.
    // (_autoSelectProject 등이 부팅 후 showView를 호출해도 외부 뷰와 충돌하지 않도록)
    _wrapShowView() {
      if (typeof window.showView !== 'function' || window.showView._ep4Wrapped) return;
      const orig = window.showView;
      const self = this;
      const wrapped = function () {
        self._unmountExternal();
        return orig.apply(this, arguments);
      };
      wrapped._ep4Wrapped = true;
      window.showView = wrapped;
    },

    // 현재 표시 중인 내장 view-pane에 맞춰 메뉴 하이라이트 동기화
    syncActiveNav() {
      const active = document.querySelector('.view-pane.active');
      if (!active) return;
      const route = active.id.replace(/^view-/, '');
      const navEl = document.getElementById('nav-' + route);
      if (navEl) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        navEl.classList.add('active');
      }
    },

    async loadRegistry() {
      try {
        const data = await this.ctx.api('/api/plugins');
        this.plugins = (data && data.plugins) || [];
      } catch (e) {
        this.plugins = [];
      }
      this.byRoute = {};
      this.plugins.forEach(p => { if (p.route) this.byRoute[p.route] = p; });
      window.EP4_PLUGINS = this.plugins;   // 도우미/디버깅용 전역 노출
    },

    // 언어별 플러그인 이름/설명 해석
    _pluginName(p) {
      const lang = window._EP4_LANG || 'ko';
      return (p.names && (p.names[lang] || p.names.en || p.names.ko)) || p.name || p.id;
    },
    _pluginDesc(p) {
      const lang = window._EP4_LANG || 'ko';
      return (p.descriptions && (p.descriptions[lang] || p.descriptions.en || p.descriptions.ko)) || p.description || '';
    },

    // ── 메뉴 렌더링 ─────────────────────────────────────────
    renderMenu() {
      const host = document.getElementById('nav-menu-main');
      if (!host) return;
      const items = this.plugins
        .filter(p => p.enabled && (p.menu || {}).section === 'main');
      host.innerHTML = items.map(p => {
        const badge = (p.menu || {}).badge;
        const badgeHtml = badge
          ? `<span class="nav-badge" id="${badge.id}"${badge.hidden ? ' style="display:none"' : ''}>${badge.text || ''}</span>`
          : '';
        return `<div class="nav-item" id="nav-${p.route}" data-plugin="${p.id}"
                     onclick="EP4Shell.navigate('${p.route}')">
                  <span class="nav-icon">${p.icon || '•'}</span>
                  <span>${escapeHtml(this._pluginName(p))}</span>
                  ${badgeHtml}
                </div>`;
      }).join('');
    },

    // ── 라우팅 ──────────────────────────────────────────────
    navigate(route, query) {
      const plugin = this.byRoute[route];

      // 외부 View 플러그인(entry 있음, builtin 아님)은 import()로 mount
      if (plugin && plugin.entry && !plugin.builtin) {
        this._mountExternal(plugin, query || {});
        this._setHash(route, query);
        return;
      }

      // 내장 뷰 또는 미정의 라우트 → 기존 showView 위임
      this._unmountExternal();
      if (typeof showView === 'function') showView(route);
      this._applyQuery(plugin, query);
      this._setHash(route, query);
    },

    async _mountExternal(plugin, query) {
      this._unmountExternal();
      const container = document.getElementById('plugin-view-host');
      if (!container) return;
      // 내장 뷰 숨김
      document.querySelectorAll('.view-pane').forEach(el => { el.style.display = 'none'; });
      container.style.display = 'block';
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      const navEl = document.getElementById('nav-' + plugin.route);
      if (navEl) navEl.classList.add('active');
      // 상단 헤더 타이틀을 플러그인 정보로 갱신
      const vt = document.getElementById('view-title');
      const vs = document.getElementById('view-sub');
      if (vt) vt.textContent = this._pluginName(plugin);
      if (vs) vs.textContent = this._pluginDesc(plugin);
      try {
        const _v = encodeURIComponent((plugin.version || '1') + '.' + _BOOT_VER);
        const mod = await import(`/plugins/${plugin.id}/${plugin.entry}?v=${_v}`);
        const inst = (mod.default || mod);
        this._mounted = inst;
        await inst.mount(container, Object.assign({}, this.ctx, { query, plugin }));
      } catch (e) {
        container.innerHTML = `<div style="padding:40px;color:var(--text-mute)">플러그인 로드 실패: ${escapeHtml(plugin.id)}<br><small>${escapeHtml(String(e))}</small></div>`;
      }
    },

    _unmountExternal() {
      if (this._mounted) {
        try { this._mounted.unmount && this._mounted.unmount(); } catch (e) {}
        this._mounted = null;
      }
      const container = document.getElementById('plugin-view-host');
      if (container) { container.style.display = 'none'; container.innerHTML = ''; }
    },

    // 내장 뷰에 딥링크 action/query 전달 (선택적 훅)
    _applyQuery(plugin, query) {
      if (!query) return;
      if (typeof window.onDeeplink === 'function') {
        window.onDeeplink(plugin ? plugin.route : null, query);
      }
    },

    // ── 해시 라우팅 (#/view/{route}?k=v) ────────────────────
    _setHash(route, query) {
      let h = `#/view/${route}`;
      if (query && Object.keys(query).length) {
        h += '?' + Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      }
      if (location.hash !== h) history.replaceState(null, '', h);
    },

    _bootRoute() {
      const parsed = this._parseHash();
      if (parsed && this.byRoute[parsed.route]) {
        this.navigate(parsed.route, parsed.query);
      }
      window.addEventListener('hashchange', () => {
        const p = this._parseHash();
        if (p && this.byRoute[p.route]) this.navigate(p.route, p.query);
      });
    },

    _parseHash() {
      const m = (location.hash || '').match(/^#\/view\/([^?]+)(?:\?(.*))?$/);
      if (!m) return null;
      const query = {};
      if (m[2]) m[2].split('&').forEach(kv => {
        const [k, v] = kv.split('=');
        if (k) query[k] = decodeURIComponent(v || '');
      });
      return { route: m[1], query };
    },

    // ── SSE 디스패치 (app.js의 startSSE가 호출) ─────────────
    dispatchSSE(event, data) {
      const set = this._sseHandlers[event];
      if (set) set.forEach(fn => { try { fn(data); } catch (e) {} });
      if (this._mounted && this._mounted.onEvent) {
        try { this._mounted.onEvent({ event, data }); } catch (e) {}
      }
    },

    // 플러그인 변경 시 메뉴 다시 그림
    async reload() {
      await this.loadRegistry();
      this.renderMenu();
    },
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  window.EP4Shell = Shell;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Shell.init());
  } else {
    Shell.init();
  }
})();
