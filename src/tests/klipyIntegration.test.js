import { render, fireEvent } from '@testing-library/svelte';
import Dexie from 'dexie';
import { get } from 'svelte/store';

import { clearExpired, getCached, setCached } from '$lib/services/klipy/cache.js';
import { __resetRecentsForTest, addRecentItem, recentItems } from '$lib/stores/klipyRecents.js';
import { createComposer } from '$lib/utils/mediaComposer.js';
import { AetherChatDB } from '$lib/services/db.js';
import MessageMedia from '$lib/components/mediaPicker/MessageMedia.svelte';

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

const sampleGif = {
  id: 'g1',
  type: 'gif',
  url: 'https://cdn.example/full.gif',
  previewUrl: 'https://cdn.example/prev.gif',
  width: 200,
  height: 100
};

const sampleSticker = {
  id: 's1',
  type: 'sticker',
  url: 'https://cdn.example/full2.gif',
  previewUrl: 'https://cdn.example/prev2.gif',
  width: 120,
  height: 120
};

beforeEach(() => {
  resetLocalStorage();
  __resetRecentsForTest();
});

describe('Klipy cache', () => {
  it('getCached returns null for missing key', () => {
    expect(getCached('klipy_cache_gifs_trending_x_10')).toBeNull();
  });

  it('setCached stores data with timestamp', () => {
    withFakeNow(1000, () => {
      setCached('klipy_cache_gifs_trending_x_10', [sampleGif]);
    });
    const raw = JSON.parse(localStorage.getItem('klipy_cache_gifs_trending_x_10'));
    expect(raw.cachedAt).toBe(1000);
    expect(raw.data).toHaveLength(1);
  });

  it('getCached returns null for expired entry (TTL elapsed)', () => {
    withFakeNow(1000, () => {
      setCached('klipy_cache_gifs_trending_x_10', [sampleGif]);
    });
    // trending TTL = 10 minutes
    const elevenMin = 1000 + 11 * 60 * 1000;
    const hit = withFakeNow(elevenMin, () => getCached('klipy_cache_gifs_trending_x_10'));
    expect(hit).toBeNull();
  });

  it('getCached returns data for valid (non-expired) entry', () => {
    withFakeNow(1000, () => {
      setCached('klipy_cache_gifs_search_cats_10', [sampleGif]);
    });
    const fourMin = 1000 + 4 * 60 * 1000;
    const hit = withFakeNow(fourMin, () => getCached('klipy_cache_gifs_search_cats_10'));
    expect(hit).toHaveLength(1);
  });

  it('clearExpired removes entries older than their TTL', () => {
    withFakeNow(1000, () => {
      setCached('klipy_cache_gifs_trending_x_10', [sampleGif]);
      setCached('klipy_cache_gifs_search_cats_10', [sampleGif]);
    });
    withFakeNow(1000 + 12 * 60 * 1000, () => {
      clearExpired();
    });
    expect(localStorage.getItem('klipy_cache_gifs_trending_x_10')).toBeNull();
    expect(localStorage.getItem('klipy_cache_gifs_search_cats_10')).toBeNull();
  });
});

describe('Recents store', () => {
  it('recentItems is empty on first use', () => {
    expect(get(recentItems)).toEqual([]);
  });

  it('addRecentItem adds item to front of list', () => {
    addRecentItem(sampleGif);
    expect(get(recentItems)[0].id).toBe('g1');
  });

  it('addRecentItem deduplicates by id', () => {
    addRecentItem(sampleGif);
    addRecentItem(sampleSticker);
    addRecentItem(sampleGif);
    const ids = get(recentItems).map((x) => x.id);
    expect(ids[0]).toBe('g1');
    expect(ids.filter((x) => x === 'g1')).toHaveLength(1);
  });

  it('recentItems never exceeds 10 items', () => {
    for (let i = 0; i < 20; i += 1) addRecentItem({ ...sampleGif, id: `g${i}` });
    expect(get(recentItems)).toHaveLength(10);
  });

  it('state persists to localStorage on update', () => {
    addRecentItem(sampleGif);
    const raw = JSON.parse(localStorage.getItem('aetherchat_klipy_recents'));
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe('g1');
  });
});

describe('Media composer', () => {
  it('canAddMore is true when mediaItems.length < 2', () => {
    const c = createComposer();
    expect(get(c.canAddMore)).toBe(true);
  });

  it('canAddMore is false when mediaItems.length === 2', () => {
    const c = createComposer();
    c.addItem(sampleGif);
    c.addItem(sampleSticker);
    expect(get(c.canAddMore)).toBe(false);
  });

  it('addItem adds item to mediaItems', () => {
    const c = createComposer();
    c.addItem(sampleGif);
    expect(get(c.mediaItems)).toHaveLength(1);
  });

  it('addItem is a no-op when canAddMore is false', () => {
    const c = createComposer();
    c.addItem(sampleGif);
    c.addItem(sampleSticker);
    c.addItem({ ...sampleGif, id: 'g2' });
    expect(get(c.mediaItems)).toHaveLength(2);
  });

  it('removeItem removes the correct item by id', () => {
    const c = createComposer();
    c.addItem(sampleGif);
    c.addItem(sampleSticker);
    c.removeItem('g1');
    expect(get(c.mediaItems).map((m) => m.id)).toEqual(['s1']);
  });

  it('isSoloMedia is true when text is empty and one item is present', () => {
    const c = createComposer();
    c.addItem(sampleGif);
    expect(get(c.isSoloMedia)).toBe(true);
  });

  it('isSoloMedia is false when text is non-empty', () => {
    const c = createComposer();
    c.text.set('hi');
    c.addItem(sampleGif);
    expect(get(c.isSoloMedia)).toBe(false);
  });

  it('toPayload returns { text, media: null } when no media', () => {
    const c = createComposer();
    c.text.set('hi');
    expect(c.toPayload()).toEqual({ text: 'hi', media: null });
  });

  it('toPayload returns { text, media: [...] } when media present', () => {
    const c = createComposer();
    c.text.set('hi');
    c.addItem(sampleGif);
    expect(c.toPayload().media).toHaveLength(1);
  });

  it('reset clears both text and mediaItems', () => {
    const c = createComposer();
    c.text.set('hi');
    c.addItem(sampleGif);
    c.reset();
    expect(get(c.text)).toBe('');
    expect(get(c.mediaItems)).toEqual([]);
  });
});

describe('DB migration v18 (media backfill)', () => {
  it('existing messages without media field get media: null after migration', async () => {
    const name = `AetherChatDB-media-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Create "old" DB at version 17 without `media` field.
    const old = new Dexie(name);
    old.version(17).stores({
      users: 'id, username, createdAt',
      globalMessages: 'id, timestamp, peerId, username',
      privateChats: 'id, myPeerId, myUsername, theirPeerId, theirUsername, createdAt, lastActivity',
      privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
      knownPeers: '++id, peerId, lastSeen, username',
      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
      peerIds: 'username, peerId',
      queuedMessages: 'id, chatId, theirPeerId, timestamp',
      queuedActions: 'id, chatId, theirPeerId, timestamp, kind',
      sentMessagesPlaintext: 'id, chatId, timestamp',
      sessionKeys: 'id, updatedAt',
      cooldown: 'id',
      follows: '++id, followerPeerId, targetPeerId, [followerPeerId+targetPeerId]',
      wallComments: 'id, wallOwnerPeerId, authorPeerId, createdAt, [wallOwnerPeerId+authorPeerId], [wallOwnerPeerId+createdAt]'
    });
    await old.open();

    await old.table('globalMessages').put({
      id: 'g1',
      peerId: 'p1',
      username: 'alice',
      dateOfBirth: null,
      color: 'hsl(0,0%,65%)',
      text: 'hello',
      replies: null,
      timestamp: 1
    });
    await old.table('privateMessages').put({
      id: 'pm1',
      chatId: 'a:b',
      direction: 'received',
      ciphertext: 'C',
      iv: 'I',
      timestamp: 1,
      delivered: true
    });
    await old.table('wallComments').put({
      id: 'wc1',
      wallOwnerPeerId: 'p1',
      authorPeerId: 'p2',
      authorUsername: 'bob',
      authorColor: 'hsl(0,0%,65%)',
      authorAvatarBase64: null,
      text: 'yo',
      createdAt: 1,
      editedAt: null,
      deleted: false
    });

    old.close();

    const db = new AetherChatDB(name);
    await db.open();

    const g = await db.globalMessages.get('g1');
    expect(Object.prototype.hasOwnProperty.call(g ?? {}, 'media')).toBe(true);
    expect(g?.media).toBeNull();

    const pm = await db.privateMessages.get('pm1');
    expect(Object.prototype.hasOwnProperty.call(pm ?? {}, 'media')).toBe(true);
    expect(pm?.media).toBeNull();

    const wc = await db.wallComments.get('wc1');
    expect(Object.prototype.hasOwnProperty.call(wc ?? {}, 'media')).toBe(true);
    expect(wc?.media).toBeNull();

    await db.delete();
  });

  it('saving and retrieving a message with media preserves the media array', async () => {
    const name = `AetherChatDB-media2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const db = new AetherChatDB(name);
    await db.open();
    await db.globalMessages.put({
      id: 'g1',
      peerId: 'p1',
      username: 'alice',
      dateOfBirth: null,
      color: 'hsl(0,0%,65%)',
      text: '',
      media: [sampleGif],
      replies: null,
      timestamp: 1,
      editedAt: null,
      deleted: false
    });
    const row = await db.globalMessages.get('g1');
    expect(row?.media).toHaveLength(1);
    expect(row?.media?.[0]?.id).toBe('g1');
    await db.delete();
  });
});

describe('Rendering: MessageMedia', () => {
  it('renders one <img> for a single-item media array', () => {
    const { container } = render(MessageMedia, { props: { media: [sampleGif], username: 'alice' } });
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('renders two <img> tags for a two-item array', () => {
    const { container } = render(MessageMedia, { props: { media: [sampleGif, sampleSticker], username: 'alice' } });
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('renders nothing when media is null or empty', () => {
    const { container: a } = render(MessageMedia, { props: { media: null, username: 'alice' } });
    expect(a.querySelectorAll('img')).toHaveLength(0);
    const { container: b } = render(MessageMedia, { props: { media: [], username: 'alice' } });
    expect(b.querySelectorAll('img')).toHaveLength(0);
  });

  it('shows placeholder when image load fails', async () => {
    const { container, getByText } = render(MessageMedia, { props: { media: [sampleGif], username: 'alice' } });
    const img = container.querySelector('img');
    await fireEvent.error(img);
    // First error swaps to previewUrl; second error marks it broken.
    await fireEvent.error(img);
    expect(getByText(/Broken gif/i)).toBeTruthy();
  });
});
