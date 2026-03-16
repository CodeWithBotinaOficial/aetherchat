import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

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
  static ctorCalls = [];

  constructor(id, options) {
    this.id = id;
    this.options = options;
    this._handlers = new Map();
    this._connections = [];
    this.destroy = vi.fn();
    this.reconnect = vi.fn();
    MockPeer.ctorCalls.push({ id, options });
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

  connect(peerId) {
    const conn = new MockConn(peerId);
    this._connections.push(conn);
    return conn;
  }
}

const hoisted = vi.hoisted(() => {
  return {
    addGlobalMessageMock: vi.fn().mockResolvedValue(undefined),
    saveKnownPeerMock: vi.fn().mockResolvedValue(undefined),
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
  return { saveKnownPeer: (...args) => hoisted.saveKnownPeerMock(...args) };
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
  broadcastGlobalMessage,
  disconnectPeer,
  handleMessage,
  initPeer,
  validateProtocolMessage
} from '$lib/services/peer.js';

const me = { username: 'alice', color: 'hsl(1, 65%, 65%)', age: 22, avatarBase64: 'data:image/png;base64,AAAA' };

beforeEach(() => {
  MockPeer.ctorCalls = [];
  hoisted.addGlobalMessageMock.mockClear();
  hoisted.saveKnownPeerMock.mockClear();
  hoisted.decryptMessageMock.mockClear();

  peerStore.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    connectedPeers: new Map()
  });
});

afterEach(() => {
  disconnectPeer();
  vi.useRealTimers();
});

it('initPeer creates a Peer with a random UUID (not the lobby ID)', async () => {
  const p = await initPeer(me);
  expect(p).toBeInstanceOf(MockPeer);
  expect(MockPeer.ctorCalls.length).toBe(1);
  expect(MockPeer.ctorCalls[0].id).not.toBe(LOBBY_PEER_ID);
  expect(MockPeer.ctorCalls[0].options.host).toBe('0.peerjs.com');
  expect(MockPeer.ctorCalls[0].options.secure).toBe(true);
});

it('joinLobby sends HANDSHAKE on successful connection', async () => {
  const p = await initPeer(me);
  p.emit('open', p.id);

  // joinLobby calls connect(LOBBY_PEER_ID) synchronously
  const lobby = p._connections.find((c) => c.peer === LOBBY_PEER_ID);
  expect(lobby).toBeTruthy();

  lobby.emit('open');
  await flushMicrotasks();

  expect(lobby.send).toHaveBeenCalledTimes(1);
  const sent = lobby.send.mock.calls[0][0];
  expect(sent.type).toBe('HANDSHAKE');
  expect(sent.from.username).toBe(me.username);
  expect(sent.payload.publicKey).toBe('PUBKEY_BASE64');
});

it('handleMessage routes GLOBAL_MSG to globalMessages store (via addGlobalMessage)', async () => {
  const conn = new MockConn('p2');
  const msg = {
    type: 'GLOBAL_MSG',
    from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
    payload: { text: 'hi' },
    timestamp: 123
  };
  await handleMessage(msg, conn, me);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledTimes(1);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledWith({
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, connection: { send } }]])
  });

  await broadcastGlobalMessage(' hello ', me);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
});

it('disconnectPeer broadcasts PEER_DISCONNECT before closing connections', async () => {
  await initPeer(me); // sets cached profile inside the service module

  const events = [];
  const conn = {
    send: vi.fn(() => events.push('send')),
    close: vi.fn(() => events.push('close'))
  };

  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, connection: conn }]])
  });

  disconnectPeer();
  expect(events[0]).toBe('send');
  expect(events[1]).toBe('close');
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
