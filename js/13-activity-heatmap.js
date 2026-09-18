'use strict';

/* ============================================================
   Activity heatmap — GitHub-style calendar of days you graded a
   flashcard, shown on the deck-select screen below the deck list.
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
const HEATMAP_WINDOW_MONTHS = 6;
const heatmapEl = document.getElementById('activityHeatmap');
const heatmapScrollEl = document.getElementById('heatmapScroll');
const heatmapGridEl = document.getElementById('heatmapGrid');
const heatmapDetailEl = document.getElementById('heatmapDetail');

// Local calendar day, not UTC — toISOString() would shift the date
// near midnight for anyone west/east of UTC.
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

// 0 (no activity) plus 4 relative intensity steps scaled off this
// window's own busiest day — a fixed cutoff like "100" would either
// never light up for a light user or cap out immediately for a
// heavy one, so the top tier always means "your best day so far".
function levelFor(count, maxCount) {
  if (count === 0 || maxCount === 0) return 0;
  const ratio = count / maxCount;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function reviewsLabel(count) {
  return `${count} ${count === 1 ? 'review' : 'reviews'}`;
}

function renderActivityHeatmap() {
  const counts = collectDailyCounts();
  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);

  heatmapGridEl.innerHTML = '';
  heatmapEl.classList.toggle('is-empty', totalCount === 0);
  if (totalCount === 0) {
    heatmapDetailEl.textContent = 'No flashcard activity yet — study a deck to fill this in.';
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setMonth(windowStart.getMonth() - HEATMAP_WINDOW_MONTHS);
  // Snap back to the Sunday on/before windowStart so every column is
  // a full Sun-Sat week — same alignment GitHub's own graph uses.
  windowStart.setDate(windowStart.getDate() - windowStart.getDay());

  const totalDays = Math.round((today - windowStart) / 86400000) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);

  let maxCount = 0;
  counts.forEach(c => { if (c > maxCount) maxCount = c; });

  let lastMonth = -1;
  let activeDays = 0;

  for (let i = 0; i < totalWeeks * 7; i++) {
    const date = new Date(windowStart);
    date.setDate(date.getDate() + i);
    const week = Math.floor(i / 7) + 1; // 1-indexed grid column
    const dow = i % 7; // 0 = Sunday — day rows start at grid-row 2, row 1 is month labels

    if (dow === 0 && date.getMonth() !== lastMonth) {
      const label = document.createElement('span');
      label.className = 'heatmap-month-label';
      label.style.gridColumn = String(week);
      label.textContent = MONTH_LABELS[date.getMonth()];
      heatmapGridEl.appendChild(label);
      lastMonth = date.getMonth();
    }

    if (date > today) continue; // partial trailing week — leave blank

    const count = counts.get(dayKey(date)) || 0;
    if (count > 0) activeDays++;
    const cell = document.createElement('div');
    cell.className = `heatmap-cell level-${levelFor(count, maxCount)}`;
    cell.style.gridColumn = String(week);
    cell.style.gridRow = String(dow + 2);
    cell.title = `${reviewsLabel(count)} on ${date.toLocaleDateString()}`;
    cell.addEventListener('click', () => {
      heatmapDetailEl.textContent = `${reviewsLabel(count)} on ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    });
    heatmapGridEl.appendChild(cell);
  }

  heatmapDetailEl.textContent = `${reviewsLabel(totalCount)} across ${activeDays} days (last ${HEATMAP_WINDOW_MONTHS} months)`;

  // Land on the right edge so "today" is on-screen immediately,
  // instead of making you swipe through months of history first.
  heatmapScrollEl.scrollLeft = heatmapScrollEl.scrollWidth;
}
