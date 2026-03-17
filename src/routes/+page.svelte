<script>
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import AppShell from '$lib/components/AppShell.svelte';
  import BootScreen from '$lib/components/BootScreen.svelte';
  import RegisterModal from '$lib/components/RegisterModal.svelte';
	  import { cleanOldGlobalMessages, cleanOldPrivateChats, getUser } from '$lib/services/db.js';
  import { disconnectPeer, initPeer, registrySyncReady } from '$lib/services/peer.js';
  import { loadPrivateChats } from '$lib/stores/privateChatStore.js';
  import { isRegistered, user } from '$lib/stores/userStore.js';

  let cleanupTimer = null;
  let appReady = false;
  let registryReady = false;
  let bootedUsername = '';
  let registrationHydrating = false;

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

	  async function hydrateLocalData(_u) {
	    // Private chats are local-only; do not rely on PeerJS IDs (which may change per session).
	    await loadPrivateChats('');
	    await cleanOldGlobalMessages();
	    await cleanOldPrivateChats();
	  }

  onMount(() => {
    void boot();

    (async () => {
      // STEP 1: Load user from DB (local, fast).
      try {
        const u = await getUser();
        if (u) user.set(u);
      } catch (err) {
        console.error('getUser failed', err);
      }

      // STEP 2: If registered, hydrate local state BEFORE any P2P activity.
      if (get(isRegistered)) {
        const u = get(user);
        bootedUsername = u?.username ?? '';
        try {
          await hydrateLocalData(u);
        } catch (err) {
          console.error('Local hydration failed', err);
        }
        appReady = true; // show AppShell immediately with local data

        // STEP 3: Start P2P in background (do not block UI).
        initPeer({
          username: u.username,
          color: u.color,
          age: u.age,
          avatarBase64: u.avatarBase64 ?? null,
          createdAt: u.createdAt
        }).catch((err) => console.error('PeerJS init failed:', err));

        registryReady = true; // not needed for returning users
        return;
      }

      // New user: start P2P immediately so registry sync can happen.
      initPeer(null).catch((err) => console.error('PeerJS init failed:', err));
      try {
        await registrySyncReady;
      } catch {
        // ignore
      }
      registryReady = true;
    })();

    // If the user registers during this session, hydrate local data exactly once.
    const unsub = user.subscribe((u) => {
      if (!u) return;
      if (appReady) return;
      if (registrationHydrating) return;
      if (!u.username) return;
      if (u.username === bootedUsername) return;

      bootedUsername = u.username;
      registrationHydrating = true;

      (async () => {
        try {
          await hydrateLocalData(u);
        } catch (err) {
          console.error('Local hydration after registration failed', err);
        }
        appReady = true;
        initPeer({
          username: u.username,
          color: u.color,
          age: u.age,
          avatarBase64: u.avatarBase64 ?? null,
          createdAt: u.createdAt
        }).catch((err) => console.error('PeerJS init failed:', err));
      })().finally(() => {
        registrationHydrating = false;
      });
    });

    return () => unsub();
  });

  onDestroy(() => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    disconnectPeer();
  });

</script>

{#if $isRegistered}
  {#if appReady}
    <AppShell />
  {:else}
    <BootScreen state="connecting" />
  {/if}
{:else if registryReady}
  <RegisterModal />
{:else}
  <BootScreen state="syncing" variant="registry" />
{/if}
