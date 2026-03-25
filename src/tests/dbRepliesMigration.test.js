import Dexie from 'dexie';
import { AetherChatDB } from '$lib/services/db.js';

it('DB migration sets replies: null on existing rows without data loss', async () => {
  const name = `AetherChatDB-mig-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create an "old" DB at version 11 with message rows that do not have `replies`.
  const old = new Dexie(name);
  old.version(11).stores({
    users: 'id, username, createdAt',
    globalMessages: 'id, timestamp, peerId, username',
    privateChats: 'id, myPeerId, myUsername, theirPeerId, theirUsername, createdAt, lastActivity',
    privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
    knownPeers: '++id, peerId, lastSeen, username',
    usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
    peerIds: 'username, peerId',
    queuedMessages: 'id, chatId, theirPeerId, timestamp',
    sentMessagesPlaintext: 'id, chatId, timestamp',
    sessionKeys: 'id, updatedAt'
  });
  await old.open();
  await old.table('globalMessages').put({
    id: 'g1',
    peerId: 'p1',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'hello',
    timestamp: 1
  });
  await old.table('privateMessages').put({
    id: 'pm1',
    chatId: 'alice:bob',
    direction: 'sent',
    ciphertext: 'CT',
    iv: 'IV',
    timestamp: 2,
    delivered: false
  });
  old.close();

  const db = new AetherChatDB(name);
  await db.open();

  const g = await db.globalMessages.get('g1');
  expect(g.text).toBe('hello');
  expect(g.replies).toBeNull();

  const pm = await db.privateMessages.get('pm1');
  expect(pm.ciphertext).toBe('CT');
  expect(pm.replies).toBeNull();

  await db.delete();
});

