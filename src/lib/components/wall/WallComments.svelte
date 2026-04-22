<script>
  import { peer } from '$lib/stores/peerStore.js';
  import WallCommentInput from './WallCommentInput.svelte';
  import WallCommentItem from './WallCommentItem.svelte';

  export let wall = null;

  let expanded = false;

  $: myPeerId = $peer?.peerId ?? null;
  $: isOwner = Boolean(wall && myPeerId && wall.ownerPeerId === myPeerId);

  $: all = Array.isArray(wall?.comments) ? wall.comments : [];
  $: visible = expanded ? all.slice(0, 50) : all.slice(0, 10);
  $: canShowMore = !expanded && all.length > 10;
  $: atCap = expanded && all.length >= 50;
</script>

{#if wall}
  <div class="comments" aria-label="Wall comments">
    <WallCommentInput />

    {#if visible.length === 0}
      <div class="empty">No comments yet.</div>
    {:else}
      <div class="list">
        {#each visible as c (c.id)}
          <WallCommentItem
            comment={c}
            canEdit={Boolean(myPeerId && c.authorPeerId === myPeerId)}
            canDelete={Boolean(myPeerId && (c.authorPeerId === myPeerId || isOwner))}
          />
        {/each}
      </div>
    {/if}

    {#if canShowMore}
      <button type="button" class="more" on:click={() => (expanded = true)} aria-label="Show more comments" title="Show more">
        Show more
      </button>
    {:else if atCap}
      <div class="cap">Only the 50 most recent comments are shown.</div>
    {/if}
  </div>
{/if}

<style>
  .comments {
    display: grid;
    gap: 12px;
  }

  .empty {
    padding: 12px 10px;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    text-align: center;
  }

  .list {
    display: grid;
    gap: 10px;
  }

  .more {
    height: 40px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-weight: 900;
    font-size: var(--font-size-sm);
  }

  .cap {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    text-align: center;
    padding: 4px 0;
  }

  @media (hover: hover) {
    .more:hover {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>

