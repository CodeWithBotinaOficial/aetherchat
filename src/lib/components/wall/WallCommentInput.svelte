<script>
  import { postWallComment } from '$lib/stores/wall/comments.js';
  import MediaPicker from '$lib/components/mediaPicker/MediaPicker.svelte';
  import MediaPreviewStrip from '$lib/components/mediaPicker/MediaPreviewStrip.svelte';
  import { createComposer } from '$lib/utils/mediaComposer.js';
  import { addRecentItem } from '$lib/stores/klipyRecents.js';

  const composer = createComposer();
  let text = '';
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  let mediaItems = [];
  let pickerOpen = false;

  $: composer.setText(text);
  $: composer.setMedia(mediaItems);

  $: remaining = 500 - text.length;
  $: tooLong = remaining < 0;
  $: canPost = !tooLong && (text.trim().length > 0 || mediaItems.length > 0);

  async function post() {
    if (!canPost) return;
    const { text: rawText, media } = composer.toPayload();
    const body = String(rawText ?? '');
    const solo = body.trim().length === 0 && Array.isArray(media) && media.length > 0;
    // Optimistic UI: clear immediately, but restore on failure.
    const prevText = text;
    const prevMedia = mediaItems;
    text = '';
    mediaItems = [];
    if (solo) pickerOpen = false;
    composer.reset();
    try {
      await postWallComment(body, media);
    } catch (err) {
      console.error('postWallComment failed', err);
      text = prevText;
      mediaItems = prevMedia;
      // Restore picker for retry.
      if (solo) pickerOpen = true;
    }
  }
</script>

<div class="wrap">
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

  <div class="input">
    <MediaPreviewStrip items={mediaItems} on:remove={(ev) => { composer.removeItem(ev.detail.id); mediaItems = composer.toPayload().media ?? []; }} />

    <textarea
      class="ta"
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
        disabled={mediaItems.length >= 2}
        on:click={() => {
          if (mediaItems.length >= 2) return;
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
