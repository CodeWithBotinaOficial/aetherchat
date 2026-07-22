import { SUPPORTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '$lib/services/imageTransfer/types.js';

/**
 * Validates a File object before initiating a transfer.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateImageFile(file) {
  if (!file || !(file instanceof File)) {
    return { valid: false, error: 'File is required' };
  }

  if (!file.type) {
    return { valid: false, error: 'File must have a MIME type' };
  }

  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return { valid: false, error: `Unsupported image type: ${file.type}` };
  }

  if (file.size <= 0) {
    return { valid: false, error: 'File is empty' };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    const maxMB = Math.round(MAX_IMAGE_BYTES / 1024 / 1024);
    return { valid: false, error: `File exceeds ${maxMB}MB limit` };
  }

  return { valid: true };
}

/**
 * Reads an image File and returns its natural dimensions.
 * Revokes the object URL after reading. Never throws—returns 0x0 on error.
 * @param {File} file
 * @returns {Promise<{ width: number, height: number }>}
 */
export async function getImageDimensions(file) {
  try {
    if (!file || !(file instanceof File)) {
      return { width: 0, height: 0 };
    }

    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
        };
        img.onerror = () => {
          resolve({ width: 0, height: 0 });
        };
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error('getImageDimensions failed', err);
    return { width: 0, height: 0 };
  }
}

/**
 * Converts a File to an ArrayBuffer for chunking.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export async function fileToArrayBuffer(file) {
  if (!file || !(file instanceof File)) {
    throw new Error('File is required');
  }
  return await file.arrayBuffer();
}

/**
 * Reassembles an ordered array of ArrayBuffer chunks into a Blob.
 * @param {ArrayBuffer[]} chunks
 * @param {string} mimeType
 * @returns {Blob}
 */
export function assembleChunks(chunks, mimeType) {
  if (!Array.isArray(chunks)) {
    throw new Error('chunks must be an array');
  }
  if (chunks.length === 0) {
    return new Blob([], { type: mimeType });
  }
  const type = String(mimeType || 'application/octet-stream');
  return new Blob(chunks, { type });
}

