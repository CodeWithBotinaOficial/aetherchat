import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

class MockConn {
  constructor(peerId) {
    this.peer = peerId;
    this.send = vi.fn();
    this.close = vi.fn();
    this._handlers = new Map();
  }
  on(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    arr.push(cb);
    this._handlers.set(event, arr);
  }
  emit(event, payload) {
    const arr = this._handlers.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }
}

class MockPeer {
  static instances = [];
  constructor(id, options) {
    this.id = id;
    this.options = options;
    this._handlers = new Map();
    this.destroy = vi.fn();
    MockPeer.instances.push(this);
  }
  on(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    arr.push(cb);
    this._handlers.set(event, arr);
  }
  emit(event, payload) {
    const arr = this._handlers.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }
  connect(peerId) {
    return new MockConn(peerId);
  }
}

const hoisted = vi.hoisted(() => {
  return {
    getGlobalMessagesMock: vi.fn().mockResolvedValue([]),
    getFullUsernameRegistryMock: vi.fn().mockResolvedValue([]),
    registerUsernameLocallyMock: vi.fn().mockResolvedValue(undefined),
    isUsernameTakenMock: vi.fn().mockResolvedValue(false),
    mergeUsernameRegistryMock: vi.fn().mockResolvedValue(undefined),
    saveKnownPeerMock: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('peerjs', () => {
  return { Peer: MockPeer, default: MockPeer };
});

vi.mock('$lib/stores/chatStore.js', () => {
  return {
    addGlobalMessage: vi.fn().mockResolvedValue(undefined),
    globalMessages: { set: vi.fn() }
  };
});

vi.mock('$lib/services/db.js', () => {
  return {
    db: {
      globalMessages: { orderBy: () => ({ last: vi.fn().mockResolvedValue(null) }) },
      usernameRegistry: { count: vi.fn().mockResolvedValue(0) }
    },
    saveKnownPeer: (...args) => hoisted.saveKnownPeerMock(...args),
    getGlobalMessages: (...args) => hoisted.getGlobalMessagesMock(...args),
    getFullUsernameRegistry: (...args) => hoisted.getFullUsernameRegistryMock(...args),
    registerUsernameLocally: (...args) => hoisted.registerUsernameLocallyMock(...args),
    isUsernameTaken: (...args) => hoisted.isUsernameTakenMock(...args),
    mergeUsernameRegistry: (...args) => hoisted.mergeUsernameRegistryMock(...args),

    upsertPrivateChat: vi.fn().mockResolvedValue(undefined),
    savePrivateMessage: vi.fn().mockResolvedValue(undefined),
    updateChatLastActivity: vi.fn().mockResolvedValue(undefined),
    markMessageDelivered: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('$lib/services/crypto.js', () => {
  const buildSessionId = (a, b) => [a, b].sort().join(':');
  return {
    buildSessionId,
    isSessionActive: vi.fn().mockReturnValue(false),
    resumeSession: vi.fn().mockResolvedValue(false),
    createSession: vi.fn().mockResolvedValue({ sessionId: buildSessionId('a', 'b'), publicKeyBase64: 'PUB' }),
    completeSession: vi.fn().mockResolvedValue({ sessionId: buildSessionId('a', 'b'), publicKeyBase64: 'PUB2' }),
    encryptForSession: vi.fn().mockResolvedValue({ ciphertext: 'C', iv: 'I' }),
    decryptForSession: vi.fn().mockResolvedValue('x'),
    closeSession: vi.fn(),
    closeAllSessions: vi.fn(),
    generateKeyPair: vi.fn(),
    exportPublicKey: vi.fn(),
    importPublicKey: vi.fn(),
    deriveSharedSecret: vi.fn(),
    encryptMessage: vi.fn(),
    decryptMessage: vi.fn()
  };
});

import { LOBBY_PEER_ID, __test as peerTest, disconnectPeer, handleMessage } from '$lib/services/peer.js';

const me = { username: 'alice', color: 'hsl(1, 65%, 65%)', age: 22 };

beforeEach(() => {
  MockPeer.instances = [];
  globalThis._PeerJS = { Peer: MockPeer, default: MockPeer };

  peerStore.set({
    peerId: null,
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map()
  });
});

afterEach(() => {
  disconnectPeer();
  // @ts-ignore
  delete globalThis._PeerJS;
  vi.useRealTimers();
});

it('electNewLobbyHost selects the alphabetically lowest peerId', async () => {
  peerStore.update((s) => ({
    ...s,
    peerId: 'b',
    connectedPeers: new Map([['a', { username: 'a', color: 'x', age: 1, connection: { send: vi.fn() } }]])
  }));
  peerTest.setMainPeerForTest(new MockPeer('b', {}));
  peerTest.setProfileForTest(me);

  peerTest.electNewLobbyHostForTest();
  expect(MockPeer.instances.some((p) => p.id === LOBBY_PEER_ID)).toBe(false);
});

it('electNewLobbyHost calls becomeLobbyHost only when elected peer is self', async () => {
  peerStore.update((s) => ({
    ...s,
    peerId: 'a',
    connectedPeers: new Map([['b', { username: 'b', color: 'x', age: 1, connection: { send: vi.fn() } }]])
  }));
  peerTest.setMainPeerForTest(new MockPeer('a', {}));
  peerTest.setProfileForTest(me);

  peerTest.electNewLobbyHostForTest();
  expect(MockPeer.instances.some((p) => p.id === LOBBY_PEER_ID)).toBe(true);
});

it('PEER_DISCONNECT from lobby host triggers re-election', async () => {
  vi.useFakeTimers();
  const remainingSend = vi.fn();

  peerStore.set({
    peerId: 'a',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: 'host',
    connectedPeers: new Map([
      ['host', { username: 'host', color: 'x', age: 1, connection: { send: vi.fn() } }],
      ['b', { username: 'b', color: 'x', age: 1, connection: { send: remainingSend } }]
    ])
  });

  peerTest.setMainPeerForTest(new MockPeer('a', {}));
  peerTest.setProfileForTest(me);

  await handleMessage(
    {
      type: 'PEER_DISCONNECT',
      from: { peerId: 'host', username: 'host', color: 'hsl(2, 65%, 65%)', age: 33 },
      payload: {},
      timestamp: 1
    },
    null,
    me
  );

  await vi.advanceTimersByTimeAsync(2000);

  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  expect(hostPeer).toBeTruthy();
  hostPeer.emit('open');

  // After becoming host, we broadcast the new lobby host id to peers.
  expect(remainingSend).toHaveBeenCalled();
  expect(remainingSend.mock.calls.some((c) => c[0]?.type === 'LOBBY_HOST_CHANGED')).toBe(true);
});

it('PEER_DISCONNECT from non-host peer does NOT trigger re-election', async () => {
  vi.useFakeTimers();
  peerStore.set({
    peerId: 'a',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: 'host',
    connectedPeers: new Map([
      ['host', { username: 'host', color: 'x', age: 1, connection: { send: vi.fn() } }],
      ['b', { username: 'b', color: 'x', age: 1, connection: { send: vi.fn() } }]
    ])
  });
  peerTest.setMainPeerForTest(new MockPeer('a', {}));
  peerTest.setProfileForTest(me);

  await handleMessage(
    {
      type: 'PEER_DISCONNECT',
      from: { peerId: 'b', username: 'b', color: 'hsl(2, 65%, 65%)', age: 33 },
      payload: {},
      timestamp: 1
    },
    null,
    me
  );

  await vi.advanceTimersByTimeAsync(2500);
  expect(MockPeer.instances.some((p) => p.id === LOBBY_PEER_ID)).toBe(false);
});

it('New lobby host broadcasts LOBBY_HOST_CHANGED after election', async () => {
  const send = vi.fn();
  peerStore.set({
    peerId: 'a',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: 'old-host',
    connectedPeers: new Map([['p2', { username: 'bob', color: 'x', age: 1, connection: { send } }]])
  });
  peerTest.setMainPeerForTest(new MockPeer('a', {}));
  peerTest.setProfileForTest(me);

  peerTest.electNewLobbyHostForTest();
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('open');

  expect(send).toHaveBeenCalled();
  expect(send.mock.calls[0][0].type).toBe('LOBBY_HOST_CHANGED');
  expect(get(peerStore).currentLobbyHostId).toBe('a');
});
