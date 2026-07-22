/**
 * Binary message framing for IMAGE_CHUNK messages.
 *
 * PeerJS DataChannel can send both JSON and ArrayBuffer. We use ArrayBuffer
 * for efficiency, with a simple binary header format:
 *
 * [4 bytes: chunkIndex uint32 LE]
 * [4 bytes: totalChunks uint32 LE]
 * [36 bytes: transferId UTF-8 null-padded]
 * [remaining: chunk data]
 *
 * Total header: 44 bytes
 */

const HEADER_SIZE = 44;
const CHUNK_INDEX_OFFSET = 0;
const TOTAL_CHUNKS_OFFSET = 4;
const TRANSFER_ID_OFFSET = 8;
const TRANSFER_ID_SIZE = 36;
const DATA_OFFSET = HEADER_SIZE;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Frames an image chunk with binary header.
 *
 * @param {string} transferId
 * @param {number} chunkIndex
 * @param {number} totalChunks
 * @param {ArrayBuffer} data
 * @returns {ArrayBuffer}
 */
export function frameChunk(transferId, chunkIndex, totalChunks, data) {
  const id = String(transferId ?? '').trim();
  if (!id) throw new Error('transferId is required');

  const idx = Number(chunkIndex);
  const total = Number(totalChunks);

  if (!Number.isFinite(idx) || !Number.isFinite(total) || idx < 0 || total <= 0) {
    throw new Error('Invalid chunkIndex or totalChunks');
  }

  if (!data || !(data instanceof ArrayBuffer)) {
    throw new Error('data must be an ArrayBuffer');
  }

  // Create header buffer
  const headerBuf = new ArrayBuffer(HEADER_SIZE);
  const headerView = new DataView(headerBuf);

  // Write chunkIndex (uint32 LE)
  headerView.setUint32(CHUNK_INDEX_OFFSET, idx, true);

  // Write totalChunks (uint32 LE)
  headerView.setUint32(TOTAL_CHUNKS_OFFSET, total, true);

  // Write transferId (UTF-8 null-padded to 36 bytes)
  const idBytes = encoder.encode(id);
  const idBuffer = new Uint8Array(headerBuf, TRANSFER_ID_OFFSET, TRANSFER_ID_SIZE);
  idBuffer.set(idBytes.slice(0, TRANSFER_ID_SIZE));

  // Concatenate header + data
  const combined = new ArrayBuffer(HEADER_SIZE + data.byteLength);
  const combinedView = new Uint8Array(combined);
  combinedView.set(new Uint8Array(headerBuf));
  combinedView.set(new Uint8Array(data), HEADER_SIZE);

  return combined;
}

/**
 * Unframes a binary chunk message.
 *
 * @param {ArrayBuffer} raw
 * @returns {{ transferId: string, chunkIndex: number, totalChunks: number, data: ArrayBuffer }}
 * @throws if the buffer is malformed
 */
export function unframeChunk(raw) {
  if (!raw || !(raw instanceof ArrayBuffer)) {
    throw new Error('raw must be an ArrayBuffer');
  }

  if (raw.byteLength < HEADER_SIZE) {
    throw new Error('Buffer too small for header');
  }

  const headerView = new DataView(raw, 0, HEADER_SIZE);

  // Read chunkIndex
  const chunkIndex = headerView.getUint32(CHUNK_INDEX_OFFSET, true);

  // Read totalChunks
  const totalChunks = headerView.getUint32(TOTAL_CHUNKS_OFFSET, true);

  // Read transferId (null-terminated UTF-8)
  const idBytes = new Uint8Array(raw, TRANSFER_ID_OFFSET, TRANSFER_ID_SIZE);
  const nullIndex = idBytes.indexOf(0);
  const idLength = nullIndex >= 0 ? nullIndex : TRANSFER_ID_SIZE;
  const transferId = decoder.decode(idBytes.slice(0, idLength));

  if (!transferId) {
    throw new Error('Invalid transferId in header');
  }

  // Extract data
  const data = raw.slice(DATA_OFFSET);

  return { transferId, chunkIndex, totalChunks, data };
}

