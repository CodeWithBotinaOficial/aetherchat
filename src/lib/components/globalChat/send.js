import { sendImage } from '$lib/services/imageTransfer/index.js';
import { imageRecents } from '$lib/stores/imageRecents.js';
import { getConnectedPeerIds } from '$lib/services/peer/shared.js';
import { saveImageAttachment } from '$lib/services/db/imageAttachments.db.js';
import { fileToArrayBuffer, getImageDimensions } from '$lib/utils/imageValidator.js';

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
     // Use helper to get connected peer IDs
     const targetPeerIds = getConnectedPeerIds();

      const promises = imageFiles.map(async (file) => {
        try {
          // Send to peers (if any are connected)
          let transferId = null;

          if (targetPeerIds.length > 0) {
            const result = await sendImage(file, targetPeerIds, opts.editingMessageId || msgId, 'global');
            transferId = result.transferId;
          } else {
            // No peers connected: generate transferId locally but don't send
            transferId = globalThis.crypto?.randomUUID?.() || String(Date.now());
          }

          // Save sender's own image to IndexedDB immediately (no waiting for P2P)
          const buffer = await fileToArrayBuffer(file);
          const { width, height } = await getImageDimensions(file);
          await saveImageAttachment({
            transferId,
            messageId: opts.editingMessageId || msgId,
            context: 'global',
            blob: new Blob([buffer], { type: file.type }),
            mimeType: file.type,
            filename: file.name,
            sizeBytes: file.size,
            width,
            height,
            storedAt: Date.now()
          });

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
