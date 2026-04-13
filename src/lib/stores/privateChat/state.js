import { writable } from 'svelte/store';

// ── State shape ──────────────────────────────────────────────────────────────
// {
//   chats: Map<chatId, ChatEntry>
//   activeChatId: string | null
//   pendingKeyExchanges: Map<peerId, 'waiting_ack'>
// }

const initialState = {
  chats: new Map(),
  activeChatId: null,
  pendingKeyExchanges: new Map()
};

const { subscribe, update, set } = writable(initialState);
export const privateChatStore = { subscribe, update, set };

/** @type {import('svelte/store').Writable<string|null>} */
export const editingMessageId = writable(null);
/** @type {import('svelte/store').Writable<string|null>} */
export const editingChatId = writable(null);

export const PRIVATE_DELETED_PLACEHOLDER = '[ This message was deleted ]';
export const CITED_DELETED_PLACEHOLDER = '[ Original message deleted ]';

export function withChat(updateFn) {
  privateChatStore.update((s) => {
    const nextChats = new Map(s.chats);
    updateFn(nextChats, s);
    return { ...s, chats: nextChats };
  });
}

