<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { getImageAttachment } from '$lib/services/db/imageAttachments.db.js';
  import { get } from 'svelte/store';
  import { peer as peerStore } from '$lib/stores/peerStore.js';
  import { broadcastToAll, buildMessage, cachedProfile, userProfileRef } from '$lib/services/peer/shared.js';
  import { onImageEvent } from '$lib/services/imageTransfer/events.js';

  /** @type {string[]} */
  export let transferIds = [];

  const dispatch = createEventDispatcher();
  
  /** @type {Array<{ id: string, url: string, blob: Blob }>} */
  let images = [];
  let loading = true;
  let statusMessage = '';
  let mountedTime = Date.now();
  
  let unsubEvent = null;
  let timeoutId = null;

  async function loadImages() {
    loading = true;
    statusMessage = '';
    
    try {
      if (Array.isArray(transferIds) && transferIds.length > 0) {
        const promises = transferIds.map(async (id) => {
          try {
            const attachment = await getImageAttachment(id);
            if (attachment && attachment.blob && attachment.blob.size > 0) {
              const url = URL.createObjectURL(attachment.blob);
              return { id, url, blob: attachment.blob };
            }
          } catch (e) {
            console.error('Failed to load image attachment', id, e);
          }
          return null;
        });
        
        const results = await Promise.all(promises);
        images = results.filter(img => img !== null);

        if (images.length === 0 && transferIds.length > 0) {
          // Check how long we've been mounted
          const age = Date.now() - mountedTime;
          if (age < 2000) {
            // Wait until at least 2 seconds have passed before requesting
            setTimeout(() => {
              requestMissingImages();
            }, 2000 - age);
            return;
          } else {
            requestMissingImages();
          }
        }
      }
    } catch (e) {
      console.error('Error loading images', e);
      statusMessage = 'Image unavailable';
    } finally {
      loading = false;
    }
  }

  function requestMissingImages() {
    const state = get(peerStore);
    const hasOnlinePeers = Array.from(state.connectedPeers.values()).some(p => p.connection?.open);

    if (!hasOnlinePeers) {
      statusMessage = 'Image not available offline';
      return;
    }

    statusMessage = 'Requesting image...';
    const profile = userProfileRef || cachedProfile || { username: 'system', color: '#000', dateOfBirth: null };

    // Broadcast request for each missing image
    for (const id of transferIds) {
      const msg = buildMessage('IMAGE_REQUEST', state.peerId, profile, { transferId: id });
      broadcastToAll(msg);
    }

    unsubEvent = onImageEvent('imageReady', (payload) => {
      if (transferIds.includes(payload.transferId)) {
        if (timeoutId) clearTimeout(timeoutId);
        loadImages(); // Reload once ready
      }
    });

    timeoutId = setTimeout(() => {
      if (images.length === 0) {
        statusMessage = 'Image unavailable';
        if (unsubEvent) {
          unsubEvent();
          unsubEvent = null;
        }
      }
    }, 15000);
  }

  onMount(() => {
    mountedTime = Date.now();
    loadImages();
  });
  
  onDestroy(() => {
    if (unsubEvent) unsubEvent();
    if (timeoutId) clearTimeout(timeoutId);
    images.forEach(img => {
      if (img.url) {
        URL.revokeObjectURL(img.url);
      }
    });
  });

  function handleImageClick(index) {
    dispatch('openLightbox', { index, images });
  }
</script>

{#if loading && !statusMessage}
  <div class="mt-[var(--space-xs)] grid grid-cols-2 gap-[var(--space-xs)] animate-pulse">
    {#each transferIds as _id (_id)}
      <div class="bg-[var(--bg-overlay)] aspect-square rounded-[var(--radius-sm)] w-full"></div>
    {/each}
  </div>
{:else if statusMessage}
  <div class="mt-[var(--space-xs)] text-[var(--font-size-xs)] text-[var(--text-muted)] italic p-[var(--space-sm)] bg-[var(--bg-elevated)] rounded-[var(--radius-sm)] border border-[var(--border)] flex items-center justify-center h-[100px]">
    {statusMessage}
  </div>
{:else if images.length > 0}
  <div class={`mt-[var(--space-xs)] grid gap-[var(--space-xs)] ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
    {#each images as img, i (img.id)}
      <button 
        type="button"
        class="relative bg-[var(--bg-elevated)] rounded-[var(--radius-sm)] overflow-hidden cursor-pointer group border border-[var(--border)] p-0 m-0 w-full aspect-square text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        on:click|stopPropagation={() => handleImageClick(i)}
      >
        <img 
          src={img.url} 
          alt="Attachment" 
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200"></div>
      </button>
    {/each}
  </div>
{/if}
