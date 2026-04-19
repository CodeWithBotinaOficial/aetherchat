<script>
  import { onDestroy, onMount } from 'svelte';
  import { showToast } from '$lib/stores/toastStore.js';
  import {
    USERNAME_RE,
    changeAge,
    changeBio,
    changeUsername,
    formatCooldownHoursMinutes,
    getUsernameCooldown
  } from '$lib/services/profile/actions.js';

  export let user = null;

  let usernameDraft = '';
  let usernameError = '';
  let usernameSuggestion = '';
  let savingUsername = false;

  let ageDraft = 18;
  let ageError = '';
  let savingAge = false;

  let bioDraft = '';
  let savingBio = false;

  let now = Date.now();
  let timer = 0;

  $: usernameCurrent = String(user?.username ?? '');
  $: usernameDraft = usernameDraft === '' ? usernameCurrent : usernameDraft;
  $: usernameDirty = usernameDraft.trim() !== usernameCurrent;
  $: usernameCooldown = getUsernameCooldown(user, now);
  $: usernameLockedText = usernameCooldown.locked ? `You can change your username again in ${formatCooldownHoursMinutes(usernameCooldown.remainingMs)}.` : '';

  $: ageCurrent = typeof user?.age === 'number' ? user.age : 18;
  $: ageDraft = ageDraft === 18 && ageCurrent !== 18 ? ageCurrent : ageDraft;
  $: ageDirty = Number(ageDraft) !== Number(ageCurrent);
  $: ageLocked = Boolean(user?.ageChangedOnce);

  $: bioCurrent = typeof user?.bio === 'string' ? user.bio : '';
  $: bioDraft = bioDraft === '' && bioCurrent ? bioCurrent : bioDraft;
  $: bioDirty = bioDraft !== bioCurrent;

  $: anyDirty = usernameDirty || ageDirty || bioDirty;

  function validateUsernameLocal(value) {
    const v = String(value ?? '').trim();
    if (!v) return 'Username is required.';
    if (!USERNAME_RE.test(v)) return '3-20 chars, letters/numbers/underscore only.';
    return '';
  }

  function onUsernameInput() {
    usernameSuggestion = '';
    usernameError = validateUsernameLocal(usernameDraft);
  }

  async function saveUsername() {
    if (savingUsername) return;
    usernameSuggestion = '';
    usernameError = validateUsernameLocal(usernameDraft);
    if (usernameError) return;
    if (!usernameDirty) return;
    if (usernameCooldown.locked) return;

    savingUsername = true;
    try {
      const res = await changeUsername(usernameDraft);
      if (!res.ok) {
        usernameError = res.error;
        usernameSuggestion = res.suggestion ?? '';
        return;
      }
      showToast('Username updated.');
      usernameDraft = '';
    } catch (err) {
      console.error('changeUsername failed', err);
      usernameError = 'Could not update username.';
    } finally {
      savingUsername = false;
    }
  }

  function applyUsernameSuggestion() {
    if (!usernameSuggestion) return;
    usernameDraft = usernameSuggestion;
    onUsernameInput();
  }

  async function saveAge() {
    if (savingAge) return;
    ageError = '';
    if (ageLocked) return;
    if (!ageDirty) return;
    if (Number(ageDraft) < 16) {
      ageError = 'Age must be at least 16.';
      return;
    }

    savingAge = true;
    try {
      const res = await changeAge(Number(ageDraft));
      if (!res.ok) {
        ageError = res.error;
        return;
      }
      showToast('Age updated.');
    } catch (err) {
      console.error('changeAge failed', err);
      ageError = 'Could not update age.';
    } finally {
      savingAge = false;
    }
  }

  function clampBio() {
    if (bioDraft.length <= 120) return;
    bioDraft = bioDraft.slice(0, 120);
  }

  async function saveBio() {
    if (savingBio) return;
    if (!bioDirty) return;
    savingBio = true;
    try {
      const res = await changeBio(bioDraft);
      if (!res.ok) {
        showToast(res.error);
        return;
      }
      showToast('Bio updated.');
    } catch (err) {
      console.error('changeBio failed', err);
      showToast('Could not update bio.');
    } finally {
      savingBio = false;
    }
  }

  onMount(() => {
    timer = setInterval(() => {
      now = Date.now();
    }, 30_000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<section class="card" aria-label="Profile fields">
  {#if anyDirty}
    <div class="dirty-banner">You have unsaved changes.</div>
  {/if}

  <div class="field">
    <div class="label-row">
      <div class="label">Username</div>
      <button type="button" class="btn btn-primary" on:click={saveUsername} disabled={savingUsername || !usernameDirty || usernameCooldown.locked}>
        {savingUsername ? 'Saving...' : 'Save'}
      </button>
    </div>

    <div class="warning">
      Your previous username will be released and any other user will be able to claim it. This change cannot be undone and you can only change your
      username once every 24 hours.
    </div>

    <input
      class="input"
      type="text"
      bind:value={usernameDraft}
      on:input={onUsernameInput}
      disabled={savingUsername || usernameCooldown.locked}
      autocomplete="off"
      inputmode="text"
      placeholder="e.g. night_owl"
    />

    {#if usernameLockedText}
      <div class="hint">{usernameLockedText}</div>
    {/if}
    {#if usernameError}
      <div class="error">{usernameError}</div>
    {:else if usernameDirty && !validateUsernameLocal(usernameDraft)}
      <div class="hint">Looks good.</div>
    {/if}
    {#if usernameSuggestion}
      <div class="hint">
        Try:
        <button type="button" class="suggestion" on:click={applyUsernameSuggestion}>{usernameSuggestion}</button>
      </div>
    {/if}
  </div>

  <div class="field">
    <div class="label-row">
      <div class="label">
        Age
        {#if ageLocked}
          <span class="lock" title="Locked">🔒</span>
        {/if}
      </div>
      <button type="button" class="btn btn-primary" on:click={saveAge} disabled={savingAge || ageLocked || !ageDirty}>
        {savingAge ? 'Saving...' : 'Save'}
      </button>
    </div>

    <div class="warning">
      You can only change your age once. After saving, this field will be permanently locked.
    </div>

    <input
      class="input"
      type="number"
      min="16"
      step="1"
      bind:value={ageDraft}
      disabled={savingAge || ageLocked}
      inputmode="numeric"
    />
    {#if ageLocked}
      <div class="hint">This field is locked.</div>
    {/if}
    {#if ageError}
      <div class="error">{ageError}</div>
    {/if}
  </div>

  <div class="field">
    <div class="label-row">
      <div class="label">Biography</div>
      <button type="button" class="btn btn-primary" on:click={saveBio} disabled={savingBio || !bioDirty}>
        {savingBio ? 'Saving...' : 'Save'}
      </button>
    </div>

    <textarea class="textarea" rows="3" bind:value={bioDraft} maxlength="120" on:input={clampBio} placeholder="Optional (max 120 characters)"></textarea>
    <div class="counter">{bioDraft.length} / 120</div>
  </div>
</section>

<style>
  .card {
    border: 1px solid var(--border);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-md);
    display: grid;
    gap: var(--space-lg);
  }

  .dirty-banner {
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--warning) 14%, var(--bg-elevated));
    padding: 10px 12px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-weight: 700;
  }

  .field {
    display: grid;
    gap: 8px;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .label {
    font-weight: 900;
    letter-spacing: -0.01em;
  }

  .lock {
    margin-left: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .warning {
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent-subtle) 65%, var(--bg-elevated));
    padding: 10px 12px;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.35;
  }

  .input,
  .textarea {
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 10px 12px;
    color: var(--text-primary);
    outline: none;
  }

  .textarea {
    resize: vertical;
    min-height: 84px;
  }

  .input:focus,
  .textarea:focus {
    border-color: var(--border-focus);
  }

  .input:disabled,
  .textarea:disabled {
    opacity: 0.65;
  }

  .hint {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .error {
    font-size: var(--font-size-xs);
    color: var(--danger);
  }

  .counter {
    text-align: right;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 800;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .suggestion {
    margin-left: 8px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 2px 10px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  @media (hover: hover) {
    .btn:hover:not(:disabled) {
      background: var(--bg-overlay);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    .suggestion:hover {
      background: var(--bg-overlay);
    }
  }
</style>

