<script>
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[] | null} */
  export let media = null;
  export let username = '';

  /** @type {Set<string>} */
  let broken = new Set();

  function safeAlt(type) {
    const u = String(username ?? '').trim() || 'user';
    return `${type} from ${u}`;
  }
</script>

{#if Array.isArray(media) && media.length > 0}
  <div class={`wrap ${media.length === 2 ? 'two' : 'one'}`} aria-label="Message media">
    {#each media.slice(0, 2) as m (m.id)}
      <figure class="it">
        {#if broken.has(m.id)}
          <div class="broken" aria-label="Media failed to load">Broken {m.type}</div>
        {:else}
          <img
            class="img"
            src={m.url}
            alt={safeAlt(m.type)}
            loading="lazy"
            on:error={(e) => {
              const el = e.currentTarget;
              if (el && el.dataset && el.dataset.fallback !== '1') {
                el.dataset.fallback = '1';
                el.src = m.previewUrl;
              } else {
                broken = new Set([...broken, m.id]);
              }
            }}
          />
        {/if}
      </figure>
    {/each}
  </div>
{/if}

<style>
  .wrap {
    margin-top: 10px;
    display: grid;
    gap: 8px;
  }

  .wrap.one {
    grid-template-columns: 1fr;
    max-width: min(240px, 100%);
  }

  .wrap.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: min(520px, 100%);
  }

  @media (max-width: 639px) {
    .wrap.one,
    .wrap.two {
      max-width: 100%;
    }

    .wrap.two {
      grid-template-columns: 1fr;
    }
  }

  .it {
    margin: 0;
    border-radius: 8px;
    border: 1px solid var(--border);
    overflow: hidden;
    background: var(--bg-elevated);
    position: relative;
  }

  .img {
    width: 100%;
    height: auto;
    display: block;
  }

  .broken {
    padding: 10px 12px;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
  }
</style>
