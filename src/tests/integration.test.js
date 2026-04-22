import { get } from 'svelte/store';
import GlobalChat from '$lib/components/GlobalChat.svelte';
import { cleanOldGlobalMessages, db, getGlobalMessages, saveGlobalMessage } from '$lib/services/db.js';
import { peer } from '$lib/stores/peerStore.js';
import { addGlobalMessage, globalMessages } from '$lib/stores/chatStore.js';
import { getUserColor } from '$lib/utils/colors.js';
import { isRegistered, registerUser, user } from '$lib/stores/userStore.js';

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

beforeEach(async () => {
  await clearAllTables();
  user.set(null);
  globalMessages.set([]);
  peer.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    connectedPeers: new Map()
  });
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

it('On first load with empty DB: isRegistered is false', () => {
  expect(get(isRegistered)).toBe(false);
});

it('After registerUser: isRegistered is true, user persisted in DB', async () => {
  await registerUser('alice', 22, 'data:image/png;base64,abc');
  expect(get(isRegistered)).toBe(true);

  const fromDb = await db.users.get(1);
  expect(fromDb?.username).toBe('alice');
});

it('After registerUser: getUserColor returns correct color', async () => {
  await registerUser('alice', 22, 'data:image/png;base64,abc');
  expect(get(user)?.color).toBe(getUserColor('alice'));
});

it('GlobalChat renders empty state when no messages', async () => {
  // With `compatibility.componentApi === 4` in tests, Svelte components can be instantiated via `new`.
  const component = new GlobalChat({ target: document.body });
  await Promise.resolve();
  expect(document.body.textContent).toMatch(/No messages yet/i);
  component.$destroy();
});

it('Adding a message to globalMessages store causes it to appear in DOM', async () => {
  const component = new GlobalChat({ target: document.body });
  // Let GlobalChat's onMount (which loads from DB) settle first.
  await new Promise((r) => setTimeout(r, 0));

  await addGlobalMessage({
    peerId: 'local',
    username: 'alice',
    age: 22,
    color: getUserColor('alice'),
    text: 'hello from store',
    timestamp: Date.now()
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(document.body.textContent).toContain('hello from store');
  component.$destroy();
});

it('cleanOldGlobalMessages does not delete messages younger than 24h', async () => {
  await saveGlobalMessage({
    peerId: 'local',
    username: 'alice',
    age: 22,
    color: getUserColor('alice'),
    text: 'recent',
    timestamp: Date.now()
  });

  await cleanOldGlobalMessages();
  const msgs = await getGlobalMessages();
  expect(msgs).toHaveLength(1);
  expect(msgs[0].text).toBe('recent');
});
