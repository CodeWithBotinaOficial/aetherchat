import { hoisted, MockConn, MockPeer } from './harness/peerHarness.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';

import { __test as peerTest, closePrivateChat, disconnectPeer, handleMessage } from '$lib/services/peer.js';

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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });
  peerTest.setProfileForTest(me);

  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.completeSession.mockResolvedValueOnce({ sessionId: 'alice:bob', publicKeyBase64: 'ACK_PUB' });

  await handleMessage(
    {
      type: 'PRIVATE_KEY_EXCHANGE',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });
  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(true);
  cryptoMod.decryptForSession.mockResolvedValueOnce('hello');

  await handleMessage(
    {
      type: 'PRIVATE_MSG',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
      to: 'local',
      payload: { ciphertext: 'CIPH', iv: 'IV', messageId: 'm1' },
      timestamp: 2
    },
    new MockConn('p2'),
    me
  );

  expect(cryptoMod.decryptForSession).toHaveBeenCalled();
  expect(hoisted.addIncomingMessageMock).toHaveBeenCalledWith(
    'alice:bob',
    expect.objectContaining({
      id: 'm1',
      text: 'hello',
      ciphertext: 'CIPH',
      iv: 'IV',
      sealed: false,
      timestamp: 2
    })
  );
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });
  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(false);

  await handleMessage(
    {
      type: 'PRIVATE_MSG',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
      to: 'local',
      payload: { ciphertext: 'CIPH', iv: 'IV', messageId: 'm2' },
      timestamp: 2
    },
    new MockConn('p2'),
    me
  );

  expect(cryptoMod.decryptForSession).not.toHaveBeenCalled();
  expect(hoisted.addIncomingMessageMock).toHaveBeenCalledWith(
    'alice:bob',
    expect.objectContaining({
      id: 'm2',
      text: '🔒 Encrypted message',
      ciphertext: 'CIPH',
      iv: 'IV',
      sealed: true,
      timestamp: 2
    })
  );
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
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
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
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });
  peerTest.setProfileForTest(me);
  hoisted.privateChatStoreState.chats.set('alice:bob', { id: 'alice:bob', theirPeerId: 'p2', theirUsername: 'bob' });

  await closePrivateChat('p2');
  expect(hoisted.deleteChatFromStoreMock).toHaveBeenCalledWith('alice:bob');
  const env = send.mock.calls.map((c) => c[0]).find((m) => m.type === 'PRIVATE_CHAT_CLOSED');
  expect(env).toBeTruthy();
});
