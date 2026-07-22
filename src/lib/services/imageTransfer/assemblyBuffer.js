/**
 * In-memory store for chunks being received.
 *
 * This buffer holds chunks indexed by transferId. Each entry tracks the metadata,
 * received chunks, and count. After all chunks are received, the caller is
 * responsible for retrieving and clearing the entry.
 *
 * @typedef {Object} AssemblyEntry
 * @property {import('./types.js').ImageMeta}       meta
 * @property {ArrayBuffer[]}   chunks     — sparse array indexed by chunkIndex
 * @property {number}          received   — count of received chunks
 * @property {number}          startedAt
 */

/**
 * @type {Map<string, AssemblyEntry>}
 */
const buffer = new Map();

/**
 * Initializes assembly buffer for a new transfer.
 * If an entry already exists, it is left unchanged (idempotent).
 *
 * @param {import('./types.js').ImageMeta} meta
 * @returns {void}
 */
export function initAssembly(meta) {
  if (!meta?.transferId) return;
  const id = String(meta.transferId);
  if (buffer.has(id)) return; // idempotent
  buffer.set(id, {
    meta,
    chunks: new Array(meta.totalChunks || 0),
    received: 0,
    startedAt: Date.now()
  });
}

/**
 * Stores a received chunk at the correct index.
 * Returns true when all chunks have been received, false otherwise.
 *
 * @param {string} transferId
 * @param {number} chunkIndex
 * @param {ArrayBuffer} data
 * @returns {boolean} true if complete, false otherwise
 */
export function receiveChunk(transferId, chunkIndex, data) {
  const id = String(transferId ?? '').trim();
  if (!id) return false;

  const entry = buffer.get(id);
  if (!entry) return false;

  const idx = Number(chunkIndex);
  if (!Number.isFinite(idx) || idx < 0 || idx >= entry.chunks.length) return false;

  // Only increment if this chunk hasn't been received yet
  if (!entry.chunks[idx]) {
    entry.received += 1;
  }

  entry.chunks[idx] = data;

  // Return true only if all chunks now received
  return entry.received === entry.chunks.length;
}

/**
 * Retrieves the ordered chunks array if complete, null if not all chunks received.
 *
 * @param {string} transferId
 * @returns {ArrayBuffer[] | null}
 */
export function getAssembledChunks(transferId) {
  const id = String(transferId ?? '').trim();
  if (!id) return null;

  const entry = buffer.get(id);
  if (!entry) return null;

  // Only return if all chunks have been received
  if (entry.received !== entry.chunks.length) return null;

  // Verify no undefined entries (should never happen if received === length)
  if (entry.chunks.some((c) => !c)) return null;

  return entry.chunks;
}

/**
 * Removes the entry from buffer (call after storing to DB or on failure).
 *
 * @param {string} transferId
 * @returns {void}
 */
export function clearAssembly(transferId) {
  const id = String(transferId ?? '').trim();
  if (!id) return;
  buffer.delete(id);
}

/**
 * Returns transferIds for entries stuck longer than the specified duration.
 * Used for cleanup.
 *
 * @param {number} olderThanMs
 * @returns {string[]}
 */
export function getStaleAssemblies(olderThanMs) {
  const ms = Number(olderThanMs);
  if (!Number.isFinite(ms) || ms <= 0) return [];

  const cutoff = Date.now() - ms;
  const stale = [];

  for (const [transferId, entry] of buffer.entries()) {
    if (entry.startedAt < cutoff) {
      stale.push(transferId);
    }
  }

  return stale;
}

