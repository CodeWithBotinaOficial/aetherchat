import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import {
  broadcastToAll,
  disconnectPeer,
  initPeer,
  sendToPeer,
  validateProtocolMessage
} from '$lib/services/peer.js';

class MockPeer {
  static lastOptions = null;

  constructor(options) {
    MockPeer.lastOptions = options;
    this._handlers = new Map();
    this._connections = [];
  }

  on(event, cb) {
    this._handlers.set(event, cb);
  }

  emit(event, payload) {
    this._handlers.get(event)?.(payload);
  }

  connect(peerId) {
    const conn = {
      peer: peerId,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn()
    };
    this._connections.push(conn);
    return conn;
  }

  destroy() {
    this._destroyed = true;
  }
}

vi.mock('peerjs', () => {
  return { default: MockPeer };
});

beforeEach(() => {
  peerStore.set({ peerId: null, isConnected: false, connectedPeers: new Map() });
});

afterEach(() => {
  disconnectPeer();
});

it('initPeer creates a Peer instance (mock PeerJS)', async () => {
  const p = await initPeer('alice');
  expect(p).toBeInstanceOf(MockPeer);
  expect(MockPeer.lastOptions).toEqual({ host: '0.peerjs.com', secure: true });

  // Simulate open.
  p.emit('open', 'local-peer');
  expect(get(peerStore).peerId).toBe('local-peer');
  expect(get(peerStore).isConnected).toBe(true);
});

it('broadcastToAll calls send on every connected peer', () => {
  const send1 = vi.fn();
  const send2 = vi.fn();
  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectedPeers: new Map([
      ['p1', { username: 'a', color: 'c', connection: { send: send1 } }],
      ['p2', { username: 'b', color: 'c', connection: { send: send2 } }]
    ])
  });

  const msg = {
    type: 'GLOBAL_MSG',
    from: { username: 'me', peerId: 'local', color: 'hsl(1, 65%, 65%)', age: 22 },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };

  broadcastToAll(msg);
  expect(send1).toHaveBeenCalledTimes(1);
  expect(send2).toHaveBeenCalledTimes(1);
});

it('sendToPeer calls send only on the target peer', () => {
  const send1 = vi.fn();
  const send2 = vi.fn();
  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectedPeers: new Map([
      ['p1', { username: 'a', color: 'c', connection: { send: send1 } }],
      ['p2', { username: 'b', color: 'c', connection: { send: send2 } }]
    ])
  });

  const msg = {
    type: 'GLOBAL_MSG',
    from: { username: 'me', peerId: 'local', color: 'hsl(1, 65%, 65%)', age: 22 },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };

  sendToPeer('p2', msg);
  expect(send1).not.toHaveBeenCalled();
  expect(send2).toHaveBeenCalledTimes(1);
});

it('disconnectPeer sets isConnected to false in peerStore', () => {
  peerStore.set({
    peerId: 'local',
    isConnected: true,
    connectedPeers: new Map([['p1', { username: 'a', color: 'c', connection: { close: vi.fn() } }]])
  });

  disconnectPeer();
  expect(get(peerStore).isConnected).toBe(false);
  expect(get(peerStore).peerId).toBeNull();
});

it('Message protocol shape is validated correctly', () => {
  const good = {
    type: 'GLOBAL_MSG',
    from: { username: 'alice', peerId: 'p1', color: 'hsl(1, 65%, 65%)', age: 22 },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };
  const bad = {
    type: 'GLOBAL_MSG',
    from: { username: '', peerId: 'p1', color: 'x', age: 22 },
    payload: { text: 'hi' },
    timestamp: Date.now()
  };

  expect(validateProtocolMessage(good)).toBe(true);
  expect(validateProtocolMessage(bad)).toBe(false);
});

