import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

class MockConn {
  constructor(peerId, options) {
    this.peer = peerId;
    this.options = options;
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
  static ctorCalls = [];
  static instances = [];

  constructor(id, options) {
    this.id = id;
    this.options = options;
    this._handlers = new Map();
    this._connections = [];
    this.destroy = vi.fn();
    this.reconnect = vi.fn();
    MockPeer.ctorCalls.push({ id, options });
    MockPeer.instances.push(this);
  }

  on(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    arr.push(cb);
    this._handlers.set(event, arr);
  }

  off(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    this._handlers.set(
      event,
      arr.filter((x) => x !== cb)
    );
  }

  emit(event, payload) {
    const arr = this._handlers.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }

  connect(peerId, options) {
    const conn = new MockConn(peerId, options);
    this._connections.push(conn);
    return conn;
  }
}

const hoisted = vi.hoisted(() => {
  return {
    addGlobalMessageMock: vi.fn().mockResolvedValue(undefined),
    saveKnownPeerMock: vi.fn().mockResolvedValue(undefined),
    getGlobalMessagesMock: vi.fn().mockResolvedValue([]),
    getFullUsernameRegistryMock: vi.fn().mockResolvedValue([]),
    registerUsernameLocallyMock: vi.fn().mockResolvedValue(undefined),
    isUsernameTakenMock: vi.fn().mockResolvedValue(false),
    mergeUsernameRegistryMock: vi.fn().mockResolvedValue(undefined),
    sharedKeyStub: { __shared: true },
    decryptMessageMock: vi.fn().mockResolvedValue('plaintext')
  };
});

vi.mock('peerjs', () => {
  return { Peer: MockPeer, default: MockPeer };
});

vi.mock('$lib/stores/chatStore.js', () => {
  return {
    addGlobalMessage: (...args) => hoisted.addGlobalMessageMock(...args)
  };
});

vi.mock('$lib/services/db.js', () => {
  return {
    saveKnownPeer: (...args) => hoisted.saveKnownPeerMock(...args),
    getGlobalMessages: (...args) => hoisted.getGlobalMessagesMock(...args),
    getFullUsernameRegistry: (...args) => hoisted.getFullUsernameRegistryMock(...args),
    registerUsernameLocally: (...args) => hoisted.registerUsernameLocallyMock(...args),
    isUsernameTaken: (...args) => hoisted.isUsernameTakenMock(...args),
    mergeUsernameRegistry: (...args) => hoisted.mergeUsernameRegistryMock(...args)
  };
});

vi.mock('$lib/services/crypto.js', () => {
  return {
    generateKeyPair: vi.fn().mockResolvedValue({ publicKey: { __pk: true }, privateKey: { __sk: true } }),
    exportPublicKey: vi.fn().mockResolvedValue('PUBKEY_BASE64'),
    importPublicKey: vi.fn().mockResolvedValue({ __remotePk: true }),
    deriveSharedSecret: vi.fn().mockResolvedValue(hoisted.sharedKeyStub),
    encryptMessage: vi.fn().mockResolvedValue({ ciphertext: 'CIPH', iv: 'IV' }),
    decryptMessage: (...args) => hoisted.decryptMessageMock(...args)
  };
});

import {
  LOBBY_PEER_ID,
  attemptReconnect,
  becomeLobbyHost,
  broadcastGlobalMessage,
  disconnectPeer,
  handleMessage,
  initPeer,
  joinLobby,
  validateProtocolMessage
} from '$lib/services/peer.js';

const me = { username: 'alice', color: 'hsl(1, 65%, 65%)', age: 22, avatarBase64: 'data:image/png;base64,AAAA' };

beforeEach(() => {
  MockPeer.ctorCalls = [];
  MockPeer.instances = [];
  hoisted.addGlobalMessageMock.mockClear();
  hoisted.saveKnownPeerMock.mockClear();
  hoisted.getGlobalMessagesMock.mockClear();
  hoisted.getFullUsernameRegistryMock.mockClear();
  hoisted.registerUsernameLocallyMock.mockClear();
  hoisted.isUsernameTakenMock.mockClear();
  hoisted.mergeUsernameRegistryMock.mockClear();
  hoisted.decryptMessageMock.mockClear();

  // Provide cached PeerJS module for becomeLobbyHost.
  globalThis._PeerJS = { Peer: MockPeer, default: MockPeer };

  peerStore.set({
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

afterEach(() => {
  disconnectPeer();
  vi.useRealTimers();
  // @ts-ignore
  delete globalThis._PeerJS;
});

it('initPeer creates a Peer with a random UUID (not the lobby ID)', async () => {
  const p = await initPeer(me);
  expect(p).toBeInstanceOf(MockPeer);
  expect(MockPeer.ctorCalls.length).toBe(1);
  expect(MockPeer.ctorCalls[0].id).not.toBe(LOBBY_PEER_ID);
  expect(MockPeer.ctorCalls[0].options.host).toBe('0.peerjs.com');
  expect(MockPeer.ctorCalls[0].options.secure).toBe(true);
});

it('joinLobby resolves as guest when another peer is already hosting', async () => {
  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = joinLobby(localPeer, me);
  const lobbyConn = localPeer._connections.find((c) => c.peer === LOBBY_PEER_ID);
  expect(lobbyConn.options).toEqual({ reliable: true, metadata: { type: 'lobby-join' } });

  lobbyConn.emit('open');
  const res = await promise;
  expect(res.role).toBe('guest');
  expect(lobbyConn.send).toHaveBeenCalledTimes(1);
  expect(lobbyConn.send.mock.calls[0][0].type).toBe('LOBBY_JOIN');
});

it('joinLobby resolves as host when lobby ID is available', async () => {
  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = joinLobby(localPeer, me);
  const lobbyConn = localPeer._connections.find((c) => c.peer === LOBBY_PEER_ID);
  lobbyConn.emit('error', { type: 'peer-unavailable' });

  // becomeLobbyHost created a lobby peer; open it.
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  expect(hostPeer).toBeTruthy();
  hostPeer.emit('open', LOBBY_PEER_ID);

  const res = await promise;
  expect(res.role).toBe('host');
  expect(get(peerStore).isLobbyHost).toBe(true);
});

it('joinLobby resolves as host after timeout (no response in 4s)', async () => {
  vi.useFakeTimers();
  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = joinLobby(localPeer, me);
  // no open/error => timeout
  await vi.advanceTimersByTimeAsync(4000);

  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('open', LOBBY_PEER_ID);
  const res = await promise;

  expect(res.role).toBe('host');
});

it('Race condition: if LOBBY_ID is taken, retries as guest after jitter delay', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0); // jitter = 1000ms

  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = joinLobby(localPeer, me);

  // First attempt: lobby connect errors -> becomeLobbyHost -> unavailable-id
  const firstLobbyConn = localPeer._connections.find((c) => c.peer === LOBBY_PEER_ID);
  firstLobbyConn.emit('error', { type: 'peer-unavailable' });

  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('error', { type: 'unavailable-id' });

  // After jitter, joinLobby is retried; open the second lobby connection.
  await vi.advanceTimersByTimeAsync(1000);
  const secondLobbyConn = localPeer._connections.filter((c) => c.peer === LOBBY_PEER_ID)[1];
  expect(secondLobbyConn).toBeTruthy();
  secondLobbyConn.emit('open');

  const res = await promise;
  expect(res.role).toBe('guest');
});

it("becomeLobbyHost handles 'unavailable-id' error without crashing", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);

  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = becomeLobbyHost(localPeer, me, 0);
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('error', { type: 'unavailable-id' });

  // It will retry joinLobby after jitter; open that connection.
  await vi.advanceTimersByTimeAsync(1000);
  const lobbyConn = localPeer._connections.find((c) => c.peer === LOBBY_PEER_ID);
  lobbyConn.emit('open');

  const res = await promise;
  expect(res.role).toBe('guest');
});

it('Lobby host sends NETWORK_STATE on receiving LOBBY_JOIN', async () => {
  hoisted.getGlobalMessagesMock.mockResolvedValueOnce([
    { peerId: 'p1', username: 'x', age: 1, color: 'hsl(3, 65%, 65%)', text: 'hello', timestamp: 10 }
  ]);

  const localPeer = new MockPeer('local-main', {});
  peerStore.set({
    peerId: 'local-main',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map()
  });

  const promise = becomeLobbyHost(localPeer, me, 0);
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('open');
  await promise;

  // Simulate a guest connecting to the lobby peer.
  const guestConn = new MockConn('guest-main', {});
  hostPeer.emit('connection', guestConn);

  const joinMsg = {
    type: 'LOBBY_JOIN',
    from: { peerId: 'guest-main', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
    payload: {},
    timestamp: Date.now()
  };
  guestConn.emit('data', joinMsg);
  await flushMicrotasks();

  expect(guestConn.send).toHaveBeenCalled();
  const sent = guestConn.send.mock.calls.map((c) => c[0]).find((m) => m.type === 'NETWORK_STATE');
  expect(sent).toBeTruthy();
  expect(Array.isArray(sent.payload.peers)).toBe(true);
  expect(Array.isArray(sent.payload.globalHistory)).toBe(true);
});

it('Lobby host broadcasts NEW_PEER to existing peers', async () => {
  const existingSend = vi.fn();

  const localPeer = new MockPeer('local-main', {});
  peerStore.set({
    peerId: 'local-main',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map([['p2', { username: 'carol', color: 'hsl(10, 65%, 65%)', age: 44, connection: { send: existingSend } }]])
  });

  const promise = becomeLobbyHost(localPeer, me, 0);
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('open');
  await promise;

  const guestConn = new MockConn('guest-main', {});
  hostPeer.emit('connection', guestConn);
  guestConn.emit('data', {
    type: 'LOBBY_JOIN',
    from: { peerId: 'guest-main', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
    payload: {},
    timestamp: Date.now()
  });

  await flushMicrotasks();
  expect(existingSend).toHaveBeenCalled();
  const broadcast = existingSend.mock.calls.map((c) => c[0]).find((m) => m.type === 'NEW_PEER');
  expect(broadcast).toBeTruthy();
  expect(broadcast.type).toBe('NEW_PEER');
  expect(broadcast.payload.newPeer.peerId).toBe('guest-main');
});

it('handleMessage routes GLOBAL_MSG to globalMessages store (via addGlobalMessage)', async () => {
  const conn = new MockConn('p2');
  const msg = {
    type: 'GLOBAL_MSG',
    from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
    payload: { message: { id: 'm-1', text: 'hi', timestamp: 123 } },
    timestamp: 123
  };
  await handleMessage(msg, conn, me);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledTimes(1);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledWith({
    id: 'm-1',
    peerId: 'p2',
    username: 'bob',
    age: 33,
    color: 'hsl(2, 65%, 65%)',
    text: 'hi',
    timestamp: 123
  });
});

it('handleMessage routes PRIVATE_MSG through decryption', async () => {
  // Need a local peerId so PRIVATE_KEY_EXCHANGE replies back with our key.
  peerStore.update((s) => ({ ...s, peerId: 'local', isConnected: true, connectionState: 'connected' }));

  const conn = new MockConn('p2');
  await handleMessage(
    {
      type: 'PRIVATE_KEY_EXCHANGE',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      payload: { publicKey: 'REMOTE_PUBKEY' },
      timestamp: 1
    },
    conn,
    me
  );

  await handleMessage(
    {
      type: 'PRIVATE_MSG',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      payload: { ciphertext: 'CIPH', iv: 'IV' },
      timestamp: 2
    },
    conn,
    me
  );

  expect(hoisted.decryptMessageMock).toHaveBeenCalledTimes(1);
  expect(hoisted.decryptMessageMock).toHaveBeenCalledWith(hoisted.sharedKeyStub, 'CIPH', 'IV');
});

it('broadcastGlobalMessage adds message before sending (optimistic)', async () => {
  let added = false;
  hoisted.addGlobalMessageMock.mockImplementationOnce(async () => {
    added = true;
  });

  const send = vi.fn(() => {
    expect(added).toBe(true);
  });

  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, connection: { send } }]])
  });

  await broadcastGlobalMessage(' hello ', me);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
});

it('broadcastGlobalMessage generates a UUID id for each message', async () => {
  const send = vi.fn();
  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, connection: { send } }]])
  });

  await broadcastGlobalMessage('hi', me);
  const added = hoisted.addGlobalMessageMock.mock.calls[0][0];
  expect(typeof added.id).toBe('string');
  expect(added.id.length).toBeGreaterThan(10);
  expect(added.id).toMatch(/^[0-9a-f-]{16,}$/i);
});

it('Two messages created at the same millisecond have different IDs', async () => {
  const send = vi.fn();
  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, connection: { send } }]])
  });

  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
  const spy = vi
    .spyOn(globalThis.crypto, 'randomUUID')
    .mockImplementationOnce(() => 'uuid-1')
    .mockImplementationOnce(() => 'uuid-2');

  await broadcastGlobalMessage('a', me);
  await broadcastGlobalMessage('b', me);

  const first = hoisted.addGlobalMessageMock.mock.calls[0][0];
  const second = hoisted.addGlobalMessageMock.mock.calls[1][0];
  expect(first.id).toBe('uuid-1');
  expect(second.id).toBe('uuid-2');
  expect(first.id).not.toBe(second.id);

  spy.mockRestore();
  nowSpy.mockRestore();
});

it('Reconnect is attempted up to 3 times on unexpected disconnect', async () => {
  vi.useFakeTimers();

  const p = new MockPeer('local', {});
  // Never emit 'open' => each attempt should time out and try again.
  const promise = attemptReconnect(p, me, 0);

  // 2s + 1.5s open wait
  await vi.advanceTimersByTimeAsync(3500);
  expect(p.reconnect).toHaveBeenCalledTimes(1);
  expect(get(peerStore).connectionState).toBe('reconnecting');

  // 5s + 1.5s open wait
  await vi.advanceTimersByTimeAsync(6500);
  expect(p.reconnect).toHaveBeenCalledTimes(2);

  // 10s + 1.5s open wait
  await vi.advanceTimersByTimeAsync(11500);
  expect(p.reconnect).toHaveBeenCalledTimes(3);

  await promise;
  expect(get(peerStore).connectionState).toBe('failed');
});

it('handleMessage ignores malformed messages (missing required envelope fields)', async () => {
  const conn = new MockConn('p2');
  await handleMessage({ not: 'a valid envelope' }, conn, me);
  expect(hoisted.addGlobalMessageMock).not.toHaveBeenCalled();
  expect(hoisted.saveKnownPeerMock).not.toHaveBeenCalled();
  expect(hoisted.decryptMessageMock).not.toHaveBeenCalled();
});

it('Message protocol shape is validated correctly', () => {
  const good = {
    type: 'GLOBAL_MSG',
    from: { username: 'alice', peerId: 'p1', color: 'hsl(1, 65%, 65%)', age: 22 },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };
  const bad = {
    type: 'GLOBAL_MSG',
    from: { username: '', peerId: 'p1', color: 'x', age: 22 },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };

  expect(validateProtocolMessage(good)).toBe(true);
  expect(validateProtocolMessage(bad)).toBe(false);
});
