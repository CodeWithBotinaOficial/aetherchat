import { get } from 'svelte/store';
import { fireEvent, render } from '@testing-library/svelte';
import { waitFor } from '@testing-library/dom';
import GlobalChat from '$lib/components/GlobalChat.svelte';
import MessageBubble from '$lib/components/MessageBubble.svelte';
import { db } from '$lib/services/db.js';
import {
  addPendingReply as addGlobalPendingReply,
  clearPendingReplies as clearGlobalPendingReplies,
  pendingReplies as globalPendingReplies,
  removePendingReply as removeGlobalPendingReply,
  globalMessages
} from '$lib/stores/chatStore.js';
import {
  addPendingReply as addPrivatePendingReply,
  clearPendingReplies as clearPrivatePendingReplies,
  privateChatStore,
  removePendingReply as removePrivatePendingReply
} from '$lib/stores/privateChatStore.js';
import { peer } from '$lib/stores/peerStore.js';
import { user } from '$lib/stores/userStore.js';

async function clearAllTables() {
  await db.transaction(
    'rw',
    db.users,
    db.globalMessages,
    db.privateChats,
    db.privateMessages,
    db.sentMessagesPlaintext,
    db.sessionKeys,
    db.queuedMessages,
    db.queuedActions,
    db.knownPeers,
    db.usernameRegistry,
    db.peerIds,
    db.cooldown,
    async () => {
      await Promise.all([
        db.users.clear(),
        db.globalMessages.clear(),
        db.privateChats.clear(),
        db.privateMessages.clear(),
        db.sentMessagesPlaintext.clear(),
        db.sessionKeys.clear(),
        db.queuedMessages.clear(),
        db.queuedActions.clear(),
        db.knownPeers.clear(),
        db.usernameRegistry.clear(),
        db.peerIds.clear(),
        db.cooldown.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await clearAllTables();
  document.body.innerHTML = '';
  globalMessages.set([]);
  clearGlobalPendingReplies();
  user.set(null);
  peer.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map()
  });
  privateChatStore.set({ chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() });
});

afterEach(() => {
  document.body.innerHTML = '';
});

it('addPendingReply adds a message to the array and ignores duplicates (global)', () => {
  const msg = { id: 'm1', username: 'alice', color: 'hsl(1, 65%, 65%)', text: 'hello', age: 1, peerId: 'p1', timestamp: 1 };
  addGlobalPendingReply(msg);
  addGlobalPendingReply(msg);
  expect(get(globalPendingReplies)).toHaveLength(1);
  expect(get(globalPendingReplies)[0].messageId).toBe('m1');
});

it('removePendingReply removes the correct entry (global)', () => {
  addGlobalPendingReply({ id: 'm1', username: 'alice', color: 'hsl(1, 65%, 65%)', text: 'hello', age: 1, peerId: 'p1', timestamp: 1 });
  addGlobalPendingReply({ id: 'm2', username: 'bob', color: 'hsl(2, 65%, 65%)', text: 'yo', age: 2, peerId: 'p2', timestamp: 2 });
  removeGlobalPendingReply('m1');
  expect(get(globalPendingReplies).map((r) => r.messageId)).toEqual(['m2']);
});

it('clearPendingReplies empties the array (global)', () => {
  addGlobalPendingReply({ id: 'm1', username: 'alice', color: 'hsl(1, 65%, 65%)', text: 'hello', age: 1, peerId: 'p1', timestamp: 1 });
  clearGlobalPendingReplies();
  expect(get(globalPendingReplies)).toEqual([]);
});

it('addPendingReply/remove/clear work per private chat context', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'p2',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 0,
          isOnline: true,
          keyExchangeState: 'active',
          pendingReplies: [],
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  addPrivatePendingReply('a:b', { id: 'pm1', username: 'bob', color: 'hsl(2, 65%, 65%)', text: 'hi' });
  addPrivatePendingReply('a:b', { id: 'pm1', username: 'bob', color: 'hsl(2, 65%, 65%)', text: 'hi' });
  expect(get(privateChatStore).chats.get('a:b').pendingReplies).toHaveLength(1);

  removePrivatePendingReply('a:b', 'pm1');
  expect(get(privateChatStore).chats.get('a:b').pendingReplies).toHaveLength(0);

  addPrivatePendingReply('a:b', { id: 'pm2', username: 'bob', color: 'hsl(2, 65%, 65%)', text: 'yo' });
  clearPrivatePendingReplies('a:b');
  expect(get(privateChatStore).chats.get('a:b').pendingReplies).toHaveLength(0);
});

it('Sending a message includes the replies array and clears pendingReplies (GlobalChat offline path)', async () => {
  user.set({ id: 1, username: 'alice', age: 22, color: 'hsl(1, 65%, 65%)', avatarBase64: null, createdAt: 1 });
  const component = new GlobalChat({ target: document.body });
  await new Promise((r) => setTimeout(r, 30));

  globalMessages.set([
    { id: 'orig1', peerId: 'p1', username: 'bob', age: 33, color: 'hsl(2, 65%, 65%)', text: 'original', timestamp: 10 }
  ]);
  await new Promise((r) => setTimeout(r, 0));

  addGlobalPendingReply(get(globalMessages)[0]);
  expect(get(globalPendingReplies)).toHaveLength(1);

  const textarea = document.querySelector('textarea');
  expect(textarea).toBeTruthy();
  await fireEvent.input(textarea, { target: { value: 'replying' } });

  const sendBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Send');
  expect(sendBtn).toBeTruthy();
  await fireEvent.click(sendBtn);

  await waitFor(() => {
    if (get(globalPendingReplies).length !== 0) throw new Error('pendingReplies not cleared yet');
    return true;
  });

  const msgs = get(globalMessages);
  expect(msgs.length).toBeGreaterThan(1);
  const last = msgs[msgs.length - 1];
  expect(Array.isArray(last.replies)).toBe(true);
  expect(last.replies[0].messageId).toBe('orig1');
  expect(last.replies[0].timestamp).toBe(10);
  expect(get(globalPendingReplies)).toHaveLength(0);

  component.$destroy();
});

it('A message with replies: null renders no quoted cards', async () => {
  render(MessageBubble, {
    message: { id: 'm1', username: 'alice', age: 1, color: 'hsl(1, 65%, 65%)', text: 'hello', timestamp: 1, replies: null },
    isOwn: true
  });
  expect(document.querySelectorAll('.quote-card').length).toBe(0);
});

it('A message with one reply renders one quoted card with truncated preview and click emits event', async () => {
  const long = 'x'.repeat(200);
  const { component } = render(MessageBubble, {
    message: {
      id: 'm2',
      username: 'alice',
      age: 1,
      color: 'hsl(1, 65%, 65%)',
      text: 'hello',
      timestamp: 1,
      replies: [{ messageId: 'orig1', authorUsername: 'bob', authorColor: 'hsl(2, 65%, 65%)', textSnapshot: long, timestamp: 10 }]
    },
    isOwn: false
  });

  const card = document.querySelector('.quote-card');
  expect(card).toBeTruthy();
  expect(card.textContent).toContain('bob');
  // Expect ellipsis truncation.
  expect(card.textContent).toContain('…');

  const seen = [];
  component.$on('jumpToOriginal', (e) => seen.push(e.detail.messageId));
  card.click();
  expect(seen).toEqual(['orig1']);
});

it('A deleted cited message renders a muted non-clickable quoted card', async () => {
  const { component } = render(MessageBubble, {
    message: {
      id: 'm-del-quote',
      username: 'alice',
      age: 1,
      color: 'hsl(1, 65%, 65%)',
      text: 'hello',
      timestamp: 1,
      replies: [
        {
          messageId: 'orig-deleted',
          authorUsername: 'bob',
          authorColor: 'hsl(2, 65%, 65%)',
          textSnapshot: '[ Original message deleted ]',
          timestamp: 10,
          deleted: true
        }
      ]
    },
    isOwn: false
  });

  const card = document.querySelector('.quote-card.quote-deleted');
  expect(card).toBeTruthy();
  expect(card.tagName).toBe('DIV');
  expect(card.textContent).toContain('Original message deleted');

  const seen = [];
  component.$on('jumpToOriginal', (e) => seen.push(e.detail.messageId));
  card.click();
  expect(seen).toEqual([]);
});

it('Swipe threshold: below 60px does not trigger reply; above 60px triggers reply', async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (q) => {
    if (q === '(max-width: 639px)') return { matches: true, media: q, addEventListener() {}, removeEventListener() {} };
    if (q === '(min-width: 1024px)') return { matches: false, media: q, addEventListener() {}, removeEventListener() {} };
    if (q === '(hover: none)') return { matches: true, media: q, addEventListener() {}, removeEventListener() {} };
    return originalMatchMedia ? originalMatchMedia(q) : { matches: false, media: q, addEventListener() {}, removeEventListener() {} };
  };
  try {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
  } catch {
    // ignore
  }

  const { component } = render(MessageBubble, {
    message: { id: 'm-swipe', username: 'alice', age: 1, color: 'hsl(1, 65%, 65%)', text: 'hello', timestamp: 1 },
    isOwn: true
  });

  let replies = 0;
  component.$on('reply', () => (replies += 1));

  const bubble = document.querySelector('[data-aether-bubble="true"]');
  expect(bubble).toBeTruthy();

  const touch = (type, x, y) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
    Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
    return ev;
  };

  bubble.dispatchEvent(touch('touchstart', 100, 100));
  bubble.dispatchEvent(touch('touchmove', 50, 100)); // 50px left
  bubble.dispatchEvent(touch('touchend', 50, 100));
  expect(replies).toBe(0);

  bubble.dispatchEvent(touch('touchstart', 100, 100));
  bubble.dispatchEvent(touch('touchmove', 20, 100)); // 80px left
  bubble.dispatchEvent(touch('touchend', 20, 100));
  expect(replies).toBe(1);

  window.matchMedia = originalMatchMedia;
});
