<script>
  import { onDestroy, onMount } from 'svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import BootScreen from '$lib/components/BootScreen.svelte';
  import RegisterModal from '$lib/components/RegisterModal.svelte';
  import { cleanOldGlobalMessages, cleanOldPrivateChats } from '$lib/services/db.js';
  import { disconnectPeer, initPeer, registrySyncReady } from '$lib/services/peer.js';
  import { peer } from '$lib/stores/peerStore.js';
  import { loadPrivateChats } from '$lib/stores/privateChatStore.js';
  import { isRegistered, user } from '$lib/stores/userStore.js';

  let cleanupTimer = null;
  let peerStarted = false;
  let registryReady = false;
  let privateBootedPeerId = null;

  async function boot() {
    try {
      // Cleanup interval: 1 hour
      cleanupTimer = setInterval(() => {
        cleanOldGlobalMessages().catch((err) => console.error('Global message cleanup failed', err));
      }, 60 * 60 * 1000);
    } catch (err) {
      console.error('App boot failed', err);
    }
  }

  async function startPeer(profile) {
    try {
      await initPeer(profile);
    } catch (err) {
      console.error('Peer init failed', err);
    }
  }

  onMount(() => {
    void boot();
    if (peerStarted) return;
    peerStarted = true;

    // Start P2P immediately so new users can sync the username registry before registering.
    void startPeer({ username: 'pre-registration', color: 'hsl(0, 0%, 70%)', age: 0 });

    (async () => {
      // Returning users should not be blocked by the sync gate.
      if ($isRegistered) {
        registryReady = true;
        return;
      }

      // New users: wait for the registry sync (or its timeout/standalone fallback).
      try {
        await registrySyncReady;
      } catch {
        // ignore
      }
      registryReady = true;
    })();
  });

  onDestroy(() => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    disconnectPeer();
  });

  // When the user registers during this session (or when the DB-loaded user arrives),
  // start the PeerJS stack exactly once.
  $: if ($isRegistered && $user) {
    void startPeer({
      username: $user.username,
      color: $user.color,
      age: $user.age,
      avatarBase64: $user.avatarBase64 ?? null,
      createdAt: $user.createdAt
    });
  }

  // Private chat initialization: load chat list and run cleanup once we have a local peerId.
  $: if ($isRegistered && $peer.peerId && privateBootedPeerId !== $peer.peerId) {
    // eslint-disable-next-line no-useless-assignment
    privateBootedPeerId = $peer.peerId;
    (async () => {
      try {
        await loadPrivateChats($peer.peerId);
        await cleanOldPrivateChats();
      } catch (err) {
        console.error('Private chat boot failed', err);
      }
    })();
  }
</script>

{#if !$isRegistered && !registryReady}
  <BootScreen state="syncing" variant="registry" />
{:else if !$isRegistered}
  <RegisterModal />
{:else}
  <AppShell />
{/if}
