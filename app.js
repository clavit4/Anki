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

function openCountScreen(deck) {
  state.activeDeck = deck;
  countDeckNameEl.textContent = deck.name;

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
  previewListEl.innerHTML = '';
  cards.forEach(card => {
    const li = document.createElement('li');

    const score = cardScore(deck.id, card);
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
}

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
  cardEl.classList.remove('flipped');
  cardEl.setAttribute('aria-pressed', 'false');
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

function gradeCard(grade) {
  if (!state.flipped) return;
  const card = state.sessionCards[state.index];

  recordGrade(state.activeDeck.id, card, grade);

  if (grade === GRADE.MISSED) {
    state.missed.push(card);
    scoreMissEl.textContent = String(state.missed.length);
  } else {
    state.correct++;
    scoreHitEl.textContent = String(state.correct);
  }

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
