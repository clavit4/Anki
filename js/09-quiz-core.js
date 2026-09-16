'use strict';

/* ============================================================
   Quiz screen — shared engine used by both study modes
   (js/10-quiz-flashcard.js and js/11-quiz-multichoice.js): session
   setup/teardown, the per-card render dispatcher, grade bookkeeping,
   and Undo. Mode-specific rendering/input lives in those two files.
   ============================================================ */
const progressCountEl = document.getElementById('progressCount');
const progressFillEl = document.getElementById('progressFill');
const scoreHitEl = document.getElementById('scoreHitCount');
const scoreMissEl = document.getElementById('scoreMissCount');
const undoBtnEl = document.getElementById('undoBtn');
const undoFromResultsEl = document.getElementById('undoFromResults');

// Resets session state and jumps into the quiz with an already-
// decided list of cards (already shuffled/limited by the caller).
function startSessionWithCards(cards) {
  state.sessionCards = cards;
  state.index = 0;
  state.correct = 0;
  state.missed = [];
  state.history = [];
  scoreHitEl.textContent = '0';
  scoreMissEl.textContent = '0';
  updateUndoAvailability();

  // Fixed for the whole session (the mode toggle only lives on the
  // count screen, before a session starts), so this only needs
  // setting once here rather than on every renderCurrentCard() call.
  const isMultipleChoice = state.quizMode === 'multichoice';
  cardStageEl.hidden = isMultipleChoice;
  actionRowEl.hidden = isMultipleChoice;
  mcStageEl.hidden = !isMultipleChoice;

  showScreen('screen-quiz');
  renderCurrentCard();
}

// Draws from the current filter's pool (state.previewVisibleCards),
// not the deck's whole active-card set — see renderCountGrid() in
// 08-count-screen.js, which sizes its buttons off the same pool.
function startSession(count) {
  startSessionWithCards(shuffle(state.previewVisibleCards).slice(0, count));
}

// Updates the shared progress bar/counter, then dispatches to
// whichever mode's own renderer — renderFlashcardCard() or
// renderMultipleChoiceCard() — owns the rest of the screen.
function renderCurrentCard() {
  const total = state.sessionCards.length;
  const card = state.sessionCards[state.index];

  progressCountEl.textContent = `${state.index + 1} / ${total}`;
  progressFillEl.style.width = `${(state.index / total) * 100}%`;

  if (state.quizMode === 'multichoice') {
    renderMultipleChoiceCard(state.activeDeck, card);
  } else {
    renderFlashcardCard(card);
  }
}

// Shared by both quiz modes: gradeCard() (flashcards) and
// answerMultipleChoice() both fan into this once they've decided a
// grade, so the history/score bookkeeping and end-of-session check
// only live in one place.
function recordGradeAndAdvance(grade) {
  const card = state.sessionCards[state.index];
  const gradedIndex = state.index;

  // Multiple choice is a separate practice mode by design — it keeps
  // its own live session score/results below, but never touches the
  // persistent per-card history flashcards write to, so it can't
  // shift weakest/strongest sorting or the score stripe color.
  if (state.quizMode !== 'multichoice') {
    recordGrade(state.activeDeck.id, card, grade);
  }

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

  // Mirrors the same mode check in recordGradeAndAdvance() — a
  // multiple choice answer never wrote to this card's persistent
  // history, so there's nothing there to roll back. (Skipping this
  // matters, not just being redundant: if the same card also has
  // *real* flashcard history from another session, popping here
  // would incorrectly delete that instead.)
  if (state.quizMode !== 'multichoice') {
    removeLastGradeRecord(state.activeDeck.id, card);
  }

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
  // Flashcards only — flips to the answer right away so you can just
  // tap the right grade. Multiple choice has no flip step; its own
  // re-render already puts you back at a fresh, answerable prompt.
  if (state.quizMode === 'flashcard') flipCard();
}

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

document.getElementById('quitQuiz').addEventListener('click', () => {
  // Cards graded so far are already saved (recordGrade() runs per
  // grade, not at session end) — show the results screen for them
  // instead of just discarding the session outright. Nothing to show
  // if you quit before grading a single card, though.
  if (state.history.length > 0) {
    finishSession();
  } else {
    showScreen('screen-count');
  }
});
