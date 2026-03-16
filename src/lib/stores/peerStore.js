import { writable } from 'svelte/store';

/**
 * @typedef {Object} ConnectedPeer
 * @property {string} username
 * @property {string} color
 * @property {number} age
 * @property {any} connection
 */

/**
 * @typedef {Object} PeerState
 * @property {string|null} peerId
 * @property {boolean} isConnected
 * @property {'offline'|'connecting'|'syncing'|'connected'|'reconnecting'|'failed'|'standalone'} connectionState
 * @property {string|null} error
 * @property {number} reconnectAttempt
 * @property {boolean} isLobbyHost
 * @property {any|null} lobbyPeer
 * @property {string|null} currentLobbyHostId
 * @property {Map<string, ConnectedPeer>} connectedPeers
 */

/** @type {import('svelte/store').Writable<PeerState>} */
export const peer = writable({
  peerId: null,
  isConnected: false,
  connectionState: 'offline',
  error: null,
  reconnectAttempt: 0,
  isLobbyHost: false,
  lobbyPeer: null,
  currentLobbyHostId: null,
  connectedPeers: new Map()
});
