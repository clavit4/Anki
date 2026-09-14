'use strict';

/* ============================================================
   Config — edit this to point at your own decks.
   Add or remove entries as needed; each needs a unique id,
   a display name, and a path to a CSV file with a
   "front,back,id" header followed by one card per row.
   The id column is optional — a row without one just won't have
   review history tracked until you give it a number.
   ============================================================ */
const DECKS = [
  { id: 'deck1', name: 'Deck 1', file: 'decks/deck1.csv' },
  { id: 'deck2', name: 'Deck 2', file: 'decks/deck2.csv' },
];

const COUNT_OPTIONS = [10, 25, 50, 100];

// The four grading buttons, worst to best.
const GRADE = Object.freeze({ MISSED: 0, HARD: 1, ALMOST: 2, GOT_IT: 3 });

// Deck-preview sort cycle: original CSV order -> weakest cards first
// -> strongest cards first -> back to original. Each label is the
// action a click will perform *next*, not the currently-active mode.
const SORT_MODES = ['original', 'weakest', 'strongest'];
const SORT_LABELS = {
  original: 'Weakest first',
  weakest: 'Strongest first',
  strongest: 'Original order',
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

function csvToCards(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  // Drop a header row if it looks like one (front/back, case-insensitive).
  const first = rows[0].map(c => c.trim().toLowerCase());
  const startIndex = (first[0] === 'front' && first[1] === 'back') ? 1 : 0;

  const cards = [];
  for (let i = startIndex; i < rows.length; i++) {
    const [front, back, id] = rows[i];
    if (front && front.trim() && back && back.trim()) {
      const trimmedId = (id !== undefined && id !== null) ? id.trim() : '';
      cards.push({
        front: front.trim(),
        back: back.trim(),
        // Rows without an id still work — they just fall back to a
        // content-based key below, so history isn't tracked until
        // you assign one.
        id: trimmedId.length > 0 ? trimmedId : null,
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

// Rose (Missed) -> Amber (Hard) -> Lime (Almost) -> Mint (Got it!),
// interpolated continuously rather than snapped to four hard buckets.
const SCORE_COLOR_STOPS = [
  [209, 73, 91],   // 0
  [209, 138, 79],  // 1
  [195, 209, 79],  // 2
  [79, 209, 165],  // 3
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
  previewSort: 'original', // 'original' | 'weakest' | 'strongest'
  history: [],           // stack of { index, grade } — one entry per graded card, for Undo
};

/* ============================================================
   Screen switching
   ============================================================ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ============================================================
   Deck select screen
   ============================================================ */
const deckListEl = document.getElementById('deckList');

function renderDeckList() {
  deckListEl.innerHTML = '';
  DECKS.forEach(deck => {
    const btn = document.createElement('button');
    btn.className = 'deck-btn';
    btn.type = 'button';

    const nameEl = document.createElement('span');
    nameEl.className = 'deck-btn-name';
    nameEl.textContent = deck.name;

    const countEl = document.createElement('span');
    countEl.className = 'deck-btn-count';
    countEl.textContent = 'Loading…';

    btn.appendChild(nameEl);
    btn.appendChild(countEl);
    deckListEl.appendChild(btn);

    btn.addEventListener('click', () => {
      const loaded = state.decks[deck.id];
      if (!loaded || loaded.error || loaded.cards.length === 0) return;
      openCountScreen(deck);
    });

    loadDeck(deck).then(result => {
      if (result.error) {
        btn.classList.add('is-error');
        countEl.textContent = 'Could not load';
      } else if (result.cards.length === 0) {
        btn.classList.add('is-error');
        countEl.textContent = 'No cards found';
      } else {
        countEl.textContent = `${result.cards.length} card${result.cards.length === 1 ? '' : 's'}`;
      }
    });
  });
}

async function loadDeck(deck) {
  if (state.decks[deck.id]) return state.decks[deck.id];
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
const scrollTopBtnEl = document.getElementById('scrollTopBtn');
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function openCountScreen(deck) {
  state.activeDeck = deck;
  countDeckNameEl.textContent = deck.name;
  state.previewSort = 'original';
  sortToggleEl.classList.remove('is-active');
  sortToggleEl.textContent = SORT_LABELS.original;

  const total = state.decks[deck.id].cards.length;
  countGridEl.innerHTML = '';

  const options = COUNT_OPTIONS.filter(n => n < total);
  options.forEach(n => countGridEl.appendChild(makeCountButton(n, `${n} cards`, total)));
  countGridEl.appendChild(makeCountButton(total, `All (${total})`, total, true));

  renderDeckPreview(deck);
  showScreen('screen-count');
}

function renderDeckPreview(deck) {
  const cards = state.decks[deck.id].cards;

  // Score once up front so sorting doesn't recompute per comparison.
  const withScores = cards.map(card => ({ card, score: cardScore(deck.id, card) }));

  if (state.previewSort === 'weakest' || state.previewSort === 'strongest') {
    // Weakest/strongest first by score. Never-studied cards have no
    // signal either way, so they always sort to the bottom.
    const direction = state.previewSort === 'weakest' ? 1 : -1;
    withScores.sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return (a.score - b.score) * direction;
    });
  }

  previewListEl.innerHTML = '';
  withScores.forEach(({ card, score }) => {
    const li = document.createElement('li');

    if (score === null) {
      li.title = 'Not studied yet';
    } else {
      li.style.setProperty('--score-color', scoreToColor(score));
      li.title = `Average grade ${score.toFixed(1)} / 3`;
    }

    const front = document.createElement('div');
    front.className = 'preview-front';
    front.textContent = card.front;
    const back = document.createElement('div');
    back.className = 'preview-back';
    back.textContent = card.back;
    li.appendChild(front);
    li.appendChild(back);
    previewListEl.appendChild(li);
  });

  previewListEl.scrollTop = 0;
  scrollTopBtnEl.classList.remove('is-visible');
}

sortToggleEl.addEventListener('click', () => {
  const currentIndex = SORT_MODES.indexOf(state.previewSort);
  state.previewSort = SORT_MODES[(currentIndex + 1) % SORT_MODES.length];
  sortToggleEl.textContent = SORT_LABELS[state.previewSort];
  sortToggleEl.classList.toggle('is-active', state.previewSort !== 'original');
  renderDeckPreview(state.activeDeck);
});

previewListEl.addEventListener('scroll', () => {
  scrollTopBtnEl.classList.toggle('is-visible', previewListEl.scrollTop > 150);
});

scrollTopBtnEl.addEventListener('click', () => {
  previewListEl.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
});

function makeCountButton(n, label, total, isAll) {
  const btn = document.createElement('button');
  btn.className = 'count-btn' + (isAll ? ' is-all' : '');
  btn.type = 'button';
  btn.innerHTML = `<span class="count-btn-num">${n}</span><span class="count-btn-label">${isAll ? 'every card' : 'cards'}</span>`;
  btn.addEventListener('click', () => startSession(n));
  return btn;
}

document.getElementById('backToDeck').addEventListener('click', () => showScreen('screen-deck'));

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

function startSession(count) {
  const allCards = state.decks[state.activeDeck.id].cards;
  state.sessionCards = shuffle(allCards).slice(0, count);
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
  showScreen('screen-deck');
});

/* ============================================================
   Boot
   ============================================================ */
renderDeckList();
