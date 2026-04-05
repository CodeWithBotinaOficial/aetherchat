/**
 * Private message body codec.
 *
 * We encrypt/decrypt a versioned JSON envelope so we can include metadata (e.g. editedAt)
 * without leaking it in plaintext over the wire.
 */

const BODY_VERSION = 1;

/**
 * @param {string} text
 * @param {number|null} editedAt
 * @returns {string}
 */
export function encodePrivateBody(text, editedAt) {
  return JSON.stringify({
    v: BODY_VERSION,
    text: String(text ?? ''),
    editedAt: typeof editedAt === 'number' ? editedAt : null
  });
}

/**
 * @param {string} raw
 * @returns {{ text: string, editedAt: number|null }}
 */
export function decodePrivateBody(raw) {
  const s = String(raw ?? '');
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object' && obj.v === BODY_VERSION && typeof obj.text === 'string') {
      return { text: obj.text, editedAt: typeof obj.editedAt === 'number' ? obj.editedAt : null };
    }
  } catch {
    // ignore
  }
  return { text: s, editedAt: null };
}

