/**
 * Private message body codec.
 *
 * We encrypt/decrypt a versioned JSON envelope so we can include metadata (e.g. editedAt)
 * without leaking it in plaintext over the wire.
 */

const BODY_VERSION = 2;

/**
 * @param {string} text
 * @param {import('$lib/services/klipy/types.js').MessageMedia[] | null} media
 * @param {number|null} editedAt
 * @returns {string}
 */
export function encodePrivateBody(text, media, editedAt) {
  return JSON.stringify({
    v: BODY_VERSION,
    text: String(text ?? ''),
    media: Array.isArray(media) && media.length > 0 ? media.slice(0, 2) : null,
    editedAt: typeof editedAt === 'number' ? editedAt : null
  });
}

/**
 * @param {string} raw
 * @returns {{ text: string, editedAt: number|null, media: import('$lib/services/klipy/types.js').MessageMedia[] | null }}
 */
export function decodePrivateBody(raw) {
  const s = String(raw ?? '');
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object' && typeof obj.text === 'string') {
      if (obj.v === 1) {
        return { text: obj.text, editedAt: typeof obj.editedAt === 'number' ? obj.editedAt : null, media: null };
      }
      if (obj.v === BODY_VERSION) {
        const media = Array.isArray(obj.media) && obj.media.length > 0 ? obj.media.slice(0, 2) : null;
        return { text: obj.text, editedAt: typeof obj.editedAt === 'number' ? obj.editedAt : null, media };
      }
    }
  } catch {
    // ignore
  }
  return { text: s, editedAt: null, media: null };
}
