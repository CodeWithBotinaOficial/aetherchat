import { derived, get, writable } from 'svelte/store';
import { tick } from 'svelte';
import { buildSessionId, closeSession, decryptForSession, isSessionActive, resumeSession } from '$lib/services/crypto.js';
import { snapshotText } from '$lib/utils/replies.js';
import { decodePrivateBody } from '$lib/utils/privateMessageCodec.js';
import {
  clearQueuedMessagesForChat,
  clearQueuedActionsForChat,
  deletePrivateChat,
  deleteSessionKeyRing,
  getSessionKeyRing,
  getSentMessagesPlaintext,
  getPrivateChats,
  getPrivateMessages,
  getQueuedMessagesForChat,
  getQueuedActionsForChat,
  saveSessionKeyRing,
  updateChatMeta
} from '$lib/services/db.js';

// ── State shape ──────────────────────────────────────────────────────────────
// {
//   chats: Map<chatId, ChatEntry>
//   activeChatId: string | null
//   pendingKeyExchanges: Map<peerId, 'waiting_ack'>
// }

/**
 * @typedef {{ messageId: string, authorUsername: string, authorColor: string, textSnapshot: string, timestamp?: number, deleted?: boolean }} PendingReply
 */

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

function isSessionKeyMismatch(err) {
  // WebCrypto AES-GCM authentication failures typically surface as OperationError.
  return err?.name === 'OperationError';
}

function decryptFailurePlaceholder(err) {
  if (isSessionKeyMismatch(err)) return '🔒 Encrypted in a previous session';
  if (String(err?.message ?? '').includes('No active session')) return '🔒 Encrypted message (no active session)';
  return '🔒 Encrypted message (decryption error)';
}

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
    // Best-effort migration: older builds stored session keys under a peerId-based sessionId.
    // When chat IDs became username-based, those keys may still exist but be unreachable, causing
    // "Encrypted in a previous session" forever after restart. If we detect such a legacy ring,
    // copy it to the current chatId once.
    try {
      if (typeof c?.id === 'string' && c.id.includes(':') && c.myPeerId && c.theirPeerId) {
        const legacyId = buildSessionId(c.myPeerId, c.theirPeerId);
        if (legacyId && legacyId !== c.id) {
          const currentRing = await getSessionKeyRing(c.id);
          if (!currentRing?.keys?.length) {
            const legacyRing = await getSessionKeyRing(legacyId);
            if (legacyRing?.keys?.length) {
              await saveSessionKeyRing(c.id, legacyRing.keys);
              await deleteSessionKeyRing(legacyId);
            }
          }
        }
      }
    } catch {
      // ignore (migration is best-effort)
    }

    const dbMessages = await getPrivateMessages(c.id, 50);
    const sentPlain = await getSentMessagesPlaintext(c.id);
    const sentPlainMap = new Map(sentPlain.map((m) => [m.id, m.plaintext]));
    const messages = dbMessages.map((m) => {
      const repliesCiphertext = typeof m?.replies?.ciphertext === 'string' ? m.replies.ciphertext : null;
      const repliesIv = typeof m?.replies?.iv === 'string' ? m.replies.iv : null;
      if (m.direction === 'sent') {
        const plaintext = sentPlainMap.get(m.id);
        const deleted = Boolean(m.deleted);
        return {
          id: m.id,
          direction: 'sent',
          text: deleted ? PRIVATE_DELETED_PLACEHOLDER : plaintext ?? '🔒 Sent message (plaintext not available)',
          ciphertext: m.ciphertext,
          iv: m.iv,
          repliesCiphertext,
          repliesIv,
          replies: null,
          timestamp: m.timestamp,
          delivered: Boolean(m.delivered),
          editedAt: Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null,
          deleted,
          sealed: false
        };
      }
      const deleted = Boolean(m.deleted);
      return {
        id: m.id,
        direction: 'received',
        text: deleted ? PRIVATE_DELETED_PLACEHOLDER : null,
        ciphertext: m.ciphertext,
        iv: m.iv,
        repliesCiphertext,
        repliesIv,
        replies: null,
        timestamp: m.timestamp,
        delivered: Boolean(m.delivered),
        editedAt: Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null,
        deleted,
        sealed: true
      };
    });

    const queuedMsgs = await getQueuedMessagesForChat(c.id);
    const queuedInMemory = queuedMsgs.map((m) => ({
      id: m.id,
      direction: 'sent',
      text: m.plaintext,
      ciphertext: null,
      iv: null,
      repliesCiphertext: null,
      repliesIv: null,
      replies: (() => {
        const raw = m?.repliesJson;
        if (typeof raw !== 'string' || raw.trim().length === 0) return null;
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })(),
      timestamp: m.timestamp,
      delivered: false,
      queued: true,
      editedAt: null,
      deleted: false,
      sealed: false
    }));

    // Load queued edit/delete actions (used to flush once session is confirmed).
    let queuedActions;
    try {
      queuedActions = await getQueuedActionsForChat(c.id);
    } catch {
      queuedActions = [];
    }

    let allMessages = [...messages, ...queuedInMemory].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    // Apply queued local edits/deletes to the in-memory messages so they survive reloads
    // even when we cannot encrypt/flush yet (e.g. peer offline or session unconfirmed).
    for (const action of queuedActions ?? []) {
      if (!action?.messageId) continue;
      const mid = String(action.messageId);
      const idx = allMessages.findIndex((m) => m?.id === mid && m?.direction === 'sent');
      if (idx < 0) continue;
      const cur = allMessages[idx];
      if (action.kind === 'delete') {
        allMessages = allMessages.slice();
        allMessages[idx] = { ...cur, deleted: true, text: PRIVATE_DELETED_PLACEHOLDER };
        continue;
      }
      if (action.kind === 'edit') {
        const plaintext = typeof action.plaintext === 'string' ? action.plaintext : cur.text;
        const editedAt = typeof action.editedAt === 'number' ? action.editedAt : cur.editedAt ?? null;
        /** @type {any[]|null} */
        let replies = cur.replies ?? null;
        if (typeof action?.repliesJson === 'string' && action.repliesJson.trim().length > 0) {
          try {
            const parsed = JSON.parse(action.repliesJson);
            replies = Array.isArray(parsed) ? parsed : null;
          } catch {
            // keep existing
          }
        } else if (Object.prototype.hasOwnProperty.call(action, 'repliesJson')) {
          replies = null;
        }
        allMessages = allMessages.slice();
        allMessages[idx] = { ...cur, deleted: false, text: plaintext, editedAt, replies };
      }
    }

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
      pendingReplies: [],
      queuedActions,
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
      let editedAt = Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null;
      /** @type {any[]|null} */
      let replies = null;
      if (canDecrypt) {
        try {
          const raw = await decryptForSession(sessionId, m.ciphertext, m.iv);
          const decoded = decodePrivateBody(raw);
          text = decoded.text;
          editedAt = decoded.editedAt ?? editedAt;
        } catch {
          // keep placeholder
        }
        if (typeof m?.replies?.ciphertext === 'string' && typeof m?.replies?.iv === 'string') {
          try {
            const raw = await decryptForSession(sessionId, m.replies.ciphertext, m.replies.iv);
            const parsed = JSON.parse(raw);
            replies = Array.isArray(parsed) ? parsed : null;
          } catch {
            // ignore
          }
        }
      }
      return {
        id: m.id,
        direction: m.direction,
        text,
        replies,
        repliesCiphertext: typeof m?.replies?.ciphertext === 'string' ? m.replies.ciphertext : null,
        repliesIv: typeof m?.replies?.iv === 'string' ? m.replies.iv : null,
        timestamp: m.timestamp,
        delivered: Boolean(m.delivered),
        editedAt,
        deleted: Boolean(m.deleted),
        sealed: !canDecrypt && m.direction !== 'sent'
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
      // Deleted messages always render the placeholder; no need to decrypt.
      if (m?.deleted) return { ...m, text: PRIVATE_DELETED_PLACEHOLDER, sealed: false };

      // Only attempt to decrypt received sealed messages.
      const hasRepliesCipher = typeof m?.repliesCiphertext === 'string' && typeof m?.repliesIv === 'string';

      // Decrypt message text (received sealed) when possible.
      if (m?.sealed && m.direction !== 'sent' && typeof m.ciphertext === 'string' && typeof m.iv === 'string') {
        try {
          const rawText = await decryptForSession(sessionId, m.ciphertext, m.iv);
          const decoded = decodePrivateBody(rawText);
          // If we can decrypt the message, also try decrypting replies.
          let replies = m?.replies ?? null;
          if (hasRepliesCipher) {
            try {
              const raw = await decryptForSession(sessionId, m.repliesCiphertext, m.repliesIv);
              const parsed = JSON.parse(raw);
              replies = Array.isArray(parsed) ? parsed : null;
            } catch {
              // ignore
            }
          }
          return { ...m, text: decoded.text, editedAt: decoded.editedAt ?? (m.editedAt ?? null), replies, sealed: false };
        } catch (err) {
          if (!isSessionKeyMismatch(err)) {
            console.error(
              'decryptSealedMessages decrypt failed:',
              err?.message ?? String(err),
              { chatId, messageId: m?.id ?? null, sessionId }
            );
          }
          // Keep sealed so we can retry later (e.g. after a key ring resumes from storage).
          return { ...m, text: decryptFailurePlaceholder(err), sealed: true };
        }
      }

      // Decrypt replies for already-readable messages (sent plaintext copy, or received already decrypted).
      if (m?.sealed) return m;
      if (!hasRepliesCipher) return m;
      try {
        const raw = await decryptForSession(sessionId, m.repliesCiphertext, m.repliesIv);
        const parsed = JSON.parse(raw);
        const replies = Array.isArray(parsed) ? parsed : null;
        return { ...m, replies };
      } catch (err) {
        if (!isSessionKeyMismatch(err)) {
          console.error(
            'decryptSealedMessages replies decrypt failed:',
            err?.message ?? String(err),
            { chatId, messageId: m?.id ?? null, sessionId }
          );
        }
        return m;
      }
    })
  );

  withChat((chats) => {
    const curr = chats.get(chatId);
    if (!curr) return;
    chats.set(chatId, { ...curr, messages: decrypted });
  });
}

export function addOutgoingMessage(chatId, { id, text, timestamp, replies = null }) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = [
      ...chat.messages,
      { id, direction: 'sent', text, replies, timestamp, delivered: false, queued: false, editedAt: null, deleted: false, sealed: false }
    ];
    chats.set(chatId, { ...chat, messages, lastMessage: text, lastActivity: timestamp });
  });
}

export function addIncomingMessage(chatId, { id, text, timestamp, replies = null, ciphertext = null, iv = null, sealed = false, repliesCiphertext = null, repliesIv = null, editedAt = null, deleted = false }) {
  update((s) => {
    const next = new Map(s.chats);
    const chat = next.get(chatId);
    if (!chat) return s;

    const messages = [
      ...chat.messages,
      { id, direction: 'received', text, replies, ciphertext, iv, repliesCiphertext, repliesIv, timestamp, delivered: true, editedAt, deleted: Boolean(deleted), sealed: Boolean(sealed) }
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
        pendingReplies: [],
        __loaded: false
      }),
      // Back-compat: ensure pendingReplies always exists so UI doesn't need null checks.
      pendingReplies: Array.isArray(prev?.pendingReplies) ? prev.pendingReplies : [],
      ...entry
    });
  });
}

export async function deleteChatFromStore(chatId) {
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
    await clearQueuedMessagesForChat(chatId);
    await clearQueuedActionsForChat(chatId);
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

/**
 * @param {string} chatId
 * @param {{ id?: string, username?: string, color?: string, text?: string }} message
 */
export function addPendingReply(chatId, message) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  const mid = String(message?.id ?? '').trim();
  if (!mid) return;

  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    /** @type {PendingReply[]} */
    const cur = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    if (cur.some((r) => r.messageId === mid)) return;
    const next = [
      ...cur,
      {
        messageId: mid,
        authorUsername: String(message?.username ?? '').trim() || 'unknown',
        authorColor: String(message?.color ?? '').trim() || 'hsl(0, 0%, 65%)',
        textSnapshot: snapshotText(message?.text, 120),
        timestamp: typeof message?.timestamp === 'number' ? message.timestamp : 0,
        deleted: Boolean(message?.deleted)
      }
    ];
    chats.set(cid, { ...chat, pendingReplies: next });
  });
}

/**
 * @param {string} chatId
 * @param {string} messageId
 */
export function removePendingReply(chatId, messageId) {
  const cid = String(chatId ?? '').trim();
  const mid = String(messageId ?? '').trim();
  if (!cid || !mid) return;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    const cur = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    chats.set(cid, { ...chat, pendingReplies: cur.filter((r) => r.messageId !== mid) });
  });
}

/**
 * @param {string} chatId
 */
export function clearPendingReplies(chatId) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    chats.set(cid, { ...chat, pendingReplies: [] });
  });
}

/**
 * Replace pending replies list for a given chat (used by edit mode).
 * @param {string} chatId
 * @param {any[]|null} list
 */
export function setPendingReplies(chatId, list) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  const next = Array.isArray(list) ? list : [];
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    chats.set(cid, {
      ...chat,
      pendingReplies: next
        .filter((r) => r && typeof r === 'object' && typeof r.messageId === 'string' && r.messageId.trim().length > 0)
        .map((r) => ({
          messageId: String(r.messageId),
          authorUsername: String(r.authorUsername ?? '').trim() || 'unknown',
          authorColor: String(r.authorColor ?? '').trim() || 'hsl(0, 0%, 65%)',
          textSnapshot: snapshotText(r.textSnapshot ?? '', 120),
          timestamp: typeof r.timestamp === 'number' ? r.timestamp : 0,
          deleted: Boolean(r.deleted)
        }))
    });
  });
}

function normalizeActor(actor) {
  return actor === 'them' ? 'them' : 'me';
}

/**
 * Update a private message in-memory without changing its position.
 * Returns true if applied.
 *
 * @param {string} chatId
 * @param {string} messageId
 * @param {{ text?: string, editedAt?: number|null, replies?: any[]|null, deleted?: boolean }} patch
 * @param {'me'|'them'} actor
 */
export function updateMessage(chatId, messageId, patch, actor = 'me') {
  const cid = String(chatId ?? '').trim();
  const mid = String(messageId ?? '').trim();
  if (!cid || !mid) return false;
  if (!patch || typeof patch !== 'object') return false;
  const who = normalizeActor(actor);

  let applied = false;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    const idx = chat.messages.findIndex((m) => m?.id === mid);
    if (idx < 0) return;
    const cur = chat.messages[idx];
    // Deleted messages stay deleted; editing a deleted message is not allowed.
    if (cur?.deleted && patch.deleted !== true) return;
    const allowed =
      who === 'me'
        ? cur?.direction === 'sent'
        : cur?.direction === 'received';
    if (!allowed) return;

    const nextMessages = chat.messages.slice();
    nextMessages[idx] = {
      ...cur,
      text: Object.prototype.hasOwnProperty.call(patch, 'text') ? String(patch.text ?? '') : cur.text,
      editedAt: Object.prototype.hasOwnProperty.call(patch, 'editedAt') ? (patch.editedAt ?? null) : cur.editedAt ?? null,
      replies: Object.prototype.hasOwnProperty.call(patch, 'replies')
        ? (Array.isArray(patch.replies) && patch.replies.length > 0 ? patch.replies : null)
        : cur.replies ?? null,
      deleted: Object.prototype.hasOwnProperty.call(patch, 'deleted') ? Boolean(patch.deleted) : Boolean(cur.deleted),
      ciphertext: Object.prototype.hasOwnProperty.call(patch, 'ciphertext') ? patch.ciphertext : cur.ciphertext,
      iv: Object.prototype.hasOwnProperty.call(patch, 'iv') ? patch.iv : cur.iv,
      repliesCiphertext: Object.prototype.hasOwnProperty.call(patch, 'repliesCiphertext') ? patch.repliesCiphertext : cur.repliesCiphertext,
      repliesIv: Object.prototype.hasOwnProperty.call(patch, 'repliesIv') ? patch.repliesIv : cur.repliesIv,
      sealed: Object.prototype.hasOwnProperty.call(patch, 'sealed') ? Boolean(patch.sealed) : Boolean(cur.sealed)
    };
    chats.set(cid, { ...chat, messages: nextMessages });
    applied = true;
  });
  return applied;
}

/**
 * Soft-delete a private message in-memory.
 * Returns true if applied.
 *
 * @param {string} chatId
 * @param {string} messageId
 * @param {'me'|'them'} actor
 */
export function deleteMessage(chatId, messageId, actor = 'me') {
  return updateMessage(chatId, messageId, { deleted: true, text: PRIVATE_DELETED_PLACEHOLDER }, actor);
}

/**
 * Cascade update quoted reply cards for all messages in a chat that cited `originalMessageId`.
 * Returns count of messages updated in-memory.
 *
 * @param {string} chatId
 * @param {string} originalMessageId
 * @param {{ newSnapshot?: string, deleted?: boolean }} change
 */
export function cascadeUpdateCitations(chatId, originalMessageId, change) {
  const cid = String(chatId ?? '').trim();
  const target = String(originalMessageId ?? '').trim();
  if (!cid || !target) return 0;
  const markDeleted = Boolean(change?.deleted);
  const newSnap = typeof change?.newSnapshot === 'string' ? change.newSnapshot : null;

  let touched = 0;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    let any = false;
    const nextMessages = chat.messages.map((m) => {
      const replies = Array.isArray(m?.replies) ? m.replies : null;
      if (!replies) return m;
      let changed = false;
      const updated = replies.map((r) => {
        if (!r || typeof r !== 'object') return r;
        if (String(r.messageId ?? '') !== target) return r;
        changed = true;
        if (markDeleted) return { ...r, deleted: true, textSnapshot: CITED_DELETED_PLACEHOLDER };
        if (newSnap !== null) return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
        return r;
      });
      if (!changed) return m;
      any = true;
      touched += 1;
      return { ...m, replies: updated };
    });
    if (!any) return;

    // Keep composer pending previews in sync too.
    const pending = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    const nextPending = pending.map((r) => {
      if (!r || typeof r !== 'object') return r;
      if (String(r.messageId ?? '') !== target) return r;
      if (markDeleted) return { ...r, deleted: true, textSnapshot: CITED_DELETED_PLACEHOLDER };
      if (newSnap !== null) return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
      return r;
    });

    chats.set(cid, { ...chat, messages: nextMessages, pendingReplies: nextPending });
  });
  return touched;
}
