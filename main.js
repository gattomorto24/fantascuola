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
  archiveDate: '',
  auditFilter: { actor: '', action: '', direction: '', date: '' },
  selectedStudentId: localStorage.getItem('fantascuola_student_id') || '',
  profile: null,
  editingStudentId: '',
  accountSaving: false,
  loading: true,
  error: '',
};

const defaultPreferences = {
  theme: 'light',
  darkMode: false,
  textScale: 100,
  boldText: false,
  accent: '#e65f3f',
  textColor: '#18222d',
  compact: false,
  reduceMotion: false,
};
const preferences = { ...defaultPreferences, ...JSON.parse(localStorage.getItem('fantascuola_preferences') || '{}') };
if (!preferences.theme || preferences.theme === 'light' && preferences.darkMode) preferences.theme = preferences.darkMode ? 'dark' : 'light';

const fmt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'medium' });
function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function setStatus(text) {
  statusEl.textContent = text;
  const liveEl = document.getElementById('newUiLive');
  if (!liveEl) return;
  const isConnected = text === 'Live' || text === 'SUBSCRIBED';
  const isError = text.includes('Errore') || text.includes('CHANNEL_ERROR') || text.includes('TIMED_OUT');
  liveEl.dataset.connection = isConnected ? 'connected' : isError ? 'error' : 'syncing';
  liveEl.querySelector('span').textContent = isConnected ? 'LIVE' : isError ? 'OFFLINE' : 'SYNC';
}
function renderHeaderAccount() {
  const authStatus = document.getElementById('authStatus');
  const accountBtn = document.getElementById('accountBtn');
  const logoutBtn = document.getElementById('headerLogoutBtn');
  if (!authStatus || !accountBtn || !logoutBtn) return;
  authStatus.textContent = isLoggedIn() ? 'LOGGATO' : 'GUEST';
  authStatus.classList.toggle('logged', isLoggedIn());
  authStatus.classList.toggle('guest', !isLoggedIn());
  accountBtn.textContent = isLoggedIn() ? 'Account' : 'Accedi';
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
  document.body.classList.toggle('strong-type', preferences.boldText);
  document.body.classList.toggle('compact-ui', preferences.compact);
  document.body.classList.toggle('reduce-motion', preferences.reduceMotion);
}
function savePreferences() {
  localStorage.setItem('fantascuola_preferences', JSON.stringify(preferences));
  applyPreferences();
}

async function loadData() {
  state.loading = true;
  setStatus('Sincronizzazione live...');
  await supabase.rpc('capture_daily_snapshot');
  const [studentsRes, leaderboardRes, votesRes, bonusRes, accountRes, auditRes, archiveRes] = await Promise.all([
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
  if (!state.archiveDate && state.archive.length) state.archiveDate = state.archive[0].snapshot_date;
  state.selectedStudentId = state.account?.studente_id || '';
  state.profile = state.students.find((s) => s.id === state.selectedStudentId) || null;
  state.loading = false;
  state.error = [studentsRes.error, leaderboardRes.error, votesRes.error, bonusRes.error, accountRes.error, auditRes.error, archiveRes.error]
    .filter((error) => error && !error.message?.includes('account_profiles'))
    .map((e) => e.message).join(' • ');
  setStatus(state.error ? 'Errore di sincronizzazione' : 'Live');
  render();
}

async function loadAccountProfile() {
  const fullResult = await supabase.from('account_profiles').select('id, user_id, studente_id, display_name, is_premium, settings').eq('user_id', state.session.user.id).maybeSingle();
  if (!fullResult.error || !fullResult.error.message?.includes('settings')) return fullResult;
  return supabase.from('account_profiles').select('id, user_id, studente_id, display_name, is_premium').eq('user_id', state.session.user.id).maybeSingle();
}

function subscribeRealtime() {
  const channel = supabase
    .channel('fantascuola-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'studenti' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'voti' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bonus_malus' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, loadData)
    .subscribe((status) => setStatus(status === 'SUBSCRIBED' ? 'Live' : `Realtime ${status}`));
}

function nav() {
  const tabs = [
    ['classifica', 'trophy', 'Classifica'],
    ['registro', 'journal', 'Registro'],
    ['player', 'user', 'Player'],
    ['opzioni', 'settings', 'Opzioni'],
    ['admin', 'tool', 'Gestione'],
    ['regolamento', 'book', 'Regolamento'],
    ['archivio', 'archive', 'Archivio'],
  ];
  const renderTab = ([id, ico, label], extraClass = '') => {
    const locked = (!isLoggedIn() && ['registro', 'player', 'opzioni'].includes(id)) || (id === 'admin' && !isPremium());
    return `
    <button class="tab ${extraClass} ${state.activeTab === id ? 'active' : ''} ${locked ? 'locked' : ''}" data-tab="${id}" aria-label="${label}${locked ? ' - login richiesto' : ''}">
      <span class="tab-icon" aria-hidden="true">${icon(ico)}</span><span class="tab-label">${label}</span>
      ${locked ? '<span class="tab-lock" aria-hidden="true">LOCK</span>' : ''}
    </button>`;
  };
  return `<nav class="tabs"><div class="tabs-inner">${tabs.map((tab, index) => renderTab(tab, index > 2 ? 'tab-more-item' : '')).join('')}
    <button class="tab more-tab ${tabs.slice(3).some(([id]) => state.activeTab === id) ? 'active' : ''}" id="moreTabsBtn" type="button" aria-expanded="false" aria-controls="moreTabsMenu"><span class="tab-icon" aria-hidden="true">${icon('more')}</span><span class="tab-label">Altro</span></button>
  </div><div class="more-menu" id="moreTabsMenu" hidden>${tabs.slice(3).map((tab) => renderTab(tab, 'more-menu-item')).join('')}</div></nav>`;
}

function icon(name) {
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
}

function renderLogin() {
  const hasStudents = state.students.length > 0;
  app.innerHTML = `
    <section class="card hero">
      <div class="section-title"><h2>Accedi a Fantascuola</h2><span class="tiny">Classifica pubblica disponibile</span></div>
      <p>${hasStudents ? 'Crea il tuo account, scegli un player libero e sblocca le statistiche personali.' : 'La classifica è pronta. Il primo player verrà aggiunto da Gestione.'}</p>
      <div class="auth-switcher" role="tablist">
        <button class="switch ${state.authMode === 'login' ? 'active' : ''}" data-auth-mode="login">Accedi</button>
        <button class="switch ${state.authMode === 'signup' ? 'active' : ''}" data-auth-mode="signup">Registrati</button>
      </div>
      <form id="authForm" class="grid">
        ${state.authMode === 'signup' ? '<div class="field"><label for="displayName">Nome account</label><input id="displayName" name="display_name" required placeholder="Es. Antonino"></div>' : ''}
        <div class="field"><label for="authEmail">Email</label><input id="authEmail" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="authPassword">Password</label><input id="authPassword" name="password" type="password" minlength="6" required autocomplete="${state.authMode === 'login' ? 'current-password' : 'new-password'}"></div>
        <button class="btn" type="submit">${state.authMode === 'login' ? 'Accedi' : 'Crea account'}</button>
      </form>
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
    admin: renderAdmin(),
  };
  return copy[state.activeTab] || copy.classifica;
}

function renderAccount() {
  const email = state.session?.user?.email || 'Account autenticato';
  const accountSettings = { notifications: true, publicProfile: true, ...state.account?.settings };
  return `<section class="card pad account-card ${document.documentElement.dataset.theme.startsWith('new-ui') ? 'new-ui-account-modal' : ''}">
    <div class="account-modal-header"><button class="account-modal-close" id="accountCancelBtn" type="button">Annulla</button><h2>Impostazioni account</h2><button class="account-modal-done" id="accountDoneBtn" type="button">Fatto</button></div>
    <div class="section-title"><h2>Account</h2><span class="auth-status logged">LOGGATO</span></div>
    <div class="account-email">${esc(email)}</div>
    <div class="account-online-group">
      <div class="account-group-title">Profilo online</div>
      <label class="account-input"><span>Nome visualizzato</span><input id="accountDisplayName" value="${esc(state.account?.display_name || '')}" placeholder="Il tuo nome"></label>
      <label class="setting-row"><span><strong>Notifiche attività</strong><small>Avvisi sulle modifiche della classifica</small></span><input class="toggle" id="accountNotifications" type="checkbox" ${accountSettings.notifications ? 'checked' : ''}></label>
      <label class="setting-row"><span><strong>Profilo visibile</strong><small>Consenti di mostrare il tuo nome nella community</small></span><input class="toggle" id="accountPublicProfile" type="checkbox" ${accountSettings.publicProfile ? 'checked' : ''}></label>
      <button class="btn secondary account-save-btn" id="saveAccountBtn" type="button">${state.accountSaving ? 'Salvataggio...' : 'Salva modifiche'}</button>
    </div>
    <div class="account-grid">
      <div class="account-stat"><span>Tipo account</span><strong>${isPremium() ? 'Premium' : 'Giocatore'}</strong></div>
      <div class="account-stat"><span>Player</span><strong>${esc(state.profile?.nome || 'Da scegliere')}</strong></div>
    </div>
    <button class="btn danger" id="accountLogoutBtn" type="button">Logout</button>
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
  return `
    <section class="card pad">
      <div class="section-title"><h2>Classifica</h2><span class="tiny">Aggiornamento live</span></div>
      ${state.leaderboard.length ? `<div class="list">${state.leaderboard.map((s, i) => `
        <div class="row leaderboard-row">
          <div class="row-main">
            <div class="rank">${i + 1}</div>
            ${avatarMarkup(s.nome, s.avatar_url)}
            <div class="row-copy"><div class="row-name">${esc(s.nome)}</div><div class="meta">Punti totali</div></div>
          </div>
          <div class="row-score">${Number(s.punti_totali || 0).toFixed(1)}</div>
        </div>`).join('')}</div>` : `<div class="empty">Nessuno studente ancora in classifica</div>`}
    </section>`;
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
  if (!state.profile) return `<section class="card pad"><div class="empty">Seleziona un profilo per vedere il tuo player.</div></section>`;
  const personalVotes = state.events.filter((e) => e.studente_id === state.profile.id && e.kind === 'voto');
  const personalBonuses = state.events.filter((e) => e.studente_id === state.profile.id && e.kind === 'bonus');
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
  return `
    <section class="card player-card">
      <div style="display:flex;gap:14px;align-items:center;">
        ${avatarMarkup(state.profile.nome, state.profile.avatar_url, 'style="width:88px;height:88px;"')}
        <div>
          <div class="eyebrow" style="margin-bottom:4px;">Squadra personale</div>
          <h2 style="margin:0;font-size:26px;">${esc(state.profile.nome)}</h2>
          <div class="tiny">Player card live</div>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat"><strong>${avg ? avg.toFixed(2) : '—'}</strong><span>Media voti</span></div>
        <div class="stat"><strong>${personalVotes.length}</strong><span>Voti</span></div>
        <div class="stat"><strong>${personalBonuses.reduce((sum, item) => sum + Number(item.punti), 0).toFixed(1)}</strong><span>Bonus/Malus</span></div>
      </div>
      <div class="advanced-stats"><div class="section-title"><h2 style="font-size:16px;">Statistiche avanzate</h2><span class="tiny">Quando disponibili</span></div><div class="advanced-grid"><div class="advanced-stat"><span>Media punti giornaliera</span><strong>${dayStats.length ? (totalPoints / dayStats.length).toFixed(1) : '—'}</strong></div><div class="advanced-stat"><span>Giorno più proficuo</span><strong>${bestDay ? `+${bestDay.gain.toFixed(1)} pt` : '—'}</strong><small>${bestDay ? dayText(bestDay.day) : 'Nessun dato'}</small></div><div class="advanced-stat"><span>Giorno con più perdite</span><strong>${worstDay ? `${worstDay.loss.toFixed(1)} pt` : '—'}</strong><small>${worstDay ? dayText(worstDay.day) : 'Nessun dato'}</small></div><div class="advanced-stat"><span>Assenze / Ritardi</span><strong>${absences} / ${delays}</strong><small>Eventi individuali</small></div></div></div>
      <div class="card pad" style="background:rgba(255,255,255,0.04);">
        <div class="section-title"><h2 style="font-size:16px;">Storico personale</h2></div>
        ${[...personalVotes.map((v) => ({ title: `Voto ${v.voto}`, sub: fmt.format(new Date(v.created_at)) })), ...personalBonuses.map((b) => ({ title: `${b.motivo} · ${pointsLabel(b.punti)} pt`, sub: fmt.format(new Date(b.created_at)) }))].length ? `
          <div class="list">${[...personalVotes.map((v) => ({ title: `Voto ${v.voto}`, sub: fmt.format(new Date(v.created_at)) })), ...personalBonuses.map((b) => ({ title: `${b.motivo} · ${pointsLabel(b.punti)} pt`, sub: fmt.format(new Date(b.created_at)) }))].slice(0, 8).map((x) => `<div class="row"><div><div style="font-weight:700">${esc(x.title)}</div><div class="meta">${esc(x.sub)}</div></div></div>`).join('')}</div>
        ` : `<div class="empty">Nessuna azione ancora registrata</div>`}
      </div>
    </section>`;
}

function renderOpzioni() {
  return `<section class="card pad options-panel">
    <div class="section-title"><h2>Opzioni</h2><span class="tiny">Preferenze di questo dispositivo</span></div>
    <div class="settings-group theme-settings">
      <div class="settings-heading"><div><h3>Temi</h3><p>Scegli l'aspetto dell'interfaccia.</p></div></div>
      <div class="theme-options" role="radiogroup" aria-label="Tema dell'interfaccia">
        <label class="theme-option ${preferences.theme === 'light' ? 'selected' : ''}"><input type="radio" name="theme" value="light" ${preferences.theme === 'light' ? 'checked' : ''}><span><strong>Light</strong><small>Tema chiaro, impostazione predefinita</small></span></label>
        <label class="theme-option ${preferences.theme === 'dark' ? 'selected' : ''}"><input type="radio" name="theme" value="dark" ${preferences.theme === 'dark' ? 'checked' : ''}><span><strong>Dark</strong><small>Tema scuro per ambienti poco illuminati</small></span></label>
        <label class="theme-option ${preferences.theme === 'new-ui' ? 'selected' : ''}"><input type="radio" name="theme" value="new-ui" ${preferences.theme === 'new-ui' ? 'checked' : ''}><span><strong>New UI (Beta)</strong><small>Interfaccia iOS chiara</small></span></label>
        <label class="theme-option ${preferences.theme === 'new-ui-dark' ? 'selected' : ''}"><input type="radio" name="theme" value="new-ui-dark" ${preferences.theme === 'new-ui-dark' ? 'checked' : ''}><span><strong>Nuova UI (Beta) Dark</strong><small>Interfaccia scura ad alto contrasto</small></span></label>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-heading"><div><h3>Aspetto</h3><p>Personalizza l'esperienza di Fantascuola.</p></div><span class="beta-tag">BETA</span></div>
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
          <span class="rule-number">03</span><h3>Bonus speciali</h3>
          <p>I bonus vengono aggiunti individualmente dal Founder per premiare azioni o eventi speciali.</p>
          <div class="rule-list"><div><strong>Interrogazione volontaria</strong><span>+3 pt</span></div><div><strong>Salvataggio della classe</strong><span>+5 pt</span></div><div><strong>Bonus custom</strong><span>Variabile</span></div></div>
        </article>
        <article class="rule-block rule-total">
          <span class="rule-number">04</span><h3>Formula finale</h3>
          <p>Il punteggio totale viene aggiornato automaticamente ad ogni evento:</p>
          <div class="formula">Totale = somma dei voti + bonus + malus</div>
          <p class="rule-note">Le decisioni registrate sono definitive e il punteggio considera tutte le variazioni dall'inizio dell'anno.</p>
        </article>
      </div>
    </section>`;
}

function renderAdmin() {
  const studentOptions = state.students.map((s) => `<option value="${s.id}">${esc(s.nome)}</option>`).join('');
  return `
    <section class="card pad grid">
      <div class="section-title"><h2>Gestione</h2><span class="tiny">CRUD live</span></div>
      <div class="season-reset">
        <div><strong>Nuova stagione</strong><p>Conserva i player e azzera voti, bonus, malus e classifica.</p></div>
        <button class="btn danger" id="resetSeasonBtn" type="button">Azzera stagione</button>
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
    </section>${state.editingStudentId ? renderEditStudentModal() : ''}`;
}

function renderEditStudentModal() {
  const student = state.students.find((item) => item.id === state.editingStudentId);
  if (!student) return '';
  return `<div class="edit-student-backdrop"><section class="edit-student-modal card" role="dialog" aria-modal="true" aria-labelledby="editStudentTitle">
    <div class="edit-modal-header"><h2 id="editStudentTitle">Modifica player</h2><button class="modal-close" id="closeEditStudentBtn" type="button" aria-label="Chiudi">×</button></div>
    <form id="editStudentForm" class="grid">
      <div class="edit-player-preview">${avatarMarkup(student.nome, student.avatar_url)}<strong>${esc(student.nome)}</strong></div>
      <div class="field"><label for="editStudentName">Nome player</label><input id="editStudentName" name="nome" value="${esc(student.nome)}" required></div>
      <div class="field"><label for="editStudentAvatar">URL foto</label><input id="editStudentAvatar" name="avatar_url" type="url" value="${esc(student.avatar_url || '')}" placeholder="https://..."></div>
      <div class="edit-modal-actions"><button class="btn secondary" id="cancelEditStudentBtn" type="button">Chiudi</button><button class="btn" type="submit">Salva cambiamenti</button></div>
    </form>
  </section></div>`;
}

function renderDashboard() {
  const body = {
    classifica: renderClassifica(),
    registro: renderRegistro(),
    player: renderPlayer(),
    opzioni: renderOpzioni(),
    account: renderAccount(),
    admin: renderAdmin(),
    regolamento: renderRegolamento(),
    archivio: renderArchivio(),
  }[state.activeTab] || renderClassifica();
  app.innerHTML = `${!state.account || (!isPremium() && !state.account.studente_id) ? renderAccountSetup() : ''}${body}${nav()}`;
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

function attachHandlers() {
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
    document.querySelectorAll('.theme-option').forEach((option) => option.classList.toggle('selected', option.contains(e.target)));
    savePreferences();
  }));
  const boldTextToggle = document.getElementById('boldTextToggle');
  if (boldTextToggle) boldTextToggle.addEventListener('change', (e) => { preferences.boldText = e.target.checked; savePreferences(); });
  const compactToggle = document.getElementById('compactToggle');
  if (compactToggle) compactToggle.addEventListener('change', (e) => { preferences.compact = e.target.checked; savePreferences(); });
  const motionToggle = document.getElementById('motionToggle');
  if (motionToggle) motionToggle.addEventListener('change', (e) => { preferences.reduceMotion = e.target.checked; savePreferences(); });
  const textScale = document.getElementById('textScale');
  if (textScale) textScale.addEventListener('input', (e) => { preferences.textScale = Number(e.target.value); document.getElementById('textScaleValue').textContent = `${preferences.textScale}%`; savePreferences(); });
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
  document.querySelectorAll('[data-delete-student]').forEach((btn) => btn.addEventListener('click', () => deleteStudent(btn.dataset.deleteStudent)));
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
  const email = String(form.get('email')).trim();
  const password = String(form.get('password'));
  const result = state.authMode === 'signup'
    ? await supabase.auth.signUp({ email, password, options: { data: { display_name: form.get('display_name') } } })
    : await supabase.auth.signInWithPassword({ email, password });
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
  const { error } = await supabase.from('studenti').update({ nome, avatar_url: avatarUrl }).eq('id', student.id);
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

if (!SUPABASE_ANON_KEY) {
  app.innerHTML = `<section class="card hero"><h2 style="margin:0;">Manca la Supabase anon key</h2><p>Ricarica la pagina e incolla la chiave anon del progetto per connettere l'app.</p></section>`;
  setStatus('Chiave mancante');
} else {
  applyPreferences();
  const { data: sessionData } = await supabase.auth.getSession();
  state.session = sessionData.session;
  supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    if (!session) {
      state.account = null;
      state.selectedStudentId = '';
      state.profile = null;
    }
    loadData();
  });
  await loadData();
  subscribeRealtime();
}
