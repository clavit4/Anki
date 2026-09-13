'use strict';

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
    const [front, back] = rows[i];
    if (front && front.trim() && back && back.trim()) {
      cards.push({ front: front.trim(), back: back.trim() });
    }
  }
  return cards;
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
   Mastery tracking — per-card grade history, persisted in
   localStorage so it survives reloads. Cards are identified by
   "<deck name>::<front text>" since uploaded decks have no
   stable id across sessions; re-uploading the same CSV (same
   filename, same front text) picks up the same history.
   ============================================================ */
const MASTERY_STORAGE_KEY = 'recall:mastery:v1';
const MASTERY_WINDOW = 7; // only the last N attempts count toward the score
const GRADE_VALUES = { miss: 0, hard: 1, almost: 2, hit: 3 };

// rose -> amber -> lime -> mint, matching the grade button colors,
// interpolated smoothly across the 0..3 average-grade range.
const MASTERY_COLOR_STOPS = ['#d1495b', '#d18a4f', '#c3d14f', '#4fd1a5'].map(hexToRgb);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function colorForScore(score) {
  const clamped = Math.max(0, Math.min(3, score));
  const idx = Math.min(2, Math.floor(clamped));
  const t = clamped - idx;
  const [r1, g1, b1] = MASTERY_COLOR_STOPS[idx];
  const [r2, g2, b2] = MASTERY_COLOR_STOPS[idx + 1];
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

function loadMasteryStore() {
  try {
    const raw = localStorage.getItem(MASTERY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {}; // private-browsing / storage disabled — app still works, just without persistence
  }
}

function saveMasteryStore(store) {
  try {
    localStorage.setItem(MASTERY_STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    // quota exceeded or storage disabled — fail silently, nothing else depends on this succeeding
  }
}

function masteryKey(deckName, card) {
  return deckName + '::' + card.front;
}

function recordGrade(deckName, card, gradeKey) {
  const value = GRADE_VALUES[gradeKey];
  const store = loadMasteryStore();
  const key = masteryKey(deckName, card);
  const history = store[key] || [];
  history.push(value);
  while (history.length > MASTERY_WINDOW) history.shift();
  store[key] = history;
  saveMasteryStore(store);
}

// Returns the average of the last MASTERY_WINDOW grades (0..3), or
// null if the card has never been graded.
function getMasteryScore(deckName, card) {
  const store = loadMasteryStore();
  const history = store[masteryKey(deckName, card)];
  if (!history || history.length === 0) return null;
  return history.reduce((a, b) => a + b, 0) / history.length;
}

/* ============================================================
   State
   ============================================================ */
const state = {
  decks: {},           // id -> { cards: [...] }
  activeDeck: null,     // deck config currently selected
  sessionCards: [],
  index: 0,
  correct: 0,
  missed: [],
  flipped: false,
};

let previewSortMode = 'default'; // 'default' | 'weakest'

/* ============================================================
   Screen switching
   ============================================================ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ============================================================
   Deck select screen — upload your own CSV, no repo files needed.
   ============================================================ */
const csvInputEl = document.getElementById('csvInput');
const uploadBtnEl = document.getElementById('uploadBtn');
const uploadErrorEl = document.getElementById('uploadError');

function showUploadError(msg) {
  uploadErrorEl.textContent = msg;
  uploadErrorEl.hidden = false;
}

function hideUploadError() {
  uploadErrorEl.hidden = true;
  uploadErrorEl.textContent = '';
}

function handleFile(file) {
  hideUploadError();
  const reader = new FileReader();

  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    const cards = csvToCards(text);

    if (cards.length === 0) {
      showUploadError('No valid cards found. The CSV needs "front,back" columns with at least one row of data.');
      return;
    }

    const deck = {
      id: 'upload-' + Date.now(),
      name: file.name.replace(/\.csv$/i, '') || 'Uploaded deck',
    };
    state.decks[deck.id] = { cards };
    openCountScreen(deck);
  };

  reader.onerror = () => showUploadError('Could not read that file. Please try again.');
  reader.readAsText(file);
}

uploadBtnEl.addEventListener('click', () => csvInputEl.click());

csvInputEl.addEventListener('change', () => {
  const file = csvInputEl.files && csvInputEl.files[0];
  if (file) handleFile(file);
  csvInputEl.value = ''; // reset so choosing the same file again still fires 'change'
});

/* ============================================================
   Count select screen
   ============================================================ */
const countGridEl = document.getElementById('countGrid');
const countDeckNameEl = document.getElementById('countDeckName');
const previewListEl = document.getElementById('previewList');
const sortToggleEl = document.getElementById('sortToggle');

const COUNT_OPTIONS = [10, 25, 50, 100];

function openCountScreen(deck) {
  state.activeDeck = deck;
  countDeckNameEl.textContent = deck.name;

  const total = state.decks[deck.id].cards.length;
  countGridEl.innerHTML = '';

  const options = COUNT_OPTIONS.filter(n => n < total);
  options.forEach(n => countGridEl.appendChild(makeCountButton(n, `${n} cards`, total)));
  countGridEl.appendChild(makeCountButton(total, `All (${total})`, total, true));

  // Reset the sort toggle each time a deck is opened fresh.
  previewSortMode = 'default';
  sortToggleEl.textContent = 'Weakest first';
  sortToggleEl.classList.remove('is-active');

  renderDeckPreview(deck);
  showScreen('screen-count');
}

function renderDeckPreview(deck) {
  const cards = state.decks[deck.id].cards;
  const scored = cards.map(card => ({ card, score: getMasteryScore(deck.name, card) }));

  if (previewSortMode === 'weakest') {
    // Never-graded cards need attention just as much as low scorers,
    // so they sort to the front alongside them.
    scored.sort((a, b) => (a.score === null ? -1 : a.score) - (b.score === null ? -1 : b.score));
  }

  previewListEl.innerHTML = '';
  scored.forEach(({ card, score }) => {
    const li = document.createElement('li');
    const front = document.createElement('div');
    front.className = 'preview-front';
    front.textContent = card.front;
    const back = document.createElement('div');
    back.className = 'preview-back';
    back.textContent = card.back;
    li.appendChild(front);
    li.appendChild(back);
    if (score !== null) li.style.setProperty('--score-color', colorForScore(score));
    previewListEl.appendChild(li);
  });
}

sortToggleEl.addEventListener('click', () => {
  previewSortMode = previewSortMode === 'default' ? 'weakest' : 'default';
  sortToggleEl.textContent = previewSortMode === 'weakest' ? 'Original order' : 'Weakest first';
  sortToggleEl.classList.toggle('is-active', previewSortMode === 'weakest');
  renderDeckPreview(state.activeDeck);
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
const tapHintEl = document.getElementById('tapHint');

function startSession(count) {
  const allCards = state.decks[state.activeDeck.id].cards;
  state.sessionCards = shuffle(allCards).slice(0, count);
  state.index = 0;
  state.correct = 0;
  state.missed = [];
  scoreHitEl.textContent = '0';
  scoreMissEl.textContent = '0';
  showScreen('screen-quiz');
  renderCurrentCard();
}

function renderCurrentCard() {
  const total = state.sessionCards.length;
  const card = state.sessionCards[state.index];

  state.flipped = false;

  // Reset the flip instantly instead of letting it animate back —
  // otherwise the CSS transition rotates the card through the
  // half-turned position, where backface-visibility briefly stops
  // hiding the back face, and by then it already shows the *next*
  // card's answer (since the text below is swapped in immediately).
  cardInnerEl.classList.add('no-anim');
  cardEl.classList.remove('flipped');
  cardEl.setAttribute('aria-pressed', 'false');
  void cardInnerEl.offsetHeight; // force a reflow so the transition-less reset applies before we re-enable it
  cardInnerEl.classList.remove('no-anim');

  actionRowEl.classList.remove('is-flipped');
  tapHintEl.textContent = 'Tap the card, or press space, to reveal the answer';

  cardFrontTextEl.textContent = card.front;
  cardBackFrontTextEl.textContent = card.front;
  cardBackTextEl.textContent = card.back;

  progressCountEl.textContent = `${state.index + 1} / ${total}`;
  progressFillEl.style.width = `${(state.index / total) * 100}%`;
}

function flipCard() {
  if (state.flipped) return;
  state.flipped = true;
  cardEl.classList.add('flipped');
  cardEl.setAttribute('aria-pressed', 'true');
  actionRowEl.classList.add('is-flipped');
  tapHintEl.textContent = '';
}

// gradeKey is one of 'miss' | 'hard' | 'almost' | 'hit'.
// Session tally stays binary (miss = wrong, everything else = recalled
// it), matching the score shown mid-session and the missed-cards list.
// The finer-grained grade is what actually drives long-term mastery —
// it's recorded per card and is what colors the deck preview stripe.
function gradeCard(gradeKey) {
  if (!state.flipped) return;
  const card = state.sessionCards[state.index];

  if (gradeKey === 'miss') {
    state.missed.push(card);
    scoreMissEl.textContent = String(state.missed.length);
  } else {
    state.correct++;
    scoreHitEl.textContent = String(state.correct);
  }

  recordGrade(state.activeDeck.name, card, gradeKey);

  if (state.index + 1 >= state.sessionCards.length) {
    finishSession();
  } else {
    state.index++;
    renderCurrentCard();
  }
}

cardEl.addEventListener('click', flipCard);
flipBtnEl.addEventListener('click', flipCard);

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('screen-quiz').classList.contains('active')) return;
  if (!state.flipped) {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); flipCard(); }
    return;
  }
  if (e.key === '1' || e.code === 'ArrowLeft') gradeCard('miss');
  else if (e.key === '2') gradeCard('hard');
  else if (e.key === '3') gradeCard('almost');
  else if (e.key === '4' || e.code === 'ArrowRight') gradeCard('hit');
});

document.getElementById('gradeMiss').addEventListener('click', () => gradeCard('miss'));
document.getElementById('gradeHard').addEventListener('click', () => gradeCard('hard'));
document.getElementById('gradeAlmost').addEventListener('click', () => gradeCard('almost'));
document.getElementById('gradeHit').addEventListener('click', () => gradeCard('hit'));

document.getElementById('quitQuiz').addEventListener('click', () => {
  // Mastery data may have changed mid-session — reflect it if they land back on the preview.
  if (state.activeDeck) renderDeckPreview(state.activeDeck);
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
