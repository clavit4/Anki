'use strict';

/* ============================================================
   Count select screen
   ============================================================ */
const countGridEl = document.getElementById('countGrid');
const countDeckNameEl = document.getElementById('countDeckName');
const previewListEl = document.getElementById('previewList');
const filterTriggerEl = document.getElementById('filterTrigger');
const filterTriggerLabelEl = document.getElementById('filterTriggerLabel');
const unselectAllBtnEl = document.getElementById('unselectAllBtn');
const addCardBtnEl = document.getElementById('addCardBtn');
const scrollTopBtnEl = document.getElementById('scrollTopBtn');
const modeFlashcardBtnEl = document.getElementById('modeFlashcardBtn');
const modeMultichoiceBtnEl = document.getElementById('modeMultichoiceBtn');
const filterSheetOverlayEl = document.getElementById('filterSheetOverlay');
const filterSheetEl = document.getElementById('filterSheet');
const filterSheetCloseEl = document.getElementById('filterSheetClose');
const filterTileGridEl = document.getElementById('filterTileGrid');
const sheetGrabberEl = document.getElementById('sheetGrabber');
const sheetHeadEl = document.getElementById('sheetHead');
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

// Returns the filtered+sorted `{card, score, [due]}` list for `mode`
// against an already-scored `withScores` array. Factored out of
// renderDeckPreview() so computeFilterCounts() (the filter sheet) can
// run every mode against the same scored array without either
// duplicating these branches or re-scoring the deck 8 times over.
function filterCardsForMode(deck, mode, withScores) {
  if (mode === 'original') {
    // By id number rather than raw CSV row order, so re-shuffling rows
    // in the CSV doesn't change this view. Cards without an id (none
    // assigned yet) sort after every numbered card.
    return withScores.slice().sort((a, b) => idSortKey(a.card) - idSortKey(b.card));
  } else if (mode === 'weakest') {
    // Graded cards you haven't mastered ("Got it") yet, weakest first.
    // Never-studied cards live in their own "Non-graded" tab instead.
    const visible = withScores.filter(({ score }) => score !== null && scoreBucket(score) !== GRADE.GOT_IT);
    visible.sort((a, b) => a.score - b.score);
    return visible;
  } else if (mode === 'strongest') {
    // Only cards bucketed as "Got it" or "Almost", strongest first.
    const visible = withScores.filter(({ score }) => {
      const bucket = scoreBucket(score);
      return bucket === GRADE.GOT_IT || bucket === GRADE.ALMOST;
    });
    visible.sort((a, b) => b.score - a.score);
    return visible;
  } else if (mode === 'nongraded') {
    // Cards that have never been studied at all, by id number.
    const visible = withScores.filter(({ score }) => score === null);
    visible.sort((a, b) => idSortKey(a.card) - idSortKey(b.card));
    return visible;
  } else if (mode === 'active') {
    return withScores.filter(({ card }) => isCardActive(deck.id, card));
  } else if (mode === 'nonactive') {
    return withScores.filter(({ card }) => !isCardActive(deck.id, card));
  } else if (mode === 'confusable') {
    // Cards whose front is in some confusable-kanji group — see
    // decks/confusable-kanji.json and getConfusableChars() in
    // 11-quiz-multichoice.js. Empty until that file finishes loading,
    // which for a small local file resolves well before anyone
    // reaches this screen in practice.
    return withScores.filter(({ card }) => getConfusableChars(card.front).length > 0);
  } else if (mode === 'due') {
    // Spaced-repetition queue — see computeSrsState()/cardDueInfo() in
    // 03-storage.js. Actual reviews (cards you've studied before and
    // are now due again) rank ahead of never-studied cards, most
    // overdue first — forgetting something you already learned is
    // more urgent than meeting something new, same priority real SRS
    // tools use. Without this, a deck with lots of never-graded cards
    // would bury its truly overdue reviews under a wall of "New".
    let visible = withScores.map(entry => Object.assign({ due: cardDueInfo(deck.id, entry.card) }, entry));
    visible = visible.filter(({ due }) => due.isNew || due.overdueDays >= 0);
    visible.sort((a, b) => {
      if (a.due.isNew !== b.due.isNew) return a.due.isNew ? 1 : -1;
      return a.due.isNew ? idSortKey(a.card) - idSortKey(b.card) : b.due.overdueDays - a.due.overdueDays;
    });
    return visible;
  }
  return withScores;
}

// One count per SORT_MODES key, for the filter sheet's tiles — scores
// the deck once, then runs every mode's filter against that same
// array instead of re-scoring per mode.
function computeFilterCounts(deck) {
  const cards = state.decks[deck.id].cards;
  const withScores = cards.map(card => ({ card, score: cardScore(deck.id, card) }));
  const counts = {};
  SORT_MODES.forEach(mode => { counts[mode] = filterCardsForMode(deck, mode, withScores).length; });
  return counts;
}

function renderDeckPreview(deck) {
  const cards = state.decks[deck.id].cards;

  // Score once up front so filtering/sorting doesn't recompute per card.
  const withScores = cards.map(card => ({ card, score: cardScore(deck.id, card) }));
  const visible = filterCardsForMode(deck, state.previewSort, withScores);

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
  updateFilterTriggerLabel(visible.length);
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

  visible.forEach(({ card, score, due }) => {
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

    // Only present on the Due filter (see the `due` filter branch
    // above) — shown inline rather than only in the hover title,
    // since this app is mostly used on a phone where hover never
    // fires.
    if (due) {
      const badge = document.createElement('div');
      badge.className = 'preview-due';
      badge.textContent = dueBadgeText(due);
      content.appendChild(badge);
    }

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
  // clampScrollToContent() below pulls the scroll position back only
  // if the page actually got too short to support where it was,
  // instead of always snapping to the top.
  renderDeckPreview(deck); // also refreshes the count grid now
  clampScrollToContent();
});

// Text of the filter-trigger button. Takes the count of cards the
// *current* filter is showing, so e.g. "Weaker (12)" always reflects
// what's actually on screen — set from renderDeckPreview() right
// after it finishes filtering, which is the one place that count is
// known. (The button always looks "on" via .filter-trigger's own
// CSS — every filter, "Original" included, is an equally deliberate
// choice, not a default/disabled state.)
function updateFilterTriggerLabel(count) {
  filterTriggerLabelEl.textContent = `${SORT_LABELS[state.previewSort]} (${count})`;
}

// "New" for a never-studied card, "Due today" right on schedule,
// otherwise how many days overdue — matches the overdueDays cardDueInfo()
// already computed for sorting, so this never disagrees with the order
// the list is actually shown in.
function dueBadgeText(due) {
  if (due.isNew) return 'New';
  if (due.overdueDays === 0) return 'Due today';
  return `${due.overdueDays} ${due.overdueDays === 1 ? 'day' : 'days'} overdue`;
}

/* ============================================================
   Filter sheet — tap #filterTrigger to open, tap a tile to pick a
   filter (closes automatically), or dismiss without picking via the
   backdrop, the × button, Escape, or dragging down from the
   grabber/header. Built from FILTER_SHEET_GROUPS (01-config.js) each
   time it opens rather than once at boot, so it always reflects
   whichever deck is currently open and its current card counts.
   ============================================================ */
function renderFilterSheetTiles(deck) {
  const counts = computeFilterCounts(deck);
  filterTileGridEl.innerHTML = '';

  FILTER_SHEET_GROUPS.forEach(group => {
    if (group.label) {
      const label = document.createElement('p');
      label.className = 'sheet-section-label';
      label.textContent = group.label;
      filterTileGridEl.appendChild(label);
    }
    group.modes.forEach(mode => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'filter-tile' + (group.full ? ' is-full' : '');
      tile.classList.toggle('is-selected', mode === state.previewSort);
      const count = counts[mode];
      tile.innerHTML = `<span class="tile-count">${count}</span><span class="tile-label">${SORT_LABELS[mode]}</span>`
        + (mode === 'due' ? '<span class="tile-hint">includes new cards</span>' : '');
      tile.addEventListener('click', () => {
        state.previewSort = mode;
        renderDeckPreview(deck);
        clampScrollToContent();
        closeFilterSheet();
      });
      filterTileGridEl.appendChild(tile);
    });
  });
}

function openFilterSheet() {
  const deck = state.activeDeck;
  if (!deck) return;
  renderFilterSheetTiles(deck);
  filterSheetOverlayEl.hidden = false;
  // Locks the page behind the sheet so a swipe anywhere on it can't
  // fall through to the browser's own scroll/pull-to-refresh — see
  // closeFilterSheet() for the matching restore.
  document.body.style.overflow = 'hidden';
  // Needs a frame to actually paint hidden -> visible before adding
  // the class that drives the slide-up transition, or the transition
  // has no "before" state to animate from and just snaps open.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => filterSheetOverlayEl.classList.add('is-open'));
  });
}

function closeFilterSheet() {
  if (filterSheetOverlayEl.hidden || !filterSheetOverlayEl.classList.contains('is-open')) return;
  filterSheetOverlayEl.classList.remove('is-open');
  document.body.style.overflow = '';
  filterSheetEl.addEventListener('transitionend', function onDone(e) {
    if (e.propertyName !== 'transform') return;
    filterSheetEl.removeEventListener('transitionend', onDone);
    filterSheetOverlayEl.hidden = true;
  });
}

filterTriggerEl.addEventListener('click', openFilterSheet);
filterSheetCloseEl.addEventListener('click', closeFilterSheet);
filterSheetOverlayEl.addEventListener('click', (e) => {
  if (e.target === filterSheetOverlayEl) closeFilterSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filterSheetOverlayEl.classList.contains('is-open')) closeFilterSheet();
});

// Swipe-to-dismiss, from the grabber or the header only — not the
// tile grid below, so a drag never fights a tap on a tile. Follows
// the finger 1:1 while dragging (transition disabled, inline
// transform set directly), then either snaps back (short drag) or
// finishes the same downward motion through to fully closed (past
// SHEET_DISMISS_PX) instead of bouncing back up first.
const SHEET_DISMISS_PX = 80;
let sheetDragStartY = null;
let sheetDragY = 0;

function onSheetDragStart(e) {
  sheetDragStartY = e.touches[0].clientY;
  filterSheetEl.style.transition = 'none';
}

function onSheetDragMove(e) {
  if (sheetDragStartY === null) return;
  e.preventDefault(); // keep this gesture from ever reaching the page's own scroll/pull-to-refresh
  sheetDragY = Math.max(0, e.touches[0].clientY - sheetDragStartY);
  filterSheetEl.style.transform = `translateY(${sheetDragY}px)`;
}

function onSheetDragEnd() {
  if (sheetDragStartY === null) return;
  filterSheetEl.style.transition = '';
  const dragged = sheetDragY;
  sheetDragStartY = null;
  sheetDragY = 0;

  if (dragged > SHEET_DISMISS_PX) {
    filterSheetEl.style.transform = 'translateY(100%)';
    filterSheetOverlayEl.classList.remove('is-open');
    document.body.style.overflow = '';
    filterSheetEl.addEventListener('transitionend', function onDone(e) {
      if (e.propertyName !== 'transform') return;
      filterSheetEl.removeEventListener('transitionend', onDone);
      filterSheetEl.style.transform = '';
      filterSheetOverlayEl.hidden = true;
    });
  } else {
    filterSheetEl.style.transform = ''; // .is-open .sheet (still active) snaps it back to translateY(0)
  }
}

[sheetGrabberEl, sheetHeadEl].forEach(el => {
  el.addEventListener('touchstart', onSheetDragStart, { passive: true });
  el.addEventListener('touchmove', onSheetDragMove, { passive: false });
  el.addEventListener('touchend', onSheetDragEnd);
});

// Switching to a filter with far fewer (or zero) cards can shrink the
// page drastically — if the window was scrolled deep into the
// previous filter's long list, leaving the browser to forcibly snap
// the scroll position back to fit looks like the page jumping/
// resizing oddly. This used to be "fixed" by unconditionally
// scrolling to the top *before* every re-render, which did stop the
// jump but also yanked the page to the top on every single filter
// switch — including the common case where the new list is plenty
// tall enough that nothing would've snapped at all, which is its own
// annoyance when you're paging through filters mid-read.
//
// Call this *after* the re-render instead: scrollHeight reflects the
// new (already-rendered) content, and reading it forces a layout
// flush, but window.scrollY itself isn't touched by that — the
// browser only auto-corrects an overflowing scroll position as part
// of the next paint, which hasn't happened yet at this point in the
// script — so comparing the two here still catches the old position
// before the browser would silently snap it, and only intervenes
// when that position is actually now too far down. Lands on the new
// max scroll rather than forcing all the way to 0, so you end up as
// close to where you were as the shorter content allows.
function clampScrollToContent() {
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  if (window.scrollY > maxScroll) {
    window.scrollTo(0, maxScroll);
  }
}

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
