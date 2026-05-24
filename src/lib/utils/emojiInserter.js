/**
 * @param {HTMLInputElement | HTMLTextAreaElement} inputElement
 * @param {string} char
 * @returns {string}
 */
export function insertEmojiAtCursor(inputElement, char) {
  const el = inputElement;
  const c = String(char ?? '');
  if (!el || typeof el.value !== 'string' || !c) return '';

  const v = String(el.value ?? '');
  const start = typeof el.selectionStart === 'number' ? el.selectionStart : null;
  const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : null;
  const a = start === null || end === null ? v : v.slice(0, start);
  const b = start === null || end === null ? '' : v.slice(end);
  const next = start === null || end === null ? v + c : a + c + b;
  const caret = start === null || end === null ? next.length : (a + c).length;

  el.value = next;
  try {
    el.setSelectionRange?.(caret, caret);
  } catch {
    // ignore
  }
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    // ignore
  }
  return next;
}
