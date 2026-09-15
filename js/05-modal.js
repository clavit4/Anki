'use strict';

/* ============================================================
   Confirm modal — small dialog reused for three things:
   showConfirm() (message + Yes/Cancel, resolves true/false),
   showPrompt() (message + one text field, resolves the trimmed
   string or null), and showCardForm() (message + Front/Back
   fields, resolves {front, back} or null).
   ============================================================ */
const confirmOverlayEl = document.getElementById('confirmOverlay');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmInputEl = document.getElementById('confirmInput');
const confirmCardFieldsEl = document.getElementById('confirmCardFields');
const confirmFrontEl = document.getElementById('confirmFront');
const confirmBackEl = document.getElementById('confirmBack');
const confirmCancelBtnEl = document.getElementById('confirmCancelBtn');
const confirmOkBtnEl = document.getElementById('confirmOkBtn');
let resolveModal = null;

// The one dialog behind showConfirm()/showPrompt()/showCardForm().
// `inputValue` (even as '') shows the single text field; `cardFields`
// shows the Front/Back pair instead — the two are mutually exclusive,
// and every call resets both regions so no state leaks in from a
// previous, differently-shaped use of the dialog. `showCancel: false`
// hides the Cancel button, for a plain one-button "OK" alert where a
// second dismiss button would just be a redundant twin of the first.
function openModal({ message, inputValue = null, cardFields = null, okLabel = 'Yes, do it', cancelLabel = 'Cancel', showCancel = true }) {
  confirmMessageEl.textContent = message;
  confirmOkBtnEl.textContent = okLabel;
  confirmCancelBtnEl.textContent = cancelLabel;
  confirmCancelBtnEl.hidden = !showCancel;

  confirmInputEl.hidden = true;
  confirmInputEl.value = '';
  confirmCardFieldsEl.hidden = true;
  confirmOkBtnEl.disabled = false;

  if (cardFields !== null) {
    confirmCardFieldsEl.hidden = false;
    confirmFrontEl.value = cardFields.front || '';
    confirmBackEl.value = cardFields.back || '';
    updateCardFormValidity();
    requestAnimationFrame(() => { confirmFrontEl.focus(); confirmFrontEl.select(); });
  } else if (inputValue !== null) {
    confirmInputEl.hidden = false;
    confirmInputEl.value = inputValue;
    confirmOkBtnEl.disabled = inputValue.trim().length === 0;
    // Wait a tick so the browser lays out the just-unhidden field
    // before focusing/selecting it.
    requestAnimationFrame(() => { confirmInputEl.focus(); confirmInputEl.select(); });
  }

  confirmOverlayEl.hidden = false;
  return new Promise(resolve => { resolveModal = resolve; });
}

function closeModal(result) {
  if (confirmOverlayEl.hidden) return;
  confirmOverlayEl.hidden = true;
  if (resolveModal) {
    resolveModal(result);
    resolveModal = null;
  }
}

function showConfirm(message, okLabel = 'Yes, do it', { showCancel = true } = {}) {
  return openModal({ message, okLabel, showCancel }).then(result => result === true);
}

function showPrompt(message, defaultValue) {
  return openModal({ message, inputValue: defaultValue, okLabel: 'Save' })
    .then(result => (result === false ? null : result));
}

function showCardForm(message, { front = '', back = '' } = {}, okLabel = 'Save') {
  return openModal({ message, cardFields: { front, back }, okLabel })
    .then(result => (result === false ? null : result));
}

function updateCardFormValidity() {
  confirmOkBtnEl.disabled = confirmFrontEl.value.trim().length === 0 || confirmBackEl.value.trim().length === 0;
}

confirmCancelBtnEl.addEventListener('click', () => closeModal(false));
confirmOkBtnEl.addEventListener('click', () => {
  if (confirmOkBtnEl.disabled) return;
  if (!confirmCardFieldsEl.hidden) {
    closeModal({ front: confirmFrontEl.value.trim(), back: confirmBackEl.value.trim() });
  } else if (!confirmInputEl.hidden) {
    closeModal(confirmInputEl.value.trim());
  } else {
    closeModal(true);
  }
});
confirmOverlayEl.addEventListener('click', (e) => {
  if (e.target === confirmOverlayEl) closeModal(false);
});
confirmInputEl.addEventListener('input', () => {
  confirmOkBtnEl.disabled = confirmInputEl.value.trim().length === 0;
});
confirmInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !confirmOkBtnEl.disabled) {
    e.preventDefault();
    closeModal(confirmInputEl.value.trim());
  }
});
confirmFrontEl.addEventListener('input', updateCardFormValidity);
confirmBackEl.addEventListener('input', updateCardFormValidity);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !confirmOverlayEl.hidden) closeModal(false);
});
