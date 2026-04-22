import { get } from 'svelte/store';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import { db } from '$lib/services/db.js';
import { peer } from '$lib/stores/peerStore.js';
import { user } from '$lib/stores/userStore.js';
import { isProfileOpen } from '$lib/stores/profileStore.js';
import { currentWall, isWallOpen } from '$lib/stores/wall/state.js';
import { openWall, openMyWall, closeWall, followWallOwner, unfollowWallOwner } from '$lib/stores/wall/actions.js';
import { postWallComment, editWallComment, deleteWallComment } from '$lib/stores/wall/comments.js';

import * as peerSvc from '$lib/services/peer.js';
import * as social from '$lib/services/peer/social.js';

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

function setPeerState({ myPeerId = 'me', connected = [] } = {}) {
  const connectedPeers = new Map();
  for (const p of connected) connectedPeers.set(p.peerId, p);
  peer.set({
    peerId: myPeerId,
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    lastSyncAt: null,
    connectedPeers
  });
}

beforeEach(async () => {
  await clearAllTables();
  document.body.innerHTML = '';
  isProfileOpen.set(false);
  currentWall.set(null);
  isWallOpen.set(false);
  user.set({ id: 1, username: 'alice', age: 22, color: 'hsl(1, 65%, 65%)', avatarBase64: null, bio: '', createdAt: Date.now() });
  setPeerState({ myPeerId: 'me', connected: [] });
  vi.restoreAllMocks();
});

it('Following inserts a follows row; following twice does not duplicate', async () => {
  await openWall({ peerId: 'bobPid', username: 'bob', age: 30, color: 'hsl(2, 65%, 65%)', avatarBase64: null, bio: '' });

  await followWallOwner();
  await followWallOwner();

  const rows = await db.follows.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0].followerPeerId).toBe('me');
  expect(rows[0].targetPeerId).toBe('bobPid');
});

it('Unfollowing removes follow row and hard-deletes all own comments on that wall', async () => {
  setPeerState({
    myPeerId: 'me',
    connected: [
      {
        peerId: 'bobPid',
        username: 'bob',
        color: 'x',
        age: 30,
        avatarBase64: null,
        bio: '',
        connection: { open: true, send() {} }
      }
    ]
  });

  await openWall({ peerId: 'bobPid', username: 'bob', age: 30, color: 'x', avatarBase64: null, bio: '' });
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

  // Comment deletion must be sent before UNFOLLOW (both best-effort direct to wall owner).
  const sentTypes = sendSpy.mock.calls.map((c) => c[1]?.type);
  expect(sentTypes).toContain('WALL_COMMENT_DELETED');
  expect(sentTypes).toContain('UNFOLLOW');
});

it('Auto-follow triggers on first comment post when not already following', async () => {
  setPeerState({
    myPeerId: 'me',
    connected: [{ peerId: 'bobPid', username: 'bob', color: 'x', age: 30, avatarBase64: null, bio: '', connection: { open: true, send() {} } }]
  });
  await openWall({ peerId: 'bobPid', username: 'bob', age: 30, color: 'x', avatarBase64: null, bio: '' });

  await postWallComment('hello');

  expect(await db.follows.count()).toBe(1);
});

it('Posting a comment saves to DB and broadcasts WALL_COMMENT_ADDED', async () => {
  await openWall({ peerId: 'bobPid', username: 'bob', age: 30, color: 'x', avatarBase64: null, bio: '' });

  const spy = vi.spyOn(peerSvc, 'broadcastProtocolEnvelope');

  await postWallComment('hello');
  const rows = await db.wallComments.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe('hello');

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][0].type).toBe('WALL_COMMENT_ADDED');
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

  await openWall({ peerId: 'bobPid', username: 'bob', age: 30, color: 'x', avatarBase64: null, bio: '' });
  await editWallComment('c1', 'new');

  const updated = await db.wallComments.get('c1');
  expect(updated.text).toBe('new');
  expect(typeof updated.editedAt).toBe('number');

  // Handler rejects non-author edits.
  await social.handleWallCommentEditedMessage({
    type: 'WALL_COMMENT_EDITED',
    from: { peerId: 'evil', username: 'x', color: 'x', age: 1 },
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

  await openWall({ peerId: 'bobPid', username: 'bob', age: 30, color: 'x', avatarBase64: null, bio: '' });
  await deleteWallComment('c1');

  const soft = await db.wallComments.get('c1');
  expect(soft.deleted).toBe(true);

  // Handler rejects non-author non-owner.
  await db.wallComments.update('c1', { deleted: false });
  await social.handleWallCommentDeletedMessage({
    type: 'WALL_COMMENT_DELETED',
    from: { peerId: 'evil', username: 'x', color: 'x', age: 1 },
    payload: { id: 'c1', wallOwnerPeerId: 'bobPid', authorPeerId: 'me' },
    timestamp: Date.now()
  });
  expect((await db.wallComments.get('c1')).deleted).toBe(false);

  // Wall owner delete is accepted.
  await social.handleWallCommentDeletedMessage({
    type: 'WALL_COMMENT_DELETED',
    from: { peerId: 'bobPid', username: 'bob', color: 'x', age: 30 },
    payload: { id: 'c1', wallOwnerPeerId: 'bobPid', authorPeerId: 'me' },
    timestamp: Date.now()
  });
  expect((await db.wallComments.get('c1')).deleted).toBe(true);
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
    from: { peerId: 'bobPid', username: 'bob', color: 'x', age: 30 },
    payload: { targetPeerId: 'me', targetUsername: 'alice', followerPeerId: 'bobPid', followerUsername: 'bob', followedAt: Date.now() },
    timestamp: Date.now()
  });
  expect(await db.follows.count()).toBe(1);

  await social.handleUnfollowMessage({
    type: 'UNFOLLOW',
    from: { peerId: 'bobPid', username: 'bob', color: 'x', age: 30 },
    payload: { targetPeerId: 'me', followerPeerId: 'bobPid' },
    timestamp: Date.now()
  });
  expect(await db.follows.count()).toBe(0);
  // No cascade on receive.
  expect(await db.wallComments.get('c1')).toBeTruthy();
});

it('WallHeader buttons: Follow/Message absent on own wall; Edit Profile absent on other walls', async () => {
  const WallHeader = (await import('$lib/components/wall/WallHeader.svelte')).default;

  setPeerState({ myPeerId: 'me', connected: [] });
  render(WallHeader, {
    wall: {
      ownerPeerId: 'me',
      ownerUsername: 'alice',
      ownerColor: 'x',
      ownerAge: 22,
      ownerAvatarBase64: null,
      ownerBio: '',
      comments: [],
      followerCount: 0,
      followingCount: 0,
      isFollowing: false,
      isLoading: false,
      isOffline: false,
      isOwner: true
    }
  });

  expect(screen.getByRole('button', { name: /edit profile/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /follow/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /message/i })).toBeNull();

  document.body.innerHTML = '';
  render(WallHeader, {
    wall: {
      ownerPeerId: 'bobPid',
      ownerUsername: 'bob',
      ownerColor: 'x',
      ownerAge: 30,
      ownerAvatarBase64: null,
      ownerBio: '',
      comments: [],
      followerCount: 0,
      followingCount: 0,
      isFollowing: false,
      isLoading: false,
      isOffline: true,
      isOwner: false
    }
  });
  expect(screen.queryByRole('button', { name: /edit profile/i })).toBeNull();
  expect(screen.getByRole('button', { name: /follow/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /message/i })).toBeInTheDocument();
});

it('Opening second wall replaces the first; wall closes on backdrop click and Escape', async () => {
  const WallScreen = (await import('$lib/components/wall/WallScreen.svelte')).default;
  new WallScreen({ target: document.body });

  await openWall({ peerId: 'p1', username: 'u1', age: 1, color: 'x', avatarBase64: null, bio: '' });
  expect(get(currentWall)?.ownerPeerId).toBe('p1');

  await openWall({ peerId: 'p2', username: 'u2', age: 2, color: 'x', avatarBase64: null, bio: '' });
  expect(get(currentWall)?.ownerPeerId).toBe('p2');

  // Backdrop click closes (target === currentTarget).
  const backdrop = await waitFor(() => {
    const el = document.querySelector('.backdrop');
    if (!el) throw new Error('no backdrop');
    return el;
  });
  await fireEvent.click(backdrop);
  expect(get(isWallOpen)).toBe(false);

  // Re-open and close via Escape.
  await openWall({ peerId: 'p2', username: 'u2', age: 2, color: 'x', avatarBase64: null, bio: '' });
  expect(get(isWallOpen)).toBe(true);
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(get(isWallOpen)).toBe(false);
});

it('Navigation: AppShell sidebar opens wall; tooltip View Profile opens correct wall; Edit Profile opens ProfileScreen', async () => {
  const AppShell = (await import('$lib/components/AppShell.svelte')).default;
  const shell = new AppShell({ target: document.body });

  // Sidebar: click my profile row opens my wall.
  const profileBtn = await waitFor(() => {
    const el = document.querySelector('.profile-row');
    if (!el) throw new Error('profile row missing');
    return el;
  });
  await fireEvent.click(profileBtn);
  await waitFor(() => {
    if (!get(isWallOpen)) throw new Error('wall not open yet');
    return true;
  });
  expect(get(currentWall)?.ownerPeerId).toBe('me');
  expect(get(isProfileOpen)).toBe(false);

  closeWall();

  // Tooltip -> View Profile.
  const GlobalChat = (await import('$lib/components/GlobalChat.svelte')).default;
  document.body.innerHTML = '';
  new GlobalChat({ target: document.body });
  await new Promise((r) => setTimeout(r, 30));

  // Inject a remote message.
  const { globalMessages } = await import('$lib/stores/chatStore.js');
  globalMessages.set([
    { id: 'm1', peerId: 'bobPid', username: 'bob', age: 30, color: 'x', avatarBase64: null, text: 'hi', timestamp: Date.now() }
  ]);

  const zone = await waitFor(() => {
    const el = document.querySelector('[data-aether-tooltip-zone="true"]');
    if (!el) throw new Error('tooltip zone missing');
    return el;
  });

  zone.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));
  await waitFor(() => {
    const el = document.querySelector('[data-aether-tooltip="true"]');
    if (!el) throw new Error('tooltip missing');
    return el;
  });

  const viewBtn = screen.getByRole('button', { name: /view profile/i });
  await fireEvent.click(viewBtn);
  await waitFor(() => {
    if (!get(isWallOpen)) throw new Error('wall not open yet');
    if (get(currentWall)?.ownerPeerId !== 'bobPid') throw new Error('wrong wall');
    return true;
  });

  // Own wall: Edit Profile opens ProfileScreen.
  await openMyWall();
  const WallScreen = (await import('$lib/components/wall/WallScreen.svelte')).default;
  new WallScreen({ target: document.body });
  const editBtn = await waitFor(() => screen.getByRole('button', { name: /edit profile/i }));
  await fireEvent.click(editBtn);
  expect(get(isProfileOpen)).toBe(true);

  shell.$destroy();
});

it('deleteAccount removes all follows and wall comments; remote USER_DELETED cleanup clears social tables', async () => {
  // Seed follows and wall comments.
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

  // Local delete cascade.
  const { deleteAccount } = await import('$lib/services/profile/actions.js');
  vi.spyOn(peerSvc, 'broadcastUserDeleted').mockImplementation(() => {});
  vi.spyOn(peerSvc, 'disconnectPeer').mockImplementation(() => {});

  const res = await deleteAccount();
  expect(res.ok).toBe(true);
  expect(await db.follows.count()).toBe(0);
  expect(await db.wallComments.count()).toBe(0);

  // Remote cleanup helper.
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
