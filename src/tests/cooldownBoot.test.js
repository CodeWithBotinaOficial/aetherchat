import { waitFor } from '@testing-library/dom';
import { writable } from 'svelte/store';
import { db, getDeletionCooldown, setDeletionCooldown } from '$lib/services/db.js';
import { user as userStore } from '$lib/stores/userStore.js';

const initPeerMock = vi.fn().mockResolvedValue(null);
const disconnectPeerMock = vi.fn();

// +page imports AppShell/RegisterModal, which in turn import many peer service exports.
// Provide a complete-enough mock so those modules can load, while still letting this
// test observe the cooldown gate behavior at the page level.
const avatarCache = writable(new Map());
vi.mock('$lib/services/peer.js', () => {
  return {
    avatarCache,
    onMessage: vi.fn(() => () => {}),
    flushQueueForPeer: vi.fn(),
    initiatePrivateChat: vi.fn(),
    closePrivateChat: vi.fn(),
    sendPrivateMessage: vi.fn(),
    editPrivateMessage: vi.fn(),
    deletePrivateMessage: vi.fn(),
    broadcastGlobalMessage: vi.fn(),
    broadcastGlobalMessageEdit: vi.fn(),
    broadcastGlobalMessageDelete: vi.fn(),
    checkUsernameAvailability: vi.fn().mockResolvedValue({ available: true }),
    broadcastUsernameRegistered: vi.fn(),
    initPeer: (...args) => initPeerMock(...args),
    disconnectPeer: (...args) => disconnectPeerMock(...args),
    registrySyncReady: Promise.resolve('ok')
  };
});

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
  initPeerMock.mockClear();
  disconnectPeerMock.mockClear();
  document.body.innerHTML = '';
  userStore.set(null);
  await clearAllTables();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

it('shows the cooldown screen on boot when cooldown.until > Date.now() (blocks initPeer)', async () => {
  await setDeletionCooldown(Date.now() + 60_000);

  const Page = (await import('../routes/+page.svelte')).default;
  const page = new Page({ target: document.body });

  await waitFor(() => {
    if (!document.body.textContent?.includes('Account deleted.')) throw new Error('cooldown screen not shown');
    return true;
  });

  expect(initPeerMock).not.toHaveBeenCalled();
  page.$destroy();
});

it('does not show cooldown screen when until <= Date.now() (clears cooldown row and proceeds)', async () => {
  await setDeletionCooldown(Date.now() - 1000);

  const Page = (await import('../routes/+page.svelte')).default;
  const page = new Page({ target: document.body });

  await waitFor(() => {
    if (!document.body.textContent?.includes('Welcome to AetherChat')) throw new Error('register flow not shown');
    return true;
  });

  expect(initPeerMock).toHaveBeenCalled();
  const cd = await getDeletionCooldown();
  expect(cd).toBeNull();

  page.$destroy();
});

it('countdown reaches zero and transitions into registration flow without reload', async () => {
  await setDeletionCooldown(Date.now() + 1100);

  const Page = (await import('../routes/+page.svelte')).default;
  const page = new Page({ target: document.body });

  await waitFor(() => {
    if (!document.body.textContent?.includes('Account deleted.')) throw new Error('cooldown screen not shown');
    return true;
  });

  // Let the live countdown elapse and the page transition without a reload.
  await new Promise((r) => setTimeout(r, 1600));

  await waitFor(() => {
    if (!document.body.textContent?.includes('Welcome to AetherChat')) throw new Error('did not transition to registration');
    return true;
  });

  expect(initPeerMock).toHaveBeenCalled();
  page.$destroy();
}, 10_000);
