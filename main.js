const app = document.getElementById('app');
const statusEl = document.getElementById('connectionStatus');

const SUPABASE_URL = 'https://peiztoqldcnughvjksfa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hG8-xHmF5Bl-018C2mxoAg_QXV5e4ya';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  activeTab: 'classifica',
  authMode: 'login',
  session: null,
  account: null,
  students: [],
  leaderboard: [],
  events: [],
  auditLogs: [],
  archive: [],
  autogestione: { attiva: false, presenze: [], available: true },
  archiveDate: '',
  auditFilter: { actor: '', action: '', direction: '', date: '' },
  selectedStudentId: localStorage.getItem('fantascuola_student_id') || '',
  viewingPlayerId: '',
  profile: null,
  editingStudentId: '',
  accountSaving: false,
  accountAdmin: {
    open: false,
    loading: false,
    busy: false,
    error: '',
    users: [],
    search: '',
    editingUserId: '',
  },
  loading: true,
  error: '',
};

const defaultPreferences = {
  theme: 'new-ui',
  darkMode: false,
  textScale: 100,
  elementScale: 100,
  elementSpacing: 100,
  glassOpacity: 78,
  glassBlur: 18,
  boldText: false,
  accent: '#e65f3f',
  textColor: '#18222d',
  compact: false,
  reduceMotion: false,
  showBorders: true,
  showShadows: true,
  dockLegacy: false,
};
const preferences = { ...defaultPreferences, ...JSON.parse(localStorage.getItem('fantascuola_preferences') || '{}') };
if (!['new-ui', 'new-ui-dark', 'new-ui-red'].includes(preferences.theme)) preferences.theme = 'new-ui';

const fmt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'medium' });
function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function italyNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')), minute: Number(part('minute')) };
}
function isAutogestioneSunday(day) {
  return new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
}

function setStatus(text) {
  statusEl.textContent = text;
  const liveEl = document.getElementById('newUiLive');
  if (!liveEl) return;
  const isConnected = text === 'Live' || text === 'SUBSCRIBED';
  const isError = text.includes('Errore') || text.includes('CHANNEL_ERROR') || text.includes('TIMED_OUT');
  liveEl.dataset.connection = isConnected ? 'connected' : isError ? 'error' : 'syncing';
    liveEl.querySelector('.new-ui-live-text').textContent = isConnected ? 'LIVE' : isError ? 'OFFLINE' : 'SYNC';
}
function renderHeaderAccount() {
  const authStatus = document.getElementById('authStatus');
  const accountBtn = document.getElementById('accountBtn');
  const logoutBtn = document.getElementById('headerLogoutBtn');
  if (!authStatus || !accountBtn || !logoutBtn) return;
  authStatus.textContent = isLoggedIn() ? 'LOGGATO' : 'GUEST';
  authStatus.classList.toggle('logged', isLoggedIn());
  authStatus.classList.toggle('guest', !isLoggedIn());
  accountBtn.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">person</span><span>${isLoggedIn() ? 'Account' : 'Accedi'}</span>`;
  logoutBtn.hidden = !isLoggedIn();
}
function avatarFallback(name) {
  const initials = String(name || 'Player').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" fill="#e9eef2"/><circle cx="160" cy="126" r="62" fill="#b6c3cc"/><path d="M57 286c11-61 49-91 103-91s92 30 103 91" fill="#8b9aa5"/><text x="160" y="302" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#34434e">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function avatarMarkup(name, url, extra = '') {
  const fallback = avatarFallback(name);
  return `<img class="avatar" ${extra} src="${esc(url || fallback)}" alt="${esc(name)}" onerror="this.onerror=null;this.src='${fallback}'">`;
}
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function pointsLabel(points) { return `${points > 0 ? '+' : ''}${Number(points || 0).toFixed(1)}`; }
function isLoggedIn() { return Boolean(state.session); }
function isPremium() {
  const value = state.account?.is_premium;
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'TRUE';
}

const USERNAME_AUTH_DOMAIN = 'users.fantascuola.invalid';

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40);
}

function usernameToInternalEmail(username) {
  const normalized = normalizeUsername(username);
  return normalized ? `${normalized}@${USERNAME_AUTH_DOMAIN}` : '';
}

function isInternalUsernameEmail(email) {
  return String(email || '').toLowerCase().endsWith(`@${USERNAME_AUTH_DOMAIN}`);
}

function accountIdentityLabel(user) {
  if (user?.login_type === 'username' || user?.username) return `@${user.username || String(user.email || '').split('@')[0]}`;
  return user?.email || 'Nessuna email';
}

function accountConfirmed(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at || user?.login_type === 'username');
}
function applyPreferences() {
  const root = document.documentElement;
  preferences.darkMode = preferences.theme === 'dark';
  root.dataset.theme = preferences.theme;
  const isNewUi = preferences.theme.startsWith('new-ui');
  if (isNewUi && preferences.accent === defaultPreferences.accent) root.style.removeProperty('--accent');
  else root.style.setProperty('--accent', preferences.accent);
  if (isNewUi && preferences.textColor === defaultPreferences.textColor) root.style.removeProperty('--text');
  else if (preferences.darkMode && preferences.textColor === defaultPreferences.textColor) root.style.removeProperty('--text');
  else root.style.setProperty('--text', preferences.textColor);
  root.style.setProperty('--font-scale', `${Number(preferences.textScale) / 100}`);
  root.style.setProperty('--element-scale', `${Number(preferences.elementScale) / 100}`);
  root.style.setProperty('--element-spacing', `${Number(preferences.elementSpacing) / 100}`);
  root.style.setProperty('--glass-opacity', `${Number(preferences.glassOpacity) / 100}`);
  root.style.setProperty('--glass-blur', `${Number(preferences.glassBlur)}px`);
  const isLegacyTheme = ['new-ui', 'new-ui-dark'].includes(preferences.theme);
  const isMobileLayout = window.matchMedia('(max-width: 839px)').matches;
  document.body.classList.toggle('strong-type', preferences.boldText);
  document.body.classList.toggle('compact-ui', preferences.compact);
  document.body.classList.toggle('reduce-motion', preferences.reduceMotion);
  document.body.classList.toggle('hide-borders', !preferences.showBorders);
  document.body.classList.toggle('hide-shadows', !preferences.showShadows);
  document.body.classList.toggle('legacy-dock', isLegacyTheme && isMobileLayout && preferences.dockLegacy);
}
function savePreferences() {
  localStorage.setItem('fantascuola_preferences', JSON.stringify(preferences));
  applyPreferences();
}

async function loadData() {
  state.loading = true;
  await supabase.rpc('capture_daily_snapshot');
  const [studentsRes, leaderboardRes, votesRes, bonusRes, accountRes, auditRes, archiveRes, autogestioneRes, presenzeRes] = await Promise.all([
    supabase.from('studenti').select('*').order('nome'),
    supabase.from('classifica').select('*').order('punti_totali', { ascending: false }),
    supabase.from('voti').select('id, studente_id, voto, created_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('bonus_malus').select('id, studente_id, motivo, punti, created_at').order('created_at', { ascending: false }).limit(100),
    state.session
      ? loadAccountProfile()
      : Promise.resolve({ data: null, error: null }),
    state.session
      ? supabase.from('audit_logs').select('id, actor_email, action, entity, details, points_delta, studente_id, created_at').order('created_at', { ascending: false }).limit(250)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('classifica_archivio').select('*').order('snapshot_date', { ascending: false }).order('rank', { ascending: true }).limit(1000),
    supabase.from('autogestione_impostazioni').select('attiva').eq('id', true).maybeSingle(),
    state.session ? supabase.from('autogestione_presenze').select('*').order('giorno', { ascending: false }).limit(120) : Promise.resolve({ data: [], error: null }),
  ]);
  state.students = studentsRes.data || [];
  state.leaderboard = leaderboardRes.data || [];
  state.events = [
    ...(votesRes.data || []).map((item) => ({ kind: 'voto', ...item })),
    ...(bonusRes.data || []).map((item) => ({ kind: 'bonus', ...item })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  state.account = accountRes.data || null;
  state.auditLogs = auditRes.data || [];
  state.archive = archiveRes.data || [];
  state.autogestione = {
    attiva: Boolean(autogestioneRes.data?.attiva),
    presenze: presenzeRes.data || [],
    available: ![autogestioneRes.error, presenzeRes.error].some((error) => error && /autogestione_/i.test(error.message || '')),
  };
  if (!state.archiveDate && state.archive.length) state.archiveDate = state.archive[0].snapshot_date;
  state.selectedStudentId = state.account?.studente_id || '';
  state.profile = state.students.find((s) => s.id === state.selectedStudentId) || null;
  state.loading = false;
  programmaPromemoriaAutogestione();
  state.error = [studentsRes.error, leaderboardRes.error, votesRes.error, bonusRes.error, accountRes.error, auditRes.error, archiveRes.error, autogestioneRes.error, presenzeRes.error]
    .filter((error) => error && !error.message?.includes('account_profiles') && !/autogestione_/i.test(error.message || ''))
    .map((e) => e.message).join(' • ');
  setStatus(state.error ? 'Errore di sincronizzazione' : realtimeConnected ? 'Live' : 'Connessione in corso...');
  render();
}

async function loadAccountProfile() {
  const fullResult = await supabase.from('account_profiles').select('id, user_id, studente_id, display_name, is_premium, settings').eq('user_id', state.session.user.id).maybeSingle();
  if (!fullResult.error || !fullResult.error.message?.includes('settings')) return fullResult;
  return supabase.from('account_profiles').select('id, user_id, studente_id, display_name, is_premium').eq('user_id', state.session.user.id).maybeSingle();
}

let realtimeChannel = null;
let realtimeRetryTimer = null;
let realtimeRetryDelay = 1000;
let realtimeConnected = false;
let realtimeRefreshTimer = null;

function scheduleRealtimeRefresh() {
  if (realtimeRefreshTimer) return;
  realtimeRefreshTimer = setTimeout(() => {
    realtimeRefreshTimer = null;
    loadData();
  }, 300);
}

function subscribeRealtime() {
  if (realtimeChannel) return;
  const channel = supabase
    .channel('fantascuola-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'studenti' }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'voti' }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bonus_malus' }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'autogestione_impostazioni' }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'autogestione_presenze' }, scheduleRealtimeRefresh);
  realtimeChannel = channel;
  channel.subscribe((status) => {
    if (realtimeChannel !== channel) return;
    if (status === 'SUBSCRIBED') {
      realtimeConnected = true;
      realtimeRetryDelay = 1000;
      setStatus('Live');
      return;
    }
    if (!['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) return;
    realtimeConnected = false;
    setStatus('Riconnessione in corso...');
    if (realtimeRetryTimer) return;
    const delay = realtimeRetryDelay;
    realtimeRetryDelay = Math.min(realtimeRetryDelay * 2, 30000);
    realtimeRetryTimer = setTimeout(async () => {
      realtimeRetryTimer = null;
      if (realtimeChannel !== channel) return;
      realtimeChannel = null;
      try { await supabase.removeChannel(channel); }
      catch (error) { console.warn('[FantaScuola] Chiusura canale realtime:', error); }
      subscribeRealtime();
    }, delay);
  });
}

function nav() {
  const primaryTabs = [
    ['classifica', 'trophy', 'Classifica'],
    ['registro', 'journal', 'Registro'],
    ['player', 'user', 'Player'],
  ];
  const moreTabs = [
    ['opzioni', 'settings', 'Opzioni'],
    ['admin', 'tool', 'Gestione'],
    ['regolamento', 'book', 'Regolamento'],
    ['archivio', 'archive', 'Archivio'],
  ];
  const isDesktop = window.matchMedia('(min-width: 840px)').matches;
  const visibleTabs = isDesktop ? [...primaryTabs, ...moreTabs] : primaryTabs;
  const renderTab = ([id, ico, label], extraClass = '') => {
    const locked = (!isLoggedIn() && ['registro', 'player', 'opzioni'].includes(id)) || (id === 'admin' && !isPremium());
    return `
    <button class="tab ${extraClass} ${state.activeTab === id ? 'active' : ''} ${locked ? 'locked' : ''}" data-tab="${id}" aria-label="${label}${locked ? ' - accesso riservato' : ''}">
      <span class="tab-icon" aria-hidden="true">${icon(ico)}</span><span class="tab-label">${label}</span>
      ${locked ? '<span class="tab-lock" aria-hidden="true">LOCK</span>' : ''}
    </button>`;
  };
  const moreToggle = !isDesktop ? `<button class="tab more-tab ${moreTabs.some(([id]) => state.activeTab === id) ? 'active' : ''}" id="moreTabsBtn" type="button" aria-expanded="false" aria-controls="moreTabsMenu"><span class="tab-icon" aria-hidden="true">${icon('more')}</span><span class="tab-label">Altro</span></button>` : '';
  const moreMenu = !isDesktop ? `<div class="more-menu" id="moreTabsMenu" hidden>${moreTabs.map((tab) => renderTab(tab, 'more-menu-item')).join('')}</div>` : '';
  return `<nav class="tabs"><div class="tabs-inner">${visibleTabs.map((tab) => renderTab(tab)).join('')}${moreToggle}</div>${moreMenu}</nav>`;
}

function icon(name) {
  const materialIcons = { trophy: 'emoji_events', journal: 'menu_book', user: 'person', settings: 'settings', tool: 'construction', book: 'gavel', archive: 'inventory_2', more: 'more_horiz' };
  return `<span class="material-symbols-rounded tab-material-icon" aria-hidden="true">${materialIcons[name] || 'circle'}</span>`;
  /*
  const paths = {
    trophy: '<path d="M8 3h8v3a4 4 0 0 1-3 3.87V12h3v2H8v-2h3V9.87A4 4 0 0 1 8 6V3Z"/><path d="M8 5H5v1a3 3 0 0 0 3 3M16 5h3v1a3 3 0 0 1-3 3M9 17h6M10 20h4"/>',
    journal: '<path d="M6 4h11a1 1 0 0 1 1 1v14H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 4v15M10 8h5M10 12h5"/>',
    user: '<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19 12 2-1-2-3-2 1a7 7 0 0 0-1-1l.3-2.2h-3.5L12 8a7 7 0 0 0-1 0L9.7 5.8H6.2L6.5 8a7 7 0 0 0-1 1l-2-1-2 3 2 1v1l-2 1 2 3 2-1a7 7 0 0 0 1 1l-.3 2.2h3.5L11 16a7 7 0 0 0 1 0l1.3 2.2h3.5L16.5 16a7 7 0 0 0 1-1l2 1 2-3-2-1a7 7 0 0 0 0-1Z"/>',
    tool: '<path d="m14 6 4-4 2 2-4 4M13 7 4 16a2 2 0 0 0 3 3l9-9M5 21l-2-2M16 13l5 5-3 3-5-5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 5.5v15M8 7h8M8 11h8M8 15h5"/>',
    archive: '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
  */
}

function renderLogin() {
  const hasStudents = state.students.length > 0;
  const loginMode = state.authMode === 'login';
  app.innerHTML = `
    <section class="card hero">
      <div class="section-title"><h2>Accedi a Fantascuola</h2><span class="tiny">Classifica pubblica disponibile</span></div>
      <p>${hasStudents ? 'Crea il tuo account, scegli un player libero e sblocca le statistiche personali.' : 'La classifica è pronta. Il primo player verrà aggiunto da Gestione.'}</p>
      <div class="auth-switcher" role="tablist">
        <button class="switch ${loginMode ? 'active' : ''}" data-auth-mode="login">Accedi</button>
        <button class="switch ${!loginMode ? 'active' : ''}" data-auth-mode="signup">Registrati</button>
      </div>
      <form id="authForm" class="grid">
        ${!loginMode ? '<div class="field"><label for="displayName">Nome account</label><input id="displayName" name="display_name" required placeholder="Es. Antonino"></div>' : ''}
        <div class="field">
          <label for="authEmail">${loginMode ? 'Email o nome utente' : 'Email'}</label>
          <input id="authEmail" name="email" type="${loginMode ? 'text' : 'email'}" required autocomplete="${loginMode ? 'username' : 'email'}" placeholder="${loginMode ? 'nomeutente oppure email@dominio.it' : 'email@dominio.it'}">
        </div>
        <div class="field"><label for="authPassword">Password</label><input id="authPassword" name="password" type="password" minlength="6" required autocomplete="${loginMode ? 'current-password' : 'new-password'}"></div>
        <button class="btn" type="submit">${loginMode ? 'Accedi' : 'Crea account'}</button>
      </form>
      ${loginMode ? '<p class="tiny" style="margin-top:10px;">Gli account creati dal manager con solo nome utente possono accedere senza email.</p>' : ''}
    </section>
    ${renderGuestLeaderboard()}
  `;
}

function renderGuestLeaderboard() {
  return `<section class="card pad guest-preview">
    <div class="section-title"><h2>Classifica generale</h2><span class="tiny">Guest view</span></div>
    ${state.leaderboard.length ? `<div class="list">${state.leaderboard.slice(0, 5).map((s, i) => `
      <div class="row leaderboard-row"><div class="row-main"><div class="rank">${i + 1}</div>${avatarMarkup(s.nome, s.avatar_url)}<div class="row-copy"><div class="row-name">${esc(s.nome)}</div><div class="meta">Punti totali</div></div></div><div class="row-score">${Number(s.punti_totali || 0).toFixed(1)}</div></div>`).join('')}</div>` : '<div class="empty">Nessuno studente ancora in classifica</div>'}
  </section>`;
}

function renderAnonymousSection() {
  const copy = {
    classifica: `<section class="card pad"><div class="empty">Seleziona un profilo per vedere la classifica completa.</div></section>`,
    registro: `<section class="card pad"><div class="empty">Accedi con un profilo per vedere il registro eventi.</div></section>`,
    player: `<section class="card pad"><div class="empty">Seleziona un profilo per vedere il tuo player.</div></section>`,
    opzioni: `<section class="card pad"><div class="empty">Le opzioni saranno disponibili dopo l'accesso.</div></section>`,
    admin: renderAdminClean(),
  };
  return copy[state.activeTab] || copy.classifica;
}

function renderAccount() {
  const sessionUser = state.session?.user;
  const username = normalizeUsername(sessionUser?.user_metadata?.username || '');
  const email = sessionUser?.user_metadata?.login_type === 'username' || isInternalUsernameEmail(sessionUser?.email)
    ? `@${username || String(sessionUser?.email || '').split('@')[0]}`
    : (sessionUser?.email || 'Account autenticato');
  const accountSettings = { notifications: true, publicProfile: true, ...state.account?.settings };
  const displayName = state.account?.display_name || 'Giocatore';
  const profileImage = state.profile?.avatar_url || avatarFallback(state.profile?.nome || displayName);
  return `<section class="account-modern-modal ${document.documentElement.dataset.theme === 'new-ui-dark' ? 'account-modern-dark' : ''}">
    <header class="account-modern-header"><button class="account-modal-close" id="accountCancelBtn" type="button">Annulla</button><h2>Impostazioni account</h2><button class="account-modal-done" id="accountDoneBtn" type="button">Fatto</button></header>
    <div class="account-modern-content">
      <section class="account-profile-hero"><div class="account-profile-topline"><span class="account-hero-label">Account attivo</span><span class="account-hero-id">FANTASCUOLA PLAYER</span></div><div class="account-profile-main"><div class="account-profile-avatar"><img src="${esc(profileImage)}" alt="Foto di ${esc(state.profile?.nome || displayName)}" onerror="this.onerror=null;this.src='${avatarFallback(state.profile?.nome || displayName)}'"></div><div class="account-profile-copy"><h3>${esc(displayName)}</h3><div>${esc(email)}</div></div></div></section>
      <section class="account-section-card"><div class="account-section-header"><div><h3>Profilo online</h3><p>Gestisci come appari agli altri giocatori e le notifiche del tuo account.</p></div><span class="account-section-icon">◎</span></div><div class="account-settings-list">
        <label class="account-input"><span><strong>Nome visualizzato</strong><small>È il nome mostrato nel tuo profilo</small></span><input id="accountDisplayName" value="${esc(state.account?.display_name || '')}" placeholder="Il tuo nome"></label>
        <label class="setting-row"><span><strong>Notifiche attività</strong><small>Avvisi sulle modifiche della classifica</small></span><input class="toggle" id="accountNotifications" type="checkbox" ${accountSettings.notifications ? 'checked' : ''}></label>
        <label class="setting-row"><span><strong>Profilo visibile</strong><small>Consenti di mostrare il tuo nome nella community</small></span><input class="toggle" id="accountPublicProfile" type="checkbox" ${accountSettings.publicProfile ? 'checked' : ''}></label>
      </div><div class="account-save-area"><button class="btn account-modern-save" id="saveAccountBtn" type="button">${state.accountSaving ? 'Salvataggio...' : 'Salva modifiche'}</button></div></section>
      <section class="account-grid"><div class="account-stat"><span>Tipo account</span><strong>${isPremium() ? 'Premium' : 'Giocatore'}</strong></div><div class="account-stat"><span>Player</span><strong>${esc(state.profile?.nome || 'Da scegliere')}</strong></div></section>
      <section class="account-danger-card"><div><strong>Sessione account</strong><span>Esci da Fantascuola su questo dispositivo.</span></div><button class="btn danger account-modern-logout" id="accountLogoutBtn" type="button">Logout</button></section>
    </div>
  </section>`;
}

function renderAccountSetup() {
  const studentOptions = state.students.map((s) => `<option value="${s.id}">${esc(s.nome)}</option>`).join('');
  return `<section class="card pad setup-card">
    <div class="section-title"><h2>Scegli il tuo player</h2><span class="tiny">Una scelta per account</span></div>
    <p class="muted-copy">Associa un player al tuo account per usare Registro e Player.</p>
    <form id="playerSetupForm" class="grid">
      <div class="field"><label for="playerSelect">Player disponibile</label><select id="playerSelect" name="studente_id" required><option value="">Seleziona un player</option>${studentOptions}</select></div>
      <button class="btn" type="submit" ${studentOptions ? '' : 'disabled'}>Conferma player</button>
    </form>
  </section>`;
}

function renderClassifica() {
  const ranked = [...state.leaderboard].sort((a, b) => Number(b.punti_totali || 0) - Number(a.punti_totali || 0) || String(a.nome).localeCompare(String(b.nome)));
  const leader = ranked[0];
  const runnerUp = ranked[1];
  const gap = leader && runnerUp ? Number(leader.punti_totali || 0) - Number(runnerUp.punti_totali || 0) : null;
  const podiumLabel = (rank) => rank === 1 ? 'Campione' : rank === 2 ? 'Secondo' : 'Terzo';
  const podium = ranked.length >= 3 ? `<section class="classifica-podium" aria-label="Podio">${ranked.slice(0, 3).map((student, index) => {
    const rank = index + 1;
    const podiumClass = rank === 1 ? 'first' : rank === 2 ? 'second' : 'third';
    const distance = rank === 1 ? 'In testa alla classifica' : `${(Number(leader.punti_totali || 0) - Number(student.punti_totali || 0)).toFixed(1)} pt dalla vetta`;
    return `<article class="classifica-podium-card ${podiumClass}"><span class="classifica-podium-rank">${rank}</span><span class="classifica-podium-label">${podiumLabel(rank)}</span><div class="classifica-podium-avatar">${avatarMarkup(student.nome, student.avatar_url)}</div><div class="classifica-podium-name">${esc(student.nome)}</div><div class="classifica-podium-score"><strong>${Number(student.punti_totali || 0).toFixed(1)}</strong><span>pt</span></div><div class="classifica-podium-gap">${distance}</div></article>`;
  }).join('')}</section>` : '';
  return `<section class="card classifica-page">
    <a class="free-roam-launch-banner" href="Free-Roam/index.html" aria-label="Accedi a FantaScuola Free Roam">
      <span class="free-roam-launch-glow" aria-hidden="true"></span>
      <span class="free-roam-launch-copy">
        <span class="free-roam-launch-kicker">NUOVA MODALITÀ</span>
        <strong>Free Roam è Qui!</strong>
        <span>Accedi ora al mondo 3D di FantaScuola.</span>
      </span>
      <span class="free-roam-launch-button">
        ENTRA ORA
        <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
      </span>
    </a>
    <header class="classifica-header"><div><div class="classifica-eyebrow">Classifica live</div><h2>Classifica</h2><p>Segui l'andamento della classe e scopri chi sta conquistando la vetta.</p></div><span class="classifica-live"><i></i>LIVE</span></header>
    <section class="classifica-summary"><div><span>Giocatori</span><strong>${ranked.length}</strong></div><div><span>Leader</span><strong>${esc(leader?.nome || '—')}</strong></div><div><span>Vantaggio</span><strong>${gap === null ? '—' : `+${gap.toFixed(1)} pt`}</strong></div></section>
    <div class="classifica-controls"><label class="classifica-search"><span aria-hidden="true">⌕</span><input id="classificaSearch" type="search" autocomplete="off" placeholder="Cerca un giocatore..." aria-label="Cerca un giocatore"></label><select id="classificaSort" aria-label="Ordina classifica"><option value="points">Più punti</option><option value="name">Nome A-Z</option></select></div>
    ${podium}
    <section class="classifica-ranking"><div class="classifica-section-heading"><div><h3>Classifica completa</h3><p>Posizioni calcolate in base ai punti totali.</p></div><span id="classificaCount">${ranked.length} ${ranked.length === 1 ? 'giocatore' : 'giocatori'}</span></div><div id="classificaRows" class="classifica-rows">${renderClassificaRows(ranked, ranked)}</div></section>
    ${state.viewingPlayerId ? renderPublicPlayerModal() : ''}
  </section>`;
}

function renderClassificaRows(items, ranked) {
  if (!items.length) return '<div class="empty">Nessun giocatore trovato</div>';
  const leader = ranked[0];
  return items.map((student) => {
    const rank = ranked.findIndex((item) => item.id === student.id || item.nome === student.nome) + 1;
    const points = Number(student.punti_totali || 0);
    const tag = rank === 1 ? 'Leader' : rank <= 3 ? 'Top 3' : '';
    const meta = rank === 1 ? 'Leader della classifica' : `${(Number(leader?.punti_totali || 0) - points).toFixed(1)} pt dalla vetta`;
    const studentId = student.id || student.studente_id || '';
    return `<article class="classifica-row" data-rank="${rank}"><div class="classifica-rank-number">${rank}</div><div class="classifica-row-main">${avatarMarkup(student.nome, student.avatar_url)}<div class="classifica-row-copy"><div class="classifica-name-line"><strong>${esc(student.nome)}</strong>${tag ? `<span>${tag}</span>` : ''}</div><small>Posizione ${rank} · ${meta}</small></div></div><div class="classifica-score"><strong>${points.toFixed(1)}</strong><span>punti</span><button class="classifica-view-player" type="button" data-view-player="${esc(studentId)}">Statistiche</button></div></article>`;
  }).join('');
}

function renderPublicPlayerModal() {
  const student = state.students.find((item) => item.id === state.viewingPlayerId) || state.leaderboard.find((item) => item.id === state.viewingPlayerId || item.studente_id === state.viewingPlayerId);
  if (!student) return '';
  const studentId = student.id || student.studente_id;
  const events = state.events.filter((event) => event.studente_id === studentId);
  const votes = events.filter((event) => event.kind === 'voto');
  const bonuses = events.filter((event) => event.kind === 'bonus');
  const days = {};
  events.forEach((event) => {
    const points = Number(event.kind === 'voto' ? event.voto : event.punti);
    const day = dateKey(event.created_at);
    days[day] ||= { total: 0, gain: 0, loss: 0 };
    days[day].total += points;
    if (points >= 0) days[day].gain += points;
    else days[day].loss += points;
  });
  const dayStats = Object.entries(days).map(([day, values]) => ({ day, ...values }));
  const bestDay = dayStats.filter((day) => day.gain > 0).sort((a, b) => b.gain - a.gain)[0];
  const worstDay = dayStats.filter((day) => day.loss < 0).sort((a, b) => a.loss - b.loss)[0];
  const average = votes.length ? votes.reduce((sum, vote) => sum + Number(vote.voto), 0) / votes.length : 0;
  const totalBonus = bonuses.reduce((sum, bonus) => sum + Number(bonus.punti), 0);
  const history = events.slice(0, 8).map((event) => `<div class="public-player-history-row"><div><strong>${esc(event.kind === 'voto' ? `Voto ${event.voto}` : event.motivo)}</strong><small>${fmt.format(new Date(event.created_at))}</small></div><b>${event.kind === 'voto' ? `+${Number(event.voto).toFixed(1)}` : pointsLabel(event.punti)} pt</b></div>`).join('');
  const imageUrl = student.banner_url || student.avatar_url || avatarFallback(student.nome);
    return `<div class="public-player-backdrop ${state.activeTab === 'public-player' ? 'public-player-page-view' : ''}"><section class="public-player-modal" role="region" aria-labelledby="publicPlayerTitle"><button class="public-player-close" id="closePublicPlayerBtn" type="button" aria-label="Esci dalle statistiche">Esci</button><header class="public-player-hero" style="--player-image:url('${esc(imageUrl)}');--player-position:${esc(student.banner_position || '50% 50%')}"><div><span>Profilo giocatore</span><h2 id="publicPlayerTitle">${esc(student.nome)}</h2><small><i></i>Statistiche pubbliche</small></div></header><div class="public-player-content"><div class="public-player-stats"><div><span>Media voti</span><strong>${average ? average.toFixed(2) : '—'}</strong><small>su ${votes.length} voti</small></div><div><span>Voti ricevuti</span><strong>${votes.length}</strong><small>registrati</small></div><div><span>Bonus / Malus</span><strong>${totalBonus.toFixed(1)}</strong><small>punti extra</small></div></div><section><div class="public-player-heading"><div><h3>Statistiche avanzate</h3><p>Andamento complessivo del giocatore.</p></div><span>${dayStats.length} giornate</span></div><div class="public-player-advanced"><div><span>Media punti giornaliera</span><strong>${dayStats.length ? (dayStats.reduce((sum, day) => sum + day.total, 0) / dayStats.length).toFixed(1) : '—'}</strong></div><div><span>Giorno più proficuo</span><strong>${bestDay ? `+${bestDay.gain.toFixed(1)} pt` : '—'}</strong></div><div><span>Giorno con più perdite</span><strong>${worstDay ? `${worstDay.loss.toFixed(1)} pt` : '—'}</strong></div><div><span>Assenze / Ritardi</span><strong>${bonuses.filter((bonus) => /assenza/i.test(bonus.motivo)).length} / ${bonuses.filter((bonus) => /ritard/i.test(bonus.motivo)).length}</strong></div></div></section><section><div class="public-player-heading"><div><h3>Storico personale</h3><p>Le ultime attività registrate.</p></div></div><div class="public-player-history">${history || '<div class="empty">Nessuna attività registrata</div>'}</div></section></div></section></div>`;
}

function renderArchivio() {
  const dates = [...new Set(state.archive.map((row) => row.snapshot_date))];
  const selectedDate = dates.includes(state.archiveDate) ? state.archiveDate : dates[0];
  const rows = state.archive.filter((row) => row.snapshot_date === selectedDate).sort((a, b) => a.rank - b.rank);
  return `<section class="card pad archive-panel">
    <div class="section-title"><h2>Archivio classifiche</h2><span class="tiny">Una fotografia per ogni giorno</span></div>
    <p class="muted-copy">La classifica viene salvata ogni giorno e resta consultabile per ripercorrere l'andamento della stagione.</p>
    ${dates.length ? `<label class="archive-date"><span>Giornata da rivedere</span><select id="archiveDateSelect">${dates.map((date) => `<option value="${date}" ${date === selectedDate ? 'selected' : ''}>${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(new Date(`${date}T12:00:00`))}</option>`).join('')}</select></label><div class="list">${rows.map((row) => `<div class="row leaderboard-row"><div class="row-main"><div class="rank">${row.rank}</div>${avatarMarkup(row.nome, row.avatar_url)}<div class="row-copy"><div class="row-name">${esc(row.nome)}</div><div class="meta">Classifica del ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(`${row.snapshot_date}T12:00:00`))}</div></div></div><div class="row-score">${Number(row.punti_totali || 0).toFixed(1)}</div></div>`).join('')}</div>` : '<div class="empty">Il primo snapshot sarà salvato oggi.</div>'}
  </section>`;
}

function renderRegistro() {
  const filters = state.auditFilter;
  const actors = [...new Set(state.auditLogs.map((log) => log.actor_email).filter(Boolean))];
  const filteredLogs = state.auditLogs.filter((log) => {
    const points = Number(log.points_delta);
    return (!filters.actor || log.actor_email === filters.actor)
      && (!filters.action || log.action === filters.action)
      && (!filters.direction || (filters.direction === 'positive' && points > 0) || (filters.direction === 'negative' && points < 0))
      && (!filters.date || dateKey(log.created_at) === filters.date);
  });
  return `
    <section class="card pad">
      <div class="section-title"><h2>Registro modifiche</h2><span class="tiny">Audit live · ${state.auditLogs.length} operazioni</span></div>
      <div class="audit-filters">
        <label><span>Admin</span><select id="auditActorFilter"><option value="">Tutti gli admin</option>${actors.map((actor) => `<option value="${esc(actor)}" ${filters.actor === actor ? 'selected' : ''}>${esc(actor)}</option>`).join('')}</select></label>
        <label><span>Azione</span><select id="auditActionFilter"><option value="">Tutte le azioni</option><option value="create" ${filters.action === 'create' ? 'selected' : ''}>Aggiunte</option><option value="delete" ${filters.action === 'delete' ? 'selected' : ''}>Eliminazioni</option><option value="reset" ${filters.action === 'reset' ? 'selected' : ''}>Reset stagione</option></select></label>
        <label><span>Punti</span><select id="auditDirectionFilter"><option value="" ${!filters.direction ? 'selected' : ''}>Tutti</option><option value="positive" ${filters.direction === 'positive' ? 'selected' : ''}>Punti messi</option><option value="negative" ${filters.direction === 'negative' ? 'selected' : ''}>Punti tolti</option></select></label>
        <label><span>Quando</span><input id="auditDateFilter" type="date" value="${esc(filters.date)}"></label>
      </div>
      ${filteredLogs.length ? `<div class="list">${filteredLogs.map((log) => `
        <div class="row audit-row">
          <div class="audit-mark ${Number(log.points_delta) < 0 ? 'negative' : ''}">${log.action === 'reset' ? '↺' : log.action === 'delete' ? '−' : '+'}</div>
          <div class="row-copy audit-copy"><div class="row-name">${esc(log.details)}</div><div class="meta">${esc(log.actor_email)} · ${fmt.format(new Date(log.created_at))}</div></div>
          <div class="audit-points ${Number(log.points_delta) < 0 ? 'negative' : ''}">${log.points_delta === null || log.points_delta === undefined ? '—' : `${pointsLabel(log.points_delta)} pt`}</div>
        </div>`).join('')}</div>` : `<div class="empty">Nessuna modifica corrisponde ai filtri</div>`}
    </section>`;
}

function renderPlayer() {
  const viewedProfile = state.viewingPlayerId ? state.students.find((student) => student.id === state.viewingPlayerId) : null;
  const profile = viewedProfile || state.profile;
  const viewingOtherPlayer = Boolean(viewedProfile && viewedProfile.id !== state.profile?.id);
  if (!profile) return `<section class="card pad"><div class="empty">Seleziona un profilo per vedere il tuo player.</div></section>`;
  const personalVotes = state.events.filter((e) => e.studente_id === profile.id && e.kind === 'voto');
  const personalBonuses = state.events.filter((e) => e.studente_id === profile.id && e.kind === 'bonus');
  const avg = personalVotes.length ? personalVotes.reduce((sum, item) => sum + Number(item.voto), 0) / personalVotes.length : 0;
  const personalDays = {};
  [...personalVotes.map((item) => ({ ...item, points: Number(item.voto) })), ...personalBonuses.map((item) => ({ ...item, points: Number(item.punti) }))].forEach((item) => {
    const day = dateKey(item.created_at);
    personalDays[day] ||= { total: 0, gain: 0, loss: 0 };
    personalDays[day].total += item.points;
    if (item.points >= 0) personalDays[day].gain += item.points;
    else personalDays[day].loss += item.points;
  });
  const dayStats = Object.entries(personalDays).map(([day, values]) => ({ day, ...values }));
  const bestDay = dayStats.filter((item) => item.gain > 0).sort((a, b) => b.gain - a.gain)[0];
  const worstDay = dayStats.filter((item) => item.loss < 0).sort((a, b) => a.loss - b.loss)[0];
  const totalPoints = dayStats.reduce((sum, item) => sum + item.total, 0);
  const absences = personalBonuses.filter((item) => /assenza/i.test(item.motivo)).length;
  const delays = personalBonuses.filter((item) => /ritard/i.test(item.motivo)).length;
  const dayText = (day) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(`${day}T12:00:00`));
  const oggi = italyNow();
  const domenica = isAutogestioneSunday(oggi.day);
  const presenzaOggi = state.autogestione.presenze.find((presenza) => presenza.giorno === oggi.day && presenza.studente_id === profile.id);
  const entroLeDue = oggi.hour < 14;
  const promemoriaAttivi = localStorage.getItem('fantascuola_autogestione_promemoria') === 'true';
  const autogestioneCard = state.autogestione.attiva && !viewingOtherPlayer ? `
      <div class="autogestione-card">
        <div class="section-title"><div><h2 style="font-size:16px;">Autogestione</h2><p class="tiny">${domenica ? 'La domenica non si registra la presenza.' : 'Registra la presenza entro le 14:00, anche il sabato.'}</p></div><span class="autogestione-deadline ${entroLeDue && !domenica ? '' : 'expired'}">${domenica ? 'DOMENICA' : entroLeDue ? 'ENTRO LE 14' : 'SCADUTO'}</span></div>
        ${presenzaOggi ? `<div class="autogestione-confirmed"><strong>${presenzaOggi.stato === 'presente' ? 'Presenza registrata' : presenzaOggi.stato === 'assente' ? 'Assenza registrata' : 'Presenza da verificare'}</strong><span>${pointsLabel(presenzaOggi.punti)} pt · ${presenzaOggi.fonte === 'player' ? 'segnata da te' : 'segnata dal manager'}</span></div>` : domenica ? '' : `<div class="autogestione-actions"><button class="btn" data-autogestione-stato="presente" type="button" ${entroLeDue ? '' : 'disabled'}>Sono presente</button><button class="btn secondary" data-autogestione-stato="assente" type="button" ${entroLeDue ? '' : 'disabled'}>Sono assente · −1 pt</button></div>`}
        <div class="autogestione-reminder"><span>Promemoria browser alle 13:45</span><button class="btn secondary row-action" id="autogestioneReminderBtn" type="button">${promemoriaAttivi ? 'Attivo' : 'Attiva'}</button></div>
        <p class="tiny">Presente: +1 pt, +2 dal 7° giorno consecutivo e +3 dal 30°. Se dimentichi, il manager registrerà la presenza senza bonus; un’assenza inserita dal manager vale −3 pt.</p>
      </div>` : '';
  const imageUrl = profile.banner_url || profile.avatar_url || avatarFallback(profile.nome);
  const bannerPosition = profile.banner_position || '50% 50%';
  const historyItems = [
    ...personalVotes.map((v) => ({ title: `Voto ${v.voto}`, sub: fmt.format(new Date(v.created_at)), points: `+${Number(v.voto).toFixed(1)} pt` })),
    ...personalBonuses.map((b) => ({ title: b.motivo, sub: fmt.format(new Date(b.created_at)), points: `${pointsLabel(b.punti)} pt` })),
  ];
  const historyMarkup = historyItems.length
    ? `<div class="history-list">${historyItems.slice(0, 8).map((item) => `<div class="history-row"><div><div class="history-title">${esc(item.title)}</div><div class="history-date">${esc(item.sub)}</div></div><div class="history-points">${esc(item.points)}</div></div>`).join('')}</div>`
    : '<div class="empty">Nessuna azione ancora registrata</div>';
  return `
    <section class="card player-card player-redesign">
      ${viewingOtherPlayer ? '<button class="player-back-classifica" id="backToClassificaBtn" type="button"><span class="material-symbols-rounded" aria-hidden="true">arrow_back</span> Classifica</button>' : ''}
      <header class="player-hero player-modern-hero" style="--player-image: url('${esc(imageUrl)}'); --player-position: ${esc(bannerPosition)}">
        <div class="hero-vignette"></div><span class="player-card-live-badge"><span class="player-live-dot"></span>Player Card Live</span>
        <div class="player-identity"><div class="eyebrow">${viewingOtherPlayer ? 'Profilo giocatore' : 'Squadra personale'}</div><h2 class="player-name">${esc(profile.nome)}</h2></div>
      </header>
      <div class="player-content">
        <div class="stat-grid" aria-label="Statistiche principali">
          <div class="stat stat-primary"><span class="stat-label">Media voti</span><strong class="stat-value">${avg ? avg.toFixed(2) : '—'}</strong><small class="stat-detail">su ${personalVotes.length} voti</small></div>
          <div class="stat"><span class="stat-label">Voti ricevuti</span><strong class="stat-value">${personalVotes.length}</strong><small class="stat-detail">registrati</small></div>
          <div class="stat"><span class="stat-label">Bonus / Malus</span><strong class="stat-value">${personalBonuses.reduce((sum, item) => sum + Number(item.punti), 0).toFixed(1)}</strong><small class="stat-detail">punti extra</small></div>
        </div>
        ${autogestioneCard}
        <section class="player-section advanced-stats">
          <div class="section-heading"><div><h2>Statistiche avanzate</h2><p class="section-description">Una lettura rapida del tuo andamento.</p></div><span class="section-counter">${dayStats.length} giornate</span></div>
          <div class="advanced-grid"><div class="advanced-stat"><span class="advanced-stat-label">Media punti giornaliera</span><strong class="advanced-stat-value">${dayStats.length ? (totalPoints / dayStats.length).toFixed(1) : '—'}</strong></div><div class="advanced-stat"><span class="advanced-stat-label">Giorno più proficuo</span><strong class="advanced-stat-value">${bestDay ? `+${bestDay.gain.toFixed(1)} pt` : '—'}</strong><small class="advanced-stat-detail">${bestDay ? dayText(bestDay.day) : 'Nessun dato'}</small></div><div class="advanced-stat"><span class="advanced-stat-label">Giorno con più perdite</span><strong class="advanced-stat-value">${worstDay ? `${worstDay.loss.toFixed(1)} pt` : '—'}</strong><small class="advanced-stat-detail">${worstDay ? dayText(worstDay.day) : 'Nessun dato'}</small></div><div class="advanced-stat"><span class="advanced-stat-label">Assenze / Ritardi</span><strong class="advanced-stat-value">${absences} / ${delays}</strong><small class="advanced-stat-detail">Eventi individuali</small></div></div>
        </section>
        <section class="player-section player-history"><div class="section-heading"><div><h2>Storico personale</h2><p class="section-description">Le tue ultime attività.</p></div></div>${historyMarkup}</section>
      </div>
    </section>`;
}

function renderOpzioni() {
  const showLegacyDockToggle = window.matchMedia('(max-width: 839px)').matches && ['new-ui', 'new-ui-dark'].includes(preferences.theme);
  return `<section class="card pad options-panel">
    <div class="section-title"><h2>Opzioni</h2><span class="tiny">Preferenze di questo dispositivo</span></div>
    <div class="settings-group theme-settings">
      <div class="settings-heading"><div><h3>Temi</h3><p>Scegli l'aspetto dell'interfaccia.</p></div></div>
      <div class="theme-options" role="radiogroup" aria-label="Tema dell'interfaccia">
        <label class="theme-option ${preferences.theme === 'new-ui' ? 'selected' : ''}"><input type="radio" name="theme" value="new-ui" ${preferences.theme === 'new-ui' ? 'checked' : ''}><span><strong>Nuova UI</strong><small>Interfaccia chiara e moderna</small></span></label>
        <label class="theme-option ${preferences.theme === 'new-ui-dark' ? 'selected' : ''}"><input type="radio" name="theme" value="new-ui-dark" ${preferences.theme === 'new-ui-dark' ? 'checked' : ''}><span><strong>Nuova UI Dark</strong><small>Interfaccia scura ad alto contrasto</small></span></label>
        <label class="theme-option ${preferences.theme === 'new-ui-red' ? 'selected' : ''}"><input type="radio" name="theme" value="new-ui-red" ${preferences.theme === 'new-ui-red' ? 'checked' : ''}><span><strong>Legacy Red</strong><small>Interfaccia rossa e vivace</small></span></label>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-heading"><div><h3>Aspetto</h3><p>Personalizza l'esperienza di Fantascuola.</p></div></div>
      ${showLegacyDockToggle ? '<label class="setting-row"><span><strong>Dock Legacy</strong><small>Tab bar in basso a dock quadrato e attaccata al bordo</small></span><input class="toggle" id="dockLegacyToggle" type="checkbox" ' + (preferences.dockLegacy ? 'checked' : '') + '></label>' : ''}
      <label class="setting-row"><span><strong>Testo in grassetto</strong><small>Rende più leggibili titoli e contenuti</small></span><input class="toggle" id="boldTextToggle" type="checkbox" ${preferences.boldText ? 'checked' : ''}></label>
      <label class="setting-row"><span><strong>Interfaccia compatta</strong><small>Riduce spazi e dimensioni delle schede</small></span><input class="toggle" id="compactToggle" type="checkbox" ${preferences.compact ? 'checked' : ''}></label>
      <label class="setting-row"><span><strong>Riduci animazioni</strong><small>Minimizza i movimenti dell'interfaccia</small></span><input class="toggle" id="motionToggle" type="checkbox" ${preferences.reduceMotion ? 'checked' : ''}></label>
    </div>
    <div class="settings-group">
      <div class="settings-heading"><div><h3>Vista</h3><p>Regola la lettura secondo le tue preferenze.</p></div></div>
      <label class="range-setting" for="textScale"><span><strong>Misura testo</strong><output id="textScaleValue">${preferences.textScale}%</output></span><input id="textScale" type="range" min="85" max="125" step="5" value="${preferences.textScale}"></label>
      <div class="color-settings">
        <label class="color-setting" for="accentColor"><span><strong>Colore principale</strong><small>Tasti, accenti e punti</small></span><input id="accentColor" type="color" value="${preferences.accent}"></label>
        <label class="color-setting" for="textColor"><span><strong>Colore testi</strong><small>Titoli e contenuti principali</small></span><input id="textColor" type="color" value="${preferences.textColor}"></label>
      </div>
    </div>
    <div class="settings-group customization-settings">
      <div class="settings-heading"><div><h3>Personalizzazione</h3><p>Regola proporzioni, spazi e profondità dell'interfaccia.</p></div></div>
      <label class="range-setting" for="elementScale"><span><strong>Grandezza elementi</strong><output id="elementScaleValue">${preferences.elementScale}%</output></span><input id="elementScale" type="range" min="85" max="115" step="5" value="${preferences.elementScale}"></label>
      <label class="range-setting" for="elementSpacing"><span><strong>Spaziatura elementi</strong><output id="elementSpacingValue">${preferences.elementSpacing}%</output></span><input id="elementSpacing" type="range" min="75" max="135" step="5" value="${preferences.elementSpacing}"></label>
      <label class="range-setting" for="glassOpacity"><span><strong>Trasparenza superfici</strong><output id="glassOpacityValue">${preferences.glassOpacity}%</output></span><input id="glassOpacity" type="range" min="45" max="100" step="5" value="${preferences.glassOpacity}"></label>
      <label class="range-setting" for="glassBlur"><span><strong>Intensità blur</strong><output id="glassBlurValue">${preferences.glassBlur}px</output></span><input id="glassBlur" type="range" min="0" max="30" step="1" value="${preferences.glassBlur}"></label>
      <label class="setting-row"><span><strong>Mostra bordi</strong><small>Attiva i contorni delle schede e dei controlli</small></span><input class="toggle" id="showBordersToggle" type="checkbox" ${preferences.showBorders ? 'checked' : ''}></label>
      <label class="setting-row"><span><strong>Mostra ombre</strong><small>Regola la profondità visiva delle superfici</small></span><input class="toggle" id="showShadowsToggle" type="checkbox" ${preferences.showShadows ? 'checked' : ''}></label>
    </div>
    <div class="settings-group settings-extra"><div class="settings-heading"><div><h3>Altro</h3><p>Impostazioni rapide dell'app.</p></div></div><div class="setting-notice">Le preferenze sono salvate automaticamente solo su questo dispositivo.</div><button class="btn secondary" id="resetPreferencesBtn" type="button">Ripristina preferenze</button></div>
    <div class="settings-group account-settings"><div class="section-title"><h3>Sessione</h3></div><button class="btn danger" id="logoutBtn" type="button">Logout</button></div>
  </section>`;
}

function renderRegolamento() {
  return `
    <section class="card pad regulation">
      <div class="section-title"><h2>Regolamento ufficiale</h2><span class="tiny">Fantascuola</span></div>
      <p class="regulation-intro">L'Aura della Classe: ogni studente accumula punti nella classifica generale durante tutto l'anno scolastico. Voti, bonus e malus vengono registrati dal Founder e aggiornano la classifica live.</p>
      <div class="regulation-grid">
        <article class="rule-block">
          <span class="rule-number">01</span><h3>Calcolo dei punti</h3>
          <p>Ogni voto vale esattamente il suo valore numerico e viene sommato al totale personale.</p>
          <div class="rule-list"><div><strong>10</strong><span>+10 pt</span></div><div><strong>9</strong><span>+9 pt</span></div><div><strong>8</strong><span>+8 pt</span></div><div><strong>7</strong><span>+7 pt</span></div><div><strong>6</strong><span>+6 pt</span></div><div><strong>5</strong><span>+5 pt</span></div><div><strong>4</strong><span>+4 pt</span></div></div>
        </article>
        <article class="rule-block">
          <span class="rule-number">02</span><h3>Malus e disciplina</h3>
          <p>I malus sono individuali: incidono soltanto sul punteggio dello studente a cui vengono assegnati.</p>
          <div class="rule-list"><div><strong>Ritardo</strong><span>-2 pt</span></div><div><strong>Assenza</strong><span>-3 pt</span></div><div><strong>Nota generica</strong><span>-4 pt</span></div><div><strong>Nota disciplinare / sospensione</strong><span>-6 pt</span></div></div>
        </article>
        <article class="rule-block">
          <span class="rule-number">03</span><h3>Autogestione presenze</h3>
          <p>Quando il manager attiva Autogestione, ogni player deve dichiarare entro le 14:00 se è presente o assente.</p>
          <div class="rule-list"><div><strong>Presenza dichiarata</strong><span>+1 pt</span></div><div><strong>Streak dal 7° giorno</strong><span>+2 pt</span></div><div><strong>Streak dal 30° giorno</strong><span>+3 pt</span></div><div><strong>Assenza dichiarata</strong><span>-1 pt</span></div><div><strong>Assenza dal manager</strong><span>-3 pt</span></div><div><strong>Presenza falsata</strong><span>-5 pt</span></div></div>
          <p class="rule-note">Se il player dimentica, il manager registra la presenza senza bonus. Una dichiarazione falsa può essere punita con la motivazione “Falsata la presenza”. La streak si interrompe se manca una dichiarazione valida.</p>
        </article>
        <article class="rule-block">
          <span class="rule-number">04</span><h3>Bonus speciali</h3>
          <p>I bonus vengono aggiunti individualmente dal Founder per premiare azioni o eventi speciali.</p>
          <div class="rule-list"><div><strong>Interrogazione volontaria</strong><span>+3 pt</span></div><div><strong>Salvataggio della classe</strong><span>+5 pt</span></div><div><strong>Bonus custom</strong><span>Variabile</span></div></div>
        </article>
        <article class="rule-block rule-total">
          <span class="rule-number">05</span><h3>Formula finale</h3>
          <p>Il punteggio totale viene aggiornato automaticamente ad ogni evento:</p>
          <div class="formula">Totale = somma dei voti + bonus + malus</div>
          <p class="rule-note">Le decisioni registrate sono definitive e il punteggio considera tutte le variazioni dall'inizio dell'anno.</p>
        </article>
      </div>
    </section>`;
}


function renderAccountCustomerService() {
  const panel = state.accountAdmin;
  if (!isPremium()) return '';
  const query = String(panel.search || '').trim().toLowerCase();
  const filteredUsers = (panel.users || []).filter((user) => {
    if (!query) return true;
    const haystack = [
      user.display_name,
      user.email,
      user.username,
      user.id,
      user.student_name,
      user.login_type,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });

  return `
    <div class="account-support">
      <button class="account-support-toggle" id="accountSupportToggle" type="button" aria-expanded="${panel.open ? 'true' : 'false'}">
        <span>
          <strong>Servizio Clienti Account</strong>
          <small>Gestisci accessi, recuperi, verifiche e account</small>
        </span>
        <span class="account-support-chevron">${panel.open ? '−' : '+'}</span>
      </button>

      ${panel.open ? `
        <div class="account-support-panel">
          <div class="account-support-toolbar">
            <label class="field account-support-search">
              <span class="field-label">Cerca account</span>
              <input id="accountSupportSearch" type="search" value="${esc(panel.search)}" placeholder="Nome, email, username o ID">
            </label>
            <button class="btn secondary" id="refreshManagedUsersBtn" type="button" ${panel.loading ? 'disabled' : ''}>${panel.loading ? 'Caricamento...' : 'Aggiorna'}</button>
          </div>

          ${panel.error ? `<div class="account-support-error">${esc(panel.error)}</div>` : ''}

          <div class="account-support-create">
            <div class="section-title"><h2 style="font-size:16px;">Crea nuovo account</h2><span class="tiny">Manager Plus</span></div>
            <form id="createManagedUserForm" class="grid">
              <div class="account-support-two-col">
                <label class="field">
                  <span class="field-label">Tipo accesso</span>
                  <select name="login_type" id="managedCreateLoginType">
                    <option value="email">Email + password</option>
                    <option value="username">Solo nome utente + password</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Nome visualizzato</span>
                  <input name="display_name" required placeholder="Es. Mario Rossi">
                </label>
              </div>

              <label class="field">
                <span class="field-label" id="managedIdentityLabel">Email</span>
                <input name="identity" id="managedIdentityInput" required placeholder="utente@example.com" autocomplete="off">
              </label>

              <label class="field">
                <span class="field-label">Password iniziale</span>
                <input name="password" type="password" minlength="6" required autocomplete="new-password" placeholder="Minimo 6 caratteri">
              </label>

              <div class="account-support-two-col">
                <label class="field">
                  <span class="field-label">Player collegato</span>
                  <select name="studente_id">
                    <option value="">Nessuno</option>
                    ${state.students.map((s) => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}
                  </select>
                </label>
                <label class="setting-row account-support-switch">
                  <span><strong>Account Plus</strong><small>Abilita Gestione</small></span>
                  <input class="toggle" name="is_premium" type="checkbox">
                </label>
              </div>

              <label class="setting-row account-support-switch" id="managedConfirmRow">
                <span><strong>Conferma subito l'email</strong><small>Salta il link di verifica per questo account</small></span>
                <input class="toggle" name="email_confirm" type="checkbox" checked>
              </label>

              <button class="btn" type="submit" ${panel.busy ? 'disabled' : ''}>Crea account</button>
            </form>
          </div>

          <div class="account-support-users">
            <div class="section-title"><h2 style="font-size:16px;">Account registrati</h2><span class="tiny">${filteredUsers.length} risultati</span></div>
            ${panel.loading && !panel.users.length
              ? '<div class="empty">Caricamento account...</div>'
              : filteredUsers.length
                ? `<div class="account-support-list">${filteredUsers.map((user) => `
                    <article class="account-support-user">
                      <div class="account-support-user-main">
                        <div class="account-support-avatar">${esc((user.display_name || user.username || user.email || '?').slice(0, 1).toUpperCase())}</div>
                        <div>
                          <strong>${esc(user.display_name || user.username || user.email || 'Account senza nome')}</strong>
                          <div class="meta">${esc(accountIdentityLabel(user))}</div>
                          <div class="account-support-badges">
                            <span class="support-badge ${accountConfirmed(user) ? 'ok' : 'warn'}">${accountConfirmed(user) ? 'VERIFICATO' : 'NON VERIFICATO'}</span>
                            ${user.is_premium ? '<span class="support-badge plus">PLUS</span>' : ''}
                            ${user.login_type === 'username' ? '<span class="support-badge">USERNAME</span>' : '<span class="support-badge">EMAIL</span>'}
                          </div>
                          ${user.student_name ? `<div class="meta">Player: ${esc(user.student_name)}</div>` : ''}
                        </div>
                      </div>
                      <div class="account-support-user-actions">
                        <button class="btn secondary row-action" type="button" data-manage-account="${esc(user.id)}">Modifica</button>
                        ${!accountConfirmed(user) && user.login_type !== 'username' ? `<button class="btn secondary row-action" type="button" data-confirm-account="${esc(user.id)}">Verifica</button>` : ''}
                        ${user.login_type !== 'username' ? `<button class="btn secondary row-action" type="button" data-recovery-account="${esc(user.id)}">Link recupero</button>` : ''}
                      </div>
                    </article>
                  `).join('')}</div>`
                : '<div class="empty">Nessun account corrisponde alla ricerca.</div>'}
          </div>
        </div>
      ` : ''}
    </div>
    ${panel.editingUserId ? renderManagedUserModal(panel.editingUserId) : ''}
  `;
}

function renderManagedUserModal(userId) {
  const user = state.accountAdmin.users.find((item) => item.id === userId);
  if (!user) return '';
  const loginType = user.login_type === 'username' ? 'username' : 'email';
  const identity = loginType === 'username' ? (user.username || '') : (user.email || '');
  return `
    <div class="edit-student-backdrop">
      <section class="edit-student-modal card account-support-modal" role="dialog" aria-modal="true" aria-labelledby="managedUserTitle">
        <div class="edit-modal-header">
          <h2 id="managedUserTitle">Gestisci account</h2>
          <button class="modal-close" id="closeManagedUserBtn" type="button" aria-label="Chiudi">×</button>
        </div>
        <form id="editManagedUserForm" class="grid">
          <input type="hidden" name="user_id" value="${esc(user.id)}">
          <label class="field">
            <span class="field-label">Nome visualizzato</span>
            <input name="display_name" value="${esc(user.display_name || '')}" required>
          </label>
          <div class="account-support-two-col">
            <label class="field">
              <span class="field-label">Tipo accesso</span>
              <select name="login_type" id="managedEditLoginType">
                <option value="email" ${loginType === 'email' ? 'selected' : ''}>Email</option>
                <option value="username" ${loginType === 'username' ? 'selected' : ''}>Nome utente</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label" id="managedEditIdentityLabel">${loginType === 'username' ? 'Nome utente' : 'Email'}</span>
              <input name="identity" id="managedEditIdentityInput" value="${esc(identity)}" required autocomplete="off">
            </label>
          </div>
          <label class="field">
            <span class="field-label">Nuova password</span>
            <input name="password" type="password" minlength="6" autocomplete="new-password" placeholder="Lascia vuoto per non cambiarla">
          </label>
          <div class="account-support-two-col">
            <label class="field">
              <span class="field-label">Player collegato</span>
              <select name="studente_id">
                <option value="">Nessuno</option>
                ${state.students.map((s) => `<option value="${s.id}" ${String(user.studente_id || '') === String(s.id) ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}
              </select>
            </label>
            <label class="setting-row account-support-switch">
              <span><strong>Account Plus</strong><small>Accesso alla Gestione</small></span>
              <input class="toggle" name="is_premium" type="checkbox" ${user.is_premium ? 'checked' : ''}>
            </label>
          </div>
          <label class="setting-row account-support-switch" id="managedEditConfirmRow" ${loginType === 'username' ? 'hidden' : ''}>
            <span><strong>Email verificata</strong><small>Conferma manualmente senza link email</small></span>
            <input class="toggle" name="email_confirm" type="checkbox" ${accountConfirmed(user) ? 'checked' : ''}>
          </label>
          <div class="account-support-danger-note">La password attuale non è visibile: il manager può solo sostituirla con una nuova password temporanea.</div>
          <div class="edit-modal-actions account-support-modal-actions">
            <button class="btn danger" id="deleteManagedUserBtn" type="button" data-user-id="${esc(user.id)}">Elimina account</button>
            <button class="btn secondary" id="cancelManagedUserBtn" type="button">Chiudi</button>
            <button class="btn" type="submit" ${state.accountAdmin.busy ? 'disabled' : ''}>Salva cambiamenti</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderAdmin() {
  const studentOptions = state.students.map((s) => `<option value="${s.id}">${esc(s.nome)}</option>`).join('');
  const domenica = isAutogestioneSunday(italyNow().day);
  return `
    <section class="card pad grid">
      <div class="section-title"><h2>Gestione</h2><span class="tiny">CRUD live</span></div>
      <div class="season-reset">
        <div><strong>Nuova stagione</strong><p>Conserva i player e azzera voti, bonus, malus e classifica.</p></div>
        <button class="btn danger" id="resetSeasonBtn" type="button">Azzera stagione</button>
      </div>
      <div class="autogestione-manager">
        <div class="section-title"><div><h2 style="font-size:18px;">Autogestione</h2><p class="tiny">I player dichiarano presenza o assenza entro le 14:00.</p></div><label class="setting-row autogestione-toggle"><span><strong>${state.autogestione.attiva ? 'Attiva' : 'Disattivata'}</strong><small>Solo manager</small></span><input class="toggle" id="autogestioneToggle" type="checkbox" ${state.autogestione.attiva ? 'checked' : ''}></label></div>
        ${state.autogestione.attiva ? `<div class="autogestione-manager-controls"><label class="field"><span class="field-label">Player</span><select id="autogestioneManagerStudent">${studentOptions || '<option value="">Nessuno studente</option>'}</select></label><label class="field"><span class="field-label">Esito</span><select id="autogestioneManagerState"><option value="presente">Presente dimenticata · 0 pt</option><option value="assente">Assente · −3 pt</option><option value="falsata">Falsata la presenza · −5 pt</option></select></label><button class="btn secondary" id="autogestioneManagerBtn" type="button" ${domenica ? 'disabled' : ''}>Registra / punisci</button></div><p class="tiny">${domenica ? 'La domenica non si registra la presenza.' : '“Falsata la presenza” è la motivazione preimpostata per una dichiarazione non leale.'}</p>` : '<p class="tiny">Attivala per consentire ai player di registrare autonomamente la presenza.</p>'}
      </div>
      <form id="addStudentForm" class="grid">
        <div class="field"><label>Nome</label><input name="nome" required placeholder="Es. Marco Rossi"></div>
        <div class="field"><label>Avatar URL</label><input name="avatar_url" placeholder="https://..."></div>
        <button class="btn" type="submit">Aggiungi Studente</button>
      </form>
      <form id="addVoteForm" class="grid">
        <div class="field"><label>Studente</label><select name="studente_id" required>${studentOptions || '<option value="">Nessuno studente</option>'}</select></div>
        <div class="field"><label>Voto</label><input name="voto" type="number" step="0.1" min="1" max="10" required></div>
        <button class="btn secondary" type="submit">Inserisci Voto</button>
      </form>
      <form id="addBonusForm" class="grid">
        <div class="field"><label>Studente</label><select name="studente_id" required>${studentOptions || '<option value="">Nessuno studente</option>'}</select></div>
        <div class="field"><label>Motivo</label><input name="motivo" required placeholder="Es. Compiti extra"></div>
        <div class="field"><label>Punti</label><input name="punti" type="number" step="0.5" required placeholder="Positivi o negativi"></div>
        <button class="btn secondary" type="submit">Inserisci Bonus/Malus</button>
      </form>
      <div class="quick-events">
        <div class="section-title"><h2 style="font-size:16px;">Presenze e puntualità</h2><span class="tiny">Inserimento rapido</span></div>
        <div class="quick-event-controls"><label class="field"><span class="field-label">Studente</span><select id="quickStudent" required>${studentOptions || '<option value="">Nessuno studente</option>'}</select></label><label class="field"><span class="field-label">Quantità</span><input id="quickQuantity" type="number" min="1" max="20" value="1" required></label><button class="btn secondary" id="addDelaysBtn" type="button">Aggiungi ritardi</button><button class="btn secondary" id="addAbsencesBtn" type="button">Aggiungi assenze</button></div>
      </div>
      <div>
        <div class="section-title"><h2 style="font-size:16px;">Studenti</h2></div>
        ${state.students.length ? `<div class="list">${state.students.map((s) => `
          <div class="row student-row">
            <div class="row-main">
              ${avatarMarkup(s.nome, s.avatar_url, 'style="width:44px;height:44px;border-radius:14px;"')}
              <strong class="row-name">${esc(s.nome)}</strong>
            </div>
            <div class="row-actions"><button class="btn secondary row-action" data-edit-student="${s.id}" type="button">Modifica</button><button class="btn danger row-action" data-delete-student="${s.id}" type="button">Elimina</button></div>
          </div>`).join('')}</div>` : `<div class="empty">Nessuno studente inserito</div>`}
      </div>
      ${renderAccountCustomerService()}
    </section>${state.editingStudentId ? renderEditStudentModal() : ''}`;
}

function renderEditStudentModal() {
  const student = state.students.find((item) => item.id === state.editingStudentId);
  if (!student) return '';
  const bannerUrl = student.banner_url || '';
  const bannerPosition = student.banner_position || '50% 50%';
  return `<div class="edit-student-backdrop"><section class="edit-student-modal card" role="dialog" aria-modal="true" aria-labelledby="editStudentTitle">
    <div class="edit-modal-header"><h2 id="editStudentTitle">Modifica player</h2><button class="modal-close" id="closeEditStudentBtn" type="button" aria-label="Chiudi">×</button></div>
    <form id="editStudentForm" class="grid">
      <div class="edit-player-preview">${avatarMarkup(student.nome, student.avatar_url)}<strong>${esc(student.nome)}</strong></div>
      <div class="field"><label for="editStudentName">Nome player</label><input id="editStudentName" name="nome" value="${esc(student.nome)}" required></div>
      <div class="field"><label for="editStudentAvatar">URL foto</label><input id="editStudentAvatar" name="avatar_url" type="url" value="${esc(student.avatar_url || '')}" placeholder="https://..."></div>
      <div class="field banner-url-field"><label for="editStudentBanner">Link banner pagina</label><input id="editStudentBanner" name="banner_url" type="url" value="${esc(bannerUrl)}" placeholder="https://.../banner.jpg"><button class="btn secondary banner-verify-btn" id="verifyBannerBtn" type="button" ${bannerUrl ? '' : 'hidden'}>Verifica e ritaglia</button></div>
      <div class="banner-crop-editor" id="bannerCropEditor" ${bannerUrl ? '' : 'hidden'}><div class="banner-crop-preview"><img id="bannerPreviewImage" src="${esc(bannerUrl || avatarFallback(student.nome))}" alt="Anteprima banner" style="object-position:${esc(bannerPosition)}" onerror="this.onerror=null;this.src='${avatarFallback(student.nome)}'"></div><div class="banner-crop-controls"><label>Orizzontale <output id="bannerPositionXValue">${esc(bannerPosition.split(' ')[0] || '50%')}</output><input id="bannerPositionX" name="banner_position_x" type="range" min="0" max="100" value="${Number.parseInt(bannerPosition) || 50}"></label><label>Verticale <output id="bannerPositionYValue">${esc(bannerPosition.split(' ')[1] || '50%')}</output><input id="bannerPositionY" name="banner_position_y" type="range" min="0" max="100" value="${Number.parseInt(bannerPosition.split(' ')[1]) || 50}"></label></div></div>
      <div class="edit-modal-actions"><button class="btn secondary" id="cancelEditStudentBtn" type="button">Chiudi</button><button class="btn" type="submit">Salva cambiamenti</button></div>
    </form>
  </section></div>`;
}

function renderAdminClean() {
  const studentOptions = state.students.map((student) => `<option value="${student.id}">${esc(student.nome)}</option>`).join('');
  const domenica = isAutogestioneSunday(italyNow().day);
  return `<section class="management-page"><div class="management-page-shell">
    <header class="management-header"><div><span class="management-eyebrow">Manager workspace</span><h2>Gestione</h2><p>Tutti gli strumenti operativi di Fantascuola, organizzati per lavorare più velocemente.</p></div><span class="management-live"><i></i>CRUD LIVE</span></header>
    <div class="management-content">
      <section class="management-summary"><div><span>Giocatori</span><strong>${state.students.length}</strong></div><div><span>Autogestione</span><strong>${state.autogestione.attiva ? 'Attiva' : 'Disattivata'}</strong></div><div><span>Stato sistema</span><strong>Operativo</strong></div></section>
      <section class="management-panel operations-panel"><div class="management-panel-header"><div><h3>Operazioni</h3><p>Voti, punti e presenze sono raccolti in un unico spazio operativo.</p></div></div>
        <div class="management-tabs" role="tablist"><button class="management-tab active" type="button" data-management-tool="vote">Voto</button><button class="management-tab" type="button" data-management-tool="bonus">Bonus / Malus</button><button class="management-tab" type="button" data-management-tool="attendance">Presenze</button><button class="management-tab" type="button" data-management-tool="auto">Autogestione</button></div>
        <div class="management-stage">
          <div class="management-tool active" data-management-panel="vote"><div class="management-tool-head"><h4>Inserisci voto</h4><p>Registra una valutazione e aggiorna subito la classifica.</p></div><form id="addVoteForm" class="management-form management-vote-form"><label class="field"><span class="field-label">Studente</span><select name="studente_id" required>${studentOptions || '<option value="">Nessuno studente</option>'}</select></label><label class="field"><span class="field-label">Voto</span><input name="voto" type="number" step="0.1" min="1" max="10" required placeholder="8.5"></label><button class="btn" type="submit">Registra voto</button></form></div>
          <div class="management-tool" data-management-panel="bonus"><div class="management-tool-head"><h4>Bonus / Malus</h4><p>Aggiungi o sottrai punti specificando sempre la motivazione.</p></div><form id="addBonusForm" class="management-form management-bonus-form"><label class="field"><span class="field-label">Studente</span><select name="studente_id" required>${studentOptions || '<option value="">Nessuno studente</option>'}</select></label><label class="field"><span class="field-label">Punti</span><input name="punti" type="number" step="0.5" required placeholder="+3"></label><label class="field"><span class="field-label">Motivo</span><input name="motivo" required placeholder="Compiti extra"></label><button class="btn" type="submit">Inserisci</button></form></div>
          <div class="management-tool" data-management-panel="attendance"><div class="management-tool-head"><h4>Presenze e puntualità</h4><p>Inserimento rapido di assenze e ritardi per uno studente.</p></div><div class="management-form management-quick-form"><label class="field"><span class="field-label">Studente</span><select id="quickStudent">${studentOptions || '<option value="">Nessuno studente</option>'}</select></label><label class="field"><span class="field-label">Quantità</span><input id="quickQuantity" type="number" min="1" max="20" value="1"></label><button class="btn secondary" id="addDelaysBtn" type="button">Aggiungi ritardi</button><button class="btn secondary" id="addAbsencesBtn" type="button">Aggiungi assenze</button></div></div>
          <div class="management-tool" data-management-panel="auto"><div class="management-tool-head"><h4>Autogestione presenze</h4><p>I player dichiarano presenza o assenza entro le 14:00; il manager può correggere manualmente.</p></div><div class="management-auto-box"><label class="management-toggle-row"><span><strong>${state.autogestione.attiva ? 'Attiva' : 'Disattivata'}</strong><small>Consenti ai player di registrare autonomamente la presenza</small></span><input class="toggle" id="autogestioneToggle" type="checkbox" ${state.autogestione.attiva ? 'checked' : ''}></label>${state.autogestione.attiva ? `<div class="management-auto-form"><label class="field"><span class="field-label">Player</span><select id="autogestioneManagerStudent">${studentOptions || '<option value="">Nessuno studente</option>'}</select></label><label class="field"><span class="field-label">Esito</span><select id="autogestioneManagerState"><option value="presente">Presente dimenticata · 0 pt</option><option value="assente">Assente · −3 pt</option><option value="falsata">Falsata la presenza · −5 pt</option></select></label><button class="btn secondary" id="autogestioneManagerBtn" type="button" ${domenica ? 'disabled' : ''}>Registra / punisci</button></div>` : ''}<p class="management-hint">${state.autogestione.attiva ? domenica ? 'La domenica non si registra la presenza.' : 'Registra o correggi la presenza di un player.' : 'Attivala per consentire ai player di registrare autonomamente la presenza.'}</p></div></div>
        </div>
      </section>
      <section class="management-panel management-players"><div class="management-panel-header"><div><h3>Giocatori</h3><p>Aggiungi nuovi player e gestisci quelli già presenti.</p></div></div><form id="addStudentForm" class="management-create-player"><label class="field"><span class="field-label">Nome</span><input name="nome" required placeholder="Es. Marco Rossi"></label><label class="field"><span class="field-label">Avatar URL</span><input name="avatar_url" placeholder="https://..."></label><button class="btn" type="submit">Aggiungi player</button></form><div class="management-player-toolbar"><strong>Elenco player</strong><span>${state.students.length} player</span></div><div class="management-player-list">${state.students.length ? state.students.map((student) => `<article class="management-player-row"><div>${avatarMarkup(student.nome, student.avatar_url, 'style="width:50px;height:50px;border-radius:14px;"')}<strong>${esc(student.nome)}</strong></div><aside><button class="btn secondary" data-edit-student="${student.id}" type="button">Modifica</button><button class="btn danger" data-delete-student="${student.id}" type="button">Elimina</button></aside></article>`).join('') : '<div class="empty">Nessun player inserito</div>'}</div></section>
      <section class="management-panel" aria-label="Gestione Free Roam"><iframe src="Free-Roam/manager.html" title="Gestione mappa Free Roam" loading="lazy" style="display:block;width:100%;height:460px;border:0;border-radius:18px;"></iframe></section>
      <section class="management-danger"><div><h3>Nuova stagione</h3><p>Conserva i player e azzera voti, bonus, malus e classifica.</p></div><button class="btn danger" id="resetSeasonBtn" type="button">Azzera stagione</button></section>
    </div>
  </div></section>${state.editingStudentId ? renderEditStudentModal() : ''}`;
}

function renderDashboard() {
  const body = {
    classifica: renderClassifica(),
    registro: renderRegistro(),
    player: renderPlayer(),
    opzioni: renderOpzioni(),
    account: renderAccount(),
    admin: renderAdminClean(),
    regolamento: renderRegolamento(),
    archivio: renderArchivio(),
  }[state.activeTab] || renderClassifica();
  const markup = `${!state.account || (!isPremium() && !state.account.studente_id) ? renderAccountSetup() : ''}${body}${nav()}`;
  const currentManagement = app.querySelector('.management-page');
  if (state.activeTab === 'admin' && currentManagement && isPremium()) {
    const next = document.createElement('div');
    next.innerHTML = markup;
    const nextManagement = next.querySelector('.management-page');
    const currentContent = currentManagement.querySelector('.management-content');
    const nextContent = nextManagement?.querySelector('.management-content');
    if (nextContent && currentContent) {
      currentManagement.querySelector('.management-header').replaceWith(nextManagement.querySelector('.management-header'));
      const oldPanels = [...currentContent.children];
      const newPanels = [...nextContent.children];
      oldPanels.forEach((panel, index) => {
        if (panel.getAttribute('aria-label') === 'Gestione Free Roam') return;
        panel.replaceWith(newPanels[index]);
      });
      app.querySelector('.tabs')?.replaceWith(next.querySelector('.tabs'));
    } else app.innerHTML = markup;
  } else app.innerHTML = markup;
  renderHeaderAccount();
  attachHandlers();
}

function render() {
  if (!isLoggedIn()) {
    renderLogin();
    app.innerHTML += nav();
    renderHeaderAccount();
    attachHandlers();
  } else {
    renderDashboard();
  }
}

const navResponsiveListener = () => {
  const breakpoint = window.matchMedia('(max-width: 839px)').matches;
  const navState = document.querySelector('.tabs') ? 'present' : 'absent';
  if (navState === 'present' && document.querySelectorAll('[data-tab]').length) {
    const currentType = document.getElementById('moreTabsBtn') ? 'mobile' : 'desktop';
    const nextType = breakpoint ? 'mobile' : 'desktop';
    if (currentType !== nextType) render();
  }
};
window.addEventListener('resize', navResponsiveListener);
window.matchMedia('(max-width: 839px)').addEventListener?.('change', navResponsiveListener);

function attachHandlers() {
  const classificaSearch = document.getElementById('classificaSearch');
  const classificaSort = document.getElementById('classificaSort');
  const classificaRows = document.getElementById('classificaRows');
  const classificaCount = document.getElementById('classificaCount');
  const updateClassificaRows = () => {
    const query = String(classificaSearch?.value || '').trim().toLowerCase();
    const sort = classificaSort?.value || 'points';
    const ranked = [...state.leaderboard].sort((a, b) => Number(b.punti_totali || 0) - Number(a.punti_totali || 0) || String(a.nome).localeCompare(String(b.nome)));
    const filtered = ranked.filter((student) => String(student.nome || '').toLowerCase().includes(query));
    if (sort === 'name') filtered.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    if (classificaRows) classificaRows.innerHTML = renderClassificaRows(filtered, ranked);
    if (classificaCount) classificaCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'giocatore' : 'giocatori'}`;
  };
  if (classificaSearch) classificaSearch.addEventListener('input', updateClassificaRows);
  if (classificaSort) classificaSort.addEventListener('change', updateClassificaRows);
  if (classificaRows) classificaRows.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view-player]');
    if (!button) return;
    state.viewingPlayerId = button.dataset.viewPlayer;
    state.activeTab = 'player';
    renderDashboard();
  });
  const backToClassificaBtn = document.getElementById('backToClassificaBtn');
  if (backToClassificaBtn) backToClassificaBtn.addEventListener('click', () => {
    state.viewingPlayerId = '';
    state.activeTab = 'classifica';
    renderDashboard();
  });
  document.querySelectorAll('[data-management-tool]').forEach((button) => button.addEventListener('click', () => {
    const tool = button.dataset.managementTool;
    document.querySelectorAll('[data-management-tool]').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-management-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.managementPanel === tool));
  }));
  const accountBtn = document.getElementById('accountBtn');
  const openAccount = () => {
    if (!isLoggedIn()) return render();
    state.activeTab = 'account';
    renderDashboard();
  };
  if (accountBtn) accountBtn.addEventListener('click', openAccount);
  const newUiAccountBtn = document.getElementById('newUiAccountBtn');
  if (newUiAccountBtn) newUiAccountBtn.addEventListener('click', openAccount);
  const closeAccount = () => { state.activeTab = 'classifica'; renderDashboard(); };
  const accountCancelBtn = document.getElementById('accountCancelBtn');
  if (accountCancelBtn) accountCancelBtn.addEventListener('click', closeAccount);
  const accountDoneBtn = document.getElementById('accountDoneBtn');
  if (accountDoneBtn) accountDoneBtn.addEventListener('click', closeAccount);
  const headerLogoutBtn = document.getElementById('headerLogoutBtn');
  if (headerLogoutBtn) headerLogoutBtn.addEventListener('click', () => supabase.auth.signOut());
  document.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.getElementById('moreTabsMenu')?.setAttribute('hidden', '');
    document.getElementById('moreTabsBtn')?.setAttribute('aria-expanded', 'false');
    const requestedTab = btn.dataset.tab;
    const locked = (!isLoggedIn() && ['registro', 'player', 'opzioni'].includes(requestedTab)) || (requestedTab === 'admin' && !isPremium());
    if (locked) {
      state.authMode = 'login';
      state.activeTab = 'classifica';
      render();
      return alert(requestedTab === 'admin' ? 'La Gestione richiede un account Premium.' : 'Accedi o registrati per sbloccare questa sezione.');
    }
    if (requestedTab === 'player' || requestedTab === 'classifica') state.viewingPlayerId = '';
    state.activeTab = requestedTab;
    renderDashboard();
  }));
  const moreTabsBtn = document.getElementById('moreTabsBtn');
  const moreTabsMenu = document.getElementById('moreTabsMenu');
  if (moreTabsBtn && moreTabsMenu) moreTabsBtn.addEventListener('click', () => {
    const isOpen = !moreTabsMenu.hidden;
    moreTabsMenu.hidden = isOpen;
    moreTabsBtn.setAttribute('aria-expanded', String(!isOpen));
  });
  document.querySelectorAll('[data-auth-mode]').forEach((btn) => btn.addEventListener('click', () => { state.authMode = btn.dataset.authMode; render(); }));
  const authForm = document.getElementById('authForm');
  if (authForm) authForm.addEventListener('submit', submitAuth);
  const playerSetupForm = document.getElementById('playerSetupForm');
  if (playerSetupForm) playerSetupForm.addEventListener('submit', submitPlayerSetup);
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    supabase.auth.signOut();
  });
  document.querySelectorAll('input[name="theme"]').forEach((themeInput) => themeInput.addEventListener('change', (e) => {
    preferences.theme = e.target.value;
    preferences.darkMode = preferences.theme === 'dark';
    if (!['new-ui', 'new-ui-dark'].includes(preferences.theme)) preferences.dockLegacy = false;
    document.querySelectorAll('.theme-option').forEach((option) => option.classList.toggle('selected', option.contains(e.target)));
    savePreferences();
  }));
  const dockLegacyToggle = document.getElementById('dockLegacyToggle');
  if (dockLegacyToggle) dockLegacyToggle.addEventListener('change', (e) => { preferences.dockLegacy = e.target.checked; savePreferences(); });
  const boldTextToggle = document.getElementById('boldTextToggle');
  if (boldTextToggle) boldTextToggle.addEventListener('change', (e) => { preferences.boldText = e.target.checked; savePreferences(); });
  const compactToggle = document.getElementById('compactToggle');
  if (compactToggle) compactToggle.addEventListener('change', (e) => { preferences.compact = e.target.checked; savePreferences(); });
  const motionToggle = document.getElementById('motionToggle');
  if (motionToggle) motionToggle.addEventListener('change', (e) => { preferences.reduceMotion = e.target.checked; savePreferences(); });
  const textScale = document.getElementById('textScale');
  if (textScale) textScale.addEventListener('input', (e) => { preferences.textScale = Number(e.target.value); document.getElementById('textScaleValue').textContent = `${preferences.textScale}%`; savePreferences(); });
  const preferenceRanges = [
    ['elementScale', 'elementScaleValue', (value) => `${value}%`, 'elementScale'],
    ['elementSpacing', 'elementSpacingValue', (value) => `${value}%`, 'elementSpacing'],
    ['glassOpacity', 'glassOpacityValue', (value) => `${value}%`, 'glassOpacity'],
    ['glassBlur', 'glassBlurValue', (value) => `${value}px`, 'glassBlur'],
  ];
  preferenceRanges.forEach(([inputId, outputId, format, preferenceKey]) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', (event) => {
      preferences[preferenceKey] = Number(event.target.value);
      const output = document.getElementById(outputId);
      if (output) output.textContent = format(preferences[preferenceKey]);
      savePreferences();
    });
  });
  const showBordersToggle = document.getElementById('showBordersToggle');
  if (showBordersToggle) showBordersToggle.addEventListener('change', (event) => { preferences.showBorders = event.target.checked; savePreferences(); });
  const showShadowsToggle = document.getElementById('showShadowsToggle');
  if (showShadowsToggle) showShadowsToggle.addEventListener('change', (event) => { preferences.showShadows = event.target.checked; savePreferences(); });
  const accentColor = document.getElementById('accentColor');
  if (accentColor) accentColor.addEventListener('input', (e) => { preferences.accent = e.target.value; savePreferences(); });
  const textColor = document.getElementById('textColor');
  if (textColor) textColor.addEventListener('input', (e) => { preferences.textColor = e.target.value; savePreferences(); });
  const resetPreferencesBtn = document.getElementById('resetPreferencesBtn');
  if (resetPreferencesBtn) resetPreferencesBtn.addEventListener('click', () => { Object.assign(preferences, defaultPreferences); savePreferences(); renderDashboard(); });
  const addDelaysBtn = document.getElementById('addDelaysBtn');
  if (addDelaysBtn) addDelaysBtn.addEventListener('click', () => addQuickAttendance('Ritardo', -2));
  const addAbsencesBtn = document.getElementById('addAbsencesBtn');
  if (addAbsencesBtn) addAbsencesBtn.addEventListener('click', () => addQuickAttendance('Assenza', -3));
  const autogestioneToggle = document.getElementById('autogestioneToggle');
  if (autogestioneToggle) autogestioneToggle.addEventListener('change', (event) => setAutogestioneAttiva(event.target.checked));
  document.querySelectorAll('[data-autogestione-stato]').forEach((button) => button.addEventListener('click', () => registraAutogestionePlayer(button.dataset.autogestioneStato)));
  const autogestioneManagerBtn = document.getElementById('autogestioneManagerBtn');
  if (autogestioneManagerBtn) autogestioneManagerBtn.addEventListener('click', registraAutogestioneManager);
  const autogestioneReminderBtn = document.getElementById('autogestioneReminderBtn');
  if (autogestioneReminderBtn) autogestioneReminderBtn.addEventListener('click', attivaPromemoriaAutogestione);
  const saveAccountBtn = document.getElementById('saveAccountBtn');
  if (saveAccountBtn) saveAccountBtn.addEventListener('click', saveAccountSettings);
  const accountLogoutBtn = document.getElementById('accountLogoutBtn');
  if (accountLogoutBtn) accountLogoutBtn.addEventListener('click', () => supabase.auth.signOut());
  const resetSeasonBtn = document.getElementById('resetSeasonBtn');
  if (resetSeasonBtn) resetSeasonBtn.addEventListener('click', resetSeason);
  const addStudentForm = document.getElementById('addStudentForm');
  if (addStudentForm) addStudentForm.addEventListener('submit', submitAddStudent);
  const addVoteForm = document.getElementById('addVoteForm');
  if (addVoteForm) addVoteForm.addEventListener('submit', submitAddVote);
  const addBonusForm = document.getElementById('addBonusForm');
  if (addBonusForm) addBonusForm.addEventListener('submit', submitAddBonus);
  document.querySelectorAll('[data-edit-student]').forEach((btn) => btn.addEventListener('click', () => {
    state.editingStudentId = btn.dataset.editStudent;
    renderDashboard();
  }));
  const closeEditStudent = () => { state.editingStudentId = ''; renderDashboard(); };
  const closeEditStudentBtn = document.getElementById('closeEditStudentBtn');
  if (closeEditStudentBtn) closeEditStudentBtn.addEventListener('click', closeEditStudent);
  const cancelEditStudentBtn = document.getElementById('cancelEditStudentBtn');
  if (cancelEditStudentBtn) cancelEditStudentBtn.addEventListener('click', closeEditStudent);
  const editStudentForm = document.getElementById('editStudentForm');
  if (editStudentForm) editStudentForm.addEventListener('submit', submitEditStudent);
  const bannerInput = document.getElementById('editStudentBanner');
  const bannerVerifyBtn = document.getElementById('verifyBannerBtn');
  const bannerCropEditor = document.getElementById('bannerCropEditor');
  const bannerPreviewImage = document.getElementById('bannerPreviewImage');
  const bannerPositionX = document.getElementById('bannerPositionX');
  const bannerPositionY = document.getElementById('bannerPositionY');
  const updateBannerPreview = () => {
    const x = `${bannerPositionX?.value || 50}%`;
    const y = `${bannerPositionY?.value || 50}%`;
    if (bannerPreviewImage) bannerPreviewImage.style.objectPosition = `${x} ${y}`;
    const xOutput = document.getElementById('bannerPositionXValue');
    const yOutput = document.getElementById('bannerPositionYValue');
    if (xOutput) xOutput.textContent = x;
    if (yOutput) yOutput.textContent = y;
  };
  if (bannerInput) bannerInput.addEventListener('input', () => {
    if (bannerVerifyBtn) bannerVerifyBtn.hidden = !bannerInput.value.trim();
  });
  if (bannerVerifyBtn) bannerVerifyBtn.addEventListener('click', () => {
    if (!bannerInput?.value.trim()) return;
    if (bannerPreviewImage) bannerPreviewImage.src = bannerInput.value.trim();
    if (bannerCropEditor) bannerCropEditor.hidden = false;
    updateBannerPreview();
  });
  [bannerPositionX, bannerPositionY].forEach((control) => control?.addEventListener('input', updateBannerPreview));
  document.querySelectorAll('[data-delete-student]').forEach((btn) => btn.addEventListener('click', () => deleteStudent(btn.dataset.deleteStudent)));

  const accountSupportToggle = document.getElementById('accountSupportToggle');
  if (accountSupportToggle) accountSupportToggle.addEventListener('click', async () => {
    state.accountAdmin.open = !state.accountAdmin.open;
    renderDashboard();
    if (state.accountAdmin.open && !state.accountAdmin.users.length) await loadManagedUsers();
  });
  const refreshManagedUsersBtn = document.getElementById('refreshManagedUsersBtn');
  if (refreshManagedUsersBtn) refreshManagedUsersBtn.addEventListener('click', loadManagedUsers);
  const accountSupportSearch = document.getElementById('accountSupportSearch');
  if (accountSupportSearch) accountSupportSearch.addEventListener('input', (e) => {
    state.accountAdmin.search = e.target.value;
    renderDashboard();
    requestAnimationFrame(() => {
      const input = document.getElementById('accountSupportSearch');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  });
  const managedCreateLoginType = document.getElementById('managedCreateLoginType');
  if (managedCreateLoginType) managedCreateLoginType.addEventListener('change', () => syncManagedIdentityUi('create'));
  const managedEditLoginType = document.getElementById('managedEditLoginType');
  if (managedEditLoginType) managedEditLoginType.addEventListener('change', () => syncManagedIdentityUi('edit'));
  const createManagedUserForm = document.getElementById('createManagedUserForm');
  if (createManagedUserForm) createManagedUserForm.addEventListener('submit', createManagedUser);
  document.querySelectorAll('[data-manage-account]').forEach((btn) => btn.addEventListener('click', () => {
    state.accountAdmin.editingUserId = btn.dataset.manageAccount;
    renderDashboard();
  }));
  document.querySelectorAll('[data-confirm-account]').forEach((btn) => btn.addEventListener('click', () => confirmManagedUser(btn.dataset.confirmAccount)));
  document.querySelectorAll('[data-recovery-account]').forEach((btn) => btn.addEventListener('click', () => generateManagedRecoveryLink(btn.dataset.recoveryAccount)));
  const closeManagedUser = () => {
    state.accountAdmin.editingUserId = '';
    renderDashboard();
  };
  const closeManagedUserBtn = document.getElementById('closeManagedUserBtn');
  if (closeManagedUserBtn) closeManagedUserBtn.addEventListener('click', closeManagedUser);
  const cancelManagedUserBtn = document.getElementById('cancelManagedUserBtn');
  if (cancelManagedUserBtn) cancelManagedUserBtn.addEventListener('click', closeManagedUser);
  const editManagedUserForm = document.getElementById('editManagedUserForm');
  if (editManagedUserForm) editManagedUserForm.addEventListener('submit', updateManagedUser);
  const deleteManagedUserBtn = document.getElementById('deleteManagedUserBtn');
  if (deleteManagedUserBtn) deleteManagedUserBtn.addEventListener('click', () => deleteManagedUser(deleteManagedUserBtn.dataset.userId));

  const auditActorFilter = document.getElementById('auditActorFilter');
  if (auditActorFilter) auditActorFilter.addEventListener('change', (e) => { state.auditFilter.actor = e.target.value; renderDashboard(); });
  const auditActionFilter = document.getElementById('auditActionFilter');
  if (auditActionFilter) auditActionFilter.addEventListener('change', (e) => { state.auditFilter.action = e.target.value; renderDashboard(); });
  const auditDirectionFilter = document.getElementById('auditDirectionFilter');
  if (auditDirectionFilter) auditDirectionFilter.addEventListener('change', (e) => { state.auditFilter.direction = e.target.value; renderDashboard(); });
  const auditDateFilter = document.getElementById('auditDateFilter');
  if (auditDateFilter) auditDateFilter.addEventListener('change', (e) => { state.auditFilter.date = e.target.value; renderDashboard(); });
  const archiveDateSelect = document.getElementById('archiveDateSelect');
  if (archiveDateSelect) archiveDateSelect.addEventListener('change', (e) => { state.archiveDate = e.target.value; renderDashboard(); });
}


function syncManagedIdentityUi(mode) {
  const prefix = mode === 'edit' ? 'managedEdit' : 'managed';
  const typeSelect = document.getElementById(`${prefix}LoginType`);
  const identityInput = document.getElementById(`${prefix}IdentityInput`);
  const identityLabel = document.getElementById(`${prefix}IdentityLabel`);
  const confirmRow = document.getElementById(`${prefix}ConfirmRow`);
  if (!typeSelect || !identityInput || !identityLabel) return;
  const usernameMode = typeSelect.value === 'username';
  identityLabel.textContent = usernameMode ? 'Nome utente' : 'Email';
  identityInput.placeholder = usernameMode ? 'es. mario.rossi' : 'utente@example.com';
  identityInput.type = usernameMode ? 'text' : 'email';
  if (confirmRow) confirmRow.hidden = usernameMode;
}

async function invokeAccountAdmin(action, payload = {}) {
  if (!isPremium()) throw new Error('Operazione riservata ai manager Plus.');
  const { data, error } = await supabase.functions.invoke('account-admin', {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message || 'Errore della funzione account-admin.';
    try {
      const contextBody = await error.context?.json?.();
      if (contextBody?.error) message = contextBody.error;
    } catch (_) {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadManagedUsers() {
  if (!isPremium() || state.accountAdmin.loading) return;
  state.accountAdmin.loading = true;
  state.accountAdmin.error = '';
  renderDashboard();
  try {
    const data = await invokeAccountAdmin('list');
    state.accountAdmin.users = Array.isArray(data?.users) ? data.users : [];
  } catch (error) {
    state.accountAdmin.error = error.message || String(error);
  } finally {
    state.accountAdmin.loading = false;
    renderDashboard();
  }
}

async function createManagedUser(e) {
  e.preventDefault();
  if (state.accountAdmin.busy) return;
  const form = new FormData(e.currentTarget);
  const loginType = String(form.get('login_type') || 'email');
  const identity = String(form.get('identity') || '').trim();
  const displayName = String(form.get('display_name') || '').trim();
  const password = String(form.get('password') || '');
  const studenteId = String(form.get('studente_id') || '') || null;
  const isPremiumAccount = form.get('is_premium') === 'on';
  const emailConfirm = loginType === 'username' || form.get('email_confirm') === 'on';

  if (loginType === 'username' && normalizeUsername(identity).length < 3) {
    return alert('Il nome utente deve contenere almeno 3 caratteri validi.');
  }

  state.accountAdmin.busy = true;
  state.accountAdmin.error = '';
  renderDashboard();
  try {
    await invokeAccountAdmin('create', {
      login_type: loginType,
      identity,
      display_name: displayName,
      password,
      studente_id: studenteId,
      is_premium: isPremiumAccount,
      email_confirm: emailConfirm,
    });
    await loadManagedUsers();
    alert(loginType === 'username'
      ? `Account creato. Accesso: ${normalizeUsername(identity)} + password impostata.`
      : 'Account creato correttamente.');
  } catch (error) {
    state.accountAdmin.error = error.message || String(error);
    alert(state.accountAdmin.error);
  } finally {
    state.accountAdmin.busy = false;
    renderDashboard();
  }
}

async function updateManagedUser(e) {
  e.preventDefault();
  if (state.accountAdmin.busy) return;
  const form = new FormData(e.currentTarget);
  const loginType = String(form.get('login_type') || 'email');
  const identity = String(form.get('identity') || '').trim();
  const password = String(form.get('password') || '');
  state.accountAdmin.busy = true;
  state.accountAdmin.error = '';
  renderDashboard();
  try {
    await invokeAccountAdmin('update', {
      user_id: String(form.get('user_id')),
      login_type: loginType,
      identity,
      display_name: String(form.get('display_name') || '').trim(),
      password: password || null,
      studente_id: String(form.get('studente_id') || '') || null,
      is_premium: form.get('is_premium') === 'on',
      email_confirm: loginType === 'username' || form.get('email_confirm') === 'on',
    });
    state.accountAdmin.editingUserId = '';
    await loadManagedUsers();
    alert('Account aggiornato.');
  } catch (error) {
    state.accountAdmin.error = error.message || String(error);
    alert(state.accountAdmin.error);
  } finally {
    state.accountAdmin.busy = false;
    renderDashboard();
  }
}

async function confirmManagedUser(userId) {
  if (!confirm('Confermare manualmente questa email senza usare il link di verifica?')) return;
  try {
    await invokeAccountAdmin('confirm', { user_id: userId });
    await loadManagedUsers();
    alert('Account verificato.');
  } catch (error) {
    alert(error.message || String(error));
  }
}

async function generateManagedRecoveryLink(userId) {
  try {
    const data = await invokeAccountAdmin('recovery_link', { user_id: userId });
    if (!data?.action_link) throw new Error('Il server non ha restituito un link di recupero.');
    try {
      await navigator.clipboard.writeText(data.action_link);
      alert('Link di recupero copiato negli appunti. Puoi inviarlo al proprietario dell’account.');
    } catch (_) {
      prompt('Copia questo link di recupero e invialo al proprietario dell’account:', data.action_link);
    }
  } catch (error) {
    alert(error.message || String(error));
  }
}

async function deleteManagedUser(userId) {
  if (!confirm('Eliminare definitivamente questo account? Questa operazione non può essere annullata.')) return;
  try {
    await invokeAccountAdmin('delete', { user_id: userId });
    state.accountAdmin.editingUserId = '';
    await loadManagedUsers();
    alert('Account eliminato.');
  } catch (error) {
    alert(error.message || String(error));
  }
}

async function saveAccountSettings() {
  if (!state.account || state.accountSaving) return;
  state.accountSaving = true;
  const displayName = String(document.getElementById('accountDisplayName')?.value || '').trim();
  const settings = {
    ...(state.account.settings || {}),
    notifications: Boolean(document.getElementById('accountNotifications')?.checked),
    publicProfile: Boolean(document.getElementById('accountPublicProfile')?.checked),
  };
  const { data, error } = await supabase.from('account_profiles').update({ display_name: displayName || state.session.user.email, settings }).eq('user_id', state.session.user.id).select('id, user_id, studente_id, display_name, is_premium, settings').single();
  state.accountSaving = false;
  if (error) return alert(error.message);
  state.account = data;
  renderDashboard();
}

async function logAction(action, entity, details, pointsDelta = null, studentId = null) {
  const { error } = await supabase.from('audit_logs').insert({ action, entity, details, points_delta: pointsDelta, studente_id: studentId });
  if (error) console.warn('Audit log non disponibile:', error.message);
}

async function resetSeason() {
  if (!isPremium()) return alert('La funzione è riservata agli account Premium.');
  const confirmed = confirm('Azzera tutti i voti, bonus e malus? I player resteranno salvati, ma questa operazione non può essere annullata.');
  if (!confirmed) return;
  const { error } = await supabase.rpc('reset_season');
  if (error) return alert(error.message);
  await loadData();
  alert('Stagione azzerata. I player sono stati conservati.');
}

async function submitPlayerSetup(e) {
  e.preventDefault();
  const studenteId = new FormData(e.currentTarget).get('studente_id');
  const { data, error } = await supabase.from('account_profiles').upsert({
    user_id: state.session.user.id,
    studente_id: studenteId,
    display_name: state.session.user.user_metadata?.display_name || state.session.user.email,
  }, { onConflict: 'user_id' }).select('id, user_id, studente_id, display_name, is_premium, settings').single();
  if (error) return alert(error.code === '23505' ? 'Questo player è già stato scelto da un altro account.' : error.message);
  state.account = data;
  state.selectedStudentId = data.studente_id;
  state.profile = state.students.find((s) => s.id === state.selectedStudentId) || null;
  state.activeTab = 'player';
  renderDashboard();
}

async function submitAuth(e) {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const identity = String(form.get('email') || '').trim();
  const password = String(form.get('password'));
  let result;

  if (state.authMode === 'signup') {
    result = await supabase.auth.signUp({
      email: identity,
      password,
      options: { data: { display_name: form.get('display_name'), login_type: 'email' } },
    });
  } else {
    const email = identity.includes('@') ? identity : usernameToInternalEmail(identity);
    if (!email) return alert('Inserisci un’email o un nome utente valido.');
    result = await supabase.auth.signInWithPassword({ email, password });
  }

  if (result.error) return alert(result.error.message);
  if (state.authMode === 'signup' && !result.data.session) return alert('Account creato. Controlla la tua email per confermare l’accesso.');
  state.session = result.data.session;
  await loadData();
}

async function submitAddStudent(e) {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const nome = String(form.get('nome')).trim();
  const { data, error } = await supabase.from('studenti').insert({ nome, avatar_url: form.get('avatar_url') || null }).select('id').single();
  if (error) return alert(error.message);
  await logAction('create', 'studenti', `Aggiunto player ${nome}`, null, data.id);
  e.currentTarget.reset();
  await loadData();
}
async function submitAddVote(e) {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const student = state.students.find((item) => item.id === form.get('studente_id'));
  const voto = Number(form.get('voto'));
  const { error } = await supabase.from('voti').insert({ studente_id: form.get('studente_id'), voto });
  if (error) return alert(error.message);
  await logAction('create', 'voti', `Aggiunto voto ${voto} a ${student?.nome || 'player'}`, voto, student?.id);
  e.currentTarget.reset();
  await loadData();
}
async function submitAddBonus(e) {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const student = state.students.find((item) => item.id === form.get('studente_id'));
  const punti = Number(form.get('punti'));
  const motivo = String(form.get('motivo')).trim();
  const { error } = await supabase.from('bonus_malus').insert({
    studente_id: form.get('studente_id'),
    motivo,
    punti,
  });
  if (error) return alert(error.message);
  await logAction('create', 'bonus_malus', `${punti < 0 ? 'Malus' : 'Bonus'} "${motivo}" per ${student?.nome || 'player'}`, punti, student?.id);
  e.currentTarget.reset();
  await loadData();
}
async function submitEditStudent(e) {
  e.preventDefault();
  const student = state.students.find((item) => item.id === state.editingStudentId);
  if (!student) return;
  const form = new FormData(e.currentTarget);
  const nome = String(form.get('nome')).trim();
  const avatarUrl = String(form.get('avatar_url') || '').trim() || null;
  const bannerUrl = String(form.get('banner_url') || '').trim() || null;
  const bannerPosition = bannerUrl ? `${Number(form.get('banner_position_x') || 50)}% ${Number(form.get('banner_position_y') || 50)}%` : null;
  const { error } = await supabase.from('studenti').update({ nome, avatar_url: avatarUrl, banner_url: bannerUrl, banner_position: bannerPosition }).eq('id', student.id);
  if (error) return alert(error.message);
  await logAction('update', 'studenti', `Modificato player ${student.nome} in ${nome}`);
  state.editingStudentId = '';
  await loadData();
}
async function deleteStudent(id) {
  if (!confirm('Eliminare questo studente?')) return;
  const student = state.students.find((item) => item.id === id);
  const { error } = await supabase.from('studenti').delete().eq('id', id);
  if (error) return alert(error.message);
  await logAction('delete', 'studenti', `Eliminato player ${student?.nome || 'sconosciuto'}`, null, id);
  if (state.selectedStudentId === id) localStorage.removeItem('fantascuola_student_id');
  await loadData();
}

async function addQuickAttendance(label, points) {
  const studentId = document.getElementById('quickStudent')?.value;
  const quantity = Number(document.getElementById('quickQuantity')?.value || 0);
  const student = state.students.find((item) => item.id === studentId);
  if (!studentId || !student || quantity < 1) return alert('Seleziona un player e una quantità valida.');
  const records = Array.from({ length: quantity }, () => ({ studente_id: studentId, motivo: label, punti: points }));
  const { error } = await supabase.from('bonus_malus').insert(records);
  if (error) return alert(error.message);
  await logAction('create', 'bonus_malus', `Aggiunti ${quantity} ${label.toLowerCase()} a ${student.nome}`, points * quantity, studentId);
  await loadData();
}

async function setAutogestioneAttiva(attiva) {
  if (!isPremium()) return alert('Solo i manager possono modificare Autogestione.');
  const { error } = await supabase.rpc('autogestione_set_attiva', { p_attiva: attiva });
  if (error) return alert(error.message);
  await logAction('update', 'autogestione', `Autogestione ${attiva ? 'attivata' : 'disattivata'}`);
  await loadData();
}

async function registraAutogestionePlayer(stato) {
  if (isAutogestioneSunday(italyNow().day)) return alert('La domenica non si registra la presenza.');
  const { data, error } = await supabase.rpc('autogestione_player_registra', { p_stato: stato });
  if (error) return alert(error.message);
  const punti = Number(data?.punti || 0);
  alert(stato === 'presente' ? `Presenza registrata: ${pointsLabel(punti)} pt.` : `Assenza registrata: ${pointsLabel(punti)} pt.`);
  await loadData();
}

async function registraAutogestioneManager() {
  if (!isPremium()) return alert('Solo i manager possono registrare o verificare le presenze.');
  if (isAutogestioneSunday(italyNow().day)) return alert('La domenica non si registra la presenza.');
  const studenteId = document.getElementById('autogestioneManagerStudent')?.value;
  const stato = document.getElementById('autogestioneManagerState')?.value;
  if (!studenteId || !stato) return alert('Seleziona player ed esito.');
  const { error } = await supabase.rpc('autogestione_manager_registra', { p_studente: studenteId, p_stato: stato, p_punti: null });
  if (error) return alert(error.message);
  const student = state.students.find((item) => item.id === studenteId);
  await logAction('create', 'autogestione', `${stato === 'falsata' ? 'Falsata la presenza' : `Presenza ${stato} registrata dal manager`} per ${student?.nome || 'player'}`);
  await loadData();
}

async function attivaPromemoriaAutogestione() {
  if (!('Notification' in window)) return alert('Questo browser non supporta le notifiche.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return alert('Autorizza le notifiche del browser per ricevere il promemoria.');
  localStorage.setItem('fantascuola_autogestione_promemoria', 'true');
  programmaPromemoriaAutogestione();
  renderDashboard();
}

let autogestioneReminderTimer;
function programmaPromemoriaAutogestione() {
  clearTimeout(autogestioneReminderTimer);
  if (!state.autogestione.attiva || !state.profile || localStorage.getItem('fantascuola_autogestione_promemoria') !== 'true' || Notification.permission !== 'granted') return;
  const now = new Date();
  const italy = italyNow();
  if (isAutogestioneSunday(italy.day)) return;
  const currentMinutes = italy.hour * 60 + italy.minute;
  const delay = (13 * 60 + 45 - currentMinutes) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
  if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
  autogestioneReminderTimer = setTimeout(() => {
    const alreadyDone = state.autogestione.presenze.some((item) => item.studente_id === state.profile?.id && item.giorno === italy.day);
    if (!alreadyDone) new Notification('Fantascuola', { body: 'Ricorda di segnare presenza o assenza entro le 14:00.' });
  }, delay);
}

if (!SUPABASE_ANON_KEY) {
  app.innerHTML = `<section class="card hero"><h2 style="margin:0;">Manca la Supabase anon key</h2><p>Ricarica la pagina e incolla la chiave anon del progetto per connettere l'app.</p></section>`;
  setStatus('Chiave mancante');
} else {
  applyPreferences();
  const { data: sessionData } = await supabase.auth.getSession();
  state.session = sessionData.session;
  supabase.auth.onAuthStateChange((event, session) => {
    const userChanged = state.session?.user?.id !== session?.user?.id;
    state.session = session;
    if (!session) {
      state.account = null;
      state.selectedStudentId = '';
      state.profile = null;
      state.accountAdmin.users = [];
      state.accountAdmin.open = false;
      state.accountAdmin.editingUserId = '';
      state.accountAdmin.error = '';
    }
    if (userChanged || event === 'USER_UPDATED') loadData();
  });
  await loadData();
  programmaPromemoriaAutogestione();
  subscribeRealtime();
}
