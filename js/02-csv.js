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
  for (let i = startIndex; i < rows.length; i++) {
    const [front, back, id, active] = rows[i];
    if (front && front.trim() && back && back.trim()) {
      const trimmedId = (id !== undefined && id !== null) ? id.trim() : '';
      cards.push({
        front: front.trim(),
        back: back.trim(),
        // Rows without an id still work — they just fall back to a
        // content-based key below, so history isn't tracked until
        // you assign one.
        id: trimmedId.length > 0 ? trimmedId : null,
        // The CSV's starting active/inactive state. A checkbox in the
        // deck preview can override this per device — see isCardActive().
        activeDefault: parseActiveDefault(active),
      });
    }
  }
  return cards;
}
