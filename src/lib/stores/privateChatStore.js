import { derived, get, writable } from 'svelte/store';
import { tick } from 'svelte';
import { closeSession, decryptForSession, isSessionActive, resumeSession } from '$lib/services/crypto.js';
import {
  clearQueuedMessagesForPeer,
  deletePrivateChat,
  getSentMessagesPlaintext,
  getPrivateChats,
  getPrivateMessages,
  getQueuedMessagesForPeer,
  updateChatMeta
} from '$lib/services/db.js';

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
  const chatMap = new Map();

  for (const c of chats) {
    const dbMessages = await getPrivateMessages(c.id, 50);
    const sentPlain = await getSentMessagesPlaintext(c.id);
    const sentPlainMap = new Map(sentPlain.map((m) => [m.id, m.plaintext]));
    const messages = dbMessages.map((m) => {
      if (m.direction === 'sent') {
        const plaintext = sentPlainMap.get(m.id);
        return {
          id: m.id,
          direction: 'sent',
          text: plaintext ?? '🔒 Sent message (plaintext not available)',
          ciphertext: m.ciphertext,
          iv: m.iv,
          timestamp: m.timestamp,
          delivered: Boolean(m.delivered),
          sealed: false
        };
      }
      return {
        id: m.id,
        direction: 'received',
        text: null,
        ciphertext: m.ciphertext,
        iv: m.iv,
        timestamp: m.timestamp,
        delivered: Boolean(m.delivered),
        sealed: true
      };
    });

    const queuedMsgs = await getQueuedMessagesForPeer(c.theirPeerId);
    const queuedInMemory = queuedMsgs.map((m) => ({
      id: m.id,
      direction: 'sent',
      text: m.plaintext,
      ciphertext: null,
      iv: null,
      timestamp: m.timestamp,
      delivered: false,
      queued: true,
      sealed: false
    }));

    const allMessages = [...messages, ...queuedInMemory].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    chatMap.set(c.id, {
      id: c.id,
      theirPeerId: c.theirPeerId,
      theirUsername: c.theirUsername,
      theirColor: c.theirColor,
      theirAvatarBase64: c.theirAvatarBase64 ?? null,
      messages: allMessages,
      unreadCount: typeof c.unreadCount === 'number' ? c.unreadCount : 0,
      lastMessage: c.lastMessagePreview ?? null,
      lastActivity: c.lastActivity ?? c.createdAt ?? Date.now(),
      isOnline: false,
      keyExchangeState: 'idle',
      __loaded: true
    });
  }

  update((s) => ({ ...s, chats: chatMap }));
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
  // Best-effort: attempt to decrypt any sealed messages. decryptForSession will
  // transparently resume the key ring from storage when available.
  decryptSealedMessages(chatId, chatId).catch((err) => console.error('decryptSealedMessages failed', err));

  // Persist unreadCount reset.
  updateChatMeta(chatId, { unreadCount: 0 }).catch((err) => console.error('updateChatMeta failed', err));
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

export async function decryptSealedMessages(chatId, sessionId) {
  const chat = get(privateChatStore).chats.get(chatId);
  if (!chat) return;

  // Best-effort: load the persisted key ring so previously-received messages can
  // decrypt after a browser restart (Phase 9).
  try {
    await resumeSession(sessionId);
  } catch {
    // ignore
  }

  const decrypted = await Promise.all(
    chat.messages.map(async (m) => {
      // Only attempt to decrypt received sealed messages.
      if (!m?.sealed || m.direction === 'sent') return m;
      if (typeof m.ciphertext !== 'string' || typeof m.iv !== 'string') return m;
      try {
        const text = await decryptForSession(sessionId, m.ciphertext, m.iv);
        return { ...m, text, sealed: false };
      } catch {
        // Keep sealed so we can retry later (e.g. after a key ring resumes from storage).
        return { ...m, text: '🔒 Encrypted in a previous session', sealed: true };
      }
    })
  );

  withChat((chats) => {
    const curr = chats.get(chatId);
    if (!curr) return;
    chats.set(chatId, { ...curr, messages: decrypted });
  });
}

export function addOutgoingMessage(chatId, { id, text, timestamp }) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = [...chat.messages, { id, direction: 'sent', text, timestamp, delivered: false, queued: false, sealed: false }];
    chats.set(chatId, { ...chat, messages, lastMessage: text, lastActivity: timestamp });
  });
}

export function addIncomingMessage(chatId, { id, text, timestamp, ciphertext = null, iv = null, sealed = false }) {
  update((s) => {
    const next = new Map(s.chats);
    const chat = next.get(chatId);
    if (!chat) return s;

    const messages = [
      ...chat.messages,
      { id, direction: 'received', text, ciphertext, iv, timestamp, delivered: true, sealed: Boolean(sealed) }
    ];
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

export function updateMessageQueued(chatId, messageId, queued) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = chat.messages.map((m) => (m.id === messageId ? { ...m, queued: Boolean(queued) } : m));
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
  // Capture peerId BEFORE removing the chat from memory so we can clean its queue.
  const chatEntry = get(privateChatStore).chats.get(chatId);
  const theirPeerId = chatEntry?.theirPeerId ?? null;

  // STEP 1: close the active chat first so derived stores compute null cleanly.
  update((s) => ({ ...s, activeChatId: s.activeChatId === chatId ? null : s.activeChatId }));

  // STEP 2: allow Svelte to flush before removing the chat from the Map.
  await tick();

  // STEP 3: remove from in-memory store.
  update((s) => {
    const next = new Map(s.chats);
    next.delete(chatId);
    return { ...s, chats: next };
  });

  // STEP 4: delete persisted data (best effort; never crash the UI on failure).
  try {
    await deletePrivateChat(chatId);
    if (theirPeerId) await clearQueuedMessagesForPeer(theirPeerId);
  } catch (err) {
    console.error('Failed to delete private chat from DB', err);
  }

  // STEP 5: clear crypto session so GC can collect CryptoKey objects.
  try {
    closeSession(chatId);
  } catch {
    // Best-effort cleanup; ignore.
    void 0;
  }
}

export function markChatAsRead(chatId) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, unreadCount: 0 });
  });
  updateChatMeta(chatId, { unreadCount: 0 }).catch((err) => console.error('updateChatMeta failed', err));
}
