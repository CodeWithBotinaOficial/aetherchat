import Dexie from 'dexie';
import { AetherChatDB } from '$lib/services/db.js';

it('DB migration sets replies + edit/delete defaults on existing rows without data loss', async () => {
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
    // Simulate a legacy replies array missing the `deleted` flag on entries.
    replies: [{ messageId: 'orig', authorUsername: 'bob', authorColor: 'hsl(2, 65%, 65%)', textSnapshot: 'x', timestamp: 0 }],
    timestamp: 1
  });
  await old.table('globalMessages').put({
    id: 'g2',
    peerId: 'p2',
    username: 'carol',
    age: 30,
    color: 'hsl(10, 65%, 65%)',
    text: 'no replies field in legacy row',
    timestamp: 2
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
  expect(Array.isArray(g.replies)).toBe(true);
  expect(g.replies?.[0]?.deleted).toBe(false);
  expect(g.editedAt).toBeNull();
  expect(g.deleted).toBe(false);

  const g2 = await db.globalMessages.get('g2');
  expect(g2.text).toContain('no replies');
  expect(g2.replies).toBeNull();
  expect(g2.editedAt).toBeNull();
  expect(g2.deleted).toBe(false);

  const pm = await db.privateMessages.get('pm1');
  expect(pm.ciphertext).toBe('CT');
  expect(pm.replies).toBeNull();
  expect(pm.editedAt).toBeNull();
  expect(pm.deleted).toBe(false);

  await db.delete();
});
