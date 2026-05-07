// Public peer service API (implementation is split across ./peer/* modules).
// This file is the single composition root for the peer runtime.

export * from './config.js';
export * from './shared.js';
export * from './queue.js';
export * from './username.js';
export * from './social.js';

export * from './net.js';
export * from './lobby.js';
export * from './presence.js';
export * from './sync.js';
export * from './messaging.global.js';
export * from './messaging.private.js';
export * from './router.js';

import { setBroadcastStateDigestImpl, setConnectToPeerIfUnknownImpl, setElectNewLobbyHostImpl, setHandleMessageImpl } from './shared.js';
import { broadcastStateDigest } from './sync.js';
import { electNewLobbyHost } from './lobby.js';
import { handleMessage } from './router.js';
import { connectToPeerIfUnknown } from './net.js';

// Wire cross-module callbacks without creating circular imports.
setHandleMessageImpl(handleMessage);
setBroadcastStateDigestImpl(broadcastStateDigest);
setElectNewLobbyHostImpl(electNewLobbyHost);
setConnectToPeerIfUnknownImpl(connectToPeerIfUnknown);

// Test-only hooks (kept for back-compat with existing unit tests).
import {
  confirmedPrivateSessions,
  resolveRegistrySync,
  resetRegistrySyncReadyForTest,
  setLocalPeerRef,
  setMainPeer,
  setUserProfileRef,
  setCachedProfile,
  reconnectAttempts
} from './shared.js';
import { attemptReconnect } from './net.js';

export const __test = {
  setMainPeerForTest(p) {
    setMainPeer(p);
  },
  setProfileForTest(p) {
    setCachedProfile(p);
  },
  electNewLobbyHostForTest() {
    electNewLobbyHost();
  },
  resetRegistrySyncReadyForTest() {
    resetRegistrySyncReadyForTest();
  },
  resolveRegistrySyncForTest(reason = 'test') {
    resolveRegistrySync(reason);
  },
  setLocalPeerRefForTest(p) {
    setLocalPeerRef(p);
    setMainPeer(p);
  },
  setUserProfileRefForTest(p) {
    setUserProfileRef(p);
    setCachedProfile(p);
  },
  async handlePeerDisconnectForTest() {
    await attemptReconnect();
  },
  getReconnectAttemptsForTest() {
    return reconnectAttempts;
  },
  confirmPrivateSessionForTest(chatId) {
    confirmedPrivateSessions.add(String(chatId ?? '').trim());
  },
  clearConfirmedPrivateSessionsForTest() {
    confirmedPrivateSessions.clear();
  }
};
