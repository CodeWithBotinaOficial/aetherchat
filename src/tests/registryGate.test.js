import { render, screen, waitFor } from '@testing-library/svelte';
import { derived, writable } from 'svelte/store';

function deferred() {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const gate = deferred();

vi.mock('$lib/services/peer.js', () => {
  return {
    initPeer: vi.fn().mockResolvedValue({}),
    disconnectPeer: vi.fn(),
    registrySyncReady: gate.promise
  };
});

vi.mock('$lib/services/db.js', () => {
  return {
    cleanOldGlobalMessages: vi.fn().mockResolvedValue(0),
    cleanOldPrivateChats: vi.fn().mockResolvedValue(0),
    getUser: vi.fn().mockResolvedValue(null)
  };
});

// Avoid Canvas usage in RegisterModal previews under jsdom.
vi.mock('$lib/utils/avatar.js', () => {
  return {
    validateAvatarFile: vi.fn(() => ({ valid: true })),
    generateInitialsAvatar: vi.fn(async () => 'data:image/png;base64,AAAA')
  };
});

const user = writable(null);
const isRegistered = derived(user, ($u) => $u !== null);

vi.mock('$lib/stores/userStore.js', () => {
  return {
    user,
    isRegistered,
    registerUser: vi.fn(),
    clearUser: vi.fn()
  };
});

it('RegisterModal is NOT rendered before registryReady is true', async () => {
  const Page = (await import('../routes/+page.svelte')).default;
  render(Page);
  expect(screen.getByText(/Checking username availability/i)).toBeInTheDocument();
  expect(screen.queryByText(/Welcome to AetherChat/i)).toBeNull();
});

it('RegisterModal IS rendered after registryReady becomes true', async () => {
  const Page = (await import('../routes/+page.svelte')).default;
  render(Page);
  expect(screen.queryByText(/Welcome to AetherChat/i)).toBeNull();

  gate.resolve('network');

  await waitFor(() => {
    expect(screen.getByText(/Welcome to AetherChat/i)).toBeInTheDocument();
  });
});
