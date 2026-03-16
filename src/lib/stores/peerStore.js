import { writable } from 'svelte/store';

/**
 * @typedef {Object} ConnectedPeer
 * @property {string} username
 * @property {string} color
 * @property {any} connection
 */

/**
 * @typedef {Object} PeerState
 * @property {string|null} peerId
 * @property {boolean} isConnected
 * @property {Map<string, ConnectedPeer>} connectedPeers
 */

/** @type {import('svelte/store').Writable<PeerState>} */
export const peer = writable({
  peerId: null,
  isConnected: false,
  connectedPeers: new Map()
});

