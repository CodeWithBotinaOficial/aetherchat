<script>
  import { showToast } from '$lib/stores/toastStore.js';
  import { closeProfile } from '$lib/stores/profileStore.js';
  import { deleteAccount } from '$lib/services/profile/actions.js';

  export let user = null;

  let confirming = false;
  let typed = '';
  let deleting = false;

  $: currentUsername = String(user?.username ?? '');
  $: canConfirm = typed === currentUsername && currentUsername.length > 0;

  function start() {
    confirming = true;
    typed = '';
  }

  function cancel() {
    confirming = false;
    typed = '';
  }

  async function confirmDelete() {
    if (!canConfirm || deleting) return;
    deleting = true;
    try {
      const res = await deleteAccount();
      if (!res.ok) {
        showToast(res.error);
        return;
      }
      closeProfile();
    } catch (err) {
      console.error('deleteAccount failed', err);
      showToast('Could not delete account.');
    } finally {
      deleting = false;
    }
  }
</script>

<section class="card danger" aria-label="Danger zone">
  <div class="title-row">
    <div class="title">Danger Zone</div>
  </div>

  {#if !confirming}
    <div class="body">
      <div class="warn">
        Deleting your account permanently removes your local profile and data from this device.
      </div>
      <button type="button" class="btn btn-danger" on:click={start} aria-label="Delete account">
        🗑️ Delete Account
      </button>
    </div>
  {:else}
    <div class="confirm-panel">
      <div class="big-warn">
        This will permanently delete your profile, all your public messages, all your private conversations and their messages, and remove your username
        from the network. This action cannot be undone.
      </div>

      <label class="label" for="delete-username">Type your username to confirm</label>
      <input
        id="delete-username"
        class="input"
        type="text"
        bind:value={typed}
        autocomplete="off"
        placeholder={currentUsername}
      />

      <div class="confirm-actions">
        <button type="button" class="btn btn-ghost" on:click={cancel} disabled={deleting}>Cancel</button>
        <button
          type="button"
          class="btn btn-danger"
          on:click={confirmDelete}
          disabled={!canConfirm || deleting}
          aria-label="Permanently delete my account"
        >
          {deleting ? 'Deleting...' : 'Permanently Delete My Account'}
        </button>
      </div>

      <div class="hint">
        This check is case-sensitive. <span class="mono">{currentUsername}</span> is not the same as <span class="mono">{currentUsername.toLowerCase()}</span>.
      </div>
    </div>
  {/if}
</section>

<style>
  .card {
    border: 1px solid var(--border);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-md);
    display: grid;
    gap: var(--space-md);
  }

  .danger {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .title {
    font-weight: 900;
    letter-spacing: -0.01em;
    color: color-mix(in srgb, var(--danger) 90%, var(--text-primary));
  }

  .body,
  .confirm-panel {
    display: grid;
    gap: var(--space-md);
  }

  .warn {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .big-warn {
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
    background: color-mix(in srgb, var(--danger) 10%, var(--bg-elevated));
    padding: 10px 12px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    line-height: 1.45;
  }

  .label {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .input {
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 10px 12px;
    color: var(--text-primary);
    outline: none;
  }

  .input:focus {
    border-color: var(--border-focus);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 900;
    font-size: var(--font-size-sm);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-danger {
    background: color-mix(in srgb, var(--danger) 88%, #000);
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
  }

  .hint {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (hover: hover) {
    .btn:hover:not(:disabled) {
      background: var(--bg-overlay);
    }
    .btn-danger:hover:not(:disabled) {
      background: color-mix(in srgb, var(--danger) 92%, #000);
    }
    .btn-ghost:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>

