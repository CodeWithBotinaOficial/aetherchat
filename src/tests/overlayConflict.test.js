import { waitFor } from '@testing-library/dom';
import GlobalChat from '$lib/components/GlobalChat.svelte';
import { db } from '$lib/services/db.js';
import { globalMessages } from '$lib/stores/chatStore.js';
import { peer } from '$lib/stores/peerStore.js';
import { user } from '$lib/stores/userStore.js';

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
        db.peerIds.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await clearAllTables();
  document.body.innerHTML = '';
  globalMessages.set([]);
  user.set({ id: 1, username: 'alice', age: 22, color: 'hsl(1, 65%, 65%)', avatarBase64: null, createdAt: Date.now() });
  peer.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
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
});

async function mountWithOneOwnMessage() {
  const component = new GlobalChat({ target: document.body });
  await new Promise((r) => setTimeout(r, 30));
  globalMessages.set([
    { id: 'm1', peerId: 'local', username: 'alice', age: 22, color: 'hsl(1, 65%, 65%)', text: 'hello', timestamp: Date.now() }
  ]);

  const identity = await waitFor(() => {
    const el = document.querySelector('[data-aether-identity="true"]');
    if (!el) throw new Error('identity not ready');
    return el;
  });
  const menuTrigger = await waitFor(() => {
    const el = document.querySelector('.msg-menu-trigger');
    if (!el) throw new Error('menu trigger not ready');
    return el;
  });
  return { component, identity, menuTrigger };
}

it('Opening the action menu closes any visible tooltip', async () => {
  const { component, identity, menuTrigger } = await mountWithOneOwnMessage();

  identity.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 120 }));
  await waitFor(() => {
    const el = document.querySelector('[data-aether-tooltip="true"]');
    if (!el) throw new Error('tooltip not ready');
    return el;
  });

  menuTrigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  await waitFor(() => {
    if (document.querySelector('[data-aether-tooltip="true"]')) throw new Error('tooltip still open');
    return true;
  });
  await waitFor(() => {
    const el = document.querySelector('.msg-menu');
    if (!el) throw new Error('menu not open');
    return el;
  });

  component.$destroy();
});

it('Opening the tooltip closes any open action menu', async () => {
  const { component, identity, menuTrigger } = await mountWithOneOwnMessage();

  menuTrigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await waitFor(() => {
    const el = document.querySelector('.msg-menu');
    if (!el) throw new Error('menu not open');
    return el;
  });

  identity.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 120 }));

  // While the action menu is open, tooltip opening is suppressed so the menu
  // stays open while the cursor moves into it.
  await new Promise((r) => setTimeout(r, 50));
  expect(document.querySelector('[data-aether-tooltip="true"]')).toBeNull();
  expect(document.querySelector('.msg-menu')).toBeTruthy();

  // Close the menu by clicking outside.
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await waitFor(() => {
    if (document.querySelector('.msg-menu')) throw new Error('menu still open');
    return true;
  });

  // Now tooltip can open normally.
  identity.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  identity.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 120 }));
  await waitFor(() => {
    const el = document.querySelector('[data-aether-tooltip="true"]');
    if (!el) throw new Error('tooltip not ready');
    return el;
  });

  component.$destroy();
});
