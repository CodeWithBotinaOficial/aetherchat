import { get } from 'svelte/store';
import { db, isUsernameTaken } from '$lib/services/db.js';
import { globalMessages as globalMessagesStore } from '$lib/stores/chatStore.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { __test as peerTest, disconnectPeer, handleMessage } from '$lib/services/peer.js';

class StubConn {
  constructor(peerId) {
    this.peer = peerId;
    this._handlers = new Map();
    this.send = vi.fn();
    this.close = vi.fn();
  }
  on(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    arr.push(cb);
    this._handlers.set(event, arr);
  }
}

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

const localProfile = { username: 'local', color: 'hsl(1, 65%, 65%)', age: 22 };

beforeEach(async () => {
  await clearAllTables();
  globalMessagesStore.set([]);
  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map()
  });

  // Provide a stub "mainPeer" so NETWORK_STATE can attempt direct connects.
  peerTest.setMainPeerForTest({
    id: 'local',
    connect: vi.fn((peerId) => new StubConn(peerId))
  });
});

afterEach(() => {
  disconnectPeer();
});

it('handleNetworkState merges messages without duplicates', async () => {
  const payload = {
    peers: [],
    usernameRegistry: [],
    globalHistory: [
      { id: 'm-1', peerId: 'p1', username: 'a', age: 1, color: 'hsl(2, 65%, 65%)', text: 'one', timestamp: 10 },
      { id: 'm-2', peerId: 'p1', username: 'a', age: 1, color: 'hsl(2, 65%, 65%)', text: 'two', timestamp: 20 }
    ]
  };

  await handleMessage(
    { type: 'NETWORK_STATE', from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', age: 1 }, payload, timestamp: 1 },
    null,
    localProfile
  );
  await handleMessage(
    { type: 'NETWORK_STATE', from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', age: 1 }, payload, timestamp: 2 },
    null,
    localProfile
  );

  const all = await db.globalMessages.toArray();
  expect(all).toHaveLength(2);
});

it('handleNetworkState merges usernameRegistry correctly', async () => {
  const payload = {
    peers: [],
    usernameRegistry: [{ username: 'alice', peerId: 'p1', registeredAt: 1, lastSeenAt: 2 }],
    globalHistory: []
  };

  await handleMessage(
    { type: 'NETWORK_STATE', from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', age: 1 }, payload, timestamp: 1 },
    null,
    localProfile
  );

  expect(await isUsernameTaken('Alice')).toBe(true);
});

it('handleNetworkState connects to all peers in the list', async () => {
  const mainPeer = { id: 'local', connect: vi.fn((peerId) => new StubConn(peerId)) };
  peerTest.setMainPeerForTest(mainPeer);

  const payload = {
    peers: [
      { peerId: 'local', username: 'local', color: 'hsl(1, 65%, 65%)', age: 22 },
      { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      { peerId: 'p3', username: 'carol', color: 'hsl(3, 65%, 65%)', age: 1 }
    ],
    usernameRegistry: [],
    globalHistory: []
  };

  await handleMessage(
    { type: 'NETWORK_STATE', from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', age: 1 }, payload, timestamp: 1 },
    null,
    localProfile
  );

  expect(mainPeer.connect).toHaveBeenCalledWith('p2');
  expect(mainPeer.connect).toHaveBeenCalledWith('p3');
});

it('STATE_DIGEST triggers SYNC_REQUEST when remote has newer messages', async () => {
  await db.globalMessages.add({ id: 'm-old', peerId: 'p1', username: 'a', age: 1, color: 'hsl(2, 65%, 65%)', text: 'old', timestamp: 10 });

  const send = vi.fn();
  peerStore.update((s) => ({
    ...s,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1, connection: { send } }]])
  }));

  await handleMessage(
    {
      type: 'STATE_DIGEST',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: { latestGlobalMsgTimestamp: 999, usernameRegistryCount: 0, peerId: 'p2' },
      timestamp: 1
    },
    null,
    localProfile
  );

  const sent = send.mock.calls[0][0];
  expect(sent.type).toBe('SYNC_REQUEST');
  expect(sent.payload.sinceTimestamp).toBe(10);
});

it('STATE_DIGEST does NOT trigger SYNC_REQUEST when local is up to date', async () => {
  await db.globalMessages.add({ id: 'm-new', peerId: 'p1', username: 'a', age: 1, color: 'hsl(2, 65%, 65%)', text: 'new', timestamp: 100 });

  const send = vi.fn();
  peerStore.update((s) => ({
    ...s,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1, connection: { send } }]])
  }));

  await handleMessage(
    {
      type: 'STATE_DIGEST',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: { latestGlobalMsgTimestamp: 50, usernameRegistryCount: 0, peerId: 'p2' },
      timestamp: 1
    },
    null,
    localProfile
  );

  expect(send).not.toHaveBeenCalled();
});

it('SYNC_REQUEST response contains only messages after sinceTimestamp', async () => {
  await db.globalMessages.add({ id: 'm-10', peerId: 'p1', username: 'a', age: 1, color: 'hsl(2, 65%, 65%)', text: '10', timestamp: 10 });
  await db.globalMessages.add({ id: 'm-20', peerId: 'p1', username: 'a', age: 1, color: 'hsl(2, 65%, 65%)', text: '20', timestamp: 20 });
  await db.globalMessages.add({ id: 'm-30', peerId: 'p1', username: 'a', age: 1, color: 'hsl(2, 65%, 65%)', text: '30', timestamp: 30 });

  const send = vi.fn();
  peerStore.update((s) => ({
    ...s,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1, connection: { send } }]])
  }));

  await handleMessage(
    {
      type: 'SYNC_REQUEST',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: { sinceTimestamp: 20, knownUsernames: [] },
      timestamp: 1
    },
    null,
    localProfile
  );

  const sent = send.mock.calls[0][0];
  expect(sent.type).toBe('SYNC_RESPONSE');
  expect(sent.payload.newMessages.map((m) => m.timestamp)).toEqual([30]);
});

it('SYNC_RESPONSE merges new messages into DB and updates store', async () => {
  expect(get(globalMessagesStore)).toHaveLength(0);
  await handleMessage(
    {
      type: 'SYNC_RESPONSE',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: {
        newMessages: [{ id: 'm-99', peerId: 'p2', username: 'bob', age: 1, color: 'hsl(2, 65%, 65%)', text: 'hi', timestamp: 55 }],
        registryEntries: []
      },
      timestamp: 1
    },
    null,
    localProfile
  );

  expect((await db.globalMessages.toArray()).length).toBe(1);
  expect(get(globalMessagesStore).some((m) => m.text === 'hi')).toBe(true);
});

it('SYNC_RESPONSE does not create duplicates on repeated sync', async () => {
  const msg = { id: 'm-99', peerId: 'p2', username: 'bob', age: 1, color: 'hsl(2, 65%, 65%)', text: 'hi', timestamp: 55 };
  const envelope = {
    type: 'SYNC_RESPONSE',
    from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
    payload: { newMessages: [msg], registryEntries: [] },
    timestamp: 1
  };

  await handleMessage(envelope, null, localProfile);
  await handleMessage(envelope, null, localProfile);
  expect((await db.globalMessages.toArray()).length).toBe(1);
});
