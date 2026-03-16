<script>
  import { activeChat } from '$lib/stores/privateChatStore.js';
  import PrivateChatList from '$lib/components/PrivateChatList.svelte';
  import PrivateChatWindow from '$lib/components/PrivateChatWindow.svelte';
</script>

<div class="h-full flex">
  <!-- Desktop/tablet: list + window side-by-side. Mobile: list OR window. -->
  <div class={`w-full sm:w-[280px] border-r border-[var(--border)] ${$activeChat ? 'hidden sm:block' : ''}`}>
    <PrivateChatList />
  </div>

  {#if $activeChat}
    <div class="flex-1 min-w-0">
      <PrivateChatWindow />
    </div>
  {:else}
    <div class="hidden sm:grid flex-1 place-items-center text-[var(--text-muted)] text-[var(--font-size-sm)]">
      <div>Select a conversation</div>
    </div>
  {/if}
</div>

