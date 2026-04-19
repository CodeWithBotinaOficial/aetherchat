import { fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';

import { db, getDeletionCooldown, isUsernameTaken, registerUsernameLocally, saveUser } from '$lib/services/db.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { user as userStore } from '$lib/stores/userStore.js';
import { deletionCooldownUntil } from '$lib/stores/cooldownStore.js';

import * as peerSvc from '$lib/services/peer.js';
import {
  changeAge,
  changeBio,
  changeUsername,
  deleteAccount
} from '$lib/services/profile/actions.js';

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
        db.cooldown.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await clearAllTables();
  document.body.innerHTML = '';
  userStore.set(null);
  peerStore.set({
    peerId: 'local',
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
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('Username change updates userStore + IndexedDB and moves registry entry', async () => {
  const initial = {
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: null,
    bio: '',
    usernameLastChangedAt: null,
    ageChangedOnce: false,
    createdAt: 10
  };
  await saveUser(initial);
  userStore.set({ ...initial, id: 1 });
  await registerUsernameLocally({ username: 'alice', peerId: 'local', registeredAt: 10, lastSeenAt: 10 });

  const spy = vi.spyOn(peerSvc, 'broadcastUsernameChanged');

  const res = await changeUsername('alice_2');
  expect(res.ok).toBe(true);

  const u = get(userStore);
  expect(u?.username).toBe('alice_2');
  expect(typeof u?.usernameLastChangedAt).toBe('number');

  const row = await db.users.get(1);
  expect(row?.username).toBe('alice_2');
  expect(typeof row?.usernameLastChangedAt).toBe('number');

  expect(await isUsernameTaken('alice')).toBe(false);
  expect(await isUsernameTaken('alice_2')).toBe(true);

  expect(spy).toHaveBeenCalledTimes(1);
});

it('Age change sets ageChangedOnce and then locks', async () => {
  const initial = {
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: null,
    bio: '',
    usernameLastChangedAt: null,
    ageChangedOnce: false,
    createdAt: 10
  };
  await saveUser(initial);
  userStore.set({ ...initial, id: 1 });

  const res = await changeAge(30);
  expect(res.ok).toBe(true);

  const u = get(userStore);
  expect(u?.age).toBe(30);
  expect(u?.ageChangedOnce).toBe(true);

  const row = await db.users.get(1);
  expect(row?.age).toBe(30);
  expect(row?.ageChangedOnce).toBe(true);
});

it('Bio clamps to 120 characters and broadcasts PROFILE_UPDATED', async () => {
  const initial = {
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: null,
    bio: '',
    usernameLastChangedAt: null,
    ageChangedOnce: false,
    createdAt: 10
  };
  await saveUser(initial);
  userStore.set({ ...initial, id: 1 });

  const spy = vi.spyOn(peerSvc, 'broadcastProfileUpdated');

  const long = 'x'.repeat(121);
  const res = await changeBio(long);
  expect(res.ok).toBe(true);

  const u = get(userStore);
  expect(u?.bio?.length).toBe(120);

  expect(spy).toHaveBeenCalledTimes(1);
});

it('ProfileFields disables username input when cooldown is active (<24h)', async () => {
  const ProfileFields = (await import('$lib/components/profile/ProfileFields.svelte')).default;
  const u = {
    id: 1,
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: null,
    bio: '',
    usernameLastChangedAt: Date.now() - 60 * 60 * 1000, // 1h ago
    ageChangedOnce: false,
    createdAt: 10
  };

  render(ProfileFields, { user: u });

  const usernameInput = screen.getByPlaceholderText(/night_owl/i);
  expect(usernameInput).toBeDisabled();
  expect(screen.getByText(/You can change your username again in/i)).toBeInTheDocument();
});

it('ProfileFields disables age input when ageChangedOnce is true', async () => {
  const ProfileFields = (await import('$lib/components/profile/ProfileFields.svelte')).default;
  const u = {
    id: 1,
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: null,
    bio: '',
    usernameLastChangedAt: null,
    ageChangedOnce: true,
    createdAt: 10
  };

  render(ProfileFields, { user: u });
  const ageInput = screen.getByRole('spinbutton');
  expect(ageInput).toBeDisabled();
  expect(screen.getByText(/This field is locked/i)).toBeInTheDocument();
});

it('Delete confirmation button is disabled until typed username matches exactly (case-sensitive)', async () => {
  const ProfileDangerZone = (await import('$lib/components/profile/ProfileDangerZone.svelte')).default;

  const u = { id: 1, username: 'Alice' };
  render(ProfileDangerZone, { user: u });

  await fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

  const input = screen.getByLabelText(/type your username/i);
  const confirm = screen.getByRole('button', { name: /permanently delete my account/i });

  expect(confirm).toBeDisabled();
  await fireEvent.input(input, { target: { value: 'alice' } });
  expect(confirm).toBeDisabled();
  await fireEvent.input(input, { target: { value: 'Alice' } });
  expect(confirm).not.toBeDisabled();
});

it('deleteAccount clears user data and sets cooldown.until ~= now + 48h', async () => {
  const now = Date.now();
  const initial = {
    username: 'alice',
    age: 22,
    color: 'hsl(1, 65%, 65%)',
    avatarBase64: null,
    bio: '',
    usernameLastChangedAt: null,
    ageChangedOnce: false,
    createdAt: 10
  };
  await saveUser(initial);
  userStore.set({ ...initial, id: 1 });

  await registerUsernameLocally({ username: 'alice', peerId: 'local', registeredAt: 10, lastSeenAt: 10 });
  await db.peerIds.put({ username: 'alice', peerId: 'local' });
  await db.knownPeers.add({ username: 'bob', peerId: 'p2', lastSeen: Date.now() });
  await db.globalMessages.put({ id: 'm1', peerId: 'local', username: 'alice', age: 22, color: 'x', text: 'hi', timestamp: Date.now() });
  await db.privateChats.put({
    id: 'alice:bob',
    myPeerId: 'local',
    myUsername: 'alice',
    theirPeerId: 'p2',
    theirUsername: 'bob',
    theirColor: 'x',
    theirAvatarBase64: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  });
  await db.privateMessages.put({ id: 'pm1', chatId: 'alice:bob', direction: 'sent', ciphertext: 'c', iv: 'i', timestamp: Date.now(), delivered: false });
  await db.queuedMessages.put({ id: 'q1', chatId: 'alice:bob', theirPeerId: 'p2', plaintext: 'x', timestamp: Date.now() });
  await db.queuedActions.put({ id: 'qa1', chatId: 'alice:bob', theirPeerId: 'p2', kind: 'edit', messageId: 'pm1', plaintext: 'y', timestamp: Date.now() });

  let broadcasted = false;
  vi.spyOn(peerSvc, 'broadcastUserDeleted').mockImplementation(() => { broadcasted = true; });
  const whereOriginal = db.globalMessages.where.bind(db.globalMessages);
  vi.spyOn(db.globalMessages, 'where').mockImplementation((...args) => {
    expect(broadcasted).toBe(true);
    return whereOriginal(...args);
  });

  const res = await deleteAccount();
  expect(res.ok).toBe(true);

  expect(get(userStore)).toBeNull();
  expect(await db.users.get(1)).toBeUndefined();

  expect(await db.globalMessages.count()).toBe(0);
  expect(await db.privateChats.count()).toBe(0);
  expect(await db.privateMessages.count()).toBe(0);
  expect(await db.queuedMessages.count()).toBe(0);
  expect(await db.queuedActions.count()).toBe(0);
  expect(await db.usernameRegistry.count()).toBe(0);
  expect(await db.peerIds.count()).toBe(0);
  expect(await db.knownPeers.count()).toBe(0);

  const cd = await getDeletionCooldown();
  expect(cd).not.toBeNull();
  expect(typeof cd?.until).toBe('number');
  expect(cd.until).toBeGreaterThan(now + 47.5 * 60 * 60 * 1000);
  expect(cd.until).toBeLessThan(now + 48.5 * 60 * 60 * 1000);

  expect(get(deletionCooldownUntil)).toBe(cd.until);
});

it('USER_DELETED is ignored when from.peerId does not match registry peerId', async () => {
  await registerUsernameLocally({ username: 'bob', peerId: 'p_real', registeredAt: 1, lastSeenAt: 2 });
  expect(await isUsernameTaken('bob')).toBe(true);

  await peerSvc.handleMessage(
    {
      type: 'USER_DELETED',
      from: { peerId: 'p_evil', username: 'bob', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: { username: 'bob', peerId: 'p_evil' },
      timestamp: Date.now()
    },
    null,
    { username: 'local', color: 'hsl(1, 65%, 65%)', age: 1 }
  );

  expect(await isUsernameTaken('bob')).toBe(true);
});

it('Receiving USERNAME_CHANGED updates the local registry', async () => {
  await registerUsernameLocally({ username: 'old', peerId: 'p1', registeredAt: 1, lastSeenAt: 2 });
  expect(await isUsernameTaken('old')).toBe(true);
  expect(await isUsernameTaken('new')).toBe(false);

  await peerSvc.handleMessage(
    {
      type: 'USERNAME_CHANGED',
      from: { peerId: 'p1', username: 'new', color: 'hsl(2, 65%, 65%)', age: 1 },
      payload: { oldUsername: 'old', newUsername: 'new', peerId: 'p1', changedAt: 10 },
      timestamp: 11
    },
    null,
    { username: 'local', color: 'hsl(1, 65%, 65%)', age: 1 }
  );

  expect(await isUsernameTaken('old')).toBe(false);
  expect(await isUsernameTaken('new')).toBe(true);
});

