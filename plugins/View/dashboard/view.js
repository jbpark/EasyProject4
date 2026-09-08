const _DASH_I18N = {
  ko: { title: '대시보드', desc: '프로젝트 현황 요약 플러그인입니다.' },
  en: { title: 'Dashboard', desc: 'Project overview summary plugin.' },
};
function _dT(key) {
  const d = _DASH_I18N[window._EP4_LANG || 'ko'] || _DASH_I18N.ko;
  return d[key] || key;
}

export default {
  async mount(c, ctx) {
    c.innerHTML = `<div style='padding:40px;text-align:center'><div style='font-size:3rem'>📊</div><h2>${_dT('title')}</h2><p style='color:var(--text-mute)'>${_dT('desc')}</p></div>`;
  },
  unmount() {},
  onEvent() {},
  describe() { return { route: 'dashboard', summary: _dT('title'), actions: [] }; }
};
