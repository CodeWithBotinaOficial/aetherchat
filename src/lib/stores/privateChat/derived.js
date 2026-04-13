import { derived } from 'svelte/store';
import { privateChatStore } from './state.js';

export const chatList = derived(privateChatStore, ($s) => [...$s.chats.values()].sort((a, b) => b.lastActivity - a.lastActivity));

export const activeChat = derived(privateChatStore, ($s) =>
  $s.activeChatId ? $s.chats.get($s.activeChatId) ?? null : null
);

export const totalUnread = derived(privateChatStore, ($s) => [...$s.chats.values()].reduce((sum, c) => sum + c.unreadCount, 0));

