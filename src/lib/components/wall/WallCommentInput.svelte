<script>
  import { postWallComment } from '$lib/stores/wall/comments.js';
  import MediaPicker from '$lib/components/mediaPicker/MediaPicker.svelte';
  import MediaPreviewStrip from '$lib/components/mediaPicker/MediaPreviewStrip.svelte';
  import EmojiPickerSlot from '$lib/components/emojiPicker/EmojiPickerSlot.svelte';
  import ImagePicker from '$lib/components/imagePicker/ImagePicker.svelte';
  import { createComposer } from '$lib/utils/mediaComposer.js';
  import { addRecentItem } from '$lib/stores/klipyRecents.js';
  import { sendImage } from '$lib/services/imageTransfer/index.js';
  import { getConnectedPeerIds } from '$lib/services/peer/shared.js';
  import { saveImageAttachment } from '$lib/services/db/imageAttachments.db.js';
  import { fileToArrayBuffer, getImageDimensions } from '$lib/utils/imageValidator.js';

  const composer = createComposer();
  let text = '';
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  let mediaItems = [];
  let pickerOpen = false;
  let emojiPickerOpen = false;
  let imagePickerOpen = false;
  /** @type {File[]} */
  let imageFiles = [];
  /** @type {HTMLTextAreaElement|null} */
  let textareaRef = null;

  $: composer.setText(text);
  $: composer.setMedia(mediaItems);

  $: remaining = 500 - text.length;
  $: tooLong = remaining < 0;
  $: canPost = !tooLong && (text.trim().length > 0 || mediaItems.length > 0 || imageFiles.length > 0);

  async function post() {
    if (!canPost) return;
    emojiPickerOpen = false;
    const { text: rawText, media } = composer.toPayload();
    const body = String(rawText ?? '');
    const solo = body.trim().length === 0 && Array.isArray(media) && media.length > 0;
    const imageIds = imageFiles.length > 0 ? [...imageFiles] : [];
    const prevText = text;
    const prevMedia = mediaItems;
    const prevImageFiles = imageFiles;
    text = '';
    mediaItems = [];
    imageFiles = [];
    if (solo) pickerOpen = false;
    composer.reset();
    try {
      if (imageIds.length === 0) {
        await postWallComment(body, media);
        return;
      }

      const results = await Promise.all(imageIds.map(async (file) => {
        try {
          const result = await sendImage(
            file,
            getConnectedPeerIds(),
            globalThis.crypto?.randomUUID?.() ?? `wall-${Date.now()}`,
            'wall'
          );
          const transferId = result?.transferId ?? null;
          if (!transferId) return null;
          const buffer = await fileToArrayBuffer(file);
          const { width, height } = await getImageDimensions(file);
          await saveImageAttachment({
            transferId,
            messageId: transferId,
            context: 'wall',
            blob: new Blob([buffer], { type: file.type }),
            mimeType: file.type,
            filename: file.name,
            sizeBytes: file.size,
            width,
            height,
            storedAt: Date.now()
          });
          return transferId;
        } catch (err) {
          console.error('Failed to prepare wall image', err);
          return null;
        }
      }));

      const transferIds = results.filter(Boolean);
      await postWallComment(body, media, transferIds.length > 0 ? transferIds : null);
    } catch (err) {
      console.error('postWallComment failed', err);
      text = prevText;
      mediaItems = prevMedia;
      imageFiles = prevImageFiles;
      if (solo) pickerOpen = true;
    }
  }
</script>

<div class="wrap">
  <EmojiPickerSlot bind:open={emojiPickerOpen} inputEl={textareaRef} />
  <MediaPicker
    bind:open={pickerOpen}
    maxItems={2}
    selectedItems={mediaItems}
    on:select={(ev) => {
      const item = ev?.detail?.item;
      if (!item) return;
      addRecentItem(item);
      composer.addItem(item);
      mediaItems = composer.toPayload().media ?? [];
      if (text.trim().length === 0 && mediaItems.length > 0) {
        // Media-only: send immediately.
        void post();
      }
    }}
    on:close={() => (pickerOpen = false)}
  />

  <ImagePicker
    bind:open={imagePickerOpen}
    maxImages={4}
    on:confirm={(ev) => {
      const picked = Array.isArray(ev.detail?.files) ? ev.detail.files : [];
      if (picked.length === 0) return;
      imageFiles = [...picked];
      imagePickerOpen = false;
      emojiPickerOpen = false;
      pickerOpen = false;
      if (text.trim().length === 0 && imageFiles.length > 0) {
        void post();
      }
    }}
    on:close={() => (imagePickerOpen = false)}
  />

  <div class="input">
    <MediaPreviewStrip items={mediaItems} on:remove={(ev) => { composer.removeItem(ev.detail.id); mediaItems = composer.toPayload().media ?? []; }} />

    <textarea
      class="ta"
      bind:this={textareaRef}
      bind:value={text}
      rows="3"
      maxlength="500"
      placeholder="Write a comment…"
      aria-label="Write a wall comment"
    ></textarea>

    <div class="row">
      <button
        type="button"
        class="media"
        on:click={() => {
          pickerOpen = false;
          emojiPickerOpen = !emojiPickerOpen;
        }}
        aria-label="Open emoji picker"
        title="Emoji"
      >
        <span class="emo" aria-hidden="true">😊</span>
      </button>

      <button
        type="button"
        class="media"
        disabled={mediaItems.length >= 2}
        on:click={() => {
          if (mediaItems.length >= 2) return;
          emojiPickerOpen = false;
          pickerOpen = !pickerOpen;
        }}
        aria-label="Open media picker"
        title="GIFs & Stickers"
      >
        <svg viewBox="0 0 24 24" class="ico" fill="currentColor" aria-hidden="true">
          <path
            d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm2 0v14h12V5H6Zm2 3h8v2H8V8Zm0 4h5v2H8v-2Z"
          />
        </svg>
      </button>

      <button
        type="button"
        class="media"
        on:click={() => {
          emojiPickerOpen = false;
          pickerOpen = false;
          imagePickerOpen = !imagePickerOpen;
        }}
        aria-label="Attach image"
        title="Attach image"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      </button>

      <div class={`counter ${tooLong ? 'bad' : ''}`} aria-label="Characters remaining">
        {remaining}
      </div>
      <button type="button" class="btn" on:click={post} disabled={!canPost} aria-label="Post comment" title="Post comment">
        Post
      </button>
    </div>
  </div>
</div>

<style>
  .wrap {
    position: relative;
  }

  .input {
    border: 1px solid var(--border);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-md);
    display: grid;
    gap: 10px;
  }

  .ta {
    width: 100%;
    resize: vertical;
    min-height: 78px;
    max-height: 200px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 10px 12px;
    outline: none;
    line-height: 1.4;
  }

  .ta:focus {
    border-color: var(--border-focus);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .media {
    height: 44px;
    width: 44px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    display: grid;
    place-items: center;
    padding: 0;
    flex: none;
  }

  .media:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .ico {
    height: 20px;
    width: 20px;
  }

  .emo {
    font-size: 20px;
    line-height: 1;
  }

  .counter {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
    flex: 1;
    text-align: right;
  }

  .counter.bad {
    color: color-mix(in srgb, var(--danger) 80%, var(--text-muted));
  }

  .btn {
    height: 44px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--accent);
    color: var(--text-primary);
    font-weight: 900;
    font-size: var(--font-size-sm);
    flex: none;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (hover: hover) {
    .btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    .media:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>
