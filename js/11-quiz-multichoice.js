'use strict';

/* ============================================================
   Quiz screen — multiple choice mode. The prompt shows the card's
   "back" (meaning/reading) and you pick the correct kanji from 4
   options. See js/09-quiz-core.js for the shared session/grading
   engine both modes fan into (renderCurrentCard() there dispatches
   here when state.quizMode === 'multichoice').

   Distractors are hand-picked groups of kanji that are genuinely
   easy to mix up at a glance (shared radical/component, similar
   overall shape), not an exhaustive or algorithmic similarity
   measure. A kanji outside every group here just falls back to
   random distractors in buildMultipleChoiceOptions() below, rather
   than force a weak "lookalike" claim.

   The groups themselves live in decks/confusable-kanji.json rather
   than here, so they're plain, hand-editable data (add a group, or
   drop in a whole new file) instead of JS you'd have to touch this
   file to change. Fetched once at boot — see the bottom of this
   file — same pattern loadDeck() uses for CSV decks.
   ============================================================ */
const mcStageEl = document.getElementById('mcStage');
const mcPromptEl = document.getElementById('mcPrompt');
const mcOptionsEl = document.getElementById('mcOptions');
const mcTapHintEl = document.getElementById('mcTapHint');
let pendingMcGrade = null; // set once you answer, cleared on advance — see answerMultipleChoice()

let CONFUSABLE_KANJI_GROUPS = [];

fetch('decks/confusable-kanji.json', { cache: 'no-store' })
  .then(res => (res.ok ? res.json() : []))
  .then(groups => { CONFUSABLE_KANJI_GROUPS = Array.isArray(groups) ? groups : []; })
  .catch(() => { CONFUSABLE_KANJI_GROUPS = []; });

function getConfusableChars(char) {
  const group = CONFUSABLE_KANJI_GROUPS.find(g => g.includes(char));
  return group ? group.filter(c => c !== char) : [];
}

// The correct card's front plus 3 distractors, shuffled. Distractors
// come from its confusable group first (when the deck actually
// contains those characters as other cards), then padded out with
// random other cards' fronts if the group is too small or empty.
function buildMultipleChoiceOptions(deck, card) {
  const otherFronts = state.decks[deck.id].cards
    .filter(c => c.front !== card.front)
    .map(c => c.front);

  const distractors = [];
  shuffle(getConfusableChars(card.front).filter(ch => otherFronts.includes(ch))).forEach(ch => {
    if (distractors.length < 3 && !distractors.includes(ch)) distractors.push(ch);
  });
  if (distractors.length < 3) {
    shuffle(otherFronts).forEach(front => {
      if (distractors.length < 3 && !distractors.includes(front)) distractors.push(front);
    });
  }

  return shuffle([card.front, ...distractors]);
}

function renderMultipleChoiceCard(deck, card) {
  mcPromptEl.textContent = card.back;
  mcOptionsEl.innerHTML = '';
  mcStageEl.classList.remove('is-awaiting-continue');
  mcTapHintEl.classList.remove('is-visible');
  pendingMcGrade = null;
  buildMultipleChoiceOptions(deck, card).forEach(optionFront => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mc-option';
    btn.textContent = optionFront;
    // Without stopping propagation, this click would immediately bubble
    // up to mcStageEl's "tap anywhere to continue" listener below and
    // fire it in the same dispatch — since pendingMcGrade is set
    // synchronously inside answerMultipleChoice() — skipping straight
    // past the feedback on the very first tap.
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      answerMultipleChoice(optionFront === card.front, btn);
    });
    mcOptionsEl.appendChild(btn);
  });
}

// Locks the options and flashes correct/wrong feedback (revealing the
// right answer too, if you picked wrong), then just waits — no timer,
// no button popping into the layout. Tapping anywhere in .mc-stage
// (see the listener below) advances once an answer is pending, same
// tap-when-ready pacing flashcard mode already uses.
function answerMultipleChoice(isCorrect, clickedBtn) {
  const card = state.sessionCards[state.index];
  mcOptionsEl.querySelectorAll('.mc-option').forEach(btn => {
    // Locked via pointer-events (CSS), not the disabled attribute —
    // a disabled button never dispatches click at all, which would
    // swallow the tap instead of letting it bubble up to mcStageEl.
    btn.classList.add('is-locked');
    if (btn === clickedBtn) btn.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    else if (!isCorrect && btn.textContent === card.front) btn.classList.add('is-correct');
  });
  pendingMcGrade = isCorrect ? GRADE.GOT_IT : GRADE.MISSED;
  mcStageEl.classList.add('is-awaiting-continue');
  mcTapHintEl.classList.add('is-visible');
}

mcStageEl.addEventListener('click', () => {
  if (pendingMcGrade === null) return;
  const grade = pendingMcGrade;
  pendingMcGrade = null;
  recordGradeAndAdvance(grade);
});
