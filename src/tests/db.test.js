import {
  cleanOldGlobalMessages,
  cleanOldPrivateMessages,
  cleanOldPrivateChats,
  db,
  getGlobalMessages,
  getKnownPeers,
  getPrivateChat,
  getPrivateChats,
  getPrivateMessages,
  getPrivateMessagesPage,
  getUser,
  markMessageDelivered,
  savePrivateMessage,
  saveGlobalMessage,
  saveKnownPeer,
  saveUser,
  upsertPrivateChat,
  deletePrivateChat
} from '$lib/services/db.js';

async function clearAllTables() {
  await db.transaction(
    'rw',
    db.users,
    db.globalMessages,
    db.privateChats,
    db.privateMessages,
    db.knownPeers,
    db.usernameRegistry,
    async () => {
      await Promise.all([
        db.users.clear(),
        db.globalMessages.clear(),
        db.privateChats.clear(),
        db.privateMessages.clear(),
        db.knownPeers.clear(),
        db.usernameRegistry.clear()
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

  const chatId = 'a:b';
  await upsertPrivateChat({
    id: chatId,
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now - 1000,
    lastActivity: oldActivity
  });

  await savePrivateMessage({
    id: 'pm-1',
    chatId,
    direction: 'received',
    ciphertext: 'CIPHERTEXT',
    iv: 'IV',
    timestamp: oldActivity,
    delivered: true
  });

  const deletedChats = await cleanOldPrivateMessages();
  expect(deletedChats).toBe(1);

  const remainingChat = await db.privateChats.get(chatId);
  expect(remainingChat).toBeUndefined();

  const remainingMsgs = await db.privateMessages.where('chatId').equals(chatId).toArray();
  expect(remainingMsgs).toHaveLength(0);
});

it('upsertPrivateChat creates a new chat entry', async () => {
  const now = Date.now();
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now
  });

  const chat = await getPrivateChat('a:b');
  expect(chat).not.toBeNull();
  expect(chat?.theirUsername).toBe('bob');
});

it('upsertPrivateChat updates an existing entry without creating a duplicate', async () => {
  const now = Date.now();
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now
  });
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob2',
    theirColor: 'hsl(3, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now + 1
  });

  const all = await db.privateChats.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].theirUsername).toBe('bob2');
});

it('getPrivateChats returns chats sorted by lastActivity descending', async () => {
  const now = Date.now();
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'b',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now - 10
  });
  await upsertPrivateChat({
    id: 'a:c',
    myPeerId: 'a',
    theirPeerId: 'c',
    theirUsername: 'c',
    theirColor: 'hsl(3, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now
  });

  const chats = await getPrivateChats('a');
  expect(chats.map((c) => c.id)).toEqual(['a:c', 'a:b']);
});

it('deletePrivateChat removes the chat AND all its messages atomically', async () => {
  const now = Date.now();
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: now
  });
  await savePrivateMessage({
    id: 'pm-1',
    chatId: 'a:b',
    direction: 'sent',
    ciphertext: 'CT',
    iv: 'IV',
    timestamp: now,
    delivered: false
  });

  await deletePrivateChat('a:b');
  expect(await getPrivateChat('a:b')).toBeNull();
  expect((await db.privateMessages.where('chatId').equals('a:b').toArray()).length).toBe(0);
});

it('savePrivateMessage stores ciphertext and iv (not plaintext)', async () => {
  const now = Date.now();
  await savePrivateMessage({
    id: 'pm-1',
    chatId: 'a:b',
    direction: 'sent',
    ciphertext: 'CIPH',
    iv: 'IV',
    timestamp: now,
    delivered: false
  });

  const row = await db.privateMessages.get('pm-1');
  expect(row.ciphertext).toBe('CIPH');
  expect(row.iv).toBe('IV');
  expect(row.plaintext).toBeUndefined();
  expect(row.text).toBeUndefined();
});

it('getPrivateMessages returns messages ordered by timestamp ascending', async () => {
  const now = Date.now();
  await savePrivateMessage({
    id: 'pm-1',
    chatId: 'a:b',
    direction: 'received',
    ciphertext: '1',
    iv: 'iv1',
    timestamp: now - 10,
    delivered: true
  });
  await savePrivateMessage({
    id: 'pm-2',
    chatId: 'a:b',
    direction: 'received',
    ciphertext: '2',
    iv: 'iv2',
    timestamp: now,
    delivered: true
  });

  const msgs = await getPrivateMessages('a:b');
  expect(msgs.map((m) => m.id)).toEqual(['pm-1', 'pm-2']);
});

it('getPrivateMessagesPage returns only messages before given timestamp', async () => {
  await savePrivateMessage({ id: 'pm-1', chatId: 'a:b', direction: 'received', ciphertext: '1', iv: '1', timestamp: 10, delivered: true });
  await savePrivateMessage({ id: 'pm-2', chatId: 'a:b', direction: 'received', ciphertext: '2', iv: '2', timestamp: 20, delivered: true });
  await savePrivateMessage({ id: 'pm-3', chatId: 'a:b', direction: 'received', ciphertext: '3', iv: '3', timestamp: 30, delivered: true });

  const page = await getPrivateMessagesPage('a:b', 25, 50);
  expect(page.map((m) => m.timestamp)).toEqual([10, 20]);
});

it('markMessageDelivered updates the delivered field', async () => {
  const now = Date.now();
  await savePrivateMessage({
    id: 'pm-1',
    chatId: 'a:b',
    direction: 'sent',
    ciphertext: 'C',
    iv: 'I',
    timestamp: now,
    delivered: false
  });
  await markMessageDelivered('pm-1');
  const row = await db.privateMessages.get('pm-1');
  expect(row.delivered).toBe(true);
});

it('cleanOldPrivateChats deletes chats older than 30 days', async () => {
  const now = Date.now();
  const oldTs = now - 31 * 24 * 60 * 60 * 1000;
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: oldTs
  });
  await savePrivateMessage({ id: 'pm-1', chatId: 'a:b', direction: 'received', ciphertext: 'x', iv: 'y', timestamp: oldTs, delivered: true });

  const deleted = await cleanOldPrivateChats();
  expect(deleted).toBe(1);
  expect(await getPrivateChat('a:b')).toBeNull();
});

it('cleanOldPrivateChats does NOT delete chats active within 30 days', async () => {
  const now = Date.now();
  const recent = now - 10 * 24 * 60 * 60 * 1000;
  await upsertPrivateChat({
    id: 'a:b',
    myPeerId: 'a',
    theirPeerId: 'b',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    createdAt: now,
    lastActivity: recent
  });
  const deleted = await cleanOldPrivateChats();
  expect(deleted).toBe(0);
  expect(await getPrivateChat('a:b')).not.toBeNull();
});

it('Can save and retrieve known peers', async () => {
  const now = Date.now();
  await saveKnownPeer({ username: 'alice', peerId: 'peer-1', lastSeen: now });
  await saveKnownPeer({ username: 'bob', peerId: 'peer-2', lastSeen: now + 1 });

  const peers = await getKnownPeers();
  expect(peers).toHaveLength(2);
  expect(peers[0].peerId).toBe('peer-2'); // latest first
});
