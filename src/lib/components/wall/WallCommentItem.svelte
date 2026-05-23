<script>
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import MessageMedia from '$lib/components/mediaPicker/MessageMedia.svelte';
  import MediaPicker from '$lib/components/mediaPicker/MediaPicker.svelte';
  import MediaPreviewStrip from '$lib/components/mediaPicker/MediaPreviewStrip.svelte';
  import { addRecentItem } from '$lib/stores/klipyRecents.js';
  import { createComposer } from '$lib/utils/mediaComposer.js';
  import { formatRelativeTime } from '$lib/utils/time.js';
  import { deleteWallComment, editWallComment } from '$lib/stores/wall/comments.js';

  export let comment;
  export let canEdit = false;
  export let canDelete = false;

  let editing = false;
  let draft = '';
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  let draftMedia = [];
  let pickerOpen = false;
  let saving = false;
  const composer = createComposer();
  $: composer.setText(draft);
  $: composer.setMedia(draftMedia);

  $: tsText = formatRelativeTime(comment?.createdAt ?? Date.now());
  $: isDeleted = comment?.deleted === true;
  $: showEdited = !isDeleted && typeof comment?.editedAt === 'number' && comment.editedAt !== null;

  function startEdit() {
    if (!canEdit) return;
    if (isDeleted) return;
    editing = true;
    draft = String(comment?.text ?? '');
    draftMedia = Array.isArray(comment?.media) ? comment.media.slice(0, 2) : [];
    pickerOpen = false;
  }

  function cancel() {
    editing = false;
    draft = '';
    draftMedia = [];
    pickerOpen = false;
    saving = false;
  }

  async function save() {
    if (!canEdit) return;
    const { text: t, media } = composer.toPayload();
    const text = String(t ?? '');
    if (text.trim().length === 0 && !(media && media.length > 0)) return;
    saving = true;
    try {
      await editWallComment(comment.id, text, media);
      editing = false;
    } catch (err) {
      console.error('editWallComment failed', err);
    } finally {
      saving = false;
    }
  }

  async function del() {
    if (!canDelete) return;
    if (isDeleted) return;
    try {
      await deleteWallComment(comment.id);
    } catch (err) {
      console.error('deleteWallComment failed', err);
    }
  }
</script>

{#if comment}
  <div class="item" aria-label={`Comment by ${comment.authorUsername}`}>
    <MediaPicker
      bind:open={pickerOpen}
      maxItems={2}
      selectedItems={draftMedia}
      on:select={(ev) => {
        const item = ev?.detail?.item;
        if (!item) return;
        addRecentItem(item);
        composer.addItem(item);
        draftMedia = composer.toPayload().media ?? [];
      }}
      on:close={() => (pickerOpen = false)}
    />
    <AvatarDisplay
      username={comment.authorUsername}
      avatarBase64={comment.authorAvatarBase64 ?? null}
      size={32}
      showRing={true}
    />

    <div class="main">
      {#if !isDeleted}
        <div class="head">
          <div class="who">
            <span class="name" style={`color:${comment.authorColor};`}>{comment.authorUsername}</span>
            <span class="time" title={new Date(comment.createdAt).toLocaleString()}>{tsText}</span>
            {#if showEdited}
              <span class="edited" title={new Date(comment.editedAt).toLocaleString()}>edited</span>
            {/if}
          </div>

          <div class="actions">
            {#if canEdit && !editing}
              <button type="button" class="icon" on:click={startEdit} aria-label="Edit comment" title="Edit">
                Edit
              </button>
            {/if}
            {#if canDelete && !editing}
              <button type="button" class="icon danger" on:click={del} aria-label="Delete comment" title="Delete">
                Delete
              </button>
            {/if}
          </div>
        </div>
      {/if}

      {#if isDeleted}
        <div class="text" style="color: var(--text-muted); font-style: italic;">
          [ This comment was deleted ]
        </div>
      {:else if editing}
        <div class="edit">
          <MediaPreviewStrip
            items={draftMedia}
            disabled={saving}
            on:remove={(ev) => { composer.removeItem(ev.detail.id); draftMedia = composer.toPayload().media ?? []; }}
          />
          <textarea class="ta" bind:value={draft} rows="3" maxlength="500" aria-label="Edit comment text"></textarea>
          <div class="edit-actions">
            <button
              type="button"
              class="btn btn-ghost"
              on:click={() => {
                if (draftMedia.length >= 2) return;
                pickerOpen = !pickerOpen;
              }}
              disabled={saving || draftMedia.length >= 2}
              aria-label="Open media picker"
              title="GIFs & Stickers"
            >
              Media
            </button>
            <button type="button" class="btn btn-ghost" on:click={cancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary"
              on:click={save}
              disabled={saving || (draft.trim().length === 0 && draftMedia.length === 0)}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      {:else}
        <div class="text">
          {comment.text}
          <MessageMedia media={comment?.media ?? null} username={comment?.authorUsername ?? ''} />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .item {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 12px;
    align-items: start;
    padding: 10px 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-surface);
  }

  .main {
    min-width: 0;
    display: grid;
    gap: 8px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .who {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .name {
    font-weight: 900;
    overflow-wrap: anywhere;
  }

  .time,
  .edited {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .edited {
    color: var(--text-secondary);
  }

  .actions {
    display: inline-flex;
    gap: 10px; /* >= 8px separation */
    align-items: center;
  }

  .icon {
    height: 44px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 900;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
  }

  .danger {
    color: color-mix(in srgb, var(--danger) 90%, var(--text-primary));
  }

  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
    color: var(--text-primary);
  }

  .edit {
    display: grid;
    gap: 10px;
  }

  .ta {
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 10px 12px;
    outline: none;
    resize: vertical;
    max-height: 200px;
  }

  .ta:focus {
    border-color: var(--border-focus);
  }

  .edit-actions {
    display: inline-flex;
    justify-content: flex-end;
    gap: 10px; /* >= 8px separation */
    flex-wrap: wrap;
  }

  .btn {
    height: 44px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    font-weight: 900;
    font-size: var(--font-size-sm);
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-primary {
    background: var(--accent);
    color: var(--text-primary);
  }

  @media (hover: hover) {
    .icon:hover {
      background: var(--bg-overlay);
    }
    .btn-ghost:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>
