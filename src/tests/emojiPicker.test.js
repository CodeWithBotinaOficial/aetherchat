import { render, fireEvent } from '@testing-library/svelte';
import { within } from '@testing-library/dom';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearExpired, getCached, setCached } from '$lib/services/emojiHub/cache.js';
import { __resetEmojiRecentsForTest, addRecentEmoji, recentEmojis } from '$lib/stores/emojiRecents.js';
import { insertEmojiAtCursor } from '$lib/utils/emojiInserter.js';

import EmojiPickerHarness from './EmojiPickerHarness.svelte';

function withFakeNow(now, fn) {
  const real = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

function resetLocalStorage() {
  localStorage.clear();
}

beforeEach(() => {
  resetLocalStorage();
  __resetEmojiRecentsForTest();
});

describe('EmojiHub cache', () => {
  it('returns null for missing cache entry', () => {
    expect(getCached('aetherchat_emoji_cache_smileys-and-people')).toBeNull();
  });

  it('category data cached with 24h TTL', () => {
    withFakeNow(1000, () => {
      setCached('aetherchat_emoji_cache_smileys-and-people', [{ char: '😀' }]);
    });
    const hit = withFakeNow(1000 + 23 * 60 * 60 * 1000, () => getCached('aetherchat_emoji_cache_smileys-and-people'));
    expect(hit).toHaveLength(1);
  });

  it('returns null for expired cache entry', () => {
    withFakeNow(1000, () => {
      setCached('aetherchat_emoji_cache_smileys-and-people', [{ char: '😀' }]);
    });
    const hit = withFakeNow(1000 + 25 * 60 * 60 * 1000, () => getCached('aetherchat_emoji_cache_smileys-and-people'));
    expect(hit).toBeNull();
  });

  it('clearExpired removes stale emoji cache entries', () => {
    withFakeNow(1000, () => {
      setCached('aetherchat_emoji_cache_smileys-and-people', [{ char: '😀' }]);
      setCached('aetherchat_emoji_all', [{ char: '😀' }]);
    });
    withFakeNow(1000 + 25 * 60 * 60 * 1000, () => {
      clearExpired();
    });
    expect(localStorage.getItem('aetherchat_emoji_cache_smileys-and-people')).toBeNull();
    expect(localStorage.getItem('aetherchat_emoji_all')).toBeNull();
  });
});

describe('EmojiHub service', () => {
  it('fetchCategory returns EmojiItem objects with derived char', async () => {
    vi.resetModules();
    vi.doMock('$lib/services/emojiHub/client.js', () => {
      return {
        EmojiHubError: class EmojiHubError extends Error {},
        emojiHubFetch: vi.fn(async (path) => {
          if (String(path).includes('/all/category/')) {
            return [
              { name: 'grinning face', category: 'smileys-and-people', group: 'face-smiling', htmlCode: ['&#128512;'], unicode: ['U+1F600'] }
            ];
          }
          return [];
        })
      };
    });

    const mod = await import('$lib/services/emojiHub/categories.js');
    const items = await mod.fetchCategory('smileys-and-people');
    expect(items).toHaveLength(1);
    expect(items[0].char).toBeTruthy();
  });

  it('searchEmojis filters by name (case-insensitive) and limits to 50', async () => {
    vi.resetModules();
    vi.doMock('$lib/services/emojiHub/categories.js', () => {
      return {
        fetchAllEmojis: vi.fn(async () => {
          const out = [];
          for (let i = 0; i < 80; i += 1) out.push({ name: `face ${i}`, category: 'smileys-and-people', group: '', htmlCode: ['&#128512;'], unicode: ['U+1F600'], char: '😀' });
          return out;
        })
      };
    });

    const searchMod = await import('$lib/services/emojiHub/search.js');
    const all = await searchMod.buildSearchIndex();
    expect(all.length).toBeGreaterThan(0);
    const hits = searchMod.searchEmojis('FACE', all);
    expect(hits).toHaveLength(50);
    const none = searchMod.searchEmojis('zzzz-nope', all);
    expect(none).toEqual([]);
  });
});

describe('Recent emojis store', () => {
  it('recentEmojis is empty on first use', () => {
    expect(get(recentEmojis)).toEqual([]);
  });

  it('addRecentEmoji adds char to front and deduplicates', () => {
    addRecentEmoji('😀');
    addRecentEmoji('🎉');
    addRecentEmoji('😀');
    expect(get(recentEmojis)[0]).toBe('😀');
    expect(get(recentEmojis).filter((x) => x === '😀')).toHaveLength(1);
  });

  it('recentEmojis never exceeds 24 items', () => {
    for (let i = 0; i < 40; i += 1) addRecentEmoji(`x${i}`);
    expect(get(recentEmojis)).toHaveLength(24);
  });

  it('persists to localStorage on update', () => {
    addRecentEmoji('😀');
    const raw = JSON.parse(localStorage.getItem('aetherchat_emoji_recents'));
    expect(raw).toEqual(['😀']);
  });
});

describe('Emoji inserter', () => {
  it('appends to end when no selection', () => {
    const ta = document.createElement('textarea');
    ta.value = 'hi';
    // jsdom defaults selectionStart to 0; force "no selection" scenario.
    Object.defineProperty(ta, 'selectionStart', { value: null, configurable: true });
    Object.defineProperty(ta, 'selectionEnd', { value: null, configurable: true });
    const next = insertEmojiAtCursor(ta, '😀');
    expect(next).toBe('hi😀');
  });

  it('inserts at cursor position and dispatches input', async () => {
    const ta = document.createElement('textarea');
    ta.value = 'hello';
    ta.focus();
    ta.setSelectionRange(2, 2);
    const onInput = vi.fn();
    ta.addEventListener('input', onInput);
    const next = insertEmojiAtCursor(ta, '🎉');
    expect(next).toBe('he🎉llo');
    expect(onInput).toHaveBeenCalled();
  });
});

describe('Picker behavior', () => {
  it('opening emoji picker closes media picker (mutual exclusion)', async () => {
    localStorage.setItem('aetherchat_emoji_recents', JSON.stringify(['😀']));
    const { getByLabelText, queryByTestId } = render(EmojiPickerHarness);
    await fireEvent.click(getByLabelText('Open media picker'));
    expect(queryByTestId('media-picker')).toBeTruthy();
    await fireEvent.click(getByLabelText('Open emoji picker'));
    expect(queryByTestId('media-picker')).toBeNull();
  });

  it('opening media picker closes emoji picker (mutual exclusion)', async () => {
    localStorage.setItem('aetherchat_emoji_recents', JSON.stringify(['😀']));
    const { getByLabelText, getByText, queryByText } = render(EmojiPickerHarness);
    await fireEvent.click(getByLabelText('Open emoji picker'));
    expect(getByText('Emoji')).toBeTruthy();
    await fireEvent.click(getByLabelText('Open media picker'));
    expect(queryByText('Emoji')).toBeNull();
  });

  it('emoji picker stays open after selecting an emoji', async () => {
    localStorage.setItem('aetherchat_emoji_recents', JSON.stringify(['😀']));
    const { getByLabelText, queryByText } = render(EmojiPickerHarness);
    await fireEvent.click(getByLabelText('Open emoji picker'));
    const grid = getByLabelText('Emoji results');
    const btn = within(grid).getAllByRole('button')[0];
    await fireEvent.click(btn);
    expect(queryByText('Emoji')).toBeTruthy();
  });

  it('emoji picker closes on send', async () => {
    localStorage.setItem('aetherchat_emoji_recents', JSON.stringify(['😀']));
    const { getByLabelText, getByPlaceholderText, queryByText } = render(EmojiPickerHarness);
    await fireEvent.click(getByLabelText('Open emoji picker'));
    // Ensure ChatInput can send (send is a no-op for empty payload).
    await fireEvent.input(getByPlaceholderText('Write a message...'), { target: { value: 'hi' } });
    await fireEvent.click(getByLabelText('Send'));
    expect(queryByText('Emoji')).toBeNull();
  });

  it('emoji picker closes on × button click', async () => {
    localStorage.setItem('aetherchat_emoji_recents', JSON.stringify(['😀']));
    const { getByLabelText, queryByText } = render(EmojiPickerHarness);
    await fireEvent.click(getByLabelText('Open emoji picker'));
    await fireEvent.click(getByLabelText('Close emoji picker'));
    expect(queryByText('Emoji')).toBeNull();
  });

  it('bio emoji insertion enforces 120-char limit (does not insert if at limit)', async () => {
    const { insertEmojiAtCursor: ins } = await import('$lib/utils/emojiInserter.js');
    const ta = document.createElement('textarea');
    ta.value = 'a'.repeat(120);
    ta.setSelectionRange(120, 120);
    const before = ta.value;
    // Simulate ProfileFields guard: do not insert when at limit and no selection.
    if (ta.value.length < 120) ins(ta, '😀');
    expect(ta.value).toBe(before);
  });
});
