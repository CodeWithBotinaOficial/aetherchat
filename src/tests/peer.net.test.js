import { flushMicrotasks, hoisted, MockConn, MockPeer } from './harness/peerHarness.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

import {
  LOBBY_PEER_ID,
  __test as peerTest,
  disconnectPeer,
  handleIncomingConnection,
  handleMessage,
  initPeer,
  setLocalUserProfile,
  validateProtocolMessage
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

it('initPeer creates a Peer with a random UUID (not the lobby ID)', async () => {
  const p = await initPeer(me);
  expect(p).toBeInstanceOf(MockPeer);
  expect(MockPeer.ctorCalls.length).toBe(1);
  expect(MockPeer.ctorCalls[0].id).not.toBe(LOBBY_PEER_ID);
  expect(MockPeer.ctorCalls[0].options.host).toBe('0.peerjs.com');
  expect(MockPeer.ctorCalls[0].options.secure).toBe(true);
});

it('HANDSHAKE payload includes bio', async () => {
  peerStore.update((s) => ({ ...s, peerId: 'local-main', isConnected: true }));
  const conn = new MockConn('remote-main', {});

  handleIncomingConnection(conn, { ...me, bio: 'hello there' });
  conn.emit('open');
  await flushMicrotasks();

  expect(conn.send).toHaveBeenCalled();
  const sent = conn.send.mock.calls.map((c) => c[0]);
  const handshake = sent.find((m) => m?.type === 'HANDSHAKE');
  expect(handshake).toBeTruthy();
  expect(handshake.payload.bio).toBe('hello there');
});

it('PRESENCE_ANNOUNCE payload includes bio', async () => {
  const send = vi.fn();
  peerStore.set({
    peerId: 'local-main',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    lastSyncAt: null,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'x', dateOfBirth: '2004-01-01', bio: '', connection: { send, open: true } }]])
  });

  setLocalUserProfile({ ...me, bio: 'my bio' });
  await flushMicrotasks();

  const sent = send.mock.calls.map((c) => c[0]);
  const presence = sent.find((m) => m?.type === 'PRESENCE_ANNOUNCE');
  expect(presence).toBeTruthy();
  expect(presence.payload.bio).toBe('my bio');
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

  const p = await initPeer(me);
  p.disconnected = true;
  p.destroyed = false;
  peerTest.setLocalPeerRefForTest(p);

  await peerTest.handlePeerDisconnectForTest();
  await vi.advanceTimersByTimeAsync(2000);
  expect(peerTest.getReconnectAttemptsForTest()).toBe(1);

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

  for (let i = 0; i < 3; i += 1) {
    await peerTest.handlePeerDisconnectForTest();
    await vi.advanceTimersByTimeAsync([2000, 5000, 10000][i]);
  }

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
    from: { username: 'alice', peerId: 'p1', color: 'hsl(1, 65%, 65%)', dateOfBirth: '2004-01-01' },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };
  const bad = {
    type: 'GLOBAL_MSG',
    from: { username: '', peerId: 'p1', color: 'x', dateOfBirth: '2004-01-01' },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };

  expect(validateProtocolMessage(good)).toBe(true);
  expect(validateProtocolMessage(bad)).toBe(false);
});
