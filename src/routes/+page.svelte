<script>
  import { onDestroy, onMount } from 'svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import BootScreen from '$lib/components/BootScreen.svelte';
  import RegisterModal from '$lib/components/RegisterModal.svelte';
  import { cleanOldGlobalMessages } from '$lib/services/db.js';
  import { disconnectPeer, initPeer } from '$lib/services/peer.js';
  import { globalMessages } from '$lib/stores/chatStore.js';
  import { peer } from '$lib/stores/peerStore.js';
  import { isRegistered, user } from '$lib/stores/userStore.js';

  let cleanupTimer = null;
  let peerStarted = false;

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

  async function startPeerIfNeeded(u) {
    if (peerStarted) return;
    if (!u) return;
    peerStarted = true;
    try {
      await initPeer({
        username: u.username,
        color: u.color,
        age: u.age,
        avatarBase64: u.avatarBase64
      });
    } catch (err) {
      console.error('Peer init failed', err);
    }
  }

  onMount(() => {
    void boot();
  });

  onDestroy(() => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    disconnectPeer();
  });

  // When the user registers during this session (or when the DB-loaded user arrives),
  // start the PeerJS stack exactly once.
  $: if ($isRegistered && $user) void startPeerIfNeeded($user);
</script>

{#if !$isRegistered}
  <RegisterModal />
{:else if $peer.connectionState === 'connecting' || $peer.connectionState === 'syncing' || $peer.connectionState === 'reconnecting'}
  <BootScreen state={$peer.connectionState} receivedCount={$globalMessages.length} />
{:else}
  <AppShell />
{/if}
