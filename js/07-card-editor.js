'use strict';

/* ============================================================
   Editing a custom deck's cards — add/edit/delete individual
   cards, only ever shown for decks the visitor uploaded
   themselves (deck.custom). All three save to localStorage
   *before* touching state.decks[deck.id].cards, mirroring the
   upload flow's ordering, so a failed write never leaves
   in-memory state ahead of what's actually persisted.
   ============================================================ */
async function addCardToDeck(deck) {
  const result = await showCardForm('Add a card:', { front: '', back: '' }, 'Add');
  if (result === null) return;

  const cards = state.decks[deck.id].cards;
  const newCard = { front: result.front, back: result.back, id: nextCardId(cards), activeDefault: true };
  const updated = cards.concat([newCard]);

  if (!saveCustomDeckCards(deck.id, updated)) {
    await showConfirm('Could not save this card — storage is full.', 'OK', { showCancel: false });
    return;
  }
  state.decks[deck.id].cards = updated;
  renderDeckPreview(deck); // also refreshes the count grid now
}

async function editCard(deck, card) {
  const result = await showCardForm('Edit this card:', { front: card.front, back: card.back }, 'Save');
  if (result === null) return;

  const cards = state.decks[deck.id].cards;
  // A card with no id is keyed by a hash of its own text
  // (cardStorageKey) — leaving it id-less here would re-orphan its
  // history on every future edit, not just this one, since the hash
  // changes along with the text. Give it a real id now to stop that.
  const needsId = card.id === null || card.id === undefined;
  const updated = cards.map(c => c === card
    ? { ...c, front: result.front, back: result.back, id: needsId ? nextCardId(cards) : c.id }
    : c);

  if (!saveCustomDeckCards(deck.id, updated)) {
    await showConfirm('Could not save this change — storage is full.', 'OK', { showCancel: false });
    return;
  }
  state.decks[deck.id].cards = updated;
  renderDeckPreview(deck); // also refreshes the count grid now
}

async function removeCardFromDeck(deck, card) {
  const confirmed = await showConfirm('Delete this card? This also erases its study history.', 'Delete');
  if (!confirmed) return;

  const cards = state.decks[deck.id].cards;
  const updated = cards.filter(c => c !== card);

  if (!saveCustomDeckCards(deck.id, updated)) {
    await showConfirm('Could not save this change — storage is full.', 'OK', { showCancel: false });
    return;
  }
  state.decks[deck.id].cards = updated;
  // Only sweep this one card's own keys after the save actually
  // succeeds — unlike deleteDeckStorage's broad prefix sweep (whole-
  // deck delete), a failed save here must not orphan-clean history
  // for a card that's still actually in the deck.
  localStorage.removeItem(cardStorageKey(deck.id, card));
  localStorage.removeItem(cardActiveKey(deck.id, card));
  renderDeckPreview(deck); // also refreshes the count grid now
}
