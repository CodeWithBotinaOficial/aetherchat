import { sendImage } from '$lib/services/imageTransfer/index.js';
import { imageRecents } from '$lib/stores/imageRecents.js';
import { get } from 'svelte/store';

/**
 * GlobalChat send handler extracted to keep the component small.
 * @param {{
 *   evt: any,
 *   user: any,
 *   peerId: string|null,
 *   editingMessageId: string|null,
 *   messages: any[],
 *   broadcastGlobalMessageEdit: (id: string, text: string, media: any[]|null, profile: any, replies: any[]|null) => Promise<void>,
 *   broadcastGlobalMessage: (text: string, media: any[]|null, profile: any, replies: any[]|null) => Promise<void>,
 *   addGlobalMessage: (msg: any) => Promise<void>,
 *   clearPendingReplies: () => void,
 *   setEditingMessageId: (id: string|null) => void,
 *   setComposerValue: (v: string) => void,
 *   computeRange: (msgs: any[]) => void,
 *   scrollToBottom: () => Promise<void>
 * }} opts
 */
export async function handleGlobalChatSend(opts) {
  const u = opts.user;
  if (!u) return;

  const rawPending = Array.isArray(opts.evt?.detail?.replies) ? opts.evt.detail.replies : [];
  const byId = new Map((opts.messages ?? []).map((m) => [m?.id, m]));
  const replies = rawPending.map((r) => {
    const original = byId.get(r.messageId) ?? null;
    return {
      messageId: r.messageId,
      authorUsername: r.authorUsername,
      authorColor: r.authorColor,
      textSnapshot: r.textSnapshot,
      timestamp: typeof original?.timestamp === 'number' ? original.timestamp : (typeof r?.timestamp === 'number' ? r.timestamp : 0),
      deleted: Boolean(r?.deleted)
    };
  });
  const safeReplies = replies.length > 0 ? replies : null;
  const media = Array.isArray(opts.evt?.detail?.media) && opts.evt.detail.media.length > 0 ? opts.evt.detail.media.slice(0, 2) : null;
  const imageFiles = Array.isArray(opts.evt?.detail?.imageFiles) ? opts.evt.detail.imageFiles.slice(0, 4) : [];

  let imageTransferIds = null;
  const msgId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());

  if (imageFiles.length > 0) {
    // If peerId is set, it means we are in private chat (which is not handled by handleGlobalChatSend anyway)
    // Wait, globalChat is for everyone, so targetPeerIds = all open peers
    // Actually we need `peerStore` connected peers for sendImage.
    // wait, send.js doesn't have direct access to peerStore, we can import it.
    const { peer: peerStoreRef } = await import('$lib/stores/peerStore.js');
    const state = get(peerStoreRef);
    const targetPeerIds = [...state.connectedPeers.values()].filter(e => e.connection?.open !== false).map(e => e.peerId);

    if (targetPeerIds.length > 0 || !opts.peerId) { // !opts.peerId means we still want to save it locally
      const promises = imageFiles.map(async (file) => {
        try {
          const { transferId } = await sendImage(file, targetPeerIds, opts.editingMessageId || msgId, 'global');
          // Add to recents
          imageRecents.addImageRecent({
            transferId,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            sentAt: Date.now()
          });
          return transferId;
        } catch (err) {
          console.error('Failed to send image', err);
          return null;
        }
      });
      const results = await Promise.all(promises);
      const successfulIds = results.filter(id => id !== null);
      if (successfulIds.length > 0) {
        imageTransferIds = successfulIds;
      }
    }
  }

  // Save edit in-place (no reorder).
  if (opts.editingMessageId) {
    await opts.broadcastGlobalMessageEdit(
      opts.editingMessageId,
      opts.evt.detail.text,
      media,
      {
        username: u.username,
        color: u.color,
        dateOfBirth: u.dateOfBirth ?? null,
        avatarBase64: u.avatarBase64 ?? null,
        createdAt: u.createdAt
      },
      safeReplies,
      imageTransferIds
    );
    opts.setEditingMessageId(null);
    opts.setComposerValue('');
    opts.clearPendingReplies();
    opts.computeRange(opts.messages ?? []);
    return;
  }

  if (opts.peerId) {
    await opts.broadcastGlobalMessage(
      opts.evt.detail.text,
      media,
      { username: u.username, color: u.color, dateOfBirth: u.dateOfBirth ?? null, avatarBase64: u.avatarBase64 },
      safeReplies,
      imageTransferIds
    );
  } else {
    await opts.addGlobalMessage({
      id: msgId,
      peerId: 'local',
      username: u.username,
      dateOfBirth: u.dateOfBirth ?? null,
      color: u.color,
      avatarBase64: u.avatarBase64 ?? null,
      text: opts.evt.detail.text,
      media,
      replies: safeReplies,
      imageTransferIds,
      timestamp: Date.now()
    });
  }

  opts.clearPendingReplies();
  await opts.scrollToBottom();
  opts.computeRange(opts.messages ?? []);
}
