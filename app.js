'use strict';

/* ============================================================
   Config — edit this to point at your own decks.
   Add or remove entries as needed; each needs a unique id,
   a display name, and a path to a CSV file with a
   "front,back" header followed by one card per row.
   ============================================================ */
const DECKS = [
  { id: 'deck1', name: 'Deck 1', file: 'decks/deck1.csv' },
  { id: 'deck2', name: 'Deck 2', file: 'decks/deck2.csv' },
];

const COUNT_OPTIONS = [10, 25, 50, 100];

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

function openCountScreen(deck) {
  state.activeDeck = deck;
  countDeckNameEl.textContent = deck.name;

  const total = state.decks[deck.id].cards.length;
  countGridEl.innerHTML = '';

  const options = COUNT_OPTIONS.filter(n => n < total);
  options.forEach(n => countGridEl.appendChild(makeCountButton(n, `${n} cards`, total)));
  countGridEl.appendChild(makeCountButton(total, `All (${total})`, total, true));

  showScreen('screen-count');
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
const cardBackTextEl = document.getElementById('cardBackText');
const progressCountEl = document.getElementById('progressCount');
const progressFillEl = document.getElementById('progressFill');
const gradeRowEl = document.getElementById('gradeRow');
const tapHintEl = document.getElementById('tapHint');

function startSession(count) {
  const allCards = state.decks[state.activeDeck.id].cards;
  state.sessionCards = shuffle(allCards).slice(0, count);
  state.index = 0;
  state.correct = 0;
  state.missed = [];
  showScreen('screen-quiz');
  renderCurrentCard();
}

function renderCurrentCard() {
  const total = state.sessionCards.length;
  const card = state.sessionCards[state.index];

  state.flipped = false;
  cardEl.classList.remove('flipped');
  cardEl.setAttribute('aria-pressed', 'false');
  gradeRowEl.classList.remove('is-visible');
  tapHintEl.textContent = 'Tap the card, or press space, to reveal the answer';

  cardFrontTextEl.textContent = card.front;
  cardBackTextEl.textContent = card.back;

  progressCountEl.textContent = `${state.index + 1} / ${total}`;
  progressFillEl.style.width = `${(state.index / total) * 100}%`;
}

function flipCard() {
  if (state.flipped) return;
  state.flipped = true;
  cardEl.classList.add('flipped');
  cardEl.setAttribute('aria-pressed', 'true');
  gradeRowEl.classList.add('is-visible');
  tapHintEl.textContent = '';
}

function gradeCard(gotIt) {
  if (!state.flipped) return;
  const card = state.sessionCards[state.index];
  if (gotIt) {
    state.correct++;
  } else {
    state.missed.push(card);
  }

  if (state.index + 1 >= state.sessionCards.length) {
    finishSession();
  } else {
    state.index++;
    renderCurrentCard();
  }
}

cardEl.addEventListener('click', flipCard);
cardEl.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); flipCard(); }
});

document.getElementById('gradeMiss').addEventListener('click', () => gradeCard(false));
document.getElementById('gradeHit').addEventListener('click', () => gradeCard(true));

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('screen-quiz').classList.contains('active')) return;
  if (!state.flipped) return;
  if (e.code === 'ArrowLeft') gradeCard(false);
  if (e.code === 'ArrowRight') gradeCard(true);
});

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
