<script>
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import { showToast } from '$lib/stores/toastStore.js';
  import { removeAvatar, uploadAvatar } from '$lib/services/profile/actions.js';
  import { validateAvatarFile } from '$lib/utils/avatar.js';

  export let user = null;

  /** @type {File|null} */
  let file = null;
  /** @type {string|null} */
  let preview = null;
  /** @type {'idle'|'upload'|'remove'} */
  let mode = 'idle';
  let error = '';
  let saving = false;

  $: currentAvatar = preview !== null || mode === 'remove' ? preview : (user?.avatarBase64 ?? null);
  $: canSave = !saving && mode !== 'idle';

  async function setPreviewFromFile(f) {
    error = '';
    file = null;
    preview = null;
    mode = 'idle';

    const res = validateAvatarFile(f);
    if (!res.valid) {
      error = res.error ?? 'Invalid avatar file.';
      return;
    }

    file = f;
    mode = 'upload';
    try {
      preview = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(f);
      });
    } catch (err) {
      console.error('Avatar preview read failed', err);
      error = 'Could not read the file.';
      file = null;
      preview = null;
      mode = 'idle';
    }
  }

  function onPickFile(e) {
    const f = e.currentTarget?.files?.[0] ?? null;
    if (!f) return;
    void setPreviewFromFile(f);
  }

  function onRemove() {
    error = '';
    file = null;
    preview = null;
    mode = 'remove';
  }

  async function onSave() {
    if (!canSave) return;
    saving = true;
    error = '';
    try {
      if (mode === 'upload') {
        const res = await uploadAvatar(file);
        if (!res.ok) {
          error = res.error;
          return;
        }
        showToast('Avatar updated.');
      } else if (mode === 'remove') {
        const res = await removeAvatar();
        if (!res.ok) {
          error = res.error;
          return;
        }
        showToast('Avatar removed.');
      }

      file = null;
      preview = null;
      mode = 'idle';
    } catch (err) {
      console.error('Avatar save failed', err);
      error = 'Could not save avatar.';
    } finally {
      saving = false;
    }
  }
</script>

<section class="card" aria-label="Avatar">
  <div class="row">
    <div class="left">
      <div class="title">Avatar</div>
      <div class="hint">PNG/JPG, up to 500KB.</div>
    </div>
    <div class="right">
      <AvatarDisplay username={user?.username ?? ''} avatarBase64={currentAvatar} size={64} showRing={true} />
    </div>
  </div>

  <div class="actions">
    <label class="btn" title="Upload a new avatar">
      Upload
      <input type="file" accept="image/png,image/jpeg" on:change={onPickFile} />
    </label>

    <button type="button" class="btn btn-ghost" on:click={onRemove} disabled={saving}>
      Remove
    </button>

    <button type="button" class="btn btn-primary" on:click={onSave} disabled={!canSave}>
      {saving ? 'Saving...' : 'Save'}
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
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

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .title {
    font-weight: 900;
    letter-spacing: -0.01em;
  }

  .hint {
    margin-top: 2px;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }

  .btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 700;
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .btn input[type='file'] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-primary {
    background: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .error {
    color: var(--danger);
    font-size: var(--font-size-xs);
  }

  @media (hover: hover) {
    .btn:hover:not(:disabled) {
      background: var(--bg-overlay);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>

