import { hoisted, MockPeer } from './harness/peerHarness.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';

import { __test as peerTest, disconnectPeer, flushQueueForPeer, handleMessage, initiatePrivateChat, sendPrivateMessage } from '$lib/services/peer.js';

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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });

  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(true);
  peerTest.confirmPrivateSessionForTest(cryptoMod.buildSessionId('alice', 'bob'));

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
  await sendPrivateMessage(chatId, 'p2', 'hi', null);
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send, open: true } }]])
  });
  peerTest.setProfileForTest(me);

  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(true);
  cryptoMod.encryptForSession.mockImplementationOnce(async () => {
    encrypted = true;
    return { ciphertext: 'CIPH', iv: 'IV' };
  });

  const chatId = cryptoMod.buildSessionId('alice', 'bob');
  peerTest.confirmPrivateSessionForTest(chatId);
  await sendPrivateMessage(chatId, 'p2', 'hello', null);

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
    connectedPeers: new Map()
  });
  peerTest.setProfileForTest(me);
  const cryptoMod = await import('$lib/services/crypto.js');
  cryptoMod.isSessionActive.mockReturnValue(false);
  const chatId = cryptoMod.buildSessionId('alice', 'bob');
  await sendPrivateMessage(chatId, 'p2', 'hello', null);
  expect(send).not.toHaveBeenCalled();
  expect(hoisted.saveQueuedMessageMock).toHaveBeenCalledTimes(1);

  peerStore.update((s) => ({
    ...s,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send, open: true } }]])
  }));
  hoisted.privateChatStoreState.chats.set(chatId, { id: chatId, theirPeerId: 'p2', theirUsername: 'bob', keyExchangeState: 'active' });
  hoisted.getQueuedMessagesForChatMock.mockResolvedValueOnce([{ id: 'm-queued', chatId, theirPeerId: 'p2', plaintext: 'hello', timestamp: 10 }]);
  cryptoMod.isSessionActive.mockReturnValue(true);
  cryptoMod.encryptForSession.mockResolvedValueOnce({ ciphertext: 'CIPH', iv: 'IV' });
  peerTest.confirmPrivateSessionForTest(chatId);
  await flushQueueForPeer('p2');

  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].type).toBe('PRIVATE_MSG');
});

it('Queued flush path: active-but-unconfirmed session triggers key exchange first, then sends after ACK confirms session', async () => {
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send, open: true } }]])
  });
  peerTest.setProfileForTest(me);

  const cryptoMod = await import('$lib/services/crypto.js');
  const chatId = cryptoMod.buildSessionId('alice', 'bob');
  cryptoMod.isSessionActive.mockReturnValue(true);

  hoisted.privateChatStoreState.chats.set(chatId, { id: chatId, theirPeerId: 'p2', theirUsername: 'bob', keyExchangeState: 'idle' });

  hoisted.getQueuedMessagesForChatMock.mockResolvedValueOnce([{ id: 'm-queued', chatId, theirPeerId: 'p2', plaintext: 'hello', timestamp: 10 }]);
  await flushQueueForPeer('p2');

  expect(cryptoMod.encryptForSession).not.toHaveBeenCalled();
  const ex = send.mock.calls.map((c) => c[0]).find((m) => m.type === 'PRIVATE_KEY_EXCHANGE');
  expect(ex).toBeTruthy();

  hoisted.getQueuedMessagesForChatMock.mockResolvedValueOnce([{ id: 'm-queued', chatId, theirPeerId: 'p2', plaintext: 'hello', timestamp: 10 }]);
  cryptoMod.encryptForSession.mockResolvedValueOnce({ ciphertext: 'CIPH', iv: 'IV' });

  await handleMessage(
    {
      type: 'PRIVATE_KEY_EXCHANGE_ACK',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
      to: 'local',
      payload: { publicKeyBase64: 'REMOTE_PUB_ACK' },
      timestamp: 11
    },
    { peer: 'p2', open: true },
    me
  );

  const pm = send.mock.calls.map((c) => c[0]).find((m) => m.type === 'PRIVATE_MSG');
  expect(pm).toBeTruthy();
  expect(pm.payload.ciphertext).toBe('CIPH');
  expect(pm.payload.iv).toBe('IV');
});
