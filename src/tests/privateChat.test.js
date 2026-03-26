import { get } from 'svelte/store';
import { db, deletePrivateChat, savePrivateMessage, saveSentMessagePlaintext, upsertPrivateChat } from '$lib/services/db.js';
import { fireEvent, render } from '@testing-library/svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

const hoisted = vi.hoisted(() => {
  return {
    isSessionActiveMock: vi.fn(),
    decryptForSessionMock: vi.fn(),
    closeSessionMock: vi.fn(),
    resumeSessionMock: vi.fn().mockResolvedValue(false)
  };
});

vi.mock('$lib/services/crypto.js', () => {
  return {
    isSessionActive: (...args) => hoisted.isSessionActiveMock(...args),
    decryptForSession: (...args) => hoisted.decryptForSessionMock(...args),
    closeSession: (...args) => hoisted.closeSessionMock(...args),
    resumeSession: (...args) => hoisted.resumeSessionMock(...args)
  };
});

import {
  activeChat,
  addIncomingMessage,
  addOutgoingMessage,
  chatList,
  closeChat,
  deleteChatFromStore,
  decryptSealedMessages,
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
	    db.sentMessagesPlaintext,
	    db.sessionKeys,
	    db.queuedMessages,
	    db.knownPeers,
	    db.usernameRegistry,
	    db.peerIds,
	    async () => {
	      await Promise.all([
	        db.users.clear(),
	        db.globalMessages.clear(),
	        db.privateChats.clear(),
	        db.privateMessages.clear(),
	        db.sentMessagesPlaintext.clear(),
	        db.sessionKeys.clear(),
	        db.queuedMessages.clear(),
	        db.knownPeers.clear(),
	        db.usernameRegistry.clear(),
	        db.peerIds.clear()
	      ]);
	    }
	  );
}

	beforeEach(async () => {
	  hoisted.isSessionActiveMock.mockReset();
	  hoisted.decryptForSessionMock.mockReset();
	  hoisted.closeSessionMock.mockReset();
	  hoisted.resumeSessionMock.mockReset();
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

it('deleteChatFromStore clears activeChatId before removing from Map, deletes DB rows, clears queue, and closes session', async () => {
  const dbMod = await import('$lib/services/db.js');
  const deleteSpy = vi.spyOn(dbMod, 'deletePrivateChat');
  const clearQueueSpy = vi.spyOn(dbMod, 'clearQueuedMessagesForChat');

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

  const snapshots = [];
  const unsub = privateChatStore.subscribe((s) => {
    snapshots.push({ activeChatId: s.activeChatId, hasChat: s.chats.has('a:b') });
  });

  const p = deleteChatFromStore('a:b');
  // First synchronous update should clear activeChatId but keep chat until after tick().
  expect(get(privateChatStore).activeChatId).toBeNull();
  expect(get(privateChatStore).chats.has('a:b')).toBe(true);

  await p;
  unsub();

  expect(get(privateChatStore).chats.has('a:b')).toBe(false);
  expect(get(privateChatStore).activeChatId).toBeNull();
  expect(deleteSpy).toHaveBeenCalledWith('a:b');
  expect(clearQueueSpy).toHaveBeenCalledWith('a:b');
  expect(hoisted.closeSessionMock).toHaveBeenCalledWith('a:b');

  // Ensure we had an intermediate state where the chat existed but activeChatId was already null.
  expect(snapshots.some((s) => s.activeChatId === null && s.hasChat === true)).toBe(true);
});

it('deleteChatFromStore does not throw if DB delete fails', async () => {
  const dbMod = await import('$lib/services/db.js');
  vi.spyOn(dbMod, 'deletePrivateChat').mockRejectedValueOnce(new Error('boom'));

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

  await expect(deleteChatFromStore('a:b')).resolves.toBeUndefined();
  expect(get(privateChatStore).activeChatId).toBeNull();
  expect(get(privateChatStore).chats.has('a:b')).toBe(false);
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

it('loadPrivateChats loads plaintext for sent messages (readable after reload)', async () => {
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
    id: 'pm-sent',
    chatId: 'a:b',
    direction: 'sent',
    ciphertext: 'CT',
    iv: 'IV',
    timestamp: now,
    delivered: false
  });
  await saveSentMessagePlaintext({ id: 'pm-sent', chatId: 'a:b', plaintext: 'hello', timestamp: now });

  await loadPrivateChats('a');
  const chat = get(privateChatStore).chats.get('a:b');
  expect(chat.messages).toHaveLength(1);
  expect(chat.messages[0].direction).toBe('sent');
  expect(chat.messages[0].text).toBe('hello');
  expect(chat.messages[0].sealed).toBe(false);
});

it('loadPrivateChats keeps received messages sealed until decrypt', async () => {
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
    id: 'pm-recv',
    chatId: 'a:b',
    direction: 'received',
    ciphertext: 'CT',
    iv: 'IV',
    timestamp: now,
    delivered: true
  });

  await loadPrivateChats('a');
  const chat = get(privateChatStore).chats.get('a:b');
  expect(chat.messages).toHaveLength(1);
  expect(chat.messages[0].direction).toBe('received');
  expect(chat.messages[0].text).toBeNull();
  expect(chat.messages[0].sealed).toBe(true);
});

it('decryptSealedMessages only decrypts received sealed messages (not sent)', async () => {
  hoisted.decryptForSessionMock.mockResolvedValueOnce('decrypted');
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
          messages: [
            { id: 'm-sent', direction: 'sent', text: 'hello', ciphertext: 'CT', iv: 'IV', timestamp: 1, delivered: false, sealed: false },
            { id: 'm-recv', direction: 'received', text: null, ciphertext: 'CT2', iv: 'IV2', timestamp: 2, delivered: true, sealed: true }
          ],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 2,
          isOnline: true,
          keyExchangeState: 'active',
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  await decryptSealedMessages('a:b', 'a:b');
  expect(hoisted.decryptForSessionMock).toHaveBeenCalledTimes(1);
  const chat = get(privateChatStore).chats.get('a:b');
  expect(chat.messages[0].text).toBe('hello');
  expect(chat.messages[1].text).toBe('decrypted');
  expect(chat.messages[1].sealed).toBe(false);
});

	it('decryptSealedMessages marks old-session failures with placeholder text', async () => {
	  const err = new Error('bad key');
	  err.name = 'OperationError';
	  hoisted.decryptForSessionMock.mockRejectedValueOnce(err);
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
          messages: [{ id: 'm-recv', direction: 'received', text: null, ciphertext: 'CT', iv: 'IV', timestamp: 2, delivered: true, sealed: true }],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 2,
          isOnline: true,
          keyExchangeState: 'active',
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

	  await decryptSealedMessages('a:b', 'a:b');
	  const chat = get(privateChatStore).chats.get('a:b');
	  expect(chat.messages[0].text).toMatch(/previous session/i);
	  expect(chat.messages[0].sealed).toBe(true);
	});

	it('decryptSealedMessages logs unexpected decrypt errors and does not label them as previous session', async () => {
	  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
	  hoisted.decryptForSessionMock.mockRejectedValueOnce(new TypeError('iv missing'));
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
	          messages: [{ id: 'm-recv', direction: 'received', text: null, ciphertext: 'CT', iv: 'IV', timestamp: 2, delivered: true, sealed: true }],
	          unreadCount: 0,
	          lastMessage: null,
	          lastActivity: 2,
	          isOnline: true,
	          keyExchangeState: 'active',
	          __loaded: true
	        }
	      ]
	    ]),
	    activeChatId: 'a:b',
	    pendingKeyExchanges: new Map()
	  });

	  await decryptSealedMessages('a:b', 'a:b');
	  const chat = get(privateChatStore).chats.get('a:b');
	  expect(chat.messages[0].text).toMatch(/decryption error/i);
	  expect(chat.messages[0].text).not.toMatch(/previous session/i);
	  expect(spy).toHaveBeenCalled();
	  expect(spy.mock.calls.some((c) => String(c[0]).includes('decryptSealedMessages decrypt failed'))).toBe(true);
	  expect(spy.mock.calls.some((c) => c.some((arg) => String(arg).includes('iv missing')))).toBe(true);
	  spy.mockRestore();
	});

it('ConfirmDialog handles keydown and does not throw after destruction', async () => {
  const { component, unmount } = render(ConfirmDialog, {
    props: { title: 'Delete?', message: 'Sure?' }
  });

  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  component.$on('confirm', onConfirm);
  component.$on('cancel', onCancel);

  await fireEvent.keyDown(window, { key: 'Enter' });
  expect(onConfirm).toHaveBeenCalledTimes(1);

  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);

  unmount();
  await expect(fireEvent.keyDown(window, { key: 'Escape' })).resolves.toBe(true);
});

it('deletePrivateChat (db) does not throw for non-existent chatId', async () => {
  await expect(deletePrivateChat('missing-chat')).resolves.toBeUndefined();
});
