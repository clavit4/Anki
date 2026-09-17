'use strict';

/* ============================================================
   Tiny CSV parser — handles quoted fields, escaped quotes
   ("" inside a quoted field) and commas/newlines inside quotes.
   ============================================================ */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
      continue;
    }

    if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip, \n handles the line break */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += c; }
  }

  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim().length > 0));
}

// Reads the optional 4th CSV column. Blank/missing = active. Anything
// matching one of the "off" words below = starts deactivated.
const INACTIVE_WORDS = new Set(['0', 'no', 'false', 'off', 'inactive', 'n']);
function parseActiveDefault(raw) {
  if (raw === undefined || raw === null) return true;
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return true;
  return !INACTIVE_WORDS.has(v);
}

function csvToCards(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  // Drop a header row if it looks like one (front/back, case-insensitive).
  const first = rows[0].map(c => c.trim().toLowerCase());
  const startIndex = (first[0] === 'front' && first[1] === 'back') ? 1 : 0;

  const cards = [];
  const seenRows = new Set(); // "front␟back" -- catches exact-duplicate rows
  for (let i = startIndex; i < rows.length; i++) {
    const [front, back, id, active] = rows[i];
    if (!front || !front.trim() || !back || !back.trim()) continue;
    const trimmedFront = front.trim();
    const trimmedBack = back.trim();
    const rowKey = trimmedFront + '␟' + trimmedBack;
    if (seenRows.has(rowKey)) continue; // identical front+back already imported -- drop it
    seenRows.add(rowKey);

    const trimmedId = (id !== undefined && id !== null) ? id.trim() : '';
    cards.push({
      front: trimmedFront,
      back: trimmedBack,
      id: trimmedId.length > 0 ? trimmedId : null,
      // The CSV's starting active/inactive state. A checkbox in the
      // deck preview can override this per device — see isCardActive().
      activeDefault: parseActiveDefault(active),
    });
  }

  assignMissingIds(cards);
  return cards;
}

// A row with no id column keeps id: null out of the loop above, which
// this then fills in with a stable sequential number instead of
// leaving it null -- otherwise that card's history would be keyed by
// a hash of its own front+back text (see cardStorageKey() in
// 03-storage.js), which silently breaks the moment you edit the
// card's wording later. Numbers already taken by explicit ids
// elsewhere in the same file are skipped, same collision-avoidance
// idea as nextCardId() in 03-storage.js for manually-added cards.
function assignMissingIds(cards) {
  const used = new Set(cards.map(c => c.id).filter(id => id !== null));
  let next = 1;
  cards.forEach(card => {
    if (card.id !== null) return;
    while (used.has(String(next))) next++;
    card.id = String(next);
    used.add(card.id);
  });
}
