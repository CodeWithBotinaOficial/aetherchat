import { render, screen } from '@testing-library/svelte';

import { db } from '$lib/services/db.js';
import { peer } from '$lib/stores/peerStore.js';
import { stablePeerId, user } from '$lib/stores/userStore.js';
import { openWall } from '$lib/stores/wall/actions.js';
import { currentWall, isWallOpen } from '$lib/stores/wall/state.js';
import { deleteWallComment, editWallComment, postWallComment } from '$lib/stores/wall/comments.js';
import WallComments from '$lib/components/wall/WallComments.svelte';

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

it('Posting a comment saves to DB and broadcasts WALL_COMMENT_ADDED', async () => {
  await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' });

  const spy = vi.spyOn(peerSvc, 'broadcastProtocolEnvelope');

  await postWallComment('hello');
  const rows = await db.wallComments.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe('hello');

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][0].type).toBe('WALL_COMMENT_ADDED');
});

it('Own comment edit/delete permissions use stablePeerId (not live peerStore.peerId)', async () => {
  stablePeerId.set('me');
  peer.update((s) => ({ ...s, peerId: null }));

  const wall = {
    ownerPeerId: 'bobPid',
    ownerUsername: 'bob',
    ownerColor: 'x',
    ownerDateOfBirth: '1996-01-01',
    ownerAvatarBase64: null,
    ownerBio: '',
    comments: [
      {
        id: 'c1',
        wallOwnerPeerId: 'bobPid',
        authorPeerId: 'me',
        authorUsername: 'alice',
        authorColor: 'x',
        authorAvatarBase64: null,
        text: 'hi',
        createdAt: Date.now(),
        editedAt: null,
        deleted: false
      }
    ],
    followerCount: 0,
    followingCount: 0,
    isFollowing: false,
    isLoading: false,
    isOffline: false,
    isOwner: false
  };

  render(WallComments, { wall });
  expect(screen.getByText('Edit')).toBeInTheDocument();
  expect(screen.getByText('Delete')).toBeInTheDocument();
});

it('Editing updates text and sets editedAt; non-author edit is rejected by handler', async () => {
  await db.wallComments.put({
    id: 'c1',
    wallOwnerPeerId: 'bobPid',
    authorPeerId: 'me',
    authorUsername: 'alice',
    authorColor: 'x',
    authorAvatarBase64: null,
    text: 'old',
    createdAt: 1,
    editedAt: null,
    deleted: false
  });

  await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' });
  await editWallComment('c1', 'new');

  const updated = await db.wallComments.get('c1');
  expect(updated.text).toBe('new');
  expect(typeof updated.editedAt).toBe('number');

  await social.handleWallCommentEditedMessage({
    type: 'WALL_COMMENT_EDITED',
    from: { peerId: 'evil', username: 'x', color: 'x', dateOfBirth: '2025-01-01' },
    payload: { id: 'c1', wallOwnerPeerId: 'bobPid', text: 'hacked', editedAt: Date.now() },
    timestamp: Date.now()
  });
  const after = await db.wallComments.get('c1');
  expect(after.text).toBe('new');
});

it('Comment author can delete; wall owner can delete any; non-author non-owner delete is rejected by handler', async () => {
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

  await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' });
  await deleteWallComment('c1');

  const soft = await db.wallComments.get('c1');
  expect(soft.deleted).toBe(true);

  await db.wallComments.update('c1', { deleted: false });
  await social.handleWallCommentDeletedMessage({
    type: 'WALL_COMMENT_DELETED',
    from: { peerId: 'evil', username: 'x', color: 'x', dateOfBirth: '2025-01-01' },
    payload: { id: 'c1', wallOwnerPeerId: 'bobPid', authorPeerId: 'me' },
    timestamp: Date.now()
  });
  expect((await db.wallComments.get('c1')).deleted).toBe(false);

  await social.handleWallCommentDeletedMessage({
    type: 'WALL_COMMENT_DELETED',
    from: { peerId: 'bobPid', username: 'bob', color: 'x', dateOfBirth: '1996-01-01' },
    payload: { id: 'c1', wallOwnerPeerId: 'bobPid', authorPeerId: 'me' },
    timestamp: Date.now()
  });
  expect((await db.wallComments.get('c1')).deleted).toBe(true);
});
