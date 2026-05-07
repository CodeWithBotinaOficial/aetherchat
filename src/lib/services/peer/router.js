import { validateProtocolMessage, emitMessage } from './shared.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';

import * as net from './net.js';
import * as lobby from './lobby.js';
import * as presence from './presence.js';
import * as sync from './sync.js';
import * as usernames from './username.js';
import * as globalMsg from './messaging.global.js';
import * as privateMsg from './messaging.private.js';
import * as social from './social.js';

/**
 * Router-only: validate + emit, then delegate by msg.type.
 * No business logic should live here.
 */
export async function handleMessage(msg, fromConn, profile) {
  if (!validateProtocolMessage(msg)) return;
  emitMessage(msg);

  switch (msg.type) {
    case 'HANDSHAKE':
      return await net.handleHandshake(msg, fromConn, profile);
    case 'HANDSHAKE_ACK':
      return await net.handleHandshakeAck(msg, fromConn, profile);
    case 'PEER_DISCONNECT':
      return await net.handlePeerDisconnectMessage(msg);

    case 'NETWORK_STATE':
      peerStore.update((s) => ({ ...s, currentLobbyHostId: msg.from.peerId }));
      return await sync.handleNetworkStateMessage(msg, profile);
    case 'NEW_PEER':
      return await sync.handleNewPeerMessage(msg, profile);
    case 'STATE_DIGEST':
      return await sync.handleStateDigestMessage(msg, profile);
    case 'SYNC_REQUEST':
      return await sync.handleSyncRequestMessage(msg, profile);
    case 'SYNC_RESPONSE':
      return await sync.handleSyncResponseMessage(msg);

    case 'LOBBY_HOST_CHANGED':
      return await lobby.handleLobbyHostChangedMessage(msg);
    case 'LOBBY_JOIN':
      // Only lobby host processes these (installed by lobby host runtime).
      return;

    case 'PRESENCE_ANNOUNCE':
      return await presence.handlePresenceAnnounceMessage(msg, fromConn);
    case 'HEARTBEAT':
      return await presence.handleHeartbeatMessage(msg);

    case 'USERNAME_CHECK':
      return await usernames.handleUsernameCheck(msg, profile);
    case 'USERNAME_TAKEN':
      return; // listener-driven
    case 'USERNAME_REGISTERED':
      return await usernames.handleUsernameRegistered(msg);
    case 'USERNAME_CHANGED':
      return await usernames.handleUsernameChanged(msg, fromConn);
    case 'PROFILE_UPDATED':
      return await presence.handleProfileUpdatedMessage(msg, fromConn);
    case 'USER_DELETED':
      return await usernames.handleUserDeletedMessage(msg);
    case 'USERNAME_RELEASED':
      return await usernames.handleUsernameReleasedMessage(msg);

    case 'GLOBAL_MSG':
      return await globalMsg.handleIncomingGlobalMessage(msg);
    case 'GLOBAL_MSG_EDIT':
      return await globalMsg.handleIncomingGlobalMessageEdit(msg);
    case 'GLOBAL_MSG_DELETE':
      return await globalMsg.handleIncomingGlobalMessageDelete(msg);

    case 'PRIVATE_KEY_EXCHANGE':
      return await privateMsg.handleIncomingKeyExchange(msg, profile);
    case 'PRIVATE_KEY_EXCHANGE_ACK':
      return await privateMsg.handleIncomingKeyExchangeAck(msg, profile);
    case 'PRIVATE_MSG':
      return await privateMsg.handleIncomingPrivateMessage(msg, profile);
    case 'PRIVATE_MSG_EDIT':
      return await privateMsg.handleIncomingPrivateMessageEdit(msg, profile);
    case 'PRIVATE_MSG_DELETE':
      return await privateMsg.handleIncomingPrivateMessageDelete(msg, profile);
    case 'PRIVATE_MSG_ACK':
      return await privateMsg.handleIncomingPrivateMessageAck(msg, profile);
    case 'PRIVATE_CHAT_CLOSED':
      return await privateMsg.handleIncomingPrivateChatClosed(msg, profile);

    case 'FOLLOW':
      return await social.handleFollowMessage(msg);
    case 'UNFOLLOW':
      return await social.handleUnfollowMessage(msg);
    case 'WALL_COMMENT_ADDED':
      return await social.handleWallCommentAddedMessage(msg);
    case 'WALL_COMMENT_EDITED':
      return await social.handleWallCommentEditedMessage(msg);
    case 'WALL_COMMENT_DELETED':
      return await social.handleWallCommentDeletedMessage(msg);
    case 'WALL_DATA_REQUEST': {
      const response = await social.handleWallDataRequestMessage(msg);
      if (response) net.sendProtocolEnvelopeToPeer(msg.from.peerId, response);
      return;
    }
    case 'WALL_DATA_RESPONSE':
      return await social.handleWallDataResponseMessage(msg);

    default:
      // Defensive: ignore unknown types.
      return;
  }
}
