<script>
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import ImagePicker from '$lib/components/imagePicker/ImagePicker.svelte';
  import { showToast } from '$lib/stores/toastStore.js';
  import { removeAvatar, uploadAvatar } from '$lib/services/profile/actions.js';
  import { validateImageFile, fileToBase64 } from '$lib/utils/imageValidator.js';
  import { MAX_AVATAR_BYTES } from '$lib/services/imageTransfer/types.js';

  export let user = null;

  let preview = null;
  let file = null;
  let error = '';
  let saving = false;
  let imagePickerOpen = false;

  $: currentAvatar = preview ?? (user?.avatarBase64 ?? null);
  $: canSave = !saving && !!file;

  function initialsFallback() {
    const name = String(user?.username ?? '').trim();
    if (!name) return '?';
    const parts = name.split(/\s+|[_-]+/).filter(Boolean);
    const first = parts[0]?.[0] ?? name[0];
    const second = parts[1]?.[0] ?? name[1] ?? '';
    return `${first}${second}`.toUpperCase().slice(0, 2) || '?';
  }

  async function setPreviewFromFile(f) {
    if (!f) return;
    const validation = validateImageFile(f, MAX_AVATAR_BYTES);
    if (!validation.valid) {
      error = validation.error ?? 'Invalid avatar file.';
      return;
    }

    file = f;
    preview = await fileToBase64(f);
    error = '';
  }

  function onRemove() {
    file = null;
    preview = null;
    error = '';
    imagePickerOpen = false;
    void removeAvatar().then((res) => {
      if (!res.ok) error = res.error ?? 'Could not remove avatar.';
      else showToast('Avatar removed.');
    });
  }

  async function onSave() {
    if (!file) return;
    saving = true;
    error = '';
    try {
      const res = await uploadAvatar(file);
      if (!res.ok) {
        error = res.error ?? 'Could not save avatar.';
        return;
      }
      showToast('Avatar updated.');
      file = null;
      preview = null;
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
      <div class="hint">PNG, JPG, WEBP, AVIF, SVG, GIF, ICO • up to 2MB</div>
    </div>
    <div class="right">
      {#if currentAvatar}
        <AvatarDisplay username={user?.username ?? ''} avatarBase64={currentAvatar} size={120} showRing={true} />
      {:else}
        <div class="fallback" aria-label="Initials avatar">{initialsFallback()}</div>
      {/if}
    </div>
  </div>

  <div class="actions">
    <button type="button" class="btn btn-primary" on:click={() => (imagePickerOpen = !imagePickerOpen)}>
      Choose Photo
    </button>
    <button type="button" class="btn btn-ghost" on:click={onRemove}>
      Remove Photo
    </button>
    <button type="button" class="btn btn-primary" on:click={onSave} disabled={!canSave || saving}>
      {saving ? 'Saving...' : 'Save'}
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <ImagePicker bind:open={imagePickerOpen} maxImages={1} on:confirm={(ev) => { const [filePicked] = ev.detail.files ?? []; if (!filePicked) return; void setPreviewFromFile(filePicked); imagePickerOpen = false; }} on:close={() => (imagePickerOpen = false)} />
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
  .left {
    min-width: 0;
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
  .right {
    display: grid;
    place-items: center;
  }
  .fallback {
    width: 120px;
    height: 120px;
    border-radius: 9999px;
    background: linear-gradient(135deg, var(--accent), var(--bg-overlay));
    display: grid;
    place-items: center;
    color: var(--text-primary);
    font-size: 2rem;
    font-weight: 900;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  .btn {
    min-height: 44px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 700;
    padding: 0 16px;
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .btn-primary { background: var(--accent); }
  .btn-ghost { background: transparent; color: var(--text-secondary); }
  .error { color: var(--danger); font-size: var(--font-size-xs); }
</style>

