import { validateImageFile } from '$lib/services/imageTransfer/index.js';
import { SUPPORTED_IMAGE_TYPES } from '$lib/services/imageTransfer/types.js';

let managedURLs = new Set();

/**
 * Opens a file input dialog and returns validated image Files.
 * Invalid files are collected in the errors array.
 *
 * @param {{ multiple?: boolean, maxImages?: number }} options
 * @returns {Promise<{ valid: File[], errors: { filename: string, reason: string }[] }>}
 */
export async function pickImageFiles(options = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = SUPPORTED_IMAGE_TYPES.join(',');
    input.multiple = options.multiple !== false;
    
    input.onchange = (e) => {
      const valid = [];
      const errors = [];
      
      const files = Array.from(e.target.files);
      const max = options.maxImages || Infinity;
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (valid.length >= max) {
          errors.push({ filename: file.name, reason: `Maximum limit of ${max} images reached.` });
          continue;
        }
        
        const validation = validateImageFile(file);
        if (validation.valid) {
          valid.push(file);
        } else {
          errors.push({ filename: file.name, reason: validation.error });
        }
      }
      
      resolve({ valid, errors });
    };
    
    // Fallback if user cancels the dialog (not perfectly reliable across all browsers, but good to have)
    input.oncancel = () => {
      resolve({ valid: [], errors: [] });
    };
    
    input.click();
  });
}

/**
 * Creates a persistent object URL for a Blob and registers it for cleanup.
 * Call revokeAllObjectURLs() in the component's onDestroy.
 *
 * @param {Blob} blob
 * @returns {string} objectURL
 */
export function createManagedObjectURL(blob) {
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  managedURLs.add(url);
  return url;
}

/**
 * Revokes all object URLs created by createManagedObjectURL.
 * Call once in onDestroy of the component that called createManagedObjectURL.
 */
export function revokeAllObjectURLs() {
  for (const url of managedURLs) {
    URL.revokeObjectURL(url);
  }
  managedURLs.clear();
}
