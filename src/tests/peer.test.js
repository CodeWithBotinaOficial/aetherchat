import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

class MockConn {
  constructor(peerId, options) {
    this.peer = peerId;
    this.options = options;
    this.open = false;
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
    if (event === 'open') this.open = true;
    if (event === 'close') this.open = false;
    const arr = this._handlers.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }
}

class MockPeer {
  static ctorCalls = [];
  static instances = [];

  constructor(idOrOptions, optionsMaybe) {
    // PeerJS constructor supports both:
    // 1) new Peer(id, options)
    // 2) new Peer(options) -> server assigns an ID
    const calledWithOptionsOnly =
      typeof optionsMaybe === 'undefined' && idOrOptions && typeof idOrOptions === 'object' && !Array.isArray(idOrOptions);

    this.id = calledWithOptionsOnly ? undefined : idOrOptions;
    this.options = calledWithOptionsOnly ? idOrOptions : optionsMaybe;
    this.disconnected = false;
    this.destroyed = false;
    this._handlers = new Map();
    this._connections = [];
    this.destroy = vi.fn();
    this.reconnect = vi.fn();
    MockPeer.ctorCalls.push({ id: this.id, options: this.options });
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
	    getKnownPeersMock: vi.fn().mockResolvedValue([]),
	    getGlobalMessagesMock: vi.fn().mockResolvedValue([]),
	    getFullUsernameRegistryMock: vi.fn().mockResolvedValue([]),
	    registerUsernameLocallyMock: vi.fn().mockResolvedValue(undefined),
	    isUsernameTakenMock: vi.fn().mockResolvedValue(false),
	    mergeUsernameRegistryMock: vi.fn().mockResolvedValue(undefined),
	    upsertPrivateChatMock: vi.fn().mockResolvedValue(undefined),
	    getPrivateChatMock: vi.fn().mockResolvedValue(null),
		    savePrivateMessageMock: vi.fn().mockResolvedValue(undefined),
		    saveSentMessagePlaintextMock: vi.fn().mockResolvedValue(undefined),
			    updateChatLastActivityMock: vi.fn().mockResolvedValue(undefined),
			    updateChatMetaMock: vi.fn().mockResolvedValue(undefined),
			    saveQueuedMessageMock: vi.fn().mockResolvedValue(undefined),
			    getQueuedMessagesForChatMock: vi.fn().mockResolvedValue([]),
			    deleteQueuedMessageMock: vi.fn().mockResolvedValue(undefined),
		    markMessageDeliveredMock: vi.fn().mockResolvedValue(undefined),
	    openChatMock: vi.fn(),
	    upsertChatEntryMock: vi.fn(),
	    setKeyExchangeStateMock: vi.fn(),
	    addOutgoingMessageMock: vi.fn(),
	    addIncomingMessageMock: vi.fn(),
	    deleteChatFromStoreMock: vi.fn().mockResolvedValue(undefined),
	    markDeliveredMock: vi.fn(),
	    updateMessageQueuedMock: vi.fn(),
	    privateChatStoreState: { chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() }
	  };
	});

vi.mock('peerjs', () => {
  return { Peer: MockPeer, default: MockPeer };
});

vi.mock('$lib/stores/chatStore.js', () => {
  return {
    addGlobalMessage: (...args) => hoisted.addGlobalMessageMock(...args),
    globalMessages: { set: vi.fn() }
  };
});

		vi.mock('$lib/services/db.js', () => {
	  const globalMessages = {
	    put: vi.fn().mockResolvedValue(undefined),
	    orderBy: vi.fn(() => ({ last: vi.fn().mockResolvedValue(null) }))
	  };
	  const usernameRegistry = { count: vi.fn().mockResolvedValue(0) };

	  return {
	    db: {
	      globalMessages,
	      usernameRegistry,
	      transaction: vi.fn(async (_mode, _table, fn) => fn())
	    },
	    saveKnownPeer: (...args) => hoisted.saveKnownPeerMock(...args),
	    getKnownPeers: (...args) => hoisted.getKnownPeersMock(...args),
	    getGlobalMessages: (...args) => hoisted.getGlobalMessagesMock(...args),
	    getFullUsernameRegistry: (...args) => hoisted.getFullUsernameRegistryMock(...args),
	    registerUsernameLocally: (...args) => hoisted.registerUsernameLocallyMock(...args),
	    isUsernameTaken: (...args) => hoisted.isUsernameTakenMock(...args),
	    mergeUsernameRegistry: (...args) => hoisted.mergeUsernameRegistryMock(...args),

		    upsertPrivateChat: (...args) => hoisted.upsertPrivateChatMock(...args),
		    getPrivateChat: (...args) => hoisted.getPrivateChatMock(...args),
		    savePrivateMessage: (...args) => hoisted.savePrivateMessageMock(...args),
		    saveSentMessagePlaintext: (...args) => hoisted.saveSentMessagePlaintextMock(...args),
			    updateChatLastActivity: (...args) => hoisted.updateChatLastActivityMock(...args),
			    updateChatMeta: (...args) => hoisted.updateChatMetaMock(...args),
			    saveQueuedMessage: (...args) => hoisted.saveQueuedMessageMock(...args),
			    getQueuedMessagesForChat: (...args) => hoisted.getQueuedMessagesForChatMock(...args),
			    deleteQueuedMessage: (...args) => hoisted.deleteQueuedMessageMock(...args),
		    markMessageDelivered: (...args) => hoisted.markMessageDeliveredMock(...args)
		  };
		});

vi.mock('$lib/services/crypto.js', () => {
  const buildSessionId = (a, b) => [a, b].sort().join(':');
  return {
    buildSessionId,
    isSessionActive: vi.fn().mockReturnValue(false),
    resumeSession: vi.fn().mockResolvedValue(false),
    createSession: vi.fn(async (a, b) => ({ sessionId: buildSessionId(a, b), publicKeyBase64: 'OUR_PUB_EX' })),
    completeSession: vi.fn(async (a, b) => ({ sessionId: buildSessionId(a, b), publicKeyBase64: 'OUR_PUB_EX_ACK' })),
    encryptForSession: vi.fn().mockResolvedValue({ ciphertext: 'CIPH', iv: 'IV' }),
    decryptForSession: vi.fn().mockResolvedValue('hello'),
    closeSession: vi.fn(),
    closeAllSessions: vi.fn(),

    generateKeyPair: vi.fn().mockResolvedValue({ publicKey: { __pk: true }, privateKey: { __sk: true } }),
    exportPublicKey: vi.fn().mockResolvedValue('PUBKEY_BASE64'),
    // legacy exports that peer.js no longer uses but may be imported in older tests.
    importPublicKey: vi.fn().mockResolvedValue({ __remotePk: true })
  };
});

	vi.mock('$lib/stores/privateChatStore.js', () => {
	  return {
	    privateChatStore: {
	      subscribe(run) {
	        run(hoisted.privateChatStoreState);
	        return () => {};
	      }
	    },
	    openChat: (...args) => hoisted.openChatMock(...args),
	    upsertChatEntry: (...args) => hoisted.upsertChatEntryMock(...args),
	    setKeyExchangeState: (...args) => hoisted.setKeyExchangeStateMock(...args),
	    addOutgoingMessage: (...args) => hoisted.addOutgoingMessageMock(...args),
	    addIncomingMessage: (...args) => hoisted.addIncomingMessageMock(...args),
	    deleteChatFromStore: (...args) => hoisted.deleteChatFromStoreMock(...args),
	    markDelivered: (...args) => hoisted.markDeliveredMock(...args),
	    updateMessageQueued: (...args) => hoisted.updateMessageQueuedMock(...args),
	    decryptSealedMessages: vi.fn().mockResolvedValue(undefined),
	    setChatOnlineStatus: vi.fn()
	  };
	});

	import {
	  LOBBY_PEER_ID,
	  __test as peerTest,
	  becomeLobbyHost,
	  broadcastGlobalMessage,
	  flushQueueForPeer,
	  handleIncomingConnection,
	  registrySyncReady,
	  initiatePrivateChat,
  sendPrivateMessage,
  closePrivateChat,
  disconnectPeer,
  handleMessage,
  initPeer,
  joinLobby,
  validateProtocolMessage
} from '$lib/services/peer.js';

const me = { username: 'alice', color: 'hsl(1, 65%, 65%)', age: 22, avatarBase64: 'data:image/png;base64,AAAA' };

	beforeEach(async () => {
	  MockPeer.ctorCalls = [];
	  MockPeer.instances = [];
	  hoisted.addGlobalMessageMock.mockClear();
	  hoisted.saveKnownPeerMock.mockClear();
	  hoisted.getKnownPeersMock.mockClear();
	  hoisted.getGlobalMessagesMock.mockClear();
	  hoisted.getFullUsernameRegistryMock.mockClear();
	  hoisted.registerUsernameLocallyMock.mockClear();
	  hoisted.isUsernameTakenMock.mockClear();
	  hoisted.mergeUsernameRegistryMock.mockClear();
		  hoisted.upsertPrivateChatMock.mockClear();
		  hoisted.getPrivateChatMock.mockClear();
		  hoisted.savePrivateMessageMock.mockClear();
		  hoisted.saveSentMessagePlaintextMock.mockClear();
		  hoisted.updateChatLastActivityMock.mockClear();
		  hoisted.updateChatMetaMock.mockClear();
		  hoisted.saveQueuedMessageMock.mockClear();
		  hoisted.getQueuedMessagesForChatMock.mockClear();
		  hoisted.deleteQueuedMessageMock.mockClear();
	  hoisted.markMessageDeliveredMock.mockClear();
	  hoisted.openChatMock.mockClear();
	  hoisted.upsertChatEntryMock.mockClear();
	  hoisted.setKeyExchangeStateMock.mockClear();
	  hoisted.addOutgoingMessageMock.mockClear();
	  hoisted.addIncomingMessageMock.mockClear();
	  hoisted.deleteChatFromStoreMock.mockClear();
	  hoisted.markDeliveredMock.mockClear();
	  hoisted.updateMessageQueuedMock.mockClear();
	  hoisted.privateChatStoreState.chats = new Map();
	  hoisted.privateChatStoreState.activeChatId = null;
	  hoisted.privateChatStoreState.pendingKeyExchanges = new Map();

  const cryptoMod = await import('$lib/services/crypto.js');
  const sid = cryptoMod.buildSessionId('alice', 'bob');
  cryptoMod.isSessionActive.mockReset().mockReturnValue(false);
  cryptoMod.createSession.mockReset().mockResolvedValue({ sessionId: sid, publicKeyBase64: 'OUR_PUB_EX' });
  cryptoMod.completeSession.mockReset().mockResolvedValue({ sessionId: sid, publicKeyBase64: 'OUR_PUB_EX_ACK' });
  cryptoMod.encryptForSession.mockReset().mockResolvedValue({ ciphertext: 'CIPH', iv: 'IV' });
  cryptoMod.decryptForSession.mockReset().mockResolvedValue('hello');
  cryptoMod.closeSession.mockClear();
  cryptoMod.closeAllSessions.mockClear();

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

it('joinLobby resolves as host after timeout (no response in 6s)', async () => {
  vi.useFakeTimers();
  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = joinLobby(localPeer, me);
  // no open/error => timeout
  await vi.advanceTimersByTimeAsync(6000);

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

it('registrySyncReady resolves after handleNetworkState completes', async () => {
  peerTest.resetRegistrySyncReadyForTest();
  const ready = registrySyncReady;

  await handleMessage(
    {
      type: 'NETWORK_STATE',
      from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', age: 1 },
      payload: { peers: [], usernameRegistry: [{ username: 'alice', peerId: 'p1', registeredAt: 1, lastSeenAt: 2 }], globalHistory: [] },
      timestamp: 1
    },
    null,
    me
  );

  await expect(ready).resolves.toBe('network');
});

it('registrySyncReady resolves after 6s timeout with no peers', async () => {
  vi.useFakeTimers();
  peerTest.resetRegistrySyncReadyForTest();
  const ready = registrySyncReady;

  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = joinLobby(localPeer, me);
  await vi.advanceTimersByTimeAsync(6000);

  await expect(ready).resolves.toBe('timeout');

  // Resolve joinLobby as host so timers/handles don't leak.
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('open');
  await promise;
});

it('registrySyncReady resolves immediately when peer becomes lobby host (first peer)', async () => {
  peerTest.resetRegistrySyncReadyForTest();
  const ready = registrySyncReady;

  const localPeer = new MockPeer('local-main', {});
  peerStore.update((s) => ({ ...s, peerId: 'local-main' }));

  const promise = becomeLobbyHost(localPeer, me, 0);
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('open');
  await promise;

  await expect(ready).resolves.toBe('first-peer');
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
  guestConn.open = true;
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
    connectedPeers: new Map([
      ['p2', { username: 'carol', color: 'hsl(10, 65%, 65%)', age: 44, connection: { open: true, send: existingSend } }]
    ])
  });

  const promise = becomeLobbyHost(localPeer, me, 0);
  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('open');
  await promise;

  const guestConn = new MockConn('guest-main', {});
  guestConn.open = true;
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
    avatarBase64: null,
    text: 'hi',
    timestamp: 123
  });
});

it('reconnectToKnownPeers connects to all peers in knownPeers DB (skips self + already connected)', async () => {
  hoisted.getKnownPeersMock.mockResolvedValueOnce([
    { username: 'me', peerId: 'local' },
    { username: 'bob', peerId: 'p2' },
    { username: 'carol', peerId: 'p3' }
  ]);

  // Pretend we already have an open connection to p3.
  peerStore.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map([['p3', { username: 'carol', color: 'x', age: 1, connection: { open: true, send: vi.fn(), close: vi.fn() } }]])
  });

  await initPeer(me);
  const main = MockPeer.instances[0];
  main.emit('open', 'local');

  // Resolve joinLobby quickly.
  const lobbyConn = main._connections.find((c) => c.peer === LOBBY_PEER_ID);
  lobbyConn.emit('open');

  await flushMicrotasks();
  await flushMicrotasks();

  // Should attempt to connect to p2 (not self, not already-connected p3).
  const connectedTo = main._connections.map((c) => c.peer);
  expect(connectedTo).toContain(LOBBY_PEER_ID);
  expect(connectedTo).toContain('p2');
  expect(connectedTo).not.toContain('p3');
});

it('stale connection is replaced when a new connection opens for the same peerId', async () => {
  peerTest.setUserProfileRefForTest(me);
  peerStore.update((s) => ({ ...s, peerId: 'local', isConnected: true }));

  const c1 = new MockConn('p2', {});
  const c2 = new MockConn('p2', {});

  handleIncomingConnection(c1, me);
  handleIncomingConnection(c2, me);

  expect(c1.close).toHaveBeenCalledTimes(1);
  expect(get(peerStore).connectedPeers.get('p2').connection).toBe(c2);
});

it("conn 'close' does not remove peer if a newer connection replaced the closed one", async () => {
  peerTest.setUserProfileRefForTest(me);
  peerStore.update((s) => ({ ...s, peerId: 'local', isConnected: true }));

  const c1 = new MockConn('p2', {});
  const c2 = new MockConn('p2', {});

  handleIncomingConnection(c1, me);
  handleIncomingConnection(c2, me);

  c1.emit('close');
  expect(get(peerStore).connectedPeers.has('p2')).toBe(true);

  c2.emit('close');
  expect(get(peerStore).connectedPeers.has('p2')).toBe(false);
});

it('PRESENCE_ANNOUNCE updates connectedPeers and triggers re-key for idle private chats', async () => {
  peerTest.setUserProfileRefForTest(me);
  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map([
      ['p2', { username: 'bob', color: 'x', age: 1, connection: Object.assign(new MockConn('p2', {}), { open: true }) }]
    ])
  });

	  // Seed an idle chat so PRESENCE_ANNOUNCE auto re-keys.
	  const cryptoMod = await import('$lib/services/crypto.js');
	  const chatId = cryptoMod.buildSessionId('alice', 'bob');
	  hoisted.privateChatStoreState.chats.set(chatId, { id: chatId, theirPeerId: 'p2', theirUsername: 'bob', keyExchangeState: 'idle' });

  const p2Conn = new MockConn('p2', {});
  p2Conn.open = true;
  await handleMessage(
    {
      type: 'PRESENCE_ANNOUNCE',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      payload: { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, avatarBase64: null },
      timestamp: 1
    },
    p2Conn,
    me
  );

  expect(get(peerStore).connectedPeers.get('p2').username).toBe('bob');
  expect(cryptoMod.createSession).toHaveBeenCalled();
  expect(hoisted.setKeyExchangeStateMock).toHaveBeenCalledWith(chatId, 'initiated');

  const entry = get(peerStore).connectedPeers.get('p2');
  expect(entry.connection.send).toHaveBeenCalled();
  const sent = entry.connection.send.mock.calls.map((c) => c[0]).find((m) => m.type === 'PRIVATE_KEY_EXCHANGE');
  expect(sent).toBeTruthy();
});

it('does not attempt outgoing connections while PeerJS is disconnected', async () => {
  const main = new MockPeer('local', {});
  main.disconnected = true;
  const connectSpy = vi.spyOn(main, 'connect');

  peerTest.setLocalPeerRefForTest(main);
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

  await handleMessage(
    {
      type: 'NEW_PEER',
      from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', age: 1 },
      payload: { newPeer: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 } },
      timestamp: 1
    },
    null,
    me
  );

  expect(connectSpy).not.toHaveBeenCalled();
});

it('initiatePrivateChat calls createSession and sends PRIVATE_KEY_EXCHANGE', async () => {
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

  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(false);

  await initiatePrivateChat('p2', 'bob', 'hsl(2, 65%, 65%)', null);

  expect(cryptoMod.createSession).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  const env = send.mock.calls[0][0];
  expect(env.type).toBe('PRIVATE_KEY_EXCHANGE');
  expect(env.to).toBe('p2');
  expect(env.payload.publicKeyBase64).toBe('OUR_PUB_EX');
  expect(hoisted.openChatMock).toHaveBeenCalled();
});

it('initiatePrivateChat opens existing chat if session is already active', async () => {
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

  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(true);

  await initiatePrivateChat('p2', 'bob', 'hsl(2, 65%, 65%)', null);
  expect(send).not.toHaveBeenCalled();
  expect(cryptoMod.createSession).not.toHaveBeenCalled();
  expect(hoisted.openChatMock).toHaveBeenCalled();
});

	it('sendPrivateMessage queues message when session is not active', async () => {
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
		  peerTest.setProfileForTest(me);
		  const cryptoMod = await import('$lib/services/crypto.js');
		  cryptoMod.isSessionActive.mockReturnValue(false);
		  const chatId = cryptoMod.buildSessionId('alice', 'bob');
		  await sendPrivateMessage(chatId, 'p2', 'hi');
		  expect(hoisted.saveQueuedMessageMock).toHaveBeenCalledTimes(1);
		  expect(hoisted.updateMessageQueuedMock).toHaveBeenCalledWith(chatId, expect.any(String), true);
		});

it('sendPrivateMessage encrypts before calling sendToPeer and stores ciphertext (not plaintext) in DB', async () => {
  let encrypted = false;
  const send = vi.fn((env) => {
    if (env?.type === 'PRIVATE_MSG') expect(encrypted).toBe(true);
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, connection: { send, open: true } }]])
  });
  peerTest.setProfileForTest(me);

  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(true);
  cryptoMod.encryptForSession.mockImplementationOnce(async () => {
    encrypted = true;
    return { ciphertext: 'CIPH', iv: 'IV' };
  });

  const chatId = cryptoMod.buildSessionId('alice', 'bob');
  await sendPrivateMessage(chatId, 'p2', 'hello');

  // Could also be called by disconnectPeer() in afterEach; ensure we sent the private message at least once.
  expect(send.mock.calls.some((c) => c?.[0]?.type === 'PRIVATE_MSG')).toBe(true);
  expect(hoisted.savePrivateMessageMock).toHaveBeenCalledTimes(1);
  const row = hoisted.savePrivateMessageMock.mock.calls[0][0];
  expect(row.ciphertext).toBe('CIPH');
  expect(row.iv).toBe('IV');
  expect(row.text).toBeUndefined();
});

	it('sendPrivateMessage queues message if peer is offline and flushQueueForPeer sends queued messages on reconnect', async () => {
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
	    connectedPeers: new Map() // offline
	  });
		  peerTest.setProfileForTest(me);
		  const cryptoMod = await import('$lib/services/crypto.js');
		  cryptoMod.isSessionActive.mockReturnValue(false);
		  const chatId = cryptoMod.buildSessionId('alice', 'bob');
		  await sendPrivateMessage(chatId, 'p2', 'hello');
		  expect(send).not.toHaveBeenCalled();
		  expect(hoisted.saveQueuedMessageMock).toHaveBeenCalledTimes(1);

		  // Peer reconnects and session becomes active.
		  peerStore.update((s) => ({
		    ...s,
		    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33, connection: { send, open: true } }]])
		  }));
		  hoisted.privateChatStoreState.chats.set(chatId, { id: chatId, theirPeerId: 'p2', theirUsername: 'bob', keyExchangeState: 'active' });
		  hoisted.getQueuedMessagesForChatMock.mockResolvedValueOnce([
		    { id: 'm-queued', chatId, theirPeerId: 'p2', plaintext: 'hello', timestamp: 10 }
		  ]);
		  cryptoMod.isSessionActive.mockReturnValue(true);
		  cryptoMod.encryptForSession.mockResolvedValueOnce({ ciphertext: 'CIPH', iv: 'IV' });
		  await flushQueueForPeer('p2');

	  expect(send).toHaveBeenCalledTimes(1);
	  expect(send.mock.calls[0][0].type).toBe('PRIVATE_MSG');
	});

it('PRIVATE_KEY_EXCHANGE handler calls completeSession and sends ACK', async () => {
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
  peerTest.setProfileForTest(me);

  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.completeSession.mockResolvedValueOnce({ sessionId: 'alice:bob', publicKeyBase64: 'ACK_PUB' });

  await handleMessage(
    {
      type: 'PRIVATE_KEY_EXCHANGE',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      to: 'local',
      payload: { publicKeyBase64: 'REMOTE_PUB' },
      timestamp: 1
    },
    new MockConn('p2'),
    me
  );

  expect(cryptoMod.completeSession).toHaveBeenCalled();
  const env = send.mock.calls.map((c) => c[0]).find((m) => m.type === 'PRIVATE_KEY_EXCHANGE_ACK');
  expect(env).toBeTruthy();
  expect(env.payload.publicKeyBase64).toBe('ACK_PUB');
});

it('PRIVATE_MSG handler decrypts and calls addIncomingMessage (and sends ACK)', async () => {
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
  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(true);
  cryptoMod.decryptForSession.mockResolvedValueOnce('hello');

  await handleMessage(
    {
      type: 'PRIVATE_MSG',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      to: 'local',
      payload: { ciphertext: 'CIPH', iv: 'IV', messageId: 'm1' },
      timestamp: 2
    },
    new MockConn('p2'),
    me
  );

  expect(cryptoMod.decryptForSession).toHaveBeenCalled();
  expect(hoisted.addIncomingMessageMock).toHaveBeenCalledWith('alice:bob', {
    id: 'm1',
    text: 'hello',
    ciphertext: 'CIPH',
    iv: 'IV',
    sealed: false,
    timestamp: 2
  });
  const ack = send.mock.calls.map((c) => c[0]).find((m) => m.type === 'PRIVATE_MSG_ACK');
  expect(ack).toBeTruthy();
  expect(ack.payload.messageId).toBe('m1');
});

it('PRIVATE_MSG handler stores as unreadable if session not active', async () => {
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
  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(false);

  await handleMessage(
    {
      type: 'PRIVATE_MSG',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      to: 'local',
      payload: { ciphertext: 'CIPH', iv: 'IV', messageId: 'm2' },
      timestamp: 2
    },
    new MockConn('p2'),
    me
  );

  expect(cryptoMod.decryptForSession).not.toHaveBeenCalled();
  expect(hoisted.addIncomingMessageMock).toHaveBeenCalledWith('alice:bob', {
    id: 'm2',
    text: null,
    ciphertext: 'CIPH',
    iv: 'IV',
    sealed: true,
    timestamp: 2
  });
});

it('PRIVATE_MSG_ACK handler calls markDelivered and markMessageDelivered', async () => {
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
  peerTest.setProfileForTest(me);

  await handleMessage(
    {
      type: 'PRIVATE_MSG_ACK',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      to: 'local',
      payload: { messageId: 'm1' },
      timestamp: 3
    },
    new MockConn('p2'),
    me
  );

  expect(hoisted.markDeliveredMock).toHaveBeenCalledWith('alice:bob', 'm1');
  expect(hoisted.markMessageDeliveredMock).toHaveBeenCalledWith('m1');
});

it('PRIVATE_CHAT_CLOSED does NOT delete local messages', async () => {
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
  peerTest.setProfileForTest(me);

  await handleMessage(
    {
      type: 'PRIVATE_CHAT_CLOSED',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 33 },
      to: 'local',
      payload: { chatId: 'alice:bob' },
      timestamp: 4
    },
    new MockConn('p2'),
    me
  );

  expect(hoisted.deleteChatFromStoreMock).not.toHaveBeenCalled();
  expect(hoisted.addIncomingMessageMock).toHaveBeenCalled();
});

	it('closePrivateChat clears session, deletes chat locally, and notifies peer when connected', async () => {
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
	  peerTest.setProfileForTest(me);
	  hoisted.privateChatStoreState.chats.set('alice:bob', { id: 'alice:bob', theirPeerId: 'p2', theirUsername: 'bob' });

	  await closePrivateChat('p2');
	  expect(hoisted.deleteChatFromStoreMock).toHaveBeenCalledWith('alice:bob');
	  const env = send.mock.calls.map((c) => c[0]).find((m) => m.type === 'PRIVATE_CHAT_CLOSED');
	  expect(env).toBeTruthy();
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

	it('handlePeerDisconnect does NOT call peer.reconnect() when peer.disconnected is false', async () => {
	  vi.useFakeTimers();

	  const p = new MockPeer('local', {});
	  p.disconnected = false;
	  p.destroyed = false;
	  peerTest.setUserProfileRefForTest(me);
	  peerTest.setLocalPeerRefForTest(p);

  await peerTest.handlePeerDisconnectForTest();
  await vi.advanceTimersByTimeAsync(2000);

  expect(p.reconnect).not.toHaveBeenCalled();
  vi.clearAllTimers();
  vi.useRealTimers();
});

	it('handlePeerDisconnect calls peer.reconnect() only when peer.disconnected is true', async () => {
	  vi.useFakeTimers();

	  const p = new MockPeer('local', {});
	  p.disconnected = true;
	  p.destroyed = false;
	  peerTest.setUserProfileRefForTest(me);
	  peerTest.setLocalPeerRefForTest(p);

  await peerTest.handlePeerDisconnectForTest();
  await vi.advanceTimersByTimeAsync(2000);

  expect(p.reconnect).toHaveBeenCalledTimes(1);
  vi.clearAllTimers();
  vi.useRealTimers();
});

	it('handlePeerDisconnect creates a new Peer instance when peer.destroyed is true', async () => {
	  vi.useFakeTimers();

	  const p = new MockPeer('local', {});
	  p.disconnected = true;
	  p.destroyed = true;
	  peerTest.setUserProfileRefForTest(me);
	  peerTest.setLocalPeerRefForTest(p);

  const before = MockPeer.instances.length;
  await peerTest.handlePeerDisconnectForTest();
  await vi.advanceTimersByTimeAsync(2000);

  expect(MockPeer.instances.length).toBeGreaterThan(before);
  expect(p.reconnect).not.toHaveBeenCalled();
  vi.clearAllTimers();
  vi.useRealTimers();
});

	it('reconnectAttempts resets to 0 on successful open event', async () => {
	  vi.useFakeTimers();

	  peerTest.setUserProfileRefForTest(me);

	  // initPeer attaches the 'open' handler that resets reconnectAttempts.
	  const p = await initPeer(me);
	  p.disconnected = true;
	  p.destroyed = false;
	  peerTest.setLocalPeerRefForTest(p);

	  await peerTest.handlePeerDisconnectForTest();
	  await vi.advanceTimersByTimeAsync(2000);
	  expect(peerTest.getReconnectAttemptsForTest()).toBe(1);

	  // Simulate successful reconnection/open.
	  p.emit('open', 'local');
	  expect(peerTest.getReconnectAttemptsForTest()).toBe(0);
	  vi.clearAllTimers();
	  vi.useRealTimers();
	});

	it('After MAX_RECONNECT_ATTEMPTS, connectionState is set to failed', async () => {
	  vi.useFakeTimers();

	  const p = new MockPeer('local', {});
	  p.disconnected = true;
	  p.destroyed = false;
	  peerTest.setUserProfileRefForTest(me);
	  peerTest.setLocalPeerRefForTest(p);

  // 3 attempts.
  for (let i = 0; i < 3; i += 1) {
    await peerTest.handlePeerDisconnectForTest();
    await vi.advanceTimersByTimeAsync([2000, 5000, 10000][i]);
  }

	  // Next disconnect event should give up.
	  await peerTest.handlePeerDisconnectForTest();
	  expect(get(peerStore).connectionState).toBe('failed');
	  vi.clearAllTimers();
	  vi.useRealTimers();
	});

it('handleMessage ignores malformed messages (missing required envelope fields)', async () => {
  const conn = new MockConn('p2');
  await handleMessage({ not: 'a valid envelope' }, conn, me);
  expect(hoisted.addGlobalMessageMock).not.toHaveBeenCalled();
  expect(hoisted.saveKnownPeerMock).not.toHaveBeenCalled();
  const cryptoMod = await import('$lib/services/crypto.js');
  expect(cryptoMod.decryptForSession).not.toHaveBeenCalled();
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
