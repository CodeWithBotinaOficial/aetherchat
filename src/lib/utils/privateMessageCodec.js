/**
 * Private message body codec.
 *
 * We encrypt/decrypt a versioned JSON envelope so we can include metadata (e.g. editedAt)
 * without leaking it in plaintext over the wire. Binary image chunks are still sent as
 * standard DataChannel ArrayBuffer payloads; the E2E layer here only covers plaintext
 * message metadata (text + imageTransferIds) and optional media/editedAt metadata.
 */

const BODY_VERSION = 3;

/**
 * @param {string} text
 * @param {import('$lib/services/klipy/types.js').MessageMedia[] | null} media
 * @param {number|null} editedAt
 * @param {string[]|null} [imageTransferIds]
 * @returns {string}
 */
export function encodePrivateBody(text, media, editedAt, imageTransferIds = null) {
  const safeIds = Array.isArray(imageTransferIds) && imageTransferIds.length > 0 ? imageTransferIds.slice(0, 4) : null;
  return JSON.stringify({
    v: BODY_VERSION,
    text: String(text ?? ''),
    media: Array.isArray(media) && media.length > 0 ? media.slice(0, 2) : null,
    editedAt: typeof editedAt === 'number' ? editedAt : null,
    imageTransferIds: safeIds
  });
}

/**
 * @param {string} raw
 * @returns {{ text: string, editedAt: number|null, media: import('$lib/services/klipy/types.js').MessageMedia[] | null, imageTransferIds: string[]|null }}
 */
export function decodePrivateBody(raw) {
  const s = String(raw ?? '');
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object' && typeof obj.text === 'string') {
      if (obj.v === 1) {
        return { text: obj.text, editedAt: typeof obj.editedAt === 'number' ? obj.editedAt : null, media: null, imageTransferIds: null };
      }
      if (obj.v === 2 || obj.v === 3) {
        const media = Array.isArray(obj.media) && obj.media.length > 0 ? obj.media.slice(0, 2) : null;
        const imageTransferIds = Array.isArray(obj.imageTransferIds) && obj.imageTransferIds.length > 0 ? obj.imageTransferIds.slice(0, 4) : null;
        return { text: obj.text, editedAt: typeof obj.editedAt === 'number' ? obj.editedAt : null, media, imageTransferIds };
      }
    }
  } catch {
    // ignore
  }
  return { text: s, editedAt: null, media: null, imageTransferIds: null };
}
