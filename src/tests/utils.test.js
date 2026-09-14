import { getContrastText, getUserColor } from '$lib/utils/colors.js';
import { validateAvatarFile } from '$lib/utils/avatar.js';

it('getUserColor returns same color for same username', () => {
  expect(getUserColor('alice')).toBe(getUserColor('alice'));
});

it('getUserColor returns different colors for different usernames', () => {
  expect(getUserColor('alice')).not.toBe(getUserColor('bob'));
});

it('getContrastText returns dark color for light HSL', () => {
  expect(getContrastText('hsl(0, 0%, 90%)')).toBe('#0f1117');
});

it('getContrastText returns light color for dark HSL', () => {
  expect(getContrastText('hsl(0, 0%, 15%)')).toBe('#e8eaf0');
});

it('validateAvatarFile rejects files over 2MB', () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
  const file = new File([bytes], 'big.png', { type: 'image/png' });
  const res = validateAvatarFile(file);
  expect(res.valid).toBe(false);
  expect(res.error).toContain('2MB');
});

it('validateAvatarFile rejects unsupported BMP files', () => {
  const file = new File(['hello'], 'note.bmp', { type: 'image/bmp' });
  const res = validateAvatarFile(file);
  expect(res.valid).toBe(false);
});

it('validateAvatarFile accepts valid PNG under 2MB', () => {
  const bytes = new Uint8Array(10);
  const file = new File([bytes], 'ok.png', { type: 'image/png' });
  const res = validateAvatarFile(file);
  expect(res.valid).toBe(true);
});

it('validateAvatarFile accepts WEBP and AVIF under 2MB', () => {
  for (const type of ['image/webp', 'image/avif']) {
    const file = new File([new Uint8Array(10)], `ok.${type === 'image/webp' ? 'webp' : 'avif'}`, { type });
    const res = validateAvatarFile(file);
    expect(res.valid).toBe(true);
  }
});

