import { hoisted, MockConn, MockPeer } from './harness/peerHarness.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';

import { __test as peerTest, broadcastGlobalMessage, disconnectPeer, handleMessage } from '$lib/services/peer.js';

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
});

it('handleMessage routes GLOBAL_MSG to globalMessages store (via addGlobalMessage)', async () => {
  const conn = new MockConn('p2');
  const msg = {
    type: 'GLOBAL_MSG',
    from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
    payload: { message: { id: 'm-1', text: 'hi', timestamp: 123 } },
    timestamp: 123
  };
  await handleMessage(msg, conn, me);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledTimes(1);
  expect(hoisted.addGlobalMessageMock).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'm-1',
      peerId: 'p2',
      username: 'bob',
      dateOfBirth: '1990-01-01',
      color: 'hsl(2, 65%, 65%)',
      avatarBase64: null,
      text: 'hi',
      replies: null,
      timestamp: 123
    })
  );
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });

  await broadcastGlobalMessage(' hello ', null, me);
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });

  await broadcastGlobalMessage('hi', null, me);
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
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01', connection: { send } }]])
  });

  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
  const spy = vi
    .spyOn(globalThis.crypto, 'randomUUID')
    .mockImplementationOnce(() => 'uuid-1')
    .mockImplementationOnce(() => 'uuid-2');

  await broadcastGlobalMessage('a', null, me);
  await broadcastGlobalMessage('b', null, me);

  const first = hoisted.addGlobalMessageMock.mock.calls[0][0];
  const second = hoisted.addGlobalMessageMock.mock.calls[1][0];
  expect(first.id).toBe('uuid-1');
  expect(second.id).toBe('uuid-2');
  expect(first.id).not.toBe(second.id);

  spy.mockRestore();
  nowSpy.mockRestore();
});

it('Security: GLOBAL_MSG_EDIT is rejected when the original message is older than 30 minutes', async () => {
  vi.useFakeTimers();
  const now = new Date('2026-04-05T12:00:00.000Z');
  vi.setSystemTime(now);

  hoisted.getGlobalMessageMock.mockResolvedValueOnce({
    id: 'm1',
    peerId: 'p2',
    username: 'bob',
    dateOfBirth: '2004-01-01',
    color: 'hsl(2, 65%, 65%)',
    text: 'orig',
    replies: null,
    timestamp: now.getTime() - 31 * 60 * 1000,
    editedAt: null,
    deleted: false
  });

  await handleMessage(
    {
      type: 'GLOBAL_MSG_EDIT',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
      payload: { messageId: 'm1', text: 'new', editedAt: now.getTime(), replies: null },
      timestamp: now.getTime()
    },
    null,
    me
  );

  expect(hoisted.updateGlobalMessageMock).not.toHaveBeenCalled();
  expect(hoisted.persistGlobalPatchWithCascadeMock).not.toHaveBeenCalled();
});

it('Security: GLOBAL_MSG_EDIT is rejected when the sender is not the stored author', async () => {
  vi.useFakeTimers();
  const now = new Date('2026-04-05T12:05:00.000Z');
  vi.setSystemTime(now);

  hoisted.getGlobalMessageMock.mockResolvedValueOnce({
    id: 'm2',
    peerId: 'pX',
    username: 'alice',
    dateOfBirth: '2004-01-01',
    color: 'hsl(2, 65%, 65%)',
    text: 'orig',
    replies: null,
    timestamp: now.getTime() - 60_000,
    editedAt: null,
    deleted: false
  });

  await handleMessage(
    {
      type: 'GLOBAL_MSG_EDIT',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
      payload: { messageId: 'm2', text: 'new', editedAt: now.getTime(), replies: null },
      timestamp: now.getTime()
    },
    null,
    me
  );

  expect(hoisted.updateGlobalMessageMock).not.toHaveBeenCalled();
  expect(hoisted.persistGlobalPatchWithCascadeMock).not.toHaveBeenCalled();
});

it('GLOBAL_MSG_EDIT applies update + cascades when valid', async () => {
  vi.useFakeTimers();
  const now = new Date('2026-04-05T12:10:00.000Z');
  vi.setSystemTime(now);

  hoisted.getGlobalMessageMock.mockResolvedValueOnce({
    id: 'm3',
    peerId: 'p2',
    username: 'bob',
    dateOfBirth: '1990-01-01',
    color: 'hsl(2, 65%, 65%)',
    text: 'orig',
    replies: null,
    timestamp: now.getTime() - 60_000,
    editedAt: null,
    deleted: false
  });

  await handleMessage(
    {
      type: 'GLOBAL_MSG_EDIT',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', dateOfBirth: '1990-01-01' },
      payload: { messageId: 'm3', text: 'new text', editedAt: now.getTime(), replies: null },
      timestamp: now.getTime()
    },
    null,
    me
  );

  expect(hoisted.updateGlobalMessageMock).toHaveBeenCalledTimes(1);
  expect(hoisted.cascadeGlobalCitationsMock).toHaveBeenCalledTimes(1);
  expect(hoisted.persistGlobalPatchWithCascadeMock).toHaveBeenCalledTimes(1);
});
