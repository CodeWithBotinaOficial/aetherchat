import { get } from 'svelte/store';
import { db, savePrivateMessage, upsertPrivateChat } from '$lib/services/db.js';

const hoisted = vi.hoisted(() => {
  return {
    isSessionActiveMock: vi.fn(),
    decryptForSessionMock: vi.fn()
  };
});

vi.mock('$lib/services/crypto.js', () => {
  return {
    isSessionActive: (...args) => hoisted.isSessionActiveMock(...args),
    decryptForSession: (...args) => hoisted.decryptForSessionMock(...args)
  };
});

import {
  activeChat,
  addIncomingMessage,
  addOutgoingMessage,
  chatList,
  closeChat,
  deleteChatFromStore,
  loadChatMessages,
  loadPrivateChats,
  markDelivered,
  openChat,
  privateChatStore,
  setChatOnlineStatus,
  setKeyExchangeState,
  totalUnread
} from '$lib/stores/privateChatStore.js';

async function clearAllTables() {
  await db.transaction(
    'rw',
    db.users,
    db.globalMessages,
    db.privateChats,
    db.privateMessages,
    db.knownPeers,
    db.usernameRegistry,
    async () => {
      await Promise.all([
        db.users.clear(),
        db.globalMessages.clear(),
        db.privateChats.clear(),
        db.privateMessages.clear(),
        db.knownPeers.clear(),
        db.usernameRegistry.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  hoisted.isSessionActiveMock.mockReset();
  hoisted.decryptForSessionMock.mockReset();
  await clearAllTables();
  privateChatStore.set({ chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() });
});

it('loadPrivateChats populates store from DB', async () => {
  const now = Date.now();
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now
  });

  await loadPrivateChats('a');
  expect(get(chatList)).toHaveLength(1);
  expect(get(chatList)[0].theirUsername).toBe('bob');
});

it('openChat sets activeChatId and resets unreadCount', async () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 3,
          lastMessage: null,
          lastActivity: Date.now(),
          isOnline: false,
          keyExchangeState: 'idle',
          __loaded: true
        }
      ]
    ]),
    activeChatId: null,
    pendingKeyExchanges: new Map()
  });

  openChat('a:b');
  const s = get(privateChatStore);
  expect(s.activeChatId).toBe('a:b');
  expect(s.chats.get('a:b').unreadCount).toBe(0);
});

it('closeChat sets activeChatId to null', () => {
  privateChatStore.set({ chats: new Map(), activeChatId: 'a:b', pendingKeyExchanges: new Map() });
  closeChat();
  expect(get(privateChatStore).activeChatId).toBeNull();
});

it("addOutgoingMessage adds message with direction 'sent' and delivered false", () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 0,
          isOnline: true,
          keyExchangeState: 'active',
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  addOutgoingMessage('a:b', { id: 'm1', text: 'hi', timestamp: 10 });
  const chat = get(privateChatStore).chats.get('a:b');
  expect(chat.messages[0].direction).toBe('sent');
  expect(chat.messages[0].delivered).toBe(false);
});

it('addIncomingMessage increments unreadCount when chat is not active', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 0,
          isOnline: true,
          keyExchangeState: 'active',
          __loaded: true
        }
      ]
    ]),
    activeChatId: null,
    pendingKeyExchanges: new Map()
  });

  addIncomingMessage('a:b', { id: 'm1', text: 'yo', timestamp: 10, fromPeerId: 'b' });
  expect(get(privateChatStore).chats.get('a:b').unreadCount).toBe(1);
});

it('addIncomingMessage does NOT increment unreadCount when chat is active', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 0,
          isOnline: true,
          keyExchangeState: 'active',
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  addIncomingMessage('a:b', { id: 'm1', text: 'yo', timestamp: 10, fromPeerId: 'b' });
  expect(get(privateChatStore).chats.get('a:b').unreadCount).toBe(0);
});

it('markDelivered updates delivered field in store', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [{ id: 'm1', direction: 'sent', text: 'hi', timestamp: 1, delivered: false }],
          unreadCount: 0,
          lastMessage: 'hi',
          lastActivity: 1,
          isOnline: true,
          keyExchangeState: 'active',
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  markDelivered('a:b', 'm1');
  expect(get(privateChatStore).chats.get('a:b').messages[0].delivered).toBe(true);
});

it('setKeyExchangeState updates keyExchangeState correctly', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 0,
          isOnline: true,
          keyExchangeState: 'idle',
          __loaded: true
        }
      ]
    ]),
    activeChatId: null,
    pendingKeyExchanges: new Map()
  });

  setKeyExchangeState('a:b', 'initiated');
  expect(get(privateChatStore).chats.get('a:b').keyExchangeState).toBe('initiated');
});

it('setChatOnlineStatus updates isOnline by peerId', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 0,
          isOnline: false,
          keyExchangeState: 'idle',
          __loaded: true
        }
      ]
    ]),
    activeChatId: null,
    pendingKeyExchanges: new Map()
  });

  setChatOnlineStatus('b', true);
  expect(get(privateChatStore).chats.get('a:b').isOnline).toBe(true);
});

it('deleteChatFromStore removes entry from store and calls DB delete', async () => {
  const spy = vi.spyOn(await import('$lib/services/db.js'), 'deletePrivateChat');
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'b',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 0,
          isOnline: false,
          keyExchangeState: 'idle',
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  await deleteChatFromStore('a:b');
  expect(get(privateChatStore).chats.has('a:b')).toBe(false);
  expect(get(privateChatStore).activeChatId).toBeNull();
  expect(spy).toHaveBeenCalledWith('a:b');
});

it('totalUnread derived store sums unreadCounts correctly', () => {
  privateChatStore.set({
    chats: new Map([
      ['a:b', { id: 'a:b', theirPeerId: 'b', theirUsername: 'b', theirColor: 'x', theirAvatarBase64: null, messages: [], unreadCount: 2, lastMessage: null, lastActivity: 2, isOnline: false, keyExchangeState: 'idle', __loaded: true }],
      ['a:c', { id: 'a:c', theirPeerId: 'c', theirUsername: 'c', theirColor: 'x', theirAvatarBase64: null, messages: [], unreadCount: 3, lastMessage: null, lastActivity: 3, isOnline: false, keyExchangeState: 'idle', __loaded: true }]
    ]),
    activeChatId: null,
    pendingKeyExchanges: new Map()
  });

  expect(get(totalUnread)).toBe(5);
});

it('chatList derived store sorts by lastActivity descending', () => {
  privateChatStore.set({
    chats: new Map([
      ['a:b', { id: 'a:b', theirPeerId: 'b', theirUsername: 'b', theirColor: 'x', theirAvatarBase64: null, messages: [], unreadCount: 0, lastMessage: null, lastActivity: 1, isOnline: false, keyExchangeState: 'idle', __loaded: true }],
      ['a:c', { id: 'a:c', theirPeerId: 'c', theirUsername: 'c', theirColor: 'x', theirAvatarBase64: null, messages: [], unreadCount: 0, lastMessage: null, lastActivity: 10, isOnline: false, keyExchangeState: 'idle', __loaded: true }]
    ]),
    activeChatId: null,
    pendingKeyExchanges: new Map()
  });

  expect(get(chatList).map((c) => c.id)).toEqual(['a:c', 'a:b']);
});

it('activeChat derived store returns null when activeChatId is null', () => {
  privateChatStore.set({ chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() });
  expect(get(activeChat)).toBeNull();
});

it('loadChatMessages shows placeholder for undecryptable messages', async () => {
  const now = Date.now();
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now
  });
  await savePrivateMessage({
    id: 'pm-1',
    chatId: 'a:b',
    direction: 'received',
    ciphertext: 'CT',
    iv: 'IV',
    timestamp: now,
    delivered: true
  });

  await loadPrivateChats('a');
  hoisted.isSessionActiveMock.mockReturnValue(false);
  await loadChatMessages('a:b', 'a:b');

  const chat = get(privateChatStore).chats.get('a:b');
  expect(chat.messages[0].text).toMatch(/Encrypted message/i);
});
