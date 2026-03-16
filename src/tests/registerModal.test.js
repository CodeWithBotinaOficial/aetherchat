import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { peer as peerStore } from '$lib/stores/peerStore.js';

const checkMock = vi.fn();
const registerUserMock = vi.fn();
const registerUsernameLocallyMock = vi.fn();
const broadcastUsernameRegisteredMock = vi.fn();

vi.mock('$lib/services/peer.js', () => {
  return {
    checkUsernameAvailability: (...args) => checkMock(...args),
    broadcastUsernameRegistered: (...args) => broadcastUsernameRegisteredMock(...args)
  };
});

vi.mock('$lib/stores/userStore.js', () => {
  return {
    registerUser: (...args) => registerUserMock(...args)
  };
});

vi.mock('$lib/services/db.js', () => {
  return {
    registerUsernameLocally: (...args) => registerUsernameLocallyMock(...args)
  };
});

// Avoid Canvas usage in preview generation under jsdom.
vi.mock('$lib/utils/avatar.js', () => {
  return {
    validateAvatarFile: vi.fn(() => ({ valid: true })),
    generateInitialsAvatar: vi.fn(async () => 'data:image/png;base64,AAAA')
  };
});

beforeEach(() => {
  checkMock.mockReset();
  registerUserMock.mockReset();
  registerUsernameLocallyMock.mockReset();
  broadcastUsernameRegisteredMock.mockReset();

  peerStore.set({
    peerId: 'local-peer',
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

it('handleSubmit re-checks availability and blocks if username just became taken', async () => {
  vi.useFakeTimers();
  checkMock
    .mockResolvedValueOnce({ available: true }) // debounced typing check
    .mockResolvedValueOnce({ available: false, takenBy: 'p2', suggestion: 'alice123' }); // submit guard

  const RegisterModal = (await import('$lib/components/RegisterModal.svelte')).default;
  render(RegisterModal);

  const usernameInput = screen.getByLabelText(/username/i);
  await fireEvent.input(usernameInput, { target: { value: 'alice' } });

  await vi.advanceTimersByTimeAsync(650);
  await Promise.resolve();

  await waitFor(() => {
    expect(screen.getByText(/Available!/i)).toBeInTheDocument();
  });

  const submitBtn = screen.getByRole('button', { name: /enter/i });
  await fireEvent.click(submitBtn);

  await waitFor(() => {
    expect(screen.getByText(/was just taken/i)).toBeInTheDocument();
  });

  expect(registerUserMock).not.toHaveBeenCalled();
  expect(registerUsernameLocallyMock).not.toHaveBeenCalled();
  expect(broadcastUsernameRegisteredMock).not.toHaveBeenCalled();

  vi.useRealTimers();
});

