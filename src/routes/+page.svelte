<script>
  import { onDestroy, onMount } from 'svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import RegisterModal from '$lib/components/RegisterModal.svelte';
  import { cleanOldGlobalMessages, getUser as dbGetUser } from '$lib/services/db.js';
  import { initPeer } from '$lib/services/peer.js';
  import { isRegistered, user } from '$lib/stores/userStore.js';

  let cleanupTimer = null;

  async function boot() {
    try {
      const existing = await dbGetUser();
      if (existing) user.set(existing);

      if (existing) {
        try {
          await initPeer(existing.username);
        } catch (err) {
          console.error('Peer init failed', err);
        }
      }

      // Cleanup interval: 1 hour
      cleanupTimer = setInterval(() => {
        cleanOldGlobalMessages().catch((err) => console.error('Global message cleanup failed', err));
      }, 60 * 60 * 1000);
    } catch (err) {
      console.error('App boot failed', err);
    }
  }

  onMount(() => {
    void boot();
  });

  onDestroy(() => {
    if (cleanupTimer) clearInterval(cleanupTimer);
  });
</script>

{#if $isRegistered}
  <AppShell />
{:else}
  <RegisterModal />
{/if}

