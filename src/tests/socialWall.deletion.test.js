import { db } from '$lib/services/db.js';
import { stablePeerId, user } from '$lib/stores/userStore.js';
import { currentWall, isWallOpen } from '$lib/stores/wall/state.js';

import * as peerSvc from '$lib/services/peer.js';
import * as social from '$lib/services/peer/social.js';

import { clearAllSocialTables, setPeerState } from './harness/socialHarness.js';

beforeEach(async () => {
  await clearAllSocialTables();
  document.body.innerHTML = '';
  currentWall.set(null);
  isWallOpen.set(false);
  user.set({ id: 1, username: 'alice', dateOfBirth: '2004-01-01', color: 'hsl(1, 65%, 65%)', avatarBase64: null, bio: '', createdAt: Date.now() });
  stablePeerId.set('me');
  setPeerState({ myPeerId: 'me', connected: [] });
  vi.restoreAllMocks();
});

it('deleteAccount removes all follows and wall comments; remote USER_DELETED cleanup clears social tables', async () => {
  await db.follows.add({
    followerPeerId: 'me',
    followerUsername: 'alice',
    targetPeerId: 'bobPid',
    targetUsername: 'bob',
    followedAt: Date.now()
  });
  await db.follows.add({
    followerPeerId: 'bobPid',
    followerUsername: 'bob',
    targetPeerId: 'me',
    targetUsername: 'alice',
    followedAt: Date.now()
  });
  await db.wallComments.put({
    id: 'c1',
    wallOwnerPeerId: 'bobPid',
    authorPeerId: 'me',
    authorUsername: 'alice',
    authorColor: 'x',
    authorAvatarBase64: null,
    text: 'x',
    createdAt: 1,
    editedAt: null,
    deleted: false
  });
  await db.wallComments.put({
    id: 'c2',
    wallOwnerPeerId: 'me',
    authorPeerId: 'bobPid',
    authorUsername: 'bob',
    authorColor: 'x',
    authorAvatarBase64: null,
    text: 'y',
    createdAt: 2,
    editedAt: null,
    deleted: false
  });

  const { deleteAccount } = await import('$lib/services/profile/actions.js');
  vi.spyOn(peerSvc, 'broadcastUserDeleted').mockImplementation(() => {});
  vi.spyOn(peerSvc, 'disconnectPeer').mockImplementation(() => {});

  const res = await deleteAccount();
  expect(res.ok).toBe(true);
  expect(await db.follows.count()).toBe(0);
  expect(await db.wallComments.count()).toBe(0);

  await db.follows.add({
    followerPeerId: 'bobPid',
    followerUsername: 'bob',
    targetPeerId: 'x',
    targetUsername: 'x',
    followedAt: Date.now()
  });
  await db.wallComments.put({
    id: 'c3',
    wallOwnerPeerId: 'x',
    authorPeerId: 'bobPid',
    authorUsername: 'bob',
    authorColor: 'x',
    authorAvatarBase64: null,
    text: 'z',
    createdAt: 3,
    editedAt: null,
    deleted: false
  });
  await social.handleRemoteUserDeletedSocial('bobPid');
  expect(await db.follows.count()).toBe(0);
  expect(await db.wallComments.count()).toBe(0);
});

