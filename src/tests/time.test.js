import { vi } from 'vitest';
import { calculateAge, isBirthday } from '$lib/utils/time.js';

it('calculateAge("2000-01-01") returns correct age for the current date', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    expect(calculateAge('2000-01-01')).toBe(26);
  } finally {
    vi.useRealTimers();
  }
});

it('calculateAge handles leap day birthdays (Feb 29)', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-02-28T12:00:00.000Z'));
    expect(calculateAge('2004-02-29')).toBe(21);

    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    expect(calculateAge('2004-02-29')).toBe(22);
  } finally {
    vi.useRealTimers();
  }
});

it('isBirthday returns true when today matches month and day', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    expect(isBirthday('2000-05-07')).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('isBirthday returns false when today does not match month and day', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    expect(isBirthday('2000-05-08')).toBe(false);
    expect(isBirthday('2000-06-07')).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

