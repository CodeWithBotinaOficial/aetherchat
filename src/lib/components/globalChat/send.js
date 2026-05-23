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
      safeReplies
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
      safeReplies
    );
  } else {
    await opts.addGlobalMessage({
      peerId: 'local',
      username: u.username,
      dateOfBirth: u.dateOfBirth ?? null,
      color: u.color,
      avatarBase64: u.avatarBase64 ?? null,
      text: opts.evt.detail.text,
      media,
      replies: safeReplies,
      timestamp: Date.now()
    });
  }

  opts.clearPendingReplies();
  await opts.scrollToBottom();
  opts.computeRange(opts.messages ?? []);
}
