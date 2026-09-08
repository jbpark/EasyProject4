/**
 * 플러그인 관리 View — 카드 그리드 UI
 *
 * 탭: 설치됨 | 마켓플레이스 + 우측 ⚙ 설정 버튼
 * 설치됨: View / MCP / Claude Skill(~/.claude/skills) / Claude Plugin / 도우미 통합 카드 그리드 (EP4 API 기반)
 */

const _PL_I18N = {
  ko: {
    tab_installed: '설치됨', tab_market: '마켓플레이스', tab_settings: '⚙ 설정',
    filter_all: '전체', filter_agent: '🤖 도우미', filter_data: '📦 Data',
    badge_agent: '도우미', badge_builtin: '내장',
    status_active: '활성', status_inactive: '비활성', status_required: '필수',
    status_in_use: '사용중', status_standby: '대기중',
    btn_disable: '끄기', btn_enable: '켜기', btn_select: '선택', btn_install: '설치', btn_reinstall: '재설치',
    btn_view: '보기', md_shared: '공유중', md_remote: '원격',
    share_on: '공유 켜기', share_off: '공유 끄기',
    notify_share_fail: '공유 설정 실패',
    btn_download: '다운로드',
    md_market_section: 'CLAUDE.md (다른 EP4)',
    md_market_hint: '— 설치 시 로컬에 해당 파일이 없을 때만 복사됩니다',
    md_market_empty: '연결된 peer EP4 가 공유한 CLAUDE.md 가 없습니다.',
    confirm_md_install: (t) => `'${t}' CLAUDE.md 를 로컬에 설치할까요?`,
    title_md_install: 'CLAUDE.md 설치',
    notify_md_installed: (p) => `📄 CLAUDE.md 설치 완료: ${p}`,
    cmd_market_section: 'Command (마켓)',
    cmd_market_empty: "마켓에 등록된 커맨드가 없습니다. Global 커맨드 카드의 '공유 켜기'로 등록할 수 있습니다.",
    confirm_cmd_install: (t) => `'/${t}' 커맨드를 ~/.claude/commands 에 설치할까요?`,
    title_cmd_install: '커맨드 설치',
    notify_cmd_installed: (p) => `⌨ 커맨드 설치 완료: ${p}`,
    btn_register: '마켓플레이스에 등록',
    btn_register_update: '마켓에 등록 (업데이트)',
    reg_status_none: '마켓 미등록',
    reg_status_same: '✓ 마켓에 등록됨',
    reg_status_diff: '마켓 등록본과 다름',
    notify_cmd_registered: (id) => `⌨ /${id} 마켓 등록 완료`,
    notify_cmd_reg_already: '이미 같은 내용으로 마켓에 등록되어 있습니다.',
    notify_cmd_share_summary: (reg, alr) => `⌨ 마켓 등록: 신규 ${reg}개 · 이미 등록됨 ${alr}개`,
    title_cmd_conflicts: '마켓 등록본 갱신',
    confirm_cmd_conflicts: (names) => `마켓 등록본과 내용이 다른 커맨드가 ${names.length}개 있습니다:\n${names.join(', ')}\n\n현재 로컬 버전으로 갱신할까요?`,
    confirm_cmd_overwrite: (a) => `마켓의 '/${a.id}' 등록본${a.host ? ` (등록: ${a.host})` : ''}과 내용이 다릅니다. 현재 버전으로 갱신할까요?`,
    notify_cmd_deleted_skip: (n) => `마켓에서 삭제된 커맨드 ${n}개는 자동 등록에서 제외됨 (설치됨 상세에서 개별 등록 가능)`,
    notify_skill_registered: (id) => `✦ ${id} 스킬 마켓 등록 완료`,
    confirm_skill_overwrite: (a) => `마켓의 '${a.id}' 스킬 등록본${a.host ? ` (등록: ${a.host})` : ''}과 내용이 다릅니다. 현재 버전으로 갱신할까요?`,
    skill_market_section: 'Skill (마켓)',
    skill_market_empty: "마켓에 등록된 스킬이 없습니다. 설치됨 > Claude Skill 상세의 '마켓플레이스에 등록'으로 등록할 수 있습니다.",
    confirm_skill_install: (id) => `'${id}' 스킬을 설치할까요?\n설치 위치(Global / 프로젝트)는 다음 단계에서 선택합니다.\n\n⚠ 서드파티 스킬은 Claude 가 실행할 스크립트를 포함할 수 있습니다.`,
    title_skill_install: '스킬 설치',
    notify_skill_installed: (p) => `✦ 스킬 설치 완료: ${p}`,
    confirm_skill_unregister: (id) => `마켓에서 '${id}' 스킬 등록을 삭제할까요?`,
    notify_skill_unregistered: (id) => `마켓에서 ${id} 스킬 삭제 완료`,
    title_skill_delete: '스킬 삭제',
    confirm_skill_delete: (a) => `'${a.id}' 스킬 폴더를 삭제할까요?\n\n${a.path}\n\n폴더 안의 모든 파일이 함께 삭제되며 되돌릴 수 없습니다.`,
    notify_skill_deleted: (id) => `🗑 스킬 삭제됨: ${id}`,
    title_skill_manual: '스킬 수동 등록',
    skill_manual_name_label: '스킬 이름 (폴더명)',
    skill_manual_name_ph: '예: my-skill (. # $ [ ] / \\ 금지)',
    skill_manual_content_label: 'SKILL.md 내용 (markdown, frontmatter 의 name·description 자동 인식)',
    notify_agent_registered: (id) => `🤖 ${id} 에이전트 마켓 등록 완료`,
    confirm_agent_overwrite: (a) => `마켓의 '${a.id}' 에이전트 등록본${a.host ? ` (등록: ${a.host})` : ''}과 내용이 다릅니다. 현재 버전으로 갱신할까요?`,
    agent_market_section: 'Agent (마켓)',
    agent_market_empty: "마켓에 등록된 서브 에이전트가 없습니다. 설치됨 > Claude Agent 상세의 '마켓플레이스에 등록'으로 등록할 수 있습니다.",
    confirm_agent_install: (id) => `'${id}' 서브 에이전트를 설치할까요?\n설치 위치(Global / 프로젝트)는 다음 단계에서 선택합니다.\n\n⚠ 서드파티 에이전트는 Claude 가 실행할 지시를 포함할 수 있습니다.`,
    title_agent_install: '에이전트 설치',
    notify_agent_installed: (p) => `🤖 에이전트 설치 완료: ${p}`,
    confirm_agent_unregister: (id) => `마켓에서 '${id}' 에이전트 등록을 삭제할까요?`,
    notify_agent_unregistered: (id) => `마켓에서 ${id} 에이전트 삭제 완료`,
    title_agent_delete: '에이전트 삭제',
    confirm_agent_delete: (a) => `'${a.id}' 에이전트 파일을 삭제할까요?\n\n${a.path}\n\n이 작업은 되돌릴 수 없습니다.`,
    notify_agent_deleted: (id) => `🗑 에이전트 삭제됨: ${id}`,
    title_agent_manual: '에이전트 수동 등록',
    agent_manual_name_label: '에이전트 이름 (파일명, 네임스페이스는 :)',
    agent_manual_name_ph: '예: my-agent 또는 team:reviewer',
    agent_manual_content_label: '에이전트 .md 내용 (markdown, frontmatter 의 name·description 자동 인식)',
    install_dest_global_agent: '🌐 Global — ~/.claude/agents',
    btn_cmd_delete: '🗑 삭제',
    title_cmd_delete: '커맨드 삭제',
    confirm_cmd_delete: (a) => `'/${a.id}' 커맨드 파일을 삭제할까요?\n\n${a.path}\n\n이 작업은 되돌릴 수 없습니다.`,
    notify_cmd_deleted: (p) => `🗑 커맨드 파일 삭제됨: ${p}`,
    btn_cmd_unregister: '🗑 마켓에서 삭제',
    title_cmd_unregister: '마켓에서 삭제',
    confirm_cmd_unregister: (id) => `마켓에서 '/${id}' 등록을 삭제할까요?\n\n삭제된 명령은 공유 켜기(자동 등록)로 다시 올라가지 않으며,\n설치됨 상세의 등록 버튼 또는 수동 등록으로만 재등록됩니다.`,
    notify_cmd_unregistered: (id) => `마켓에서 /${id} 삭제 완료`,
    btn_cmd_manual: '＋ 수동 등록',
    title_cmd_manual: '커맨드 수동 등록',
    cmd_manual_name_label: '명령 이름',
    cmd_manual_name_ph: '예: push 또는 review:pr (네임스페이스는 :)',
    cmd_manual_content_label: '내용 (markdown)',
    install_dest_title: '설치 위치 선택',
    install_dest_global: '🌐 Global — ~/.claude/commands',
    install_dest_global_skill: '🌐 Global — ~/.claude/skills',
    install_dest_empty: 'project_root 가 설정된 프로젝트가 없습니다.',
    md_exists_title: '이미 파일이 존재합니다',
    md_same: '두 파일의 내용이 동일합니다.',
    md_diff_legend: '− 로컬 파일 · + 원격(peer) 파일',
    btn_edit: '수정', btn_save: '저장', btn_cancel: '취소',
    md_backup_hint: '저장 시 기존 파일은 .bak 으로 백업됩니다',
    notify_md_saved: (b) => b ? `저장 완료 — 백업: ${b}` : '저장 완료',
    notify_md_save_fail: '저장 실패',
    installed_badge: '설치됨', not_installed: '미설치 (데이터 보존 중)',
    data_preserved: '플러그인 데이터는 언인스톨 후에도 보존됩니다. 재설치하면 자동으로 복구됩니다.',
    settings_title: '마켓플레이스 설정', settings_source: '마켓플레이스 소스',
    token_set: '✓ 토큰 설정됨. 변경하려면 새 토큰 입력, 유지하려면 비워두세요.',
    token_none: '(없음)', not_set: '(미설정)', token_set_label: '설정됨 ✓',
    set_firebase_url: 'Firebase DB URL을 설정해 주세요 (⚙ 설정).',
    set_manager_url: 'manager_server URL을 설정해 주세요 (⚙ 설정).',
    set_market_source: '⚙ 설정에서 마켓플레이스 소스를 설정하세요.',
    confirm_delete: (name) => `"${name}" 플러그인을 삭제하시겠습니까?`,
    title_delete: '플러그인 삭제',
    confirm_delete_data: (label) => `"${label}" 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
    notify_deleted: (name) => `${name} 삭제 완료`,
    notify_delete_fail: '삭제 실패', notify_installed: (id) => `${id} 설치 완료`,
    notify_install_fail: '설치 실패',
    title: '🧩 확장',
    empty_installed: '설치된 확장이 없습니다.',
    empty_installed_filter: (label) => `설치된 ${label} 항목이 없습니다.`,
    goto_market: '마켓플레이스에서 설치해 보세요 →',
    empty_data: '저장된 플러그인 데이터가 없습니다.',
    empty_firebase: 'Firebase DB에 플러그인이 없습니다.',
    empty_market: '플러그인이 없습니다.',
  },
  en: {
    tab_installed: 'Installed', tab_market: 'Marketplace', tab_settings: '⚙ Settings',
    filter_all: 'All', filter_agent: '🤖 Helper', filter_data: '📦 Data',
    badge_agent: 'Helper', badge_builtin: 'Built-in',
    status_active: 'Active', status_inactive: 'Inactive', status_required: 'Required',
    status_in_use: 'In Use', status_standby: 'Standby',
    btn_disable: 'Disable', btn_enable: 'Enable', btn_select: 'Select', btn_install: 'Install', btn_reinstall: 'Reinstall',
    btn_view: 'View', md_shared: 'Shared', md_remote: 'Remote',
    share_on: 'Share', share_off: 'Unshare',
    notify_share_fail: 'Failed to update sharing',
    btn_download: 'Download',
    md_market_section: 'CLAUDE.md (other EP4)',
    md_market_hint: '— installed only when the file does not exist locally',
    md_market_empty: 'No CLAUDE.md shared by connected peer EP4s.',
    confirm_md_install: (t) => `Install '${t}' CLAUDE.md locally?`,
    title_md_install: 'Install CLAUDE.md',
    notify_md_installed: (p) => `📄 CLAUDE.md installed: ${p}`,
    cmd_market_section: 'Command (marketplace)',
    cmd_market_empty: "No commands registered on the marketplace. Use 'Share' on a Global command card to register.",
    confirm_cmd_install: (t) => `Install '/${t}' command into ~/.claude/commands?`,
    title_cmd_install: 'Install Command',
    notify_cmd_installed: (p) => `⌨ Command installed: ${p}`,
    btn_register: 'Register to marketplace',
    btn_register_update: 'Register (update)',
    reg_status_none: 'Not on marketplace',
    reg_status_same: '✓ Registered on marketplace',
    reg_status_diff: 'Differs from marketplace',
    notify_cmd_registered: (id) => `⌨ /${id} registered to marketplace`,
    notify_cmd_reg_already: 'Already registered with identical content.',
    notify_cmd_share_summary: (reg, alr) => `⌨ Marketplace: ${reg} registered · ${alr} already registered`,
    title_cmd_conflicts: 'Update marketplace versions',
    confirm_cmd_conflicts: (names) => `${names.length} command(s) differ from the marketplace:\n${names.join(', ')}\n\nUpdate them to the current local versions?`,
    confirm_cmd_overwrite: (a) => `'/${a.id}' on the marketplace${a.host ? ` (by ${a.host})` : ''} differs. Update to this version?`,
    notify_cmd_deleted_skip: (n) => `${n} command(s) deleted from marketplace were excluded from auto-registration`,
    notify_skill_registered: (id) => `✦ Skill '${id}' registered to marketplace`,
    confirm_skill_overwrite: (a) => `Skill '${a.id}' on the marketplace${a.host ? ` (by ${a.host})` : ''} differs. Update to this version?`,
    skill_market_section: 'Skill (marketplace)',
    skill_market_empty: "No skills registered on the marketplace. Use 'Register to marketplace' in an installed skill's detail.",
    confirm_skill_install: (id) => `Install skill '${id}'?\nYou will choose the destination (Global / project) in the next step.\n\n⚠ Third-party skills may contain scripts that Claude will run.`,
    title_skill_install: 'Install Skill',
    notify_skill_installed: (p) => `✦ Skill installed: ${p}`,
    confirm_skill_unregister: (id) => `Remove skill '${id}' from the marketplace?`,
    notify_skill_unregistered: (id) => `Skill '${id}' removed from marketplace`,
    title_skill_delete: 'Delete Skill',
    confirm_skill_delete: (a) => `Delete skill folder '${a.id}'?\n\n${a.path}\n\nAll files in the folder will be deleted. This cannot be undone.`,
    notify_skill_deleted: (id) => `🗑 Skill deleted: ${id}`,
    title_skill_manual: 'Register Skill Manually',
    skill_manual_name_label: 'Skill name (folder name)',
    skill_manual_name_ph: 'e.g. my-skill (no . # $ [ ] / \\)',
    skill_manual_content_label: 'SKILL.md content (markdown; name/description auto-detected from frontmatter)',
    notify_agent_registered: (id) => `🤖 Agent '${id}' registered to marketplace`,
    confirm_agent_overwrite: (a) => `Agent '${a.id}' on the marketplace${a.host ? ` (by ${a.host})` : ''} differs. Update to this version?`,
    agent_market_section: 'Agent (marketplace)',
    agent_market_empty: "No sub-agents registered on the marketplace. Use 'Register to marketplace' in an installed agent's detail.",
    confirm_agent_install: (id) => `Install sub-agent '${id}'?\nYou will choose the destination (Global / project) in the next step.\n\n⚠ Third-party agents may contain instructions that Claude will act on.`,
    title_agent_install: 'Install Agent',
    notify_agent_installed: (p) => `🤖 Agent installed: ${p}`,
    confirm_agent_unregister: (id) => `Remove agent '${id}' from the marketplace?`,
    notify_agent_unregistered: (id) => `Agent '${id}' removed from marketplace`,
    title_agent_delete: 'Delete Agent',
    confirm_agent_delete: (a) => `Delete agent file '${a.id}'?\n\n${a.path}\n\nThis cannot be undone.`,
    notify_agent_deleted: (id) => `🗑 Agent deleted: ${id}`,
    title_agent_manual: 'Register Agent Manually',
    agent_manual_name_label: 'Agent name (file name; namespace with :)',
    agent_manual_name_ph: 'e.g. my-agent or team:reviewer',
    agent_manual_content_label: 'Agent .md content (markdown; name/description auto-detected from frontmatter)',
    install_dest_global_agent: '🌐 Global — ~/.claude/agents',
    btn_cmd_delete: '🗑 Delete',
    title_cmd_delete: 'Delete Command',
    confirm_cmd_delete: (a) => `Delete '/${a.id}' command file?\n\n${a.path}\n\nThis cannot be undone.`,
    notify_cmd_deleted: (p) => `🗑 Command file deleted: ${p}`,
    btn_cmd_unregister: '🗑 Remove from marketplace',
    title_cmd_unregister: 'Remove from marketplace',
    confirm_cmd_unregister: (id) => `Remove '/${id}' from the marketplace?\n\nDeleted commands are excluded from auto-registration;\nonly explicit registration (installed detail / manual) re-adds them.`,
    notify_cmd_unregistered: (id) => `/${id} removed from marketplace`,
    btn_cmd_manual: '＋ Register manually',
    title_cmd_manual: 'Register Command Manually',
    cmd_manual_name_label: 'Command name',
    cmd_manual_name_ph: 'e.g. push or review:pr (namespace with :)',
    cmd_manual_content_label: 'Content (markdown)',
    install_dest_title: 'Choose install destination',
    install_dest_global: '🌐 Global — ~/.claude/commands',
    install_dest_global_skill: '🌐 Global — ~/.claude/skills',
    install_dest_empty: 'No projects with project_root configured.',
    md_exists_title: 'File already exists',
    md_same: 'Both files are identical.',
    md_diff_legend: '− local file · + remote (peer) file',
    btn_edit: 'Edit', btn_save: 'Save', btn_cancel: 'Cancel',
    md_backup_hint: 'The existing file is backed up as .bak on save',
    notify_md_saved: (b) => b ? `Saved — backup: ${b}` : 'Saved',
    notify_md_save_fail: 'Save failed',
    installed_badge: 'Installed', not_installed: 'Not installed (data preserved)',
    data_preserved: 'Plugin data is preserved after uninstall. It will be restored automatically upon reinstall.',
    settings_title: 'Marketplace Settings', settings_source: 'Marketplace Source',
    token_set: '✓ Token is set. Enter a new token to change, leave blank to keep.',
    token_none: '(none)', not_set: '(not set)', token_set_label: 'Set ✓',
    set_firebase_url: 'Please set Firebase DB URL (⚙ Settings).',
    set_manager_url: 'Please set manager_server URL (⚙ Settings).',
    set_market_source: 'Please configure marketplace source in ⚙ Settings.',
    confirm_delete: (name) => `Delete plugin "${name}"?`,
    title_delete: 'Delete Plugin',
    confirm_delete_data: (label) => `Delete data "${label}"?\nThis action cannot be undone.`,
    notify_deleted: (name) => `${name} deleted`,
    notify_delete_fail: 'Delete failed', notify_installed: (id) => `${id} installed`,
    notify_install_fail: 'Install failed',
    title: '🧩 Extensions',
    empty_installed: 'No extensions installed.',
    empty_installed_filter: (label) => `No ${label} items installed.`,
    goto_market: 'Browse the Marketplace →',
    empty_data: 'No plugin data saved.',
    empty_firebase: 'No plugins in Firebase DB.',
    empty_market: 'No plugins found.',
  },
};
function _plT(key, arg) {
  const lang = (window._EP4_LANG || 'ko');
  const dict = _PL_I18N[lang] || _PL_I18N.ko;
  const val = dict[key] !== undefined ? dict[key] : (_PL_I18N.ko[key] || key);
  return typeof val === 'function' ? val(arg) : val;
}

export default {
  _ctx: null,
  _container: null,
  _activeTab: 'installed',   // 'installed' | 'marketplace' | 'settings'
  _activeFilter: 'all',        // 'all' | 'view' | 'mcp' | 'claude' | 'agent' | 'data'
  _claudeSubFilter: 'all',     // 설치됨 > Claude 서브 필터: 'all' | 'skill' | 'plugin'
  _marketFilter: 'all',        // 'all' | 'view' | 'mcp' | 'claude' | 'agent'
  _marketClaudeSub: 'all',     // 마켓 > Claude 서브 필터: 'all' | 'skill' | 'plugin'
  _searchText: '',
  _searchListener: null,
  _settingsEditing: false,
  _marketUrl: '',
  _marketSource: 'manager',    // 'manager' | 'firebase+github'
  _firebaseUrl: '',
  _githubRepo: '',
  _githubToken: '',            // 수정 중에만 사용, 저장 후 초기화
  _hasToken: false,            // conf 파일에 토큰이 있는지 여부

  _viewPlugins: [],
  _mcpConnectors: [],
  _claudeSkills: [],
  _claudeMdList: [],           // 글로벌 + 각 프로젝트의 CLAUDE.md 목록 (/api/claude/md)
  _claudeCommands: [],         // 글로벌 + 각 프로젝트의 슬래시 커맨드 목록 (/api/claude/commands)
  _marketSkills: [],           // 외부 마켓(GitHub 저장소)의 Claude Skill 목록
  _marketSkillsLoaded: false,
  _marketSkillsLoading: false,
  _marketSkillsError: '',
  _marketCommands: [],         // 마켓(Firebase)에 등록된 커맨드 스냅샷 목록
  _marketCommandsLoaded: false,
  _marketCommandsLoading: false,
  _marketCommandsError: '',
  _marketCommandsNoSource: false,
  _marketRegSkills: [],        // 마켓(Firebase)에 등록된 스킬 스냅샷 목록
  _marketRegSkillsLoaded: false,
  _marketRegSkillsLoading: false,
  _marketRegSkillsError: '',
  _marketRegSkillsNoSource: false,
  _claudeAgents: [],           // 글로벌 + 각 프로젝트의 서브 에이전트 목록 (/api/claude/agents)
  _marketRegAgents: [],        // 마켓(Firebase)에 등록된 서브 에이전트 스냅샷 목록
  _marketRegAgentsLoaded: false,
  _marketRegAgentsLoading: false,
  _marketRegAgentsError: '',
  _marketRegAgentsNoSource: false,
  _agentList: [],

  _marketPlugins: [],
  _marketLoading: false,
  _marketError: '',

  async mount(container, ctx) {
    this._ctx = ctx;
    this._container = container;
    this._activeTab = (ctx.query && ctx.query.tab) || 'installed';
    this._searchText = '';
    container.innerHTML = this._shell();
    this._bindShellEvents();
    this._searchListener = (e) => {
      this._searchText = (e.detail && e.detail.q) || '';
      this._renderBody();
    };
    container.addEventListener('ep4:search', this._searchListener);
    await this._loadSettings();
    await this._reload();
  },

  unmount() {
    if (this._searchListener && this._container) {
      this._container.removeEventListener('ep4:search', this._searchListener);
    }
    this._searchListener = null;
    this._searchText = '';
    this._ctx = null;
    this._container = null;
    this._viewPlugins = [];
    this._mcpConnectors = [];
    this._claudeSkills = [];
    this._claudeMdList = [];
    this._claudeCommands = [];
    this._marketCommands = [];
    this._marketCommandsLoaded = false;
    this._marketRegSkills = [];
    this._marketRegSkillsLoaded = false;
    this._claudeAgents = [];
    this._marketRegAgents = [];
    this._marketRegAgentsLoaded = false;
    this._marketPlugins = [];
    this._firebaseUrl = '';
    this._githubRepo = '';
    this._githubToken = '';
    this._hasToken = false;
    this._marketSource = 'manager';
  },

  onEvent(evt) {
    if (evt && evt.event === 'plugins_changed') this._reload();
  },

  describe() {
    return {
      route: 'plugins',
      summary: _plT('tab_installed'),
    };
  },

  // ── 데이터 로딩 ───────────────────────────────────────
  async _reload() {
    const [pluginsData, mcpData, claudeData, agentData, mdData, cmdData, cAgentData] = await Promise.all([
      this._ctx.api('/api/plugins').catch(() => null),
      this._ctx.api('/api/mcp/connectors').catch(() => null),
      this._ctx.api('/api/claude/skills').catch(() => null),
      this._ctx.api('/api/agents').catch(() => null),
      this._ctx.api('/api/claude/md').catch(() => null),
      this._ctx.api('/api/claude/commands').catch(() => null),
      this._ctx.api('/api/claude/agents').catch(() => null),
    ]);
    this._viewPlugins = (pluginsData && pluginsData.plugins) || [];
    this._mcpConnectors = (mcpData && mcpData.connectors) || [];
    this._claudeSkills = (claudeData && claudeData.skills) || [];
    this._agentList = (agentData && agentData.agents) || [];
    this._claudeMdList = (mdData && mdData.items) || [];
    this._claudeCommands = (cmdData && cmdData.commands) || [];
    this._claudeAgents = (cAgentData && cAgentData.agents) || [];
    this._renderAll();
  },

  async _loadSettings() {
    try {
      const conf = await this._ctx.api('/api/marketplace/config');
      this._marketSource = conf.source      || 'manager';
      this._firebaseUrl  = conf.firebase_url || '';
      this._githubRepo   = conf.github_repo  || '';
      this._marketUrl    = conf.manager_url  || '';
      this._hasToken     = conf.has_token    || false;
      this._githubToken  = '';
    } catch (_) {}
  },

  async _loadMarketplace() {
    this._loadMarketCommands(false);   // 커맨드 목록은 소스 URL 검사와 무관하게 병행 로드
    this._loadMarketRegSkills(false);  // 마켓 등록 스킬도 병행 로드
    this._loadMarketRegAgents(false);  // 마켓 등록 에이전트도 병행 로드
    const isFirebase = this._marketSource === 'firebase+github';
    if (isFirebase) {
      if (!this._firebaseUrl.trim()) {
        this._marketError = _plT('set_firebase_url');
        this._marketPlugins = [];
        this._renderBody();
        return;
      }
    } else {
      if (!this._marketUrl.trim()) {
        this._marketError = _plT('set_manager_url');
        this._marketPlugins = [];
        this._renderBody();
        return;
      }
    }
    this._marketLoading = true;
    this._marketError = '';
    this._renderBody();
    try {
      const apiUrl = isFirebase
        ? `/api/marketplace?source=firebase&firebase_url=${encodeURIComponent(this._firebaseUrl.trim())}`
        : `/api/marketplace?url=${encodeURIComponent(this._marketUrl.trim())}`;
      const data = await this._ctx.api(apiUrl);
      if (!data.ok) {
        this._marketError = data.error || '불러오기 실패';
        this._marketPlugins = [];
      } else {
        this._marketPlugins = data.plugins || [];
        this._marketError = '';
      }
    } catch (e) {
      this._marketError = String(e);
      this._marketPlugins = [];
    }
    this._marketLoading = false;
    this._renderBody();
    this._loadMarketSkills(false);
  },

  // 마켓(Firebase)에 등록된 커맨드 목록 — 서버가 60초 캐시로 응답
  async _loadMarketCommands(force) {
    if (this._marketCommandsLoading) return;
    if (this._marketCommandsLoaded && !force) return;
    this._marketCommandsLoading = true;
    try {
      const d = await this._ctx.api('/api/marketplace/commands' + (force ? '?refresh=1' : ''));
      const okObj = d && typeof d === 'object';
      this._marketCommands = (okObj && d.commands) || [];
      this._marketCommandsNoSource = !!(okObj && d.no_source);
      this._marketCommandsError = okObj
        ? ((!d.ok && d.error) || '')
        : '서버 응답 오류 — EP4 서버를 재시작해 주세요';
    } catch (e) {
      this._marketCommands = [];
      this._marketCommandsError = String(e);
    }
    this._marketCommandsLoading = false;
    this._marketCommandsLoaded = true;
    if (this._activeTab === 'marketplace') this._renderBody();
  },

  // 마켓(Firebase)에 등록된 스킬 목록 — 서버가 60초 캐시로 응답
  async _loadMarketRegSkills(force) {
    if (this._marketRegSkillsLoading) return;
    if (this._marketRegSkillsLoaded && !force) return;
    this._marketRegSkillsLoading = true;
    try {
      const d = await this._ctx.api('/api/marketplace/skills/registered' + (force ? '?refresh=1' : ''));
      const okObj = d && typeof d === 'object';
      this._marketRegSkills = (okObj && d.skills) || [];
      this._marketRegSkillsNoSource = !!(okObj && d.no_source);
      this._marketRegSkillsError = okObj
        ? (d.ok ? '' : (d.error || '불러오기 실패'))
        : '불러오기 실패';
    } catch (e) {
      this._marketRegSkills = [];
      this._marketRegSkillsError = String(e);
    }
    this._marketRegSkillsLoading = false;
    this._marketRegSkillsLoaded = true;
    if (this._activeTab === 'marketplace') this._renderBody();
  },

  // 마켓(Firebase)에 등록된 서브 에이전트 목록 — 서버가 60초 캐시로 응답
  async _loadMarketRegAgents(force) {
    if (this._marketRegAgentsLoading) return;
    if (this._marketRegAgentsLoaded && !force) return;
    this._marketRegAgentsLoading = true;
    try {
      const d = await this._ctx.api('/api/marketplace/agents/registered' + (force ? '?refresh=1' : ''));
      const okObj = d && typeof d === 'object';
      this._marketRegAgents = (okObj && d.agents) || [];
      this._marketRegAgentsNoSource = !!(okObj && d.no_source);
      this._marketRegAgentsError = okObj
        ? (d.ok ? '' : (d.error || '불러오기 실패'))
        : '불러오기 실패';
    } catch (e) {
      this._marketRegAgents = [];
      this._marketRegAgentsError = String(e);
    }
    this._marketRegAgentsLoading = false;
    this._marketRegAgentsLoaded = true;
    if (this._activeTab === 'marketplace') this._renderBody();
  },

  // 외부 GitHub 저장소의 Claude Skill 목록 — 서버가 zipball 캐시로 응답 (TTL 내 네트워크 0회)
  async _loadMarketSkills(force) {
    if (this._marketSkillsLoading) return;
    if (this._marketSkillsLoaded && !force) return;
    this._marketSkillsLoading = true;
    if (force) { this._marketSkillsLoaded = false; this._renderBody(); }
    try {
      const d = await this._ctx.api('/api/marketplace/skills' + (force ? '?refresh=1' : ''));
      this._marketSkills = (d && d.skills) || [];
      const errs = ((d && d.repos) || []).filter(r => r.error);
      this._marketSkillsError = errs.length ? errs.map(r => `${r.repo}: ${r.error}`).join(' / ') : '';
    } catch (e) {
      this._marketSkills = [];
      this._marketSkillsError = String(e);
    }
    this._marketSkillsLoading = false;
    this._marketSkillsLoaded = true;
    if (this._activeTab === 'marketplace') this._renderBody();
  },

  // ── 마켓 상세 오버레이 ─────────────────────────────────
  _openMarketDetailOverlay(html) {
    this._closeMarketDetailOverlay();
    const ov = document.createElement('div');
    ov.id = 'pl-market-detail-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
    ov.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:26px;width:660px;max-width:94vw;max-height:84vh;overflow-y:auto;position:relative;">
      <button id="pl-detail-close" style="position:absolute;top:12px;right:14px;background:none;border:none;color:var(--text-mute);font-size:1.15rem;cursor:pointer;">✕</button>
      <div id="pl-detail-body">${html}</div>
    </div>`;
    ov.onclick = e => { if (e.target === ov) this._closeMarketDetailOverlay(); };
    document.body.appendChild(ov);
    const c = ov.querySelector('#pl-detail-close');
    if (c) c.onclick = () => this._closeMarketDetailOverlay();
    return ov;
  },

  _closeMarketDetailOverlay() {
    const ov = document.getElementById('pl-market-detail-overlay');
    if (ov) ov.remove();
  },

  _detailRow(k, v) {
    return `<div style="display:flex;gap:12px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.8rem;">
      <span style="width:110px;flex-shrink:0;color:var(--text-mute);">${k}</span>
      <span style="word-break:break-all;">${this._esc(String(v))}</span></div>`;
  },

  _translateBtnHtml() {
    return `<button id="pl-detail-translate" style="padding:7px 14px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid var(--border);background:var(--bg);color:var(--text-mute);">🌐 번역</button>`;
  },

  // 상세 모달의 번역 토글: 대상 요소 텍스트를 /api/translate 로 한국어 번역 (원문↔번역 전환)
  _bindTranslate(ov, targetSel) {
    const btn = ov.querySelector('#pl-detail-translate');
    const el = ov.querySelector(targetSel);
    if (!btn || !el) return;
    let orig = null, translated = null, busy = false;
    btn.onclick = async () => {
      if (busy) return;
      if (translated !== null) {   // 이미 번역됨 → 원문↔번역 토글
        const showingTranslated = el.textContent === translated;
        el.textContent = showingTranslated ? orig : translated;
        btn.textContent = showingTranslated ? '🌐 번역 보기' : '원문 보기';
        return;
      }
      const src = el.textContent || '';
      if (src.trim().length < 20) {
        if (this._ctx.notify) this._ctx.notify('내용을 불러온 뒤 번역하세요.', { type: 'warning' });
        return;
      }
      busy = true;
      btn.textContent = '번역 중…';
      btn.disabled = true;
      try {
        const r = await this._ctx.api('/api/translate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: src, to: 'ko' }),
        });
        if (r && r.ok && r.text) {
          orig = src;
          translated = r.text;
          el.textContent = translated;
          btn.textContent = '원문 보기';
        } else {
          btn.textContent = '🌐 번역';
          if (this._ctx.notify) this._ctx.notify('번역 실패: ' + ((r && r.error) || '알 수 없음'), { type: 'error' });
        }
      } catch (e) {
        btn.textContent = '🌐 번역';
        if (this._ctx.notify) this._ctx.notify('번역 실패: ' + e, { type: 'error' });
      }
      btn.disabled = false;
      busy = false;
    };
  },

  // 스킬 카드 클릭 → SKILL.md 전체 상세
  async _showSkillDetail(repo, id) {
    const s = this._marketSkills.find(x => x.repo === repo && x.id === id) || { id, repo, name: id };
    const installed = this._claudeSkills.some(x => x.id === id);
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(156,39,176,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">✦</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${this._esc(s.name || s.id)}</div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;">${this._esc(s.repo)} / ${this._esc(s.path || s.id)}</div>
        </div>
      </div>
      <div id="pl-detail-skill-desc" style="font-size:.8rem;color:var(--text-mute);margin:8px 0 12px;">${this._esc(s.description_ko || s.description || '')}</div>
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        ${installed
          ? `<span style="font-size:.78rem;color:var(--accent);padding:6px 0;">✓ ${_plT('installed_badge')}</span>`
          : `<button id="pl-detail-install" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #9c27b0;background:transparent;color:#ba68c8;">${_plT('btn_install')}</button>`}
        ${this._translateBtnHtml()}
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin-bottom:6px;">📜 SKILL.md</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:46vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">불러오는 중...</pre>`);
    const installBtn = ov.querySelector('#pl-detail-install');
    if (installBtn) installBtn.onclick = () => { this._closeMarketDetailOverlay(); this._installSkill(repo, id, true); };

    // 번역 토글: description + SKILL.md 를 함께 전환 (서버 사전 번역 캐시 사용 → 대부분 즉시)
    const pre = ov.querySelector('#pl-detail-md');
    const descEl = ov.querySelector('#pl-detail-skill-desc');
    const tbtn = ov.querySelector('#pl-detail-translate');
    const origDesc = s.description || '';
    let origMd = null, koMd = null, koDesc = s.description_ko || '', showKo = false, busy = false;
    if (tbtn) tbtn.onclick = async () => {
      if (busy || origMd === null) return;
      if (koMd === null) {
        busy = true;
        tbtn.textContent = '번역 중…';
        tbtn.disabled = true;
        try {
          const r = await this._ctx.api(`/api/marketplace/skills/preview?repo=${encodeURIComponent(repo)}&id=${encodeURIComponent(id)}&lang=ko`);
          if (r && r.ok && r.translated) {
            koMd = r.content || '';
            if (r.description_ko) koDesc = r.description_ko;
          } else {
            tbtn.textContent = '🌐 번역';
            if (this._ctx.notify) this._ctx.notify('번역 실패: ' + ((r && r.error) || '알 수 없음'), { type: 'error' });
            busy = false; tbtn.disabled = false;
            return;
          }
        } catch (e) {
          tbtn.textContent = '🌐 번역';
          if (this._ctx.notify) this._ctx.notify('번역 실패: ' + e, { type: 'error' });
          busy = false; tbtn.disabled = false;
          return;
        }
        busy = false;
        tbtn.disabled = false;
      }
      showKo = !showKo;
      pre.textContent = showKo ? koMd : origMd;
      if (descEl) descEl.textContent = showKo ? (koDesc || origDesc) : origDesc;
      tbtn.textContent = showKo ? '원문 보기' : '🌐 번역 보기';
    };

    try {
      const p = await this._ctx.api(`/api/marketplace/skills/preview?repo=${encodeURIComponent(repo)}&id=${encodeURIComponent(id)}`);
      origMd = (p && p.ok) ? (p.content || '(비어 있음)') : ('불러오기 실패: ' + (p && p.error || ''));
      if (pre) pre.textContent = origMd;
    } catch (e) {
      origMd = '불러오기 실패: ' + e;
      if (pre) pre.textContent = origMd;
    }
  },

  // 마켓 플러그인 카드 클릭 → 메타 상세
  _showMarketPluginDetail(id) {
    const p = this._marketPlugins.find(x => x.id === id);
    if (!p) return;
    const isInstalled = this._viewPlugins.some(x => x.id === p.id);
    const typeLabels = { view: '⊞ View', mcp: '⚡ MCP', claude: '🧩 Claude Plugin', agent: '🤖 도우미' };
    const rows = [
      this._detailRow('ID', p.id),
      this._detailRow('타입', typeLabels[(p.type || 'view').toLowerCase()] || p.type || 'view'),
      this._detailRow('버전', p.version || '?'),
      (p.downloads != null) ? this._detailRow('다운로드', p.downloads) : '',
      p.github_path ? this._detailRow('저장소 경로', p.github_path) : '',
      p.author ? this._detailRow('제작자', p.author) : '',
    ].join('');
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(99,102,241,.13);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">${this._esc(p.icon || '🧩')}</div>
        <div style="font-weight:700;font-size:1.05rem;">${this._esc(this._pName(p))}</div>
      </div>
      <div id="pl-detail-desc" style="font-size:.82rem;color:var(--text-mute);line-height:1.6;margin:10px 0 14px;">${this._esc(this._pDesc(p))}</div>
      <div style="margin-bottom:16px;">${rows}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${isInstalled
          ? `<span style="font-size:.78rem;color:var(--accent);">✓ ${_plT('installed_badge')}</span>`
          : `<button id="pl-detail-install" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid var(--accent);background:transparent;color:var(--accent);">${_plT('btn_install')}</button>`}
        ${this._translateBtnHtml()}
      </div>`);
    const installBtn = ov.querySelector('#pl-detail-install');
    if (installBtn) installBtn.onclick = () => { this._closeMarketDetailOverlay(); this._installPlugin(p.id); };
    this._bindTranslate(ov, '#pl-detail-desc');
  },

  // CLAUDE.md 보기 — 로컬(글로벌/프로젝트)·원격(peer 공유분) 공용 상세 모달
  // 원격에는 다운로드/설치 버튼 노출 (설치는 로컬에 파일이 없을 때만, 있으면 diff 표시)
  async _showClaudeMdDetail(idx) {
    const m = this._claudeMdList[Number(idx)];
    if (!m) return;
    m._idx = Number(idx);   // 편집 취소/저장 후 재진입용 인덱스
    const title = this._claudeMdTitle(m);
    const actionRow = m.remote ? `
      <div id="pl-md-actions" style="display:flex;gap:8px;margin-top:12px;">
        <button id="pl-md-install" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #26a69a;background:transparent;color:#26a69a;">${_plT('btn_install')}</button>
        <button id="pl-md-download" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid var(--border);background:var(--bg);color:var(--text-mute);">⬇ ${_plT('btn_download')}</button>
      </div>` : `
      <div id="pl-md-actions" style="display:flex;gap:8px;margin-top:12px;">
        <button id="pl-md-edit" disabled style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #26a69a;background:transparent;color:#26a69a;opacity:.5;">✏ ${_plT('btn_edit')}</button>
      </div>`;
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(38,166,154,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">📄</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${this._esc(title)}</div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(m.path || '')}</div>
        </div>
      </div>
      ${actionRow}
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin:12px 0 6px;">📄 CLAUDE.md</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">불러오는 중...</pre>`);
    const pre = ov.querySelector('#pl-detail-md');
    if (m.remote) {
      // peer 공유분은 push 페이로드에 내용이 포함되어 있음 (20KB 제한)
      pre.textContent = m.content || '(내용 없음)';
      const installBtn = ov.querySelector('#pl-md-install');
      if (installBtn) installBtn.onclick = () => { this._closeMarketDetailOverlay(); this._installClaudeMd(m); };
      const dlBtn = ov.querySelector('#pl-md-download');
      if (dlBtn) dlBtn.onclick = () => this._downloadClaudeMd(m);
      return;
    }
    try {
      const url = m.scope === 'global'
        ? '/api/claude/md/global'
        : `/api/projects/${m.project_id}/claude-md`;
      const r = await this._ctx.api(url);
      const loaded = !!(r && r.ok && typeof r.content === 'string');
      pre.textContent = loaded ? r.content : ((r && r.error) || '불러오기 실패');
      if (loaded) {
        const editBtn = ov.querySelector('#pl-md-edit');
        if (editBtn) {
          editBtn.disabled = false;
          editBtn.style.opacity = '1';
          editBtn.onclick = () => this._enterClaudeMdEdit(ov, m);
        }
      }
    } catch (e) {
      pre.textContent = String(e);
    }
  },

  // 설치됨 > Claude Skill 상세 — 글로벌/프로젝트 스킬의 SKILL.md 내용 표시.
  // 내용 로드 후 마켓 등록본과 비교해 미등록 → '마켓플레이스에 등록',
  // 다름 → '마켓에 등록 (업데이트)' 버튼 노출 (커맨드 상세와 동일한 흐름)
  async _showLocalSkillDetail(idx) {
    const s = this._claudeSkills[Number(idx)];
    if (!s) return;
    const scopeLabel = s.scope === 'project' ? `📁 ${s.project_name || 'Project'}` : '🌐 Global';
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(156,39,176,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">✦</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${this._esc(s.name || s.id)}
            <span style="font-size:.72rem;font-weight:400;color:var(--text-mute);margin-left:6px;">${this._esc(scopeLabel)}</span>
          </div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(s.path || '')}</div>
        </div>
      </div>
      ${s.description ? `<div style="font-size:.8rem;color:var(--text-mute);margin:8px 0 0;">${this._esc(s.description)}</div>` : ''}
      <div id="pl-skill-actions" style="display:flex;gap:8px;margin-top:12px;align-items:center;">
        <button id="pl-skill-register" style="display:none;padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #9c27b0;background:transparent;color:#ba68c8;"></button>
        <button id="pl-skill-delete" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #f8717155;background:transparent;color:#f87171;">${_plT('btn_cmd_delete')}</button>
        <span id="pl-skill-reg-status" style="font-size:.75rem;color:var(--text-mute);"></span>
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin:12px 0 6px;">📜 SKILL.md</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">불러오는 중...</pre>`);
    const delBtn = ov.querySelector('#pl-skill-delete');
    if (delBtn) delBtn.onclick = () => this._deleteClaudeSkill(s);
    const pre = ov.querySelector('#pl-detail-md');
    let localContent = null;
    try {
      const url = `/api/claude/skills/view?id=${encodeURIComponent(s.id)}`
        + `&scope=${encodeURIComponent(s.scope || 'global')}`
        + `&project_id=${encodeURIComponent(s.project_id || '')}`;
      const r = await this._ctx.api(url);
      const loaded = !!(r && r.ok && typeof r.content === 'string');
      pre.textContent = loaded ? (r.content || '(비어 있음)') : ((r && r.error) || '불러오기 실패');
      if (loaded) localContent = r.content;
    } catch (e) {
      pre.textContent = String(e);
    }
    if (localContent === null) return;
    // 마켓 등록 상태 비교 (미등록 / 동일 / 다름) — Firebase 소스가 아니면 표시 생략
    try {
      const mk = await this._ctx.api('/api/marketplace/skills/registered');
      if (!mk || mk.no_source || (!mk.ok && mk.error)) return;
      const entry = (mk.skills || []).find(x => x.id === s.id);
      const statusEl = ov.querySelector('#pl-skill-reg-status');
      const btn = ov.querySelector('#pl-skill-register');
      if (!statusEl || !btn) return;
      if (!entry) {
        statusEl.textContent = _plT('reg_status_none');
        btn.textContent = _plT('btn_register');
        btn.style.display = '';
        btn.onclick = () => this._registerClaudeSkill(s, false);
      } else if ((entry.content || '') === localContent) {
        statusEl.textContent = _plT('reg_status_same');
        statusEl.style.color = 'var(--accent)';
      } else {
        statusEl.textContent = `⚠ ${_plT('reg_status_diff')}${entry.host ? ` (등록: ${entry.host})` : ''}`;
        statusEl.style.color = '#ff9800';
        btn.textContent = _plT('btn_register_update');
        btn.style.display = '';
        btn.onclick = () => this._registerClaudeSkill(s, true);
      }
    } catch (_) {}
  },

  // 로컬 스킬을 마켓에 등록/갱신 — overwrite=false 에서 conflict 응답이 오면
  // (그 사이 다른 EP4 가 등록) 확인 후 overwrite 재시도
  async _registerClaudeSkill(s, overwrite) {
    try {
      const res = await this._ctx.api('/api/claude/skills/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, scope: s.scope || 'global',
                               project_id: s.project_id, overwrite }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_skill_registered', s.id), { type: 'success' });
        this._marketRegSkillsLoaded = false;   // 마켓플레이스 > Skill (마켓) 갱신
        this._closeMarketDetailOverlay();
        return;
      }
      if (res && res.already) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_reg_already'), { type: 'info' });
        return;
      }
      if (res && res.conflict) {
        const msg = _plT('confirm_skill_overwrite', { id: s.id, host: res.market_host });
        const ok = window.showConfirm
          ? await window.showConfirm(msg, { title: _plT('title_cmd_conflicts'), type: 'warning', ok: _plT('btn_register_update') })
          : confirm(msg);
        if (ok) await this._registerClaudeSkill(s, true);
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_install_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(String(e), { type: 'error' });
    }
  },

  // 로컬 스킬 폴더 삭제 (설치됨 > Claude Skill 상세의 삭제 버튼)
  async _deleteClaudeSkill(s) {
    const folder = (s.path || '').replace(/[\\\/]SKILL\.md$/i, '') || `~/.claude/skills/${s.id}`;
    const msg = _plT('confirm_skill_delete', { id: s.id, path: folder });
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_skill_delete'), type: 'delete', ok: (window._EP4_LANG || 'ko') === 'ko' ? '삭제' : 'Delete' })
      : confirm(msg);
    if (!ok) return;
    try {
      const url = `/api/claude/skills/${encodeURIComponent(s.id)}`
        + `?scope=${encodeURIComponent(s.scope || 'global')}`
        + `&project_id=${encodeURIComponent(s.project_id || '')}`;
      const res = await this._ctx.api(url, { method: 'DELETE' });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_skill_deleted', s.id), { type: 'success' });
        this._closeMarketDetailOverlay();
        await this._reload();
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_delete_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_delete_fail') + ': ' + e, { type: 'error' });
    }
  },

  // 마켓(Firebase)에 등록된 스킬 상세 — 스냅샷 내용 + 설치/마켓에서 삭제
  _showMarketRegSkillDetail(idx) {
    const s = this._marketRegSkills[Number(idx)];
    if (!s) return;
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(156,39,176,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">✦</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${this._esc(s.name || s.id)}
            ${s.host ? `<span style="font-size:.72rem;font-weight:400;color:var(--text-mute);margin-left:6px;">@ ${this._esc(s.host)}</span>` : ''}
          </div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(s.id || '')}${s.registered_at ? ` · 등록 ${this._esc(s.registered_at)}` : ''}</div>
        </div>
      </div>
      ${s.description ? `<div style="font-size:.8rem;color:var(--text-mute);margin:8px 0 0;">${this._esc(s.description)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button id="pl-rskill-install" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #9c27b0;background:transparent;color:#ba68c8;">${_plT('btn_install')}</button>
        <button id="pl-rskill-unreg" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #f8717155;background:transparent;color:#f87171;">${_plT('btn_cmd_unregister')}</button>
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin:12px 0 6px;">📜 SKILL.md</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">${this._esc(s.content || '(내용 없음)')}</pre>`);
    const installBtn = ov.querySelector('#pl-rskill-install');
    if (installBtn) installBtn.onclick = () => { this._closeMarketDetailOverlay(); this._installMarketRegSkill(s); };
    const unregBtn = ov.querySelector('#pl-rskill-unreg');
    if (unregBtn) unregBtn.onclick = () => this._unregisterMarketRegSkill(s);
  },

  // 마켓 등록 스킬 설치 — 위치 선택 후 {base}/{id}/SKILL.md 에 쓴다.
  // 대상 파일이 없으면 복사, 이미 있으면 로컬↔마켓 diff 를 표시한다.
  async _installMarketRegSkill(s) {
    const msg = _plT('confirm_skill_install', s.id);
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_skill_install'), ok: _plT('btn_install') })
      : confirm(msg);
    if (!ok) return;
    this._chooseSkillInstallDest(`${s.name || s.id}${s.host ? ` @ ${s.host}` : ''}`, async ({ scope, projectId }) => {
      try {
        const res = await this._ctx.api('/api/claude/skills/install-market', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: s.id, content: s.content || '', scope, project_id: projectId }),
        });
        if (res && res.ok) {
          if (this._ctx.notify) this._ctx.notify(_plT('notify_skill_installed', res.path), { type: 'success' });
          await this._reload();
          return;
        }
        if (res && res.exists) {
          this._showClaudeMdDiff(s, res);   // 제목·diff 렌더링이 스킬에도 그대로 적용됨
          return;
        }
        if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_install_fail'), { type: 'error' });
      } catch (e) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_install_fail') + ': ' + e, { type: 'error' });
      }
    });
  },

  // 마켓에서 스킬 삭제
  async _unregisterMarketRegSkill(s) {
    const msg = _plT('confirm_skill_unregister', s.id);
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_cmd_unregister'), type: 'delete', ok: _plT('btn_cmd_unregister').replace('🗑 ', '') })
      : confirm(msg);
    if (!ok) return;
    try {
      const res = await this._ctx.api('/api/claude/skills/unregister', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_skill_unregistered', s.id), { type: 'success' });
        this._closeMarketDetailOverlay();
        this._loadMarketRegSkills(true);
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_delete_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_delete_fail') + ': ' + e, { type: 'error' });
    }
  },

  // 마켓에 스킬 수동 등록 — 스킬 이름과 SKILL.md 내용을 직접 입력해 올린다 (로컬 파일 불필요)
  _showManualSkillRegisterModal() {
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(156,39,176,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">✦</div>
        <div style="font-weight:700;font-size:1.05rem;">${_plT('title_skill_manual')}</div>
      </div>
      <div style="font-size:.8rem;font-weight:600;margin-bottom:4px;">${_plT('skill_manual_name_label')}</div>
      <input id="pl-skill-man-id" type="text" placeholder="${this._esc(_plT('skill_manual_name_ph'))}" spellcheck="false"
          style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;
                 background:var(--bg);color:inherit;font-size:.84rem;font-family:monospace;" />
      <div style="font-size:.8rem;font-weight:600;margin:12px 0 4px;">${_plT('skill_manual_content_label')}</div>
      <textarea id="pl-skill-man-content" spellcheck="false"
          style="width:100%;box-sizing:border-box;height:38vh;padding:10px;border:1px solid var(--border);border-radius:8px;
                 background:var(--bg);color:inherit;font-size:.76rem;line-height:1.55;font-family:monospace;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px;align-items:center;">
        <button id="pl-skill-man-ok" style="padding:8px 22px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid #9c27b0;background:#9c27b0;color:#fff;">${_plT('btn_register')}</button>
        <button id="pl-skill-man-cancel" style="padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid var(--border);background:transparent;color:inherit;">${_plT('btn_cancel')}</button>
        <span id="pl-skill-man-msg" style="font-size:.76rem;color:#e06c75;"></span>
      </div>`);
    ov.querySelector('#pl-skill-man-cancel').onclick = () => this._closeMarketDetailOverlay();
    const okBtn = ov.querySelector('#pl-skill-man-ok');
    const submit = async (overwrite) => {
      const sid = (ov.querySelector('#pl-skill-man-id').value || '').trim();
      const content = ov.querySelector('#pl-skill-man-content').value || '';
      const msg = ov.querySelector('#pl-skill-man-msg');
      if (!sid || !content.trim()) {
        if (msg) msg.textContent = `${_plT('skill_manual_name_label')} · ${_plT('skill_manual_content_label')} 필수`;
        return;
      }
      okBtn.disabled = true;
      try {
        const res = await this._ctx.api('/api/claude/skills/register-manual', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sid, content, overwrite: !!overwrite }),
        });
        if (res && res.ok) {
          if (this._ctx.notify) this._ctx.notify(_plT('notify_skill_registered', sid), { type: 'success' });
          this._closeMarketDetailOverlay();
          this._loadMarketRegSkills(true);
          return;
        }
        if (res && res.already) {
          if (msg) msg.textContent = _plT('notify_cmd_reg_already');
          okBtn.disabled = false;
          return;
        }
        if (res && res.conflict) {
          okBtn.disabled = false;
          const cmsg = _plT('confirm_skill_overwrite', { id: sid, host: res.market_host });
          const ok2 = window.showConfirm
            ? await window.showConfirm(cmsg, { title: _plT('title_cmd_conflicts'), type: 'warning', ok: _plT('btn_register_update') })
            : confirm(cmsg);
          if (ok2) await submit(true);
          return;
        }
        if (msg) msg.textContent = (res && res.error) || _plT('notify_install_fail');
      } catch (e) {
        const msg2 = ov.querySelector('#pl-skill-man-msg');
        if (msg2) msg2.textContent = String(e);
      }
      okBtn.disabled = false;
    };
    okBtn.onclick = () => submit(false);
  },

  // 설치됨 > Claude Agent 상세 — 글로벌/프로젝트 서브 에이전트의 .md 내용 표시.
  // 스킬 상세와 동일한 흐름: 미등록 → '마켓플레이스에 등록', 다름 → '마켓에 등록 (업데이트)'
  async _showLocalAgentDetail(idx) {
    const a = this._claudeAgents[Number(idx)];
    if (!a) return;
    const scopeLabel = a.scope === 'project' ? `📁 ${a.project_name || 'Project'}` : '🌐 Global';
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(92,107,192,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🤖</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${this._esc(a.name || a.id)}
            <span style="font-size:.72rem;font-weight:400;color:var(--text-mute);margin-left:6px;">${this._esc(scopeLabel)}</span>
          </div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(a.path || '')}</div>
        </div>
      </div>
      ${a.description ? `<div style="font-size:.8rem;color:var(--text-mute);margin:8px 0 0;">${this._esc(a.description)}</div>` : ''}
      <div id="pl-agent-actions" style="display:flex;gap:8px;margin-top:12px;align-items:center;">
        <button id="pl-agent-register" style="display:none;padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #5c6bc0;background:transparent;color:#7986cb;"></button>
        <button id="pl-agent-delete" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #f8717155;background:transparent;color:#f87171;">${_plT('btn_cmd_delete')}</button>
        <span id="pl-agent-reg-status" style="font-size:.75rem;color:var(--text-mute);"></span>
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin:12px 0 6px;">🤖 ${this._esc(a.rel || '')}</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">불러오는 중...</pre>`);
    const delBtn = ov.querySelector('#pl-agent-delete');
    if (delBtn) delBtn.onclick = () => this._deleteClaudeAgent(a);
    const pre = ov.querySelector('#pl-detail-md');
    let localContent = null;
    try {
      const url = `/api/claude/agents/view?rel=${encodeURIComponent(a.rel || '')}`
        + `&scope=${encodeURIComponent(a.scope || 'global')}`
        + `&project_id=${encodeURIComponent(a.project_id || '')}`;
      const r = await this._ctx.api(url);
      const loaded = !!(r && r.ok && typeof r.content === 'string');
      pre.textContent = loaded ? (r.content || '(비어 있음)') : ((r && r.error) || '불러오기 실패');
      if (loaded) localContent = r.content;
    } catch (e) {
      pre.textContent = String(e);
    }
    if (localContent === null) return;
    // 마켓 등록 상태 비교 (미등록 / 동일 / 다름) — Firebase 소스가 아니면 표시 생략
    try {
      const mk = await this._ctx.api('/api/marketplace/agents/registered');
      if (!mk || mk.no_source || (!mk.ok && mk.error)) return;
      const entry = (mk.agents || []).find(x => x.id === a.id);
      const statusEl = ov.querySelector('#pl-agent-reg-status');
      const btn = ov.querySelector('#pl-agent-register');
      if (!statusEl || !btn) return;
      if (!entry) {
        statusEl.textContent = _plT('reg_status_none');
        btn.textContent = _plT('btn_register');
        btn.style.display = '';
        btn.onclick = () => this._registerClaudeAgent(a, false);
      } else if ((entry.content || '') === localContent) {
        statusEl.textContent = _plT('reg_status_same');
        statusEl.style.color = 'var(--accent)';
      } else {
        statusEl.textContent = `⚠ ${_plT('reg_status_diff')}${entry.host ? ` (등록: ${entry.host})` : ''}`;
        statusEl.style.color = '#ff9800';
        btn.textContent = _plT('btn_register_update');
        btn.style.display = '';
        btn.onclick = () => this._registerClaudeAgent(a, true);
      }
    } catch (_) {}
  },

  // 로컬 서브 에이전트를 마켓에 등록/갱신 — conflict 시 확인 후 overwrite 재시도
  async _registerClaudeAgent(a, overwrite) {
    try {
      const res = await this._ctx.api('/api/claude/agents/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, scope: a.scope || 'global',
                               project_id: a.project_id, overwrite }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_agent_registered', a.id), { type: 'success' });
        this._marketRegAgentsLoaded = false;   // 마켓플레이스 > Agent (마켓) 갱신
        this._closeMarketDetailOverlay();
        return;
      }
      if (res && res.already) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_reg_already'), { type: 'info' });
        return;
      }
      if (res && res.conflict) {
        const msg = _plT('confirm_agent_overwrite', { id: a.id, host: res.market_host });
        const ok = window.showConfirm
          ? await window.showConfirm(msg, { title: _plT('title_cmd_conflicts'), type: 'warning', ok: _plT('btn_register_update') })
          : confirm(msg);
        if (ok) await this._registerClaudeAgent(a, true);
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_install_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(String(e), { type: 'error' });
    }
  },

  // 로컬 서브 에이전트 파일 삭제 (설치됨 > Claude Agent 상세의 삭제 버튼)
  async _deleteClaudeAgent(a) {
    const msg = _plT('confirm_agent_delete', { id: a.id, path: a.path || a.rel });
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_agent_delete'), type: 'delete', ok: (window._EP4_LANG || 'ko') === 'ko' ? '삭제' : 'Delete' })
      : confirm(msg);
    if (!ok) return;
    try {
      const url = `/api/claude/agents?rel=${encodeURIComponent(a.rel || '')}`
        + `&scope=${encodeURIComponent(a.scope || 'global')}`
        + `&project_id=${encodeURIComponent(a.project_id || '')}`;
      const res = await this._ctx.api(url, { method: 'DELETE' });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_agent_deleted', a.id), { type: 'success' });
        this._closeMarketDetailOverlay();
        await this._reload();
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_delete_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_delete_fail') + ': ' + e, { type: 'error' });
    }
  },

  // 서브 에이전트 설치 위치 선택 모달 — Global(~/.claude/agents) / project_root 있는 프로젝트
  async _chooseAgentInstallDest(subTitle, onPick) {
    let projects = [];
    try {
      const pr = await this._ctx.api('/api/projects');
      projects = (Array.isArray(pr) ? pr : []).filter(p => (p.project_root || '').trim());
    } catch (_) {}
    const opt = (val, label, sub, checked) => `
      <label style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);
                    border-radius:8px;cursor:pointer;margin-bottom:6px;">
        <input type="radio" name="pl-agent-dest" value="${this._esc(val)}" ${checked ? 'checked' : ''} style="margin-top:3px;">
        <span style="min-width:0;">
          <span style="font-size:.84rem;font-weight:600;">${label}</span>
          ${sub ? `<span style="display:block;font-size:.72rem;color:var(--text-mute);font-family:monospace;word-break:break-all;">${this._esc(sub)}</span>` : ''}
        </span>
      </label>`;
    const rows = opt('global', _plT('install_dest_global_agent'), '', true)
      + (projects.length
        ? projects.map(p => opt(`p:${p.id}`, `📁 ${this._esc(p.name)}`, `${p.project_root}\\.claude\\agents`, false)).join('')
        : `<div style="font-size:.75rem;color:var(--text-mute);padding:4px 2px;">${_plT('install_dest_empty')}</div>`);
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(92,107,192,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🤖</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${_plT('install_dest_title')}</div>
          <div style="font-size:.75rem;color:var(--text-mute);">${this._esc(subTitle || '')}</div>
        </div>
      </div>
      <div style="max-height:46vh;overflow-y:auto;">${rows}</div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="pl-agent-dest-ok" style="padding:8px 22px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid #5c6bc0;background:#5c6bc0;color:#fff;">${_plT('btn_install')}</button>
        <button id="pl-agent-dest-cancel" style="padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid var(--border);background:transparent;color:inherit;">${_plT('btn_cancel')}</button>
      </div>`);
    ov.querySelector('#pl-agent-dest-cancel').onclick = () => this._closeMarketDetailOverlay();
    ov.querySelector('#pl-agent-dest-ok').onclick = () => {
      const sel = ov.querySelector('input[name="pl-agent-dest"]:checked');
      const val = (sel && sel.value) || 'global';
      this._closeMarketDetailOverlay();
      onPick({ scope: val === 'global' ? 'global' : 'project',
               projectId: val.startsWith('p:') ? Number(val.slice(2)) : null });
    };
  },

  // 마켓(Firebase)에 등록된 서브 에이전트 상세 — 스냅샷 내용 + 설치/마켓에서 삭제
  _showMarketRegAgentDetail(idx) {
    const a = this._marketRegAgents[Number(idx)];
    if (!a) return;
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(92,107,192,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🤖</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${this._esc(a.name || a.id)}
            ${a.host ? `<span style="font-size:.72rem;font-weight:400;color:var(--text-mute);margin-left:6px;">@ ${this._esc(a.host)}</span>` : ''}
          </div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(a.id || '')}${a.registered_at ? ` · 등록 ${this._esc(a.registered_at)}` : ''}</div>
        </div>
      </div>
      ${a.description ? `<div style="font-size:.8rem;color:var(--text-mute);margin:8px 0 0;">${this._esc(a.description)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button id="pl-ragent-install" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #5c6bc0;background:transparent;color:#7986cb;">${_plT('btn_install')}</button>
        <button id="pl-ragent-unreg" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #f8717155;background:transparent;color:#f87171;">${_plT('btn_cmd_unregister')}</button>
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin:12px 0 6px;">🤖 ${this._esc(a.rel || '')}</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">${this._esc(a.content || '(내용 없음)')}</pre>`);
    const installBtn = ov.querySelector('#pl-ragent-install');
    if (installBtn) installBtn.onclick = () => { this._closeMarketDetailOverlay(); this._installMarketRegAgent(a); };
    const unregBtn = ov.querySelector('#pl-ragent-unreg');
    if (unregBtn) unregBtn.onclick = () => this._unregisterMarketRegAgent(a);
  },

  // 마켓 등록 에이전트 설치 — 위치 선택 후 {base}/{rel} 에 쓴다.
  async _installMarketRegAgent(a) {
    const msg = _plT('confirm_agent_install', a.id);
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_agent_install'), ok: _plT('btn_install') })
      : confirm(msg);
    if (!ok) return;
    this._chooseAgentInstallDest(`${a.name || a.id}${a.host ? ` @ ${a.host}` : ''}`, async ({ scope, projectId }) => {
      try {
        const res = await this._ctx.api('/api/claude/agents/install-market', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: a.id, rel: a.rel || '', content: a.content || '', scope, project_id: projectId }),
        });
        if (res && res.ok) {
          if (this._ctx.notify) this._ctx.notify(_plT('notify_agent_installed', res.path), { type: 'success' });
          await this._reload();
          return;
        }
        if (res && res.exists) {
          this._showClaudeMdDiff(a, res);   // 제목·diff 렌더링이 에이전트에도 그대로 적용됨
          return;
        }
        if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_install_fail'), { type: 'error' });
      } catch (e) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_install_fail') + ': ' + e, { type: 'error' });
      }
    });
  },

  // 마켓에서 에이전트 삭제
  async _unregisterMarketRegAgent(a) {
    const msg = _plT('confirm_agent_unregister', a.id);
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_cmd_unregister'), type: 'delete', ok: _plT('btn_cmd_unregister').replace('🗑 ', '') })
      : confirm(msg);
    if (!ok) return;
    try {
      const res = await this._ctx.api('/api/claude/agents/unregister', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_agent_unregistered', a.id), { type: 'success' });
        this._closeMarketDetailOverlay();
        this._loadMarketRegAgents(true);
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_delete_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_delete_fail') + ': ' + e, { type: 'error' });
    }
  },

  // 마켓에 서브 에이전트 수동 등록 — 이름과 .md 내용을 직접 입력해 올린다 (로컬 파일 불필요)
  _showManualAgentRegisterModal() {
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(92,107,192,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🤖</div>
        <div style="font-weight:700;font-size:1.05rem;">${_plT('title_agent_manual')}</div>
      </div>
      <div style="font-size:.8rem;font-weight:600;margin-bottom:4px;">${_plT('agent_manual_name_label')}</div>
      <input id="pl-agent-man-id" type="text" placeholder="${this._esc(_plT('agent_manual_name_ph'))}" spellcheck="false"
          style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;
                 background:var(--bg);color:inherit;font-size:.84rem;font-family:monospace;" />
      <div style="font-size:.8rem;font-weight:600;margin:12px 0 4px;">${_plT('agent_manual_content_label')}</div>
      <textarea id="pl-agent-man-content" spellcheck="false"
          style="width:100%;box-sizing:border-box;height:38vh;padding:10px;border:1px solid var(--border);border-radius:8px;
                 background:var(--bg);color:inherit;font-size:.76rem;line-height:1.55;font-family:monospace;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px;align-items:center;">
        <button id="pl-agent-man-ok" style="padding:8px 22px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid #5c6bc0;background:#5c6bc0;color:#fff;">${_plT('btn_register')}</button>
        <button id="pl-agent-man-cancel" style="padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid var(--border);background:transparent;color:inherit;">${_plT('btn_cancel')}</button>
        <span id="pl-agent-man-msg" style="font-size:.76rem;color:#e06c75;"></span>
      </div>`);
    ov.querySelector('#pl-agent-man-cancel').onclick = () => this._closeMarketDetailOverlay();
    const okBtn = ov.querySelector('#pl-agent-man-ok');
    const submit = async (overwrite) => {
      const aid = (ov.querySelector('#pl-agent-man-id').value || '').trim().replace(/^\//, '');
      const content = ov.querySelector('#pl-agent-man-content').value || '';
      const msg = ov.querySelector('#pl-agent-man-msg');
      if (!aid || !content.trim()) {
        if (msg) msg.textContent = `${_plT('agent_manual_name_label')} · ${_plT('agent_manual_content_label')} 필수`;
        return;
      }
      okBtn.disabled = true;
      try {
        const res = await this._ctx.api('/api/claude/agents/register-manual', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: aid, content, overwrite: !!overwrite }),
        });
        if (res && res.ok) {
          if (this._ctx.notify) this._ctx.notify(_plT('notify_agent_registered', aid), { type: 'success' });
          this._closeMarketDetailOverlay();
          this._loadMarketRegAgents(true);
          return;
        }
        if (res && res.already) {
          if (msg) msg.textContent = _plT('notify_cmd_reg_already');
          okBtn.disabled = false;
          return;
        }
        if (res && res.conflict) {
          okBtn.disabled = false;
          const cmsg = _plT('confirm_agent_overwrite', { id: aid, host: res.market_host });
          const ok2 = window.showConfirm
            ? await window.showConfirm(cmsg, { title: _plT('title_cmd_conflicts'), type: 'warning', ok: _plT('btn_register_update') })
            : confirm(cmsg);
          if (ok2) await submit(true);
          return;
        }
        if (msg) msg.textContent = (res && res.error) || _plT('notify_install_fail');
      } catch (e) {
        const msg2 = ov.querySelector('#pl-agent-man-msg');
        if (msg2) msg2.textContent = String(e);
      }
      okBtn.disabled = false;
    };
    okBtn.onclick = () => submit(false);
  },

  // 로컬 슬래시 커맨드 상세 보기 — 내용 로드 후 마켓 등록본과 비교해
  // 미등록 → '마켓플레이스에 등록', 다름 → '마켓에 등록 (업데이트)' 버튼 노출
  async _showClaudeCommandDetail(idx) {
    const c = this._claudeCommands[Number(idx)];
    if (!c) return;
    const scopeLabel = c.scope === 'global' ? '🌐 Global' : (c.project_name || 'Project');
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(236,64,122,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">⌨</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">/${this._esc(c.id || c.name)}
            <span style="font-size:.72rem;font-weight:400;color:var(--text-mute);margin-left:6px;">${this._esc(scopeLabel)}</span>
          </div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(c.path || '')}</div>
        </div>
      </div>
      ${c.description ? `<div style="font-size:.8rem;color:var(--text-mute);margin:8px 0 0;">${this._esc(c.description)}</div>` : ''}
      <div id="pl-cmd-actions" style="display:flex;gap:8px;margin-top:12px;align-items:center;">
        <button id="pl-cmd-register" style="display:none;padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #ec407a;background:transparent;color:#ec407a;"></button>
        <button id="pl-cmd-delete" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #f8717155;background:transparent;color:#f87171;">${_plT('btn_cmd_delete')}</button>
        <span id="pl-cmd-reg-status" style="font-size:.75rem;color:var(--text-mute);"></span>
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin:12px 0 6px;">⌨ ${this._esc(c.rel || '')}</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">불러오는 중...</pre>`);
    const delBtn = ov.querySelector('#pl-cmd-delete');
    if (delBtn) delBtn.onclick = () => this._deleteClaudeCommand(c);
    const pre = ov.querySelector('#pl-detail-md');
    let localContent = null;
    try {
      const url = `/api/claude/commands/view?scope=${encodeURIComponent(c.scope || 'global')}`
        + `&project_id=${encodeURIComponent(c.project_id || '')}`
        + `&rel=${encodeURIComponent(c.rel || '')}`;
      const r = await this._ctx.api(url);
      const loaded = !!(r && r.ok && typeof r.content === 'string');
      pre.textContent = loaded ? (r.content || '(비어 있음)') : ((r && r.error) || '불러오기 실패');
      if (loaded) localContent = r.content;
    } catch (e) {
      pre.textContent = String(e);
    }
    if (localContent === null) return;
    // 마켓 등록 상태 비교 (미등록 / 동일 / 다름) — Firebase 소스가 아니면 표시 생략
    try {
      const mk = await this._ctx.api('/api/marketplace/commands');
      if (!mk || mk.no_source || (!mk.ok && mk.error)) return;
      const entry = (mk.commands || []).find(x => x.id === c.id);
      const statusEl = ov.querySelector('#pl-cmd-reg-status');
      const btn = ov.querySelector('#pl-cmd-register');
      if (!statusEl || !btn) return;
      if (!entry) {
        statusEl.textContent = _plT('reg_status_none');
        btn.textContent = _plT('btn_register');
        btn.style.display = '';
        btn.onclick = () => this._registerClaudeCommand(c, false);
      } else if ((entry.content || '') === localContent) {
        statusEl.textContent = _plT('reg_status_same');
        statusEl.style.color = 'var(--accent)';
      } else {
        statusEl.textContent = `⚠ ${_plT('reg_status_diff')}${entry.host ? ` (등록: ${entry.host})` : ''}`;
        statusEl.style.color = '#ff9800';
        btn.textContent = _plT('btn_register_update');
        btn.style.display = '';
        btn.onclick = () => this._registerClaudeCommand(c, true);
      }
    } catch (_) {}
  },

  // 로컬 커맨드를 마켓에 등록/갱신 — overwrite=false 에서 conflict 응답이 오면
  // (그 사이 다른 EP4 가 등록) 확인 후 overwrite 재시도
  async _registerClaudeCommand(c, overwrite) {
    try {
      const res = await this._ctx.api('/api/claude/commands/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: c.scope, project_id: c.project_id, rel: c.rel, overwrite }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_registered', c.id), { type: 'success' });
        this._marketCommandsLoaded = false;
        this._closeMarketDetailOverlay();
        return;
      }
      if (res && res.already) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_reg_already'), { type: 'info' });
        return;
      }
      if (res && res.conflict) {
        const msg = _plT('confirm_cmd_overwrite', { id: c.id, host: res.market_host });
        const ok = window.showConfirm
          ? await window.showConfirm(msg, { title: _plT('title_cmd_conflicts'), type: 'warning', ok: _plT('btn_register_update') })
          : confirm(msg);
        if (ok) await this._registerClaudeCommand(c, true);
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_install_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(String(e), { type: 'error' });
    }
  },

  // 로컬 커맨드 .md 파일 삭제 (설치됨 상세의 삭제 버튼)
  async _deleteClaudeCommand(c) {
    const msg = _plT('confirm_cmd_delete', { id: c.id, path: c.path || c.rel });
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_cmd_delete'), type: 'delete', ok: (window._EP4_LANG || 'ko') === 'ko' ? '삭제' : 'Delete' })
      : confirm(msg);
    if (!ok) return;
    try {
      const res = await this._ctx.api('/api/claude/commands/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: c.scope, project_id: c.project_id, rel: c.rel }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_deleted', res.path), { type: 'success' });
        this._closeMarketDetailOverlay();
        await this._reload();
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_delete_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_delete_fail') + ': ' + e, { type: 'error' });
    }
  },

  // 마켓에서 커맨드 삭제 — tombstone 기록으로 자동 등록에서 제외됨
  async _unregisterClaudeCommand(c) {
    const msg = _plT('confirm_cmd_unregister', c.id);
    const ok = window.showConfirm
      ? await window.showConfirm(msg, { title: _plT('title_cmd_unregister'), type: 'delete', ok: _plT('btn_cmd_unregister').replace('🗑 ', '') })
      : confirm(msg);
    if (!ok) return;
    try {
      const res = await this._ctx.api('/api/claude/commands/unregister', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_unregistered', c.id), { type: 'success' });
        this._closeMarketDetailOverlay();
        this._loadMarketCommands(true);
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_delete_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_delete_fail') + ': ' + e, { type: 'error' });
    }
  },

  // Global 커맨드 공유 On/Off — On 시 서버가 글로벌 + 공유 프로젝트 커맨드를 마켓에
  // 일괄 등록 (기등록 스킵). 등록본과 다른 커맨드는 목록으로 한 번에 확인 후 갱신.
  async _toggleCommandShare(on, overwriteIds) {
    try {
      const res = await this._ctx.api('/api/claude/commands/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: on ? '1' : '0', overwrite_ids: overwriteIds || [] }),
      });
      if (!on) { await this._reload(); return; }
      if (res && !res.ok) {
        if (this._ctx.notify) this._ctx.notify(res.error || _plT('notify_share_fail'), { type: 'error' });
        await this._reload();
        return;
      }
      const reg = (res.registered || []).length;
      const alr = (res.already || []).length;
      if ((reg || alr) && this._ctx.notify) {
        this._ctx.notify(_plT('notify_cmd_share_summary', reg, alr), { type: 'success' });
      }
      if ((res.errors || []).length && this._ctx.notify) {
        this._ctx.notify('일부 등록 실패: ' + res.errors.join(' / '), { type: 'warning' });
      }
      if ((res.deleted || []).length && this._ctx.notify) {
        this._ctx.notify(_plT('notify_cmd_deleted_skip', res.deleted.length), { type: 'info' });
      }
      this._marketCommandsLoaded = false;
      const conflicts = res.conflicts || [];
      if (conflicts.length && !overwriteIds) {
        const names = conflicts.map(x => '/' + x.id);
        const ok = window.showConfirm
          ? await window.showConfirm(_plT('confirm_cmd_conflicts', names), { title: _plT('title_cmd_conflicts'), type: 'warning', ok: _plT('btn_register_update') })
          : confirm(_plT('confirm_cmd_conflicts', names));
        if (ok) { await this._toggleCommandShare(true, conflicts.map(x => x.id)); return; }
      }
      await this._reload();
    } catch (err) {
      if (this._ctx.notify) this._ctx.notify(`${_plT('notify_share_fail')}: ${err}`, { type: 'error' });
    }
  },

  // 로컬 CLAUDE.md 편집 모드 — 본문을 textarea 로 전환, 저장 시 서버가 기존 파일을 .bak 백업
  _enterClaudeMdEdit(ov, m) {
    const pre = ov.querySelector('#pl-detail-md');
    const row = ov.querySelector('#pl-md-actions');
    if (!pre || !row) return;
    const ta = document.createElement('textarea');
    ta.id = 'pl-md-editor';
    ta.value = pre.textContent;
    ta.spellcheck = false;
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);'
      + 'border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;height:52vh;'
      + 'font-family:monospace;color:inherit;resize:vertical;';
    pre.replaceWith(ta);
    row.innerHTML = `
      <button id="pl-md-save" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid var(--accent);background:var(--accent);color:#fff;">${_plT('btn_save')}</button>
      <button id="pl-md-cancel" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid var(--border);background:transparent;color:inherit;">${_plT('btn_cancel')}</button>
      <span style="font-size:.72rem;color:var(--text-mute);align-self:center;">${_plT('md_backup_hint')}</span>`;
    row.querySelector('#pl-md-cancel').onclick = () => this._showClaudeMdDetail(m._idx);
    row.querySelector('#pl-md-save').onclick = async () => {
      const saveBtn = row.querySelector('#pl-md-save');
      saveBtn.disabled = true;
      try {
        const res = await this._ctx.api('/api/claude/md/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: m.scope, project_id: m.project_id, content: ta.value }),
        });
        if (res && res.ok) {
          if (this._ctx.notify) this._ctx.notify(_plT('notify_md_saved', res.backup), { type: 'success' });
          this._showClaudeMdDetail(m._idx);   // 저장된 내용으로 보기 모드 재진입
          return;
        }
        if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_md_save_fail'), { type: 'error' });
      } catch (e) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_md_save_fail') + ': ' + e, { type: 'error' });
      }
      saveBtn.disabled = false;
    };
  },

  // 마켓에 커맨드 수동 등록 — 명령 이름과 내용을 직접 입력해 올린다 (로컬 파일 불필요)
  _showManualRegisterModal() {
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(236,64,122,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">⌨</div>
        <div style="font-weight:700;font-size:1.05rem;">${_plT('title_cmd_manual')}</div>
      </div>
      <div style="font-size:.8rem;font-weight:600;margin-bottom:4px;">${_plT('cmd_manual_name_label')}</div>
      <input id="pl-cmd-man-id" type="text" placeholder="${this._esc(_plT('cmd_manual_name_ph'))}" spellcheck="false"
          style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;
                 background:var(--bg);color:inherit;font-size:.84rem;font-family:monospace;" />
      <div style="font-size:.8rem;font-weight:600;margin:12px 0 4px;">${_plT('cmd_manual_content_label')}</div>
      <textarea id="pl-cmd-man-content" spellcheck="false"
          style="width:100%;box-sizing:border-box;height:38vh;padding:10px;border:1px solid var(--border);border-radius:8px;
                 background:var(--bg);color:inherit;font-size:.76rem;line-height:1.55;font-family:monospace;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px;align-items:center;">
        <button id="pl-cmd-man-ok" style="padding:8px 22px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid #ec407a;background:#ec407a;color:#fff;">${_plT('btn_register')}</button>
        <button id="pl-cmd-man-cancel" style="padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid var(--border);background:transparent;color:inherit;">${_plT('btn_cancel')}</button>
        <span id="pl-cmd-man-msg" style="font-size:.76rem;color:#e06c75;"></span>
      </div>`);
    ov.querySelector('#pl-cmd-man-cancel').onclick = () => this._closeMarketDetailOverlay();
    const okBtn = ov.querySelector('#pl-cmd-man-ok');
    const submit = async (overwrite) => {
      const cid = (ov.querySelector('#pl-cmd-man-id').value || '').trim().replace(/^\//, '');
      const content = ov.querySelector('#pl-cmd-man-content').value || '';
      const msg = ov.querySelector('#pl-cmd-man-msg');
      if (!cid || !content.trim()) {
        if (msg) msg.textContent = `${_plT('cmd_manual_name_label')} · ${_plT('cmd_manual_content_label')} 필수`;
        return;
      }
      okBtn.disabled = true;
      try {
        const res = await this._ctx.api('/api/claude/commands/register-manual', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cid, content, overwrite: !!overwrite }),
        });
        if (res && res.ok) {
          if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_registered', cid), { type: 'success' });
          this._closeMarketDetailOverlay();
          this._loadMarketCommands(true);
          return;
        }
        if (res && res.already) {
          if (msg) msg.textContent = _plT('notify_cmd_reg_already');
          okBtn.disabled = false;
          return;
        }
        if (res && res.conflict) {
          okBtn.disabled = false;
          const cmsg = _plT('confirm_cmd_overwrite', { id: cid, host: res.market_host });
          const ok2 = window.showConfirm
            ? await window.showConfirm(cmsg, { title: _plT('title_cmd_conflicts'), type: 'warning', ok: _plT('btn_register_update') })
            : confirm(cmsg);
          if (ok2) await submit(true);
          return;
        }
        if (msg) msg.textContent = (res && res.error) || _plT('notify_install_fail');
      } catch (e) {
        const msg2 = ov.querySelector('#pl-cmd-man-msg');
        if (msg2) msg2.textContent = String(e);
      }
      okBtn.disabled = false;
    };
    okBtn.onclick = () => submit(false);
  },

  // 마켓(Firebase)에 등록된 커맨드 상세 — 스냅샷 내용 + 설치/다운로드
  _showMarketCommandDetail(idx) {
    const c = this._marketCommands[Number(idx)];
    if (!c) return;
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(236,64,122,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">⌨</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">/${this._esc(c.id || '')}
            ${c.host ? `<span style="font-size:.72rem;font-weight:400;color:var(--text-mute);margin-left:6px;">@ ${this._esc(c.host)}</span>` : ''}
          </div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(c.rel || '')}${c.registered_at ? ` · 등록 ${this._esc(c.registered_at)}` : ''}</div>
        </div>
      </div>
      ${c.description ? `<div style="font-size:.8rem;color:var(--text-mute);margin:8px 0 0;">${this._esc(c.description)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button id="pl-cmd-install" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #ec407a;background:transparent;color:#ec407a;">${_plT('btn_install')}</button>
        <button id="pl-cmd-download" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid var(--border);background:var(--bg);color:var(--text-mute);">⬇ ${_plT('btn_download')}</button>
        <button id="pl-cmd-unreg" style="padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.82rem;border:1px solid #f8717155;background:transparent;color:#f87171;">${_plT('btn_cmd_unregister')}</button>
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-mute);margin:12px 0 6px;">⌨ ${this._esc(c.rel || '')}</div>
      <pre id="pl-detail-md" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.74rem;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">${this._esc(c.content || '(내용 없음)')}</pre>`);
    const installBtn = ov.querySelector('#pl-cmd-install');
    if (installBtn) installBtn.onclick = () => { this._closeMarketDetailOverlay(); this._installClaudeCommand(c); };
    const dlBtn = ov.querySelector('#pl-cmd-download');
    if (dlBtn) dlBtn.onclick = () => this._downloadClaudeCommand(c);
    const unregBtn = ov.querySelector('#pl-cmd-unreg');
    if (unregBtn) unregBtn.onclick = () => this._unregisterClaudeCommand(c);
  },

  // 마켓 커맨드 .md 를 브라우저 다운로드로 저장
  _downloadClaudeCommand(c) {
    const blob = new Blob([c.content || ''], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.rel || '').split('/').pop() || `${c.id || 'command'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  // 마켓 커맨드 설치 — 설치 위치(Global / project_root 있는 프로젝트) 선택 모달을 띄운 뒤
  // 대상 파일이 없으면 복사, 이미 있으면 로컬↔마켓 diff 를 표시한다.
  async _installClaudeCommand(c) {
    let projects = [];
    try {
      const pr = await this._ctx.api('/api/projects');
      projects = (Array.isArray(pr) ? pr : []).filter(p => (p.project_root || '').trim());
    } catch (_) {}
    const opt = (val, label, sub, checked) => `
      <label style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);
                    border-radius:8px;cursor:pointer;margin-bottom:6px;">
        <input type="radio" name="pl-cmd-dest" value="${this._esc(val)}" ${checked ? 'checked' : ''} style="margin-top:3px;">
        <span style="min-width:0;">
          <span style="font-size:.84rem;font-weight:600;">${label}</span>
          ${sub ? `<span style="display:block;font-size:.72rem;color:var(--text-mute);font-family:monospace;word-break:break-all;">${this._esc(sub)}</span>` : ''}
        </span>
      </label>`;
    const rows = opt('global', _plT('install_dest_global'), '', true)
      + (projects.length
        ? projects.map(p => opt(`p:${p.id}`, `📁 ${this._esc(p.name)}`, `${p.project_root}\\.claude\\commands`, false)).join('')
        : `<div style="font-size:.75rem;color:var(--text-mute);padding:4px 2px;">${_plT('install_dest_empty')}</div>`);
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(236,64,122,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">⌨</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${_plT('install_dest_title')}</div>
          <div style="font-size:.75rem;color:var(--text-mute);">/${this._esc(c.id || c.name || '')} — ${this._esc(c.rel || '')}</div>
        </div>
      </div>
      <div style="max-height:46vh;overflow-y:auto;">${rows}</div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="pl-cmd-dest-ok" style="padding:8px 22px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid #ec407a;background:#ec407a;color:#fff;">${_plT('btn_install')}</button>
        <button id="pl-cmd-dest-cancel" style="padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid var(--border);background:transparent;color:inherit;">${_plT('btn_cancel')}</button>
      </div>`);
    ov.querySelector('#pl-cmd-dest-cancel').onclick = () => this._closeMarketDetailOverlay();
    ov.querySelector('#pl-cmd-dest-ok').onclick = async () => {
      const sel = ov.querySelector('input[name="pl-cmd-dest"]:checked');
      const val = (sel && sel.value) || 'global';
      const scope = val === 'global' ? 'global' : 'project';
      const projectId = val.startsWith('p:') ? Number(val.slice(2)) : null;
      this._closeMarketDetailOverlay();
      try {
        const res = await this._ctx.api('/api/claude/commands/install', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rel: c.rel || '', content: c.content || '',
                                 scope, project_id: projectId }),
        });
        if (res && res.ok) {
          if (this._ctx.notify) this._ctx.notify(_plT('notify_cmd_installed', res.path), { type: 'success' });
          await this._reload();
          return;
        }
        if (res && res.exists) {
          this._showClaudeMdDiff(c, res);   // 제목·diff 렌더링이 커맨드에도 그대로 적용됨
          return;
        }
        if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_install_fail'), { type: 'error' });
      } catch (e) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_install_fail') + ': ' + e, { type: 'error' });
      }
    };
  },

  // 원격 CLAUDE.md 를 브라우저 다운로드로 저장
  _downloadClaudeMd(m) {
    const blob = new Blob([m.content || ''], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'CLAUDE.md';
    a.click();
    URL.revokeObjectURL(a.href);
  },

  // 원격 CLAUDE.md 설치 — 로컬(global: ~/.claude, project: 같은 이름 프로젝트 root)에
  // 파일이 없으면 복사, 이미 있으면 로컬↔원격 diff 를 표시한다.
  async _installClaudeMd(m) {
    const title = this._claudeMdTitle(m);
    const ok = window.showConfirm
      ? await window.showConfirm(_plT('confirm_md_install', title), { title: _plT('title_md_install'), ok: _plT('btn_install') })
      : confirm(_plT('confirm_md_install', title));
    if (!ok) return;
    try {
      const res = await this._ctx.api('/api/claude/md/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: m.scope, name: m.name || '', content: m.content || '' }),
      });
      if (res && res.ok) {
        if (this._ctx.notify) this._ctx.notify(_plT('notify_md_installed', res.path), { type: 'success' });
        await this._reload();
        return;
      }
      if (res && res.exists) {
        this._showClaudeMdDiff(m, res);
        return;
      }
      if (this._ctx.notify) this._ctx.notify((res && res.error) || _plT('notify_install_fail'), { type: 'error' });
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_install_fail') + ': ' + e, { type: 'error' });
    }
  },

  // 설치 대상 파일이 이미 있을 때 — 로컬↔원격 unified diff 모달
  _showClaudeMdDiff(m, res) {
    const lines = res.diff || [];
    const colored = lines.map(l => {
      let color = 'inherit', bg = 'transparent';
      if (l.startsWith('+++') || l.startsWith('---')) { color = 'var(--text-dim)'; }
      else if (l.startsWith('@@')) { color = '#61afef'; }
      else if (l.startsWith('+')) { color = '#4caf50'; bg = 'rgba(76,175,80,.10)'; }
      else if (l.startsWith('-')) { color = '#f87171'; bg = 'rgba(248,113,113,.08)'; }
      return `<div style="color:${color};background:${bg};padding:0 6px;">${this._esc(l) || '&nbsp;'}</div>`;
    }).join('');
    const body = res.same
      ? `<div style="font-size:.83rem;color:var(--accent);padding:14px 4px;">✓ ${_plT('md_same')}</div>`
      : `<div style="font-size:.72rem;color:var(--text-mute);margin-bottom:6px;">${_plT('md_diff_legend')}</div>
         <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 4px;
                     font-family:monospace;font-size:.72rem;line-height:1.55;max-height:56vh;overflow:auto;
                     white-space:pre-wrap;word-break:break-word;">${colored}</div>`;
    this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(255,152,0,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">⚠</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${_plT('md_exists_title')}</div>
          <div style="font-size:.72rem;color:var(--text-dim);font-family:monospace;word-break:break-all;">${this._esc(res.path || '')}</div>
        </div>
      </div>
      <div style="margin-top:12px;">${body}</div>`);
  },

  // 스킬 설치 플로우: SKILL.md 미리보기 → 확인 → 캐시에서 설치
  // seenPreview=true 면(상세에서 이미 전체 확인) 경고만 표시
  async _installSkill(repo, id, seenPreview) {
    let preview = '';
    if (!seenPreview) {
      try {
        const p = await this._ctx.api(`/api/marketplace/skills/preview?repo=${encodeURIComponent(repo)}&id=${encodeURIComponent(id)}`);
        if (p && p.ok) preview = (p.content || '').slice(0, 700);
      } catch (_) {}
    }
    const warn = `[${repo}] ${id} 스킬을 설치할까요?\n설치 위치(Global / 프로젝트)는 다음 단계에서 선택합니다.\n\n` +
      `⚠ 서드파티 스킬은 Claude 가 실행할 스크립트를 포함할 수 있습니다.` +
      (preview ? `\n\n― SKILL.md 미리보기 ―\n${preview}${preview.length >= 700 ? '\n…' : ''}` : '');
    const ok = window.showConfirm ? await window.showConfirm(warn, { title: '스킬 설치', ok: '설치' }) : confirm(warn);
    if (!ok) return;
    this._chooseSkillInstallDest(`${id} — [${repo}]`, async ({ scope, projectId }) => {
      const post = (overwrite) => this._ctx.api('/api/claude/skills/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, id, overwrite, scope, project_id: projectId }),
      });
      try {
        let res = await post(false);
        if (res && !res.ok && res.exists) {
          const ow = window.showConfirm
            ? await window.showConfirm(`'${id}' 스킬이 이미 있습니다. 덮어쓸까요?`, { title: '덮어쓰기', type: 'warning', ok: '덮어쓰기' })
            : confirm('이미 설치됨 — 덮어쓸까요?');
          if (!ow) return;
          res = await post(true);
        }
        if (res && !res.ok) {
          if (this._ctx.notify) this._ctx.notify(res.error || '설치 실패', { type: 'error' });
          return;
        }
        if (this._ctx.notify) this._ctx.notify(`✦ ${id} 스킬 설치 완료`, { type: 'success' });
        await this._reload();   // 설치됨 > Claude Skill 갱신
        this._renderBody();
      } catch (e) {
        if (this._ctx.notify) this._ctx.notify('설치 실패: ' + e, { type: 'error' });
      }
    });
  },

  // 스킬 설치 위치 선택 모달 — Global(~/.claude/skills) / project_root 있는 프로젝트.
  // 설치 클릭 시 onPick({scope, projectId}) 호출, 취소 시 그냥 닫는다.
  async _chooseSkillInstallDest(subTitle, onPick) {
    let projects = [];
    try {
      const pr = await this._ctx.api('/api/projects');
      projects = (Array.isArray(pr) ? pr : []).filter(p => (p.project_root || '').trim());
    } catch (_) {}
    const opt = (val, label, sub, checked) => `
      <label style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);
                    border-radius:8px;cursor:pointer;margin-bottom:6px;">
        <input type="radio" name="pl-skill-dest" value="${this._esc(val)}" ${checked ? 'checked' : ''} style="margin-top:3px;">
        <span style="min-width:0;">
          <span style="font-size:.84rem;font-weight:600;">${label}</span>
          ${sub ? `<span style="display:block;font-size:.72rem;color:var(--text-mute);font-family:monospace;word-break:break-all;">${this._esc(sub)}</span>` : ''}
        </span>
      </label>`;
    const rows = opt('global', _plT('install_dest_global_skill'), '', true)
      + (projects.length
        ? projects.map(p => opt(`p:${p.id}`, `📁 ${this._esc(p.name)}`, `${p.project_root}\\.claude\\skills`, false)).join('')
        : `<div style="font-size:.75rem;color:var(--text-mute);padding:4px 2px;">${_plT('install_dest_empty')}</div>`);
    const ov = this._openMarketDetailOverlay(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:44px;height:44px;border-radius:10px;background:rgba(156,39,176,.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">✦</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${_plT('install_dest_title')}</div>
          <div style="font-size:.75rem;color:var(--text-mute);">${this._esc(subTitle || '')}</div>
        </div>
      </div>
      <div style="max-height:46vh;overflow-y:auto;">${rows}</div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="pl-skill-dest-ok" style="padding:8px 22px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid #9c27b0;background:#9c27b0;color:#fff;">${_plT('btn_install')}</button>
        <button id="pl-skill-dest-cancel" style="padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.83rem;border:1px solid var(--border);background:transparent;color:inherit;">${_plT('btn_cancel')}</button>
      </div>`);
    ov.querySelector('#pl-skill-dest-cancel').onclick = () => this._closeMarketDetailOverlay();
    ov.querySelector('#pl-skill-dest-ok').onclick = () => {
      const sel = ov.querySelector('input[name="pl-skill-dest"]:checked');
      const val = (sel && sel.value) || 'global';
      this._closeMarketDetailOverlay();
      onPick({ scope: val === 'global' ? 'global' : 'project',
               projectId: val.startsWith('p:') ? Number(val.slice(2)) : null });
    };
  },

  // ── 통합 설치됨 목록 ──────────────────────────────────
  _pName(p) {
    const lang = window._EP4_LANG || 'ko';
    return (p.names && (p.names[lang] || p.names.en || p.names.ko)) || p.name || p.id;
  },
  _pDesc(p) {
    const lang = window._EP4_LANG || 'ko';
    // 한국어 모드: 매니페스트에 ko 설명이 없으면 서버가 캐시해 둔 사전 번역(description_ko) 사용
    if (lang === 'ko' && !(p.descriptions && p.descriptions.ko) && p.description_ko) {
      return p.description_ko;
    }
    return (p.descriptions && (p.descriptions[lang] || p.descriptions.en || p.descriptions.ko)) || p.description || '';
  },

  _allInstalled() {
    // EP4 플러그인 중 manifest type 이 claude 인 것은 Claude Plugin 으로 구분
    const views = this._viewPlugins.map(p => ({
      ...p,
      _type: (p.type === 'claude') ? 'claude_plugin' : 'view',
    }));
    const mcps = this._mcpConnectors.map(c => ({
      id: `mcp:${c.name}`,
      name: c.name,
      description: [c.command, ...(c.args || [])].filter(Boolean).join(' '),
      icon: '⚡',
      enabled: true,
      _type: 'mcp',
      _raw: c,
    }));
    // 글로벌(~/.claude/skills) + 각 프로젝트(.claude/skills)의 Claude CLI 스킬
    const claudes = this._claudeSkills.map((s, i) => ({
      id: `claude:${i}`,
      name: s.scope === 'project' && s.project_name ? `${s.name} · 📁 ${s.project_name}` : s.name,
      description: s.description || '',
      icon: '✦',
      enabled: true,
      _type: 'claude_skill',
      _raw: { ...s, _idx: i },
    }));
    // 글로벌(~/.claude/agents) + 각 프로젝트(.claude/agents)의 Claude CLI 서브 에이전트
    const claudeAgents = this._claudeAgents.map((a, i) => ({
      id: `claudeagent:${i}`,
      name: a.scope === 'project' && a.project_name ? `${a.name} · 📁 ${a.project_name}` : a.name,
      description: a.description || '',
      icon: '🤖',
      enabled: true,
      _type: 'claude_agent',
      _raw: { ...a, _idx: i },
    }));
    const agents = this._agentList.map(a => ({
      ...a,
      _type: 'agent',
    }));
    return [...views, ...mcps, ...claudes, ...claudeAgents, ...agents];
  },

  // CLAUDE.md 카드 제목: Global/프로젝트명 + 원격이면 peer 라벨
  _claudeMdTitle(m) {
    const base = m.scope === 'global'
      ? '🌐 Global'
      : (m.projects || []).map(p => p.name).join(', ') || m.name;
    return m.remote ? `${base} @ ${m.peer_name || m.peer_url}` : base;
  },

  // 글로벌(~/.claude) + 각 프로젝트의 로컬 CLAUDE.md — 설치됨 > Claude 필터에서만 표시
  // (peer 공유분은 마켓플레이스 > Claude 에 표시)
  _claudeMdItems() {
    return this._claudeMdList
      .map((m, i) => ({ m, i }))
      .filter(x => !x.m.remote)
      .map(({ m, i }) => ({
        id: `claudemd:${i}`,
        name: this._claudeMdTitle(m),
        description: m.path,
        icon: '📄',
        enabled: m.exists !== false,
        _type: 'claude_md',
        _raw: { ...m, _idx: i },
      }));
  },

  // 글로벌(~/.claude/commands) + 각 프로젝트(.claude/commands)의 슬래시 커맨드
  // — 설치됨 > Claude 에 표시 (마켓 등록 스냅샷은 마켓플레이스 > Claude 에 표시)
  _claudeCommandItems() {
    return this._claudeCommands.map((c, i) => ({
      id: `claudecmd:${i}`,
      name: '/' + (c.id || c.name),
      description: c.description || c.path,
      icon: '⌨',
      enabled: true,
      _type: 'claude_command',
      _raw: { ...c, _idx: i },
    }));
  },


  // peer EP4 가 공유한 CLAUDE.md — 마켓플레이스 > Claude 에 표시 (_idx = _claudeMdList 인덱스)
  _remoteMdList() {
    return this._claudeMdList
      .map((m, i) => ({ ...m, _idx: i }))
      .filter(m => m.remote);
  },

  _filteredInstalled() {
    let items = this._allInstalled();
    if (this._activeFilter === 'claude') {
      items = items.concat(this._claudeCommandItems(), this._claudeMdItems());
    }
    const q = this._searchText.toLowerCase();
    if (q) items = items.filter(p =>
      this._pName(p).toLowerCase().includes(q) ||
      this._pDesc(p).toLowerCase().includes(q)
    );
    if (this._activeFilter === 'claude') {
      const types = {
        skill: ['claude_skill'], agent: ['claude_agent'], plugin: ['claude_plugin'],
        command: ['claude_command'], md: ['claude_md'],
      }[this._claudeSubFilter] || ['claude_skill', 'claude_agent', 'claude_plugin', 'claude_command', 'claude_md'];
      items = items.filter(p => types.includes(p._type));
    } else if (this._activeFilter !== 'all') {
      items = items.filter(p => p._type === this._activeFilter);
    }
    return items;
  },

  // Claude 서브 필터 칩 (전체 / ✦ Skill / 🤖 Agent / 🧩 Plugin / ⌨ Command / 📄 CLAUDE.md) — attr 로 설치됨/마켓 핸들러를 구분
  _claudeSubChips(activeSub, attr, withMd, withCmd) {
    const defs = [
      { id: 'all',    label: _plT('filter_all') },
      { id: 'skill',  label: '✦ Skill' },
      { id: 'agent',  label: '🤖 Agent' },
      { id: 'plugin', label: '🧩 Plugin' },
      ...(withCmd ? [{ id: 'command', label: '⌨ Command' }] : []),
      ...(withMd ? [{ id: 'md', label: '📄 CLAUDE.md' }] : []),
    ];
    const btns = defs.map(f => {
      const active = activeSub === f.id;
      return `<button ${attr}="${f.id}" style="
        padding:4px 12px;border-radius:16px;cursor:pointer;font-size:.74rem;
        border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
        background:${active ? 'var(--accent)' : 'transparent'};
        color:${active ? '#fff' : 'var(--text-mute)'};
        font-weight:${active ? '600' : '400'};
        transition:.12s;
      ">${f.label}</button>`;
    }).join('');
    return `<div style="display:flex;gap:6px;align-items:center;margin:-8px 0 16px 14px;">
      <span style="color:var(--text-dim);font-size:.78rem;">└</span>${btns}
    </div>`;
  },

  // ── 렌더링 ────────────────────────────────────────────
  _renderAll() {
    this._renderHeader();
    this._renderBody();
  },

  _renderHeader() {
    const el = this._container && this._container.querySelector('#pl-main-tabs');
    if (!el) return;
    const allCount = this._allInstalled().length;
    const tabs = [
      { id: 'installed', label: `${_plT('tab_installed')} (${allCount})` },
      { id: 'marketplace', label: _plT('tab_market') },
    ];
    el.innerHTML = tabs.map(t => {
      const active = t.id === this._activeTab;
      return `<button data-tab="${t.id}" style="
        padding:8px 18px;border:none;cursor:pointer;font-size:.85rem;
        border-bottom:2px solid ${active ? 'var(--accent)' : 'transparent'};
        background:transparent;
        color:${active ? 'var(--accent)' : 'var(--text-mute)'};
        font-weight:${active ? '700' : '400'};
        transition:.15s;
      ">${this._esc(t.label)}</button>`;
    }).join('');
    el.querySelectorAll('button[data-tab]').forEach(b => {
      b.onclick = () => {
        this._activeTab = b.dataset.tab;
        this._updateSettingsBtnStyle();
        this._renderHeader();
        this._renderBody();
        if (b.dataset.tab === 'marketplace' && !this._marketPlugins.length && !this._marketError) {
          this._loadMarketplace();
        }
      };
    });
    this._updateSettingsBtnStyle();
  },

  _updateSettingsBtnStyle() {
    const btn = this._container && this._container.querySelector('#pl-settings-tab');
    if (!btn) return;
    const active = this._activeTab === 'settings';
    btn.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    btn.style.color = active ? 'var(--accent)' : 'var(--text-mute)';
    btn.style.fontWeight = active ? '700' : '400';
  },

  _renderBody() {
    const host = this._container && this._container.querySelector('#pl-body');
    if (!host) return;
    if (this._activeTab === 'settings') {
      this._renderSettings(host);
    } else if (this._activeTab === 'marketplace') {
      this._renderMarket(host);
    } else {
      this._renderInstalled(host);
    }
  },

  _renderInstalled(host) {
    if (this._activeFilter === 'data') {
      this._renderData(host);
      return;
    }
    const filterDefs = [
      { id: 'all',    label: _plT('filter_all') },
      { id: 'view',   label: '⊞ View' },
      { id: 'mcp',    label: '⚡ MCP' },
      { id: 'claude', label: '🧩 Claude' },
      { id: 'agent',  label: _plT('filter_agent') },
      { id: 'data',   label: _plT('filter_data') },
    ];
    const filterBtns = filterDefs.map(f => {
      const active = this._activeFilter === f.id;
      return `<button data-filter="${f.id}" style="
        padding:6px 16px;border-radius:20px;cursor:pointer;font-size:.8rem;
        border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
        background:${active ? 'var(--accent)' : 'transparent'};
        color:${active ? '#fff' : 'var(--text-mute)'};
        font-weight:${active ? '600' : '400'};
        transition:.12s;
      ">${f.label}</button>`;
    }).join('');
    const subRow = this._activeFilter === 'claude'
      ? this._claudeSubChips(this._claudeSubFilter, 'data-claude-sub', true, true)
      : '';

    const items = this._filteredInstalled();

    // 빈 상태: 현재 필터명을 문구에 반영하고 마켓플레이스로 이동하는 버튼 제공
    const plainNames = { view: 'View', mcp: 'MCP', agent: _plT('badge_agent'),
      claude: { all: 'Claude', skill: 'Claude Skill', agent: 'Claude Agent', plugin: 'Claude Plugin', command: 'Command', md: 'CLAUDE.md' }[this._claudeSubFilter] || 'Claude' };
    const emptyMsg = this._activeFilter === 'all'
      ? _plT('empty_installed')
      : _plT('empty_installed_filter', plainNames[this._activeFilter] || this._activeFilter);
    const emptyHtml = `<div style="grid-column:1/-1;text-align:center;color:var(--text-mute);padding:40px 0;font-size:.85rem;">
        <div style="margin-bottom:14px;">${emptyMsg}</div>
        <button data-goto-market style="
          padding:6px 16px;border-radius:20px;cursor:pointer;font-size:.8rem;
          border:1px solid var(--accent);background:transparent;color:var(--accent);
          transition:.12s;">${_plT('goto_market')}</button>
      </div>`;

    const grid = (arr) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        ${arr.map(p => this._card(p)).join('')}
      </div>`;

    // Claude > 전체: Skill / Plugin 섹션으로 나눠 표시 (헤더 클릭 시 해당 서브 필터로 이동)
    let bodyHtml;
    if (this._activeFilter === 'claude' && this._claudeSubFilter === 'all' && items.length) {
      const section = (sub, icon, label, arr) => !arr.length ? '' : `
        <div style="margin-bottom:22px;">
          <div data-claude-sub="${sub}" style="font-size:.82rem;font-weight:700;color:var(--text-mute);
               margin-bottom:10px;cursor:pointer;display:inline-block;"
               onmouseenter="this.style.color='var(--accent)'"
               onmouseleave="this.style.color='var(--text-mute)'">${icon} ${label} (${arr.length})</div>
          ${grid(arr)}
        </div>`;
      bodyHtml =
        section('skill',   '✦', 'Claude Skill',  items.filter(p => p._type === 'claude_skill')) +
        section('agent',   '🤖', 'Claude Agent',  items.filter(p => p._type === 'claude_agent')) +
        section('plugin',  '🧩', 'Claude Plugin', items.filter(p => p._type === 'claude_plugin')) +
        section('command', '⌨', 'Command',       items.filter(p => p._type === 'claude_command')) +
        section('md',      '📄', 'CLAUDE.md',     items.filter(p => p._type === 'claude_md'));
    } else {
      bodyHtml = items.length
        ? grid(items)
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${emptyHtml}</div>`;
    }

    host.innerHTML = `
      <div style="display:flex;gap:6px;flex-shrink:0;margin-bottom:16px;">${filterBtns}</div>
      ${subRow}
      ${bodyHtml}`;

    host.querySelectorAll('[data-filter]').forEach(b => {
      b.onclick = () => {
        if (b.dataset.filter === 'claude' && this._activeFilter !== 'claude') this._claudeSubFilter = 'all';
        this._activeFilter = b.dataset.filter;
        this._renderBody();
      };
    });
    host.querySelectorAll('[data-claude-sub]').forEach(b => {
      b.onclick = () => {
        this._claudeSubFilter = b.dataset.claudeSub;
        this._renderBody();
      };
    });
    const gotoMarket = host.querySelector('[data-goto-market]');
    if (gotoMarket) {
      gotoMarket.onclick = () => {
        this._activeTab = 'marketplace';
        this._renderHeader();
        this._renderBody();
        if (!this._marketPlugins.length && !this._marketError) this._loadMarketplace();
      };
    }
    this._bindCardEvents(host);
  },

  _card(p) {
    const types = {
      view:   { badge: 'View',   color: '#4caf50', bg: 'rgba(76,175,80,.15)',   icon: p.icon || '⊞' },
      mcp:    { badge: 'MCP',    color: '#2196f3', bg: 'rgba(33,150,243,.15)',  icon: p.icon || '⚡' },
      claude_skill:  { badge: 'Claude Skill',  color: '#9c27b0', bg: 'rgba(156,39,176,.15)', icon: p.icon || '✦' },
      claude_agent:  { badge: 'Claude Agent',  color: '#5c6bc0', bg: 'rgba(92,107,192,.15)', icon: p.icon || '🤖' },
      claude_plugin: { badge: 'Claude Plugin', color: '#7e57c2', bg: 'rgba(126,87,194,.15)', icon: p.icon || '🧩' },
      claude_command:{ badge: 'Command',       color: '#ec407a', bg: 'rgba(236,64,122,.15)', icon: p.icon || '⌨' },
      claude_md:     { badge: 'CLAUDE.md',     color: '#26a69a', bg: 'rgba(38,166,154,.15)', icon: p.icon || '📄' },
      agent:  { badge: _plT('badge_agent'), color: '#ff9800', bg: 'rgba(255,152,0,.15)',   icon: p.icon || '🤖' },
    };
    const ti = types[p._type] || { badge: p._type, color: 'var(--accent)', bg: 'rgba(0,0,0,.05)', icon: '🧩' };

    // claude_plugin 은 EP4 플러그인이므로 view 와 동일하게 활성/삭제 제어
    const isEp4Plugin = p._type === 'view' || p._type === 'claude_plugin';
    // claude_md 는 enabled = 파일 존재 여부
    const enabled = (isEp4Plugin || p._type === 'claude_md') ? !!p.enabled : true;
    const required = !!p.required;
    const builtin = !!p.bundled;

    let actionBtn = '';
    if (isEp4Plugin && !required) {
      actionBtn = `<div style="display:flex;gap:6px;align-items:center;">
        <button data-toggle-view="${this._esc(p.id)}" data-next="${enabled ? '0' : '1'}" style="
            padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
            border:1px solid var(--border);background:var(--bg);color:inherit;
            transition:.12s;">${enabled ? _plT('btn_disable') : _plT('btn_enable')}</button>
        <button data-delete-plugin="${this._esc(p.id)}" data-delete-name="${this._esc(this._pName(p))}" title="${_plT('title_delete')}" style="
            padding:5px 9px;border-radius:6px;cursor:pointer;font-size:.78rem;
            border:1px solid #f8717155;background:transparent;color:#f87171;
            transition:.12s;">🗑</button>
      </div>`;
    } else if (p._type === 'claude_md') {
      const m = p._raw || {};
      // 로컬 Global 카드에만 peer 공유 토글 노출 (프로젝트는 프로젝트 설정의 '공유'를 따름)
      const shareBtn = (!m.remote && m.scope === 'global')
        ? `<button data-share-md="${m.shared ? '0' : '1'}" style="
              padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
              border:1px solid var(--border);background:var(--bg);color:inherit;
              transition:.12s;">${m.shared ? _plT('share_off') : _plT('share_on')}</button>`
        : '';
      actionBtn = `<div style="display:flex;gap:6px;align-items:center;">
        ${shareBtn}
        <button data-view-md="${m._idx}" style="
            padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
            border:1px solid ${ti.color};background:transparent;color:${ti.color};
            transition:.12s;">${_plT('btn_view')}</button>
      </div>`;
    } else if (p._type === 'claude_command') {
      const c = p._raw || {};
      // 로컬 Global 커맨드에만 peer 공유 토글 노출 — 글로벌 커맨드 전체에 일괄 적용되는
      // 단일 설정(share_claude_commands_global)이다 (CLAUDE.md Global 토글과 동일 방식)
      const shareBtn = (c.scope === 'global')
        ? `<button data-share-cmd="${c.shared ? '0' : '1'}" style="
              padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
              border:1px solid var(--border);background:var(--bg);color:inherit;
              transition:.12s;">${c.shared ? _plT('share_off') : _plT('share_on')}</button>`
        : '';
      actionBtn = `<div style="display:flex;gap:6px;align-items:center;">
        ${shareBtn}
        <button data-view-cmd="${c._idx}" style="
            padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
            border:1px solid ${ti.color};background:transparent;color:${ti.color};
            transition:.12s;">${_plT('btn_view')}</button>
      </div>`;
    } else if (p._type === 'claude_skill') {
      const s = p._raw || {};
      actionBtn = `<button data-view-skill="${s._idx != null ? s._idx : ''}" style="
          padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
          border:1px solid ${ti.color};background:transparent;color:${ti.color};
          transition:.12s;">${_plT('btn_view')}</button>`;
    } else if (p._type === 'claude_agent') {
      const a = p._raw || {};
      actionBtn = `<button data-view-agent="${a._idx != null ? a._idx : ''}" style="
          padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
          border:1px solid ${ti.color};background:transparent;color:${ti.color};
          transition:.12s;">${_plT('btn_view')}</button>`;
    } else if (p._type === 'mcp') {
      actionBtn = `<button data-remove-mcp="${this._esc(p._raw && p._raw.name || p.name)}" style="
          padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
          border:1px solid var(--border);background:var(--bg);color:inherit;
          transition:.12s;">${_plT('btn_disable')}</button>`;
    } else if (p._type === 'agent') {
      const activeAgent = (typeof localStorage !== 'undefined' && localStorage.getItem('ep4_mascot')) || 'octopus';
      const isActive = activeAgent === p.id;
      const selectBtn = isActive
        ? `<span style="font-size:.74rem;color:${ti.color};font-weight:600;padding:5px 10px;">${_plT('status_in_use')}</span>`
        : `<button data-select-agent="${this._esc(p.id)}" style="
              padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
              border:1px solid ${ti.color};background:transparent;color:${ti.color};
              transition:.12s;">${_plT('btn_select')}</button>`;
      actionBtn = `<div style="display:flex;gap:6px;align-items:center;">
        ${selectBtn}
        <button data-delete-plugin="${this._esc(p.id)}" data-delete-name="${this._esc(this._pName(p))}" title="삭제" style="
            padding:5px 9px;border-radius:6px;cursor:pointer;font-size:.78rem;
            border:1px solid #f8717155;background:transparent;color:#f87171;
            transition:.12s;">🗑</button>
      </div>`;
    }

    const activeAgent2 = p._type === 'agent'
      ? ((typeof localStorage !== 'undefined' && localStorage.getItem('ep4_mascot')) || 'octopus')
      : null;
    const statusColor = p._type === 'agent'
      ? (activeAgent2 === p.id ? ti.color : 'var(--text-mute)')
      : (enabled ? ti.color : 'var(--text-mute)');
    const statusText = p._type === 'view'
      ? (required ? _plT('status_required') : (enabled ? _plT('status_active') : _plT('status_inactive')))
      : p._type === 'agent'
        ? (activeAgent2 === p.id ? _plT('status_in_use') : _plT('status_standby'))
        : p._type === 'claude_md'
          ? `${(((p._raw && p._raw.size) || 0) / 1024).toFixed(1)} KB`
            + (p._raw && p._raw.remote ? ` · ${_plT('md_remote')}` : '')
            + (p._raw && !p._raw.remote && p._raw.shared ? ` · ${_plT('md_shared')}` : '')
          : p._type === 'claude_command'
            ? (p._raw && p._raw.scope === 'global' ? '🌐 Global' : (p._raw && p._raw.project_name) || 'Project')
              + (p._raw && p._raw.shared ? ` · ${_plT('md_shared')}` : '')
            : _plT('status_active');
    const builtinBadge = builtin
      ? `<span style="font-size:.65rem;color:var(--text-mute);background:var(--border);
                       border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle;">${_plT('badge_builtin')}</span>`
      : '';

    return `<div style="
        border:1px solid var(--border);border-radius:12px;padding:16px;
        background:var(--card);display:flex;flex-direction:column;min-height:155px;
        transition:.15s;box-sizing:border-box;"
        onmouseenter="this.style.borderColor='var(--accent,#6366f1)';this.style.boxShadow='0 2px 10px rgba(0,0,0,.08)'"
        onmouseleave="this.style.borderColor='var(--border)';this.style.boxShadow='none'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div style="width:44px;height:44px;border-radius:10px;background:${ti.bg};
                    display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">
          ${this._esc(ti.icon)}
        </div>
        <span style="font-size:.7rem;color:${ti.color};font-weight:600;padding-top:2px;letter-spacing:.3px;">
          ${ti.badge}
        </span>
      </div>
      <div style="font-weight:700;font-size:.88rem;margin-bottom:4px;line-height:1.3;">
        ${this._hlText(this._pName(p), this._searchText)}${builtinBadge}
      </div>
      <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;flex:1;
                  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
        ${this._hlText(this._pDesc(p), this._searchText)}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
        <span style="font-size:.74rem;color:${statusColor};display:flex;align-items:center;gap:4px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};
                       display:inline-block;flex-shrink:0;"></span>
          ${statusText}
        </span>
        ${actionBtn}
      </div>
    </div>`;
  },

  _bindCardEvents(host) {
    host.querySelectorAll('[data-toggle-view]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._toggleView(el.dataset.toggleView, el.dataset.next === '1');
      };
    });
    host.querySelectorAll('[data-remove-mcp]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._removeMcp(el.dataset.removeMcp);
      };
    });
    host.querySelectorAll('[data-view-md]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._showClaudeMdDetail(el.dataset.viewMd);
      };
    });
    host.querySelectorAll('[data-view-cmd]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._showClaudeCommandDetail(el.dataset.viewCmd);
      };
    });
    host.querySelectorAll('[data-view-skill]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._showLocalSkillDetail(el.dataset.viewSkill);
      };
    });
    host.querySelectorAll('[data-view-agent]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._showLocalAgentDetail(el.dataset.viewAgent);
      };
    });
    host.querySelectorAll('[data-share-md]').forEach(el => {
      el.onclick = async e => {
        e.stopPropagation();
        try {
          await this._ctx.api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'share_claude_md_global', value: el.dataset.shareMd }),
          });
          await this._reload();
        } catch (err) {
          if (this._ctx.notify) this._ctx.notify(`${_plT('notify_share_fail')}: ${err}`, { type: 'error' });
        }
      };
    });
    host.querySelectorAll('[data-share-cmd]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._toggleCommandShare(el.dataset.shareCmd === '1');
      };
    });
    host.querySelectorAll('[data-select-agent]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const id = el.dataset.selectAgent;
        if (typeof localStorage !== 'undefined') localStorage.setItem('ep4_mascot', id);
        if (window.setMascot) window.setMascot(id);
        this._renderBody();
      };
    });
    host.querySelectorAll('[data-delete-plugin]').forEach(el => {
      el.onclick = async e => {
        e.stopPropagation();
        const id = el.dataset.deletePlugin;
        const name = el.dataset.deleteName || id;
        const ok = await (this._ctx.confirm
          ? this._ctx.confirm(_plT('confirm_delete', name), { title: _plT('title_delete'), type: 'delete' })
          : Promise.resolve(confirm(_plT('confirm_delete', name))));
        if (!ok) return;
        await this._deletePlugin(id, name);
      };
    });
  },

  _renderData(host) {
    // ep4_data_manifest 레지스트리 읽기
    let manifest = {};
    try { manifest = JSON.parse(localStorage.getItem('ep4_data_manifest') || '{}'); } catch {}

    // 설치된 플러그인의 dataKeys도 병합 (레지스트리에 없는 경우 보완)
    for (const p of this._viewPlugins) {
      if (!Array.isArray(p.dataKeys)) continue;
      for (const dk of p.dataKeys) {
        if (!manifest[dk.key]) {
          manifest[dk.key] = {
            pluginId: p.id, pluginName: p.name, pluginType: p.type || 'view',
            label: dk.label, key: dk.key, type: dk.type,
          };
        }
      }
    }

    const entries = Object.values(manifest);
    const installedIds = new Set(this._viewPlugins.map(p => p.id));

    const typeStyle = {
      view:   { color: '#4caf50', bg: 'rgba(76,175,80,.15)',   badge: 'View' },
      mcp:    { color: '#2196f3', bg: 'rgba(33,150,243,.15)',  badge: 'MCP' },
      claude: { color: '#7e57c2', bg: 'rgba(126,87,194,.15)', badge: 'Claude Plugin' },
      agent:  { color: '#ff9800', bg: 'rgba(255,152,0,.15)',   badge: _plT('badge_agent') },
    };

    const filterDefs = [
      { id: 'all',    label: _plT('filter_all') },
      { id: 'view',   label: '⊞ View' },
      { id: 'mcp',    label: '⚡ MCP' },
      { id: 'claude', label: '🧩 Claude' },
      { id: 'agent',  label: _plT('filter_agent') },
      { id: 'data',   label: _plT('filter_data') },
    ];
    const filterBtns = filterDefs.map(f => {
      const active = this._activeFilter === f.id;
      return `<button data-filter="${f.id}" style="
        padding:6px 16px;border-radius:20px;cursor:pointer;font-size:.8rem;
        border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
        background:${active ? 'var(--accent)' : 'transparent'};
        color:${active ? '#fff' : 'var(--text-mute)'};
        font-weight:${active ? '600' : '400'};transition:.12s;">${f.label}</button>`;
    }).join('');

    let cardsHtml = '';
    if (entries.length === 0) {
      cardsHtml = `<div style="text-align:center;color:var(--text-mute);padding:60px;font-size:.85rem;">
        ${_plT('empty_data')}</div>`;
    } else {
      cardsHtml = `<div style="display:flex;flex-direction:column;gap:10px;">` +
        entries.map(entry => {
          let count = 0, hasData = false, updatedAt = entry.updatedAt || null;
          try {
            const raw = localStorage.getItem(entry.key);
            if (raw !== null) {
              hasData = true;
              const parsed = JSON.parse(raw);
              count = Array.isArray(parsed) ? parsed.length : 1;
            }
          } catch {}

          const tc = typeStyle[entry.pluginType] || { color: 'var(--accent)', bg: 'rgba(99,102,241,.13)', badge: entry.pluginType || '?' };
          const isInstalled = installedIds.has(entry.pluginId);
          const statusColor = isInstalled ? '#4caf50' : '#ff9800';
          const statusText  = isInstalled ? _plT('installed_badge') : _plT('not_installed');
          const dateStr = updatedAt ? new Date(updatedAt).toLocaleDateString('ko-KR') : '-';

          return `<div style="
              border:1px solid var(--border);border-radius:12px;padding:16px 20px;
              background:var(--card);display:flex;align-items:center;gap:16px;
              transition:.15s;box-sizing:border-box;"
              onmouseenter="this.style.borderColor='var(--border-hi)'"
              onmouseleave="this.style.borderColor='var(--border)'">
            <div style="width:44px;height:44px;border-radius:10px;background:${tc.bg};
                        display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">
              📦
            </div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
                <span style="font-size:.7rem;color:${tc.color};font-weight:700;
                             background:${tc.bg};padding:2px 7px;border-radius:4px;">
                  ${tc.badge}
                </span>
                <span style="font-weight:700;font-size:.9rem;">${this._esc(entry.pluginName)}</span>
              </div>
              <div style="font-size:.8rem;color:var(--text-mute);margin-bottom:4px;">
                ${this._esc(entry.label)}
              </div>
              <div style="display:flex;align-items:center;gap:12px;font-size:.76rem;">
                <span style="color:var(--accent2,#38bdf8);font-weight:600;">
                  ${hasData ? `${count.toLocaleString()}건 저장됨` : '데이터 없음'}
                </span>
                ${dateStr !== '-' ? `<span style="color:var(--text-dim);">최근 수정: ${dateStr}</span>` : ''}
                <span style="color:${statusColor};">● ${statusText}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              ${!isInstalled ? `<button data-restore-plugin="${this._esc(entry.pluginId)}" style="
                  padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
                  border:1px solid var(--accent);background:transparent;color:var(--accent);">
                  ${_plT('btn_reinstall')}
                </button>` : ''}
              <button data-delete-data="${this._esc(entry.key)}" data-delete-label="${this._esc(entry.pluginName + ' · ' + entry.label)}" style="
                  padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;
                  border:1px solid #e06c75;background:transparent;color:#e06c75;">
                ${_plT('title_delete')}
              </button>
            </div>
          </div>`;
        }).join('') + `</div>`;
    }

    host.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">${filterBtns}</div>
      <div style="margin-bottom:10px;font-size:.8rem;color:var(--text-mute);">
        ${_plT('data_preserved')}
      </div>
      ${cardsHtml}`;

    host.querySelectorAll('[data-filter]').forEach(b => {
      b.onclick = () => {
        if (b.dataset.filter === 'claude') this._claudeSubFilter = 'all';
        this._activeFilter = b.dataset.filter;
        this._renderBody();
      };
    });
    host.querySelectorAll('[data-delete-data]').forEach(el => {
      el.onclick = () => {
        const key = el.dataset.deleteData;
        const label = el.dataset.deleteLabel || key;
        if (!confirm(_plT('confirm_delete_data', label))) return;
        localStorage.removeItem(key);
        const m = JSON.parse(localStorage.getItem('ep4_data_manifest') || '{}');
        delete m[key];
        localStorage.setItem('ep4_data_manifest', JSON.stringify(m));
        this._renderBody();
      };
    });
    host.querySelectorAll('[data-restore-plugin]').forEach(el => {
      el.onclick = () => {
        this._activeTab = 'marketplace';
        this._activeFilter = 'all';
        this._renderHeader();
        this._renderBody();
        if (!this._marketPlugins.length && !this._marketError) this._loadMarketplace();
      };
    });
  },

  _renderMarket(host) {
    // 마켓 화면이 어떤 경로로 렌더되든(탭 클릭 외 직접 진입·재렌더 포함)
    // 커맨드/스킬 목록이 미로드 상태면 여기서 로드를 시작한다 —
    // 완료 시 로더가 다시 _renderBody() 를 호출해 스피너가 해소된다.
    if (!this._marketCommandsLoaded && !this._marketCommandsLoading) this._loadMarketCommands(false);
    if (!this._marketSkillsLoaded && !this._marketSkillsLoading) this._loadMarketSkills(false);
    if (!this._marketRegSkillsLoaded && !this._marketRegSkillsLoading) this._loadMarketRegSkills(false);
    if (!this._marketRegAgentsLoaded && !this._marketRegAgentsLoading) this._loadMarketRegAgents(false);

    // 필터 버튼
    const filterDefs = [
      { id: 'all',    label: '전체' },
      { id: 'view',   label: '⊞ View' },
      { id: 'mcp',    label: '⚡ MCP' },
      { id: 'claude', label: '🧩 Claude' },
      { id: 'agent',  label: '🤖 도우미' },
    ];
    const filterBtns = filterDefs.map(f => {
      const active = this._marketFilter === f.id;
      return `<button data-mfilter="${f.id}" style="
        padding:6px 16px;border-radius:20px;cursor:pointer;font-size:.8rem;
        border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
        background:${active ? 'var(--accent)' : 'transparent'};
        color:${active ? '#fff' : 'var(--text-mute)'};
        font-weight:${active ? '600' : '400'};
        transition:.12s;
      ">${f.label}</button>`;
    }).join('');

    const subRow = this._marketFilter === 'claude'
      ? this._claudeSubChips(this._marketClaudeSub, 'data-mclaude-sub', true, true)
      : '';

    // 필터 적용 — 마켓 플러그인 중 type: claude 가 Claude Plugin, 외부 저장소 스킬이 Claude Skill
    const claudeSub = this._marketClaudeSub;
    const skillOnly = this._marketFilter === 'claude' && claudeSub === 'skill';
    const agentOnly = this._marketFilter === 'claude' && claudeSub === 'agent';
    const mdOnly    = this._marketFilter === 'claude' && claudeSub === 'md';
    const cmdOnly   = this._marketFilter === 'claude' && claudeSub === 'command';
    let items = (skillOnly || agentOnly || mdOnly || cmdOnly) ? [] : this._marketPlugins;
    if (this._marketFilter !== 'all' && !skillOnly && !agentOnly && !mdOnly && !cmdOnly) {
      items = items.filter(p => (p.type || 'view') === this._marketFilter);
    }
    const showSkills = this._marketFilter === 'all'
      || (this._marketFilter === 'claude' && claudeSub !== 'plugin' && claudeSub !== 'md' && claudeSub !== 'command' && claudeSub !== 'agent');
    // 마켓 등록 서브 에이전트 — 전체 / Claude>전체 / Claude>Agent 에서 표시
    const showAgents = this._marketFilter === 'all'
      || (this._marketFilter === 'claude' && (claudeSub === 'all' || claudeSub === 'agent'));
    // peer 공유 CLAUDE.md — 전체 / Claude>전체 / Claude>CLAUDE.md 에서 표시
    const showMds = this._marketFilter === 'all'
      || (this._marketFilter === 'claude' && (claudeSub === 'all' || claudeSub === 'md'));
    // peer 공유 커맨드 — 전체 / Claude>전체 / Claude>Command 에서 표시
    const showCmds = this._marketFilter === 'all'
      || (this._marketFilter === 'claude' && (claudeSub === 'all' || claudeSub === 'command'));

    let cardsHtml = '';
    if (this._marketLoading) {
      cardsHtml = `<div style="text-align:center;color:var(--text-mute);padding:60px;font-size:.85rem;">불러오는 중...</div>`;
    } else if (this._marketError) {
      cardsHtml = `<div style="text-align:center;color:#e06c75;padding:30px;font-size:.83rem;">${this._esc(this._marketError)}</div>`;
    } else if (this._marketSource === 'firebase+github' ? !this._firebaseUrl : !this._marketUrl) {
      cardsHtml = `<div style="text-align:center;color:var(--text-mute);padding:60px;font-size:.85rem;">
        ${_plT('set_market_source')}</div>`;
    } else if (items.length === 0) {
      const emptyHint = this._marketSource === 'firebase+github'
        ? `<div style="font-size:.75rem;color:var(--text-mute);margin-top:10px;line-height:1.7;">
            ${_plT('empty_firebase')}<br>
            <code style="background:rgba(128,128,128,.15);padding:2px 6px;border-radius:4px;font-size:.78rem;">
              migrate_market.bat
            </code>
          </div>`
        : '';
      cardsHtml = `<div style="text-align:center;padding:50px 30px;">
        <div style="color:var(--text-mute);font-size:.85rem;">${_plT('empty_market')}</div>
        ${emptyHint}
      </div>`;
    } else {
      const installedIds = new Set(this._viewPlugins.map(p => p.id));
      const types = {
        view:   { color: '#4caf50', bg: 'rgba(76,175,80,.15)' },
        mcp:    { color: '#2196f3', bg: 'rgba(33,150,243,.15)' },
        claude: { color: '#7e57c2', bg: 'rgba(126,87,194,.15)' },
      };
      const cards = items.map(p => {
        const isInstalled = installedIds.has(p.id);
        const ptype = (p.type || 'view').toLowerCase();
        const ti = types[ptype] || { color: 'var(--accent)', bg: 'rgba(99,102,241,.13)' };
        const actionBtn = isInstalled
          ? `<span style="font-size:.72rem;color:var(--accent);">${_plT('installed_badge')}</span>`
          : `<button data-install-plugin="${this._esc(p.id)}" style="padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;border:1px solid var(--accent);background:transparent;color:var(--accent);">${_plT('btn_install')}</button>`;
        return `<div data-detail-plugin="${this._esc(p.id)}" title="클릭하여 상세 보기"
                    style="border:1px solid var(--border);border-radius:12px;padding:16px;
                            background:var(--card);display:flex;flex-direction:column;min-height:155px;
                            box-sizing:border-box;transition:.15s;cursor:pointer;"
                    onmouseenter="this.style.borderColor='var(--accent,#6366f1)'"
                    onmouseleave="this.style.borderColor='var(--border)'">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
            <div style="width:44px;height:44px;border-radius:10px;background:${ti.bg};
                        display:flex;align-items:center;justify-content:center;font-size:1.25rem;">
              ${this._esc(p.icon || '🧩')}
            </div>
            <span style="font-size:.7rem;color:var(--text-dim);">v${this._esc(p.version || '?')}</span>
          </div>
          <div style="font-weight:700;font-size:.88rem;margin-bottom:4px;">${this._esc(this._pName(p))}</div>
          <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;flex:1;
                      overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
            ${this._esc(this._pDesc(p))}
          </div>
          <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:12px;">
            ${actionBtn}
          </div>
        </div>`;
      }).join('');
      cardsHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${cards}</div>`;
      // Claude > 전체: 스킬 섹션과 짝을 이루는 Claude Plugin 섹션 헤더
      if (this._marketFilter === 'claude' && claudeSub === 'all') {
        cardsHtml = `<div data-mclaude-sub="plugin" style="font-size:.82rem;font-weight:700;color:var(--text-mute);
            margin-bottom:10px;cursor:pointer;display:inline-block;"
            onmouseenter="this.style.color='var(--accent)'"
            onmouseleave="this.style.color='var(--text-mute)'">🧩 Claude Plugin (${items.length})</div>` + cardsHtml;
      }
    }

    // 외부 저장소 Claude Skill 섹션
    if (skillOnly || agentOnly || mdOnly || cmdOnly) cardsHtml = '';
    let skillsHtml = '';
    if (showSkills) {
      const installedSkillIds = new Set(this._claudeSkills.map(s => s.id));
      let inner = '';
      if (this._marketSkillsLoading || (!this._marketSkillsLoaded && !this._marketSkillsError)) {
        inner = `<div style="text-align:center;color:var(--text-mute);padding:30px;font-size:.83rem;">스킬 목록 불러오는 중...</div>`;
      } else if (this._marketSkillsError && !this._marketSkills.length) {
        inner = `<div style="text-align:center;color:#e06c75;padding:20px;font-size:.8rem;">${this._esc(this._marketSkillsError)}</div>`;
      } else if (!this._marketSkills.length) {
        inner = `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">외부 저장소에서 스킬을 찾지 못했습니다.</div>`;
      } else {
        const sCards = this._marketSkills.map(s => {
          const isInstalled = installedSkillIds.has(s.id);
          const actionBtn = isInstalled
            ? `<span style="font-size:.72rem;color:var(--accent);">${_plT('installed_badge')}</span>`
            : `<button data-install-skill="${this._esc(s.repo)}|${this._esc(s.id)}" style="padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;border:1px solid #9c27b0;background:transparent;color:#ba68c8;">${_plT('btn_install')}</button>`;
          return `<div data-detail-skill="${this._esc(s.repo)}|${this._esc(s.id)}" title="클릭하여 SKILL.md 상세 보기"
                      style="border:1px solid var(--border);border-radius:12px;padding:16px;
                              background:var(--card);display:flex;flex-direction:column;min-height:140px;
                              box-sizing:border-box;transition:.15s;cursor:pointer;"
                      onmouseenter="this.style.borderColor='#9c27b0'"
                      onmouseleave="this.style.borderColor='var(--border)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="width:44px;height:44px;border-radius:10px;background:rgba(156,39,176,.15);
                          display:flex;align-items:center;justify-content:center;font-size:1.25rem;">✦</div>
              <span style="font-size:.68rem;color:var(--text-dim);font-family:monospace;">${this._esc(s.repo)}</span>
            </div>
            <div style="font-weight:700;font-size:.88rem;margin-bottom:4px;">${this._esc(s.name || s.id)}</div>
            <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;flex:1;
                        overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
              ${this._esc(((window._EP4_LANG || 'ko') === 'ko' && s.description_ko) ? s.description_ko : (s.description || s.path))}
            </div>
            <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:12px;">${actionBtn}</div>
          </div>`;
        }).join('');
        inner = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${sCards}</div>`;
      }
      skillsHtml = `
        <div style="margin-top:${cardsHtml ? '20px' : '0'};">
          <div style="font-size:.82rem;font-weight:700;color:var(--text-mute);margin-bottom:10px;">
            <span data-mclaude-sub="skill" style="cursor:pointer;"
                  onmouseenter="this.style.color='var(--accent)'"
                  onmouseleave="this.style.color=''">✦ Claude Skill (외부 저장소) ${this._marketSkills.length || ''}</span>
            <span style="font-weight:400;font-size:.72rem;">— 설치 위치를 Global(~/.claude/skills) 또는 프로젝트(.claude/skills) 중에서 선택합니다</span>
          </div>
          ${inner}
        </div>`;
    }

    // 마켓(Firebase)에 등록된 스킬 섹션 — 이름(id) 기준 SKILL.md 스냅샷
    let regSkillsHtml = '';
    if (showSkills && !this._marketRegSkillsNoSource) {
      const mRs = this._marketRegSkills.map((s, i) => ({ ...s, _idx: i }));
      if (mRs.length || skillOnly || this._marketRegSkillsLoading || !this._marketRegSkillsLoaded) {
        let rsInner;
        if (this._marketRegSkillsLoading || !this._marketRegSkillsLoaded) {
          rsInner = `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">스킬 목록 불러오는 중...</div>`;
        } else if (this._marketRegSkillsError && !mRs.length) {
          rsInner = `<div style="text-align:center;color:#e06c75;padding:20px;font-size:.8rem;">${this._esc(this._marketRegSkillsError)}</div>`;
        } else if (!mRs.length) {
          rsInner = `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">${_plT('skill_market_empty')}</div>`;
        } else {
          const rsCards = mRs.map(s => `<div data-detail-rskill="${s._idx}" title="클릭하여 상세 보기"
                      style="border:1px solid var(--border);border-radius:12px;padding:16px;
                              background:var(--card);display:flex;flex-direction:column;min-height:140px;
                              box-sizing:border-box;transition:.15s;cursor:pointer;"
                      onmouseenter="this.style.borderColor='#9c27b0'"
                      onmouseleave="this.style.borderColor='var(--border)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="width:44px;height:44px;border-radius:10px;background:rgba(156,39,176,.15);
                          display:flex;align-items:center;justify-content:center;font-size:1.25rem;">✦</div>
              <span style="font-size:.68rem;color:var(--text-dim);font-family:monospace;">${s.host ? `@ ${this._esc(s.host)}` : ''}</span>
            </div>
            <div style="font-weight:700;font-size:.88rem;margin-bottom:4px;">${this._esc(s.name || s.id)}</div>
            <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;flex:1;
                        overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
              ${this._esc(s.description || '')}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
              <span style="font-size:.72rem;color:var(--text-mute);">${(((s.content || '').length) / 1024).toFixed(1)} KB</span>
              <button data-install-rskill="${s._idx}" style="padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;border:1px solid #9c27b0;background:transparent;color:#ba68c8;">${_plT('btn_install')}</button>
            </div>
          </div>`).join('');
          rsInner = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${rsCards}</div>`;
        }
        regSkillsHtml = `
          <div style="margin-top:${(cardsHtml || skillsHtml) ? '20px' : '0'};">
            <div style="font-size:.82rem;font-weight:700;color:var(--text-mute);margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span data-mclaude-sub="skill" style="cursor:pointer;"
                    onmouseenter="this.style.color='var(--accent)'"
                    onmouseleave="this.style.color=''">✦ ${_plT('skill_market_section')} ${mRs.length || ''}</span>
              <span style="font-weight:400;font-size:.72rem;">— 설치 위치를 Global(~/.claude/skills) 또는 프로젝트(.claude/skills) 중에서 선택합니다</span>
              <button data-skill-manual style="padding:3px 12px;border-radius:14px;cursor:pointer;font-size:.74rem;
                  border:1px solid #9c27b0;background:transparent;color:#ba68c8;font-weight:400;">${_plT('btn_cmd_manual')}</button>
            </div>
            ${rsInner}
          </div>`;
      }
    }

    // 마켓(Firebase)에 등록된 서브 에이전트 섹션 — 이름(id) 기준 .md 스냅샷
    let regAgentsHtml = '';
    if (showAgents && !this._marketRegAgentsNoSource) {
      const mRa = this._marketRegAgents.map((a, i) => ({ ...a, _idx: i }));
      if (mRa.length || agentOnly || this._marketRegAgentsLoading || !this._marketRegAgentsLoaded) {
        let raInner;
        if (this._marketRegAgentsLoading || !this._marketRegAgentsLoaded) {
          raInner = `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">에이전트 목록 불러오는 중...</div>`;
        } else if (this._marketRegAgentsError && !mRa.length) {
          raInner = `<div style="text-align:center;color:#e06c75;padding:20px;font-size:.8rem;">${this._esc(this._marketRegAgentsError)}</div>`;
        } else if (!mRa.length) {
          raInner = `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">${_plT('agent_market_empty')}</div>`;
        } else {
          const raCards = mRa.map(a => `<div data-detail-ragent="${a._idx}" title="클릭하여 상세 보기"
                      style="border:1px solid var(--border);border-radius:12px;padding:16px;
                              background:var(--card);display:flex;flex-direction:column;min-height:140px;
                              box-sizing:border-box;transition:.15s;cursor:pointer;"
                      onmouseenter="this.style.borderColor='#5c6bc0'"
                      onmouseleave="this.style.borderColor='var(--border)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="width:44px;height:44px;border-radius:10px;background:rgba(92,107,192,.15);
                          display:flex;align-items:center;justify-content:center;font-size:1.25rem;">🤖</div>
              <span style="font-size:.68rem;color:var(--text-dim);font-family:monospace;">${a.host ? `@ ${this._esc(a.host)}` : ''}</span>
            </div>
            <div style="font-weight:700;font-size:.88rem;margin-bottom:4px;">${this._esc(a.name || a.id)}</div>
            <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;flex:1;
                        overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
              ${this._esc(a.description || '')}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
              <span style="font-size:.72rem;color:var(--text-mute);">${(((a.content || '').length) / 1024).toFixed(1)} KB</span>
              <button data-install-ragent="${a._idx}" style="padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;border:1px solid #5c6bc0;background:transparent;color:#7986cb;">${_plT('btn_install')}</button>
            </div>
          </div>`).join('');
          raInner = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${raCards}</div>`;
        }
        regAgentsHtml = `
          <div style="margin-top:${(cardsHtml || skillsHtml || regSkillsHtml) ? '20px' : '0'};">
            <div style="font-size:.82rem;font-weight:700;color:var(--text-mute);margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span data-mclaude-sub="agent" style="cursor:pointer;"
                    onmouseenter="this.style.color='var(--accent)'"
                    onmouseleave="this.style.color=''">🤖 ${_plT('agent_market_section')} ${mRa.length || ''}</span>
              <span style="font-weight:400;font-size:.72rem;">— 설치 위치를 Global(~/.claude/agents) 또는 프로젝트(.claude/agents) 중에서 선택합니다</span>
              <button data-agent-manual style="padding:3px 12px;border-radius:14px;cursor:pointer;font-size:.74rem;
                  border:1px solid #5c6bc0;background:transparent;color:#7986cb;font-weight:400;">${_plT('btn_cmd_manual')}</button>
            </div>
            ${raInner}
          </div>`;
      }
    }

    // 마켓(Firebase)에 등록된 커맨드 섹션 — 이름(id) 기준 스냅샷
    let cmdHtml = '';
    if (showCmds && !this._marketCommandsNoSource) {
      const mCmds = this._marketCommands.map((c, i) => ({ ...c, _idx: i }));
      if (mCmds.length || cmdOnly || this._marketCommandsLoading || !this._marketCommandsLoaded) {
        let cmdInner;
        if (this._marketCommandsLoading || !this._marketCommandsLoaded) {
          cmdInner = `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">커맨드 목록 불러오는 중...</div>`;
        } else if (this._marketCommandsError && !mCmds.length) {
          cmdInner = `<div style="text-align:center;color:#e06c75;padding:20px;font-size:.8rem;">${this._esc(this._marketCommandsError)}</div>`;
        } else if (!mCmds.length) {
          cmdInner = `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">${_plT('cmd_market_empty')}</div>`;
        } else {
          const cCards = mCmds.map(c => `<div data-detail-cmd="${c._idx}" title="클릭하여 상세 보기"
                      style="border:1px solid var(--border);border-radius:12px;padding:16px;
                              background:var(--card);display:flex;flex-direction:column;min-height:140px;
                              box-sizing:border-box;transition:.15s;cursor:pointer;"
                      onmouseenter="this.style.borderColor='#ec407a'"
                      onmouseleave="this.style.borderColor='var(--border)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="width:44px;height:44px;border-radius:10px;background:rgba(236,64,122,.15);
                          display:flex;align-items:center;justify-content:center;font-size:1.25rem;">⌨</div>
              <span style="font-size:.68rem;color:var(--text-dim);font-family:monospace;">${c.host ? `@ ${this._esc(c.host)}` : ''}</span>
            </div>
            <div style="font-weight:700;font-size:.88rem;margin-bottom:4px;">/${this._esc(c.id || '')}</div>
            <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;flex:1;
                        overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-all;">
              ${this._esc(c.description || c.rel || '')}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
              <span style="font-size:.72rem;color:var(--text-mute);">${((c.size || 0) / 1024).toFixed(1)} KB</span>
              <button data-install-cmd="${c._idx}" style="padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;border:1px solid #ec407a;background:transparent;color:#ec407a;">${_plT('btn_install')}</button>
            </div>
          </div>`).join('');
          cmdInner = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${cCards}</div>`;
        }
        cmdHtml = `
          <div style="margin-top:${(cardsHtml || skillsHtml || regSkillsHtml || regAgentsHtml) ? '20px' : '0'};">
            <div style="font-size:.82rem;font-weight:700;color:var(--text-mute);margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span data-mclaude-sub="command" style="cursor:pointer;"
                    onmouseenter="this.style.color='var(--accent)'"
                    onmouseleave="this.style.color=''">⌨ ${_plT('cmd_market_section')} ${mCmds.length || ''}</span>
              <span style="font-weight:400;font-size:.72rem;">${_plT('md_market_hint')}</span>
              <button data-cmd-manual style="padding:3px 12px;border-radius:14px;cursor:pointer;font-size:.74rem;
                  border:1px solid #ec407a;background:transparent;color:#ec407a;font-weight:400;">${_plT('btn_cmd_manual')}</button>
            </div>
            ${cmdInner}
          </div>`;
      }
    }

    // 다른 EP4(peer)가 공유한 CLAUDE.md 섹션
    let mdHtml = '';
    if (showMds) {
      const remoteMds = this._remoteMdList();
      if (remoteMds.length || mdOnly) {
        const mCards = remoteMds.map(m => {
          const title = m.scope === 'global' ? '🌐 Global' : (m.name || 'Project');
          return `<div data-detail-md="${m._idx}" title="클릭하여 상세 보기"
                      style="border:1px solid var(--border);border-radius:12px;padding:16px;
                              background:var(--card);display:flex;flex-direction:column;min-height:140px;
                              box-sizing:border-box;transition:.15s;cursor:pointer;"
                      onmouseenter="this.style.borderColor='#26a69a'"
                      onmouseleave="this.style.borderColor='var(--border)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="width:44px;height:44px;border-radius:10px;background:rgba(38,166,154,.15);
                          display:flex;align-items:center;justify-content:center;font-size:1.25rem;">📄</div>
              <span style="font-size:.68rem;color:var(--text-dim);font-family:monospace;">@ ${this._esc(m.peer_name || m.peer_url || '')}</span>
            </div>
            <div style="font-weight:700;font-size:.88rem;margin-bottom:4px;">${this._esc(title)}</div>
            <div style="font-size:.75rem;color:var(--text-mute);line-height:1.5;flex:1;
                        overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-all;">
              ${this._esc(m.path || '')}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
              <span style="font-size:.72rem;color:var(--text-mute);">${((m.size || 0) / 1024).toFixed(1)} KB</span>
              <button data-install-md="${m._idx}" style="padding:5px 14px;border-radius:6px;cursor:pointer;font-size:.78rem;border:1px solid #26a69a;background:transparent;color:#26a69a;">${_plT('btn_install')}</button>
            </div>
          </div>`;
        }).join('');
        const mdInner = remoteMds.length
          ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${mCards}</div>`
          : `<div style="text-align:center;color:var(--text-mute);padding:20px;font-size:.83rem;">${_plT('md_market_empty')}</div>`;
        mdHtml = `
          <div style="margin-top:${(cardsHtml || skillsHtml || regSkillsHtml || regAgentsHtml || cmdHtml) ? '20px' : '0'};">
            <div style="font-size:.82rem;font-weight:700;color:var(--text-mute);margin-bottom:10px;">
              <span data-mclaude-sub="md" style="cursor:pointer;"
                    onmouseenter="this.style.color='var(--accent)'"
                    onmouseleave="this.style.color=''">📄 ${_plT('md_market_section')} ${remoteMds.length || ''}</span>
              <span style="font-weight:400;font-size:.72rem;">${_plT('md_market_hint')}</span>
            </div>
            ${mdInner}
          </div>`;
      }
    }

    host.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
        ${filterBtns}
        <button id="pl-market-refresh" style="padding:6px 14px;border-radius:8px;cursor:pointer;
            border:1px solid var(--border);background:var(--bg);color:var(--text-mute);
            font-size:.78rem;white-space:nowrap;margin-left:4px;">새로고침</button>
      </div>
      ${subRow}
      ${cardsHtml}${skillsHtml}${regSkillsHtml}${regAgentsHtml}${cmdHtml}${mdHtml}`;

    host.querySelectorAll('[data-mfilter]').forEach(b => {
      b.onclick = () => {
        if (b.dataset.mfilter === 'claude' && this._marketFilter !== 'claude') this._marketClaudeSub = 'all';
        this._marketFilter = b.dataset.mfilter;
        this._renderBody();
      };
    });
    host.querySelectorAll('[data-mclaude-sub]').forEach(b => {
      b.onclick = () => {
        this._marketFilter = 'claude';
        this._marketClaudeSub = b.dataset.mclaudeSub;
        this._renderBody();
      };
    });

    const refreshBtn = host.querySelector('#pl-market-refresh');
    if (refreshBtn) refreshBtn.onclick = () => {
      this._loadMarketplace();          // 플러그인 목록 + 스킬(캐시 TTL 검사)
      this._loadMarketSkills(true);     // 스킬은 강제 갱신 (서버가 ETag 304 로 최소화)
      this._loadMarketCommands(true);   // 커맨드도 강제 갱신 (서버 60초 캐시 무시)
      this._loadMarketRegSkills(true);  // 마켓 등록 스킬도 강제 갱신
      this._loadMarketRegAgents(true);  // 마켓 등록 에이전트도 강제 갱신
    };

    host.querySelectorAll('[data-install-plugin]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        this._installPlugin(el.dataset.installPlugin);
      };
    });

    host.querySelectorAll('[data-install-skill]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const [repo, id] = el.dataset.installSkill.split('|');
        this._installSkill(repo, id);
      };
    });

    // 카드 클릭 → 상세 보기
    host.querySelectorAll('[data-detail-plugin]').forEach(el => {
      el.onclick = () => this._showMarketPluginDetail(el.dataset.detailPlugin);
    });
    host.querySelectorAll('[data-detail-skill]').forEach(el => {
      el.onclick = () => {
        const [repo, id] = el.dataset.detailSkill.split('|');
        this._showSkillDetail(repo, id);
      };
    });
    host.querySelectorAll('[data-detail-md]').forEach(el => {
      el.onclick = () => this._showClaudeMdDetail(el.dataset.detailMd);
    });
    host.querySelectorAll('[data-install-md]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const m = this._claudeMdList[Number(el.dataset.installMd)];
        if (m) this._installClaudeMd(m);
      };
    });
    const manualBtn = host.querySelector('[data-cmd-manual]');
    if (manualBtn) manualBtn.onclick = () => this._showManualRegisterModal();
    const skillManualBtn = host.querySelector('[data-skill-manual]');
    if (skillManualBtn) skillManualBtn.onclick = () => this._showManualSkillRegisterModal();
    host.querySelectorAll('[data-detail-rskill]').forEach(el => {
      el.onclick = () => this._showMarketRegSkillDetail(el.dataset.detailRskill);
    });
    host.querySelectorAll('[data-install-rskill]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const s = this._marketRegSkills[Number(el.dataset.installRskill)];
        if (s) this._installMarketRegSkill(s);
      };
    });
    const agentManualBtn = host.querySelector('[data-agent-manual]');
    if (agentManualBtn) agentManualBtn.onclick = () => this._showManualAgentRegisterModal();
    host.querySelectorAll('[data-detail-ragent]').forEach(el => {
      el.onclick = () => this._showMarketRegAgentDetail(el.dataset.detailRagent);
    });
    host.querySelectorAll('[data-install-ragent]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const a = this._marketRegAgents[Number(el.dataset.installRagent)];
        if (a) this._installMarketRegAgent(a);
      };
    });
    host.querySelectorAll('[data-detail-cmd]').forEach(el => {
      el.onclick = () => this._showMarketCommandDetail(el.dataset.detailCmd);
    });
    host.querySelectorAll('[data-install-cmd]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const c = this._marketCommands[Number(el.dataset.installCmd)];
        if (c) this._installClaudeCommand(c);
      };
    });
  },

  _renderSettings(host) {
    const editing  = this._settingsEditing;
    const isFirebase = this._marketSource === 'firebase+github';

    // ── 보기 모드 ─────────────────────────────────────────
    if (!editing) {
      const rows = isFirebase ? [
        ['소스',           'Firebase + GitHub'],
        ['Firebase DB URL', this._firebaseUrl || _plT('not_set')],
        ['GitHub 저장소',  this._githubRepo   || _plT('not_set')],
        ['GitHub Token',   this._hasToken ? _plT('token_set_label') : _plT('token_none')],
      ] : [
        ['소스',           'Manager Server'],
        ['Server URL',     this._marketUrl || _plT('not_set')],
      ];

      const rowsHtml = rows.map(([k, v]) => `
        <div style="display:flex;gap:12px;padding:7px 0;
                    border-bottom:1px solid var(--border);align-items:baseline;">
          <span style="width:130px;flex-shrink:0;font-size:.78rem;color:var(--text-mute);">${k}</span>
          <span style="font-size:.83rem;word-break:break-all;">${this._esc(v)}</span>
        </div>`).join('');

      host.innerHTML = `
        <div style="max-width:560px;margin:0 auto;padding-top:8px;">
          <div style="font-size:.88rem;font-weight:700;margin-bottom:10px;">${_plT('settings_title')}</div>
          <div style="border:1px solid var(--border);border-radius:10px;padding:4px 14px;
                      background:var(--bg-alt,rgba(128,128,128,.05));margin-bottom:14px;">
            ${rowsHtml}
          </div>
          <button id="pl-settings-edit-btn" style="padding:7px 20px;border-radius:6px;cursor:pointer;
              border:1px solid var(--border);background:transparent;color:inherit;font-size:.83rem;
              display:inline-flex;align-items:center;gap:5px;">
            ✏ 수정
          </button>
        </div>`;

      host.querySelector('#pl-settings-edit-btn').onclick = () => {
        this._settingsEditing = true;
        this._renderBody();
      };
      return;
    }

    // ── 수정 모드 ─────────────────────────────────────────
    const srcBtn = (active) => `
      padding:7px 18px;border-radius:6px;cursor:pointer;font-size:.82rem;
      border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
      background:${active ? 'var(--accent)' : 'transparent'};
      color:${active ? '#fff' : 'var(--text-mute)'};
      font-weight:${active ? '600' : '400'};transition:.12s;`;

    const inp = (id, type, placeholder, value) => `
      <input id="${id}" type="${type}" placeholder="${this._esc(placeholder)}"
          value="${this._esc(value)}"
          style="width:100%;box-sizing:border-box;padding:8px 10px;
                 border:1px solid var(--border);border-radius:6px;
                 background:var(--bg);color:inherit;font-size:.83rem;" />`;

    const managerFields = `
      <div style="margin-top:14px;">
        <div style="font-size:.83rem;font-weight:600;margin-bottom:4px;">Manager Server URL</div>
        ${inp('pl-cfg-manager-url','text','http://localhost:7799', this._marketUrl)}
      </div>`;

    const firebaseFields = `
      <div style="margin-top:14px;">
        <div style="font-size:.83rem;font-weight:600;margin-bottom:4px;">Firebase Realtime DB URL</div>
        <div style="font-size:.75rem;color:var(--text-mute);margin-bottom:5px;">
          Firebase 콘솔 → Realtime Database → 데이터 탭의 URL
        </div>
        ${inp('pl-cfg-firebase-url','text','https://xxx-default-rtdb.firebaseio.com', this._firebaseUrl)}
      </div>
      <div style="margin-top:12px;">
        <div style="font-size:.83rem;font-weight:600;margin-bottom:4px;">GitHub 저장소</div>
        ${inp('pl-cfg-github-repo','text','owner/ep4-marketplace', this._githubRepo)}
      </div>
      <div style="margin-top:12px;">
        <div style="font-size:.83rem;font-weight:600;margin-bottom:4px;">GitHub Token
          <span style="font-size:.72rem;font-weight:400;color:var(--text-mute);margin-left:6px;">
            (private 레포 · conf/marketplace.conf 에 저장)
          </span>
        </div>
        <div style="font-size:.75rem;color:var(--text-mute);margin-bottom:5px;">
          ${this._hasToken ? _plT('token_set') :
            'GitHub → Settings → Developer settings → Personal access tokens → repo 권한'}
        </div>
        ${inp('pl-cfg-github-token','password',
              this._hasToken ? '(변경하지 않으려면 비워두세요)' : 'ghp_xxxxxxxxxxxx', '')}
      </div>`;

    host.innerHTML = `
      <div style="max-width:560px;margin:0 auto;padding-top:8px;">
        <div style="font-size:.88rem;font-weight:700;margin-bottom:8px;">${_plT('settings_source')}</div>
        <div style="display:flex;gap:8px;margin-bottom:4px;">
          <button id="pl-src-manager"  style="${srcBtn(!isFirebase)}">Manager Server</button>
          <button id="pl-src-firebase" style="${srcBtn(isFirebase)}">Firebase + GitHub</button>
        </div>
        ${isFirebase ? firebaseFields : managerFields}
        <div style="margin-top:16px;display:flex;align-items:center;gap:10px;">
          <button id="pl-settings-save-all" style="padding:8px 22px;border-radius:6px;cursor:pointer;
              border:1px solid var(--accent);background:var(--accent);color:#fff;font-size:.83rem;">
            저장
          </button>
          <button id="pl-settings-cancel" style="padding:8px 16px;border-radius:6px;cursor:pointer;
              border:1px solid var(--border);background:transparent;color:inherit;font-size:.83rem;">
            취소
          </button>
          <span id="pl-settings-msg" style="font-size:.78rem;color:var(--accent);"></span>
        </div>
      </div>`;

    host.querySelector('#pl-src-manager').onclick  = () => { this._marketSource = 'manager';          this._renderBody(); };
    host.querySelector('#pl-src-firebase').onclick = () => { this._marketSource = 'firebase+github';  this._renderBody(); };
    host.querySelector('#pl-settings-cancel').onclick = () => { this._settingsEditing = false; this._renderBody(); };

    host.querySelector('#pl-settings-save-all').onclick = async () => {
      const msg = host.querySelector('#pl-settings-msg');
      try {
        const src = this._marketSource;
        const payload = { source: src };
        if (src === 'firebase+github') {
          payload.firebase_url  = (host.querySelector('#pl-cfg-firebase-url').value  || '').trim();
          payload.github_repo   = (host.querySelector('#pl-cfg-github-repo').value   || '').trim();
          const token           = (host.querySelector('#pl-cfg-github-token').value  || '').trim();
          if (token) payload.github_token = token;
          this._firebaseUrl = payload.firebase_url;
          this._githubRepo  = payload.github_repo;
          if (token) { this._githubToken = token; this._hasToken = true; }
        } else {
          payload.manager_url = (host.querySelector('#pl-cfg-manager-url').value || '').trim();
          this._marketUrl = payload.manager_url;
        }
        await this._ctx.api('/api/marketplace/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (msg) { msg.style.color = 'var(--accent)'; msg.textContent = '저장되었습니다.'; }
        this._marketPlugins = [];
        this._marketError = '';
        setTimeout(() => { this._settingsEditing = false; this._renderBody(); }, 700);
      } catch (e) {
        if (msg) { msg.style.color = '#e06c75'; msg.textContent = '저장 실패: ' + e; }
      }
    };
  },

  // ── 액션 ─────────────────────────────────────────────
  async _toggleView(id, next) {
    try {
      await this._ctx.api(`/api/plugins/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      await this._reload();
      if (window.EP4Shell) window.EP4Shell.reload();
    } catch (_) {
      if (this._ctx.notify) this._ctx.notify('상태 변경 실패', { type: 'error' });
    }
  },

  async _removeMcp(name) {
    if (!confirm(`"${name}" MCP 서버를 제거하시겠습니까?`)) return;
    try {
      await this._ctx.api('/api/mcp/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await this._reload();
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify('제거 실패: ' + e, { type: 'error' });
    }
  },

  async _deletePlugin(id, name) {
    try {
      const res = await this._ctx.api(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res && !res.ok) {
        if (this._ctx.notify) this._ctx.notify(res.error || _plT('notify_delete_fail'), { type: 'error' });
        return;
      }
      // 삭제된 도우미가 현재 사용 중이면 localStorage 초기화
      if (typeof localStorage !== 'undefined' && localStorage.getItem('ep4_mascot') === id) {
        localStorage.removeItem('ep4_mascot');
        if (window.setMascot) window.setMascot(null);
      }
      if (this._ctx.notify) this._ctx.notify(_plT('notify_deleted', name), { type: 'success' });
      await this._reload();
      if (window.EP4Shell) window.EP4Shell.reload();
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify(_plT('notify_delete_fail') + ': ' + e, { type: 'error' });
    }
  },

  async _installPlugin(id) {
    try {
      const isFirebase = this._marketSource === 'firebase+github';
      const payload = isFirebase
        ? { id, source: 'firebase+github', firebase_url: this._firebaseUrl,
            github_repo: this._githubRepo, github_token: this._githubToken }
        : { id, manager_url: this._marketUrl };
      const res = await this._ctx.api('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res && !res.ok) {
        if (this._ctx.notify) this._ctx.notify(res.error || _plT('notify_install_fail'), { type: 'error' });
        return;
      }
      if (this._ctx.notify) this._ctx.notify(_plT('notify_installed', id), { type: 'success' });
      await this._reload();
      if (window.EP4Shell) window.EP4Shell.reload();
    } catch (e) {
      if (this._ctx.notify) this._ctx.notify('설치 실패: ' + e, { type: 'error' });
    }
  },

  // ── 셸 구조 ──────────────────────────────────────────
  _shell() {
    return `<div style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;overflow:hidden;">
      <div style="padding:14px 20px 0;flex-shrink:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:1.05rem;font-weight:700;">${_plT('title')}</span>
          <button id="pl-more-btn" title="더 보기" style="
              background:none;border:none;cursor:pointer;font-size:1rem;
              color:var(--text-mute);padding:4px 8px;border-radius:6px;letter-spacing:3px;">
            ···
          </button>
        </div>
        <div style="display:flex;align-items:center;border-bottom:1px solid var(--border);">
          <div id="pl-main-tabs" style="display:flex;gap:0;flex:1;"></div>
          <button id="pl-settings-tab" style="
              padding:8px 14px;border:none;cursor:pointer;font-size:.82rem;
              border-bottom:2px solid transparent;margin-bottom:-1px;
              background:transparent;color:var(--text-mute);
              display:flex;align-items:center;gap:4px;white-space:nowrap;
              transition:.15s;">
            ${_plT('tab_settings')}
          </button>
        </div>
      </div>
      <div id="pl-body" style="flex:1;overflow-y:auto;padding:16px 20px;"></div>
    </div>`;
  },

  _bindShellEvents() {
    const settingsBtn = this._container && this._container.querySelector('#pl-settings-tab');
    if (settingsBtn) {
      settingsBtn.onclick = () => {
        this._activeTab = this._activeTab === 'settings' ? 'installed' : 'settings';
        this._settingsEditing = false;
        this._updateSettingsBtnStyle();
        this._renderHeader();
        this._renderBody();
      };
    }
  },

  // ── 유틸 ─────────────────────────────────────────────
  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },

  _hlText(text, q) {
    const safe = this._esc(text || '');
    if (!q) return safe;
    const idx = (text || '').toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return safe;
    return this._esc((text || '').slice(0, idx))
      + `<mark style="background:rgba(217,119,87,.35);color:inherit;border-radius:2px;">${this._esc((text || '').slice(idx, idx + q.length))}</mark>`
      + this._esc((text || '').slice(idx + q.length));
  },
};
