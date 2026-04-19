<script>
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import AppShell from '$lib/components/AppShell.svelte';
  import BootScreen from '$lib/components/BootScreen.svelte';
  import RegisterModal from '$lib/components/RegisterModal.svelte';
  import ProfileCooldownScreen from '$lib/components/profile/ProfileCooldownScreen.svelte';
  import { clearDeletionCooldown, cleanOldGlobalMessages, cleanOldPrivateChats, getDeletionCooldown, getUser } from '$lib/services/db.js';
  import { disconnectPeer, initPeer, registrySyncReady } from '$lib/services/peer.js';
  import { loadPrivateChats } from '$lib/stores/privateChatStore.js';
  import { deletionCooldownUntil, setDeletionCooldownUntil } from '$lib/stores/cooldownStore.js';
  import { isRegistered, user } from '$lib/stores/userStore.js';

  let cleanupTimer = null;
  let appReady = false;
  let registryReady = false;
  let bootedUsername = '';
  let registrationHydrating = false;
  let booting = false;

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

  async function checkCooldownGate() {
    try {
      const row = await getDeletionCooldown();
      if (row && typeof row.until === 'number' && row.until > Date.now()) {
        setDeletionCooldownUntil(row.until);
        return true;
      }
      if (row && typeof row.until === 'number' && row.until <= Date.now()) {
        await clearDeletionCooldown();
      }
    } catch (err) {
      console.error('Cooldown gate check failed', err);
      // Fail-open: do not brick the app if cooldown lookup fails.
    }
    setDeletionCooldownUntil(null);
    return false;
  }

  async function startApp() {
    if (booting) return;
    booting = true;

    // STEP 0: account deletion cooldown gate (must run before loading user / P2P).
    const gated = await checkCooldownGate();
    if (gated) {
      disconnectPeer();
      booting = false;
      return;
    }

    void boot();

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
        bio: u.bio ?? '',
        createdAt: u.createdAt
      }).catch((err) => console.error('PeerJS init failed:', err));

      registryReady = true; // not needed for returning users
      booting = false;
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
    booting = false;
  }

  async function handleCooldownDone() {
    try {
      await clearDeletionCooldown();
    } catch (err) {
      console.error('clearDeletionCooldown failed', err);
    }
    setDeletionCooldownUntil(null);
    // Immediately transition into the normal boot/registration flow without reload.
    await startApp();
  }

  onMount(() => {
    void startApp();

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
          bio: u.bio ?? '',
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

{#if typeof $deletionCooldownUntil === 'number' && $deletionCooldownUntil > Date.now()}
  <ProfileCooldownScreen until={$deletionCooldownUntil} on:done={handleCooldownDone} />
{:else if $isRegistered}
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
