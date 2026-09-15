'use strict';

/* ============================================================
   Deck select screen
   ============================================================ */
const deckListEl = document.getElementById('deckList');
const deckUploadBtnEl = document.getElementById('deckUploadBtn');
const deckFileInputEl = document.getElementById('deckFileInput');
const deckUploadErrorEl = document.getElementById('deckUploadError');

function renderDeckList() {
  deckListEl.innerHTML = '';
  getAllDeckConfigs().forEach(deck => {
    const leftGroup = document.createElement('span');
    leftGroup.className = 'deck-btn-left';

    const nameEl = document.createElement('span');
    nameEl.className = 'deck-btn-name';
    nameEl.textContent = deck.name;
    leftGroup.appendChild(nameEl);

    const countEl = document.createElement('span');
    countEl.className = 'deck-btn-count';
    countEl.textContent = 'Loading…';

    // Custom decks need two independent click targets (open vs.
    // delete), so — unlike a built-in deck's single <button> — they
    // get a wrapper <div> holding two sibling <button>s instead.
    let rowEl, mainBtn;
    if (deck.custom) {
      rowEl = document.createElement('div');
      rowEl.className = 'deck-btn deck-btn-custom';

      mainBtn = document.createElement('button');
      mainBtn.className = 'deck-btn-main';
      mainBtn.type = 'button';
      mainBtn.appendChild(leftGroup);
      mainBtn.appendChild(countEl);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'deck-btn-delete';
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', `Delete "${deck.name}"`);
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => deleteCustomDeck(deck.id));

      rowEl.appendChild(mainBtn);
      rowEl.appendChild(deleteBtn);
    } else {
      rowEl = document.createElement('button');
      rowEl.className = 'deck-btn';
      rowEl.type = 'button';
      rowEl.appendChild(leftGroup);
      rowEl.appendChild(countEl);
      mainBtn = rowEl;
    }

    deckListEl.appendChild(rowEl);

    mainBtn.addEventListener('click', () => {
      const loaded = state.decks[deck.id];
      if (!loaded || loaded.error) return;
      // A built-in deck with zero cards is just broken — nothing to
      // do about that from the UI. A custom deck can legitimately
      // reach zero cards (deleted them all, or an intentionally
      // empty upload) and must stay openable, or "Add a card" would
      // be permanently unreachable.
      if (loaded.cards.length === 0 && !deck.custom) return;
      openCountScreen(deck);
    });

    loadDeck(deck).then(result => {
      if (result.error) {
        rowEl.classList.add('is-error');
        countEl.textContent = 'Could not load';
      } else if (result.cards.length === 0) {
        if (deck.custom) {
          countEl.textContent = 'Empty — tap to add cards';
        } else {
          rowEl.classList.add('is-error');
          countEl.textContent = 'No cards found';
        }
      } else {
        const activeCount = getActiveCards(deck.id).length;
        countEl.textContent = `${activeCount}/${result.cards.length}`;
      }
    });
  });
}

function showUploadError(message) {
  deckUploadErrorEl.textContent = message;
  deckUploadErrorEl.hidden = false;
}

function clearUploadError() {
  deckUploadErrorEl.hidden = true;
  deckUploadErrorEl.textContent = '';
}

deckUploadBtnEl.addEventListener('click', () => {
  clearUploadError();
  deckFileInputEl.click();
});

deckFileInputEl.addEventListener('change', handleDeckFileSelected);

async function handleDeckFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = ''; // lets re-picking the same filename re-fire "change"
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    showUploadError('Could not read that file.');
    return;
  }

  const cards = csvToCards(text);
  if (cards.length === 0) {
    showUploadError('No valid cards found — the file needs front,back columns.');
    return;
  }

  const defaultName = file.name.replace(/\.csv$/i, '').trim() || 'My deck';
  const chosenName = await showPrompt('Name this deck:', defaultName);
  if (chosenName === null) return; // cancelled

  const trimmedName = chosenName.trim();
  if (trimmedName.length === 0) return; // OK is disabled while empty, but just in case

  // Same name -> same id -> treated as updating that deck (its
  // progress carries over, since progress is keyed by deckId+cardId).
  const id = customDeckId(trimmedName);
  const registry = loadCustomDeckRegistry();
  const existing = registry.find(d => d.id === id);

  if (existing) {
    const replace = await showConfirm(`A deck named "${existing.name}" already exists — replace its cards?`, 'Replace');
    if (!replace) return;
  }

  // Save the cards before touching the registry: if this fails
  // (storage full), the registry never ends up pointing at cards
  // that don't exist.
  if (!saveCustomDeckCards(id, cards)) {
    showUploadError('Could not save this deck — storage is full.');
    return;
  }

  const now = Date.now();
  if (existing) {
    existing.name = trimmedName;
    existing.updatedAt = now;
  } else {
    registry.push({ id, name: trimmedName, createdAt: now, updatedAt: now });
  }

  if (!saveCustomDeckRegistry(registry)) {
    showUploadError('Could not save this deck — storage is full.');
    return;
  }

  clearUploadError();
  // Drop any cached copy so a same-session re-upload doesn't keep
  // serving the stale cards from before this update — loadDeck()
  // short-circuits on a truthy cache hit otherwise.
  delete state.decks[id];
  renderDeckList();
}

async function deleteCustomDeck(deckId) {
  const registry = loadCustomDeckRegistry();
  const deck = registry.find(d => d.id === deckId);
  if (!deck) return;

  const confirmed = await showConfirm(`Delete "${deck.name}"? This also erases its study progress.`, 'Delete');
  if (!confirmed) return;

  saveCustomDeckRegistry(registry.filter(d => d.id !== deckId));
  deleteDeckStorage(deckId);
  delete state.decks[deckId];
  if (state.activeDeck && state.activeDeck.id === deckId) state.activeDeck = null;
  renderDeckList();
}
