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

// The deck's "back" text is often "meaning [on X, kun Y]" — the
// bracketed readings would give away exactly the kind of visual
// recognition this mode is testing, so only the meaning before the
// first "[" is shown. Cards with no bracket at all (custom decks,
// mostly) show their full back text unchanged.
function mcPromptText(back) {
  const bracketIndex = back.indexOf('[');
  return (bracketIndex === -1 ? back : back.slice(0, bracketIndex)).trim();
}

function renderMultipleChoiceCard(deck, card) {
  mcPromptEl.textContent = mcPromptText(card.back);
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
// Correct and wrong answers are handled differently on purpose: a
// right answer doesn't need confirming, so it just flashes green and
// moves on by itself; a wrong one pauses on tap-anywhere so there's
// actually time to read which option was correct before it's gone.
const CORRECT_ADVANCE_DELAY = 300;

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

  if (isCorrect) {
    setTimeout(() => recordGradeAndAdvance(GRADE.GOT_IT), CORRECT_ADVANCE_DELAY);
  } else {
    pendingMcGrade = GRADE.MISSED;
    mcStageEl.classList.add('is-awaiting-continue');
    mcTapHintEl.classList.add('is-visible');
  }
}

mcStageEl.addEventListener('click', () => {
  if (pendingMcGrade === null) return;
  const grade = pendingMcGrade;
  pendingMcGrade = null;
  recordGradeAndAdvance(grade);
});
