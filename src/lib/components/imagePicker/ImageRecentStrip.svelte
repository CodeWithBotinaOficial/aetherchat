<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { imageRecents } from '$lib/stores/imageRecents.js';
  import { getImageAttachment } from '$lib/services/db/imageAttachments.db.js';

  /** @type {File[]} */
  export let selectedFiles = [];
  export let maxImages = 4;
  
  const dispatch = createEventDispatcher();
  
  // Cache to store created File objects so reference equality works for selection
  const fileCache = new SvelteMap(); // transferId -> File
  let thumbnailUrls = {}; // transferId -> string|null
  const isLoading = new SvelteSet(); // Set of transferIds currently loading

  onMount(async () => {
    // We still subscribe to imageRecents reactively in the template for the array,
    // but we can load thumbnails here. Actually, imageRecents can change over time.
    // Let's make a reactive statement that loads missing thumbnails, but doesn't recreate object URLs.
  });

  function loadThumbnails(recents) {
    for (const recent of recents) {
      if (!Object.hasOwn(thumbnailUrls, recent.transferId) && !isLoading.has(recent.transferId)) {
        isLoading.add(recent.transferId);
        getImageAttachment(recent.transferId).then(attachment => {
          if (attachment?.blob) {
            thumbnailUrls[recent.transferId] = URL.createObjectURL(attachment.blob);
            const file = new File([attachment.blob], recent.filename || 'image.jpg', { type: recent.mimeType || attachment.blob.type });
            file._sourceId = recent.transferId;
            fileCache.set(recent.transferId, file);
          } else {
            thumbnailUrls[recent.transferId] = null;
          }
          thumbnailUrls = { ...thumbnailUrls }; // trigger reactivity
          isLoading.delete(recent.transferId);
        }).catch(err => {
          console.error('Failed to load recent image blob', err);
          thumbnailUrls[recent.transferId] = null;
          thumbnailUrls = { ...thumbnailUrls };
          isLoading.delete(recent.transferId);
        });
      }
    }
  }

  $: loadThumbnails($imageRecents);

  onDestroy(() => {
    Object.values(thumbnailUrls).forEach(url => {
      if (url) URL.revokeObjectURL(url);
    });
  });
  
  function handleToggle(recent) {
    const file = fileCache.get(recent.transferId);
    if (!file) return;
    dispatch('toggleFile', { file });
  }
  
  // Check if a recent entry is currently selected
  function isSelected(recent) {
    const cachedFile = fileCache.get(recent.transferId);
    if (!cachedFile) return false;
    return selectedFiles.some(f => f === cachedFile || f._sourceId === recent.transferId);
  }
</script>

<div class="flex items-center gap-[var(--space-sm)] overflow-x-auto p-[var(--space-sm)] snap-x" style="height: 104px;">
  {#if $imageRecents.length === 0}
    <div class="text-[var(--font-size-sm)] text-[var(--text-muted)] p-[var(--space-md)] italic whitespace-nowrap">
      Recently sent images appear here
    </div>
  {:else}
    {#each $imageRecents as recent (recent.transferId)}
      <button
        type="button"
        class="relative flex-shrink-0 w-[88px] h-[88px] snap-start rounded-[var(--radius-sm)] border-[3px] overflow-hidden cursor-pointer transition-all"
        class:border-[var(--accent)]={isSelected(recent)}
        class:border-transparent={!isSelected(recent)}
        class:opacity-50={!isSelected(recent) && selectedFiles.length >= maxImages}
        class:cursor-not-allowed={!isSelected(recent) && selectedFiles.length >= maxImages}
        disabled={!isSelected(recent) && selectedFiles.length >= maxImages}
        on:click={() => handleToggle(recent)}
        aria-label="Select image"
      >
        {#if isLoading.has(recent.transferId)}
          <div class="absolute inset-0 bg-[var(--bg-elevated)] flex items-center justify-center">
            <svg class="w-4 h-4 animate-spin text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" opacity="0.2"></circle>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        {:else if thumbnailUrls[recent.transferId]}
          <img
            src={thumbnailUrls[recent.transferId]}
            alt={recent.filename || 'Image'}
            class="w-full h-full object-cover"
          />
        {:else}
          <div class="absolute inset-0 bg-[var(--bg-elevated)]"></div>
        {/if}

        <!-- Selected checkmark -->
        {#if isSelected(recent)}
          <div class="absolute top-1 right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
            <svg class="w-3 h-3 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
        {/if}
      </button>
    {/each}
  {/if}
</div>
