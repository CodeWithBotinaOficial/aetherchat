import { get } from 'svelte/store';
import { fireEvent } from '@testing-library/svelte';
import { waitFor } from '@testing-library/dom';
import GlobalChat from '$lib/components/GlobalChat.svelte';
import PrivateChatWindow from '$lib/components/PrivateChatWindow.svelte';
import { db, saveGlobalMessage } from '$lib/services/db.js';
import { globalMessages } from '$lib/stores/chatStore.js';
import { peer } from '$lib/stores/peerStore.js';
import { privateChatStore } from '$lib/stores/privateChatStore.js';
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
    db.follows,
    db.wallComments,
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
        db.cooldown.clear(),
        db.follows.clear(),
        db.wallComments.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await clearAllTables();
  document.body.innerHTML = '';
  globalMessages.set([]);
  privateChatStore.set({ chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() });
  user.set({ id: 1, username: 'alice', age: 22, color: 'hsl(1, 65%, 65%)', avatarBase64: null, createdAt: Date.now() });
  peer.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    lastSyncAt: null,
    connectedPeers: new Map()
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

it('GlobalChat: cancelling an edit discards changes (no DB update)', async () => {
  const now = Date.now();
  await saveGlobalMessage({
    id: 'm1',
    peerId: 'local',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'hello',
    replies: null,
    timestamp: now
  });

  const component = new GlobalChat({ target: document.body });
  await wait(40);

  const trigger = document.querySelector('.msg-menu-trigger');
  expect(trigger).toBeTruthy();
  await fireEvent.pointerDown(trigger);
  const editBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Edit');
  expect(editBtn).toBeTruthy();
  await fireEvent.click(editBtn);

  const textarea = document.querySelector('textarea');
  expect(textarea).toBeTruthy();
  await fireEvent.input(textarea, { target: { value: 'changed' } });

  const cancelBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel');
  expect(cancelBtn).toBeTruthy();
  await fireEvent.click(cancelBtn);

  const fromStore = get(globalMessages).find((m) => m.id === 'm1');
  expect(fromStore.text).toBe('hello');
  const fromDb = await db.globalMessages.get('m1');
  expect(fromDb.text).toBe('hello');

  component.$destroy();
});

it('GlobalChat: saving an edit updates the message in-place and persists to DB', async () => {
  const now = Date.now();
  await saveGlobalMessage({
    id: 'm2',
    peerId: 'local',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'hello',
    replies: null,
    timestamp: now
  });

  const component = new GlobalChat({ target: document.body });
  await wait(40);

  const trigger = await waitFor(() => {
    const el = document.querySelector('.msg-menu-trigger');
    if (!el) throw new Error('menu trigger not ready');
    return el;
  });
  await fireEvent.pointerDown(trigger);
  await fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Edit'));

  const textarea = document.querySelector('textarea');
  await fireEvent.input(textarea, { target: { value: 'hello edited' } });

  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save');
  expect(saveBtn).toBeTruthy();
  await fireEvent.click(saveBtn);
  await wait(10);

  const fromStore = get(globalMessages).find((m) => m.id === 'm2');
  expect(fromStore.text).toBe('hello edited');
  expect(typeof fromStore.editedAt).toBe('number');

  const fromDb = await db.globalMessages.get('m2');
  expect(fromDb.text).toBe('hello edited');
  expect(typeof fromDb.editedAt).toBe('number');

  component.$destroy();
});

it('GlobalChat: while editing, adding/removing quoted replies is saved on confirm', async () => {
  const now = Date.now();
  await saveGlobalMessage({
    id: 'orig',
    peerId: 'p2',
    username: 'bob',
    age: 30,
    color: 'hsl(2, 65%, 65%)',
    text: 'original',
    replies: null,
    timestamp: now - 1000
  });
  await saveGlobalMessage({
    id: 'mine',
    peerId: 'local',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'my msg',
    replies: [
      { messageId: 'orig', authorUsername: 'bob', authorColor: 'hsl(2, 65%, 65%)', textSnapshot: 'original', timestamp: now - 1000 }
    ],
    timestamp: now
  });

  const component = new GlobalChat({ target: document.body });
  await wait(60);

  // Enter edit mode for "mine".
  const allTriggers = document.querySelectorAll('.msg-menu-trigger');
  expect(allTriggers.length).toBeGreaterThan(0);
  await fireEvent.pointerDown(allTriggers[allTriggers.length - 1]);
  await fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Edit'));

  // Remove existing cited reply.
  const removeBtn = document.querySelector('.pending-remove');
  expect(removeBtn).toBeTruthy();
  await fireEvent.click(removeBtn);

  // Add a new cited reply by clicking reply on the original message bubble.
  const replyBtns = document.querySelectorAll('.reply-btn-right');
  expect(replyBtns.length).toBeGreaterThan(0);
  await fireEvent.click(replyBtns[0]);

  await fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save'));
  await wait(10);

  const fromDb = await db.globalMessages.get('mine');
  expect(Array.isArray(fromDb.replies)).toBe(true);
  expect(fromDb.replies[0].messageId).toBe('orig');

  component.$destroy();
});

it('GlobalChat: edit/delete actions are not available after 30 minutes', async () => {
  const now = Date.now();
  await saveGlobalMessage({
    id: 'm-old',
    peerId: 'local',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'too old',
    replies: null,
    timestamp: now - 31 * 60 * 1000
  });

  const component = new GlobalChat({ target: document.body });
  await wait(40);

  expect(document.querySelector('.msg-menu-trigger')).toBeNull();

  component.$destroy();
});

it('PrivateChatWindow: edit action is available for own messages regardless of age', async () => {
  user.set({ id: 1, username: 'alice', age: 22, color: 'hsl(1, 65%, 65%)', avatarBase64: null, createdAt: Date.now() });
  privateChatStore.set({
    chats: new Map([
      [
        'alice:bob',
        {
          id: 'alice:bob',
          theirPeerId: 'p2',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [
            { id: 's1', direction: 'sent', text: 'old', timestamp: 1, delivered: true, queued: false, editedAt: null, deleted: false, sealed: false }
          ],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 1,
          isOnline: false,
          keyExchangeState: 'active',
          pendingReplies: [],
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'alice:bob',
    pendingKeyExchanges: new Map()
  });

  const component = new PrivateChatWindow({ target: document.body });
  await wait(10);

  expect(document.querySelector('.msg-menu-trigger')).toBeTruthy();

  component.$destroy();
});
