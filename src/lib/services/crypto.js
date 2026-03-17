import { getSessionKeyRing, saveSessionKeyRing } from '$lib/services/db.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const HKDF_SALT = new Uint8Array(32); // v1 fixed salt (phase 1); phase 2 can negotiate per-session salt
const HKDF_INFO = textEncoder.encode('aetherchat:shared-secret:v1');

/**
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function arrayBufferToBase64(buf) {
  // Prefer Buffer when available (Node, some bundlers); otherwise use btoa.
  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(buf).toString('base64');
  }
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
  if (typeof globalThis.Buffer !== 'undefined') {
    const buf = globalThis.Buffer.from(base64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>}
 */
export async function generateKeyPair() {
  try {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
    return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
  } catch (err) {
    console.error('generateKeyPair failed', err);
    throw err;
  }
}

/**
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>}
 */
export async function exportPublicKey(publicKey) {
  try {
    const raw = await crypto.subtle.exportKey('raw', publicKey);
    return arrayBufferToBase64(raw);
  } catch (err) {
    console.error('exportPublicKey failed', err);
    throw err;
  }
}

/**
 * @param {string} base64
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(base64) {
  try {
    const raw = base64ToArrayBuffer(base64);
    return await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
  } catch (err) {
    console.error('importPublicKey failed', err);
    throw err;
  }
}

/**
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} remotePublicKey
 * @returns {Promise<CryptoKey>} AES-GCM key
 */
export async function deriveSharedSecret(privateKey, remotePublicKey) {
  try {
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: remotePublicKey },
      privateKey,
      256
    );

    const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: HKDF_SALT,
        info: HKDF_INFO
      },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      // Extractable so we can persist the derived key locally (Phase 9).
      true,
      ['encrypt', 'decrypt']
    );
  } catch (err) {
    console.error('deriveSharedSecret failed', err);
    throw err;
  }
}

/**
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
async function exportAesKeyBase64(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(raw);
}

/**
 * @param {string} base64
 * @returns {Promise<CryptoKey>}
 */
async function importAesKeyBase64(base64) {
  const raw = base64ToArrayBuffer(base64);
  // Extractable so we can re-persist the ring after subsequent re-keys.
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/**
 * @param {CryptoKey} sharedKey
 * @param {string} plaintext
 * @returns {Promise<{ciphertext: string, iv: string}>}
 */
export async function encryptMessage(sharedKey, plaintext) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = textEncoder.encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, data);

    return {
      ciphertext: arrayBufferToBase64(ciphertext),
      iv: arrayBufferToBase64(iv.buffer)
    };
  } catch (err) {
    console.error('encryptMessage failed', err);
    throw err;
  }
}

/**
 * @param {CryptoKey} sharedKey
 * @param {string} ciphertext
 * @param {string} iv
 * @returns {Promise<string>}
 */
export async function decryptMessage(sharedKey, ciphertext, iv) {
  try {
    const ctBuf = base64ToArrayBuffer(ciphertext);
    const ivBuf = base64ToArrayBuffer(iv);
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivBuf) },
      sharedKey,
      ctBuf
    );
    return textDecoder.decode(plaintextBuf);
  } catch (err) {
    // Wrong-key / wrong-session decrypt failures are expected in this app (forward secrecy).
    // Avoid spamming the console for OperationError, but still throw so callers can handle it.
    if (err?.name !== 'OperationError') {
      console.error('decryptMessage failed', err);
    }
    throw err;
  }
}

// ── Session Management (Phase 5) ─────────────────────────────────────────────
//
// In-memory only. Never persisted. Never logged.
// Session keys provide forward secrecy: keys are ephemeral per session and discarded on tab close.

// Key: sessionId (string) — `${peerId1}:${peerId2}` sorted alphabetically
// Value: { keyRing, myKeyPair, createdAt }
const activeSessions = new Map();
const MAX_KEY_RING = 5;

/**
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function resumeSession(sessionId) {
  const id = String(sessionId ?? '').trim();
  if (!id) return false;

  const existing = activeSessions.get(id);
  if (existing?.state === 'active' && existing?.keyRing?.length) return true;

  try {
    const row = await getSessionKeyRing(id);
    const keys = Array.isArray(row?.keys) ? row.keys : [];
    if (keys.length === 0) return false;

    const imported = [];
    for (const k of keys) {
      if (!k?.keyBase64) continue;
      try {
        const key = await importAesKeyBase64(k.keyBase64);
        imported.push({ key, createdAt: typeof k.createdAt === 'number' ? k.createdAt : Date.now() });
      } catch {
        // ignore malformed/legacy entry
      }
    }
    if (imported.length === 0) return false;

    activeSessions.set(id, {
      keyRing: imported,
      sharedKey: imported[0].key,
      myKeyPair: null,
      createdAt: row?.updatedAt ?? Date.now(),
      state: 'active'
    });
    return true;
  } catch {
    return false;
  }
}

async function persistKeyRing(sessionId, keyRing) {
  const id = String(sessionId ?? '').trim();
  if (!id) return;
  const ring = Array.isArray(keyRing) ? keyRing : [];

  const exported = [];
  for (const entry of ring) {
    if (!entry?.key) continue;
    try {
      exported.push({
        keyBase64: await exportAesKeyBase64(entry.key),
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now()
      });
    } catch {
      // ignore
    }
  }
  await saveSessionKeyRing(id, exported);
}

/**
 * Always sort so both peers generate the same sessionId.
 * @param {string} peerId1
 * @param {string} peerId2
 * @returns {string}
 */
export function buildSessionId(peerId1, peerId2) {
  return [String(peerId1 ?? ''), String(peerId2 ?? '')].sort().join(':');
}

/**
 * @param {string} myPeerId
 * @param {string} theirPeerId
 * @returns {Promise<{ sessionId: string, publicKeyBase64: string }>}
 */
export async function createSession(myPeerId, theirPeerId) {
  const sessionId = buildSessionId(myPeerId, theirPeerId);
  // Preserve existing ring (so decrypt stays possible during re-keys).
  if (!activeSessions.has(sessionId)) {
    await resumeSession(sessionId);
  }
  const prev = activeSessions.get(sessionId);
  const keyPair = await generateKeyPair();
  const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

  activeSessions.set(sessionId, {
    state: 'pending', // 'pending' | 'active' | 'closed'
    sharedKey: null,
    keyRing: prev?.keyRing ?? [],
    myKeyPair: keyPair,
    createdAt: Date.now()
  });

  return { sessionId, publicKeyBase64 };
}

/**
 * Called when we receive the other peer's public key. Works for initiator and responder.
 * @param {string} myPeerId
 * @param {string} theirPeerId
 * @param {string} theirPublicKeyBase64
 * @returns {Promise<{ sessionId: string, publicKeyBase64: string }>}
 */
export async function completeSession(myPeerId, theirPeerId, theirPublicKeyBase64) {
  const sessionId = buildSessionId(myPeerId, theirPeerId);
  /** @type {any} */
  let session = activeSessions.get(sessionId);

  if (!session) {
    await resumeSession(sessionId);
    session = activeSessions.get(sessionId);
  }

  if (!session) {
    // Responder: create our key pair now.
    const keyPair = await generateKeyPair();
    session = {
      keyRing: [],
      myKeyPair: keyPair,
      createdAt: Date.now(),
      state: 'pending'
    };
    activeSessions.set(sessionId, session);
  }

  // If we lost the private key reference (e.g. from a previous session), rekey.
  if (!session?.myKeyPair?.privateKey) {
    const keyPair = await generateKeyPair();
    session.myKeyPair = keyPair;
  }

  const theirPublicKey = await importPublicKey(theirPublicKeyBase64);
  const sharedKey = await deriveSharedSecret(session.myKeyPair.privateKey, theirPublicKey);

  // Add newest key to the front; keep a short ring to bound storage.
  const now = Date.now();
  const ring = Array.isArray(session.keyRing) ? session.keyRing : [];
  ring.unshift({ key: sharedKey, createdAt: now });
  session.keyRing = ring.slice(0, MAX_KEY_RING);
  session.sharedKey = sharedKey;
  session.state = 'active';

  // Explicitly discard the private key reference after derivation.
  session.myKeyPair = {
    publicKey: session.myKeyPair.publicKey,
    privateKey: null
  };

  try {
    await persistKeyRing(sessionId, session.keyRing);
  } catch (err) {
    console.error('persistKeyRing failed', err);
  }

  return {
    sessionId,
    publicKeyBase64: await exportPublicKey(session.myKeyPair.publicKey)
  };
}

/**
 * @param {string} sessionId
 * @returns {any|null}
 */
export function getSession(sessionId) {
  return activeSessions.get(sessionId) ?? null;
}

/**
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSessionActive(sessionId) {
  return activeSessions.get(sessionId)?.state === 'active';
}

/**
 * @param {string} sessionId
 */
export function closeSession(sessionId) {
  activeSessions.delete(sessionId);
}

export function closeAllSessions() {
  activeSessions.clear();
}

/**
 * @param {string} sessionId
 * @param {string} plaintext
 * @returns {Promise<{ciphertext: string, iv: string}>}
 */
export async function encryptForSession(sessionId, plaintext) {
  const session = activeSessions.get(sessionId);
  if (!session || session.state !== 'active' || !session.sharedKey) throw new Error(`No active session for ${sessionId}`);
  return await encryptMessage(session.sharedKey, plaintext);
}

/**
 * @param {string} sessionId
 * @param {string} ciphertext
 * @param {string} iv
 * @returns {Promise<string>}
 */
export async function decryptForSession(sessionId, ciphertext, iv) {
  const session = activeSessions.get(sessionId);
  if (!session || session.state !== 'active') throw new Error(`No active session for ${sessionId}`);
  const ring = Array.isArray(session.keyRing) ? session.keyRing : [];
  if (ring.length === 0) throw new Error(`No active session for ${sessionId}`);

  /** @type {any} */
  let lastErr = null;
  for (const entry of ring) {
    try {
      return await decryptMessage(entry.key, ciphertext, iv);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Decrypt failed');
}
