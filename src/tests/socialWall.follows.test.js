import { get } from 'svelte/store';

import { db } from '$lib/services/db.js';
import { peer } from '$lib/stores/peerStore.js';
import { stablePeerId, user } from '$lib/stores/userStore.js';
import { currentWall, isWallOpen } from '$lib/stores/wall/state.js';
import { followWallOwner, openWall, unfollowWallOwner } from '$lib/stores/wall/actions.js';
import { postWallComment } from '$lib/stores/wall/comments.js';

import * as peerSvc from '$lib/services/peer.js';
import * as social from '$lib/services/peer/social.js';

import { clearAllSocialTables, setPeerState } from './harness/socialHarness.js';

const me = { id: 1, username: 'alice', dateOfBirth: '2004-01-01', color: 'hsl(1, 65%, 65%)', avatarBase64: null, bio: '', createdAt: Date.now() };

beforeEach(async () => {
  await clearAllSocialTables();
  document.body.innerHTML = '';
  currentWall.set(null);
  isWallOpen.set(false);
  user.set(me);
  stablePeerId.set('me');
  setPeerState({ myPeerId: 'me', connected: [] });
  vi.restoreAllMocks();
});

it('Following inserts a follows row; following twice does not duplicate', async () => {
  await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'hsl(2, 65%, 65%)', avatarBase64: null, bio: '' });

  await followWallOwner();
  await followWallOwner();

  const rows = await db.follows.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0].followerPeerId).toBe('me');
  expect(rows[0].targetPeerId).toBe('bobPid');
});

it('Follow state survives reload: openWall reads follower peerId from stablePeerId (not live peerStore.peerId)', async () => {
  await db.follows.add({
    followerPeerId: 'me',
    followerUsername: 'alice',
    targetPeerId: 'bobPid',
    targetUsername: 'bob',
    followedAt: Date.now()
  });

  peer.update((s) => ({ ...s, peerId: null }));

  await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' });
  expect(get(currentWall).isFollowing).toBe(true);
});

it('Unfollowing removes follow row and hard-deletes all own comments on that wall', async () => {
  setPeerState({
    myPeerId: 'me',
    connected: [
      {
        peerId: 'bobPid',
        username: 'bob',
        color: 'x',
        dateOfBirth: '1996-01-01',
        avatarBase64: null,
        bio: '',
        connection: { open: true, send() {} }
      }
    ]
  });

  await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' });
  await followWallOwner();

  await db.wallComments.put({
    id: 'c1',
    wallOwnerPeerId: 'bobPid',
    authorPeerId: 'me',
    authorUsername: 'alice',
    authorColor: 'x',
    authorAvatarBase64: null,
    text: 'hi',
    createdAt: 1,
    editedAt: null,
    deleted: false
  });

  const sendSpy = vi.spyOn(peerSvc, 'sendProtocolEnvelopeToPeer');

  await unfollowWallOwner();

  expect(await db.follows.count()).toBe(0);
  expect(await db.wallComments.get('c1')).toBeUndefined();

  const sentTypes = sendSpy.mock.calls.map((c) => c[1]?.type);
  expect(sentTypes).toContain('WALL_COMMENT_DELETED');
  expect(sentTypes).toContain('UNFOLLOW');
});

it('Auto-follow triggers on first comment post when not already following', async () => {
  setPeerState({
    myPeerId: 'me',
    connected: [{ peerId: 'bobPid', username: 'bob', color: 'x', dateOfBirth: '1996-01-01', avatarBase64: null, bio: '', connection: { open: true, send() {} } }]
  });
  await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' });

  await postWallComment('hello');

  expect(await db.follows.count()).toBe(1);
});

it('FOLLOW received updates local follows table; UNFOLLOW received removes follow row without comment cascade', async () => {
  await db.wallComments.put({
    id: 'c1',
    wallOwnerPeerId: 'me',
    authorPeerId: 'bobPid',
    authorUsername: 'bob',
    authorColor: 'x',
    authorAvatarBase64: null,
    text: 'hi',
    createdAt: 1,
    editedAt: null,
    deleted: false
  });

  await social.handleFollowMessage({
    type: 'FOLLOW',
    from: { peerId: 'bobPid', username: 'bob', color: 'x', dateOfBirth: '1996-01-01' },
    payload: { targetPeerId: 'me', targetUsername: 'alice', followerPeerId: 'bobPid', followerUsername: 'bob', followedAt: Date.now() },
    timestamp: Date.now()
  });
  expect(await db.follows.count()).toBe(1);

  await social.handleUnfollowMessage({
    type: 'UNFOLLOW',
    from: { peerId: 'bobPid', username: 'bob', color: 'x', dateOfBirth: '1996-01-01' },
    payload: { targetPeerId: 'me', followerPeerId: 'bobPid' },
    timestamp: Date.now()
  });
  expect(await db.follows.count()).toBe(0);
  expect(await db.wallComments.get('c1')).toBeTruthy();
});

