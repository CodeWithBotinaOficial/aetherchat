import { db } from './schema.js';

// ── Offline Queue (Phase 7) ─────────────────────────────────────────────────
//
// Security note:
// queuedMessages stores PLAINTEXT temporarily on the local device only.
// This is intentional: we cannot encrypt private messages without an active
// E2EE session key, and we cannot establish a session while offline.
// These records are deleted as soon as they are encrypted and sent.

/**
 * @param {{ id: string, chatId: string, theirPeerId: string, plaintext: string, repliesJson?: string|null, timestamp: number }} msg
 */
export async function saveQueuedMessage(msg) {
  try {
    if (!msg?.id) throw new Error('Missing queued message id');
    await db.queuedMessages.put({
      id: msg.id,
      chatId: msg.chatId,
      theirPeerId: msg.theirPeerId,
      plaintext: msg.plaintext,
      repliesJson: Object.prototype.hasOwnProperty.call(msg, 'repliesJson') ? (msg.repliesJson ?? null) : null,
      timestamp: msg.timestamp
    });
  } catch (err) {
    console.error('saveQueuedMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} theirPeerId
 * @returns {Promise<import('./types.js').QueuedMessage[]>}
 */
export async function getQueuedMessagesForPeer(theirPeerId) {
  try {
    const key = String(theirPeerId ?? '').trim();
    if (!key) return [];
    const rows = await db.queuedMessages.where('theirPeerId').equals(key).toArray();
    return rows.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  } catch (err) {
    console.error('getQueuedMessagesForPeer failed', err);
    throw err;
  }
}

/**
 * Preferred: queued messages are associated with a private chatId, not a transient PeerJS ID.
 * @param {string} chatId
 * @returns {Promise<import('./types.js').QueuedMessage[]>}
 */
export async function getQueuedMessagesForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return [];
    const rows = await db.queuedMessages.where('chatId').equals(key).toArray();
    return rows.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  } catch (err) {
    console.error('getQueuedMessagesForChat failed', err);
    throw err;
  }
}

/**
 * @param {string} id
 */
export async function deleteQueuedMessage(id) {
  try {
    const key = String(id ?? '').trim();
    if (!key) return;
    await db.queuedMessages.delete(key);
  } catch (err) {
    console.error('deleteQueuedMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} theirPeerId
 */
export async function clearQueuedMessagesForPeer(theirPeerId) {
  try {
    const key = String(theirPeerId ?? '').trim();
    if (!key) return;
    await db.queuedMessages.where('theirPeerId').equals(key).delete();
  } catch (err) {
    console.error('clearQueuedMessagesForPeer failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 */
export async function clearQueuedMessagesForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return;
    await db.queuedMessages.where('chatId').equals(key).delete();
  } catch (err) {
    console.error('clearQueuedMessagesForChat failed', err);
    throw err;
  }
}

// ── Offline Queue (Edit/Delete actions) ──────────────────────────────────────

/**
 * @param {import('./types.js').QueuedAction} action
 */
export async function saveQueuedAction(action) {
  try {
    if (!action?.id) throw new Error('Missing queued action id');
    await db.queuedActions.put({
      id: action.id,
      chatId: action.chatId,
      theirPeerId: action.theirPeerId,
      kind: action.kind,
      messageId: action.messageId,
      plaintext: Object.prototype.hasOwnProperty.call(action, 'plaintext') ? (action.plaintext ?? null) : null,
      repliesJson: Object.prototype.hasOwnProperty.call(action, 'repliesJson') ? (action.repliesJson ?? null) : null,
      editedAt: Object.prototype.hasOwnProperty.call(action, 'editedAt') ? (action.editedAt ?? null) : null,
      timestamp: action.timestamp
    });
  } catch (err) {
    console.error('saveQueuedAction failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @returns {Promise<import('./types.js').QueuedAction[]>}
 */
export async function getQueuedActionsForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return [];
    const rows = await db.queuedActions.where('chatId').equals(key).toArray();
    return rows.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  } catch (err) {
    console.error('getQueuedActionsForChat failed', err);
    throw err;
  }
}

/**
 * @param {string} id
 */
export async function deleteQueuedAction(id) {
  try {
    const key = String(id ?? '').trim();
    if (!key) return;
    await db.queuedActions.delete(key);
  } catch (err) {
    console.error('deleteQueuedAction failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 */
export async function clearQueuedActionsForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return;
    await db.queuedActions.where('chatId').equals(key).delete();
  } catch (err) {
    console.error('clearQueuedActionsForChat failed', err);
    throw err;
  }
}
