import {
  __test as dbTest,
  db,
  getFullUsernameRegistry,
  isUsernameTaken,
  mergeUsernameRegistry,
  pruneStaleRegistryEntries,
  registerUsernameLocally
} from '$lib/services/db.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { checkUsernameAvailability, generateUsernameSuggestion, handleMessage } from '$lib/services/peer.js';

async function clearAllTables() {
  await db.transaction(
    'rw',
    db.users,
    db.globalMessages,
    db.privateChats,
    db.privateMessages,
    db.sentMessagesPlaintext,
    db.sessionKeys,
    db.queuedMessages,
    db.queuedActions,
    db.knownPeers,
    db.usernameRegistry,
    db.peerIds,
    db.cooldown,
    db.follows,
    db.wallComments,
    async () => {
      await Promise.all([
        db.users.clear(),
        db.globalMessages.clear(),
        db.privateChats.clear(),
        db.privateMessages.clear(),
        db.sentMessagesPlaintext.clear(),
        db.sessionKeys.clear(),
        db.queuedMessages.clear(),
        db.queuedActions.clear(),
        db.knownPeers.clear(),
        db.usernameRegistry.clear(),
        db.peerIds.clear(),
        db.cooldown.clear(),
        db.follows.clear(),
        db.wallComments.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await clearAllTables();
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
});

afterEach(() => {
  vi.useRealTimers();
});

it('isUsernameTaken returns false for empty registry', async () => {
  expect(await isUsernameTaken('alice')).toBe(false);
});

it('isUsernameTaken returns true after registering a username', async () => {
  await registerUsernameLocally({ username: 'alice', peerId: 'p1', registeredAt: 1, lastSeenAt: 1 });
  expect(await isUsernameTaken('alice')).toBe(true);
});

it("isUsernameTaken is case-insensitive ('Alice' matches 'alice')", async () => {
  await registerUsernameLocally({ username: 'alice', peerId: 'p1', registeredAt: 1, lastSeenAt: 1 });
  expect(await isUsernameTaken('Alice')).toBe(true);
  expect(await isUsernameTaken(' ÁLÎCÉ ')).toBe(true);
});

it('mergeUsernameRegistry keeps earlier registeredAt on conflict', async () => {
  await registerUsernameLocally({ username: 'alice', peerId: 'p_local', registeredAt: 100, lastSeenAt: 1000 });
  await mergeUsernameRegistry([{ username: 'Alice', peerId: 'p_remote', registeredAt: 200, lastSeenAt: 2000 }]);

	  const entries = await getFullUsernameRegistry();
	  expect(entries).toHaveLength(1);
	  expect(entries[0].username).toBe(dbTest.normalizeUsername('alice'));
	  // Registration ownership stays local, but peerId can change as the user reconnects.
	  expect(entries[0].peerId).toBe('p_remote');
	  expect(entries[0].registeredAt).toBe(100);
	  expect(entries[0].lastSeenAt).toBe(2000);
	});

it('mergeUsernameRegistry inserts new entries not in local DB', async () => {
  await mergeUsernameRegistry([{ username: 'bob', peerId: 'p2', registeredAt: 10, lastSeenAt: 11 }]);
  expect(await isUsernameTaken('bob')).toBe(true);
  const entries = await getFullUsernameRegistry();
  expect(entries).toHaveLength(1);
  expect(entries[0].peerId).toBe('p2');
});

it('checkUsernameAvailability returns available:true with empty registry and no peers', async () => {
  peerStore.update((s) => ({ ...s, connectedPeers: new Map() }));
  const res = await checkUsernameAvailability('alice');
  expect(res.available).toBe(true);
});

it('checkUsernameAvailability returns available:false for locally taken username', async () => {
  await registerUsernameLocally({ username: 'alice', peerId: 'p1', registeredAt: 1, lastSeenAt: 1 });
  const res = await checkUsernameAvailability('Alice');
  expect(res.available).toBe(false);
  if (!res.available) {
    expect(res.takenBy).toBe('local');
    expect(typeof res.suggestion).toBe('string');
    expect(res.suggestion).not.toBe('Alice');
  }
});

it('checkUsernameAvailability resolves available:true after 2s timeout with no response', async () => {
  vi.useFakeTimers();

  const send = vi.fn();
  peerStore.update(
    (s) =>
      ({
        ...s,
        connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1, connection: { send } }]])
      }) // ensure network layer runs
  );

  const promise = checkUsernameAvailability('alice');
  await vi.advanceTimersByTimeAsync(2000);
  const res = await promise;
  expect(res.available).toBe(true);
});

it('checkUsernameAvailability returns available:false when a peer responds USERNAME_TAKEN', async () => {
  const send = vi.fn();
  peerStore.update((s) => ({
    ...s,
    connectedPeers: new Map([['p2', { username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1, connection: { send } }]])
  }));

  const promise = checkUsernameAvailability('alice');
  // Wait for async local checks to complete and the USERNAME_CHECK to be broadcast.
  for (let i = 0; i < 10 && send.mock.calls.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
  const sent = send.mock.calls[0][0];
  const checkId = sent.payload.checkId;

  await handleMessage(
    {
      type: 'USERNAME_TAKEN',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: { checkId, username: 'alice' },
      timestamp: Date.now()
    },
    null,
    { username: 'local', color: 'hsl(1, 65%, 65%)', age: 1 }
  );

  const res = await promise;
  expect(res.available).toBe(false);
  if (!res.available) expect(res.takenBy).toBe('p2');
});

it('generateUsernameSuggestion returns a string different from the input', async () => {
  const s = await generateUsernameSuggestion('alice');
  expect(typeof s).toBe('string');
  expect(s).not.toBe('alice');
});

it('pruneStaleRegistryEntries removes entries older than 1 year', async () => {
  const now = Date.now();
  await registerUsernameLocally({
    username: 'old',
    peerId: 'p1',
    registeredAt: now - 10,
    lastSeenAt: now - 366 * 24 * 60 * 60 * 1000
  });
  await registerUsernameLocally({
    username: 'fresh',
    peerId: 'p2',
    registeredAt: now - 10,
    lastSeenAt: now - 10
  });

  const deleted = await pruneStaleRegistryEntries();
  expect(deleted).toBe(1);
  expect(await isUsernameTaken('old')).toBe(false);
  expect(await isUsernameTaken('fresh')).toBe(true);
});

it('USERNAME_REGISTERED message updates local registry immediately', async () => {
  expect(await isUsernameTaken('alice')).toBe(false);

  await handleMessage(
    {
      type: 'USERNAME_REGISTERED',
      from: { peerId: 'p2', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: { username: 'Alice', peerId: 'p2', registeredAt: 123 },
      timestamp: 999
    },
    null,
    { username: 'local', color: 'hsl(1, 65%, 65%)', age: 1 }
  );

  expect(await isUsernameTaken('alice')).toBe(true);
});
