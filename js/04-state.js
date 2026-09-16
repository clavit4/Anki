'use strict';

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
  quizMode: 'flashcard', // 'flashcard' | 'multichoice'
  previewSort: 'original', // 'original' | 'weakest' | 'strongest' | 'nongraded' | 'active' | 'nonactive'
  previewVisibleCards: [], // cards the current preview filter is showing, kept in sync by renderDeckPreview() — what the count-grid buttons draw a session from
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
