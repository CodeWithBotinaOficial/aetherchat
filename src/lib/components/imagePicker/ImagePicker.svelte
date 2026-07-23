<script>
  import { createEventDispatcher } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import ImageRecentStrip from './ImageRecentStrip.svelte';
  import ImageGalleryGrid from './ImageGalleryGrid.svelte';
  import ImagePreviewPanel from './ImagePreviewPanel.svelte';
  
  export let open = false;
  export let maxImages = 4;
  /** @type {File[]} */
  export let preselectedFiles = []; 
  
  const dispatch = createEventDispatcher();
  
  /** @type {File[]} */
  let selectedFiles = [];
  let showGallery = false;
  
  $: if (!open) {
    selectedFiles = [];
    showGallery = false;
  } else if (preselectedFiles.length > 0) {
    selectedFiles = [...preselectedFiles];
    preselectedFiles = []; // Consume
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
  
  function handleAddFiles(ev) {
    const { files } = ev.detail;
    const remaining = maxImages - selectedFiles.length;
    const toAdd = files.slice(0, remaining);
    if (toAdd.length > 0) {
      selectedFiles = [...selectedFiles, ...toAdd];
    }
    // Automatically close gallery if we reached max after adding from device
    if (selectedFiles.length >= maxImages) {
      showGallery = false;
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

{#if open}
  <div class="relative w-full border-t border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden" style="max-height: 440px; display: flex; flex-direction: column;" transition:slide|local={{ duration: 200 }}>
    
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
      <!-- Recent Strip -->
      <div class="py-[var(--space-xs)] border-b border-[var(--border)]">
        <ImageRecentStrip 
          {selectedFiles} 
          {maxImages}
          on:toggleFile={handleToggleFile}
          on:browse={() => showGallery = true}
        />
      </div>
      
      <!-- Previews -->
      {#if selectedFiles.length > 0}
        <div class="py-[var(--space-xs)]" transition:slide|local={{ duration: 150 }}>
          <ImagePreviewPanel 
            files={selectedFiles}
            on:remove={handleRemovePreview}
          />
        </div>
      {/if}
      
      <!-- Actions -->
      <div class="p-[var(--space-md)] flex items-center justify-between border-t border-[var(--border)] mt-auto bg-[var(--bg-surface)]">
        <div class="text-[var(--font-size-xs)] text-[var(--text-muted)]">
          {selectedFiles.length} of {maxImages} selected
        </div>
        
        <button 
          type="button"
          class="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-primary)] font-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          disabled={selectedFiles.length === 0}
          on:click={handleConfirm}
        >
          Send {selectedFiles.length > 0 ? selectedFiles.length : ''} image{#if selectedFiles.length !== 1}s{/if}
        </button>
      </div>
      
      <!-- Full gallery overlay -->
      {#if showGallery}
        <div class="absolute inset-0 z-10" transition:fade|local={{ duration: 150 }}>
          <ImageGalleryGrid
            {selectedFiles}
            {maxImages}
            on:toggleFile={handleToggleFile}
            on:addFiles={handleAddFiles}
            on:close={() => showGallery = false}
          />
        </div>
      {/if}
    </div>
  </div>
{/if}
