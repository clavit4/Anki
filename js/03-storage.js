'use strict';

/* ============================================================
   Review history — localStorage, one append-only log per card.
   Key is deck + id (or a content hash when a card has no id yet),
   so ids only need to be unique within their own deck's CSV.
   ============================================================ */
function hashString(str) {
  // FNV-1a — fast, deterministic, good enough to key a card by its text.
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cardStorageKey(deckId, card) {
  if (card.id !== null && card.id !== undefined && String(card.id).length > 0) {
    return `recall:${deckId}:card:${card.id}`;
  }
  return `recall:${deckId}:temp:${hashString(card.front + '␟' + card.back)}`;
}

function loadCardHistory(deckId, card) {
  try {
    const raw = localStorage.getItem(cardStorageKey(deckId, card));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function recordGrade(deckId, card, grade) {
  const key = cardStorageKey(deckId, card);
  const history = loadCardHistory(deckId, card);
  history.push({ grade, timestamp: Date.now() });
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch (err) {
    // Storage full or unavailable (e.g. private browsing) — the
    // session still works fine, it just won't remember this attempt.
  }
}

// Removes the most recent recorded attempt for a card — the other
// half of recordGrade(), used when Undo needs to take back a grade
// instead of layering a correction on top of the mistaken one.
function removeLastGradeRecord(deckId, card) {
  const key = cardStorageKey(deckId, card);
  const history = loadCardHistory(deckId, card);
  if (history.length === 0) return;
  history.pop();
  try {
    if (history.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(history));
    }
  } catch (err) {
    // Storage unavailable — nothing to clean up in that case anyway.
  }
}

// Average of a card's last HISTORY_WINDOW graded attempts, as a 0–3
// number. null means "never studied" — nothing to average yet.
function cardScore(deckId, card) {
  const history = loadCardHistory(deckId, card);
  if (history.length === 0) return null;
  const recent = history.slice(-HISTORY_WINDOW);
  const sum = recent.reduce((total, entry) => total + entry.grade, 0);
  return sum / recent.length;
}

// Rounds a card's average score to the nearest grade, so filters like
// "weakest"/"strongest" can classify it as e.g. "Got it" even though
// the raw average is rarely a clean integer. null (never studied)
// passes through unchanged — it isn't any bucket.
function scoreBucket(score) {
  return score === null ? null : Math.round(score);
}

// Sort key for "original order": numeric id ascending, with un-numbered
// cards (no id yet) pushed after every numbered one.
function idSortKey(card) {
  const n = card.id !== null ? Number(card.id) : NaN;
  return Number.isFinite(n) ? n : Infinity;
}

// A fresh id for a manually added (or newly-assigned-on-edit) card:
// one past the highest existing numeric id in the deck, bumped
// further if that string somehow collides with an existing one
// (e.g. a deck with sparse or non-numeric ids).
function nextCardId(cards) {
  let max = 0;
  cards.forEach(c => {
    if (c.id === null || c.id === undefined) return; // Number(null) is 0 — would corrupt the max
    const n = Number(c.id);
    if (Number.isFinite(n) && n > max) max = n;
  });
  let candidate = max + 1;
  const existingIds = new Set(cards.map(c => String(c.id)));
  while (existingIds.has(String(candidate))) candidate++;
  return String(candidate);
}

/* ============================================================
   Active/inactive overrides — a checkbox in the deck preview lets
   you bench a card without touching the CSV. Stored per device,
   same key shape as review history. Only *overrides* of the CSV's
   activeDefault are written, and a toggle back to matching the
   default removes the override again — so editing the CSV later
   still "wins" for any card you haven't deliberately flipped.
   ============================================================ */
function cardActiveKey(deckId, card) {
  if (card.id !== null && card.id !== undefined && String(card.id).length > 0) {
    return `recall:${deckId}:active:${card.id}`;
  }
  return `recall:${deckId}:activeTemp:${hashString(card.front + '␟' + card.back)}`;
}

function loadActiveOverride(deckId, card) {
  try {
    const raw = localStorage.getItem(cardActiveKey(deckId, card));
    if (raw === null) return null; // no override — defer to the CSV
    return raw === '1';
  } catch (err) {
    return null;
  }
}

function isCardActive(deckId, card) {
  const override = loadActiveOverride(deckId, card);
  return override === null ? card.activeDefault : override;
}

function setCardActive(deckId, card, active) {
  const key = cardActiveKey(deckId, card);
  try {
    if (active === card.activeDefault) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, active ? '1' : '0');
    }
  } catch (err) {
    // Storage full or unavailable — the checkbox still visually
    // updates for this session, it just won't be remembered.
  }
}

function getActiveCards(deckId) {
  return state.decks[deckId].cards.filter(card => isCardActive(deckId, card));
}

/* ============================================================
   Custom decks — uploaded via the deck-select screen, stored
   entirely in this browser's localStorage (never shared with
   anyone else). A registry key lists every custom deck's id/name;
   each deck's parsed cards live under their own key. Both use the
   same "recall:" prefix as everything else so a single sweep can
   clean up a deleted deck's cards *and* its history/overrides
   (which already share the "recall:<deckId>:" prefix below).
   ============================================================ */
const CUSTOM_DECK_REGISTRY_KEY = 'recall:customDecks';

// Turns a display name into a stable, URL-safe id fragment. Falls
// back to a timestamp when the name has no letters/digits at all
// (e.g. "!!!"), so two such decks don't collide with each other.
function slugify(name) {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : `deck-${Date.now().toString(36)}`;
}

// A custom deck's id is derived from its name rather than random,
// so re-uploading a CSV under the same name reuses the same id —
// which is what makes that count as "updating" the deck (same id
// -> same recall:<id>:card:* keys -> progress carries over) instead
// of creating an unrelated duplicate.
function customDeckId(name) {
  return `custom:${slugify(name)}`;
}

function customDeckCardsKey(deckId) {
  return `recall:${deckId}:cards`;
}

function loadCustomDeckRegistry() {
  try {
    const raw = localStorage.getItem(CUSTOM_DECK_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

// Returns false on failure (e.g. storage quota exceeded) so callers
// can tell the user rather than silently losing their upload.
function saveCustomDeckRegistry(registry) {
  try {
    localStorage.setItem(CUSTOM_DECK_REGISTRY_KEY, JSON.stringify(registry));
    return true;
  } catch (err) {
    return false;
  }
}

// Same {cards} / {error:true, cards:[]} shape loadDeck()'s fetch
// path returns, so renderDeckList()'s result handling (is-error /
// no-cards-found / count text) works unmodified for custom decks.
function loadCustomDeckCards(deckId) {
  try {
    const raw = localStorage.getItem(customDeckCardsKey(deckId));
    if (!raw) return { error: true, cards: [] };
    const cards = JSON.parse(raw);
    return Array.isArray(cards) ? { cards } : { error: true, cards: [] };
  } catch (err) {
    return { error: true, cards: [] };
  }
}

function saveCustomDeckCards(deckId, cards) {
  try {
    localStorage.setItem(customDeckCardsKey(deckId), JSON.stringify(cards));
    return true;
  } catch (err) {
    return false;
  }
}

// Every key belonging to a deck — its cards, and (since they share
// the same "recall:<deckId>:" prefix) every graded-history and
// active-override entry for its cards — is removed in one sweep.
// Collecting matching keys before removing them avoids skipping
// entries, since localStorage.length shrinks as you remove things.
function deleteDeckStorage(deckId) {
  const prefix = `recall:${deckId}:`;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keysToRemove.push(key);
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}

// The unified deck list the rest of the app renders from: every
// built-in deck plus every custom one, in that order. Downstream
// code (state.decks[id], getActiveCards, renderDeckPreview, session
// start) only ever reads .id/.name/.cards, never .file, so a custom
// deck config with no .file works everywhere a built-in one does.
function getAllDeckConfigs() {
  return DECKS.concat(loadCustomDeckRegistry().map(d => ({ id: d.id, name: d.name, custom: true })));
}

async function loadDeck(deck) {
  if (state.decks[deck.id]) return state.decks[deck.id];
  if (deck.custom) {
    const result = loadCustomDeckCards(deck.id);
    state.decks[deck.id] = result;
    return result;
  }
  try {
    const res = await fetch(deck.file, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    const text = await res.text();
    const cards = csvToCards(text);
    const result = { cards };
    state.decks[deck.id] = result;
    return result;
  } catch (err) {
    const result = { error: true, cards: [] };
    state.decks[deck.id] = result;
    return result;
  }
}

// Rose (Missed) -> Amber (Hard) -> Lime (Almost) -> Mint (Got it!),
// interpolated continuously rather than snapped to four hard buckets.
const SCORE_COLOR_STOPS = [
  [224, 128, 152], // 0
  [224, 171, 124], // 1
  [214, 218, 142], // 2
  [122, 217, 196], // 3
];

function scoreToColor(score) {
  const t = Math.max(0, Math.min(3, score));
  const seg = Math.min(2, Math.floor(t));
  const frac = t - seg;
  const [r1, g1, b1] = SCORE_COLOR_STOPS[seg];
  const [r2, g2, b2] = SCORE_COLOR_STOPS[seg + 1];
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
