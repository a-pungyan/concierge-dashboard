'use strict';

/* ============================================================
   Concierge Dashboard — single-user prototype.
   Records persist in localStorage (this browser only).
   ============================================================ */

const STORAGE_KEY = 'concierge-dashboard:v1';
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Storage ---------- */

/* Shift logs, follow-ups, notices and resources live in Supabase (shared by the team).
   They are held in state while signed in but never written to browser storage. The browser
   keeps only each person's pinned resources, plus any follow-ups/resources that older
   versions stored locally (legacyFollowups / legacyResources) until they are copied to
   Supabase or discarded. */

const asList = (v) => (Array.isArray(v) ? v : []);

function normalize(d) {
  return {
    version: 1,
    logs: [],
    followups: [],
    notices: [],
    resources: [],
    pins: asList(d.pins),
    legacyFollowups: Array.isArray(d.legacyFollowups) ? d.legacyFollowups : asList(d.followups),
    legacyResources: Array.isArray(d.legacyResources) ? d.legacyResources : asList(d.resources),
  };
}

const localPart = (s) => ({ version: 1, pins: s.pins, legacyFollowups: s.legacyFollowups, legacyResources: s.legacyResources });

let state = loadState();

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    queueMicrotask(() => toast('Browser storage is unavailable, so pinned resources will not be remembered.', 'error'));
    return normalize({});
  }
  if (!raw) return normalize({});
  try {
    const parsed = JSON.parse(raw);
    const loaded = normalize(parsed);
    // Older versions stored shared data here; rewrite in the current shape.
    if (['logs', 'notices', 'resources', 'followups'].some((k) => k in parsed)) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localPart(loaded))); } catch (_) { /* ignore */ }
    }
    return loaded;
  } catch (e) {
    // Keep the unreadable data rather than overwriting it.
    try { localStorage.setItem(STORAGE_KEY + ':unreadable-backup', raw); } catch (_) { /* ignore */ }
    queueMicrotask(() => toast('Saved browser data could not be read. A backup copy was kept.', 'error'));
    return normalize({});
  }
}

/* Applies a change to a copy of the state and saves it. The live state only
   changes if the save succeeds, so a failed save never loses what was on screen. */
function commit(mutator) {
  const next = structuredClone(state);
  mutator(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localPart(next)));
  } catch (e) {
    const full = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, error: full ? 'Browser storage is full — export a backup and remove old records.' : 'Could not save to browser storage.' };
  }
  state = next;
  render();
  return { ok: true };
}

/* ---------- Shared database (Supabase: shift_logs, notices) ---------- */

let cloudStatus = 'idle'; // idle | loading | ready | error
let cloudError = '';
let lastCloudLoad = 0;

function logFromRow(r) {
  // Logs saved before sections existed only have a category.
  const legacy = LEGACY_CATEGORY_SECTION[r.category];
  const section = r.section || (legacy ? legacy[0] : 'residents_guests');
  let subtype = r.subtype || (legacy ? legacy[1] : 'resident');
  if (section === 'amenities_common_areas' && !subtype) subtype = slugify(r.unit) || 'other';
  return {
    id: r.id, date: r.date, shift: r.shift, section, subtype,
    unit: r.unit || '', category: r.category || '', description: r.description || '',
    actionTaken: r.action_taken || '', pendingAction: r.pending_action || '',
    guestSuite: r.guest_suite || '', checkIn: r.check_in || '', details: r.details || {},
    createdBy: r.created_by || '', author: r.created_by_email || '',
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
const logToRow = (l) => ({
  date: l.date, shift: l.shift, section: l.section, subtype: l.subtype,
  unit: l.unit || null, category: l.category || null, description: l.description || null,
  action_taken: l.actionTaken || null, pending_action: l.pendingAction || null,
  guest_suite: l.guestSuite || null, check_in: l.checkIn || null, details: l.details || {},
});
const noticeFromRow = (r) => ({ id: r.id, text: r.text, date: r.date });

function dbErrorMessage(err) {
  const msg = (err && err.message) || String(err || '');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Could not reach the database. Check your connection.';
  if ((err && err.code === '42501') || /row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that (check the table policies in Supabase).';
  if ((err && err.code === 'PGRST204') || /could not find the .* column/i.test(msg)) {
    return 'The database is missing the new shift log columns. Run the update SQL in the Supabase SQL Editor.';
  }
  if ((err && err.code === 'PGRST205') || /could not find the table/i.test(msg)) {
    const table = (msg.match(/'public\.([\w]+)'/) || [])[1];
    return `The database is missing the ${table ? `"${table}" ` : ''}table. Run its setup SQL in the Supabase SQL Editor.`;
  }
  if (err && err.code === '23502') return 'The database still requires a field this log type does not use. Run the update SQL in the Supabase SQL Editor.';
  if (err && err.code === 'PGRST116') return 'That record no longer exists or you do not have permission to change it.';
  if (/JWT|not authenticated/i.test(msg)) return 'Your session has expired. Sign out and sign in again.';
  return `Database error: ${msg}`;
}

/* Runs a Supabase query and returns { ok, data } or { ok: false, error } with a readable message. */
async function db(query) {
  if (!sb) return { ok: false, error: 'Sign-in is not set up, so nothing can be saved to the database.' };
  try {
    const { data, error } = await query();
    if (error) throw error;
    return { ok: true, data };
  } catch (err) {
    console.error(err);
    return { ok: false, error: dbErrorMessage(err) };
  }
}

/* Supabase returns at most 1000 rows per request, so page through. */
async function fetchAll(table) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('*').order('created_at').order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function loadCloud({ quiet = false } = {}) {
  if (!sb) return;
  if (!quiet) { cloudStatus = 'loading'; render(); }
  try {
    const [logs, notices] = await Promise.all([fetchAll('shift_logs'), fetchAll('notices')]);
    state.logs = logs.map(logFromRow);
    state.notices = notices.map(noticeFromRow);
    cloudStatus = 'ready';
    lastCloudLoad = Date.now();
  } catch (err) {
    console.error(err);
    if (quiet) return; // keep showing what we already have
    cloudStatus = 'error';
    cloudError = dbErrorMessage(err);
  }
  // Don't re-render underneath an open form.
  if (!document.querySelector('dialog[open]:not(#login-dialog)')) render();
}

function clearCloud() {
  state.logs = [];
  state.notices = [];
  state.resources = [];
  state.followups = [];
  cloudStatus = 'idle';
  resourcesStatus = 'idle';
  fuStatus = 'idle';
  isAdmin = false;
  currentUser = null;
}

/* ----- Who is signed in, and what they may change ----- */

let currentUser = null; // { id, email }

// Only the author (or an admin) can edit or delete a shift log; Supabase enforces the same rule.
const canEditLog = (l) => isAdmin || (!!currentUser && l.createdBy === currentUser.id);
const canDeleteFollowup = (f) => isAdmin || (!!currentUser && f.createdBy === currentUser.id);
const authorLabel = (email, id) => {
  if (currentUser && id && id === currentUser.id) return 'you';
  return email ? email.split('@')[0] : 'unknown';
};

/* ----- Shared follow-ups: everyone signed in can view, add and update them. ----- */

let fuStatus = 'idle'; // idle | loading | ready | error
let fuError = '';

const fuFromRow = (r) => ({
  id: r.id, title: r.title, unit: r.unit || '', category: r.category || 'General', owner: r.owner || 'Concierge',
  assignee: r.assignee || '', dueDate: r.due_date || '', priority: r.priority || 'Medium', status: r.status || 'Open',
  nextAction: r.next_action || '', resolution: r.resolution || '',
  createdBy: r.created_by || '', author: r.created_by_email || '', createdAt: r.created_at, updatedAt: r.updated_at,
});
const fuToRow = (f) => ({
  title: f.title, unit: f.unit || null, category: f.category || 'General', owner: f.owner || 'Concierge',
  assignee: f.assignee || null, due_date: f.dueDate, priority: f.priority || 'Medium', status: f.status || 'Open',
  next_action: f.nextAction || null, resolution: f.resolution || null,
});

async function loadFollowups({ quiet = false } = {}) {
  if (!sb) return;
  if (!quiet) fuStatus = 'loading';
  try {
    state.followups = (await fetchAll('followups')).map(fuFromRow);
    fuStatus = 'ready';
  } catch (err) {
    console.error(err);
    if (quiet) return;
    fuStatus = 'error';
    fuError = dbErrorMessage(err);
  }
  if (!document.querySelector('dialog[open]:not(#login-dialog)')) render();
}

function followupBanner() {
  if (fuStatus === 'loading') return '<p class="banner">Loading follow-ups…</p>';
  if (fuStatus === 'error') {
    return `<div class="banner banner-error" role="alert">Could not load follow-ups. ${esc(fuError)}
      <button type="button" class="btn btn-sm" data-action="retry-fu">Try again</button></div>`;
  }
  const n = state.legacyFollowups.length;
  if (fuStatus === 'ready' && n) {
    return `<div class="banner">${n} follow-up${n === 1 ? ' is' : 's are'} saved only in this browser from before.
      Copy ${n === 1 ? 'it' : 'them'} to the shared list so the team can see ${n === 1 ? 'it' : 'them'}, or discard ${n === 1 ? 'it' : 'them'} if ${n === 1 ? "it's" : "they're"} sample data.
      <button type="button" class="btn btn-sm" data-action="upload-legacy-fu">Copy to shared list</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="discard-legacy-fu">Discard</button></div>`;
  }
  return '';
}

/* One-time move of follow-ups that older versions kept in this browser. */
async function uploadLegacyFollowups(btn) {
  const rows = state.legacyFollowups.filter((f) => f.title).map((f) => fuToRow({
    ...f,
    dueDate: f.dueDate || today(),
    priority: OPTIONS.priorities.includes(f.priority) ? f.priority : 'Medium',
    status: OPTIONS.statuses.includes(f.status) ? f.status : 'Open',
  }));
  setBusy(btn, true, 'Copying…');
  const res = rows.length ? await db(() => sb.from('followups').insert(rows).select()) : { ok: true, data: [] };
  setBusy(btn, false);
  if (!res.ok) return toast(`${res.error} Nothing was copied.`, 'error');
  state.followups.push(...res.data.map(fuFromRow));
  const r = commit((st) => { st.legacyFollowups = []; });
  if (!r.ok) toast(r.error, 'error');
  toast(`Copied ${res.data.length} follow-up${res.data.length === 1 ? '' : 's'} to the shared list.`);
}

/* ----- Shared resources: everyone signed in can read them; only admins can change them. ----- */

let resourcesStatus = 'idle'; // idle | loading | ready | error
let resourcesError = '';
let isAdmin = false;

const resFromRow = (r) => ({ id: r.id, group: r.group_name, name: r.name, url: r.url, notes: r.notes || '', tags: r.tags || '' });
const resToRow = (r) => ({ group_name: r.group, name: r.name, url: r.url, notes: r.notes || null, tags: r.tags || null });
const isPinned = (r) => state.pins.includes(r.id);

/* The app_admins policy only returns the signed-in user's own row, so any row means "admin".
   This only decides which buttons to show; Supabase enforces the real rule. */
async function checkAdmin() {
  const { data, error } = await sb.from('app_admins').select('user_id').limit(1);
  if (error) { console.warn('Could not check admin status:', error); return false; }
  return data.length > 0;
}

async function loadResources({ quiet = false } = {}) {
  if (!sb) return;
  if (!quiet) resourcesStatus = 'loading';
  try {
    const [rows, admin] = await Promise.all([fetchAll('resources'), checkAdmin()]);
    state.resources = rows.map(resFromRow);
    isAdmin = admin;
    resourcesStatus = 'ready';
  } catch (err) {
    console.error(err);
    if (quiet) return;
    resourcesStatus = 'error';
    resourcesError = dbErrorMessage(err);
  }
  if (!document.querySelector('dialog[open]:not(#login-dialog)')) render();
}

function cloudBanner() {
  if (cloudStatus === 'loading') return '<p class="banner">Loading shared shift logs and notices…</p>';
  if (cloudStatus === 'error') {
    return `<div class="banner banner-error" role="alert">Could not load shift logs and notices. ${esc(cloudError)}
      <button type="button" class="btn btn-sm" data-action="retry-cloud">Try again</button></div>`;
  }
  return '';
}

function setBusy(btn, busy, label) {
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label; }
  else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  btn.disabled = busy;
}

/* ---------- Helpers ---------- */

const today = () => isoDate(new Date());

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  return parseDate(iso).toLocaleDateString(undefined, opts);
}

function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

function isOverdue(f) {
  return f.status !== 'Done' && f.dueDate && f.dueDate < today();
}

function dueLabel(f) {
  if (!f.dueDate) return 'No due date';
  if (f.status === 'Done') return 'Due ' + fmtDate(f.dueDate);
  const n = daysBetween(today(), f.dueDate);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n > 1) return `Due in ${n} days`;
  return `Overdue by ${-n} day${n === -1 ? '' : 's'}`;
}

function currentShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'Morning';
  if (h >= 14 && h < 22) return 'Afternoon';
  return 'Overnight';
}

const byDue = (a, b) =>
  (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

function sortFollowups(list) {
  return [...list].sort((a, b) => {
    const doneA = a.status === 'Done', doneB = b.status === 'Done';
    if (doneA !== doneB) return doneA ? 1 : -1;
    return byDue(a, b);
  });
}

const SHIFT_RANK = { Overnight: 0, Morning: 1, Afternoon: 2 };
const byLogRecent = (a, b) =>
  b.date.localeCompare(a.date) || (SHIFT_RANK[b.shift] ?? 0) - (SHIFT_RANK[a.shift] ?? 0) || (b.createdAt || '').localeCompare(a.createdAt || '');

function safeUrl(url) {
  const u = String(url || '').trim();
  return /^(https?:|mailto:|tel:)/i.test(u) ? u : null;
}

function terms(q) {
  return String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesTerms(text, ts) {
  const hay = text.toLowerCase();
  return ts.every((t) => hay.includes(t));
}

const subtypeTitle = (l) => {
  const sec = SECTION_BY_ID[l.section];
  if (!sec || sec.subtypes.length === 1) return '';
  return sec.subtypes.find((st) => st.id === l.subtype)?.title || '';
};
// Badge text, e.g. "Operations & Events · Vendor / Contractor" or "Residents & Guests · Package".
const logTypeLabel = (l) => [SECTION_BY_ID[l.section]?.title, subtypeTitle(l) || (l.section === 'residents_guests' ? l.category : '')]
  .filter(Boolean).join(' · ');
const logText = (l) => [l.unit, logTypeLabel(l), l.shift, l.description, l.actionTaken, l.pendingAction, l.guestSuite,
  ...Object.values(l.details || {}), l.date, fmtDate(l.date)].join(' ');
const fuText = (f) => [f.title, f.unit, f.category, f.owner, f.assignee, f.priority, f.status, f.nextAction, f.resolution, f.dueDate].join(' ');
const resText = (r) => [r.name, r.group, r.url, r.notes, r.tags].join(' ');
const occName = (o) => [o.first_name, o.last_name].filter(Boolean).join(' ');
const occLabel = (o) => [o.unit, occName(o)].filter(Boolean).join(' ');
const occText = (o) => [o.unit, o.first_name, o.last_name, o.tenant_category].join(' ');

/* Escapes text and wraps search-term matches in <mark>. */
function hl(text, ts) {
  const s = String(text ?? '');
  if (!ts || !ts.length) return esc(s);
  const re = new RegExp('(' + ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return s.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

/* ---------- Badges ---------- */

function priorityBadge(p) {
  const icon = { High: '▲', Medium: '■', Low: '▼' }[p] || '';
  return `<span class="badge pri-${esc(p).toLowerCase()}"><span aria-hidden="true">${icon}</span> ${esc(p)}<span class="sr-only"> priority</span></span>`;
}

function statusBadge(s) {
  const cls = s.toLowerCase().replace(/\s+/g, '-');
  return `<span class="badge st-${cls}">${esc(s)}</span>`;
}

function overdueBadge(f) {
  return isOverdue(f) ? `<span class="badge overdue"><span aria-hidden="true">!</span> Overdue</span>` : '';
}

/* ---------- UI state ---------- */

/* Residents from Supabase (occupant_report). Kept in memory only, never saved to browser storage. */
let occupants = [];

const ui = {
  team: '',
  logFilters: { q: '', section: '', shift: '', from: '', to: '' },
  fuFilters: { q: '', owner: '', status: 'active', priority: '', category: '' },
  resQuery: '',
  searchQ: '',
};

/* ---------- Router ---------- */

const VIEWS = { overview: viewOverview, logs: viewLogs, followups: viewFollowups, resources: viewResources, search: viewSearch };

function currentView() {
  const v = location.hash.replace('#', '').split('?')[0];
  return VIEWS[v] ? v : 'overview';
}

function render() {
  const view = currentView();
  $$('.tabs a').forEach((a) => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const main = $('#main');
  // Preserve focus on filter inputs across re-renders.
  const active = document.activeElement;
  const focusKey = active && main.contains(active) ? active.dataset.focusKey : null;
  const selStart = focusKey && active.selectionStart;
  main.dataset.view = view;
  main.innerHTML = VIEWS[view]();
  if (focusKey) {
    const el = main.querySelector(`[data-focus-key="${focusKey}"]`);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch (_) { /* not a text input */ }
    }
  }
}

window.addEventListener('hashchange', () => {
  if (currentView() !== 'search' && ui.searchQ) {
    ui.searchQ = '';
    $('#global-search').value = '';
  }
  render();
  if (currentView() !== 'search') $('#main').focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

/* ---------- Views ---------- */

function fuListItem(f, ts) {
  const meta = [f.unit, f.owner + (f.assignee ? ` (${f.assignee})` : ''), dueLabel(f)].filter(Boolean);
  return `
    <li class="item${isOverdue(f) ? ' is-overdue' : ''}">
      <div class="item-main">
        <button type="button" class="link-btn item-title" data-action="edit-fu" data-id="${f.id}">${hl(f.title, ts)}</button>
        <div class="meta">${meta.map((m) => hl(m, ts)).join(' <span aria-hidden="true">·</span> ')}</div>
        ${f.nextAction ? `<div class="next"><strong>Next:</strong> ${hl(f.nextAction, ts)}</div>` : ''}
        ${f.status === 'Done' && f.resolution ? `<div class="next"><strong>Resolution:</strong> ${hl(f.resolution, ts)}</div>` : ''}
      </div>
      <div class="item-side">
        <div class="badges">${overdueBadge(f)}${priorityBadge(f.priority)}${statusBadge(f.status)}</div>
        ${f.status !== 'Done' ? `<button type="button" class="btn btn-sm" data-action="done-fu" data-id="${f.id}">Mark done</button>` : ''}
      </div>
    </li>`;
}

/* The labelled lines shown for a log, in reading order for its type. */
function logLines(l) {
  const d = l.details || {};
  const lines = [];
  if (l.guestSuite || l.checkIn) {
    lines.push(['Guest suite', [l.guestSuite, l.checkIn && `check-in ${fmtDate(l.checkIn)}`].filter(Boolean).join(', ')]);
  }
  if (d.touchpoint) lines.push(['Touchpoint', d.touchpoint]);
  if (d.gift) lines.push(['Gift', d.giftStatus ? `${d.gift} – ${d.giftStatus}` : d.gift]);
  const descFirst = l.section === 'residents_guests' || l.section === 'amenities_common_areas';
  const desc = l.description
    ? [[l.section === 'amenities_common_areas' ? 'Status' : l.section === 'residents_guests' ? '' : 'Detail', l.description]] : [];
  const action = l.actionTaken ? [[l.description && descFirst ? 'Action' : '', l.actionTaken]] : [];
  return lines.concat(descFirst ? [...desc, ...action] : [...action, ...desc]);
}

function logItem(l, ts) {
  const title = l.unit || subtypeTitle(l) || SECTION_BY_ID[l.section]?.title || 'Shift log';
  return `
    <article class="log">
      <div class="log-head">
        <strong class="log-unit">${hl(title, ts)}</strong>
        <span class="badge cat">${hl(logTypeLabel(l), ts)}</span>
        <span class="muted">${esc(l.shift)} · ${esc(fmtDate(l.date))} · <span title="${esc(l.author)}">by ${esc(authorLabel(l.author, l.createdBy))}</span></span>
        <span class="spacer"></span>
        ${canEditLog(l) ? `<button type="button" class="btn btn-sm btn-ghost" data-action="edit-log" data-id="${l.id}" aria-label="Edit log: ${esc(title)}">Edit</button>` : ''}
      </div>
      ${logLines(l).map(([label, text]) => `<p>${label ? `<strong>${esc(label)}:</strong> ` : ''}${hl(text, ts)}</p>`).join('')}
      ${l.pendingAction ? `<p class="pending"><strong>Pending:</strong> ${hl(l.pendingAction, ts)}</p>` : ''}
    </article>`;
}

function section(title, count, body, extra = '') {
  return `
    <section class="card">
      <header class="card-head">
        <h2>${title} <span class="count">${count}</span></h2>
        ${extra}
      </header>
      ${body}
    </section>`;
}

function emptyState(text) {
  return `<p class="empty">${text}</p>`;
}

function viewOverview() {
  const t = today();
  const team = ui.team;
  const fus = state.followups.filter((f) => !team || f.owner === team);
  const active = fus.filter((f) => f.status !== 'Done');
  const overdue = active.filter(isOverdue).sort(byDue);
  const dueToday = active.filter((f) => f.dueDate === t).sort(byDue);
  const high = active.filter((f) => f.priority === 'High' && f.dueDate > t).sort(byDue);
  const weekOut = dayOffset(7);
  const upcoming = active.filter((f) => f.dueDate > t && f.dueDate <= weekOut && f.priority !== 'High').sort(byDue);
  const todaysLogs = state.logs.filter((l) => l.date === t);
  const recent = [...state.logs].sort(byLogRecent).slice(0, 6);
  const pinned = state.resources.filter(isPinned);
  const highCount = active.filter((f) => f.priority === 'High').length;

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const list = (items, empty) => (items.length ? `<ul class="items">${items.map((f) => fuListItem(f)).join('')}</ul>` : emptyState(empty));

  const teamButtons = ['', ...OPTIONS.teams].map((tm) =>
    `<button type="button" class="seg" data-action="set-team" data-team="${esc(tm)}" aria-pressed="${ui.team === tm}">${tm || 'All teams'}</button>`).join('');

  const stat = (label, value, filter, tone = '') => `
    <button type="button" class="stat ${tone}" data-action="goto-fu" data-filter='${esc(JSON.stringify(filter))}'>
      <span class="stat-value">${value}</span><span class="stat-label">${label}</span>
    </button>`;

  return `
  <div class="overview-layout">
    <div class="overview-head">
    ${cloudBanner()}
    ${fuStatus === 'error' ? followupBanner() : ''}
    <div class="page-head">
      <div>
        <h1>${greet}</h1>
        <p class="muted">${esc(fmtDate(t, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))} · ${esc(currentShift())} shift<span class="weather" id="weather"${weatherText ? '' : ' hidden'}>${esc(weatherText)}</span></p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="new-log">+ Shift log</button>
        <button type="button" class="btn" data-action="new-fu">+ Follow-up</button>
        <button type="button" class="btn" data-action="shift-note">Generate shift note</button>
      </div>
    </div>
    </div>

    ${quickAccessHtml()}

    <div class="overview-main">
    <div class="team-filter" role="group" aria-label="Show actionable items for">
      <span class="muted">Actionable items for:</span>
      <div class="segmented">${teamButtons}</div>
    </div>

    <div class="stats">
      ${stat('Open follow-ups', active.length, { status: 'active', owner: team })}
      ${stat('Overdue', overdue.length, { status: 'overdue', owner: team }, overdue.length ? 'tone-danger' : '')}
      ${stat('Due today', dueToday.length, { status: 'today', owner: team }, dueToday.length ? 'tone-warn' : '')}
      ${stat('High priority', highCount, { status: 'active', priority: 'High', owner: team })}
      <a class="stat" href="#logs"><span class="stat-value">${todaysLogs.length}</span><span class="stat-label">Logs today</span></a>
    </div>

    <div class="overview-grid">
      <div class="col">
        ${section('Overdue', overdue.length, list(overdue, 'Nothing overdue. 🎉'))}
        ${section('Due today', dueToday.length, list(dueToday, 'Nothing due today.'))}
        ${section('High priority', high.length, list(high, 'No other high-priority items.'))}
        ${section('Coming up this week', upcoming.length, list(upcoming, 'Nothing else scheduled in the next 7 days.'))}
      </div>
      <div class="col">
        ${section('Important notices', state.notices.length, `
          ${state.notices.length ? `<ul class="notices">${state.notices.map((n) => `
            <li><span>${esc(n.text)}</span>
              <button type="button" class="btn btn-sm btn-ghost" data-action="del-notice" data-id="${n.id}" aria-label="Dismiss notice: ${esc(n.text)}">Dismiss</button></li>`).join('')}</ul>` : emptyState('No notices.')}
          <form class="inline-form" data-form="notice">
            <label for="notice-input" class="sr-only">New notice</label>
            <input id="notice-input" name="text" placeholder="Add a notice for the team…" autocomplete="off">
            <button type="submit" class="btn btn-sm">Add</button>
          </form>`)}
        ${section('Recent shift activity', state.logs.length,
          recent.length ? `<div class="logs compact">${recent.map((l) => logItem(l)).join('')}</div>` : emptyState('No shift logs yet.'),
          '<a href="#logs" class="small-link">View all</a>')}
        ${section('Quick links', pinned.length,
          pinned.length ? `<ul class="quick-links">${pinned.map(resourceLink).join('')}</ul>` : emptyState('Pin resources on the Resources tab to show them here.'),
          '<a href="#resources" class="small-link">All resources</a>')}
      </div>
    </div>
    </div>
  </div>`;
}

/* ----- Overview quick-access sidebar ----- */

function quickAccessUrl(link) {
  if (link.url) return link.url;
  const target = (link.resource || link.name).trim().toLowerCase();
  return state.resources.find((r) => r.name.trim().toLowerCase() === target)?.url || '';
}

function quickAccessHtml() {
  return `<aside class="quick-access" aria-label="Quick access">${QUICK_ACCESS.map((group) => `
    <section class="quick-card">
      <h2>${esc(group.title)}</h2>
      <ul>${group.links.map((link) => {
        const url = safeUrl(quickAccessUrl(link));
        const ext = url && /^https?:/i.test(url);
        return `<li>${url
          ? `<a href="${esc(url)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(link.name)}${ext ? '<span class="sr-only"> (opens in new tab)</span>' : ''}</a>`
          : `<span class="unset" title="No link yet. Add a resource named “${esc(link.resource || link.name)}”.">${esc(link.name)}</span>`}</li>`;
      }).join('')}</ul>
    </section>`).join('')}
  </aside>`;
}

/* ----- Current weather (Open-Meteo, no API key) ----- */

let weatherText = ''; // empty = hidden

const WEATHER_CODES = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy rain showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadWeather() {
  let { latitude, longitude } = WEATHER;
  const hasCoords = latitude != null && longitude != null;
  if (!hasCoords && !WEATHER.location) return; // not configured: keep it hidden
  const fahrenheit = WEATHER.unit === 'fahrenheit';
  try {
    if (!hasCoords) {
      const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(WEATHER.location)}`);
      if (!geo.results?.length) throw new Error(`Location not found: ${WEATHER.location}`);
      ({ latitude, longitude } = geo.results[0]);
    }
    const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code&temperature_unit=${fahrenheit ? 'fahrenheit' : 'celsius'}`);
    const { temperature_2m: temp, weather_code: code } = data.current;
    weatherText = `${Math.round(temp)}°${fahrenheit ? 'F' : 'C'} · ${WEATHER_CODES[code] || 'Current conditions'}`;
  } catch (err) {
    console.warn('Weather unavailable:', err);
    weatherText = 'Weather unavailable';
  }
  const el = $('#weather');
  if (el) { el.textContent = weatherText; el.hidden = !weatherText; }
}

function resourceLink(r) {
  const url = safeUrl(r.url);
  const ext = url && /^https?:/i.test(url);
  return url
    ? `<li><a href="${esc(url)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(r.name)}</a> <span class="muted small">${esc(r.group)}</span></li>`
    : `<li><span>${esc(r.name)}</span> <span class="muted small">${esc(r.url)}</span></li>`;
}

/* ----- Shift log view ----- */

function optionList(values, selected, allLabel) {
  return (allLabel != null ? `<option value="">${allLabel}</option>` : '') +
    values.map((v) => `<option${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function filteredLogs() {
  const f = ui.logFilters;
  const ts = terms(f.q);
  return state.logs.filter((l) =>
    (!f.section || l.section === f.section) &&
    (!f.shift || l.shift === f.shift) &&
    (!f.from || l.date >= f.from) &&
    (!f.to || l.date <= f.to) &&
    (!ts.length || matchesTerms(logText(l), ts))
  ).sort(byLogRecent);
}

function viewLogs() {
  const f = ui.logFilters;
  const logs = filteredLogs();
  const ts = terms(f.q);
  const groups = new Map();
  logs.forEach((l) => {
    if (!groups.has(l.date)) groups.set(l.date, []);
    groups.get(l.date).push(l);
  });
  const anyFilter = f.q || f.section || f.shift || f.from || f.to;

  return `
    ${cloudBanner()}
    <div class="page-head">
      <div><h1>Shift log</h1><p class="muted">Unit or name, action taken, pending action, and date.</p></div>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="new-log">+ Shift log</button>
        <button type="button" class="btn" data-action="shift-note">Generate shift note</button>
      </div>
    </div>

    <form class="filters" data-form="log-filters" aria-label="Filter shift logs">
      <label class="grow">Keyword or unit<input type="search" name="q" value="${esc(f.q)}" data-focus-key="log-q" placeholder="e.g. 807, leak, Rivera"></label>
      <label>Section<select name="section" data-focus-key="log-section"><option value="">All</option>${SECTIONS.map((sec) => `<option value="${sec.id}"${sec.id === f.section ? ' selected' : ''}>${esc(sec.title)}</option>`).join('')}</select></label>
      <label>Shift<select name="shift" data-focus-key="log-shift">${optionList(OPTIONS.shifts, f.shift, 'All')}</select></label>
      <label>From<input type="date" name="from" value="${esc(f.from)}" data-focus-key="log-from"></label>
      <label>To<input type="date" name="to" value="${esc(f.to)}" data-focus-key="log-to"></label>
      ${anyFilter ? '<button type="button" class="btn btn-ghost" data-action="clear-log-filters">Clear</button>' : ''}
    </form>

    <p class="result-count" aria-live="polite">${logs.length} of ${state.logs.length} entries</p>

    ${logs.length ? [...groups].map(([date, items]) => `
      <section class="day-group">
        <h2 class="day-head">${esc(fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' }))}${date === today() ? ' <span class="badge cat">Today</span>' : ''}</h2>
        <div class="logs">${items.map((l) => logItem(l, ts)).join('')}</div>
      </section>`).join('') : emptyState(anyFilter ? 'No shift logs match these filters.' : 'No shift logs yet. Add your first one.')}
  `;
}

/* ----- Follow-ups view ----- */

function filteredFollowups() {
  const f = ui.fuFilters;
  const ts = terms(f.q);
  const t = today();
  return sortFollowups(state.followups.filter((x) =>
    (!f.owner || x.owner === f.owner) &&
    (!f.priority || x.priority === f.priority) &&
    (!f.category || x.category === f.category) &&
    (f.status === 'all' ? true
      : f.status === 'active' ? x.status !== 'Done'
      : f.status === 'overdue' ? isOverdue(x)
      : f.status === 'today' ? x.status !== 'Done' && x.dueDate === t
      : x.status === f.status) &&
    (!ts.length || matchesTerms(fuText(x), ts))
  ));
}

function viewFollowups() {
  const f = ui.fuFilters;
  const list = filteredFollowups();
  const ts = terms(f.q);
  const statusOpts = [['active', 'Active (not done)'], ['overdue', 'Overdue'], ['today', 'Due today'], ...OPTIONS.statuses.map((s) => [s, s]), ['all', 'All']];
  const anyFilter = f.q || f.owner || f.priority || f.category || f.status !== 'active';

  const rows = list.map((x) => `
    <tr class="${isOverdue(x) ? 'is-overdue' : ''}${x.status === 'Done' ? ' is-done' : ''}">
      <td data-label="Task">
        <button type="button" class="link-btn item-title" data-action="edit-fu" data-id="${x.id}">${hl(x.title, ts)}</button>
        ${x.nextAction && x.status !== 'Done' ? `<div class="next">Next: ${hl(x.nextAction, ts)}</div>` : ''}
        ${x.status === 'Done' && x.resolution ? `<div class="next">Resolution: ${hl(x.resolution, ts)}</div>` : ''}
      </td>
      <td data-label="Unit">${hl(x.unit, ts) || '<span class="muted">—</span>'}</td>
      <td data-label="Owner">${hl(x.owner, ts)}${x.assignee ? `<div class="muted small">${hl(x.assignee, ts)}</div>` : ''}</td>
      <td data-label="Due"><span class="nowrap">${esc(fmtDate(x.dueDate))}</span><div class="small ${isOverdue(x) ? 'text-danger' : 'muted'}">${esc(dueLabel(x))}</div></td>
      <td data-label="Priority">${priorityBadge(x.priority)}</td>
      <td data-label="Status">
        <label class="sr-only" for="st-${x.id}">Status for ${esc(x.title)}</label>
        <select id="st-${x.id}" class="status-select st-${x.status.toLowerCase().replace(/\s+/g, '-')}" data-action="set-status" data-id="${x.id}">
          ${optionList(OPTIONS.statuses, x.status)}
        </select>
        ${overdueBadge(x)}
      </td>
    </tr>`).join('');

  return `
    ${followupBanner()}
    <div class="page-head">
      <div><h1>Follow-ups &amp; tasks</h1><p class="muted">Owners, due dates, priorities and statuses. Overdue items are flagged.</p></div>
      <div class="actions"><button type="button" class="btn btn-primary" data-action="new-fu">+ Follow-up</button></div>
    </div>

    <form class="filters" data-form="fu-filters" aria-label="Filter follow-ups">
      <label class="grow">Keyword or unit<input type="search" name="q" value="${esc(f.q)}" data-focus-key="fu-q" placeholder="e.g. 807, gate, fob"></label>
      <label>Status<select name="status" data-focus-key="fu-status">${statusOpts.map(([v, l]) => `<option value="${esc(v)}"${v === f.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>Owner<select name="owner" data-focus-key="fu-owner">${optionList(OPTIONS.teams, f.owner, 'All')}</select></label>
      <label>Priority<select name="priority" data-focus-key="fu-pri">${optionList(OPTIONS.priorities, f.priority, 'All')}</select></label>
      <label>Category<select name="category" data-focus-key="fu-cat">${optionList(OPTIONS.categories, f.category, 'All')}</select></label>
      ${anyFilter ? '<button type="button" class="btn btn-ghost" data-action="clear-fu-filters">Reset</button>' : ''}
    </form>

    <p class="result-count" aria-live="polite">${list.length} of ${state.followups.length} follow-ups</p>

    ${list.length ? `
      <div class="table-wrap">
        <table class="fu-table">
          <thead><tr><th scope="col">Task</th><th scope="col">Unit</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Priority</th><th scope="col">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : emptyState('No follow-ups match these filters.')}
  `;
}

/* ----- Resources view ----- */

function viewResources() {
  const ts = terms(ui.resQuery);
  const matches = state.resources.filter((r) => !ts.length || matchesTerms(resText(r), ts));
  const groups = OPTIONS.resourceGroups.map((g) => [g, matches.filter((r) => r.group === g)]);
  const other = matches.filter((r) => !OPTIONS.resourceGroups.includes(r.group));
  if (other.length) groups.push(['Other', other]);

  const card = (r) => {
    const url = safeUrl(r.url);
    const ext = url && /^https?:/i.test(url);
    return `
      <li class="res">
        <div class="res-head">
          ${url ? `<a class="res-name" href="${esc(url)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${hl(r.name, ts)}${ext ? '<span class="sr-only"> (opens in new tab)</span> <span aria-hidden="true">↗</span>' : ''}</a>`
                : `<span class="res-name">${hl(r.name, ts)}</span>`}
          <span class="spacer"></span>
          <button type="button" class="btn btn-sm btn-ghost" data-action="pin-res" data-id="${r.id}" aria-pressed="${isPinned(r)}" title="Show on your Overview">${isPinned(r) ? '★ Pinned' : '☆ Pin'}</button>
          ${isAdmin ? `<button type="button" class="btn btn-sm btn-ghost" data-action="edit-res" data-id="${r.id}" aria-label="Edit ${esc(r.name)}">Edit</button>` : ''}
        </div>
        ${!url ? `<div class="small">${hl(r.url, ts)}</div>` : ''}
        ${r.notes ? `<p class="res-notes">${hl(r.notes, ts)}</p>` : ''}
        ${r.tags ? `<div class="tags">${r.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => `<span class="tag">${hl(t, ts)}</span>`).join('')}</div>` : ''}
      </li>`;
  };

  const legacy = state.legacyResources.length;
  let banner = '';
  if (resourcesStatus === 'loading') banner = '<p class="banner">Loading resources…</p>';
  else if (resourcesStatus === 'error') {
    banner = `<div class="banner banner-error" role="alert">Could not load resources. ${esc(resourcesError)}
      <button type="button" class="btn btn-sm" data-action="retry-res">Try again</button></div>`;
  } else if (isAdmin && legacy) {
    banner = `<div class="banner">${legacy} resource${legacy === 1 ? ' is' : 's are'} saved only in this browser from before.
      Copy ${legacy === 1 ? 'it' : 'them'} to the shared list so the whole team can see ${legacy === 1 ? 'it' : 'them'}.
      <button type="button" class="btn btn-sm" data-action="upload-legacy-res">Copy to shared list</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="discard-legacy-res">Discard</button></div>`;
  }

  return `
    ${banner}
    <div class="page-head">
      <div><h1>Resources</h1><p class="muted">Work systems, SharePoint trackers, SOPs, guides and contacts. Linked systems still use their own login.${isAdmin ? '' : ' Pin the ones you use most to your Overview.'}</p></div>
      ${isAdmin ? '<div class="actions"><button type="button" class="btn btn-primary" data-action="new-res">+ Resource</button></div>' : ''}
    </div>
    <form class="filters" data-form="res-filters" aria-label="Filter resources">
      <label class="grow">Find a resource<input type="search" name="q" value="${esc(ui.resQuery)}" data-focus-key="res-q" placeholder="e.g. leak, fob, packages"></label>
    </form>
    <p class="result-count" aria-live="polite">${matches.length} of ${state.resources.length} resources</p>
    <div class="res-grid">
      ${groups.filter(([, items]) => items.length || (!ts.length && state.resources.length)).map(([g, items]) => `
        <section class="card">
          <header class="card-head"><h2>${esc(g)} <span class="count">${items.length}</span></h2></header>
          ${items.length ? `<ul class="res-list">${items.map(card).join('')}</ul>` : emptyState('Nothing here yet.')}
        </section>`).join('')}
    </div>
    ${ts.length && !matches.length ? emptyState('No resources match. Try the global search for logs and follow-ups.') : ''}
    ${!ts.length && !state.resources.length && resourcesStatus === 'ready'
      ? emptyState(isAdmin ? 'No shared resources yet. Add one with + Resource.' : 'No resources have been added yet.') : ''}
  `;
}

/* ----- Global search view ----- */

function viewSearch() {
  const ts = terms(ui.searchQ);
  if (!ts.length) {
    return `<div class="page-head"><div><h1>Search</h1><p class="muted">Type in the search box above to find shift logs, follow-ups, resources and notices.</p></div></div>`;
  }
  const t0 = performance.now();
  const fus = sortFollowups(state.followups.filter((f) => matchesTerms(fuText(f), ts)));
  const logs = state.logs.filter((l) => matchesTerms(logText(l), ts)).sort(byLogRecent);
  const res = state.resources.filter((r) => matchesTerms(resText(r), ts));
  const notices = state.notices.filter((n) => matchesTerms(n.text, ts));
  const people = occupants.filter((o) => matchesTerms(occText(o), ts));
  const ms = performance.now() - t0;
  const total = people.length + fus.length + logs.length + res.length + notices.length;
  const LIMIT = 50;

  return `
    <div class="page-head">
      <div><h1>Search results</h1>
      <p class="muted" aria-live="polite">${total} result${total === 1 ? '' : 's'} for “${esc(ui.searchQ.trim())}” · ${ms.toFixed(0)} ms</p></div>
    </div>
    ${people.length ? section('Residents', people.length, `<ul class="people">${people.slice(0, LIMIT).map((o) => `
      <li>
        <div class="item-main"><strong>${hl(o.unit, ts)}</strong> — ${hl(occName(o), ts)}
          ${o.tenant_category ? `<span class="muted small">${hl(o.tenant_category, ts)}</span>` : ''}</div>
        <button type="button" class="btn btn-sm" data-action="new-log-for" data-unit="${esc(occLabel(o))}">+ Log</button>
        <button type="button" class="btn btn-sm" data-action="new-fu-for" data-unit="${esc(occLabel(o))}">+ Follow-up</button>
      </li>`).join('')}</ul>${people.length > LIMIT ? `<p class="muted small">Showing first ${LIMIT}. Type more of the unit or name to narrow it down.</p>` : ''}`) : ''}
    ${res.length ? section('Resources', res.length, `<ul class="quick-links">${res.slice(0, LIMIT).map((r) => {
      const url = safeUrl(r.url);
      const ext = url && /^https?:/i.test(url);
      return `<li>${url ? `<a href="${esc(url)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${hl(r.name, ts)}</a>` : hl(r.name, ts)}
        <span class="muted small">${esc(r.group)}</span>${r.notes ? `<div class="small">${hl(r.notes, ts)}</div>` : ''}</li>`;
    }).join('')}</ul>`) : ''}
    ${fus.length ? section('Follow-ups', fus.length, `<ul class="items">${fus.slice(0, LIMIT).map((f) => fuListItem(f, ts)).join('')}</ul>${fus.length > LIMIT ? `<p class="muted small">Showing first ${LIMIT}. Refine your search or use the Follow-ups filters.</p>` : ''}`) : ''}
    ${logs.length ? section('Shift logs', logs.length, `<div class="logs">${logs.slice(0, LIMIT).map((l) => logItem(l, ts)).join('')}</div>${logs.length > LIMIT ? `<p class="muted small">Showing first ${LIMIT}. Refine your search or use the Shift Log filters.</p>` : ''}`) : ''}
    ${notices.length ? section('Notices', notices.length, `<ul class="notices">${notices.map((n) => `<li><span>${hl(n.text, ts)}</span></li>`).join('')}</ul>`) : ''}
    ${!total ? emptyState('Nothing found. Try a unit number, a name, or a single keyword.') : ''}
  `;
}

/* ---------- Toasts ---------- */

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3000);
}

/* ---------- Dialog helpers ---------- */

function fillSelects(root) {
  $$('select[data-options]', root).forEach((sel) => {
    sel.innerHTML = optionList(OPTIONS[sel.dataset.options]);
  });
}
fillSelects(document);

function showFormError(form, msg) {
  const p = $('.form-error', form);
  p.textContent = msg;
  p.hidden = !msg;
}

function clearInvalid(form) {
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  showFormError(form, '');
}

function requireFields(form, names) {
  const missing = names.filter((n) => !String(form.elements[n].value).trim());
  missing.forEach((n) => form.elements[n].setAttribute('aria-invalid', 'true'));
  if (missing.length) {
    form.elements[missing[0]].focus();
    const labels = missing.map((n) => form.elements[n].closest('label').firstChild.textContent.trim());
    showFormError(form, `Please fill in: ${labels.join(', ')}.`);
    return false;
  }
  return true;
}

function setFormValues(form, values) {
  Object.entries(values).forEach(([k, v]) => {
    const el = form.elements[k];
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('dialog [data-action="cancel"]');
  if (btn) btn.closest('dialog').close();
});

// Close dialogs when clicking the backdrop.
$$('dialog:not(#login-dialog)').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

function confirmDialog(message, okLabel = 'Confirm') {
  const d = $('#confirm-dialog');
  $('#confirm-msg').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  d.showModal();
  return new Promise((resolve) => {
    const ok = () => { cleanup(); d.close(); resolve(true); };
    const close = () => { cleanup(); resolve(false); };
    const cleanup = () => { $('#confirm-ok').removeEventListener('click', ok); d.removeEventListener('close', close); };
    $('#confirm-ok').addEventListener('click', ok);
    d.addEventListener('close', close);
  });
}

/* ----- Shift log dialog ----- */

const logDialog = $('#log-dialog');
const logForm = $('#log-form');

function syncLogFollowupFields() {
  const on = logForm.elements.makeFollowup.checked;
  ['fuOwner', 'fuDue', 'fuPriority'].forEach((n) => { logForm.elements[n].disabled = !on; });
}
logForm.elements.makeFollowup.addEventListener('change', syncLogFollowupFields);

/* Step 1 cards and the suggestion lists are built once from data.js. */
$('#log-sections').innerHTML = SECTIONS.map((sec) => `
  <label class="type-card">
    <input type="radio" name="section" value="${sec.id}">
    <span class="type-card-title">${esc(sec.title)}</span>
    <span class="type-card-desc">${esc(sec.desc)}</span>
    <span class="type-card-eg">e.g. ${esc(sec.examples.slice(0, 3).join(' · '))}</span>
  </label>`).join('');
[['tracker-list', SUGGESTIONS.trackers], ['vendor-list', SUGGESTIONS.vendors], ['area-list', SUGGESTIONS.areas]].forEach(([id, values]) => {
  $(`#${id}`).innerHTML = values.map((v) => `<option value="${esc(v)}"></option>`).join('');
});

let logStep = 1;
let logDraft = {};          // field values kept while moving between steps and subtypes
let logSubtypePreset = '';  // subtype to pre-select when editing

const selectedSection = () => SECTION_BY_ID[$('input[name="section"]:checked', logForm)?.value];

function currentSubtypeDef() {
  const sec = selectedSection();
  if (!sec) return null;
  if (sec.subtypes.length === 1) return sec.subtypes[0];
  const id = $('input[name="subtype"]:checked', logForm)?.value;
  return sec.subtypes.find((st) => st.id === id) || null;
}

function fieldHtml(f) {
  const req = f.required ? ' required' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  let control;
  if (f.type === 'textarea') control = `<textarea name="${f.name}" rows="${f.rows || 3}"${ph}${req}></textarea>`;
  else if (f.type === 'select') control = `<select name="${f.name}"${req}>${f.required ? '<option value="">Choose…</option>' : ''}${optionList(f.options)}</select>`;
  else if (f.type === 'date') control = `<input type="date" name="${f.name}"${req}>`;
  else control = `<input name="${f.name}"${f.list ? ` list="${f.list}"` : ''}${ph} autocomplete="off"${req}>`;
  return `<label>${esc(f.label)}${control}</label>`;
}

function saveDraft() {
  $$('#log-dynamic [name]').forEach((el) => { logDraft[el.name] = el.value; });
}

function renderLogFields() {
  saveDraft();
  const def = currentSubtypeDef();
  $('#log-fields').hidden = !def;
  $('#log-dynamic').innerHTML = def ? def.fields.map(fieldHtml).join('') : '';
  if (!def) return;
  def.fields.forEach((f) => {
    const el = logForm.elements[f.name];
    if (el && logDraft[f.name] != null) el.value = logDraft[f.name];
  });
  if (logForm.elements.category && !logForm.elements.category.value) logForm.elements.category.value = 'General';
}

function showLogStep(step) {
  logStep = step;
  $('#log-step1').hidden = step !== 1;
  $('#log-step2').hidden = step !== 2;
  $('#log-step-label').textContent = `Step ${step} of 2`;
  $('#log-back').hidden = step !== 2;
  $('#log-save').hidden = step !== 2;
}

function goToStep2() {
  const sec = selectedSection();
  if (!sec) return;
  clearInvalid(logForm);
  showLogStep(2);
  $('#log-section-name').textContent = sec.title;
  const multi = sec.subtypes.length > 1;
  $('#log-subtype').hidden = !multi;
  if (multi) {
    const preset = sec.subtypes.some((st) => st.id === logSubtypePreset) ? logSubtypePreset : '';
    $('#log-subtype-q').textContent = sec.ask;
    $('#log-subtypes').innerHTML = sec.subtypes.map((st) => `
      <label class="subtype-option"><input type="radio" name="subtype" value="${st.id}"${st.id === preset ? ' checked' : ''}>${esc(st.title)}</label>`).join('');
  } else {
    $('#log-subtypes').innerHTML = '';
  }
  renderLogFields();
  const first = multi && !currentSubtypeDef() ? $('input[name="subtype"]', logForm) : $('#log-dynamic [name]');
  first?.focus();
}

/* Clicking a card goes straight to step 2. Only real pointer clicks on the card count
   (detail > 0): arrow keys also fire "click" on the radios, so keyboard users can move
   between cards and press Enter to continue. */
$('#log-sections').addEventListener('click', (e) => {
  const card = e.target.closest('.type-card');
  if (!card || e.detail === 0 || e.target.matches('input')) return;
  e.preventDefault(); // we select the radio ourselves, so the label doesn't need to
  card.querySelector('input').checked = true;
  goToStep2();
});
$('#log-sections').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[name="section"]')) {
    e.preventDefault();
    e.target.checked = true;
    goToStep2();
  }
});
$('#log-subtypes').addEventListener('change', () => {
  logSubtypePreset = $('input[name="subtype"]:checked', logForm)?.value || '';
  clearInvalid(logForm);
  renderLogFields();
  $('#log-dynamic [name]')?.focus();
});
$('#log-back').addEventListener('click', () => {
  saveDraft();
  clearInvalid(logForm);
  showLogStep(1);
  ($('input[name="section"]:checked', logForm) || $('input[name="section"]', logForm)).focus();
});

/* preset can pre-fill a new log, e.g. { section: 'residents_guests', unit: 'E02 Dana Fox' }. */
function openLogDialog(log, preset = {}) {
  if (log && !canEditLog(log)) return toast('Only the person who wrote this log can edit it.', 'error');
  logForm.reset();
  clearInvalid(logForm);
  $('#log-dynamic').innerHTML = ''; // drop the previous log's fields so they aren't saved into the draft
  const editing = !!log;
  logDraft = editing ? { ...log, ...(log.details || {}) } : { ...preset };
  logSubtypePreset = (editing ? log.subtype : preset.subtype) || '';
  $('#log-dialog-title').textContent = editing ? 'Edit shift log' : 'New shift log';
  $('[data-action="delete"]', logForm).hidden = !editing;
  $('#log-followup-fields').hidden = editing;
  setFormValues(logForm, {
    id: editing ? log.id : '', date: editing ? log.date : today(), shift: editing ? log.shift : currentShift(),
    makeFollowup: false, fuOwner: 'Concierge', fuDue: dayOffset(1), fuPriority: 'Medium',
  });
  syncLogFollowupFields();
  const section = (editing ? log.section : preset.section) || '';
  $$('input[name="section"]', logForm).forEach((r) => { r.checked = r.value === section; });
  logDialog.showModal();
  if (section) goToStep2();
  else { showLogStep(1); $('input[name="section"]', logForm).focus(); }
}

logForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (logStep === 1) return goToStep2(); // Enter on step 1 means Continue
  clearInvalid(logForm);
  const sec = selectedSection();
  const def = currentSubtypeDef();
  if (!def) {
    showFormError(logForm, 'Choose what kind of update this is.');
    $('input[name="subtype"]', logForm)?.focus();
    return;
  }
  if (!requireFields(logForm, ['date', ...def.fields.filter((f) => f.required).map((f) => f.name)])) return;
  const v = Object.fromEntries(new FormData(logForm));
  const val = (n) => String(v[n] ?? '').trim();
  const makeFu = !v.id && logForm.elements.makeFollowup.checked;
  if (makeFu && !val('pendingAction')) {
    logForm.elements.pendingAction.setAttribute('aria-invalid', 'true');
    logForm.elements.pendingAction.focus();
    showFormError(logForm, 'Add a pending action to create a follow-up from it.');
    return;
  }
  const now = new Date().toISOString();
  const details = {};
  ['touchpoint', 'gift', 'giftStatus'].forEach((k) => { if (val(k)) details[k] = val(k); });
  const rec = {
    date: v.date, shift: v.shift, section: sec.id,
    // Amenities are sub-typed by area (e.g. "curb_appeal"); other sections by the chosen subtype.
    subtype: sec.id === 'amenities_common_areas' ? (slugify(val('unit')) || 'other') : def.id,
    unit: val('unit'),
    category: sec.id === 'residents_guests' ? (v.category || 'General') : (sec.subtypes.length > 1 ? def.title : sec.title),
    description: val('description'), actionTaken: val('actionTaken'), pendingAction: val('pendingAction'),
    guestSuite: val('guestSuite'), checkIn: v.checkIn || '', details,
  };
  const btn = $('#log-save');
  setBusy(btn, true, 'Saving…');
  const res = await db(() => (v.id
    ? sb.from('shift_logs').update({ ...logToRow(rec), updated_at: now }).eq('id', v.id).select().single()
    : sb.from('shift_logs').insert(logToRow(rec)).select().single()));
  setBusy(btn, false);
  if (!res.ok) return showFormError(logForm, `${res.error} Your entry has been kept — try saving again.`);

  const saved = logFromRow(res.data);
  const i = state.logs.findIndex((l) => l.id === saved.id);
  if (i >= 0) state.logs[i] = saved; else state.logs.push(saved);

  let fuProblem = '';
  if (makeFu) {
    const fu = await db(() => sb.from('followups').insert(fuToRow({
      title: rec.pendingAction, unit: rec.unit,
      category: OPTIONS.categories.includes(rec.category) ? rec.category : 'General',
      owner: v.fuOwner, dueDate: v.fuDue || dayOffset(1), priority: v.fuPriority, status: 'Open',
    })).select().single());
    if (fu.ok) state.followups.push(fuFromRow(fu.data)); else fuProblem = fu.error;
  }
  render();
  logDialog.close();
  if (fuProblem) toast(`Shift log saved, but the follow-up could not be saved: ${fuProblem}`, 'error');
  else toast(v.id ? 'Shift log updated.' : makeFu ? 'Shift log and follow-up saved.' : 'Shift log saved.');
});

$('[data-action="delete"]', logForm).addEventListener('click', async () => {
  const id = logForm.elements.id.value;
  if (!(await confirmDialog('Delete this shift log entry for everyone? This cannot be undone.', 'Delete'))) return;
  const res = await db(() => sb.from('shift_logs').delete().eq('id', id).select());
  if (res.ok && !res.data.length) res.ok = false, res.error = dbErrorMessage({ code: 'PGRST116' });
  if (!res.ok) return showFormError(logForm, res.error);
  state.logs = state.logs.filter((l) => l.id !== id);
  render();
  logDialog.close();
  toast('Shift log deleted.');
});

/* ----- Follow-up dialog ----- */

const fuDialog = $('#fu-dialog');
const fuForm = $('#fu-form');

function openFuDialog(fu, overrides = {}) {
  fuForm.reset();
  clearInvalid(fuForm);
  const editing = !!fu;
  $('#fu-dialog-title').textContent = editing ? 'Edit follow-up' : 'New follow-up';
  $('[data-action="delete"]', fuForm).hidden = !editing || !canDeleteFollowup(fu);
  setFormValues(fuForm, {
    ...(fu || { id: '', title: '', unit: '', category: 'General', owner: ui.team || 'Concierge', assignee: '', dueDate: dayOffset(1), priority: 'Medium', status: 'Open', nextAction: '', resolution: '' }),
    ...overrides,
  });
  fuDialog.showModal();
  (overrides.status === 'Done' ? fuForm.elements.resolution : fuForm.elements.title).focus();
}

fuForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearInvalid(fuForm);
  if (!requireFields(fuForm, ['title', 'dueDate'])) return;
  const v = Object.fromEntries(new FormData(fuForm));
  if (v.status === 'Done' && !v.resolution.trim()) {
    fuForm.elements.resolution.setAttribute('aria-invalid', 'true');
    fuForm.elements.resolution.focus();
    showFormError(fuForm, 'Record a resolution before marking this follow-up Done.');
    return;
  }
  const rec = {
    title: v.title.trim(), unit: v.unit.trim(), category: v.category, owner: v.owner, assignee: v.assignee.trim(),
    dueDate: v.dueDate, priority: v.priority, status: v.status, nextAction: v.nextAction.trim(), resolution: v.resolution.trim(),
  };
  const btn = $('button[type="submit"]', fuForm);
  setBusy(btn, true, 'Saving…');
  const res = await db(() => (v.id
    ? sb.from('followups').update({ ...fuToRow(rec), updated_at: new Date().toISOString() }).eq('id', v.id).select().single()
    : sb.from('followups').insert(fuToRow(rec)).select().single()));
  setBusy(btn, false);
  if (!res.ok) return showFormError(fuForm, `${res.error} Your entry has been kept — try saving again.`);
  const saved = fuFromRow(res.data);
  const i = state.followups.findIndex((f) => f.id === saved.id);
  if (i >= 0) state.followups[i] = saved; else state.followups.push(saved);
  render();
  fuDialog.close();
  toast(v.id ? (rec.status === 'Done' ? 'Follow-up marked done.' : 'Follow-up updated.') : 'Follow-up saved.');
});

$('[data-action="delete"]', fuForm).addEventListener('click', async () => {
  const id = fuForm.elements.id.value;
  if (!(await confirmDialog('Delete this follow-up for everyone? This cannot be undone.', 'Delete'))) return;
  const res = await db(() => sb.from('followups').delete().eq('id', id).select());
  if (res.ok && !res.data.length) res.ok = false, res.error = dbErrorMessage({ code: 'PGRST116' });
  if (!res.ok) return showFormError(fuForm, res.error);
  state.followups = state.followups.filter((f) => f.id !== id);
  render();
  fuDialog.close();
  toast('Follow-up deleted.');
});

/* ----- Resource dialog ----- */

const resDialog = $('#res-dialog');
const resForm = $('#res-form');

function openResDialog(res) {
  if (!isAdmin) return toast('Only the dashboard admin can change resources.', 'error');
  resForm.reset();
  clearInvalid(resForm);
  const editing = !!res;
  $('#res-dialog-title').textContent = editing ? 'Edit resource' : 'New resource';
  $('[data-action="delete"]', resForm).hidden = !editing;
  setFormValues(resForm, res || { id: '', name: '', url: '', group: 'Work systems', tags: '', notes: '' });
  resDialog.showModal();
  resForm.elements.name.focus();
}

resForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearInvalid(resForm);
  if (!requireFields(resForm, ['name', 'url'])) return;
  const v = Object.fromEntries(new FormData(resForm));
  let url = v.url.trim();
  // Turn bare domains into links; leave phone numbers and plain text as contact info.
  if (!safeUrl(url) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url)) url = 'https://' + url;
  const rec = { name: v.name.trim(), url, group: v.group, tags: v.tags.trim(), notes: v.notes.trim() };
  const btn = $('button[type="submit"]', resForm);
  setBusy(btn, true, 'Saving…');
  const res = await db(() => (v.id
    ? sb.from('resources').update({ ...resToRow(rec), updated_at: new Date().toISOString() }).eq('id', v.id).select().single()
    : sb.from('resources').insert(resToRow(rec)).select().single()));
  setBusy(btn, false);
  if (!res.ok) return showFormError(resForm, `${res.error} Your entry has been kept — try saving again.`);
  const saved = resFromRow(res.data);
  const i = state.resources.findIndex((r) => r.id === saved.id);
  if (i >= 0) state.resources[i] = saved; else state.resources.push(saved);
  render();
  resDialog.close();
  toast('Resource saved for everyone.');
});

$('[data-action="delete"]', resForm).addEventListener('click', async () => {
  const id = resForm.elements.id.value;
  if (!(await confirmDialog('Delete this resource for everyone?', 'Delete'))) return;
  const res = await db(() => sb.from('resources').delete().eq('id', id).select());
  if (res.ok && !res.data.length) res.ok = false, res.error = dbErrorMessage({ code: 'PGRST116' });
  if (!res.ok) return showFormError(resForm, res.error);
  state.resources = state.resources.filter((x) => x.id !== id);
  commit((s) => { s.pins = s.pins.filter((p) => p !== id); });
  render();
  resDialog.close();
  toast('Resource deleted.');
});

/* One-time move of the resources older versions kept in this browser into Supabase.
   Skips any that are already in the shared list and carries the browser's pins across. */
async function uploadLegacyResources(btn) {
  const key = (r) => `${r.name.trim().toLowerCase()}|${String(r.url).trim().toLowerCase()}`;
  const existing = new Set(state.resources.map(key));
  const toAdd = state.legacyResources.filter((r) => r.name && r.url && !existing.has(key(r)));
  setBusy(btn, true, 'Copying…');
  const res = toAdd.length ? await db(() => sb.from('resources').insert(toAdd.map(resToRow)).select()) : { ok: true, data: [] };
  setBusy(btn, false);
  if (!res.ok) return toast(`${res.error} Nothing was copied.`, 'error');
  const added = res.data.map(resFromRow);
  state.resources.push(...added);
  const all = new Map(state.resources.map((r) => [key(r), r.id]));
  const pinIds = state.legacyResources.filter((r) => r.pinned).map((r) => all.get(key(r))).filter(Boolean);
  const r = commit((s) => { s.legacyResources = []; s.pins = [...new Set([...s.pins, ...pinIds])]; });
  if (!r.ok) toast(r.error, 'error');
  toast(`Copied ${added.length} resource${added.length === 1 ? '' : 's'} to the shared list.`);
}

/* ----- Shift note generator ----- */

const noteDialog = $('#note-dialog');

/* The note is built as structured blocks (paragraphs, headings, nested bullets with
   bold/underlined runs) so it can be rendered as formatted HTML for Outlook and as plain text. */

const run = (text, fmt = '') => ({ text, b: fmt.includes('b'), u: fmt.includes('u') });
const bullet = (runs, children = []) => ({ runs, children });
// Resident suggestions used to be "E02 — Dana Fox"; the note uses "E02 Dana Fox".
const who = (unit) => String(unit || '').replace(/\s+—\s+/, ' ').trim();

function buildShiftNote(date, shift) {
  const logs = state.logs
    .filter((l) => l.date === date && (!shift || l.shift === shift))
    .sort((a, b) => (SHIFT_RANK[a.shift] ?? 0) - (SHIFT_RANK[b.shift] ?? 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const entries = (section, subtype) => logs.filter((l) => l.section === section && (!subtype || l.subtype === subtype));

  const blocks = [];
  const para = (...runs) => blocks.push({ type: 'p', runs });
  const blank = () => blocks.push({ type: 'blank' });
  const heading = (text) => { blank(); para(run(text, 'bu')); };
  const list = (items) => blocks.push({ type: 'list', items });

  const labelled = (label, text) => bullet([run(label, 'b'), run(` ${text}`)]);
  const pending = (l, ifEmpty) => (l.pendingAction || ifEmpty ? [labelled('Pending:', l.pendingAction || ifEmpty)] : []);
  const category = (label, children) => (children.length
    ? bullet([run(label, 'b')], children)
    : bullet([run(label, 'b'), run(' NA', 'b')]));
  const vendorLine = (l) => {
    const name = who(l.unit);
    const text = l.actionTaken;
    if (!name || text.toLowerCase().startsWith(name.toLowerCase())) return text;
    // "White Rose" + "On site for cleaning." -> "White Rose on site for cleaning."
    return `${name} ${/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text}`;
  };

  para(run('Hi Team,'));
  blank();
  para(run(`Please see shift notes for ${SHIFT_NOTE.property}.`));

  /* Operations and Events: the four standard subsections, then any general operations updates. */
  heading('Operations and Events');
  const ops = 'operations_events';
  list([
    category('Logs and Trackers:', entries(ops, 'logs_trackers').map((l) =>
      bullet([run(`${who(l.unit)}: ${l.actionTaken}`)], pending(l)))),
    category('Vendors/Contractors:', entries(ops, 'vendor_contractor').map((l) =>
      bullet([run(vendorLine(l))], [...(l.description ? [bullet([run(l.description)])] : []), ...pending(l)]))),
    category('Guest Suite(s):', entries(ops, 'guest_suite').map((l) =>
      bullet([run(`Upcoming Check-in${l.checkIn ? ` – ${fmtDate(l.checkIn, { month: 'long', day: 'numeric' })}` : ''}:`)], [
        bullet([run(`Booked by: ${who(l.unit)}`)]),
        ...(l.guestSuite ? [bullet([run(`Guest Suite: ${l.guestSuite}`)])] : []),
        bullet([run(l.actionTaken)]),
        ...pending(l),
      ]))),
    category('Event(s):', entries(ops, 'event').map((l) => bullet([run(`${who(l.unit)}: ${l.actionTaken}`)], pending(l)))),
    ...entries(ops, 'general_operations').map((l) => bullet([run(l.actionTaken)], pending(l))),
  ]);

  heading('Resident Experience (Completed and Upcoming 120 Days of Resident Touchpoints)');
  const experience = entries('resident_experience').map((l) => {
    if (l.subtype !== 'resident_touchpoint') return bullet([run(l.actionTaken)], pending(l));
    const t = l.details?.touchpoint;
    return bullet([run(`${who(l.unit)}:`, 'b'), run(` ${t && t !== 'Other' ? `${t} touchpoint – ` : ''}${l.actionTaken}`)], pending(l));
  });
  list(experience.length ? experience : [bullet([run('No calls made tonight, will resume tomorrow.', 'b')])]);

  heading('Fitz Gifts:');
  const gifts = entries('fitz_gifts').map((l) => {
    const d = l.details || {};
    const gift = d.gift ? `${d.gift}${d.giftStatus ? ` – ${d.giftStatus}` : ''}.` : '';
    return bullet([run(`${who(l.unit)}:`, 'b'), run(` ${[gift, l.actionTaken].filter(Boolean).join(' ')}`)], pending(l));
  });
  list(gifts.length ? gifts : [bullet([run('NA', 'b')])]);

  heading('Residents and Guests');
  const residents = entries('residents_guests').map((l) =>
    bullet([run(`${who(l.unit)}:`, 'b'), run(` ${l.description || l.actionTaken}`)], [
      ...(l.description && l.actionTaken ? [labelled('Action:', l.actionTaken)] : []),
      ...pending(l, 'None.'),
    ]));
  // Each resident gets its own list with a blank line between, so entries are easy to scan.
  if (!residents.length) list([bullet([run('NA', 'b')])]);
  residents.forEach((item, i) => {
    if (i) blank();
    list([item]);
  });

  heading('Amenities, Common Areas and Curb Appeal');
  const areas = new Map(); // entries for the same area share one bullet
  entries('amenities_common_areas').forEach((l) => {
    const name = who(l.unit);
    const key = name.toLowerCase();
    if (!areas.has(key)) areas.set(key, bullet([run(`${name}:`, 'b')]));
    const children = areas.get(key).children;
    if (l.description) {
      children.push(labelled('Status:', l.description));
      if (l.actionTaken) children.push(labelled('Action:', l.actionTaken));
    } else if (l.actionTaken) {
      children.push(labelled('Concern:', l.actionTaken)); // logs saved before the Status field existed
    }
    if (l.pendingAction) children.push(labelled('To-Do:', l.pendingAction));
  });
  list([...areas.values(), bullet([run('All other amenities in good condition.')])]);

  // Open follow-ups, grouped by the team that owns them.
  heading('Outstanding Follow-ups');
  const open = sortFollowups(state.followups.filter((f) => f.status !== 'Done'));
  const teams = OPTIONS.teams
    .map((team) => [team, open.filter((f) => f.owner === team)])
    .filter(([, items]) => items.length)
    .map(([team, items]) => bullet([run(`${team}:`, 'b')], items.map((f) => {
      const when = isOverdue(f) ? `Overdue – was due ${fmtDate(f.dueDate, { month: 'long', day: 'numeric' })}`
        : f.dueDate === today() ? 'Due today'
        : `Due ${fmtDate(f.dueDate, { month: 'long', day: 'numeric' })}`;
      return bullet([run(`${f.unit ? `${who(f.unit)} – ` : ''}${f.title} (${when}${f.priority === 'High' ? ', high priority' : ''})`)],
        f.nextAction ? [bullet([run('Next:', 'b'), run(` ${f.nextAction}`)])] : []);
    })));
  list(teams.length ? teams : [bullet([run('NA', 'b')])]);

  blank();
  para(run('Kind Regards,'));
  return blocks;
}

/* Inline styles only, so the formatting survives pasting into Outlook. */
const NOTE_FONT = 'font-family:Calibri,Carlito,Arial,sans-serif;font-size:11pt;color:#000000';
const NOTE_BULLETS = ['disc', 'circle', 'square'];

function noteRunsHtml(runs) {
  return runs.map((r) => {
    let h = esc(r.text);
    if (r.u) h = `<u>${h}</u>`;
    if (r.b) h = `<b>${h}</b>`;
    return h;
  }).join('');
}

function noteListHtml(items, depth) {
  return `<ul style="margin-top:0;margin-bottom:0;padding-left:0.3in;list-style-type:${NOTE_BULLETS[Math.min(depth, 2)]}">` +
    items.map((it) => `<li style="margin:0">${noteRunsHtml(it.runs)}${it.children.length ? noteListHtml(it.children, depth + 1) : ''}</li>`).join('') +
    '</ul>';
}

function noteHtml(blocks) {
  return `<div style="${NOTE_FONT}">` + blocks.map((b) => {
    if (b.type === 'blank') return '<p style="margin:0">&nbsp;</p>';
    if (b.type === 'p') return `<p style="margin:0">${noteRunsHtml(b.runs)}</p>`;
    return noteListHtml(b.items, 0);
  }).join('') + '</div>';
}

function notePlain(blocks) {
  const out = [];
  const symbols = ['•', '○', '▪'];
  const walk = (items, depth) => items.forEach((it) => {
    out.push(`${'    '.repeat(depth)}${symbols[Math.min(depth, 2)]} ${it.runs.map((r) => r.text).join('')}`);
    walk(it.children, depth + 1);
  });
  blocks.forEach((b) => {
    if (b.type === 'blank') out.push('');
    else if (b.type === 'p') out.push(b.runs.map((r) => r.text).join(''));
    else walk(b.items, 0);
  });
  return out.join('\n');
}

function refreshNote() {
  $('#note-preview').innerHTML = noteHtml(buildShiftNote($('#note-date').value || today(), $('#note-shift').value));
}

/* True if this computer can draw Calibri in bold (bold text measures wider than regular). */
function calibriBoldAvailable() {
  const ctx = document.createElement('canvas').getContext('2d');
  const sample = 'Operations and Events';
  ctx.font = '11pt Calibri';
  const regular = ctx.measureText(sample).width;
  ctx.font = 'bold 11pt Calibri';
  return Math.abs(ctx.measureText(sample).width - regular) > 0.5;
}

function openNoteDialog() {
  $('#note-preview').classList.toggle('fake-bold', !calibriBoldAvailable());
  $('#note-date').value = today();
  $('#note-shift').value = currentShift();
  refreshNote();
  noteDialog.showModal();
  $('#note-copy').focus();
}

$('#note-date').addEventListener('change', refreshNote);
$('#note-shift').addEventListener('change', refreshNote);

/* Copies the (possibly edited) preview as formatted HTML, with plain text as a fallback format. */
$('#note-copy').addEventListener('click', async () => {
  const preview = $('#note-preview');
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([preview.innerHTML], { type: 'text/html' }),
      'text/plain': new Blob([preview.innerText], { type: 'text/plain' }),
    })]);
  } catch (_) {
    const range = document.createRange();
    range.selectNodeContents(preview);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
  }
  toast('Shift note copied. Paste it into Outlook.');
});

/* ----- Data dialog ----- */

const dataDialog = $('#data-dialog');

function openDataDialog() {
  $('#data-stats').textContent =
    `Shared database: ${state.logs.length} shift logs · ${state.followups.length} follow-ups · ` +
    `${state.notices.length} notices · ${state.resources.length} resources.`;
  showFormError(dataDialog, '');
  dataDialog.showModal();
}

$('#data-btn').addEventListener('click', openDataDialog);

$('#export-btn').addEventListener('click', () => {
  const { logs, followups, notices, resources } = state;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), logs, followups, notices, resources }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `concierge-dashboard-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup exported.');
});

/* ----- Login (Supabase Auth) ----- */

const loginDialog = $('#login-dialog');
const loginForm = $('#login-form');
const authConfigured = !!window.supabase && !/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
const sb = authConfigured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function authSetupError() {
  return window.supabase
    ? 'Sign-in is not set up yet: add your Supabase URL and anon key to config.js.'
    : 'Could not load the sign-in service. Check your connection and refresh.';
}

function showLogin() {
  document.body.classList.add('signed-out');
  $('#account-email').textContent = '';
  $('#signout-btn').hidden = true;
  occupants = [];
  clearCloud();
  render();
  $('#occupant-list').innerHTML = '';
  $$('dialog[open]').forEach((d) => { if (d !== loginDialog) d.close(); });
  loginForm.reset();
  clearInvalid(loginForm);
  if (!sb) showFormError(loginForm, authSetupError());
  if (!loginDialog.open) loginDialog.showModal();
  loginForm.elements.email.focus();
}

function onSignedIn(session) {
  document.body.classList.remove('signed-out');
  if (loginDialog.open) loginDialog.close();
  $('#account-email').textContent = session.user.email || '';
  $('#signout-btn').hidden = false;
  currentUser = { id: session.user.id, email: session.user.email || '' };
  loadOccupants();
  loadCloud();
  loadResources();
  loadFollowups();
}

/* Fills the "Unit or name" suggestions from the occupant_report table.
   Supabase returns at most 1000 rows per request, so this pages through. */
async function loadOccupants() {
  const PAGE = 1000;
  const rows = [];
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from('occupant_report')
        .select('unit, first_name, last_name, tenant_category')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
  } catch (err) {
    console.error('Could not load occupants:', err);
    toast('Could not load the resident list. You can still type units and names manually.', 'error');
    return;
  }
  if (!rows.length) {
    toast('Resident list is empty — check the occupant_report SELECT policy in Supabase.', 'error');
    return;
  }
  rows.sort((a, b) =>
    String(a.unit ?? '').localeCompare(String(b.unit ?? ''), undefined, { numeric: true }) ||
    String(a.last_name ?? '').localeCompare(String(b.last_name ?? '')));
  occupants = rows;
  if (currentView() === 'search') render();
  $('#occupant-list').innerHTML = rows.map((r) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
    const value = [r.unit, name].filter(Boolean).join(' ');
    return value ? `<option value="${esc(value)}">${esc(r.tenant_category || '')}</option>` : '';
  }).join('');
}

// Esc would otherwise close the dialog and reveal the dashboard.
loginDialog.addEventListener('cancel', (e) => e.preventDefault());

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearInvalid(loginForm);
  if (!sb) return showFormError(loginForm, authSetupError());
  if (!requireFields(loginForm, ['email', 'password'])) return;
  const btn = $('button[type="submit"]', loginForm);
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: loginForm.elements.email.value.trim(),
      password: loginForm.elements.password.value,
    });
    if (error) {
      loginForm.elements.password.value = '';
      loginForm.elements.password.focus();
      showFormError(loginForm, /invalid login credentials/i.test(error.message) ? 'Incorrect email or password.' : error.message);
      return;
    }
    onSignedIn(data.session);
    toast('Signed in.');
  } catch (_) {
    showFormError(loginForm, 'Could not reach the sign-in server. Check your connection and try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

$('#signout-btn').addEventListener('click', async () => {
  try { await sb.auth.signOut(); } catch (_) { /* still show the login below */ }
  showLogin();
  toast('Signed out.');
});

/* ---------- Main event delegation ---------- */

const main = $('#main');

main.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT') return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'new-log': return openLogDialog();
    case 'new-log-for':
      openLogDialog(null, { section: 'residents_guests', unit: el.dataset.unit });
      return logForm.elements.description?.focus();
    case 'new-fu-for':
      openFuDialog();
      fuForm.elements.unit.value = el.dataset.unit;
      return;
    case 'edit-log': return openLogDialog(state.logs.find((l) => l.id === id));
    case 'new-fu': return openFuDialog();
    case 'edit-fu': return openFuDialog(state.followups.find((f) => f.id === id));
    case 'done-fu': return openFuDialog(state.followups.find((f) => f.id === id), { status: 'Done' });
    case 'new-res': return openResDialog();
    case 'edit-res': return openResDialog(state.resources.find((r) => r.id === id));
    case 'shift-note': return openNoteDialog();
    case 'set-team': ui.team = el.dataset.team; return render();
    case 'goto-fu': {
      const f = JSON.parse(el.dataset.filter);
      ui.fuFilters = { q: '', owner: f.owner || '', status: f.status || 'active', priority: f.priority || '', category: '' };
      location.hash = 'followups';
      return;
    }
    case 'pin-res': {
      const r = commit((s) => { s.pins = s.pins.includes(id) ? s.pins.filter((p) => p !== id) : [...s.pins, id]; });
      if (!r.ok) toast(r.error, 'error');
      else main.querySelector(`[data-action="pin-res"][data-id="${id}"]`)?.focus();
      return;
    }
    case 'del-notice': {
      el.disabled = true;
      db(() => sb.from('notices').delete().eq('id', id).select()).then((res) => {
        if (res.ok && !res.data.length) res.ok = false, res.error = dbErrorMessage({ code: 'PGRST116' });
        if (!res.ok) { el.disabled = false; return toast(res.error, 'error'); }
        state.notices = state.notices.filter((n) => n.id !== id);
        render();
        toast('Notice dismissed.');
        $('#notice-input')?.focus();
      });
      return;
    }
    case 'retry-cloud': return loadCloud();
    case 'retry-res': return loadResources();
    case 'retry-fu': return loadFollowups();
    case 'upload-legacy-fu': return uploadLegacyFollowups(el);
    case 'discard-legacy-fu':
      confirmDialog(`Discard the ${state.legacyFollowups.length} follow-ups saved only in this browser? The shared list is not affected.`, 'Discard').then((yes) => {
        if (!yes) return;
        const r = commit((st) => { st.legacyFollowups = []; });
        toast(r.ok ? 'Browser-only follow-ups discarded.' : r.error, r.ok ? 'ok' : 'error');
      });
      return;
    case 'upload-legacy-res': return uploadLegacyResources(el);
    case 'discard-legacy-res':
      confirmDialog(`Discard the ${state.legacyResources.length} resources saved only in this browser? The shared list is not affected.`, 'Discard').then((yes) => {
        if (!yes) return;
        const r = commit((s) => { s.legacyResources = []; });
        toast(r.ok ? 'Browser-only resources discarded.' : r.error, r.ok ? 'ok' : 'error');
      });
      return;
    case 'clear-log-filters':
      ui.logFilters = { q: '', section: '', shift: '', from: '', to: '' };
      return render();
    case 'clear-fu-filters':
      ui.fuFilters = { q: '', owner: '', status: 'active', priority: '', category: '' };
      return render();
  }
});

main.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'set-status') {
    const f = state.followups.find((x) => x.id === el.dataset.id);
    if (!f) return;
    if (el.value === 'Done' && !f.resolution) {
      el.value = f.status;
      return openFuDialog(f, { status: 'Done' });
    }
    const status = el.value;
    el.disabled = true;
    db(() => sb.from('followups').update({ status, updated_at: new Date().toISOString() }).eq('id', f.id).select().single()).then((res) => {
      el.disabled = false;
      if (!res.ok) { el.value = f.status; return toast(res.error, 'error'); }
      Object.assign(f, fuFromRow(res.data));
      render();
      toast(`Status changed to ${status}.`);
      main.querySelector(`#st-${f.id}`)?.focus();
    });
  }
});

main.addEventListener('input', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  const { name, value } = e.target;
  if (form.dataset.form === 'log-filters') ui.logFilters[name] = value;
  else if (form.dataset.form === 'fu-filters') ui.fuFilters[name] = value;
  else if (form.dataset.form === 'res-filters') ui.resQuery = value;
  else return;
  render();
});

main.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form !== 'notice') return;
  const input = form.elements.text;
  const text = input.value.trim();
  if (!text) return input.focus();
  const btn = $('button[type="submit"]', form);
  setBusy(btn, true, 'Adding…');
  const res = await db(() => sb.from('notices').insert({ text, date: today() }).select().single());
  setBusy(btn, false);
  // On failure the typed text stays in the box so it can be retried.
  if (!res.ok) return toast(`${res.error} Your notice was not saved.`, 'error');
  state.notices.push(noticeFromRow(res.data));
  render();
  toast('Notice added.');
  $('#notice-input')?.focus();
});

/* ---------- Global search ---------- */

const searchInput = $('#global-search');
let previousView = 'overview';

searchInput.addEventListener('input', () => {
  ui.searchQ = searchInput.value;
  if (ui.searchQ.trim()) {
    if (currentView() !== 'search') {
      previousView = currentView();
      location.hash = 'search';
    } else render();
  } else if (currentView() === 'search') {
    location.hash = previousView;
  }
});

$('#global-search-form').addEventListener('submit', (e) => e.preventDefault());

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    searchInput.blur();
  }
});

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
  if (typing || document.querySelector('dialog[open]')) return;
  if (e.key === '/') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); openLogDialog(); }
  else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); openFuDialog(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNoteDialog(); }
});

/* Pick up teammates' new logs and notices when coming back to the tab. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cloudStatus === 'ready' && Date.now() - lastCloudLoad > 60000) {
    loadCloud({ quiet: true });
    loadResources({ quiet: true });
    loadFollowups({ quiet: true });
  }
});

/* ---------- Boot ---------- */

render();
loadWeather();
setInterval(loadWeather, 30 * 60 * 1000); // refresh every 30 minutes

if (sb) {
  sb.auth.getSession()
    .then(({ data }) => (data.session ? onSignedIn(data.session) : showLogin()))
    .catch(showLogin);
  // Covers sign-out in another tab and expired sessions.
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') showLogin(); });
} else {
  showLogin();
}
