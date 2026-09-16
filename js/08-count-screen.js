'use strict';

/* ============================================================
   Count select screen
   ============================================================ */
const countGridEl = document.getElementById('countGrid');
const countDeckNameEl = document.getElementById('countDeckName');
const previewListEl = document.getElementById('previewList');
const sortToggleEl = document.getElementById('sortToggle');
const unselectAllBtnEl = document.getElementById('unselectAllBtn');
const addCardBtnEl = document.getElementById('addCardBtn');
const scrollTopBtnEl = document.getElementById('scrollTopBtn');
const modeFlashcardBtnEl = document.getElementById('modeFlashcardBtn');
const modeMultichoiceBtnEl = document.getElementById('modeMultichoiceBtn');
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function openCountScreen(deck) {
  state.activeDeck = deck;
  countDeckNameEl.textContent = deck.name;
  state.previewSort = 'original';
  addCardBtnEl.hidden = !deck.custom;

  // Multiple choice needs 3 other cards to draw distractors from —
  // below that, disable it rather than show a broken 1-2-option quiz.
  const uniqueFronts = new Set(state.decks[deck.id].cards.map(card => card.front)).size;
  const mcAvailable = uniqueFronts >= 4;
  modeMultichoiceBtnEl.disabled = !mcAvailable;
  modeMultichoiceBtnEl.title = mcAvailable ? '' : 'Needs at least 4 cards in this deck';
  setQuizMode('flashcard');

  // renderDeckPreview() computes state.previewVisibleCards and calls
  // renderCountGrid() itself once that's ready — calling it here too
  // would just render the grid against last screen's stale pool for
  // a moment.
  renderDeckPreview(deck);
  showScreen('screen-count');
}

function setQuizMode(mode) {
  state.quizMode = mode;
  modeFlashcardBtnEl.classList.toggle('is-active', mode === 'flashcard');
  modeMultichoiceBtnEl.classList.toggle('is-active', mode === 'multichoice');
}

modeFlashcardBtnEl.addEventListener('click', () => setQuizMode('flashcard'));
modeMultichoiceBtnEl.addEventListener('click', () => setQuizMode('multichoice'));

addCardBtnEl.addEventListener('click', () => {
  const deck = state.activeDeck;
  if (!deck) return;
  addCardToDeck(deck);
});

// Rebuilt any time a card gets checked/unchecked below, since the
// available session sizes and the "All" count depend on how many
// cards are currently active.
// Sized from the *current filter's* pool (state.previewVisibleCards),
// not the deck's whole active-card count — so switching to "Weaker"
// and picking "25" studies 25 random cards from your weak ones, not
// 25 random cards from the whole deck. A count bigger than the
// current pool is shown disabled rather than hidden, so the grid's
// layout stays put as you flip between filters instead of reflowing.
function renderCountGrid(deck) {
  const allCards = state.decks[deck.id].cards;
  const total = state.previewVisibleCards.length;
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

  // Zero cards for the current filter (e.g. "Non-graded" once you've
  // studied everything) still shows the full row of buttons — just
  // every one of them grayed out, same as any other filter whose
  // pool is smaller than a given option — rather than swapping the
  // whole grid out for a text message. The card-list below still
  // explains *why* it's empty (see EMPTY_FILTER_MESSAGES there).
  COUNT_OPTIONS.forEach(n => countGridEl.appendChild(makeCountButton(n, `${n} cards`, total, false, n >= total)));
  countGridEl.appendChild(makeCountButton(total, `All (${total})`, total, true, total === 0));
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
  } else if (state.previewSort === 'confusable') {
    // Cards whose front is in some confusable-kanji group — see
    // decks/confusable-kanji.json and getConfusableChars() in
    // 11-quiz-multichoice.js. Empty until that file finishes loading,
    // which for a small local file resolves well before anyone
    // reaches this screen in practice.
    visible = withScores.filter(({ card }) => getConfusableChars(card.front).length > 0);
  }

  // What the count buttons (10/25/50/100/All) below will draw a
  // session from — kept in sync here so renderCountGrid() doesn't
  // need to recompute or re-filter anything. Skipped cards stay in
  // the *list* (dimmed) for every filter, but shouldn't sneak into
  // the *play pool* — except on "Non-active" itself, whose whole
  // point is letting you drill exactly your skipped cards without
  // reactivating them.
  const playable = state.previewSort === 'nonactive'
    ? visible
    : visible.filter(({ card }) => isCardActive(deck.id, card));
  state.previewVisibleCards = playable.map(({ card }) => card);
  updateSortToggleLabel(visible.length);
  // The count buttons size a session drawn from this same filtered
  // pool now, not the deck's whole active-card count — see
  // renderCountGrid() — so it needs refreshing any time this does.
  renderCountGrid(deck);

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

        // List membership doesn't change for these filters (none of
        // them filter by active state), but the play pool does — every
        // filter except Non-active excludes inactive cards from it.
        // Keep it in sync without a full list rebuild.
        state.previewVisibleCards = nowActive
          ? state.previewVisibleCards.concat(card)
          : state.previewVisibleCards.filter(c => c !== card);
        renderCountGrid(deck);
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
  renderDeckPreview(deck); // also refreshes the count grid now
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

function makeCountButton(n, label, total, isAll, disabled) {
  const btn = document.createElement('button');
  btn.className = 'count-btn' + (isAll ? ' is-all' : '');
  btn.type = 'button';
  btn.disabled = !!disabled;
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
