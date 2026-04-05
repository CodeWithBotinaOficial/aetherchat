import { get } from 'svelte/store';
import { snapshotText } from '$lib/utils/replies.js';
import {
  CITED_DELETED_PLACEHOLDER as GLOBAL_CITED_DELETED,
  GLOBAL_DELETED_PLACEHOLDER,
  cascadeUpdateCitations as cascadeGlobal,
  deleteMessage as deleteGlobal,
  globalMessages,
  pendingReplies as globalPendingReplies,
  updateMessage as updateGlobal
} from '$lib/stores/chatStore.js';
import {
  CITED_DELETED_PLACEHOLDER as PRIVATE_CITED_DELETED,
  PRIVATE_DELETED_PLACEHOLDER,
  cascadeUpdateCitations as cascadePrivate,
  deleteMessage as deletePrivate,
  privateChatStore,
  updateMessage as updatePrivate
} from '$lib/stores/privateChatStore.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'));
  globalMessages.set([]);
  globalPendingReplies.set([]);
  privateChatStore.set({ chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
});

it('global updateMessage updates text + editedAt without changing message position', () => {
  const now = Date.now();
  globalMessages.set([
    { id: 'm1', peerId: 'p', username: 'alice', age: 1, color: 'hsl(0,0%,60%)', text: 'a', timestamp: now - 1000, replies: null },
    { id: 'm2', peerId: 'p', username: 'bob', age: 1, color: 'hsl(0,0%,60%)', text: 'b', timestamp: now - 900, replies: null }
  ]);

  const ok = updateGlobal('m1', { text: 'edited', editedAt: now }, 'alice');
  expect(ok).toBe(true);
  const msgs = get(globalMessages);
  expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2']);
  expect(msgs[0].text).toBe('edited');
  expect(msgs[0].editedAt).toBe(now);
});

it('global deleteMessage soft-deletes and does not remove from array', () => {
  const now = Date.now();
  globalMessages.set([
    { id: 'm1', peerId: 'p', username: 'alice', age: 1, color: 'hsl(0,0%,60%)', text: 'a', timestamp: now - 1000, replies: null },
    { id: 'm2', peerId: 'p', username: 'bob', age: 1, color: 'hsl(0,0%,60%)', text: 'b', timestamp: now - 900, replies: null }
  ]);

  const ok = deleteGlobal('m1', 'alice');
  expect(ok).toBe(true);
  const msgs = get(globalMessages);
  expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2']);
  expect(msgs[0].deleted).toBe(true);
  expect(msgs[0].text).toBe(GLOBAL_DELETED_PLACEHOLDER);
});

it('global cascadeUpdateCitations updates textSnapshot on edit and marks deleted on delete', () => {
  const now = Date.now();
  globalMessages.set([
    { id: 'orig', peerId: 'p', username: 'bob', age: 1, color: 'hsl(0,0%,60%)', text: 'orig', timestamp: now - 2000, replies: null },
    {
      id: 'citer',
      peerId: 'p',
      username: 'alice',
      age: 1,
      color: 'hsl(0,0%,60%)',
      text: 'cites',
      timestamp: now - 1000,
      replies: [{ messageId: 'orig', authorUsername: 'bob', authorColor: 'hsl(0,0%,60%)', textSnapshot: 'old', timestamp: now - 2000 }]
    }
  ]);
  globalPendingReplies.set([{ messageId: 'orig', authorUsername: 'bob', authorColor: 'hsl(0,0%,60%)', textSnapshot: 'old', timestamp: now - 2000 }]);

  cascadeGlobal('orig', { newSnapshot: 'updated text here' });
  let citer = get(globalMessages).find((m) => m.id === 'citer');
  expect(citer.replies[0].deleted).toBe(false);
  expect(citer.replies[0].textSnapshot).toBe(snapshotText('updated text here', 120));
  expect(get(globalPendingReplies)[0].textSnapshot).toBe(snapshotText('updated text here', 120));

  cascadeGlobal('orig', { deleted: true });
  citer = get(globalMessages).find((m) => m.id === 'citer');
  expect(citer.replies[0].deleted).toBe(true);
  expect(citer.replies[0].textSnapshot).toBe(GLOBAL_CITED_DELETED);
  expect(get(globalPendingReplies)[0].deleted).toBe(true);
  expect(get(globalPendingReplies)[0].textSnapshot).toBe(GLOBAL_CITED_DELETED);
});

it('global store guard rejects edit/delete from non-author', () => {
  const now = Date.now();
  globalMessages.set([{ id: 'm1', peerId: 'p', username: 'alice', age: 1, color: 'x', text: 'a', timestamp: now - 1000, replies: null }]);

  expect(updateGlobal('m1', { text: 'nope', editedAt: now }, 'bob')).toBe(false);
  expect(deleteGlobal('m1', 'bob')).toBe(false);
  expect(get(globalMessages)[0].text).toBe('a');
});

it('private updateMessage/deleteMessage apply only to the correct actor side and preserve position', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'p2',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [
            { id: 's1', direction: 'sent', text: 'hi', timestamp: 1, delivered: true, editedAt: null, deleted: false, sealed: false },
            { id: 'r1', direction: 'received', text: 'yo', timestamp: 2, delivered: true, editedAt: null, deleted: false, sealed: false }
          ],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 2,
          isOnline: true,
          keyExchangeState: 'active',
          pendingReplies: [],
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  const okMine = updatePrivate('a:b', 's1', { text: 'edited', editedAt: 123 }, 'me');
  expect(okMine).toBe(true);
  const okWrong = updatePrivate('a:b', 'r1', { text: 'hacked' }, 'me');
  expect(okWrong).toBe(false);

  const okDelWrong = deletePrivate('a:b', 's1', 'them');
  expect(okDelWrong).toBe(false);

  const okDelMine = deletePrivate('a:b', 's1', 'me');
  expect(okDelMine).toBe(true);
  const msgs = get(privateChatStore).chats.get('a:b').messages;
  expect(msgs.map((m) => m.id)).toEqual(['s1', 'r1']);
  expect(msgs[0].deleted).toBe(true);
  expect(msgs[0].text).toBe(PRIVATE_DELETED_PLACEHOLDER);
});

it('private cascadeUpdateCitations updates textSnapshot on edit and marks deleted on delete', () => {
  privateChatStore.set({
    chats: new Map([
      [
        'a:b',
        {
          id: 'a:b',
          theirPeerId: 'p2',
          theirUsername: 'bob',
          theirColor: 'hsl(2, 65%, 65%)',
          theirAvatarBase64: null,
          messages: [
            { id: 'orig', direction: 'received', text: 'orig', timestamp: 1, delivered: true, editedAt: null, deleted: false, sealed: false },
            {
              id: 'citer',
              direction: 'sent',
              text: 'cites',
              timestamp: 2,
              delivered: true,
              editedAt: null,
              deleted: false,
              sealed: false,
              replies: [{ messageId: 'orig', authorUsername: 'bob', authorColor: 'x', textSnapshot: 'old', timestamp: 1 }]
            }
          ],
          unreadCount: 0,
          lastMessage: null,
          lastActivity: 2,
          isOnline: true,
          keyExchangeState: 'active',
          pendingReplies: [{ messageId: 'orig', authorUsername: 'bob', authorColor: 'x', textSnapshot: 'old', timestamp: 1 }],
          __loaded: true
        }
      ]
    ]),
    activeChatId: 'a:b',
    pendingKeyExchanges: new Map()
  });

  cascadePrivate('a:b', 'orig', { newSnapshot: 'updated' });
  let citer = get(privateChatStore).chats.get('a:b').messages.find((m) => m.id === 'citer');
  expect(citer.replies[0].deleted).toBe(false);
  expect(citer.replies[0].textSnapshot).toBe(snapshotText('updated', 120));

  cascadePrivate('a:b', 'orig', { deleted: true });
  citer = get(privateChatStore).chats.get('a:b').messages.find((m) => m.id === 'citer');
  expect(citer.replies[0].deleted).toBe(true);
  expect(citer.replies[0].textSnapshot).toBe(PRIVATE_CITED_DELETED);
});

