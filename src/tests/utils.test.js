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

it('validateAvatarFile rejects files over 500KB', () => {
  const bytes = new Uint8Array(500 * 1024 + 1);
  const file = new File([bytes], 'big.png', { type: 'image/png' });
  const res = validateAvatarFile(file);
  expect(res.valid).toBe(false);
});

it('validateAvatarFile rejects non-image files', () => {
  const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
  const res = validateAvatarFile(file);
  expect(res.valid).toBe(false);
});

it('validateAvatarFile accepts valid PNG under 500KB', () => {
  const bytes = new Uint8Array(10);
  const file = new File([bytes], 'ok.png', { type: 'image/png' });
  const res = validateAvatarFile(file);
  expect(res.valid).toBe(true);
});

