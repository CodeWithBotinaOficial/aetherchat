/**
 * Deterministic HSL color from username hash.
 * @param {string} username
 * @returns {string}
 */
export function getUserColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}

/**
 * Parse `hsl(h, s%, l%)` (or `hsla(...)`) into numeric values.
 * @param {string} hsl
 * @returns {{h: number, s: number, l: number} | null}
 */
function parseHsl(hsl) {
  const m = hsl
    .trim()
    .match(/^hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*(?:,\s*([+-]?\d+(?:\.\d+)?)\s*)?\)$/i);
  if (!m) return null;
  return {
    h: Number(m[1]),
    s: Number(m[2]) / 100,
    l: Number(m[3]) / 100
  };
}

/**
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Convert HSL to sRGB in [0..1].
 * @param {number} h degrees
 * @param {number} s [0..1]
 * @param {number} l [0..1]
 * @returns {{r: number, g: number, b: number}}
 */
function hslToRgb(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;

  let r1;
  let g1;
  let b1;
  if (hh < 60) [r1, g1, b1] = [c, x, 0];
  else if (hh < 120) [r1, g1, b1] = [x, c, 0];
  else if (hh < 180) [r1, g1, b1] = [0, c, x];
  else if (hh < 240) [r1, g1, b1] = [0, x, c];
  else if (hh < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return {
    r: clamp01(r1 + m),
    g: clamp01(g1 + m),
    b: clamp01(b1 + m)
  };
}

/**
 * Relative luminance (WCAG) from sRGB in [0..1].
 * @param {number} c
 * @returns {number}
 */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Returns '#0f1117' (dark) or '#e8eaf0' (light) for readable text over the given HSL.
 * @param {string} hslColor
 * @returns {'#0f1117'|'#e8eaf0'}
 */
export function getContrastText(hslColor) {
  const parsed = parseHsl(hslColor);
  if (!parsed) return '#e8eaf0';

  const { r, g, b } = hslToRgb(parsed.h, parsed.s, parsed.l);
  const L =
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b);

  // Higher luminance => use dark text.
  return L >= 0.55 ? '#0f1117' : '#e8eaf0';
}
