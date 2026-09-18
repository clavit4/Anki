'use strict';

/* ============================================================
   Activity heatmap — a one-month-at-a-time calendar (Mon-Sun
   columns, weeks as rows) of days you graded a flashcard, shown
   on the deck-select screen below the deck list. Swipe or tap the
   arrows to change months; the current month is the newest you
   can reach — heatmapMonthOffset never goes above 0.

   Reads straight off localStorage's grade-history keys
   (recall:*:card:* and recall:*:temp:*, see 03-storage.js) instead
   of iterating loaded decks, so it reflects every deck you've ever
   studied — including ones since deleted (their history is gone
   too, same as deleteDeckStorage() already implies elsewhere).

   Multiple choice never calls recordGrade() (see
   11-quiz-multichoice.js) so it leaves nothing here to read —
   this is Flashcard-mode activity only, by the same deliberate
   isolation that keeps MC out of the Weakest/Strongest scoring.
   ============================================================ */
const heatmapEl = document.getElementById('activityHeatmap');
const heatmapMonthLabelEl = document.getElementById('heatmapMonthLabel');
const heatmapSwipeAreaEl = document.getElementById('heatmapSwipeArea');
const heatmapGridEl = document.getElementById('heatmapGrid');
const heatmapDetailEl = document.getElementById('heatmapDetail');
const heatmapPrevBtnEl = document.getElementById('heatmapPrevBtn');
const heatmapNextBtnEl = document.getElementById('heatmapNextBtn');

// 0 = the current real month, negative = that many months back. Not
// reset on every render — swiping back and returning to this screen
// later keeps showing where you left off, like a normal calendar app.
let heatmapMonthOffset = 0;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Local calendar day, not UTC — toISOString() would shift the date
// near midnight for anyone west/east of UTC.
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Every grade ever recorded, bucketed by the local day it happened.
// Scanned straight off localStorage (not `state`, which only holds
// whichever decks happen to be loaded right now) so a deck you
// haven't opened this session still counts.
function collectDailyCounts() {
  const counts = new Map();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('recall:')) continue;
    // Matches recall:<deckId>:card:<id> and recall:<deckId>:temp:<hash>
    // (the null-id fallback) — both hold the same {grade, timestamp}[]
    // shape. Deliberately not a regex: a custom deck's id already
    // contains its own "custom:" colon, so anchoring on segment
    // position is fragile; these two substrings never appear inside
    // a deckId (slugify() only produces [a-z0-9-]) or inside the
    // sibling :active:/:activeTemp:/:cards keys.
    if (!key.includes(':card:') && !key.includes(':temp:')) continue;
    let history;
    try {
      history = JSON.parse(localStorage.getItem(key));
    } catch (err) {
      continue;
    }
    if (!Array.isArray(history)) continue;
    history.forEach(entry => {
      if (!entry || typeof entry.timestamp !== 'number') return;
      const k = dayKey(new Date(entry.timestamp));
      counts.set(k, (counts.get(k) || 0) + 1);
    });
  }
  return counts;
}

// 0 (no activity) plus 4 relative intensity steps, scaled off the
// single busiest day across *all* your history (not just the month
// on screen) — so the color scale means the same thing as you swipe
// between months instead of recalibrating every time, and the top
// tier always means "one of my best days ever".
function levelFor(count, maxCount) {
  if (count === 0 || maxCount === 0) return 0;
  const ratio = count / maxCount;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function reviewsLabel(count) {
  return `${count} ${count === 1 ? 'review' : 'reviews'}`;
}

function daysLabel(count) {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

function makeBlankCell() {
  const cell = document.createElement('div');
  cell.className = 'heatmap-cell is-empty';
  return cell;
}

function renderActivityHeatmap() {
  const counts = collectDailyCounts();
  const everCount = [...counts.values()].reduce((a, b) => a + b, 0);

  heatmapEl.classList.toggle('is-empty', everCount === 0);
  if (everCount === 0) {
    heatmapDetailEl.textContent = 'No flashcard activity yet — study a deck to fill this in.';
    return;
  }

  let maxCount = 0;
  counts.forEach(c => { if (c > maxCount) maxCount = c; });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const displayed = new Date(today.getFullYear(), today.getMonth() + heatmapMonthOffset, 1);
  const year = displayed.getFullYear();
  const month = displayed.getMonth();

  heatmapMonthLabelEl.textContent = `${MONTH_NAMES[month]} ${year}`;
  heatmapNextBtnEl.disabled = heatmapMonthOffset >= 0; // never swipe/tap into the future

  heatmapGridEl.innerHTML = '';
  // Monday-indexed weekday of the 1st (JS getDay() is Sunday-indexed).
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < leadingBlanks; i++) heatmapGridEl.appendChild(makeBlankCell());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let monthTotal = 0;
  let monthActiveDays = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    if (date > today) {
      heatmapGridEl.appendChild(makeBlankCell());
      continue;
    }
    const count = counts.get(dayKey(date)) || 0;
    if (count > 0) {
      monthTotal += count;
      monthActiveDays++;
    }
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `heatmap-cell level-${levelFor(count, maxCount)}`;
    if (isSameDay(date, today)) cell.classList.add('is-today');
    cell.textContent = String(d);
    cell.addEventListener('click', () => {
      heatmapDetailEl.textContent = `${reviewsLabel(count)} on ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    });
    heatmapGridEl.appendChild(cell);
  }

  const trailingBlanks = (7 - (heatmapGridEl.children.length % 7)) % 7;
  for (let i = 0; i < trailingBlanks; i++) heatmapGridEl.appendChild(makeBlankCell());

  heatmapDetailEl.textContent = monthActiveDays === 0
    ? 'No flashcard activity this month.'
    : `${reviewsLabel(monthTotal)} across ${daysLabel(monthActiveDays)}`;
}

heatmapPrevBtnEl.addEventListener('click', () => {
  heatmapMonthOffset -= 1;
  renderActivityHeatmap();
});

heatmapNextBtnEl.addEventListener('click', () => {
  if (heatmapMonthOffset >= 0) return;
  heatmapMonthOffset += 1;
  renderActivityHeatmap();
});

// Swipe to change months — passive listeners (never call
// preventDefault) so a mostly-vertical drag still scrolls the page
// normally; only a clearly horizontal drag past the threshold counts.
let heatmapTouchStartX = null;
let heatmapTouchStartY = null;

heatmapSwipeAreaEl.addEventListener('touchstart', (e) => {
  heatmapTouchStartX = e.touches[0].clientX;
  heatmapTouchStartY = e.touches[0].clientY;
}, { passive: true });

heatmapSwipeAreaEl.addEventListener('touchend', (e) => {
  if (heatmapTouchStartX === null) return;
  const dx = e.changedTouches[0].clientX - heatmapTouchStartX;
  const dy = e.changedTouches[0].clientY - heatmapTouchStartY;
  heatmapTouchStartX = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return; // not a clear horizontal swipe
  if (dx < 0) heatmapNextBtnEl.click();
  else heatmapPrevBtnEl.click();
}, { passive: true });
