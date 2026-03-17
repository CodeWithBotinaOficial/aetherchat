<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { peer as peerStore } from '$lib/stores/peerStore.js';
  import { registerUsernameLocally } from '$lib/services/db.js';
  import { validateAvatarFile } from '$lib/utils/avatar.js';
  import { getUserColor } from '$lib/utils/colors.js';
  import { registerUser } from '$lib/stores/userStore.js';
  import { broadcastUsernameRegistered, checkUsernameAvailability } from '$lib/services/peer.js';

  const dispatch = createEventDispatcher();

  let username = '';
  let age = 18;
  let usernameError = '';
  /** @type {'typing'|'checking'|'available'|'taken_local'|'taken_network'|'offline_warning'} */
  let availabilityState = 'typing';
  let takenSuggestion = '';

  /** @type {string|null} */
  let avatarBase64 = null;
  let avatarError = '';
  let hasUploadedAvatar = false;

  let isSubmitting = false;

  const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
  const USERNAME_ID = 'aetherchat-username';
  const AGE_ID = 'aetherchat-age';
  const AVATAR_ID = 'aetherchat-avatar';

  function validateUsernameLocal(value) {
    if (!value || value.trim().length === 0) return 'Username is required.';
    if (!USERNAME_RE.test(value)) return '3-20 chars, letters/numbers/underscore only.';
    return '';
  }

  async function refreshPreview() {
    try {
      avatarError = '';
      if (!username || validateUsernameLocal(username)) {
        avatarBase64 = null;
        return;
      }
      const { generateInitialsAvatar } = await import('$lib/utils/avatar.js');
      avatarBase64 = await generateInitialsAvatar(username, getUserColor(username));
    } catch (err) {
      console.error('refreshPreview failed', err);
      avatarBase64 = null;
    }
  }

  let usernameCheckTimer = null;
  let usernameCheckSeq = 0;

  function onUsernameInput() {
    usernameError = validateUsernameLocal(username);
    availabilityState = 'typing';
    takenSuggestion = '';

    if (usernameCheckTimer) clearTimeout(usernameCheckTimer);

    if (!usernameError && username) {
      const seq = ++usernameCheckSeq;
      usernameCheckTimer = setTimeout(async () => {
        try {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            availabilityState = 'offline_warning';
            return;
          }

          availabilityState = 'checking';
          const res = await checkUsernameAvailability(username);
          if (seq !== usernameCheckSeq) return;

          if (res.available) {
            availabilityState = 'available';
            return;
          }

          takenSuggestion = res.suggestion;
          availabilityState = res.takenBy === 'local' ? 'taken_local' : 'taken_network';
        } catch (err) {
          console.error('username taken check failed', err);
        }
      }, 600);
    }

    if (!hasUploadedAvatar) void refreshPreview();
  }

  $: isTooYoung = Number(age) < 16;
  $: isTaken = availabilityState === 'taken_local' || availabilityState === 'taken_network';
  $: canSubmit =
    !isSubmitting &&
    !isTooYoung &&
    !usernameError &&
    !isTaken &&
    availabilityState !== 'checking' &&
    Boolean(username) &&
    Number(age) >= 16;

  function applySuggestion() {
    if (!takenSuggestion) return;
    username = takenSuggestion;
    onUsernameInput();
  }

  async function handleFile(file) {
    avatarError = '';
    const res = validateAvatarFile(file);
    if (!res.valid) {
      avatarError = res.error ?? 'Invalid avatar file.';
      return;
    }

    try {
      avatarBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      hasUploadedAvatar = true;
    } catch (err) {
      console.error('avatar read failed', err);
      avatarError = 'Could not read the file.';
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  }

  function onPickFile(e) {
    const file = e.currentTarget?.files?.[0];
    if (file) void handleFile(file);
  }

  async function submit() {
    if (!canSubmit) return;
    isSubmitting = true;
    try {
      // Final guard: re-check on submit (network can change while the modal is open).
      const final = await checkUsernameAvailability(username);
      if (!final.available) {
        takenSuggestion = final.suggestion;
        availabilityState = final.takenBy === 'local' ? 'taken_local' : 'taken_network';
        usernameError = `"${username}" was just taken. Try: ${final.suggestion}`;
        return;
      }

      const uname = username.trim();
      const now = Date.now();

      await registerUser(uname, Number(age), avatarBase64 ?? undefined);

      // Update our local registry immediately for offline uniqueness checks.
      const peerId = get(peerStore).peerId ?? 'pending';
      await registerUsernameLocally({
        username: uname,
        peerId,
        registeredAt: now,
        lastSeenAt: now
      });

      // Broadcast a registration event so online peers update instantly.
      // Note: simultaneous same-username registrations can still race in rare edge cases in decentralized systems.
      broadcastUsernameRegistered({
        username: uname,
        color: getUserColor(uname),
        age: Number(age),
        avatarBase64: avatarBase64 ?? null,
        createdAt: now
      });

      dispatch('registered');
    } catch (err) {
      console.error('register submit failed', err);
    } finally {
      isSubmitting = false;
    }
  }

  onMount(() => {
    void refreshPreview();
  });
</script>

<div
  class="modal-overlay fixed inset-0 z-50 grid place-items-center bg-[var(--bg-dim)]"
  aria-modal="true"
  role="dialog"
>
  <div
    class="modal-shell w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] overflow-hidden"
  >
    <div class="modal-header px-[var(--space-lg)] pt-[var(--space-lg)] pb-[var(--space-md)]">
      <div class="flex items-start justify-between gap-[var(--space-md)]">
        <div>
          <h2 class="m-0 text-[var(--font-size-xl)] font-700">Welcome to AetherChat</h2>
          <p class="mt-[var(--space-xs)] mb-0 text-[var(--text-secondary)] text-[var(--font-size-sm)]">
            Create a local identity. This stays in your browser.
          </p>
        </div>
      </div>

      <div
        class="privacy-banner mt-[var(--space-md)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent-subtle)] px-[var(--space-md)] py-[var(--space-sm)]"
      >
        <p class="m-0 text-[var(--font-size-sm)] text-[var(--text-primary)]">
          Do not use your real name or personal information as your username.
        </p>
      </div>
    </div>

    <div class="modal-body px-[var(--space-lg)] pb-[var(--space-lg)] grid gap-[var(--space-md)] scroll-container">
      <div class="grid gap-[var(--space-sm)]">
        <label for={USERNAME_ID} class="text-[var(--font-size-sm)] text-[var(--text-secondary)]">Username</label>
        <input
          id={USERNAME_ID}
          class="w-full min-h-[44px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
          type="text"
          bind:value={username}
          on:input={onUsernameInput}
          placeholder="e.g. night_owl"
          autocomplete="off"
          inputmode="text"
        />
        {#if usernameError}
          <div class="text-[var(--font-size-xs)] text-[var(--danger)]">{usernameError}</div>
        {:else if availabilityState === 'checking'}
          <div class="text-[var(--font-size-xs)] text-[var(--text-muted)]">Checking availability...</div>
        {:else if availabilityState === 'available'}
          <div class="text-[var(--font-size-xs)] text-[var(--success)]">Available!</div>
        {:else if availabilityState === 'taken_local'}
          <div class="text-[var(--font-size-xs)] text-[var(--danger)]">
            Already taken.
            {#if takenSuggestion}
              <button
                type="button"
                class="suggestion-btn ml-[var(--space-xs)] rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[10px] py-[2px] text-[var(--text-primary)]"
                on:click={applySuggestion}
              >
                {takenSuggestion}
              </button>
            {/if}
          </div>
        {:else if availabilityState === 'taken_network'}
          <div class="text-[var(--font-size-xs)] text-[var(--danger)]">
            Already taken on the network.
            {#if takenSuggestion}
              <button
                type="button"
                class="suggestion-btn ml-[var(--space-xs)] rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[10px] py-[2px] text-[var(--text-primary)]"
                on:click={applySuggestion}
              >
                {takenSuggestion}
              </button>
            {/if}
          </div>
        {:else if availabilityState === 'offline_warning'}
          <div class="text-[var(--font-size-xs)] text-[var(--warning)]">
            Can't verify right now: you're offline. Choose carefully.
          </div>
        {:else}
          <div class="text-[var(--font-size-xs)] text-[var(--text-muted)]">
            Allowed: letters, numbers, underscore. 3-20 characters.
          </div>
        {/if}
      </div>

      <div class="grid gap-[var(--space-sm)]">
        <label for={AGE_ID} class="text-[var(--font-size-sm)] text-[var(--text-secondary)]">Age</label>
        <input
          id={AGE_ID}
          class="w-full min-h-[44px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
          type="number"
          min="0"
          max="120"
          bind:value={age}
        />
        {#if isTooYoung}
          <div class="text-[var(--font-size-xs)] text-[var(--warning)]">
            You must be at least 16 to use AetherChat.
          </div>
        {/if}
      </div>

      <div class="grid gap-[var(--space-sm)]">
        <div class="flex items-center justify-between gap-[var(--space-md)]">
          <div class="text-[var(--font-size-sm)] text-[var(--text-secondary)]">Avatar (optional)</div>
          <label class="upload-link cursor-pointer text-[var(--font-size-xs)] text-[var(--accent)]" for={AVATAR_ID}>
            Upload
          </label>
          <input id={AVATAR_ID} class="hidden" type="file" accept="image/png,image/jpeg" on:change={onPickFile} />
        </div>

        <div class="grid grid-cols-[88px_1fr] items-center gap-[var(--space-md)]">
          <div
            class="h-[88px] w-[88px] rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden"
          >
            {#if avatarBase64}
              <img class="h-full w-full object-cover" alt="avatar preview" src={avatarBase64} />
            {:else}
              <div class="h-full w-full grid place-items-center text-[var(--text-muted)] text-[var(--font-size-sm)]">
                ...
              </div>
            {/if}
          </div>

          <label
            for={AVATAR_ID}
            class="avatar-drop rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[var(--space-md)] text-[var(--text-secondary)] text-[var(--font-size-sm)]"
            role="group"
            aria-label="Avatar upload dropzone"
            on:dragover|preventDefault
            on:drop={onDrop}
          >
            Drag and drop a PNG/JPG (max 500KB), or use Upload.
            {#if avatarError}
              <div class="mt-[var(--space-xs)] text-[var(--font-size-xs)] text-[var(--danger)]">
                {avatarError}
              </div>
            {/if}
          </label>
        </div>
      </div>

      <div class="flex items-center justify-end gap-[var(--space-md)] pt-[var(--space-sm)]">
        <button
          class="submit-btn rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-lg)] py-[var(--space-sm)] text-[var(--text-primary)] font-600 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!canSubmit}
          on:click={submit}
        >
          {#if isSubmitting}
            Creating...
          {:else}
            Enter
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    padding: var(--space-lg) var(--space-md);
  }

  .modal-shell {
    max-width: 480px;
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - (var(--space-lg) * 2));
  }

  .modal-body {
    flex: 1;
    min-height: 0;
  }

  /* Mobile: full-screen modal (no card feel) */
  @media (max-width: 639px) {
    .modal-overlay {
      padding: 0;
      place-items: stretch;
    }

    .modal-shell {
      height: 100dvh;
      max-width: none;
      border-radius: 0;
      border: 0;
      box-shadow: none;
    }

    .modal-header {
      padding-top: calc(var(--space-lg) + env(safe-area-inset-top, 0px));
    }

    .modal-body {
      padding-bottom: calc(var(--space-lg) + env(safe-area-inset-bottom, 0px));
    }

    .avatar-drop {
      min-height: 44px;
    }

    .upload-link {
      padding: 10px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      background: var(--bg-elevated);
      color: var(--text-primary);
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
  }

  @media (hover: hover) {
    .suggestion-btn:hover {
      background: var(--accent-subtle);
    }

    .upload-link:hover {
      color: var(--accent-hover);
      text-decoration: underline;
    }

    .submit-btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>
