import { flushMicrotasks, hoisted, MockConn, MockPeer } from './harness/peerHarness.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

import {
  LOBBY_PEER_ID,
  __test as peerTest,
  becomeLobbyHost,
  disconnectPeer,
  handleMessage,
  joinLobby,
  registrySyncReady
} from '$lib/services/peer.js';

const me = { username: 'alice', color: 'hsl(1, 65%, 65%)', dateOfBirth: '2004-01-01', avatarBase64: 'data:image/png;base64,AAAA' };

beforeEach(async () => {
  MockPeer.ctorCalls = [];
  MockPeer.instances = [];

  for (const fn of Object.values(hoisted)) {
    if (typeof fn?.mockClear === 'function') fn.mockClear();
  }
  hoisted.privateChatStoreState.chats = new Map();
  hoisted.privateChatStoreState.activeChatId = null;
  hoisted.privateChatStoreState.pendingKeyExchanges = new Map();

  peerTest.clearConfirmedPrivateSessionsForTest();

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
    lastSyncAt: null,
    connectedPeers: new Map()
  });
});

afterEach(() => {
  disconnectPeer();
  vi.useRealTimers();
  // @ts-ignore
  delete globalThis._PeerJS;
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

  const firstLobbyConn = localPeer._connections.find((c) => c.peer === LOBBY_PEER_ID);
  firstLobbyConn.emit('error', { type: 'peer-unavailable' });

  const hostPeer = MockPeer.instances.find((p) => p.id === LOBBY_PEER_ID);
  hostPeer.emit('error', { type: 'unavailable-id' });

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
      from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', dateOfBirth: '2004-01-01' },
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

  await vi.advanceTimersByTimeAsync(1000);
  const lobbyConn = localPeer._connections.find((c) => c.peer === LOBBY_PEER_ID);
  lobbyConn.emit('open');

  const res = await promise;
  expect(res.role).toBe('guest');
});

it('Lobby host sends NETWORK_STATE on receiving LOBBY_JOIN', async () => {
  hoisted.getGlobalMessagesMock.mockResolvedValueOnce([
    { peerId: 'p1', username: 'x', dateOfBirth: '2004-01-01', color: 'hsl(3, 65%, 65%)', text: 'hello', timestamp: 10 }
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

  const guestConn = new MockConn('guest-main', {});
  guestConn.open = true;
  hostPeer.emit('connection', guestConn);

  const joinMsg = {
    type: 'LOBBY_JOIN',
    from: { peerId: 'guest-main', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
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
      ['p2', { username: 'carol', color: 'hsl(10, 65%, 65%)', dateOfBirth: '1982-01-01', connection: { open: true, send: existingSend } }]
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
    from: { peerId: 'guest-main', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
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
