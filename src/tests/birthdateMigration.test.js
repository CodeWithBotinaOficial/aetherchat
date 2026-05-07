import Dexie from 'dexie';
import { AetherChatDB } from '$lib/services/db.js';

it('DB migration v17 backfills dateOfBirth from age and removes age fields', async () => {
  const name = `AetherChatDB-dob-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create an "old" DB at version 16 with `age` fields.
  const old = new Dexie(name);
  old.version(16).stores({
    users: 'id, username, createdAt',
    globalMessages: 'id, timestamp, peerId, username',
    privateChats: 'id, myPeerId, myUsername, theirPeerId, theirUsername, createdAt, lastActivity',
    privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
    knownPeers: '++id, peerId, lastSeen, username',
    usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
    peerIds: 'username, peerId',
    queuedMessages: 'id, chatId, theirPeerId, timestamp',
    queuedActions: 'id, chatId, theirPeerId, timestamp, kind',
    sentMessagesPlaintext: 'id, chatId, timestamp',
    sessionKeys: 'id, updatedAt',
    cooldown: 'id',
    follows: '++id, followerPeerId, targetPeerId, [followerPeerId+targetPeerId]',
    wallComments: 'id, wallOwnerPeerId, authorPeerId, createdAt, [wallOwnerPeerId+authorPeerId], [wallOwnerPeerId+createdAt]'
  });
  await old.open();

  await old.table('users').put({
    id: 1,
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: null,
    bio: '',
    usernameLastChangedAt: null,
    ageChangedOnce: false,
    createdAt: 1
  });
  await old.table('globalMessages').put({
    id: 'g1',
    peerId: 'p1',
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    text: 'hello',
    replies: null,
    timestamp: 1
  });
  await old.table('privateChats').put({
    id: 'alice:bob',
    myPeerId: 'p_me',
    myUsername: 'alice',
    theirPeerId: 'p_them',
    theirUsername: 'bob',
    theirColor: 'hsl(2, 65%, 65%)',
    theirAvatarBase64: null,
    theirAge: 30,
    createdAt: 1,
    lastActivity: 1
  });

  old.close();

  const db = new AetherChatDB(name);
  await db.open();

  const u = await db.users.get(1);
  expect(u?.username).toBe('alice');
  expect(Object.prototype.hasOwnProperty.call(u ?? {}, 'age')).toBe(false);
  expect(typeof u?.dateOfBirth === 'string' || u?.dateOfBirth === null).toBe(true);

  const g = await db.globalMessages.get('g1');
  expect(g?.text).toBe('hello');
  expect(Object.prototype.hasOwnProperty.call(g ?? {}, 'age')).toBe(false);
  expect(typeof g?.dateOfBirth === 'string' || g?.dateOfBirth === null).toBe(true);

  const c = await db.privateChats.get('alice:bob');
  expect(Object.prototype.hasOwnProperty.call(c ?? {}, 'theirAge')).toBe(false);
  expect(typeof c?.theirDateOfBirth === 'string' || c?.theirDateOfBirth === null).toBe(true);

  await db.delete();
});

