'use strict';

/* ============================================================
   Config — edit this to point at your own decks.
   Add or remove entries as needed; each needs a unique id,
   a display name, and a path to a CSV file with a
   "front,back,id,active" header followed by one card per row.
   The id column is optional — a row without one just won't have
   review history tracked until you give it a number.
   The active column is optional too. Leave it out (or leave a
   row's value blank) and the card starts active. Set it to
   0 / no / false / off / inactive to have the card start
   deactivated — it'll still show in the deck preview, just
   grayed out, and won't be picked for quiz sessions until you
   tap it back on (which is remembered on this device, no need
   to edit the CSV again).

   Deck ids here must never start with "custom:" — that prefix is
   reserved for decks visitors upload themselves (stored in their own
   browser's localStorage, see the "Custom decks" section below), so
   built-in and uploaded decks can never collide.
   ============================================================ */
const DECKS = [
  { id: 'deck1', name: 'Deck 1', file: 'decks/deck1.csv' },
  { id: 'deck2', name: 'Deck 2', file: 'decks/deck2.csv' },
];

const COUNT_OPTIONS = [10, 25, 50, 100];

// The four grading buttons, worst to best.
const GRADE = Object.freeze({ MISSED: 0, HARD: 1, ALMOST: 2, GOT_IT: 3 });

// Deck-preview filter/sort cycle. Each mode both narrows *which* cards
// show and the order they show in:
//   original  - every card, ordered by its id number
//   weakest   - graded cards you haven't mastered ("Got it") yet, weakest first
//   strongest - only "Got it" / "Almost" cards, strongest first
//   nongraded - only cards you've never studied
//   active    - only active (non-skipped) cards
//   nonactive - only skipped cards
// Each label names the mode that's *currently* showing (tapping the
// button advances to the next one).
const SORT_MODES = ['original', 'weakest', 'strongest', 'nongraded', 'active', 'nonactive'];
const SORT_LABELS = {
  original: 'Original',
  weakest: 'Weaker',
  strongest: 'Strongest',
  nongraded: 'Non-graded',
  active: 'Active',
  nonactive: 'Non-active',
};

// Shown in place of the card list when a filter matches nothing.
const EMPTY_FILTER_MESSAGES = {
  weakest: 'No graded cards below "Got it" yet — try Non-graded, or start studying.',
  strongest: 'No cards are "Almost" or "Got it" yet — keep studying.',
  nongraded: 'Every card here has been studied at least once.',
  active: 'No active cards — everything here is switched off.',
  nonactive: 'Nothing is switched off — every card is active.',
};

// How many of a card's most recent graded attempts to average when
// deciding "how good am I at this" for the deck-preview color.
const HISTORY_WINDOW = 7;

/* ============================================================
   Tiny CSV parser — handles quoted fields, escaped quotes
   ("" inside a quoted field) and commas/newlines inside quotes.
   ============================================================ */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
      continue;
    }

    if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip, \n handles the line break */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += c; }
  }

  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim().length > 0));
}

// Reads the optional 4th CSV column. Blank/missing = active. Anything
// matching one of the "off" words below = starts deactivated.
const INACTIVE_WORDS = new Set(['0', 'no', 'false', 'off', 'inactive', 'n']);
function parseActiveDefault(raw) {
  if (raw === undefined || raw === null) return true;
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return true;
  return !INACTIVE_WORDS.has(v);
}

function csvToCards(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  // Drop a header row if it looks like one (front/back, case-insensitive).
  const first = rows[0].map(c => c.trim().toLowerCase());
  const startIndex = (first[0] === 'front' && first[1] === 'back') ? 1 : 0;

  const cards = [];
  for (let i = startIndex; i < rows.length; i++) {
    const [front, back, id, active] = rows[i];
    if (front && front.trim() && back && back.trim()) {
      const trimmedId = (id !== undefined && id !== null) ? id.trim() : '';
      cards.push({
        front: front.trim(),
        back: back.trim(),
        // Rows without an id still work — they just fall back to a
        // content-based key below, so history isn't tracked until
        // you assign one.
        id: trimmedId.length > 0 ? trimmedId : null,
        // The CSV's starting active/inactive state. A checkbox in the
        // deck preview can override this per device — see isCardActive().
        activeDefault: parseActiveDefault(active),
      });
    }
  }
  return cards;
}

/* ============================================================
   Review history — localStorage, one append-only log per card.
   Key is deck + id (or a content hash when a card has no id yet),
   so ids only need to be unique within their own deck's CSV.
   ============================================================ */
function hashString(str) {
  // FNV-1a — fast, deterministic, good enough to key a card by its text.
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cardStorageKey(deckId, card) {
  if (card.id !== null && card.id !== undefined && String(card.id).length > 0) {
    return `recall:${deckId}:card:${card.id}`;
  }
  return `recall:${deckId}:temp:${hashString(card.front + '\u241F' + card.back)}`;
}

function loadCardHistory(deckId, card) {
  try {
    const raw = localStorage.getItem(cardStorageKey(deckId, card));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function recordGrade(deckId, card, grade) {
  const key = cardStorageKey(deckId, card);
  const history = loadCardHistory(deckId, card);
  history.push({ grade, timestamp: Date.now() });
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch (err) {
    // Storage full or unavailable (e.g. private browsing) — the
    // session still works fine, it just won't remember this attempt.
  }
}

// Removes the most recent recorded attempt for a card — the other
// half of recordGrade(), used when Undo needs to take back a grade
// instead of layering a correction on top of the mistaken one.
function removeLastGradeRecord(deckId, card) {
  const key = cardStorageKey(deckId, card);
  const history = loadCardHistory(deckId, card);
  if (history.length === 0) return;
  history.pop();
  try {
    if (history.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(history));
    }
  } catch (err) {
    // Storage unavailable — nothing to clean up in that case anyway.
  }
}

// Average of a card's last HISTORY_WINDOW graded attempts, as a 0–3
// number. null means "never studied" — nothing to average yet.
function cardScore(deckId, card) {
  const history = loadCardHistory(deckId, card);
  if (history.length === 0) return null;
  const recent = history.slice(-HISTORY_WINDOW);
  const sum = recent.reduce((total, entry) => total + entry.grade, 0);
  return sum / recent.length;
}

// Rounds a card's average score to the nearest grade, so filters like
// "weakest"/"strongest" can classify it as e.g. "Got it" even though
// the raw average is rarely a clean integer. null (never studied)
// passes through unchanged — it isn't any bucket.
function scoreBucket(score) {
  return score === null ? null : Math.round(score);
}

// Sort key for "original order": numeric id ascending, with un-numbered
// cards (no id yet) pushed after every numbered one.
function idSortKey(card) {
  const n = card.id !== null ? Number(card.id) : NaN;
  return Number.isFinite(n) ? n : Infinity;
}

// A fresh id for a manually added (or newly-assigned-on-edit) card:
// one past the highest existing numeric id in the deck, bumped
// further if that string somehow collides with an existing one
// (e.g. a deck with sparse or non-numeric ids).
function nextCardId(cards) {
  let max = 0;
  cards.forEach(c => {
    if (c.id === null || c.id === undefined) return; // Number(null) is 0 — would corrupt the max
    const n = Number(c.id);
    if (Number.isFinite(n) && n > max) max = n;
  });
  let candidate = max + 1;
  const existingIds = new Set(cards.map(c => String(c.id)));
  while (existingIds.has(String(candidate))) candidate++;
  return String(candidate);
}

/* ============================================================
   Active/inactive overrides — a checkbox in the deck preview lets
   you bench a card without touching the CSV. Stored per device,
   same key shape as review history. Only *overrides* of the CSV's
   activeDefault are written, and a toggle back to matching the
   default removes the override again — so editing the CSV later
   still "wins" for any card you haven't deliberately flipped.
   ============================================================ */
function cardActiveKey(deckId, card) {
  if (card.id !== null && card.id !== undefined && String(card.id).length > 0) {
    return `recall:${deckId}:active:${card.id}`;
  }
  return `recall:${deckId}:activeTemp:${hashString(card.front + '\u241F' + card.back)}`;
}

function loadActiveOverride(deckId, card) {
  try {
    const raw = localStorage.getItem(cardActiveKey(deckId, card));
    if (raw === null) return null; // no override — defer to the CSV
    return raw === '1';
  } catch (err) {
    return null;
  }
}

function isCardActive(deckId, card) {
  const override = loadActiveOverride(deckId, card);
  return override === null ? card.activeDefault : override;
}

function setCardActive(deckId, card, active) {
  const key = cardActiveKey(deckId, card);
  try {
    if (active === card.activeDefault) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, active ? '1' : '0');
    }
  } catch (err) {
    // Storage full or unavailable — the checkbox still visually
    // updates for this session, it just won't be remembered.
  }
}

function getActiveCards(deckId) {
  return state.decks[deckId].cards.filter(card => isCardActive(deckId, card));
}

/* ============================================================
   Custom decks — uploaded via the deck-select screen, stored
   entirely in this browser's localStorage (never shared with
   anyone else). A registry key lists every custom deck's id/name;
   each deck's parsed cards live under their own key. Both use the
   same "recall:" prefix as everything else so a single sweep can
   clean up a deleted deck's cards *and* its history/overrides
   (which already share the "recall:<deckId>:" prefix below).
   ============================================================ */
const CUSTOM_DECK_REGISTRY_KEY = 'recall:customDecks';

// Turns a display name into a stable, URL-safe id fragment. Falls
// back to a timestamp when the name has no letters/digits at all
// (e.g. "!!!"), so two such decks don't collide with each other.
function slugify(name) {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : `deck-${Date.now().toString(36)}`;
}

// A custom deck's id is derived from its name rather than random,
// so re-uploading a CSV under the same name reuses the same id —
// which is what makes that count as "updating" the deck (same id
// -> same recall:<id>:card:* keys -> progress carries over) instead
// of creating an unrelated duplicate.
function customDeckId(name) {
  return `custom:${slugify(name)}`;
}

function customDeckCardsKey(deckId) {
  return `recall:${deckId}:cards`;
}

function loadCustomDeckRegistry() {
  try {
    const raw = localStorage.getItem(CUSTOM_DECK_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

// Returns false on failure (e.g. storage quota exceeded) so callers
// can tell the user rather than silently losing their upload.
function saveCustomDeckRegistry(registry) {
  try {
    localStorage.setItem(CUSTOM_DECK_REGISTRY_KEY, JSON.stringify(registry));
    return true;
  } catch (err) {
    return false;
  }
}

// Same {cards} / {error:true, cards:[]} shape loadDeck()'s fetch
// path returns, so renderDeckList()'s result handling (is-error /
// no-cards-found / count text) works unmodified for custom decks.
function loadCustomDeckCards(deckId) {
  try {
    const raw = localStorage.getItem(customDeckCardsKey(deckId));
    if (!raw) return { error: true, cards: [] };
    const cards = JSON.parse(raw);
    return Array.isArray(cards) ? { cards } : { error: true, cards: [] };
  } catch (err) {
    return { error: true, cards: [] };
  }
}

function saveCustomDeckCards(deckId, cards) {
  try {
    localStorage.setItem(customDeckCardsKey(deckId), JSON.stringify(cards));
    return true;
  } catch (err) {
    return false;
  }
}

// Every key belonging to a deck — its cards, and (since they share
// the same "recall:<deckId>:" prefix) every graded-history and
// active-override entry for its cards — is removed in one sweep.
// Collecting matching keys before removing them avoids skipping
// entries, since localStorage.length shrinks as you remove things.
function deleteDeckStorage(deckId) {
  const prefix = `recall:${deckId}:`;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keysToRemove.push(key);
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}

// The unified deck list the rest of the app renders from: every
// built-in deck plus every custom one, in that order. Downstream
// code (state.decks[id], getActiveCards, renderDeckPreview, session
// start) only ever reads .id/.name/.cards, never .file, so a custom
// deck config with no .file works everywhere a built-in one does.
function getAllDeckConfigs() {
  return DECKS.concat(loadCustomDeckRegistry().map(d => ({ id: d.id, name: d.name, custom: true })));
}

// Rose (Missed) -> Amber (Hard) -> Lime (Almost) -> Mint (Got it!),
// interpolated continuously rather than snapped to four hard buckets.
const SCORE_COLOR_STOPS = [
  [224, 128, 152], // 0
  [224, 171, 124], // 1
  [214, 218, 142], // 2
  [122, 217, 196], // 3
];

function scoreToColor(score) {
  const t = Math.max(0, Math.min(3, score));
  const seg = Math.min(2, Math.floor(t));
  const frac = t - seg;
  const [r1, g1, b1] = SCORE_COLOR_STOPS[seg];
  const [r2, g2, b2] = SCORE_COLOR_STOPS[seg + 1];
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   State
   ============================================================ */
const state = {
  decks: {},           // id -> { cards: [...] } | { error: true }
  activeDeck: null,     // deck config currently selected
  sessionCards: [],
  index: 0,
  correct: 0,
  missed: [],
  flipped: false,
  previewSort: 'original', // 'original' | 'weakest' | 'strongest' | 'nongraded' | 'active' | 'nonactive'
  previewVisibleCards: [], // cards the current preview filter is showing, kept in sync by renderDeckPreview() — what "Play these" studies
  history: [],           // stack of { index, grade } — one entry per graded card, for Undo
};

/* ============================================================
   Screen switching
   ============================================================ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  // The scroll-top arrow lives outside every .screen (see index.html)
  // so it isn't hidden automatically by switching screens, and
  // window.scrollTo(0,0) above won't fire a 'scroll' event if we were
  // already at the top — re-check its visibility explicitly.
  updateScrollTopVisibility();
}

/* ============================================================
   Confirm modal — small dialog reused for three things:
   showConfirm() (message + Yes/Cancel, resolves true/false),
   showPrompt() (message + one text field, resolves the trimmed
   string or null), and showCardForm() (message + Front/Back
   fields, resolves {front, back} or null).
   ============================================================ */
const confirmOverlayEl = document.getElementById('confirmOverlay');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmInputEl = document.getElementById('confirmInput');
const confirmCardFieldsEl = document.getElementById('confirmCardFields');
const confirmFrontEl = document.getElementById('confirmFront');
const confirmBackEl = document.getElementById('confirmBack');
const confirmCancelBtnEl = document.getElementById('confirmCancelBtn');
const confirmOkBtnEl = document.getElementById('confirmOkBtn');
let resolveModal = null;

// The one dialog behind showConfirm()/showPrompt()/showCardForm().
// `inputValue` (even as '') shows the single text field; `cardFields`
// shows the Front/Back pair instead — the two are mutually exclusive,
// and every call resets both regions so no state leaks in from a
// previous, differently-shaped use of the dialog. `showCancel: false`
// hides the Cancel button, for a plain one-button "OK" alert where a
// second dismiss button would just be a redundant twin of the first.
function openModal({ message, inputValue = null, cardFields = null, okLabel = 'Yes, do it', cancelLabel = 'Cancel', showCancel = true }) {
  confirmMessageEl.textContent = message;
  confirmOkBtnEl.textContent = okLabel;
  confirmCancelBtnEl.textContent = cancelLabel;
  confirmCancelBtnEl.hidden = !showCancel;

  confirmInputEl.hidden = true;
  confirmInputEl.value = '';
  confirmCardFieldsEl.hidden = true;
  confirmOkBtnEl.disabled = false;

  if (cardFields !== null) {
    confirmCardFieldsEl.hidden = false;
    confirmFrontEl.value = cardFields.front || '';
    confirmBackEl.value = cardFields.back || '';
    updateCardFormValidity();
    requestAnimationFrame(() => { confirmFrontEl.focus(); confirmFrontEl.select(); });
  } else if (inputValue !== null) {
    confirmInputEl.hidden = false;
    confirmInputEl.value = inputValue;
    confirmOkBtnEl.disabled = inputValue.trim().length === 0;
    // Wait a tick so the browser lays out the just-unhidden field
    // before focusing/selecting it.
    requestAnimationFrame(() => { confirmInputEl.focus(); confirmInputEl.select(); });
  }

  confirmOverlayEl.hidden = false;
  return new Promise(resolve => { resolveModal = resolve; });
}

function closeModal(result) {
  if (confirmOverlayEl.hidden) return;
  confirmOverlayEl.hidden = true;
  if (resolveModal) {
    resolveModal(result);
    resolveModal = null;
  }
}

function showConfirm(message, okLabel = 'Yes, do it', { showCancel = true } = {}) {
  return openModal({ message, okLabel, showCancel }).then(result => result === true);
}

function showPrompt(message, defaultValue) {
  return openModal({ message, inputValue: defaultValue, okLabel: 'Save' })
    .then(result => (result === false ? null : result));
}

function showCardForm(message, { front = '', back = '' } = {}, okLabel = 'Save') {
  return openModal({ message, cardFields: { front, back }, okLabel })
    .then(result => (result === false ? null : result));
}

function updateCardFormValidity() {
  confirmOkBtnEl.disabled = confirmFrontEl.value.trim().length === 0 || confirmBackEl.value.trim().length === 0;
}

confirmCancelBtnEl.addEventListener('click', () => closeModal(false));
confirmOkBtnEl.addEventListener('click', () => {
  if (confirmOkBtnEl.disabled) return;
  if (!confirmCardFieldsEl.hidden) {
    closeModal({ front: confirmFrontEl.value.trim(), back: confirmBackEl.value.trim() });
  } else if (!confirmInputEl.hidden) {
    closeModal(confirmInputEl.value.trim());
  } else {
    closeModal(true);
  }
});
confirmOverlayEl.addEventListener('click', (e) => {
  if (e.target === confirmOverlayEl) closeModal(false);
});
confirmInputEl.addEventListener('input', () => {
  confirmOkBtnEl.disabled = confirmInputEl.value.trim().length === 0;
});
confirmInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !confirmOkBtnEl.disabled) {
    e.preventDefault();
    closeModal(confirmInputEl.value.trim());
  }
});
confirmFrontEl.addEventListener('input', updateCardFormValidity);
confirmBackEl.addEventListener('input', updateCardFormValidity);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !confirmOverlayEl.hidden) closeModal(false);
});

/* ============================================================
   Deck select screen
   ============================================================ */
const deckListEl = document.getElementById('deckList');
const streakCountEl = document.getElementById('streakCount');
const streakGridEl = document.getElementById('streakGrid');
const deckUploadBtnEl = document.getElementById('deckUploadBtn');
const deckFileInputEl = document.getElementById('deckFileInput');
const deckUploadErrorEl = document.getElementById('deckUploadError');

/* ============================================================
   Streak calendar — a small "how much have I studied" heatmap on
   the deck list. Needs no new tracking: recordGrade() never trims
   a card's history, so every grade ever given, with its real
   timestamp, is already sitting in localStorage under
   recall:<deckId>:card:<id>. This just reads it back out.
   ============================================================ */
const STREAK_WEEKS = 16;

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Every grade, across every deck (built-in or custom), bucketed by
// the calendar day it was given on. ":card:" only appears in the
// per-card history keys — not in a custom deck's own "...:cards"
// key or the "...:active:<id>" override keys — so a plain substring
// check is enough to pick out exactly the right keys.
function getDailyReviewCounts() {
  const counts = new Map();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('recall:') || !key.includes(':card:')) continue;
    let history;
    try {
      history = JSON.parse(localStorage.getItem(key));
    } catch (err) {
      continue;
    }
    if (!Array.isArray(history)) continue;
    history.forEach(entry => {
      if (!entry || typeof entry.timestamp !== 'number') return;
      const day = dateKey(new Date(entry.timestamp));
      counts.set(day, (counts.get(day) || 0) + 1);
    });
  }
  return counts;
}

// Consecutive days with at least one review, walking back from
// today. If today has none yet, that alone shouldn't zero out a
// streak that's still "alive" until the day actually ends, so the
// walk starts from yesterday instead in that case.
function computeCurrentStreak(counts) {
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!counts.get(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (counts.get(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// A GitHub-style level bucket for a day's review count, used to pick
// how saturated that cell's color is.
function streakLevel(count) {
  if (!count) return 0;
  if (count <= 5) return 1;
  if (count <= 15) return 2;
  if (count <= 30) return 3;
  return 4;
}

function renderStreakCalendar() {
  const counts = getDailyReviewCounts();
  streakCountEl.textContent = String(computeCurrentStreak(counts));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Extend the grid out to the end of the current week (Saturday) so
  // every column holds a full 7 days — otherwise the last, partial
  // week would visually compress the grid.
  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  const totalDays = STREAK_WEEKS * 7;
  const cursor = new Date(gridEnd);
  cursor.setDate(cursor.getDate() - (totalDays - 1));

  streakGridEl.innerHTML = '';
  for (let i = 0; i < totalDays; i++) {
    const cellDate = new Date(cursor);
    const cell = document.createElement('span');
    if (cellDate > today) {
      cell.className = 'streak-cell is-future';
    } else {
      const key = dateKey(cellDate);
      const count = counts.get(key) || 0;
      cell.className = `streak-cell level-${streakLevel(count)}`;
      const label = count === 1 ? '1 card' : `${count} cards`;
      cell.title = `${label} — ${cellDate.toDateString()}`;
    }
    streakGridEl.appendChild(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function renderDeckList() {
  renderStreakCalendar();
  deckListEl.innerHTML = '';
  getAllDeckConfigs().forEach(deck => {
    const leftGroup = document.createElement('span');
    leftGroup.className = 'deck-btn-left';

    const nameEl = document.createElement('span');
    nameEl.className = 'deck-btn-name';
    nameEl.textContent = deck.name;
    leftGroup.appendChild(nameEl);

    const countEl = document.createElement('span');
    countEl.className = 'deck-btn-count';
    countEl.textContent = 'Loading…';

    // Custom decks need two independent click targets (open vs.
    // delete), so — unlike a built-in deck's single <button> — they
    // get a wrapper <div> holding two sibling <button>s instead.
    let rowEl, mainBtn;
    if (deck.custom) {
      rowEl = document.createElement('div');
      rowEl.className = 'deck-btn deck-btn-custom';

      mainBtn = document.createElement('button');
      mainBtn.className = 'deck-btn-main';
      mainBtn.type = 'button';
      mainBtn.appendChild(leftGroup);
      mainBtn.appendChild(countEl);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'deck-btn-delete';
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', `Delete "${deck.name}"`);
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => deleteCustomDeck(deck.id));

      rowEl.appendChild(mainBtn);
      rowEl.appendChild(deleteBtn);
    } else {
      rowEl = document.createElement('button');
      rowEl.className = 'deck-btn';
      rowEl.type = 'button';
      rowEl.appendChild(leftGroup);
      rowEl.appendChild(countEl);
      mainBtn = rowEl;
    }

    deckListEl.appendChild(rowEl);

    mainBtn.addEventListener('click', () => {
      const loaded = state.decks[deck.id];
      if (!loaded || loaded.error) return;
      // A built-in deck with zero cards is just broken — nothing to
      // do about that from the UI. A custom deck can legitimately
      // reach zero cards (deleted them all, or an intentionally
      // empty upload) and must stay openable, or "Add a card" would
      // be permanently unreachable.
      if (loaded.cards.length === 0 && !deck.custom) return;
      openCountScreen(deck);
    });

    loadDeck(deck).then(result => {
      if (result.error) {
        rowEl.classList.add('is-error');
        countEl.textContent = 'Could not load';
      } else if (result.cards.length === 0) {
        if (deck.custom) {
          countEl.textContent = 'Empty — tap to add cards';
        } else {
          rowEl.classList.add('is-error');
          countEl.textContent = 'No cards found';
        }
      } else {
        const activeCount = getActiveCards(deck.id).length;
        countEl.textContent = `${activeCount}/${result.cards.length}`;
      }
    });
  });
}

function showUploadError(message) {
  deckUploadErrorEl.textContent = message;
  deckUploadErrorEl.hidden = false;
}

function clearUploadError() {
  deckUploadErrorEl.hidden = true;
  deckUploadErrorEl.textContent = '';
}

deckUploadBtnEl.addEventListener('click', () => {
  clearUploadError();
  deckFileInputEl.click();
});

deckFileInputEl.addEventListener('change', handleDeckFileSelected);

async function handleDeckFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = ''; // lets re-picking the same filename re-fire "change"
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    showUploadError('Could not read that file.');
    return;
  }

  const cards = csvToCards(text);
  if (cards.length === 0) {
    showUploadError('No valid cards found — the file needs front,back columns.');
    return;
  }

  const defaultName = file.name.replace(/\.csv$/i, '').trim() || 'My deck';
  const chosenName = await showPrompt('Name this deck:', defaultName);
  if (chosenName === null) return; // cancelled

  const trimmedName = chosenName.trim();
  if (trimmedName.length === 0) return; // OK is disabled while empty, but just in case

  // Same name -> same id -> treated as updating that deck (its
  // progress carries over, since progress is keyed by deckId+cardId).
  const id = customDeckId(trimmedName);
  const registry = loadCustomDeckRegistry();
  const existing = registry.find(d => d.id === id);

  if (existing) {
    const replace = await showConfirm(`A deck named "${existing.name}" already exists — replace its cards?`, 'Replace');
    if (!replace) return;
  }

  // Save the cards before touching the registry: if this fails
  // (storage full), the registry never ends up pointing at cards
  // that don't exist.
  if (!saveCustomDeckCards(id, cards)) {
    showUploadError('Could not save this deck — storage is full.');
    return;
  }

  const now = Date.now();
  if (existing) {
    existing.name = trimmedName;
    existing.updatedAt = now;
  } else {
    registry.push({ id, name: trimmedName, createdAt: now, updatedAt: now });
  }

  if (!saveCustomDeckRegistry(registry)) {
    showUploadError('Could not save this deck — storage is full.');
    return;
  }

  clearUploadError();
  // Drop any cached copy so a same-session re-upload doesn't keep
  // serving the stale cards from before this update — loadDeck()
  // short-circuits on a truthy cache hit otherwise.
  delete state.decks[id];
  renderDeckList();
}

async function deleteCustomDeck(deckId) {
  const registry = loadCustomDeckRegistry();
  const deck = registry.find(d => d.id === deckId);
  if (!deck) return;

  const confirmed = await showConfirm(`Delete "${deck.name}"? This also erases its study progress.`, 'Delete');
  if (!confirmed) return;

  saveCustomDeckRegistry(registry.filter(d => d.id !== deckId));
  deleteDeckStorage(deckId);
  delete state.decks[deckId];
  if (state.activeDeck && state.activeDeck.id === deckId) state.activeDeck = null;
  renderDeckList();
}

/* ============================================================
   Editing a custom deck's cards — add/edit/delete individual
   cards, only ever shown for decks the visitor uploaded
   themselves (deck.custom). All three save to localStorage
   *before* touching state.decks[deck.id].cards, mirroring the
   upload flow's ordering, so a failed write never leaves
   in-memory state ahead of what's actually persisted.
   ============================================================ */
async function addCardToDeck(deck) {
  const result = await showCardForm('Add a card:', { front: '', back: '' }, 'Add');
  if (result === null) return;

  const cards = state.decks[deck.id].cards;
  const newCard = { front: result.front, back: result.back, id: nextCardId(cards), activeDefault: true };
  const updated = cards.concat([newCard]);

  if (!saveCustomDeckCards(deck.id, updated)) {
    await showConfirm('Could not save this card — storage is full.', 'OK', { showCancel: false });
    return;
  }
  state.decks[deck.id].cards = updated;
  renderCountGrid(deck);
  renderDeckPreview(deck);
}

async function editCard(deck, card) {
  const result = await showCardForm('Edit this card:', { front: card.front, back: card.back }, 'Save');
  if (result === null) return;

  const cards = state.decks[deck.id].cards;
  // A card with no id is keyed by a hash of its own text
  // (cardStorageKey) — leaving it id-less here would re-orphan its
  // history on every future edit, not just this one, since the hash
  // changes along with the text. Give it a real id now to stop that.
  const needsId = card.id === null || card.id === undefined;
  const updated = cards.map(c => c === card
    ? { ...c, front: result.front, back: result.back, id: needsId ? nextCardId(cards) : c.id }
    : c);

  if (!saveCustomDeckCards(deck.id, updated)) {
    await showConfirm('Could not save this change — storage is full.', 'OK', { showCancel: false });
    return;
  }
  state.decks[deck.id].cards = updated;
  renderCountGrid(deck);
  renderDeckPreview(deck);
}

async function removeCardFromDeck(deck, card) {
  const confirmed = await showConfirm('Delete this card? This also erases its study history.', 'Delete');
  if (!confirmed) return;

  const cards = state.decks[deck.id].cards;
  const updated = cards.filter(c => c !== card);

  if (!saveCustomDeckCards(deck.id, updated)) {
    await showConfirm('Could not save this change — storage is full.', 'OK', { showCancel: false });
    return;
  }
  state.decks[deck.id].cards = updated;
  // Only sweep this one card's own keys after the save actually
  // succeeds — unlike deleteDeckStorage's broad prefix sweep (whole-
  // deck delete), a failed save here must not orphan-clean history
  // for a card that's still actually in the deck.
  localStorage.removeItem(cardStorageKey(deck.id, card));
  localStorage.removeItem(cardActiveKey(deck.id, card));
  renderCountGrid(deck);
  renderDeckPreview(deck);
}

async function loadDeck(deck) {
  if (state.decks[deck.id]) return state.decks[deck.id];
  if (deck.custom) {
    const result = loadCustomDeckCards(deck.id);
    state.decks[deck.id] = result;
    return result;
  }
  try {
    const res = await fetch(deck.file, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    const text = await res.text();
    const cards = csvToCards(text);
    const result = { cards };
    state.decks[deck.id] = result;
    return result;
  } catch (err) {
    const result = { error: true, cards: [] };
    state.decks[deck.id] = result;
    return result;
  }
}

/* ============================================================
   Count select screen
   ============================================================ */
const countGridEl = document.getElementById('countGrid');
const countDeckNameEl = document.getElementById('countDeckName');
const previewListEl = document.getElementById('previewList');
const sortToggleEl = document.getElementById('sortToggle');
const unselectAllBtnEl = document.getElementById('unselectAllBtn');
const playFilteredBtnEl = document.getElementById('playFilteredBtn');
const addCardBtnEl = document.getElementById('addCardBtn');
const scrollTopBtnEl = document.getElementById('scrollTopBtn');
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function openCountScreen(deck) {
  state.activeDeck = deck;
  countDeckNameEl.textContent = deck.name;
  state.previewSort = 'original';
  addCardBtnEl.hidden = !deck.custom;

  renderCountGrid(deck);
  renderDeckPreview(deck);
  showScreen('screen-count');
}

addCardBtnEl.addEventListener('click', () => {
  const deck = state.activeDeck;
  if (!deck) return;
  addCardToDeck(deck);
});

// Rebuilt any time a card gets checked/unchecked below, since the
// available session sizes and the "All" count depend on how many
// cards are currently active.
function renderCountGrid(deck) {
  const allCards = state.decks[deck.id].cards;
  const total = getActiveCards(deck.id).length;
  countGridEl.innerHTML = '';

  if (allCards.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'count-empty';
    msg.textContent = deck.custom
      ? 'No cards yet — use "Add a card" below to get started.'
      : 'This deck has no cards.';
    countGridEl.appendChild(msg);
    return;
  }

  if (total === 0) {
    const msg = document.createElement('p');
    msg.className = 'count-empty';
    msg.textContent = 'Every card here is switched off — uncheck one below to study it.';
    countGridEl.appendChild(msg);
    return;
  }

  const options = COUNT_OPTIONS.filter(n => n < total);
  options.forEach(n => countGridEl.appendChild(makeCountButton(n, `${n} cards`, total)));
  countGridEl.appendChild(makeCountButton(total, `All (${total})`, total, true));
}

function renderDeckPreview(deck) {
  const cards = state.decks[deck.id].cards;

  // Score once up front so filtering/sorting doesn't recompute per card.
  const withScores = cards.map(card => ({ card, score: cardScore(deck.id, card) }));

  let visible = withScores;

  if (state.previewSort === 'original') {
    // By id number rather than raw CSV row order, so re-shuffling rows
    // in the CSV doesn't change this view. Cards without an id (none
    // assigned yet) sort after every numbered card.
    visible = withScores.slice().sort((a, b) => idSortKey(a.card) - idSortKey(b.card));
  } else if (state.previewSort === 'weakest') {
    // Graded cards you haven't mastered ("Got it") yet, weakest first.
    // Never-studied cards live in their own "Non-graded" tab instead.
    visible = withScores.filter(({ score }) => score !== null && scoreBucket(score) !== GRADE.GOT_IT);
    visible.sort((a, b) => a.score - b.score);
  } else if (state.previewSort === 'strongest') {
    // Only cards bucketed as "Got it" or "Almost", strongest first.
    visible = withScores.filter(({ score }) => {
      const bucket = scoreBucket(score);
      return bucket === GRADE.GOT_IT || bucket === GRADE.ALMOST;
    });
    visible.sort((a, b) => b.score - a.score);
  } else if (state.previewSort === 'nongraded') {
    // Cards that have never been studied at all, by id number.
    visible = withScores.filter(({ score }) => score === null);
    visible.sort((a, b) => idSortKey(a.card) - idSortKey(b.card));
  } else if (state.previewSort === 'active') {
    visible = withScores.filter(({ card }) => isCardActive(deck.id, card));
  } else if (state.previewSort === 'nonactive') {
    visible = withScores.filter(({ card }) => !isCardActive(deck.id, card));
  }

  // What "Play these" will study if clicked — kept in sync here so
  // the button doesn't need to recompute or re-filter anything.
  // Skipped cards stay in the *list* (dimmed) for every filter, but
  // shouldn't sneak into the *play pool* — except on "Non-active"
  // itself, whose whole point is letting you drill exactly your
  // skipped cards without reactivating them.
  const playable = state.previewSort === 'nonactive'
    ? visible
    : visible.filter(({ card }) => isCardActive(deck.id, card));
  state.previewVisibleCards = playable.map(({ card }) => card);
  updateSortToggleLabel(visible.length);
  updatePlayFilteredButton(playable.length);

  previewListEl.innerHTML = '';

  if (visible.length === 0) {
    const li = document.createElement('li');
    li.className = 'preview-empty';
    li.textContent = EMPTY_FILTER_MESSAGES[state.previewSort] || 'No cards match this filter.';
    previewListEl.appendChild(li);
    updateScrollTopVisibility();
    updateUnselectAllAvailability(deck);
    return;
  }

  visible.forEach(({ card, score }) => {
    const li = document.createElement('li');
    const active = isCardActive(deck.id, card);
    li.classList.toggle('is-inactive', !active);

    const scoreNote = score === null ? 'Not studied yet' : `Average grade ${score.toFixed(1)} / 3`;
    li.title = active ? scoreNote : `${scoreNote} · skipped`;
    if (score !== null) {
      li.style.setProperty('--score-color', scoreToColor(score));
    }

    const content = document.createElement('div');
    content.className = 'preview-content';

    const front = document.createElement('div');
    front.className = 'preview-front';
    front.textContent = card.front;
    const back = document.createElement('div');
    back.className = 'preview-back';
    back.textContent = card.back;
    content.appendChild(front);
    content.appendChild(back);

    if (deck.custom) {
      li.classList.add('is-editable');
      content.setAttribute('role', 'button');
      content.tabIndex = 0;
      content.addEventListener('click', () => editCard(deck, card));
      content.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editCard(deck, card); }
      });
    }

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'preview-toggle';
    toggleLabel.title = 'Skip this card in quiz sessions';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !active;
    checkbox.setAttribute('aria-label', `Skip "${card.front}" in quiz sessions`);
    checkbox.addEventListener('change', () => {
      const nowActive = !checkbox.checked;
      setCardActive(deck.id, card, nowActive);
      renderCountGrid(deck);

      if (state.previewSort === 'active' || state.previewSort === 'nonactive') {
        // This card just left (or joined) the group this filter shows —
        // a class tweak isn't enough, it needs to actually disappear/
        // appear from the list. Preserve scroll position (the *window's*,
        // since this list doesn't scroll in its own container — see
        // updateScrollTopVisibility()) since a full rebuild would
        // otherwise snap back to the top mid-review.
        const scrollPos = window.scrollY;
        renderDeckPreview(deck);
        window.scrollTo(0, scrollPos);
      } else {
        li.classList.toggle('is-inactive', !nowActive);
        li.title = nowActive ? scoreNote : `${scoreNote} · skipped`;
        updateUnselectAllAvailability(deck);
      }
    });
    toggleLabel.appendChild(checkbox);

    li.appendChild(content);
    li.appendChild(toggleLabel);
    if (deck.custom) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'preview-delete';
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', `Delete card "${card.front}"`);
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => removeCardFromDeck(deck, card));
      li.appendChild(deleteBtn);
    }
    previewListEl.appendChild(li);
  });

  updateScrollTopVisibility();
  updateUnselectAllAvailability(deck);
}

// Hidden entirely when nothing in the deck is currently skipped —
// nothing for it to do yet.
function updateUnselectAllAvailability(deck) {
  const cards = state.decks[deck.id].cards;
  const anyInactive = cards.some(card => !isCardActive(deck.id, card));
  unselectAllBtnEl.classList.toggle('is-hidden', !anyInactive);
  unselectAllBtnEl.disabled = !anyInactive;
}

unselectAllBtnEl.addEventListener('click', async () => {
  const deck = state.activeDeck;
  if (!deck) return;
  const confirmed = await showConfirm('Turn every skipped card back on?');
  if (!confirmed) return;
  const cards = state.decks[deck.id].cards;
  cards.forEach(card => setCardActive(deck.id, card, true));
  // If "Non-active" is the current filter, this just emptied it out —
  // reset to the top first so the page doesn't visibly jump/resize
  // snapping back from wherever it was scrolled (see the sortToggle
  // handler above for the same reasoning).
  window.scrollTo(0, 0);
  renderDeckPreview(deck);
  renderCountGrid(deck);
});

// Text of the sort/filter button. Takes the count of cards the
// *current* filter is showing, so e.g. "Weaker (12)" always reflects
// what's actually on screen — set from renderDeckPreview() right
// after it finishes filtering, which is the one place that count is
// known. (The button always looks "on" via .sort-toggle's own CSS —
// every filter, "Original" included, is an equally deliberate choice,
// not a default/disabled state.)
function updateSortToggleLabel(count) {
  sortToggleEl.textContent = `${SORT_LABELS[state.previewSort]} (${count})`;
}

// Text + disabled-state of the "Play these" button — mirrors
// updateSortToggleLabel() above, just for the button that studies
// the filtered set instead of the one that names it.
function updatePlayFilteredButton(count) {
  playFilteredBtnEl.textContent = `Play these (${count})`;
  playFilteredBtnEl.disabled = count === 0;
}

sortToggleEl.addEventListener('click', () => {
  const currentIndex = SORT_MODES.indexOf(state.previewSort);
  state.previewSort = SORT_MODES[(currentIndex + 1) % SORT_MODES.length];
  // Reset to the top *before* re-rendering: switching to a filter
  // with far fewer (or zero) cards can shrink the page drastically,
  // and if the window was scrolled deep into the previous filter's
  // long list, the browser has to forcibly snap the scroll position
  // back to fit — which looks like the page jumping/resizing oddly.
  // Doing it ourselves first means there's nothing to snap.
  window.scrollTo(0, 0);
  renderDeckPreview(state.activeDeck);
});

// Studies exactly what the current filter is showing — e.g. only
// your "Weaker" cards, or only "Non-active" ones — in random order,
// regardless of each card's individual active/inactive state. A
// separate, one-off pool from the normal count-grid sessions below,
// which always draw from the deck's full active-card pool.
playFilteredBtnEl.addEventListener('click', () => {
  if (state.previewVisibleCards.length === 0) return;
  startSessionWithCards(shuffle(state.previewVisibleCards));
});

// Shared "back to top" arrow for both this screen and the deck-select
// one. Neither screen's content actually scrolls inside its own
// bounded container — .app only sets min-height, so it just grows
// taller than the viewport and the window itself scrolls — so this
// tracks window scroll rather than any element's own scrollTop.
const SCROLL_TOP_THRESHOLD = 80;

function updateScrollTopVisibility() {
  const onScrollableScreen = document.getElementById('screen-deck').classList.contains('active')
    || document.getElementById('screen-count').classList.contains('active');
  scrollTopBtnEl.classList.toggle('is-visible', onScrollableScreen && window.scrollY > SCROLL_TOP_THRESHOLD);
}

window.addEventListener('scroll', updateScrollTopVisibility);

scrollTopBtnEl.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
});

function makeCountButton(n, label, total, isAll) {
  const btn = document.createElement('button');
  btn.className = 'count-btn' + (isAll ? ' is-all' : '');
  btn.type = 'button';
  btn.innerHTML = `<span class="count-btn-num">${n}</span><span class="count-btn-label">${isAll ? 'every card' : 'cards'}</span>`;
  btn.addEventListener('click', () => startSession(n));
  return btn;
}

document.getElementById('backToDeck').addEventListener('click', () => {
  // The active/N count shown per deck can have changed (cards
  // toggled on/off in the preview list) since the list was last
  // rendered — refresh it rather than show a stale count.
  renderDeckList();
  showScreen('screen-deck');
});

/* ============================================================
   Quiz screen
   ============================================================ */
const cardEl = document.getElementById('card');
const cardInnerEl = document.getElementById('cardInner');
const cardFrontTextEl = document.getElementById('cardFrontText');
const cardBackFrontTextEl = document.getElementById('cardBackFrontText');
const cardBackTextEl = document.getElementById('cardBackText');
const progressCountEl = document.getElementById('progressCount');
const progressFillEl = document.getElementById('progressFill');
const scoreHitEl = document.getElementById('scoreHitCount');
const scoreMissEl = document.getElementById('scoreMissCount');
const actionRowEl = document.getElementById('actionRow');
const flipBtnEl = document.getElementById('flipBtn');
const gradeRowEl = document.getElementById('gradeRow');
const tapHintEl = document.getElementById('tapHint');
const undoBtnEl = document.getElementById('undoBtn');
const undoFromResultsEl = document.getElementById('undoFromResults');

// Resets session state and jumps into the quiz with an already-
// decided list of cards (already shuffled/limited by the caller).
// Both startSession() (count-grid) and the "Play these" button fan
// into this so the reset logic only lives in one place.
function startSessionWithCards(cards) {
  state.sessionCards = cards;
  state.index = 0;
  state.correct = 0;
  state.missed = [];
  state.history = [];
  scoreHitEl.textContent = '0';
  scoreMissEl.textContent = '0';
  updateUndoAvailability();
  showScreen('screen-quiz');
  renderCurrentCard();
}

function startSession(count) {
  const activeCards = getActiveCards(state.activeDeck.id);
  startSessionWithCards(shuffle(activeCards).slice(0, count));
}

function renderCurrentCard() {
  const total = state.sessionCards.length;
  const card = state.sessionCards[state.index];

  state.flipped = false;

  // Reset to the front INSTANTLY (no rotate transition) before the new
  // card's text goes in. Without this, removing "flipped" here plays the
  // normal 0.5s flip-back animation while the back face already holds the
  // *new* card's answer underneath — so for a moment you're looking at
  // the next answer mid-spin, and the animation itself reads as a "lag"
  // before the card is ready. Killing the transition just for this reset
  // (then restoring it right after) means only a manual tap-to-flip ever
  // animates.
  cardInnerEl.classList.add('snap');
  cardEl.classList.remove('flipped');
  cardEl.setAttribute('aria-pressed', 'false');
  actionRowEl.classList.remove('is-flipped');
  tapHintEl.textContent = 'Tap the card, or press space, to reveal the answer';

  cardFrontTextEl.textContent = card.front;
  cardBackFrontTextEl.textContent = card.front;
  cardBackTextEl.textContent = card.back;

  progressCountEl.textContent = `${state.index + 1} / ${total}`;
  progressFillEl.style.width = `${(state.index / total) * 100}%`;

  // Force the browser to apply the transition-less reset above before we
  // remove "snap" — otherwise the two class changes could get batched
  // into one style pass and the reset would end up animated after all.
  void cardInnerEl.offsetHeight;
  cardInnerEl.classList.remove('snap');
}

function flipCard() {
  if (state.flipped) return;
  state.flipped = true;
  cardEl.classList.add('flipped');
  cardEl.setAttribute('aria-pressed', 'true');
  actionRowEl.classList.add('is-flipped');
  tapHintEl.textContent = '';
}

function gradeCard(grade) {
  if (!state.flipped) return;
  const card = state.sessionCards[state.index];
  const gradedIndex = state.index;

  recordGrade(state.activeDeck.id, card, grade);

  if (grade === GRADE.MISSED) {
    state.missed.push(card);
    scoreMissEl.textContent = String(state.missed.length);
  } else {
    state.correct++;
    scoreHitEl.textContent = String(state.correct);
  }

  state.history.push({ index: gradedIndex, grade });
  updateUndoAvailability();

  if (gradedIndex + 1 >= state.sessionCards.length) {
    finishSession();
  } else {
    state.index = gradedIndex + 1;
    renderCurrentCard();
  }
}

function updateUndoAvailability() {
  const hasHistory = state.history.length > 0;
  undoBtnEl.disabled = !hasHistory;
  undoFromResultsEl.disabled = !hasHistory;
}

// Jump back to the card you just graded and let you re-grade it — for
// when you fat-finger "Missed" on a card you actually knew. Rolls back
// both the live session score AND the saved per-card history entry, so
// the correction replaces the mistake instead of stacking on top of it.
function undoLastGrade() {
  if (state.history.length === 0) return;
  const last = state.history.pop();
  const card = state.sessionCards[last.index];

  removeLastGradeRecord(state.activeDeck.id, card);

  if (last.grade === GRADE.MISSED) {
    state.missed.pop();
    scoreMissEl.textContent = String(state.missed.length);
  } else {
    state.correct = Math.max(0, state.correct - 1);
    scoreHitEl.textContent = String(state.correct);
  }

  state.index = last.index;
  updateUndoAvailability();

  showScreen('screen-quiz');
  renderCurrentCard();
  flipCard(); // show the answer right away so you can just tap the right grade
}

cardEl.addEventListener('click', flipCard);
flipBtnEl.addEventListener('click', flipCard);
undoBtnEl.addEventListener('click', undoLastGrade);
undoFromResultsEl.addEventListener('click', undoLastGrade);

document.addEventListener('keydown', (e) => {
  const quizActive = document.getElementById('screen-quiz').classList.contains('active');
  const resultsActive = document.getElementById('screen-results').classList.contains('active');

  if (e.key === 'Backspace' && (quizActive || resultsActive)) {
    e.preventDefault();
    undoLastGrade();
    return;
  }

  if (!quizActive) return;

  if (!state.flipped) {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); flipCard(); }
    return;
  }
  if (e.key === '1') gradeCard(GRADE.MISSED);
  if (e.key === '2') gradeCard(GRADE.HARD);
  if (e.key === '3') gradeCard(GRADE.ALMOST);
  if (e.key === '4') gradeCard(GRADE.GOT_IT);
});

document.getElementById('gradeMiss').addEventListener('click', () => gradeCard(GRADE.MISSED));
document.getElementById('gradeHard').addEventListener('click', () => gradeCard(GRADE.HARD));
document.getElementById('gradeAlmost').addEventListener('click', () => gradeCard(GRADE.ALMOST));
document.getElementById('gradeHit').addEventListener('click', () => gradeCard(GRADE.GOT_IT));

document.getElementById('quitQuiz').addEventListener('click', () => {
  showScreen('screen-count');
});

/* ============================================================
   Results screen
   ============================================================ */
const scoreBigEl = document.getElementById('scoreBig');
const scoreSubEl = document.getElementById('scoreSub');
const missedWrapEl = document.getElementById('missedWrap');
const missedListEl = document.getElementById('missedList');

function finishSession() {
  progressFillEl.style.width = '100%';

  const total = state.sessionCards.length;
  const pct = total === 0 ? 0 : Math.round((state.correct / total) * 100);

  scoreBigEl.textContent = `${state.correct}/${total}`;
  scoreSubEl.textContent = `${pct}% recalled`;

  missedListEl.innerHTML = '';
  if (state.missed.length === 0) {
    missedWrapEl.classList.add('is-empty');
  } else {
    missedWrapEl.classList.remove('is-empty');
    state.missed.forEach(card => {
      const li = document.createElement('li');
      const front = document.createElement('div');
      front.className = 'missed-front';
      front.textContent = card.front;
      const back = document.createElement('div');
      back.className = 'missed-back';
      back.textContent = card.back;
      li.appendChild(front);
      li.appendChild(back);
      missedListEl.appendChild(li);
    });
  }

  showScreen('screen-results');
}

document.getElementById('studyAgain').addEventListener('click', () => {
  startSession(state.sessionCards.length);
});

document.getElementById('newDeck').addEventListener('click', () => {
  renderDeckList();
  showScreen('screen-deck');
});

/* ============================================================
   Boot
   ============================================================ */
renderDeckList();
