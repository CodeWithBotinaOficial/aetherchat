import {
  cleanOldGlobalMessages,
  cleanOldPrivateMessages,
  db,
  getGlobalMessages,
  getKnownPeers,
  getUser,
  saveGlobalMessage,
  saveKnownPeer,
  saveUser
} from '$lib/services/db.js';

async function clearAllTables() {
  await db.transaction(
    'rw',
    db.users,
    db.globalMessages,
    db.privateChats,
    db.privateMessages,
    db.knownPeers,
    async () => {
      await Promise.all([
        db.users.clear(),
        db.globalMessages.clear(),
        db.privateChats.clear(),
        db.privateMessages.clear(),
        db.knownPeers.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await clearAllTables();
});

it('Can save and retrieve a user', async () => {
  await saveUser({
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: 'data:image/png;base64,abc',
    createdAt: Date.now()
  });

  const user = await getUser();
  expect(user).not.toBeNull();
  expect(user?.username).toBe('alice');
  expect(user?.age).toBe(22);
});

it('Can save and retrieve global messages', async () => {
  const now = Date.now();
  await saveGlobalMessage({
    peerId: 'peer-1',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'hello',
    timestamp: now
  });

  const msgs = await getGlobalMessages();
  expect(msgs).toHaveLength(1);
  expect(msgs[0].text).toBe('hello');
  expect(msgs[0].timestamp).toBe(now);
});

it('cleanOldGlobalMessages deletes messages older than 24h', async () => {
  const now = Date.now();
  const oldTs = now - 25 * 60 * 60 * 1000;

  await saveGlobalMessage({
    peerId: 'peer-1',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'old',
    timestamp: oldTs
  });
  await saveGlobalMessage({
    peerId: 'peer-1',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'new',
    timestamp: now
  });

  const deleted = await cleanOldGlobalMessages();
  expect(deleted).toBe(1);

  const msgs = await getGlobalMessages();
  expect(msgs).toHaveLength(1);
  expect(msgs[0].text).toBe('new');
});

it('cleanOldPrivateMessages deletes chats inactive for 30 days', async () => {
  const now = Date.now();
  const oldActivity = now - 31 * 24 * 60 * 60 * 1000;

  const chatId = await db.privateChats.add({
    peerUsername: 'bob',
    lastMessage: 'yo',
    lastActivity: oldActivity,
    unreadCount: 0
  });

  await db.privateMessages.add({
    chatId,
    fromUsername: 'bob',
    text: 'old message',
    timestamp: oldActivity,
    encrypted: false
  });

  const deletedChats = await cleanOldPrivateMessages();
  expect(deletedChats).toBe(1);

  const remainingChat = await db.privateChats.get(chatId);
  expect(remainingChat).toBeUndefined();

  const remainingMsgs = await db.privateMessages.where('chatId').equals(chatId).toArray();
  expect(remainingMsgs).toHaveLength(0);
});

it('Can save and retrieve known peers', async () => {
  const now = Date.now();
  await saveKnownPeer({ username: 'alice', peerId: 'peer-1', lastSeen: now });
  await saveKnownPeer({ username: 'bob', peerId: 'peer-2', lastSeen: now + 1 });

  const peers = await getKnownPeers();
  expect(peers).toHaveLength(2);
  expect(peers[0].peerId).toBe('peer-2'); // latest first
});

