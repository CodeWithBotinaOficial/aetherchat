import { derived, get, writable } from 'svelte/store';
import { decryptForSession, isSessionActive } from '$lib/services/crypto.js';
import { deletePrivateChat, getPrivateChats, getPrivateMessages } from '$lib/services/db.js';

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

// ── Derived stores ───────────────────────────────────────────────────────────

export const chatList = derived(privateChatStore, ($s) => [...$s.chats.values()].sort((a, b) => b.lastActivity - a.lastActivity));

export const activeChat = derived(privateChatStore, ($s) =>
  $s.activeChatId ? $s.chats.get($s.activeChatId) ?? null : null
);

export const totalUnread = derived(privateChatStore, ($s) => [...$s.chats.values()].reduce((sum, c) => sum + c.unreadCount, 0));

function withChat(updateFn) {
  update((s) => {
    const nextChats = new Map(s.chats);
    updateFn(nextChats, s);
    return { ...s, chats: nextChats };
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Loads chat metadata from DB into the store. Does not load messages yet.
 * @param {string} myPeerId
 */
export async function loadPrivateChats(myPeerId) {
  const chats = await getPrivateChats(myPeerId);
  update((s) => {
    const next = new Map();
    for (const c of chats) {
      next.set(c.id, {
        id: c.id,
        theirPeerId: c.theirPeerId,
        theirUsername: c.theirUsername,
        theirColor: c.theirColor,
        theirAvatarBase64: c.theirAvatarBase64 ?? null,
        messages: [],
        unreadCount: 0,
        lastMessage: null,
        lastActivity: c.lastActivity ?? c.createdAt ?? Date.now(),
        isOnline: false,
        keyExchangeState: 'idle',
        __loaded: false
      });
    }
    return { ...s, chats: next };
  });
}

/**
 * @param {string} chatId
 */
export function openChat(chatId) {
  update((s) => {
    const next = new Map(s.chats);
    const chat = next.get(chatId);
    if (chat) next.set(chatId, { ...chat, unreadCount: 0 });
    return { ...s, chats: next, activeChatId: chatId };
  });

  // Lazily load messages on first open. sessionId === chatId by design.
  const state = get(privateChatStore);
  const chat = state.chats.get(chatId);
  if (chat && !chat.__loaded) {
    loadChatMessages(chatId, chatId).catch((err) => console.error('loadChatMessages failed', err));
  }
}

export function closeChat() {
  update((s) => ({ ...s, activeChatId: null }));
}

/**
 * Loads messages from DB and attempts to decrypt using the active session.
 * Undecryptable messages are shown as a placeholder.
 * @param {string} chatId
 * @param {string} sessionId
 */
export async function loadChatMessages(chatId, sessionId) {
  const rows = await getPrivateMessages(chatId, 100);
  const canDecrypt = isSessionActive(sessionId);

  const decrypted = await Promise.all(
    rows.map(async (m) => {
      let text = '🔒 Encrypted message — start a new session to decrypt';
      if (canDecrypt) {
        try {
          text = await decryptForSession(sessionId, m.ciphertext, m.iv);
        } catch {
          // keep placeholder
        }
      }
      return {
        id: m.id,
        direction: m.direction,
        text,
        timestamp: m.timestamp,
        delivered: Boolean(m.delivered)
      };
    })
  );

  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const last = decrypted[decrypted.length - 1];
    chats.set(chatId, {
      ...chat,
      messages: decrypted,
      __loaded: true,
      lastMessage: canDecrypt ? (last?.text ?? null) : null
    });
  });
}

export function addOutgoingMessage(chatId, { id, text, timestamp }) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = [...chat.messages, { id, direction: 'sent', text, timestamp, delivered: false }];
    chats.set(chatId, { ...chat, messages, lastMessage: text, lastActivity: timestamp });
  });
}

export function addIncomingMessage(chatId, { id, text, timestamp }) {
  update((s) => {
    const next = new Map(s.chats);
    const chat = next.get(chatId);
    if (!chat) return s;

    const messages = [...chat.messages, { id, direction: 'received', text, timestamp, delivered: true }];
    const unreadInc = s.activeChatId === chatId ? 0 : 1;
    next.set(chatId, {
      ...chat,
      messages,
      lastMessage: text,
      lastActivity: timestamp,
      unreadCount: (chat.unreadCount ?? 0) + unreadInc
    });
    return { ...s, chats: next };
  });
}

export function prependMessages(chatId, messages) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const next = [...messages, ...chat.messages];
    chats.set(chatId, { ...chat, messages: next });
  });
}

export function markDelivered(chatId, messageId) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = chat.messages.map((m) => (m.id === messageId ? { ...m, delivered: true } : m));
    chats.set(chatId, { ...chat, messages });
  });
}

export function setKeyExchangeState(chatId, state) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, keyExchangeState: state });
  });
}

export function setChatOnlineStatus(theirPeerId, isOnline) {
  withChat((chats) => {
    for (const [id, chat] of chats.entries()) {
      if (chat.theirPeerId === theirPeerId) chats.set(id, { ...chat, isOnline });
    }
  });
}

export function upsertChatEntry(entry) {
  withChat((chats) => {
    const prev = chats.get(entry.id);
    chats.set(entry.id, {
      ...(prev ?? {
        messages: [],
        unreadCount: 0,
        lastMessage: null,
        isOnline: false,
        keyExchangeState: 'idle',
        __loaded: false
      }),
      ...entry
    });
  });
}

export async function deleteChatFromStore(chatId) {
  update((s) => {
    const next = new Map(s.chats);
    next.delete(chatId);
    const activeChatId = s.activeChatId === chatId ? null : s.activeChatId;
    return { ...s, chats: next, activeChatId };
  });
  await deletePrivateChat(chatId);
}

export function markChatAsRead(chatId) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, unreadCount: 0 });
  });
}
