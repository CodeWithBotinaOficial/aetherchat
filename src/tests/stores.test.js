import { get } from 'svelte/store';
import { db } from '$lib/services/db.js';
import { addGlobalMessage, globalMessages } from '$lib/stores/chatStore.js';
import { peer } from '$lib/stores/peerStore.js';
import { clearUser, isRegistered, registerUser, user } from '$lib/stores/userStore.js';

beforeEach(async () => {
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

  await clearUser();
  globalMessages.set([]);
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
});

it('userStore initializes as null', () => {
  expect(get(user)).toBeNull();
});

it('registerUser updates the store with correct shape', async () => {
  await registerUser('alice', 22, 'data:image/png;base64,abc');
  const u = get(user);
  expect(u).not.toBeNull();
  expect(u?.username).toBe('alice');
  expect(u?.age).toBe(22);
  expect(typeof u?.color).toBe('string');
  expect(u?.color.length).toBeGreaterThan(0);
  expect(u?.avatarBase64).toContain('data:image/png;base64');
  expect(typeof u?.createdAt).toBe('number');
});

it('isRegistered derived store is false when user is null', () => {
  expect(get(isRegistered)).toBe(false);
});

it('isRegistered derived store is true after registerUser', async () => {
  await registerUser('alice', 22, 'data:image/png;base64,abc');
  expect(get(isRegistered)).toBe(true);
});

it('globalMessages starts as empty array', () => {
  expect(get(globalMessages)).toEqual([]);
});

it('addGlobalMessage appends to the array', async () => {
  await addGlobalMessage({
    peerId: 'peer-1',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'hello',
    timestamp: Date.now()
  });
  expect(get(globalMessages)).toHaveLength(1);
});

it('peerStore initializes with isConnected: false', () => {
  const p = get(peer);
  expect(p.isConnected).toBe(false);
  expect(p.peerId).toBeNull();
});
