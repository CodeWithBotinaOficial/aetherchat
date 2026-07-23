<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { imageRecents } from '$lib/stores/imageRecents.js';
  import { pickImageFiles } from '$lib/utils/imageFileInput.js';
  import ImageRecentStrip from './ImageRecentStrip.svelte';
  import ImagePreviewPanel from './ImagePreviewPanel.svelte';
  
  export let open = false;
  export let maxImages = 4;
  /** @type {File[]} */
  export let preselectedFiles = []; 
  
  const dispatch = createEventDispatcher();
  
  /** @type {File[]} */
  let selectedFiles = [];
  let hasRecentImages = false;
  let isLoadingFiles = false;
  let prevOpen = false;

  onMount(() => {
    // Track recent images changes
    const unsubscribe = imageRecents.subscribe((recents) => {
      hasRecentImages = recents.length > 0;
    });

    return unsubscribe;
  });

  $: {
    if (open !== prevOpen) {
      prevOpen = open;
      if (open) {
        if (!hasRecentImages && !isLoadingFiles && selectedFiles.length === 0) {
          setTimeout(triggerFilePickerImmediate, 0);
        }
      } else {
        selectedFiles = [];
      }
    }
  }

  $: if (preselectedFiles.length > 0 && open) {
    selectedFiles = [...preselectedFiles];
    preselectedFiles = [];
  }
  
  async function triggerFilePickerImmediate() {
    isLoadingFiles = true;
    try {
      const { valid } = await pickImageFiles({ multiple: true, maxImages });
      if (valid.length > 0) {
        selectedFiles = [...valid];
      }
    } catch (err) {
      console.error('Failed to pick images', err);
    } finally {
      isLoadingFiles = false;
    }
  }

  function handleToggleFile(ev) {
    const { file } = ev.detail;
    const index = selectedFiles.findIndex(f => 
      f === file || 
      (f._sourceId && f._sourceId === file._sourceId) || 
      (f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)
    );
    
    if (index >= 0) {
      selectedFiles.splice(index, 1);
      selectedFiles = selectedFiles;
    } else {
      if (selectedFiles.length < maxImages) {
        selectedFiles = [...selectedFiles, file];
      }
    }
  }
  
  async function handleChooseFromDevice() {
    isLoadingFiles = true;
    try {
      const remaining = maxImages - selectedFiles.length;
      if (remaining <= 0) return;

      const { valid } = await pickImageFiles({ multiple: true, maxImages: remaining });
      if (valid.length > 0) {
        selectedFiles = [...selectedFiles, ...valid];
      }
    } catch (err) {
      console.error('Failed to pick images', err);
    } finally {
      isLoadingFiles = false;
    }
  }
  
  function handleRemovePreview(ev) {
    const { index } = ev.detail;
    selectedFiles.splice(index, 1);
    selectedFiles = selectedFiles;
  }
  
  function handleConfirm() {
    dispatch('confirm', { files: selectedFiles });
    open = false;
  }
  
  function handleClose() {
    dispatch('close');
    open = false;
  }
</script>

{#if open && (hasRecentImages || selectedFiles.length > 0)}
  <div class="relative w-full border-t border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden" style="max-height: 380px; display: flex; flex-direction: column;" transition:slide|local={{ duration: 200 }}>

    <!-- Header -->
    <div class="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--border)]">
      <h3 class="text-[var(--font-size-sm)] font-bold m-0 text-[var(--text-primary)]">Send Image</h3>
      <button 
        type="button"
        class="w-[28px] h-[28px] rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)] cursor-pointer"
        on:click={handleClose}
        aria-label="Close image picker"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    
    <div class="relative flex-1 overflow-y-auto overflow-x-hidden min-h-[160px]">
      <!-- Recent Strip (only if has recent images) -->
      {#if hasRecentImages}
        <div class="border-b border-[var(--border)]">
          <ImageRecentStrip
            {selectedFiles}
            {maxImages}
            on:toggleFile={handleToggleFile}
          />

          <!-- "Choose from device" button -->
          <div class="p-[var(--space-md)] border-b border-[var(--border)]">
            <button
              type="button"
              disabled={isLoadingFiles || selectedFiles.length >= maxImages}
              class="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-overlay)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--font-size-sm)] text-[var(--text-primary)] font-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center justify-center gap-[var(--space-xs)]"
              on:click={handleChooseFromDevice}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
              </svg>
              Choose from device
            </button>
          </div>
        </div>
      {/if}

      <!-- Selected images preview -->
      {#if selectedFiles.length > 0}
        <div class="border-b border-[var(--border)]" transition:slide|local={{ duration: 150 }}>
          <ImagePreviewPanel
            files={selectedFiles}
            on:remove={handleRemovePreview}
          />
        </div>
      {/if}
    </div>

    <!-- Bottom action bar -->
    <div class="p-[var(--space-md)] flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-surface)]">
      {#if selectedFiles.length > 0}
        <div class="text-[var(--font-size-xs)] text-[var(--text-muted)]">
          {selectedFiles.length} of {maxImages} selected
        </div>
      {:else}
        <div></div>
      {/if}

      <button
        type="button"
        class="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-primary)] font-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        disabled={selectedFiles.length === 0}
        on:click={handleConfirm}
      >
        Send {selectedFiles.length > 0 ? selectedFiles.length : ''} image{#if selectedFiles.length !== 1}s{/if}
      </button>
    </div>
  </div>
{/if}
