import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

export function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

export class MockConn {
  constructor(peerId, options) {
    this.peer = peerId;
    this.options = options;
    this.open = false;
    this.send = vi.fn();
    this.close = vi.fn();
    this._handlers = new Map();
  }
  on(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    arr.push(cb);
    this._handlers.set(event, arr);
  }
  emit(event, payload) {
    if (event === 'open') this.open = true;
    if (event === 'close') this.open = false;
    const arr = this._handlers.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }
}

export class MockPeer {
  static ctorCalls = [];
  static instances = [];

  constructor(idOrOptions, optionsMaybe) {
    const calledWithOptionsOnly =
      typeof optionsMaybe === 'undefined' && idOrOptions && typeof idOrOptions === 'object' && !Array.isArray(idOrOptions);
    this.id = calledWithOptionsOnly ? undefined : idOrOptions;
    this.options = calledWithOptionsOnly ? idOrOptions : optionsMaybe;
    this.disconnected = false;
    this.destroyed = false;
    this._handlers = new Map();
    this._connections = [];
    this.destroy = vi.fn();
    this.reconnect = vi.fn();
    MockPeer.ctorCalls.push({ id: this.id, options: this.options });
    MockPeer.instances.push(this);
  }

  on(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    arr.push(cb);
    this._handlers.set(event, arr);
  }
  off(event, cb) {
    const arr = this._handlers.get(event) ?? [];
    this._handlers.set(event, arr.filter((x) => x !== cb));
  }
  emit(event, payload) {
    const arr = this._handlers.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }
  connect(peerId, options) {
    const conn = new MockConn(peerId, options);
    this._connections.push(conn);
    return conn;
  }
}

// Vitest doesn't allow exporting the direct result of vi.hoisted().
// We stash it on globalThis and export a normal reference.
const _hoisted = vi.hoisted(() => ({
  addGlobalMessageMock: vi.fn().mockResolvedValue(undefined),
  updateGlobalMessageMock: vi.fn().mockReturnValue(true),
  deleteGlobalMessageMock: vi.fn().mockReturnValue(true),
  cascadeGlobalCitationsMock: vi.fn().mockReturnValue(0),
  persistGlobalPatchWithCascadeMock: vi.fn().mockResolvedValue(undefined),
  saveKnownPeerMock: vi.fn().mockResolvedValue(undefined),
  getKnownPeersMock: vi.fn().mockResolvedValue([]),
  getGlobalMessagesMock: vi.fn().mockResolvedValue([]),
  getGlobalMessageMock: vi.fn().mockResolvedValue(null),
  getFullUsernameRegistryMock: vi.fn().mockResolvedValue([]),
  registerUsernameLocallyMock: vi.fn().mockResolvedValue(undefined),
  isUsernameTakenMock: vi.fn().mockResolvedValue(false),
  mergeUsernameRegistryMock: vi.fn().mockResolvedValue(undefined),
  upsertPrivateChatMock: vi.fn().mockResolvedValue(undefined),
  getPrivateChatMock: vi.fn().mockResolvedValue(null),
  savePrivateMessageMock: vi.fn().mockResolvedValue(undefined),
  saveSentMessagePlaintextMock: vi.fn().mockResolvedValue(undefined),
  updateChatLastActivityMock: vi.fn().mockResolvedValue(undefined),
  updateChatMetaMock: vi.fn().mockResolvedValue(undefined),
  saveQueuedMessageMock: vi.fn().mockResolvedValue(undefined),
  getQueuedMessagesForChatMock: vi.fn().mockResolvedValue([]),
  saveQueuedActionMock: vi.fn().mockResolvedValue(undefined),
  getQueuedActionsForChatMock: vi.fn().mockResolvedValue([]),
  deleteQueuedMessageMock: vi.fn().mockResolvedValue(undefined),
  deleteQueuedActionMock: vi.fn().mockResolvedValue(undefined),
  markMessageDeliveredMock: vi.fn().mockResolvedValue(undefined),
  updatePrivateMessageMock: vi.fn().mockResolvedValue(1),
  openChatMock: vi.fn(),
  upsertChatEntryMock: vi.fn(),
  setKeyExchangeStateMock: vi.fn(),
  addOutgoingMessageMock: vi.fn(),
  addIncomingMessageMock: vi.fn(),
  updatePrivateMessageInStoreMock: vi.fn().mockReturnValue(true),
  deletePrivateMessageInStoreMock: vi.fn().mockReturnValue(true),
  cascadePrivateCitationsMock: vi.fn().mockReturnValue(0),
  deleteChatFromStoreMock: vi.fn().mockResolvedValue(undefined),
  markDeliveredMock: vi.fn(),
  updateMessageQueuedMock: vi.fn(),
  privateChatStoreState: { chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() }
}));

globalThis.__peerHarnessHoisted = globalThis.__peerHarnessHoisted ?? _hoisted;

export const hoisted = globalThis.__peerHarnessHoisted;

vi.mock('peerjs', () => ({ Peer: MockPeer, default: MockPeer }));

vi.mock('$lib/stores/chatStore.js', () => ({
  addGlobalMessage: (...args) => hoisted.addGlobalMessageMock(...args),
  updateMessage: (...args) => hoisted.updateGlobalMessageMock(...args),
  deleteMessage: (...args) => hoisted.deleteGlobalMessageMock(...args),
  cascadeUpdateCitations: (...args) => hoisted.cascadeGlobalCitationsMock(...args),
  persistMessagePatchWithCascade: (...args) => hoisted.persistGlobalPatchWithCascadeMock(...args),
  GLOBAL_DELETED_PLACEHOLDER: '[ This message was deleted ]'
}));

vi.mock('$lib/services/db.js', () => {
  const globalMessages = {
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(0) })) })),
    add: vi.fn().mockResolvedValue(0),
    put: vi.fn().mockResolvedValue(0)
  };
  const usernameRegistry = { add: vi.fn().mockResolvedValue(0), put: vi.fn().mockResolvedValue(0), where: vi.fn(() => ({ equals: vi.fn(() => ({ delete: vi.fn().mockResolvedValue(0) })) })) };
  const privateMessages = { get: vi.fn().mockResolvedValue(null), where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) })) };
  const queuedMessages = { where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) })), update: vi.fn() };
  const queuedActions = { where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) })), update: vi.fn() };
  return {
    db: { globalMessages, usernameRegistry, privateMessages, queuedMessages, queuedActions, transaction: vi.fn(async (_mode, _table, fn) => fn()) },
    saveKnownPeer: (...args) => hoisted.saveKnownPeerMock(...args),
    getKnownPeers: (...args) => hoisted.getKnownPeersMock(...args),
    getGlobalMessages: (...args) => hoisted.getGlobalMessagesMock(...args),
    getGlobalMessage: (...args) => hoisted.getGlobalMessageMock(...args),
    getFullUsernameRegistry: (...args) => hoisted.getFullUsernameRegistryMock(...args),
    registerUsernameLocally: (...args) => hoisted.registerUsernameLocallyMock(...args),
    isUsernameTaken: (...args) => hoisted.isUsernameTakenMock(...args),
    mergeUsernameRegistry: (...args) => hoisted.mergeUsernameRegistryMock(...args),
    getStoredPeerId: vi.fn().mockResolvedValue(null),
    setStoredPeerId: vi.fn().mockResolvedValue(undefined),
    upsertPrivateChat: (...args) => hoisted.upsertPrivateChatMock(...args),
    getPrivateChat: (...args) => hoisted.getPrivateChatMock(...args),
    savePrivateMessage: (...args) => hoisted.savePrivateMessageMock(...args),
    saveSentMessagePlaintext: (...args) => hoisted.saveSentMessagePlaintextMock(...args),
    updateChatLastActivity: (...args) => hoisted.updateChatLastActivityMock(...args),
    updateChatMeta: (...args) => hoisted.updateChatMetaMock(...args),
    saveQueuedMessage: (...args) => hoisted.saveQueuedMessageMock(...args),
    getQueuedMessagesForChat: (...args) => hoisted.getQueuedMessagesForChatMock(...args),
    saveQueuedAction: (...args) => hoisted.saveQueuedActionMock(...args),
    getQueuedActionsForChat: (...args) => hoisted.getQueuedActionsForChatMock(...args),
    deleteQueuedMessage: (...args) => hoisted.deleteQueuedMessageMock(...args),
    deleteQueuedAction: (...args) => hoisted.deleteQueuedActionMock(...args),
    updatePrivateMessage: (...args) => hoisted.updatePrivateMessageMock(...args),
    markMessageDelivered: (...args) => hoisted.markMessageDeliveredMock(...args)
  };
});

vi.mock('$lib/services/crypto.js', () => {
  const buildSessionId = (a, b) => [a, b].sort().join(':');
  return {
    buildSessionId,
    isSessionActive: vi.fn().mockReturnValue(false),
    resumeSession: vi.fn().mockResolvedValue(false),
    createSession: vi.fn(async (a, b) => ({ sessionId: buildSessionId(a, b), publicKeyBase64: 'OUR_PUB_EX' })),
    completeSession: vi.fn(async (a, b) => ({ sessionId: buildSessionId(a, b), publicKeyBase64: 'OUR_PUB_EX_ACK' })),
    encryptForSession: vi.fn().mockResolvedValue({ ciphertext: 'CIPH', iv: 'IV' }),
    decryptForSession: vi.fn().mockResolvedValue('hello'),
    closeSession: vi.fn(),
    closeAllSessions: vi.fn(),
    generateKeyPair: vi.fn().mockResolvedValue({ publicKey: { __pk: true }, privateKey: { __sk: true } }),
    exportPublicKey: vi.fn().mockResolvedValue('PUBKEY_BASE64'),
    importPublicKey: vi.fn().mockResolvedValue({ __remotePk: true })
  };
});

vi.mock('$lib/stores/privateChatStore.js', () => ({
  privateChatStore: { subscribe(run) { run(hoisted.privateChatStoreState); return () => {}; } },
  openChat: (...args) => hoisted.openChatMock(...args),
  upsertChatEntry: (...args) => hoisted.upsertChatEntryMock(...args),
  setKeyExchangeState: (...args) => hoisted.setKeyExchangeStateMock(...args),
  addOutgoingMessage: (...args) => hoisted.addOutgoingMessageMock(...args),
  addIncomingMessage: (...args) => hoisted.addIncomingMessageMock(...args),
  updateMessage: (...args) => hoisted.updatePrivateMessageInStoreMock(...args),
  deleteMessage: (...args) => hoisted.deletePrivateMessageInStoreMock(...args),
  cascadeUpdateCitations: (...args) => hoisted.cascadePrivateCitationsMock(...args),
  PRIVATE_DELETED_PLACEHOLDER: '[ This message was deleted ]',
  deleteChatFromStore: (...args) => hoisted.deleteChatFromStoreMock(...args),
  markDelivered: (...args) => hoisted.markDeliveredMock(...args),
  updateMessageQueued: (...args) => hoisted.updateMessageQueuedMock(...args),
  decryptSealedMessages: vi.fn().mockResolvedValue(undefined),
  setChatOnlineStatus: vi.fn()
}));

export { get, peerStore };
