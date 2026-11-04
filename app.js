// Úkoly – prototyp (local-first, data v localStorage tohoto prohlížeče)
'use strict';

const STORE_KEY = 'ukoly.v1';
const DAYS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
const DAYS_ASCII = ['ne', 'po', 'ut', 'st', 'ct', 'pa', 'so'];
const DAYS_FULL = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const DAYS_FULL_ASCII = ['nedele', 'pondeli', 'utery', 'streda', 'ctvrtek', 'patek', 'sobota'];
// JIRA klíče kdekoli v názvu (např. „UL72 SMPOESB-123 Migrace“) se zobrazí jako odkaz
const JIRA_KEYS = /\b[A-Z][A-Z0-9]+-\d+\b/g;

const $ = (sel) => document.querySelector(sel);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Data ----------

function emptyState() {
  return { projects: [], jiras: [], tasks: [], settings: { jiraBaseUrl: '', confluenceBaseUrl: '' }, updatedAt: 0 };
}

function demoState() {
  const s = emptyState();
  const p = { id: uid(), name: 'Ukázkový projekt' };
  const j = { id: uid(), projectId: p.id, name: 'DEMO-1 Ukázkový JIRA task', confluenceUrl: '' };
  s.projects.push(p);
  s.jiras.push(j);
  s.tasks.push(
    newTask({ projectId: p.id, jiraId: j.id, title: 'Klikni na úkol pro detail', due: dateStr(new Date()), time: '' }),
    newTask({
      projectId: p.id, jiraId: j.id, title: 'Úkol s checklistem',
      checklist: [{ id: uid(), text: 'První krok', done: true }, { id: uid(), text: 'Druhý krok', done: false }],
    }),
    newTask({ projectId: p.id, jiraId: null, title: 'Úkol bez JIRA tasku' })
  );
  return s;
}

function newTask(fields) {
  return {
    id: uid(), projectId: null, jiraId: null, title: '', done: false, doneAt: null,
    due: '', time: '', remind: false, notified: false, notes: '', checklist: [],
    createdAt: Date.now(), ...fields,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate({ ...emptyState(), ...JSON.parse(raw) });
  } catch (e) { console.warn('Načtení dat selhalo', e); }
  return demoState();
}

// Starší data měla u JIRA tasku zvlášť key + title, teď je to jeden volný text
function migrate(s) {
  s.jiras.forEach((j) => {
    if (j.name == null) j.name = [j.key, j.title].filter(Boolean).join(' ');
    delete j.key; delete j.title;
    // dřív se mohla do názvu dostat celá URL na issue – nech jen klíč
    const k = j.name && j.name.match(/\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)/);
    if (k) j.name = k[1].toUpperCase();
  });
  // adresy serveru zkrať na kořen (odstraň cestu k dashboardu apod.)
  s.projects.forEach((p) => { if (p.jiraBaseUrl) p.jiraBaseUrl = normalizeBase(p.jiraBaseUrl); });
  if (s.settings && s.settings.jiraBaseUrl) s.settings.jiraBaseUrl = normalizeBase(s.settings.jiraBaseUrl);
  return s;
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn('Uložení selhalo', e); }
}

// Lokální změna: orazítkuj, ulož a (když je zapnuto) naplánuj nahrání do OneDrive
function save() {
  state.updatedAt = Date.now();
  persist();
  if (window.Sync) Sync.schedulePush();
}

// Stav přišel z OneDrive z jiného zařízení – převezmi ho jen když je novější
function applyRemote(remote) {
  if (!remote || typeof remote !== 'object' || !Array.isArray(remote.projects) || !Array.isArray(remote.tasks)) return;
  const localAt = state.updatedAt || 0, remoteAt = remote.updatedAt || 0;
  if (remoteAt > localAt) {
    state = migrate({ ...emptyState(), ...remote });
    persist(); // bez orazítkování – zachovej čas z cloudu
    render();
  } else if (remoteAt < localAt && window.Sync) {
    Sync.schedulePush(); // lokál je novější → pošli ho nahoru
  }
}

let state = load();
let ui = { view: 'today', projectId: null, taskId: null, showDone: false };
let syncStatus = { ready: false, signedIn: false };

const project = (id) => state.projects.find((p) => p.id === id);
const jira = (id) => state.jiras.find((j) => j.id === id);
const task = (id) => state.tasks.find((t) => t.id === id);

// ---------- Datumy ----------

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' (pro zobrazení)
function fmtDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
// 'DD/MM/YYYY' (i s . nebo -, rok nepovinný) -> 'YYYY-MM-DD' nebo '' když je to nesmysl
function parseDMY(s) {
  const m = (s || '').trim().match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/);
  if (!m) return '';
  const day = Number(m[1]), mon = Number(m[2]);
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (m[3] && m[3].length === 2) year += 2000;
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
  const d = new Date(year, mon - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== mon - 1 || d.getDate() !== day) return '';
  return dateStr(d);
}

function weekdayIndex(tok) {
  let i = DAYS.indexOf(tok); if (i >= 0) return i;
  i = DAYS_ASCII.indexOf(tok); if (i >= 0) return i;
  i = DAYS_FULL.indexOf(tok); if (i >= 0) return i;
  i = DAYS_FULL_ASCII.indexOf(tok); if (i >= 0) return i;
  return -1;
}

function dueInfo(t) {
  if (!t.due) return null;
  const today = dateStr(new Date());
  const d = parseDate(t.due);
  const tomorrow = dateStr(new Date(Date.now() + 864e5));
  let label;
  if (t.due === today) label = 'dnes';
  else if (t.due === tomorrow) label = 'zítra';
  else label = `${DAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
  if (t.time) label += ' ' + t.time;
  const overdue = !t.done && (t.due < today || (t.due === today && t.time && t.time < nowTime()));
  return { label, overdue, today: t.due === today };
}

function nowTime() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

// Rychlé zadání: "Název úkolu !pá 14:00", "!zítra", "!dnes", "!12.11." nebo "!12.11.2026"
function parseQuick(text) {
  const m = text.match(/\s*!(\S+)(?:\s+(\d{1,2}:\d{2}))?\s*$/);
  if (!m) return { title: text.trim(), due: '', time: '' };
  const token = m[1].toLowerCase();
  const time = m[2] ? m[2].padStart(5, '0') : '';
  const now = new Date();
  let due = '';
  if (token === 'dnes') due = dateStr(now);
  else if (token === 'zítra' || token === 'zitra') due = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  else if (token === 'pozítří' || token === 'pozitri') due = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  else if (weekdayIndex(token) >= 0) {
    const diff = (weekdayIndex(token) - now.getDay() + 7) % 7;
    due = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff));
  } else {
    const dm = token.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/);
    if (dm) {
      let d = new Date(dm[3] ? Number(dm[3]) : now.getFullYear(), Number(dm[2]) - 1, Number(dm[1]));
      if (!dm[3] && dateStr(d) < dateStr(now)) d.setFullYear(d.getFullYear() + 1);
      due = dateStr(d);
    }
  }
  if (!due) return { title: text.trim(), due: '', time: '' };
  return { title: text.slice(0, m.index).trim(), due, time };
}

// ---------- Odkazy do JIRA / Confluence (jen čtení) ----------

// Adresa JIRA: nejdřív nastavení projektu, jinak globální výchozí
// Předponu klíče normalizuje na tvar s koncovou pomlčkou (FIB1904 -> FIB1904-)
const prefixDash = (s) => (s ? s.trim().replace(/-*$/, '') + '-' : '');

// Z vložené adresy (klidně celý dashboard) nechá jen kořen serveru,
// např. https://support.trask.cz/secure/Dashboard.jspa?... -> https://support.trask.cz
function normalizeBase(url) {
  const s = (url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const path = u.pathname.replace(/\/(secure|browse|issues|projects|plugins|Dashboard\.jspa)\b.*$/i, '').replace(/\/+$/, '');
    return u.origin + path;
  } catch (e) {
    return s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function projectBase(projectId) {
  const p = project(projectId);
  return (p && p.jiraBaseUrl) || state.settings.jiraBaseUrl || '';
}

function jiraUrl(key, base) {
  const b = normalizeBase(base);
  return b ? `${b}/browse/${encodeURIComponent(key)}` : '';
}

// Z klíče nebo z vložené adresy na issue vytáhne jen klíč (SMPOESB-300)
function keyFromUrl(value) {
  const m = value.match(/\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)/);
  return m ? m[1].toUpperCase() : null;
}

function linkifyJira(name, base) {
  return esc(name).replace(JIRA_KEYS, (key) => {
    const url = jiraUrl(key, base);
    return url
      ? `<a class="key" href="${esc(url)}" target="_blank" rel="noopener" draggable="false" title="Otevřít v JIRA">${key}</a>`
      : `<button class="key" data-action="settings" title="Nejdřív nastav adresu JIRA">${key}</button>`;
  });
}

// ---------- Render ----------

function render() {
  // třídu nastavit před renderem detailu, jinak autosize počítá výšku ve skrytém panelu
  $('#app').classList.toggle('has-detail', !!task(ui.taskId));
  renderNav();
  renderList();
  renderDetail();
}

function openCount(filter) {
  return state.tasks.filter((t) => !t.done && filter(t)).length;
}

function renderNav() {
  const today = dateStr(new Date());
  const todayCount = openCount((t) => t.due && t.due <= today);
  const upcomingCount = openCount((t) => t.due);
  const inboxCount = openCount((t) => t.projectId == null);
  const item = (view, id, label, count, extra = '', drag = false) => `
    <button class="nav-item ${ui.view === view && (id == null || ui.projectId === id) ? 'active' : ''}"
      data-action="nav" data-view="${view}" ${id ? `data-id="${id}"` : ''}${drag ? ' draggable="true" data-drag="project"' : ''}>
      <span class="nav-label">${extra}${esc(label)}</span>${count ? `<span class="count">${count}</span>` : ''}
    </button>`;

  $('#nav').innerHTML = `
    <div class="nav-head">
      <span class="brand">Úkoly</span>
      <button class="icon-btn" data-action="settings" title="Nastavení" aria-label="Nastavení">${ICONS.gear}</button>
    </div>
    <nav class="nav-group">
      ${item('inbox', null, 'Nezařazené', inboxCount, ICONS.inbox)}
      ${item('today', null, 'Dnes', todayCount, ICONS.sun)}
      ${item('upcoming', null, 'Naplánované', upcomingCount, ICONS.calendar)}
    </nav>
    <div class="nav-section">Projekty</div>
    <nav class="nav-group">
      ${state.projects.map((p) => item('project', p.id, p.name, openCount((t) => t.projectId === p.id), '<span class="dot"></span>', true)).join('')}
    </nav>
    <label class="ghost-row"><span class="ghost-plus">${ICONS.folderNew}</span><input class="ghost-input" data-enter="add-project" placeholder="Nový projekt" aria-label="Nový projekt"></label>
  `;
}

function taskRow(t, { showContext = false, drag = false } = {}) {
  const di = dueInfo(t);
  const total = t.checklist.length;
  const doneCount = t.checklist.filter((c) => c.done).length;
  const j = jira(t.jiraId);
  const p = project(t.projectId);
  const context = showContext ? [p && p.name, j && j.cid, j && j.name].filter(Boolean).join(' · ') : '';
  return `
    <li class="task ${t.done ? 'done' : ''} ${ui.taskId === t.id ? 'selected' : ''}" data-action="open-task" data-id="${t.id}"${drag ? ' draggable="true" data-drag="task"' : ''}>
      <button class="check ${t.done ? 'on' : ''}" data-action="toggle-task" data-id="${t.id}" aria-label="Hotovo">${ICONS.check}</button>
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">
        ${context ? `<span class="ctx">${esc(context)}</span>` : ''}
        ${total ? `<span class="pill">${doneCount}/${total}</span>` : ''}
        ${t.remind && t.due ? `<span class="bell">${ICONS.bell}</span>` : ''}
        ${di ? `<span class="due ${di.overdue ? 'overdue' : di.today ? 'today' : ''}">${esc(di.label)}</span>` : ''}
      </span>
    </li>`;
}

function sortTasks(list) {
  return list.slice().sort((a, b) =>
    (a.done - b.done) ||
    ((a.due || '9999') + (a.time || '99')).localeCompare((b.due || '9999') + (b.time || '99')) ||
    a.createdAt - b.createdAt);
}

function visible(list) {
  return ui.showDone ? list : list.filter((t) => !t.done);
}

// Ruční pořadí (drag&drop): zachová pořadí v poli, hotové spadnou dolů
function orderManual(list) {
  return visible(list).slice().sort((a, b) => a.done - b.done);
}

// Přesune položku s id dragId na pozici k targetId ve stejném poli
function reorder(arr, dragId, targetId) {
  const di = arr.findIndex((x) => x.id === dragId);
  const ti = arr.findIndex((x) => x.id === targetId);
  if (di < 0 || ti < 0 || di === ti) return;
  const [item] = arr.splice(di, 1);
  const tgt = arr.findIndex((x) => x.id === targetId);
  arr.splice(di < ti ? tgt + 1 : tgt, 0, item); // táhnu dolů → za cíl, nahoru → před cíl
}

function renderList() {
  const el = $('#list');
  const mobileHead = `<button class="icon-btn menu-btn" data-action="open-nav" aria-label="Menu">${ICONS.menu}</button>`;

  if (ui.view === 'inbox') {
    const tasks = orderManual(state.tasks.filter((t) => t.projectId == null));
    el.innerHTML = `
      <header class="list-head">${mobileHead}<h1>Nezařazené</h1>${doneToggle()}</header>
      <label class="ghost-row"><span class="ghost-plus">${ICONS.taskNew}</span><input class="ghost-input add-task" data-enter="add-task" data-jira=""
        placeholder="Rychlý úkol   (např. Zavolat Petrovi !zítra)" aria-label="Nový úkol"></label>
      ${tasks.length
        ? `<ul class="tasks">${tasks.map((t) => taskRow(t, { drag: true })).join('')}</ul>`
        : `<p class="empty">Nic nezařazeného. Sem si hoď úkol a projekt či JIRA task mu přiřaď později v detailu.</p>`}
    `;
    return;
  }

  if (ui.view === 'today' || ui.view === 'upcoming') {
    const today = dateStr(new Date());
    const filter = ui.view === 'today' ? (t) => t.due && t.due <= today : (t) => t.due;
    const tasks = sortTasks(visible(state.tasks.filter(filter)));
    el.innerHTML = `
      <header class="list-head">${mobileHead}<h1>${ui.view === 'today' ? 'Dnes' : 'Naplánované'}</h1>${doneToggle()}</header>
      ${tasks.length
        ? `<ul class="tasks">${tasks.map((t) => taskRow(t, { showContext: true })).join('')}</ul>`
        : `<p class="empty">${ui.view === 'today' ? 'Na dnešek nic. Pěkný den.' : 'Žádné úkoly s termínem.'}</p>`}
    `;
    return;
  }

  const p = project(ui.projectId);
  if (!p) {
    el.innerHTML = `<header class="list-head">${mobileHead}<h1>Úkoly</h1></header><p class="empty">Vyber nebo založ projekt.</p>`;
    return;
  }

  const jiras = state.jiras.filter((j) => j.projectId === p.id);
  const loose = state.tasks.filter((t) => t.projectId === p.id && !t.jiraId);

  const group = (j) => {
    const tasks = orderManual(state.tasks.filter((t) => t.jiraId === (j ? j.id : null) && t.projectId === p.id));
    return `
      <section class="group">
        <header class="group-head"${j ? ` draggable="true" data-drag="jira" data-id="${j.id}"` : ''}>
          ${j
            ? `${j.cid ? `<span class="cid" title="CID pro vykazování">${esc(j.cid)}</span>` : ''}<span class="group-title">${linkifyJira(j.name, p.jiraBaseUrl || state.settings.jiraBaseUrl)}</span>
               ${j.confluenceUrl ? `<a class="icon-btn small" href="${esc(j.confluenceUrl)}" target="_blank" rel="noopener" draggable="false" title="Confluence">${ICONS.doc}</a>` : ''}
               <button class="icon-btn small" data-action="edit-jira" data-id="${j.id}" title="Upravit" aria-label="Upravit JIRA task">${ICONS.dots}</button>`
            : `<span class="group-title muted">Bez JIRA tasku</span>`}
        </header>
        <ul class="tasks">${tasks.map((t) => taskRow(t, { drag: true })).join('')}</ul>
        <label class="ghost-row"><span class="ghost-plus">${ICONS.taskNew}</span><input class="ghost-input add-task" data-enter="add-task" data-jira="${j ? j.id : ''}"
          placeholder="Úkol   (např. Připravit podklady !pá 14:00)" aria-label="Nový úkol"></label>
      </section>`;
  };

  el.innerHTML = `
    <header class="list-head">
      ${mobileHead}
      <h1>${esc(p.name)}</h1>
      ${doneToggle()}
      <button class="icon-btn" data-action="edit-project" title="Upravit projekt" aria-label="Upravit projekt">${ICONS.dots}</button>
    </header>
    ${jiras.map(group).join('')}
    ${loose.length || !jiras.length ? group(null) : ''}
    <label class="ghost-row jira-row"><span class="ghost-plus">${ICONS.ticket}</span><input class="ghost-input add-jira" data-enter="add-jira"
      placeholder="${p.jiraPrefix ? 'Číslo tasku  (volitelně CID před číslo)' : 'JIRA task'}" aria-label="Nový JIRA task"></label>
  `;
}

function doneToggle() {
  return `<button class="text-btn" data-action="toggle-show-done">${ui.showDone ? 'Skrýt hotové' : 'Zobrazit hotové'}</button>`;
}

function renderDetail() {
  const el = $('#detail');
  const t = task(ui.taskId);
  if (!t) { el.innerHTML = ''; return; }
  const jiras = state.jiras.filter((j) => j.projectId === t.projectId);
  const p = project(t.projectId);
  const tj = jira(t.jiraId);
  const base = projectBase(t.projectId);
  const links = [
    ...(tj ? tj.name.match(JIRA_KEYS) || [] : []).map((key) => ({ label: key, url: jiraUrl(key, base) })),
    ...(tj && tj.confluenceUrl ? [{ label: 'Confluence', url: tj.confluenceUrl }] : []),
  ];

  el.innerHTML = `
    <header class="detail-head">
      <span class="crumb">${esc(p ? p.name : '')}</span>
      <button class="icon-btn" data-action="close-detail" title="Zavřít" aria-label="Zavřít">${ICONS.close}</button>
    </header>
    <div class="detail-title">
      <button class="check ${t.done ? 'on' : ''}" data-action="toggle-task" data-id="${t.id}" aria-label="Hotovo">${ICONS.check}</button>
      <textarea class="title-input" data-field="title" rows="1" aria-label="Název">${esc(t.title)}</textarea>
    </div>

    <label class="field">
      <span>Projekt</span>
      <select data-field="projectId">
        <option value="">— nezařazeno —</option>
        ${state.projects.map((pr) => `<option value="${pr.id}" ${pr.id === t.projectId ? 'selected' : ''}>${esc(pr.name)}</option>`).join('')}
      </select>
    </label>
    <label class="field ${p ? '' : 'disabled'}">
      <span>JIRA task</span>
      <select data-field="jiraId" ${p ? '' : 'disabled'}>
        <option value="">— bez JIRA —</option>
        ${jiras.map((j) => `<option value="${j.id}" ${j.id === t.jiraId ? 'selected' : ''}>${esc((j.cid ? j.cid + ' ' : '') + j.name)}</option>`).join('')}
      </select>
    </label>
    ${links.length ? `
      <div class="link-row">
        ${links.map((l) => l.url
          ? `<a class="btn small-btn" href="${esc(l.url)}" target="_blank" rel="noopener">${ICONS.external}<span>${esc(l.label)}</span></a>`
          : `<button class="btn small-btn" data-action="settings" title="Nejdřív nastav adresu JIRA">${ICONS.external}<span>${esc(l.label)}</span></button>`).join('')}
      </div>` : ''}

    <div class="field-row">
      <label class="field"><span>Termín</span>
        <span class="date-field">
          <input type="text" class="date-text" data-field="dueText" value="${t.due ? fmtDMY(t.due) : ''}" placeholder="DD/MM/RRRR" inputmode="numeric" autocomplete="off">
          <button type="button" class="icon-btn small" data-action="pick-date" aria-label="Vybrat z kalendáře" title="Vybrat z kalendáře"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg></button>
          <input type="date" class="date-native" data-field="due" value="${esc(t.due)}" tabindex="-1" aria-hidden="true">
        </span>
      </label>
      <label class="field"><span>Čas</span><input type="time" data-field="time" value="${esc(t.time)}" ${t.due ? '' : 'disabled'}></label>
    </div>
    <label class="switch ${t.due ? '' : 'disabled'}">
      <input type="checkbox" data-field="remind" ${t.remind ? 'checked' : ''} ${t.due ? '' : 'disabled'}>
      <span>Upozornit v termínu${t.time ? '' : ' (bez času v 9:00)'}</span>
    </label>

    <div class="field">
      <span>Checklist</span>
      <ul class="checklist">
        ${t.checklist.map((c) => `
          <li class="${c.done ? 'done' : ''}">
            <button class="check small ${c.done ? 'on' : ''}" data-action="toggle-item" data-id="${c.id}" aria-label="Hotovo">${ICONS.check}</button>
            <input class="item-input" data-item="${c.id}" value="${esc(c.text)}" aria-label="Položka">
            <button class="icon-btn small" data-action="delete-item" data-id="${c.id}" aria-label="Smazat položku">${ICONS.close}</button>
          </li>`).join('')}
      </ul>
      <label class="ghost-row"><span class="ghost-plus">${ICONS.itemNew}</span><input class="ghost-input" data-enter="add-item" placeholder="Položka" aria-label="Nová položka"></label>
    </div>

    <label class="field">
      <span>Poznámka</span>
      <textarea data-field="notes" rows="4" placeholder="…">${esc(t.notes)}</textarea>
    </label>

    <footer class="detail-foot">
      <span class="muted small">Vytvořeno ${new Date(t.createdAt).toLocaleDateString('cs-CZ')}</span>
      <button class="text-btn danger" data-action="delete-task">Smazat úkol</button>
    </footer>
  `;
  autosize(el.querySelector('.title-input'));
}

function autosize(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function renderSettings() {
  const dlg = $('#settings');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const permLabel = { granted: 'povoleno', denied: 'zablokováno v prohlížeči', default: 'zatím nepovoleno', unsupported: 'prohlížeč nepodporuje' }[perm];
  dlg.innerHTML = `
    <form method="dialog" class="settings-body">
      <h2>Nastavení</h2>
      <label class="field">
        <span>Adresa JIRA (pro odkazy)</span>
        <input data-setting="jiraBaseUrl" value="${esc(state.settings.jiraBaseUrl)}" placeholder="https://support.trask.cz">
      </label>
      <p class="hint">Výchozí adresa pro všechny projekty (jen server, bez cesty k dashboardu). Jednotlivý projekt může mít přes „…“ vlastní adresu – třeba MPO na support.trask.cz a jiný projekt na jira.skoda.vwgroup.com. JIRA klíče se otevřou v okně vpravo; přihlašuješ se tam přímo v JIRA jako obvykle a aplikace k přihlášení nemá přístup.</p>

      <div class="field">
        <span>Upozornění: ${permLabel}</span>
        ${perm === 'default' ? '<button type="button" class="btn" data-action="ask-notify">Povolit upozornění</button>' : ''}
        ${perm === 'granted' ? '<button type="button" class="btn" data-action="test-notify">Vyzkoušet</button>' : ''}
      </div>
      <p class="hint">V prototypu chodí upozornění jen když je aplikace otevřená (stačí na pozadí). Spolehlivé doručení i do iPhonu a hodinek bude vyžadovat server s Web Push.</p>

      <div class="field">
        <span>Synchronizace (Supabase, šifrovaně)</span>
        ${!syncStatus.ready
          ? '<p class="hint">Připojuji…</p>'
          : syncStatus.configured === false
            ? '<p class="hint">Synchronizace není nastavená – chybí klíč Supabase v <code>sync.js</code>.</p>'
            : !syncStatus.signedIn
              ? `<div class="btn-row">
                   <input id="sync-email" type="email" placeholder="e-mail" style="flex:1" autocomplete="username">
                 </div>
                 <div class="btn-row">
                   <input id="sync-pw" type="password" placeholder="heslo" style="flex:1" autocomplete="current-password">
                   <button type="button" class="btn primary" data-action="sync-signin">Přihlásit se</button>
                 </div>
                 <p class="hint">Poprvé tady? <button type="button" class="btn" data-action="sync-signup">Vytvořit účet</button> &nbsp;·&nbsp; zapomenuté heslo <button type="button" class="btn" data-action="sync-magic">Přihlásit odkazem</button>${syncStatus.signupInfo === 'confirm' ? ' <strong>Účet založen – potvrď e-mail a pak se přihlas heslem.</strong>' : ''}${syncStatus.linkSent ? ' <strong>Odkaz odeslán – mrkni do e-mailu.</strong>' : ''}${syncStatus.error ? ' <span class="field-error" style="display:inline">Chyba: ' + esc(syncStatus.error) + '</span>' : ''}</p>`
              : !syncStatus.hasPass
                ? `<div class="btn-row">
                     <input id="sync-pass" type="password" placeholder="šifrovací passfráze" style="flex:1">
                     <button type="button" class="btn primary" data-action="sync-pass">Uložit</button>
                     <button type="button" class="btn" data-action="sync-signout">Odhlásit</button>
                   </div>
                   <p class="hint">Přihlášen: ${esc(syncStatus.user || '')}. Zadej <strong>šifrovací passfrázi</strong> – tou se data šifrují přímo v tomto prohlížeči (Supabase vidí jen šifru). Na všech zařízeních použij <strong>stejnou</strong>. Zapiš si ji – nejde obnovit.${syncStatus.error ? ' Chyba: ' + esc(syncStatus.error) : ''}</p>`
                : `<div class="btn-row">
                     <button type="button" class="btn" data-action="sync-now">Synchronizovat teď</button>
                     <button type="button" class="btn" data-action="sync-signout">Odhlásit</button>
                   </div>
                   <p class="hint">Přihlášen: ${esc(syncStatus.user || '')} · šifrováno${syncStatus.lastSync ? ' · naposledy ' + new Date(syncStatus.lastSync).toLocaleTimeString('cs-CZ') : ''}${syncStatus.error ? ` · <span class="field-error" style="display:inline">${esc(syncStatus.error)}</span>` : ''}</p>
                   <div class="btn-row">
                     <input id="sync-newpw" type="password" placeholder="nastavit přihlašovací heslo" style="flex:1" autocomplete="new-password">
                     <button type="button" class="btn" data-action="sync-setpw">Uložit heslo</button>
                   </div>
                   <p class="hint">${syncStatus.passwordSet ? '<strong>Heslo uloženo.</strong> ' : ''}Tímhle heslem se pak přihlásíš na dalších zařízeních (e-mail + heslo).</p>`}
      </div>

      <div class="field">
        <span>Data</span>
        <div class="btn-row">
          <button type="button" class="btn" data-action="export">Export JSON</button>
          <button type="button" class="btn" data-action="import">Import JSON</button>
        </div>
      </div>
      <p class="hint">Ruční záloha. Když je zapnutá synchronizace, data jsou (zašifrovaná) i na Supabase; jinak zůstávají jen v tomto prohlížeči.</p>

      <div class="btn-row end"><button class="btn primary">Hotovo</button></div>
    </form>`;
}

// Zakládání projektu ve vlastním okně (odolné proti odskoku na JIRA i blokaci prompt oken)
function projectNameExists(name, exceptId) {
  const n = name.trim().toLowerCase();
  return state.projects.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === n);
}

function openProjectDialog(name, editId) {
  const editing = !!editId;
  const p = editing ? project(editId) : null;
  const dlg = $('#project');
  dlg.innerHTML = `
    <form method="dialog" class="settings-body" id="project-form">
      <h2>${editing ? 'Upravit projekt' : 'Nový projekt'}</h2>
      <label class="field"><span>Název</span><input id="pf-name" value="${esc(editing ? p.name : (name || ''))}" autocomplete="off"></label>
      <p class="field-error" id="pf-error" hidden></p>
      <label class="field"><span>Adresa JIRA (volitelné)</span>
        <input id="pf-base" value="${esc(editing ? (p.jiraBaseUrl || '') : '')}" placeholder="${esc(state.settings.jiraBaseUrl || 'https://...')}" autocomplete="off"></label>
      <p class="hint">Prázdné = použije se globální adresa z Nastavení. Klidně si ji zkopíruj z JIRA, okno zůstane otevřené.</p>
      <label class="field"><span>Předpona klíče (volitelné)</span>
        <input id="pf-prefix" value="${esc(editing ? (p.jiraPrefix || '') : '')}" placeholder="např. SMPOESB" autocomplete="off"></label>
      <p class="hint">Když ji vyplníš, stačí pak u JIRA tasku psát jen číslo.</p>
      <div class="btn-row ${editing ? 'between' : 'end'}">
        ${editing ? '<button type="button" class="text-btn danger" data-action="delete-project">Smazat projekt</button>' : ''}
        <span class="btn-group">
          <button type="button" class="btn" data-action="close-project">Zrušit</button>
          <button type="submit" class="btn primary">${editing ? 'Uložit' : 'Vytvořit'}</button>
        </span>
      </div>
    </form>`;
  dlg.showModal();
  $('#pf-name').focus();
  $('#project-form').onsubmit = (e) => {
    const nm = $('#pf-name').value.trim();
    const err = $('#pf-error');
    if (!nm) { e.preventDefault(); err.textContent = 'Zadej název projektu.'; err.hidden = false; $('#pf-name').focus(); return; }
    if (projectNameExists(nm, editId)) {
      e.preventDefault();
      err.textContent = `Projekt „${nm}“ už existuje. Zvol jiný název.`;
      err.hidden = false; $('#pf-name').focus();
      return;
    }
    const base = $('#pf-base').value.trim();
    const prefix = $('#pf-prefix').value.trim();
    const target = editing ? p : { id: uid(), name: nm };
    target.name = nm;
    target.jiraBaseUrl = /^https?:\/\//i.test(base) ? normalizeBase(base) : '';
    target.jiraPrefix = prefix;
    if (!editing) { state.projects.push(target); ui.view = 'project'; ui.projectId = target.id; ui.taskId = null; }
    save(); render(); // dialog se zavře díky method="dialog"
  };
}

function openJiraDialog(editId) {
  const j = jira(editId);
  if (!j) return;
  const n = state.tasks.filter((t) => t.jiraId === j.id).length;
  const dlg = $('#project');
  dlg.innerHTML = `
    <form method="dialog" class="settings-body" id="jira-form">
      <h2>Upravit JIRA task</h2>
      <label class="field"><span>Název / klíč</span><input id="jf-name" value="${esc(j.name)}" autocomplete="off"></label>
      <p class="hint">Volný text. JIRA klíč (např. SMPOESB-300) se stane odkazem do JIRA.</p>
      <p class="field-error" id="jf-error" hidden></p>
      <label class="field"><span>CID pro vykazování (volitelné)</span><input id="jf-cid" value="${esc(j.cid || '')}" autocomplete="off"></label>
      <p class="hint">Zobrazí se před JIRA klíčem, nikam neodkazuje.</p>
      <label class="field"><span>Odkaz na Confluence (volitelné)</span><input id="jf-conf" value="${esc(j.confluenceUrl || '')}" placeholder="https://..." autocomplete="off"></label>
      <div class="btn-row between">
        <button type="button" class="text-btn danger" data-action="delete-jira" data-id="${j.id}">Smazat JIRA task</button>
        <span class="btn-group">
          <button type="button" class="btn" data-action="close-project">Zrušit</button>
          <button type="submit" class="btn primary">Uložit</button>
        </span>
      </div>
    </form>`;
  dlg.showModal();
  $('#jf-name').focus();
  $('#jira-form').onsubmit = (e) => {
    const nm = $('#jf-name').value.trim();
    const err = $('#jf-error');
    if (!nm) {
      e.preventDefault();
      err.textContent = n ? `Zadej název, nebo task smaž tlačítkem vlevo (${n} úkolů se přesune do „Bez JIRA tasku“).` : 'Zadej název, nebo task smaž tlačítkem vlevo.';
      err.hidden = false; $('#jf-name').focus();
      return;
    }
    j.name = nm;
    j.cid = $('#jf-cid').value.trim();
    const conf = $('#jf-conf').value.trim();
    j.confluenceUrl = /^https?:\/\//i.test(conf) ? conf : '';
    save(); render(); // dialog se zavře díky method="dialog"
  };
}

function confirmDialog(message, confirmLabel, onConfirm) {
  const dlg = $('#confirm');
  dlg.innerHTML = `
    <form method="dialog" class="settings-body" id="confirm-form">
      <p class="confirm-msg">${esc(message)}</p>
      <div class="btn-row end">
        <button type="button" class="btn" data-action="close-confirm">Zrušit</button>
        <button type="submit" class="btn primary danger">${esc(confirmLabel)}</button>
      </div>
    </form>`;
  dlg.showModal();
  $('#confirm-form').onsubmit = () => { onConfirm(); }; // dialog se zavře díky method="dialog"
}

function alertDialog(message) {
  const dlg = $('#confirm');
  dlg.innerHTML = `
    <form method="dialog" class="settings-body">
      <p class="confirm-msg">${esc(message)}</p>
      <div class="btn-row end"><button type="submit" class="btn primary">OK</button></div>
    </form>`;
  dlg.showModal();
}

// ---------- Upozornění ----------

async function notify(title, body, taskId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, tag: taskId || 'test', data: { taskId }, icon: 'icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, opts);
  } catch (e) { /* fallback níže */ }
  new Notification(title, opts);
}

function checkReminders() {
  const now = new Date();
  let changed = false;
  for (const t of state.tasks) {
    if (t.done || !t.remind || !t.due || t.notified) continue;
    const at = new Date(`${t.due}T${t.time || '09:00'}`);
    if (at <= now) {
      const j = jira(t.jiraId);
      const p = project(t.projectId);
      notify(t.title, [p && p.name, j && j.name].filter(Boolean).join(' · ') || 'Termín úkolu', t.id);
      t.notified = true;
      changed = true;
    }
  }
  if (changed) { save(); render(); }
}

// ---------- Akce ----------

function selectTask(id) {
  ui.taskId = id;
  document.body.classList.remove('nav-open');
  render();
}

const actions = {
  nav(el) {
    ui.view = el.dataset.view;
    ui.projectId = el.dataset.id || null;
    ui.taskId = null;
    document.body.classList.remove('nav-open');
    render();
  },
  'open-nav'() { document.body.classList.add('nav-open'); },
  'close-nav'() { document.body.classList.remove('nav-open'); },
  'open-task'(el) { selectTask(el.dataset.id); },
  'close-detail'() { ui.taskId = null; render(); },
  'toggle-task'(el) {
    const t = task(el.dataset.id);
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    save(); render();
  },
  'toggle-show-done'() { ui.showDone = !ui.showDone; render(); },
  'toggle-item'(el) {
    const c = task(ui.taskId).checklist.find((c) => c.id === el.dataset.id);
    c.done = !c.done;
    save(); render();
  },
  'delete-item'(el) {
    const t = task(ui.taskId);
    t.checklist = t.checklist.filter((c) => c.id !== el.dataset.id);
    save(); render();
  },
  'delete-task'() {
    const t = task(ui.taskId);
    confirmDialog(`Smazat úkol „${t.title}”?`, 'Smazat', () => {
      state.tasks = state.tasks.filter((x) => x.id !== t.id);
      ui.taskId = null;
      save(); render();
    });
  },
  'edit-project'() { openProjectDialog(null, ui.projectId); },
  'delete-project'() {
    const p = project(ui.projectId);
    confirmDialog(`Smazat projekt „${p.name}” včetně všech JIRA tasků a úkolů?`, 'Smazat', () => {
      state.projects = state.projects.filter((x) => x.id !== p.id);
      state.jiras = state.jiras.filter((j) => j.projectId !== p.id);
      state.tasks = state.tasks.filter((t) => t.projectId !== p.id);
      ui.view = 'today'; ui.projectId = null; ui.taskId = null;
      $('#project').close();
      save(); render();
    });
  },
  'edit-jira'(el) { openJiraDialog(el.dataset.id); },
  'delete-jira'(el) {
    const j = jira(el.dataset.id);
    if (!j) return;
    state.tasks.forEach((t) => { if (t.jiraId === j.id) t.jiraId = null; });
    state.jiras = state.jiras.filter((x) => x.id !== j.id);
    $('#project').close();
    save(); render();
  },
  'close-project'() { $('#project').close(); },
  'close-confirm'() { $('#confirm').close(); },
  'pick-date'() {
    const n = $('.date-native');
    if (!n) return;
    if (n.showPicker) { try { n.showPicker(); return; } catch (e) {} }
    n.focus();
  },
  settings() { renderSettings(); $('#settings').showModal(); },
  'sync-signin'() {
    const mail = ($('#sync-email') || {}).value, pw = ($('#sync-pw') || {}).value;
    if (!mail || !mail.trim() || !pw || !window.Sync) return;
    Sync.signInPassword(mail.trim(), pw).then(() => renderSettings()).catch(() => renderSettings());
  },
  'sync-signup'() {
    const mail = ($('#sync-email') || {}).value, pw = ($('#sync-pw') || {}).value;
    if (!mail || !mail.trim() || !pw || !window.Sync) return;
    Sync.signUp(mail.trim(), pw).then(() => renderSettings()).catch(() => renderSettings());
  },
  'sync-magic'() {
    const mail = ($('#sync-email') || {}).value;
    if (!mail || !mail.trim() || !window.Sync) return;
    Sync.signInMagic(mail.trim()).then(() => renderSettings()).catch(() => renderSettings());
  },
  'sync-setpw'() {
    const pw = ($('#sync-newpw') || {}).value;
    if (!pw || !window.Sync) return;
    Sync.setLoginPassword(pw).then(() => renderSettings()).catch(() => renderSettings());
  },
  'sync-pass'() {
    const el = $('#sync-pass');
    const p = el && el.value;
    if (!p || !window.Sync) return;
    Sync.setPassphrase(p);
    renderSettings();
  },
  'sync-signout'() { if (window.Sync) Sync.signOut(); },
  'sync-now'() { if (window.Sync) Sync.syncNow(); },
  async 'ask-notify'() { await Notification.requestPermission(); renderSettings(); },
  'test-notify'() { notify('Úkoly', 'Upozornění fungují.'); },
  export() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ukoly-${dateStr(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  import() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      let data;
      try {
        data = JSON.parse(await input.files[0].text());
        if (!Array.isArray(data.projects) || !Array.isArray(data.tasks)) throw new Error('Neplatný soubor');
      } catch (e) { alertDialog('Import selhal: ' + e.message); return; }
      confirmDialog('Import přepíše všechna současná data. Pokračovat?', 'Přepsat', () => {
        state = migrate({ ...emptyState(), ...data });
        ui = { view: 'today', projectId: null, taskId: null, showDone: false };
        save(); render(); renderSettings();
      });
    };
    input.click();
  },
};

const enterActions = {
  'add-project'(value) {
    openProjectDialog(value);
    return false; // samotné vytvoření proběhne až po potvrzení okna
  },
  'add-jira'(value) {
    const p = project(ui.projectId);
    // vložená adresa na issue -> uloží se jen klíč
    const urlKey = keyFromUrl(value);
    if (urlKey) { state.jiras.push({ id: uid(), projectId: ui.projectId, cid: '', name: urlKey, confluenceUrl: '' }); return; }
    let cid = '', rest = value;
    // s nastavenou předponou lze napsat „CID číslo …“ – první slovo (ne číslo) je CID
    const m = p && p.jiraPrefix && value.match(/^(\S+)\s+(\d.*)$/);
    if (m && !/^\d/.test(m[1])) { cid = m[1]; rest = m[2]; }
    // když zbytek začíná číslem, doplní se předpona klíče
    const name = (p && p.jiraPrefix && /^\d/.test(rest)) ? prefixDash(p.jiraPrefix) + rest : rest;
    state.jiras.push({ id: uid(), projectId: ui.projectId, cid, name, confluenceUrl: '' });
  },
  'add-task'(value, el) {
    const q = parseQuick(value);
    if (!q.title) return false;
    state.tasks.push(newTask({ projectId: ui.projectId, jiraId: el.dataset.jira || null, ...q }));
  },
  'add-item'(value) {
    task(ui.taskId).checklist.push({ id: uid(), text: value, done: false });
  },
};

document.addEventListener('click', (e) => {
  // klik syntetizovaný hned po dotykovém tažení zahoď (ať se neotevře detail)
  if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  // klik na checkbox v řádku nesmí zároveň otevřít detail
  e.stopPropagation();
  e.preventDefault();
  actions[el.dataset.action](el);
}, true);

// ---------- Přesouvání pořadí (drag & drop) ----------

let dragItem = null; // { type: 'project' | 'jira' | 'task', id }

function clearDragMarks() {
  document.querySelectorAll('.dragging, .drag-over').forEach((n) => n.classList.remove('dragging', 'drag-over'));
}

// Sdílené pro myš (HTML5 DnD) i dotyk: přesun položky na pozici cíle
function applyReorder(type, dragId, targetId) {
  if (!dragId || !targetId || dragId === targetId) return false;
  if (type === 'project') reorder(state.projects, dragId, targetId);
  else if (type === 'jira') reorder(state.jiras, dragId, targetId);
  else if (type === 'task') {
    const d = task(dragId), tgt = task(targetId);
    if (!d || !tgt) return false;
    d.projectId = tgt.projectId; d.jiraId = tgt.jiraId; // přetažení do jiné skupiny ho přeřadí
    reorder(state.tasks, dragId, targetId);
  } else return false;
  return true;
}

document.addEventListener('dragstart', (e) => {
  const el = e.target.closest('[data-drag]');
  if (!el) return;
  dragItem = { type: el.dataset.drag, id: el.dataset.id };
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', el.dataset.id); } catch (_) { /* Firefox vyžaduje data */ }
});

document.addEventListener('dragover', (e) => {
  if (!dragItem) return;
  const el = e.target.closest(`[data-drag="${dragItem.type}"]`);
  if (!el || el.dataset.id === dragItem.id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
  el.classList.add('drag-over');
});

document.addEventListener('drop', (e) => {
  if (!dragItem) return;
  const el = e.target.closest(`[data-drag="${dragItem.type}"]`);
  if (!el || el.dataset.id === dragItem.id) { clearDragMarks(); return; }
  e.preventDefault();
  const changed = applyReorder(dragItem.type, dragItem.id, el.dataset.id);
  dragItem = null;
  if (changed) { save(); render(); } else clearDragMarks();
});

document.addEventListener('dragend', () => { dragItem = null; clearDragMarks(); });

// ---------- Přesouvání na dotyk (mobil) ----------
// HTML5 DnD na dotyku nefunguje → podržením prstu se položka „zvedne“ a tažením přesune.
let touchDrag = null;
let suppressClick = false;
const LONG_PRESS_MS = 300, TOUCH_CANCEL_PX = 10;

document.addEventListener('touchstart', (e) => {
  if (touchDrag || e.touches.length !== 1) return;
  const el = e.target.closest('[data-drag]');
  if (!el) return;
  const t = e.touches[0];
  touchDrag = { type: el.dataset.drag, id: el.dataset.id, el, x: t.clientX, y: t.clientY, started: false, target: null, timer: 0 };
  touchDrag.timer = setTimeout(() => {
    if (!touchDrag) return;
    touchDrag.started = true;
    el.classList.add('dragging');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
  }, LONG_PRESS_MS);
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!touchDrag) return;
  const t = e.touches[0];
  if (!touchDrag.started) {
    // pohyb před podržením = scroll/ťuknutí, drag zrušíme
    if (Math.abs(t.clientX - touchDrag.x) > TOUCH_CANCEL_PX || Math.abs(t.clientY - touchDrag.y) > TOUCH_CANCEL_PX) {
      clearTimeout(touchDrag.timer); touchDrag = null;
    }
    return;
  }
  e.preventDefault(); // zvednuto → táhneme, blokuj scrollování
  const under = document.elementFromPoint(t.clientX, t.clientY);
  const tgt = under && under.closest(`[data-drag="${touchDrag.type}"]`);
  document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
  if (tgt && tgt.dataset.id !== touchDrag.id) { tgt.classList.add('drag-over'); touchDrag.target = tgt.dataset.id; }
  else touchDrag.target = null;
}, { passive: false });

document.addEventListener('touchend', (e) => {
  if (!touchDrag) return;
  clearTimeout(touchDrag.timer);
  const { started, type, id, target } = touchDrag;
  touchDrag = null;
  clearDragMarks();
  if (!started) return; // bylo to ťuknutí → necháme proběhnout klik
  e.preventDefault(); // potlač syntetický klik po tažení (neotvírej detail)
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 400);
  if (target && applyReorder(type, id, target)) { save(); render(); }
}, { passive: false });

document.addEventListener('touchcancel', () => {
  if (!touchDrag) return;
  clearTimeout(touchDrag.timer); touchDrag = null; clearDragMarks();
}, { passive: true });

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key === 'Enter' && el.id && el.id.indexOf('sync-') === 0) {
    e.preventDefault(); // neodesílej formulář nastavení
    if (el.id === 'sync-pass') actions['sync-pass']();
    else if (el.id === 'sync-newpw') actions['sync-setpw']();
    else actions['sync-signin'](); // sync-email / sync-pw
    return;
  }
  if (e.key === 'Enter' && el.dataset.enter && !e.isComposing) {
    const value = el.value.trim();
    if (!value) return;
    const keepFocus = el.dataset.enter;
    const jiraAttr = el.dataset.jira;
    if (enterActions[el.dataset.enter](value, el) === false) return;
    save(); render();
    // po renderu vrátit fokus do stejného pole pro rychlé zadávání dalších položek
    const sel = `[data-enter="${keepFocus}"]` + (jiraAttr !== undefined ? `[data-jira="${jiraAttr}"]` : '');
    document.querySelector(sel)?.focus();
    return;
  }
  if (e.key === 'Enter' && el.dataset.field === 'title') { e.preventDefault(); el.blur(); return; }
  if (e.key === 'Escape' && !$('#settings').open) {
    if (document.body.classList.contains('nav-open')) document.body.classList.remove('nav-open');
    else if (ui.taskId) { ui.taskId = null; render(); }
  }
});

// Úpravy v detailu: ukládají se průběžně, překreslí se jen seznam (aby se neztratil fokus)
document.addEventListener('input', (e) => {
  const el = e.target;
  const t = task(ui.taskId);
  if (el.dataset.setting) {
    state.settings[el.dataset.setting] = el.value.trim();
    save(); renderList();
    return;
  }
  if (!t) return;
  if (el.dataset.item) {
    const c = t.checklist.find((c) => c.id === el.dataset.item);
    if (c) c.text = el.value;
    save(); renderList();
    return;
  }
  const f = el.dataset.field;
  if (!f) return;
  if (f === 'title') { t.title = el.value.replace(/\n/g, ' '); autosize(el); }
  else if (f === 'notes') t.notes = el.value;
  else return;
  save(); renderList();
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.setting === 'jiraBaseUrl') {
    state.settings.jiraBaseUrl = normalizeBase(el.value);
    el.value = state.settings.jiraBaseUrl;
    save(); renderList();
    return;
  }
  const t = task(ui.taskId);
  const f = el.dataset.field;
  if (!t || !f || f === 'notes') return;
  if (f === 'title') {
    // Po úpravě názvu znovu rozpoznej termín z koncového !tokenu (např. !pozítří, !pondělí)
    const q = parseQuick(t.title);
    if (q.due) { t.title = q.title; t.due = q.due; if (q.time) t.time = q.time; t.notified = false; save(); render(); checkReminders(); }
    return;
  }
  if (f === 'dueText') {
    t.due = parseDMY(el.value) || '';
    if (!t.due) { t.time = ''; t.remind = false; }
    t.notified = false;
    save(); render(); checkReminders();
    return;
  }
  if (f === 'remind') t.remind = el.checked;
  else if (f === 'projectId') { t.projectId = el.value || null; if (jira(t.jiraId) && jira(t.jiraId).projectId !== t.projectId) t.jiraId = null; }
  else if (f === 'jiraId') t.jiraId = el.value || null;
  else {
    t[f] = el.value;
    if (f === 'due' && !t.due) { t.time = ''; t.remind = false; }
    // termín se změnil → upozornit znovu
    t.notified = false;
  }
  save(); render();
  checkReminders();
});

// ---------- Ikony ----------

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICONS = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  dots: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 'class="nav-icon"'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>', 'class="nav-icon"'),
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>', 'class="nav-icon"'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>'),
  doc: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  plus: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8.5v7M8.5 12h7"/>'),
  folderNew: svg('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h3.8l1.8 1.8h8.9A1.5 1.5 0 0 1 20.5 9.3V18a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 18z"/>'),
  taskNew: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.6 12.3l2.4 2.4 4.4-4.9"/>'),
  ticket: svg('<path d="M20.6 12.9l-7.7 7.7a1.8 1.8 0 0 1-2.5 0l-6-6a1.8 1.8 0 0 1-.5-1.3V5.6A1.6 1.6 0 0 1 5.5 4h7.1a1.8 1.8 0 0 1 1.3.5l6.9 6.9a1.8 1.8 0 0 1 0 1.5z"/><circle cx="8.2" cy="8.2" r="1.2"/>'),
  itemNew: svg('<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M8.6 12l2.3 2.3L15.4 9.5"/>'),
};

// ---------- Start ----------

if (!state.projects.length) ui.view = 'today';
else if (!state.tasks.some((t) => t.due)) { ui.view = 'project'; ui.projectId = state.projects[0].id; }

const hashTask = location.hash.match(/task=([\w-]+)/);
if (hashTask && task(hashTask[1])) {
  const t = task(hashTask[1]);
  ui.view = 'project'; ui.projectId = t.projectId; ui.taskId = t.id;
  history.replaceState(null, '', location.pathname);
}

persist(); // zapiš případnou migraci starých dat zpět (bez změny času – ať se nerozbije synchro)
render();
checkReminders();
setInterval(checkReminders, 30000);
setInterval(renderList, 60000); // přepočet „po termínu“

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registrace selhala', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open-task' && task(e.data.taskId)) {
      const t = task(e.data.taskId);
      ui.view = 'project'; ui.projectId = t.projectId;
      selectTask(t.id);
    }
  });
}

// ---------- Synchronizace (Supabase, E2E šifrovaně) ----------

if (window.Sync) {
  Sync.init({
    getState: () => state,
    onRemote: applyRemote,
    onStatus: (s) => { syncStatus = s; if ($('#settings').open) renderSettings(); },
  });
  // při návratu k aplikaci natáhni poslední stav z cloudu
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Sync.isOn()) Sync.syncNow(); });
  window.addEventListener('focus', () => { if (Sync.isOn()) Sync.syncNow(); });
}
