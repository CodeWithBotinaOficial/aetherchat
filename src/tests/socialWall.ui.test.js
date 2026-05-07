import { get } from 'svelte/store';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import { stablePeerId, user } from '$lib/stores/userStore.js';
import { isProfileOpen } from '$lib/stores/profileStore.js';
import { currentWall, isWallOpen } from '$lib/stores/wall/state.js';
import { closeWall, openMyWall, openWall } from '$lib/stores/wall/actions.js';

import { clearAllSocialTables, setPeerState } from './harness/socialHarness.js';

beforeEach(async () => {
  await clearAllSocialTables();
  document.body.innerHTML = '';
  isProfileOpen.set(false);
  currentWall.set(null);
  isWallOpen.set(false);
  user.set({ id: 1, username: 'alice', dateOfBirth: '2004-01-01', color: 'hsl(1, 65%, 65%)', avatarBase64: null, bio: '', createdAt: Date.now() });
  stablePeerId.set('me');
  setPeerState({ myPeerId: 'me', connected: [] });
  vi.restoreAllMocks();
});

it('WallHeader buttons: Follow/Message absent on own wall; Edit Profile absent on other walls', async () => {
  const WallHeader = (await import('$lib/components/wall/WallHeader.svelte')).default;

  setPeerState({ myPeerId: 'me', connected: [] });
  render(WallHeader, {
    wall: {
      ownerPeerId: 'me',
      ownerUsername: 'alice',
      ownerColor: 'x',
      ownerDateOfBirth: '2004-01-01',
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
      ownerDateOfBirth: '1996-01-01',
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

  await openWall({ peerId: 'p1', username: 'u1', dateOfBirth: '2020-01-01', color: 'x', avatarBase64: null, bio: '' });
  expect(get(currentWall)?.ownerPeerId).toBe('p1');

  await openWall({ peerId: 'p2', username: 'u2', dateOfBirth: '2019-01-01', color: 'x', avatarBase64: null, bio: '' });
  expect(get(currentWall)?.ownerPeerId).toBe('p2');

  const backdrop = await waitFor(() => {
    const el = document.querySelector('.backdrop');
    if (!el) throw new Error('no backdrop');
    return el;
  });
  await fireEvent.click(backdrop);
  expect(get(isWallOpen)).toBe(false);

  await openWall({ peerId: 'p2', username: 'u2', dateOfBirth: '2019-01-01', color: 'x', avatarBase64: null, bio: '' });
  expect(get(isWallOpen)).toBe(true);
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(get(isWallOpen)).toBe(false);
});

it('Navigation: AppShell sidebar opens wall; tooltip View Profile opens correct wall; Edit Profile opens ProfileScreen', async () => {
  const AppShell = (await import('$lib/components/AppShell.svelte')).default;
  const shell = new AppShell({ target: document.body });

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

  const GlobalChat = (await import('$lib/components/GlobalChat.svelte')).default;
  document.body.innerHTML = '';
  new GlobalChat({ target: document.body });
  await new Promise((r) => setTimeout(r, 30));

  const { globalMessages } = await import('$lib/stores/chatStore.js');
  globalMessages.set([
    { id: 'm1', peerId: 'bobPid', username: 'bob', dateOfBirth: '1996-01-01', color: 'x', avatarBase64: null, text: 'hi', timestamp: Date.now() }
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

  await openMyWall();
  const WallScreen = (await import('$lib/components/wall/WallScreen.svelte')).default;
  new WallScreen({ target: document.body });
  const editBtn = await waitFor(() => screen.getByRole('button', { name: /edit profile/i }));
  await fireEvent.click(editBtn);
  expect(get(isProfileOpen)).toBe(true);

  shell.$destroy();
});
