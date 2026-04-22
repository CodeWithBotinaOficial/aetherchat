<script>
  import { postWallComment } from '$lib/stores/wall/comments.js';

  let text = '';

  $: remaining = 500 - text.length;
  $: tooLong = remaining < 0;
  $: canPost = text.trim().length > 0 && !tooLong;

  async function post() {
    if (!canPost) return;
    const body = text;
    text = '';
    try {
      await postWallComment(body);
    } catch (err) {
      console.error('postWallComment failed', err);
      // If it failed, restore the text so the user doesn't lose it.
      text = body;
    }
  }
</script>

<div class="input">
  <textarea
    class="ta"
    bind:value={text}
    rows="3"
    maxlength="500"
    placeholder="Write a comment…"
    aria-label="Write a wall comment"
  ></textarea>

  <div class="row">
    <div class={`counter ${tooLong ? 'bad' : ''}`} aria-label="Characters remaining">
      {remaining}
    </div>
    <button type="button" class="btn" on:click={post} disabled={!canPost} aria-label="Post comment" title="Post comment">
      Post
    </button>
  </div>
</div>

<style>
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

  .counter {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .counter.bad {
    color: color-mix(in srgb, var(--danger) 80%, var(--text-muted));
  }

  .btn {
    height: 38px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--accent);
    color: var(--text-primary);
    font-weight: 900;
    font-size: var(--font-size-sm);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (hover: hover) {
    .btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>
