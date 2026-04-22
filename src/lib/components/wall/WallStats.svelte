<script>
  export let followerCount = 0;
  export let followingCount = 0;
</script>

<!--
  Counts are node-local views of the P2P network (what this browser has heard about).
  Different peers can legitimately show different numbers.
-->
<div class="stats" aria-label="Wall stats">
  <div class="stat">
    <div class="n">{followerCount}</div>
    <div class="k">Followers</div>
  </div>
  <div class="divider" aria-hidden="true"></div>
  <div class="stat">
    <div class="n">{followingCount}</div>
    <div class="k">Following</div>
  </div>
</div>

<style>
  .stats {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
  }

  .stat {
    display: grid;
    gap: 2px;
    min-width: 92px;
  }

  .n {
    font-weight: 900;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    font-size: 1.05rem;
    line-height: 1.1;
  }

  .k {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .divider {
    width: 1px;
    height: 28px;
    background: var(--border);
  }
</style>

