import { getUserColor } from '$lib/utils/colors.js';

const MAX_AVATAR_BYTES = 500 * 1024;

/**
 * @param {string} username
 * @returns {string}
 */
function getInitials(username) {
  const trimmed = (username ?? '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s_-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? trimmed[0];
  const second = parts.length > 1 ? parts[1]?.[0] : trimmed[1];
  return (first + (second ?? '')).toUpperCase().slice(0, 2);
}

/**
 * Draws a 200x200 circular initials avatar and returns a base64 PNG data URL.
 * Uses OffscreenCanvas when available; falls back to an HTMLCanvasElement.
 * @param {string} username
 * @param {string} [color]
 * @returns {Promise<string>}
 */
export async function generateInitialsAvatar(username, color) {
  const bg = color || getUserColor(username);
  const initials = getInitials(username);

  const size = 200;

  /** @type {OffscreenCanvas|HTMLCanvasElement} */
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : typeof document !== 'undefined'
        ? document.createElement('canvas')
        : null;

  if (!canvas) {
    throw new Error('Canvas is not available in this environment.');
  }

  if ('width' in canvas) canvas.width = size;
  if ('height' in canvas) canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context not available.');

  ctx.clearRect(0, 0, size, size);

  // Circle background
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // Initials
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, size / 2, size / 2 + 4);

  // Export
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await blob.arrayBuffer();
    const base64 =
      typeof globalThis.Buffer !== 'undefined'
        ? globalThis.Buffer.from(arrayBuffer).toString('base64')
        : '';
    if (!base64) {
      // Fallback to FileReader where Buffer isn't available.
      const asDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      return /** @type {string} */ (asDataUrl);
    }
    return `data:image/png;base64,${base64}`;
  }

  // HTMLCanvasElement path
  // @ts-ignore - jsdom typing mismatch; runtime supports toDataURL in browsers.
  return canvas.toDataURL('image/png');
}

/**
 * @param {File|null|undefined} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAvatarFile(file) {
  if (!file) return { valid: false, error: 'No file provided.' };

  const allowed = ['image/png', 'image/jpeg'];
  if (!allowed.includes(file.type)) {
    return { valid: false, error: 'Avatar must be a PNG or JPEG image.' };
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return { valid: false, error: 'Avatar must be 500KB or smaller.' };
  }

  return { valid: true };
}
