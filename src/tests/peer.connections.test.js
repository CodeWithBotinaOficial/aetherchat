import { flushMicrotasks, hoisted, MockConn, MockPeer } from './harness/peerHarness.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

import { LOBBY_PEER_ID, __test as peerTest, disconnectPeer, handleIncomingConnection, handleMessage, initPeer } from '$lib/services/peer.js';

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

it('reconnectToKnownPeers connects to all peers in knownPeers DB (skips self + already connected)', async () => {
  hoisted.getKnownPeersMock.mockResolvedValueOnce([
    { username: 'me', peerId: 'local' },
    { username: 'bob', peerId: 'p2' },
    { username: 'carol', peerId: 'p3' }
  ]);

  peerStore.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map([['p3', { username: 'carol', color: 'x', dateOfBirth: '2004-01-01', connection: { open: true, send: vi.fn(), close: vi.fn() } }]])
  });

  await initPeer(me);
  const main = MockPeer.instances[0];
  main.emit('open', 'local');

  const lobbyConn = main._connections.find((c) => c.peer === LOBBY_PEER_ID);
  lobbyConn.emit('open');

  await flushMicrotasks();
  await flushMicrotasks();

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
      ['p2', { username: 'bob', color: 'x', dateOfBirth: '2004-01-01', connection: Object.assign(new MockConn('p2', {}), { open: true }) }]
    ])
  });

  const cryptoMod = await import('$lib/services/crypto.js');
  const chatId = cryptoMod.buildSessionId('alice', 'bob');
  hoisted.privateChatStoreState.chats.set(chatId, { id: chatId, theirPeerId: 'p2', theirUsername: 'bob', keyExchangeState: 'idle' });

  const p2Conn = new MockConn('p2', {});
  p2Conn.open = true;
  await handleMessage(
    {
      type: 'PRESENCE_ANNOUNCE',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
      payload: { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', avatarBase64: null },
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
      from: { peerId: 'host', username: 'host', color: 'hsl(3, 65%, 65%)', dateOfBirth: '2004-01-01' },
      payload: { newPeer: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' } },
      timestamp: 1
    },
    null,
    me
  );

  expect(connectSpy).not.toHaveBeenCalled();
});
