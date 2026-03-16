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
      false,
      ['encrypt', 'decrypt']
    );
  } catch (err) {
    console.error('deriveSharedSecret failed', err);
    throw err;
  }
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
    console.error('decryptMessage failed', err);
    throw err;
  }
}
