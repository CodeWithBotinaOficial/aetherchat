import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import {
  db,
  deleteQueuedAction,
  deleteQueuedMessage,
  getQueuedActionsForChat,
  getQueuedMessagesForChat,
  savePrivateMessage as saveEncryptedPrivateMessage,
  saveSentMessagePlaintext,
  updatePrivateMessage
} from '$lib/services/db.js';
import { createSession, decryptForSession, encryptForSession, isSessionActive, resumeSession } from '$lib/services/crypto.js';
import { decodePrivateBody, encodePrivateBody } from '$lib/utils/privateMessageCodec.js';
import { snapshotText } from '$lib/utils/replies.js';
import { privateChatStore, setKeyExchangeState, updateMessageQueued } from '$lib/stores/privateChatStore.js';
import {
  buildDirectMessage,
  cachedProfile,
  clearKeyExchangeTimeout,
  isPrivateSessionConfirmed,
  sendToPeer,
  startKeyExchangeTimeout,
  userProfileRef
} from './shared.js';

const PRIVATE_CITED_DELETED_PLACEHOLDER = '[ Original message deleted ]';

/**
 * Persist cascade updates for private chat reply cards in IndexedDB.
 * Replies are stored encrypted per-message; this decrypts + re-encrypts the bundle.
 *
 * Also updates queuedMessages + queuedActions reply previews (plaintext, local-only),
 * so edits/deletes cascade even when messages are still queued offline.
 *
 * @param {string} chatId
 * @param {string} originalMessageId
 * @param {{ newSnapshot?: string, deleted?: boolean }} change
 */
export async function persistPrivateCitationCascade(chatId, originalMessageId, change) {
  const cid = String(chatId ?? '').trim();
  const target = String(originalMessageId ?? '').trim();
  if (!cid || !target) return;
  const markDeleted = Boolean(change?.deleted);
  const newSnap = typeof change?.newSnapshot === 'string' ? change.newSnapshot : null;
  if (!markDeleted && newSnap === null) return;

  try {
    if (!isSessionActive(cid)) await resumeSession(cid);
  } catch {
    // ignore
  }
  if (!isSessionActive(cid)) return;

  try {
    const rows = await db.privateMessages.where('chatId').equals(cid).toArray();
    for (const row of rows) {
      const enc = row?.replies;
      const repliesCiphertext = typeof enc?.ciphertext === 'string' ? enc.ciphertext : null;
      const repliesIv = typeof enc?.iv === 'string' ? enc.iv : null;
      if (!repliesCiphertext || !repliesIv) continue;
      let parsed;
      try {
        const raw = await decryptForSession(cid, repliesCiphertext, repliesIv);
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;

      let changed = false;
      const updated = parsed.map((r) => {
        if (!r || typeof r !== 'object') return r;
        if (String(r.messageId ?? '') !== target) return r;
        changed = true;
        if (markDeleted) return { ...r, deleted: true, textSnapshot: PRIVATE_CITED_DELETED_PLACEHOLDER };
        return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
      });
      if (!changed) continue;

      try {
        const enc2 = await encryptForSession(cid, JSON.stringify(updated));
        await updatePrivateMessage(row.id, { replies: { ciphertext: enc2.ciphertext, iv: enc2.iv } });
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error('persistPrivateCitationCascade privateMessages scan failed', err);
  }

  // queuedMessages + queuedActions store replies as JSON strings (plaintext local-only).
  try {
    const rows = await db.queuedMessages.where('chatId').equals(cid).toArray();
    for (const row of rows) {
      const raw = typeof row?.repliesJson === 'string' ? row.repliesJson : '';
      if (!raw) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      let changed = false;
      const updated = parsed.map((r) => {
        if (!r || typeof r !== 'object') return r;
        if (String(r.messageId ?? '') !== target) return r;
        changed = true;
        if (markDeleted) return { ...r, deleted: true, textSnapshot: PRIVATE_CITED_DELETED_PLACEHOLDER };
        return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
      });
      if (!changed) continue;
      await db.queuedMessages.update(row.id, { repliesJson: JSON.stringify(updated) });
    }
  } catch (err) {
    console.error('persistPrivateCitationCascade queuedMessages failed', err);
  }

  try {
    const rows = await db.queuedActions.where('chatId').equals(cid).toArray();
    for (const row of rows) {
      const raw = typeof row?.repliesJson === 'string' ? row.repliesJson : '';
      if (!raw) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      let changed = false;
      const updated = parsed.map((r) => {
        if (!r || typeof r !== 'object') return r;
        if (String(r.messageId ?? '') !== target) return r;
        changed = true;
        if (markDeleted) return { ...r, deleted: true, textSnapshot: PRIVATE_CITED_DELETED_PLACEHOLDER };
        return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
      });
      if (!changed) continue;
      await db.queuedActions.update(row.id, { repliesJson: JSON.stringify(updated) });
    }
  } catch (err) {
    console.error('persistPrivateCitationCascade queuedActions failed', err);
  }
}

export async function flushQueueForPeer(theirPeerId) {
  const state = get(peerStore);
  const entry = theirPeerId ? state.connectedPeers.get(theirPeerId) : null;
  if (!theirPeerId || !entry || entry.connection?.open === false) return;
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;
  if (!myPeerId || !profile || !profile.username || profile.username === 'pre-registration') return;

  // PeerJS IDs are transient; queues are keyed by stable chatId (username-based).
  const chatsForPeer = [];
  try {
    for (const chat of get(privateChatStore).chats.values()) {
      if (chat?.theirPeerId === theirPeerId) chatsForPeer.push(chat);
    }
  } catch {
    // ignore
  }
  if (chatsForPeer.length === 0) return;

  for (const chat of chatsForPeer) {
    const chatId = chat?.id;
    if (!chatId) continue;

    /** @type {import('$lib/services/db.js').QueuedMessage[] | undefined} */
    let queued;
    try {
      queued = await getQueuedMessagesForChat(chatId);
    } catch (err) {
      console.error('getQueuedMessagesForChat failed', err);
      continue;
    }
    /** @type {import('$lib/services/db.js').QueuedAction[] | undefined} */
    let queuedActions;
    try {
      queuedActions = await getQueuedActionsForChat(chatId);
    } catch (err) {
      console.error('getQueuedActionsForChat failed', err);
      queuedActions = [];
    }

    const hasQueuedMsgs = Boolean(queued && queued.length > 0);
    const hasQueuedActions = Boolean(queuedActions && queuedActions.length > 0);
    if (!hasQueuedMsgs && !hasQueuedActions) continue;

    // Deletes can be sent without an active session.
    for (const action of queuedActions ?? []) {
      if (action?.kind !== 'delete') continue;
      if (action?.theirPeerId !== theirPeerId) continue;
      try {
        sendToPeer(
          theirPeerId,
          buildDirectMessage('PRIVATE_MSG_DELETE', myPeerId, profile, theirPeerId, { messageId: action.messageId }, Date.now())
        );
        await deleteQueuedAction(action.id);
      } catch (err) {
        console.error('Failed to flush queued delete action', err);
      }
    }

    const exchangeInProgress = chat?.keyExchangeState === 'initiated' || chat?.keyExchangeState === 'completing';
    const canEncryptNow = isSessionActive(chatId) && isPrivateSessionConfirmed(chatId);
    const hasPendingEdits = (queuedActions ?? []).some((a) => a?.kind === 'edit');
    if (!canEncryptNow && (hasQueuedMsgs || hasPendingEdits)) {
      // Need a fresh key exchange. Even if we have a locally-resumed key ring, the remote peer may not.
      if (!exchangeInProgress) {
        try {
          const { publicKeyBase64 } = await createSession(profile.username, chat.theirUsername);
          setKeyExchangeState(chatId, 'initiated');
          startKeyExchangeTimeout(chatId);
          sendToPeer(
            theirPeerId,
            buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, profile, theirPeerId, { publicKeyBase64 }, Date.now())
          );
        } catch (err) {
          console.error('flushQueueForPeer key exchange init failed', err);
          clearKeyExchangeTimeout(chatId);
          setKeyExchangeState(chatId, 'failed');
        }
      }
      continue;
    }

    // Session is active: encrypt and send each queued message, then remove it from the queue.
    for (const msg of queued ?? []) {
      try {
        const decoded = decodePrivateBody(msg.plaintext);
        const body = encodePrivateBody(decoded.text, decoded.media, null);
        const { ciphertext, iv } = await encryptForSession(chatId, body);
        let repliesEnc = null;
        if (typeof msg?.repliesJson === 'string' && msg.repliesJson.trim().length > 0) {
          try {
            const enc = await encryptForSession(chatId, msg.repliesJson);
            repliesEnc = { ciphertext: enc.ciphertext, iv: enc.iv };
          } catch (err) {
            console.error('Failed to encrypt queued replies', err);
            repliesEnc = null;
          }
        }
        await deleteQueuedMessage(msg.id);
        await saveEncryptedPrivateMessage({
          id: msg.id,
          chatId,
          direction: 'sent',
          ciphertext,
          iv,
          replies: repliesEnc,
          timestamp: msg.timestamp,
          delivered: false
        });
        // Keep a local plaintext copy for sender readability across re-keys.
        await saveSentMessagePlaintext({ id: msg.id, chatId, plaintext: body, timestamp: msg.timestamp });
        updateMessageQueued(chatId, msg.id, false);
        sendToPeer(
          theirPeerId,
          buildDirectMessage('PRIVATE_MSG', myPeerId, profile, theirPeerId, { ciphertext, iv, messageId: msg.id, replies: repliesEnc }, msg.timestamp)
        );
      } catch (err) {
        console.error('Failed to flush queued message', err);
      }
    }

    // Flush queued edit actions (requires active confirmed session).
    for (const action of queuedActions ?? []) {
      if (action?.kind !== 'edit') continue;
      if (action?.theirPeerId !== theirPeerId) continue;
      if (typeof action?.plaintext !== 'string') continue;
      try {
        const decoded = decodePrivateBody(action.plaintext);
        const body = encodePrivateBody(decoded.text, decoded.media, typeof action.editedAt === 'number' ? action.editedAt : null);
        const { ciphertext, iv } = await encryptForSession(chatId, body);
        let repliesEnc = null;
        if (typeof action?.repliesJson === 'string' && action.repliesJson.trim().length > 0) {
          try {
            const enc = await encryptForSession(chatId, action.repliesJson);
            repliesEnc = { ciphertext: enc.ciphertext, iv: enc.iv };
          } catch (err) {
            console.error('Failed to encrypt queued edit replies', err);
            repliesEnc = null;
          }
        }

        await updatePrivateMessage(action.messageId, {
          ciphertext,
          iv,
          replies: repliesEnc,
          editedAt: typeof action.editedAt === 'number' ? action.editedAt : null,
          deleted: false
        });

        sendToPeer(
          theirPeerId,
          buildDirectMessage(
            'PRIVATE_MSG_EDIT',
            myPeerId,
            profile,
            theirPeerId,
            { messageId: action.messageId, ciphertext, iv, replies: repliesEnc, editedAt: action.editedAt ?? null },
            Date.now()
          )
        );
        await deleteQueuedAction(action.id);
      } catch (err) {
        console.error('Failed to flush queued edit action', err);
      }
    }
  }
}
