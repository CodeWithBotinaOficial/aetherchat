<script>
  import { tick } from 'svelte';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import MessageMedia from '$lib/components/mediaPicker/MessageMedia.svelte';
  import MediaPicker from '$lib/components/mediaPicker/MediaPicker.svelte';
  import MediaPreviewStrip from '$lib/components/mediaPicker/MediaPreviewStrip.svelte';
  import { addRecentItem } from '$lib/stores/klipyRecents.js';
  import { createComposer } from '$lib/utils/mediaComposer.js';
  import { formatRelativeTime } from '$lib/utils/time.js';
  import { deleteWallComment, editWallComment } from '$lib/stores/wall/comments.js';
  import ImageAttachmentView from '$lib/components/imagePicker/ImageAttachmentView.svelte';

  export let comment;
  export let canEdit = false;
  export let canDelete = false;

  let editing = false;
  let draft = '';
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  let draftMedia = [];
  let pickerOpen = false;
  let saving = false;
  let editTextarea;
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
    focusEditTextarea();
  }

  async function focusEditTextarea() {
    await tick();
    editTextarea?.focus();
  }

  function handleEditKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
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
      cancel();
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
    <AvatarDisplay
      username={comment.authorUsername}
      avatarBase64={comment.authorAvatarBase64 ?? null}
      size={32}
      showRing={true}
    />

    <div class="main">
      {#if !isDeleted}
        <div class="head" class:hidden={editing}>
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
        <div class="edit-container">
          <div class="edit-label">Editing comment</div>
          {#if pickerOpen}
            <div class="edit-media">
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
            </div>
          {/if}
          <MediaPreviewStrip
            items={draftMedia}
            disabled={saving}
            on:remove={(ev) => { composer.removeItem(ev.detail.id); draftMedia = composer.toPayload().media ?? []; }}
          />
          <textarea
            class="edit-textarea"
            bind:this={editTextarea}
            bind:value={draft}
            rows="3"
            maxlength="500"
            aria-label="Edit comment text"
            on:keydown={handleEditKeydown}
          ></textarea>
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
            <button type="button" class="btn btn-cancel" on:click={cancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-save"
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
          {#if Array.isArray(comment?.imageTransferIds) && comment.imageTransferIds.length > 0}
            <ImageAttachmentView transferIds={comment.imageTransferIds} context="wall" targetPeerId={null} />
          {/if}
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

  .hidden {
    display: none;
  }

  .edit-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--border-focus);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    width: 100%;
    box-sizing: border-box;
  }

  .edit-label {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-weight: 700;
  }

  .edit-media {
    order: 1;
  }

  .edit-textarea {
    order: 2;
    width: 100%;
    min-height: 80px;
    resize: vertical;
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-sm);
    font-size: var(--font-size-base);
    font-family: var(--font-sans);
    box-sizing: border-box;
  }

  .edit-textarea:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .edit-actions {
    order: 3;
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm);
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

  .btn-cancel {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px 16px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--font-size-sm);
  }

  .btn-save {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    padding: 6px 16px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  @media (hover: hover) {
    .icon:hover {
      background: var(--bg-overlay);
    }
    .btn-ghost:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
    .btn-save:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>
