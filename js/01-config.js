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
