import { get } from 'svelte/store';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import { db } from '$lib/services/db.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { stablePeerId, user } from '$lib/stores/userStore.js';
import { privateChatStore } from '$lib/stores/privateChatStore.js';
import {
  __setFollowingForTests,
  followingPeerIds,
  isFollowing,
  loadFollowState
} from '$lib/stores/wall/followState.js';
import { followPeer, followWallOwner, openWall, unfollowWallOwner } from '$lib/stores/wall/actions.js';

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

const me = { id: 1, username: 'alice', dateOfBirth: '2004-01-01', color: 'hsl(1, 65%, 65%)', avatarBase64: null, bio: '', createdAt: Date.now() };

beforeEach(async () => {
  await clearAllTables();
  document.body.innerHTML = '';

  user.set(me);
  stablePeerId.set('me');
  peerStore.set({
    peerId: 'me',
    isConnected: true,
    connectionState: 'connected',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    lastSyncAt: null,
    connectedPeers: new Map()
  });

  privateChatStore.set({ chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() });
  __setFollowingForTests([]);
});

describe('followState store', () => {
  it('followingPeerIds is empty on boot with no follows in DB', async () => {
    await loadFollowState('me');
    expect(get(followingPeerIds).size).toBe(0);
  });

  it('followingPeerIds is populated after loading follows from DB', async () => {
    await db.follows.add({
      followerPeerId: 'me',
      followerUsername: 'alice',
      targetPeerId: 'bobPid',
      targetUsername: 'bob',
      followedAt: Date.now()
    });
    await loadFollowState('me');
    expect(get(followingPeerIds).has('bobPid')).toBe(true);
  });

  it('Following a user adds their peerId to the set reactively', async () => {
    await followPeer({ peerId: 'bobPid', username: 'bob' });
    expect(get(followingPeerIds).has('bobPid')).toBe(true);
  });

  it('Unfollowing a user removes their peerId from the set reactively', async () => {
    await openWall({ peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' });
    await followWallOwner();
    expect(get(followingPeerIds).has('bobPid')).toBe(true);

    await unfollowWallOwner();
    expect(get(followingPeerIds).has('bobPid')).toBe(false);
  });

  it('isFollowing(peerId) returns true for followed peers, false for others', async () => {
    await followPeer({ peerId: 'bobPid', username: 'bob' });
    expect(isFollowing('bobPid')).toBe(true);
    expect(isFollowing('nope')).toBe(false);
  });
});

describe('UserTooltip', () => {
  it('Follow button is shown when not following the target; Start Private Chat is hidden', async () => {
    const UserTooltip = (await import('$lib/components/UserTooltip.svelte')).default;
    __setFollowingForTests([]);

    render(UserTooltip, {
      user: { peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' },
      position: { x: 30, y: 30 }
    });

    expect(screen.getByRole('button', { name: /follow/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start private chat/i })).toBeNull();
  });

  it('Follow button is hidden when already following the target; Start Private Chat is shown', async () => {
    const UserTooltip = (await import('$lib/components/UserTooltip.svelte')).default;
    __setFollowingForTests(['bobPid']);

    render(UserTooltip, {
      user: { peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, bio: '' },
      position: { x: 30, y: 30 }
    });

    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull();
    expect(screen.getByRole('button', { name: /start private chat/i })).toBeInTheDocument();
  });
});

describe('WallHeader', () => {
  it('Message button is hidden when not following the wall owner', async () => {
    const WallHeader = (await import('$lib/components/wall/WallHeader.svelte')).default;
    __setFollowingForTests([]);

    render(WallHeader, {
      wall: {
        ownerPeerId: 'bobPid',
        ownerUsername: 'bob',
        ownerColor: 'x',
        ownerDateOfBirth: '1996-01-01',
        ownerAvatarBase64: null,
        ownerBio: '',
        comments: [],
        followerCount: 0,
        followingCount: 0,
        isFollowing: false,
        isLoading: false,
        isOffline: false,
        isOwner: false
      }
    });

    expect(screen.queryByRole('button', { name: /message/i })).toBeNull();
  });

  it('Message button is shown when following the wall owner', async () => {
    const WallHeader = (await import('$lib/components/wall/WallHeader.svelte')).default;
    __setFollowingForTests(['bobPid']);

    render(WallHeader, {
      wall: {
        ownerPeerId: 'bobPid',
        ownerUsername: 'bob',
        ownerColor: 'x',
        ownerDateOfBirth: '1996-01-01',
        ownerAvatarBase64: null,
        ownerBio: '',
        comments: [],
        followerCount: 0,
        followingCount: 0,
        isFollowing: true,
        isLoading: false,
        isOffline: false,
        isOwner: false
      }
    });

    expect(screen.getByRole('button', { name: /message/i })).toBeInTheDocument();
  });
});

describe('PrivateChatWindow gating', () => {
  it('Blocked view is shown when user does not follow the chat partner; ChatInput is not rendered; Delete button is available', async () => {
    const PrivateChatWindow = (await import('$lib/components/PrivateChatWindow.svelte')).default;
    __setFollowingForTests([]);

    privateChatStore.set({
      chats: new Map([
        [
          'c1',
          {
            id: 'c1',
            theirPeerId: 'bobPid',
            theirUsername: 'bob',
            theirColor: 'x',
            theirAvatarBase64: null,
            theirDateOfBirth: null,
            messages: [{ id: 'm1', direction: 'received', text: '🔒 Encrypted message', timestamp: 1, delivered: true, editedAt: null, deleted: false, sealed: true }],
            unreadCount: 0,
            lastMessage: 'hi',
            lastActivity: Date.now(),
            isOnline: false,
            keyExchangeState: 'active',
            pendingReplies: [],
            queuedActions: [],
            __loaded: true
          }
        ]
      ]),
      activeChatId: 'c1',
      pendingKeyExchanges: new Map()
    });

    render(PrivateChatWindow);

    expect(screen.getByRole('button', { name: /follow/i })).toBeInTheDocument();
    expect(screen.getByText(/delete conversation/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Normal chat view is shown when user follows the chat partner', async () => {
    const PrivateChatWindow = (await import('$lib/components/PrivateChatWindow.svelte')).default;
    __setFollowingForTests(['bobPid']);

    privateChatStore.set({
      chats: new Map([
        [
          'c1',
          {
            id: 'c1',
            theirPeerId: 'bobPid',
            theirUsername: 'bob',
            theirColor: 'x',
            theirAvatarBase64: null,
            theirDateOfBirth: null,
            messages: [],
            unreadCount: 0,
            lastMessage: null,
            lastActivity: Date.now(),
            isOnline: false,
            keyExchangeState: 'active',
            pendingReplies: [],
            queuedActions: [],
            __loaded: true
          }
        ]
      ]),
      activeChatId: 'c1',
      pendingKeyExchanges: new Map()
    });

    render(PrivateChatWindow);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // Normal view has a delete icon button, but it should not show the blocked-view "Delete conversation" text button.
    expect(screen.queryByText(/^delete conversation$/i)).toBeNull();
  });

  it('Blocked view shows correct message for never-followed scenario', async () => {
    const PrivateChatWindow = (await import('$lib/components/PrivateChatWindow.svelte')).default;
    __setFollowingForTests([]);

    privateChatStore.set({
      chats: new Map([
        [
          'c1',
          {
            id: 'c1',
            theirPeerId: 'bobPid',
            theirUsername: 'bob',
            theirColor: 'x',
            theirAvatarBase64: null,
            theirDateOfBirth: null,
            messages: [{ id: 'm1', direction: 'received', text: 'x', timestamp: 1, delivered: true, editedAt: null, deleted: false, sealed: true }],
            unreadCount: 0,
            lastMessage: 'x',
            lastActivity: Date.now(),
            isOnline: false,
            keyExchangeState: 'active',
            pendingReplies: [],
            queuedActions: [],
            __loaded: true
          }
        ]
      ]),
      activeChatId: 'c1',
      pendingKeyExchanges: new Map()
    });

    render(PrivateChatWindow);
    expect(screen.getByText(/to see this message, you must follow this person back\./i)).toBeInTheDocument();
  });

  it('Blocked view shows correct message for unfollowed scenario', async () => {
    const PrivateChatWindow = (await import('$lib/components/PrivateChatWindow.svelte')).default;
    __setFollowingForTests([]);

    privateChatStore.set({
      chats: new Map([
        [
          'c1',
          {
            id: 'c1',
            theirPeerId: 'bobPid',
            theirUsername: 'bob',
            theirColor: 'x',
            theirAvatarBase64: null,
            theirDateOfBirth: null,
            messages: [
              { id: 'm1', direction: 'sent', text: 'hi', timestamp: 1, delivered: false, editedAt: null, deleted: false, sealed: false },
              { id: 'm2', direction: 'received', text: 'yo', timestamp: 2, delivered: true, editedAt: null, deleted: false, sealed: false }
            ],
            unreadCount: 0,
            lastMessage: 'yo',
            lastActivity: Date.now(),
            isOnline: false,
            keyExchangeState: 'active',
            pendingReplies: [],
            queuedActions: [],
            __loaded: true
          }
        ]
      ]),
      activeChatId: 'c1',
      pendingKeyExchanges: new Map()
    });

    render(PrivateChatWindow);
    expect(screen.getByText(/to recover this chat, you must follow this person\./i)).toBeInTheDocument();
  });

  it('Following the user from blocked view switches to normal view reactively', async () => {
    const PrivateChatWindow = (await import('$lib/components/PrivateChatWindow.svelte')).default;
    __setFollowingForTests([]);

    privateChatStore.set({
      chats: new Map([
        [
          'c1',
          {
            id: 'c1',
            theirPeerId: 'bobPid',
            theirUsername: 'bob',
            theirColor: 'x',
            theirAvatarBase64: null,
            theirDateOfBirth: null,
            messages: [{ id: 'm1', direction: 'received', text: 'x', timestamp: 1, delivered: true, editedAt: null, deleted: false, sealed: true }],
            unreadCount: 0,
            lastMessage: 'x',
            lastActivity: Date.now(),
            isOnline: false,
            keyExchangeState: 'active',
            pendingReplies: [],
            queuedActions: [],
            __loaded: true
          }
        ]
      ]),
      activeChatId: 'c1',
      pendingKeyExchanges: new Map()
    });

    render(PrivateChatWindow);
    expect(screen.queryByRole('textbox')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /^follow$/i }));

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });
});

describe('PrivateChatList', () => {
  it('Gated chat shows lock icon and "Follow to read" when user does not follow partner; lock disappears reactively when followed', async () => {
    const PrivateChatList = (await import('$lib/components/PrivateChatList.svelte')).default;
    __setFollowingForTests([]);

    privateChatStore.set({
      chats: new Map([
        [
          'c1',
          {
            id: 'c1',
            theirPeerId: 'bobPid',
            theirUsername: 'bob',
            theirColor: 'x',
            theirAvatarBase64: null,
            theirDateOfBirth: null,
            messages: [],
            unreadCount: 0,
            lastMessage: 'hello',
            lastActivity: Date.now(),
            isOnline: false,
            keyExchangeState: 'active',
            pendingReplies: [],
            queuedActions: [],
            __loaded: true
          }
        ]
      ]),
      activeChatId: null,
      pendingKeyExchanges: new Map()
    });

    render(PrivateChatList);

    expect(screen.getByText(/follow to read/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/locked/i)).toBeInTheDocument();

    __setFollowingForTests(['bobPid']);

    await waitFor(() => {
      expect(screen.queryByText(/follow to read/i)).toBeNull();
      expect(screen.queryByLabelText(/locked/i)).toBeNull();
    });
  });
});
