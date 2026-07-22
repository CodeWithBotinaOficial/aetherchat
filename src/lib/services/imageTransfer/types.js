/**
 * Image Transfer Protocol — Constants and Types
 *
 * This file defines all constants, limits, and TypeDef structures for P2P image transfers.
 * Blobs are stored natively in IndexedDB—never base64 for image data.
 */

/**
 * Supported image MIME types.
 * @type {string[]}
 */
export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
  'image/x-icon',
];

/** Maximum file size for image attachments: 5 MB */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Maximum file size for profile avatar: 2 MB */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Size of each DataChannel chunk in bytes: 64 KB */
export const CHUNK_SIZE = 64 * 1024;

/** Milliseconds to wait for a chunk ACK before retrying */
export const CHUNK_TIMEOUT_MS = 8000;

/** Maximum number of chunk retries before aborting transfer */
export const MAX_CHUNK_RETRIES = 3;

/**
 * @typedef {'pending'|'sending'|'receiving'|'complete'|'failed'|'cancelled'} TransferState
 */

/**
 * @typedef {Object} ImageMeta
 * @property {string}  transferId   — UUID, unique per image transfer
 * @property {string}  filename     — original filename
 * @property {string}  mimeType     — one of SUPPORTED_IMAGE_TYPES
 * @property {number}  sizeBytes    — original file size in bytes
 * @property {number}  totalChunks  — Math.ceil(sizeBytes / CHUNK_SIZE)
 * @property {number}  width        — original image width in px (0 if unknown)
 * @property {number}  height       — original image height in px (0 if unknown)
 * @property {string}  context      — 'global' | 'private' | 'wall'
 * @property {string}  messageId    — ID of the message this image belongs to
 * @property {string}  senderPeerId
 * @property {number}  createdAt    — Date.now() when transfer was initiated
 */

/**
 * @typedef {Object} ChunkHeader
 * @property {string} type        — always 'IMAGE_CHUNK'
 * @property {string} transferId
 * @property {number} chunkIndex  — 0-based
 * @property {number} totalChunks
 * @property {ArrayBuffer} data   — the chunk payload
 */

/**
 * @typedef {Object} ImageAttachment
 * @property {string}  transferId
 * @property {string}  messageId
 * @property {string}  context
 * @property {Blob}    blob       — the complete image, stored as Blob
 * @property {string}  mimeType
 * @property {string}  filename
 * @property {number}  sizeBytes
 * @property {number}  width
 * @property {number}  height
 * @property {number}  storedAt   — Date.now() when stored
 */

