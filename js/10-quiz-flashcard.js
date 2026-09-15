'use strict';

/* ============================================================
   Quiz screen — flashcard mode: flip the card, self-grade with
   the four grade buttons. See js/09-quiz-core.js for the shared
   session/grading engine both modes fan into.
   ============================================================ */
const cardStageEl = document.getElementById('cardStage');
const cardEl = document.getElementById('card');
const cardInnerEl = document.getElementById('cardInner');
const cardFrontTextEl = document.getElementById('cardFrontText');
const cardBackFrontTextEl = document.getElementById('cardBackFrontText');
const cardBackTextEl = document.getElementById('cardBackText');
const actionRowEl = document.getElementById('actionRow');
const flipBtnEl = document.getElementById('flipBtn');
const gradeRowEl = document.getElementById('gradeRow');
const tapHintEl = document.getElementById('tapHint');

function renderFlashcardCard(card) {
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
  recordGradeAndAdvance(grade);
}

cardEl.addEventListener('click', flipCard);
flipBtnEl.addEventListener('click', flipCard);

document.getElementById('gradeMiss').addEventListener('click', () => gradeCard(GRADE.MISSED));
document.getElementById('gradeHard').addEventListener('click', () => gradeCard(GRADE.HARD));
document.getElementById('gradeAlmost').addEventListener('click', () => gradeCard(GRADE.ALMOST));
document.getElementById('gradeHit').addEventListener('click', () => gradeCard(GRADE.GOT_IT));
