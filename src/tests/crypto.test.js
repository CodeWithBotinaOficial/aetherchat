import {
  buildSessionId,
  closeAllSessions,
  createSession,
  decryptMessage,
  deriveSharedSecret,
  encryptForSession,
  encryptMessage,
  exportPublicKey,
  getSession,
  generateKeyPair,
  importPublicKey
} from '$lib/services/crypto.js';

afterEach(() => {
  closeAllSessions();
});

it('generateKeyPair returns valid CryptoKey pair', async () => {
  const { publicKey, privateKey } = await generateKeyPair();
  expect(publicKey).toBeInstanceOf(CryptoKey);
  expect(privateKey).toBeInstanceOf(CryptoKey);
  expect(publicKey.type).toBe('public');
  expect(privateKey.type).toBe('private');
  expect(publicKey.algorithm.name).toBe('ECDH');
  expect(privateKey.algorithm.name).toBe('ECDH');
});

it('exportPublicKey returns a non-empty base64 string', async () => {
  const { publicKey } = await generateKeyPair();
  const base64 = await exportPublicKey(publicKey);
  expect(typeof base64).toBe('string');
  expect(base64.length).toBeGreaterThan(0);
});

it('importPublicKey reconstructs a usable CryptoKey', async () => {
  const { publicKey, privateKey } = await generateKeyPair();
  const exported = await exportPublicKey(publicKey);
  const imported = await importPublicKey(exported);
  expect(imported).toBeInstanceOf(CryptoKey);
  expect(imported.type).toBe('public');

  // Sanity: can derive a key using the imported public key.
  const shared = await deriveSharedSecret(privateKey, imported);
  expect(shared).toBeInstanceOf(CryptoKey);
  expect(shared.algorithm.name).toBe('AES-GCM');
});

it('Two peers can derive the same shared secret', async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();

  const aPub = await importPublicKey(await exportPublicKey(a.publicKey));
  const bPub = await importPublicKey(await exportPublicKey(b.publicKey));

  const aShared = await deriveSharedSecret(a.privateKey, bPub);
  const bShared = await deriveSharedSecret(b.privateKey, aPub);

  const { ciphertext, iv } = await encryptMessage(aShared, 'secret');
  const plain = await decryptMessage(bShared, ciphertext, iv);
  expect(plain).toBe('secret');
});

it('Encrypted message can be decrypted with the shared key', async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();

  const aShared = await deriveSharedSecret(a.privateKey, b.publicKey);
  const bShared = await deriveSharedSecret(b.privateKey, a.publicKey);

  const msg = 'hello world';
  const { ciphertext, iv } = await encryptMessage(aShared, msg);
  const decrypted = await decryptMessage(bShared, ciphertext, iv);
  expect(decrypted).toBe(msg);
});

it('Decryption fails with a wrong key (expect rejection)', async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const c = await generateKeyPair();

  const aShared = await deriveSharedSecret(a.privateKey, b.publicKey);
  const wrongShared = await deriveSharedSecret(c.privateKey, b.publicKey);

  const { ciphertext, iv } = await encryptMessage(aShared, 'nope');
  await expect(decryptMessage(wrongShared, ciphertext, iv)).rejects.toBeTruthy();
});

it('Each encryption call produces a different IV', async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const shared = await deriveSharedSecret(a.privateKey, b.publicKey);

  const first = await encryptMessage(shared, 'msg');
  const second = await encryptMessage(shared, 'msg');
  expect(first.iv).not.toBe(second.iv);
});

it('buildSessionId is deterministic regardless of argument order', () => {
  expect(buildSessionId('b', 'a')).toBe(buildSessionId('a', 'b'));
  expect(buildSessionId('peer1', 'peer2')).toBe('peer1:peer2');
});

it('createSession returns a non-empty base64 public key and sets session state to pending', async () => {
  const { sessionId, publicKeyBase64 } = await createSession('me', 'them');
  expect(typeof sessionId).toBe('string');
  expect(sessionId).toBe('me:them');
  expect(typeof publicKeyBase64).toBe('string');
  expect(publicKeyBase64.length).toBeGreaterThan(0);

  const session = getSession(sessionId);
  expect(session).toBeTruthy();
  expect(session.state).toBe('pending');
  expect(session.sharedKey).toBeNull();
});

it('createSession generates a unique key pair each time', async () => {
  const a1 = await createSession('me', 'them');
  const a2 = await createSession('me', 'them');
  expect(a1.publicKeyBase64).not.toBe(a2.publicKeyBase64);
});

it("completeSession (responder side) creates session entry AND derives sharedKey (state 'active')", async () => {
  // Simulate two peers by importing the module twice (separate in-memory session stores).
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-responder');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-responder');
  try {
    const init = await aliceCrypto.createSession('alice', 'bob');
    const res = await bobCrypto.completeSession('bob', 'alice', init.publicKeyBase64);

    expect(res.sessionId).toBe('alice:bob');
    expect(typeof res.publicKeyBase64).toBe('string');
    expect(res.publicKeyBase64.length).toBeGreaterThan(0);

    const session = bobCrypto.getSession(res.sessionId);
    expect(session.state).toBe('active');
    expect(session.sharedKey).toBeInstanceOf(CryptoKey);
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});

it("completeSession (initiator side) derives sharedKey and sets state to 'active'", async () => {
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-initiator');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-initiator');
  try {
    const a = await aliceCrypto.createSession('alice', 'bob');
    const b = await bobCrypto.completeSession('bob', 'alice', a.publicKeyBase64);
    const done = await aliceCrypto.completeSession('alice', 'bob', b.publicKeyBase64);

    const session = aliceCrypto.getSession(done.sessionId);
    expect(session.state).toBe('active');
    expect(session.sharedKey).toBeInstanceOf(CryptoKey);
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});

it('Both peers derive the same sharedKey (simulate full exchange)', async () => {
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-samekey');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-samekey');
  try {
    const alice = await aliceCrypto.createSession('alice', 'bob');
    const bob = await bobCrypto.completeSession('bob', 'alice', alice.publicKeyBase64);
    await aliceCrypto.completeSession('alice', 'bob', bob.publicKeyBase64);

    const { ciphertext, iv } = await aliceCrypto.encryptForSession(alice.sessionId, 'secret');
    const plain = await bobCrypto.decryptForSession(bob.sessionId, ciphertext, iv);
    expect(plain).toBe('secret');
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});

it('After completeSession, myKeyPair.privateKey is null', async () => {
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-nullpk');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-nullpk');
  try {
    const a = await aliceCrypto.createSession('alice', 'bob');
    const b = await bobCrypto.completeSession('bob', 'alice', a.publicKeyBase64);
    await aliceCrypto.completeSession('alice', 'bob', b.publicKeyBase64);
    expect(aliceCrypto.getSession(a.sessionId).myKeyPair.privateKey).toBeNull();
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});

it('encryptForSession throws when session is not active', async () => {
  const { sessionId } = await createSession('alice', 'bob');
  await expect(encryptForSession(sessionId, 'nope')).rejects.toBeTruthy();
});

it('encryptForSession returns { ciphertext, iv } with different IVs each call', async () => {
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-ivs');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-ivs');
  try {
    const alice = await aliceCrypto.createSession('alice', 'bob');
    const bob = await bobCrypto.completeSession('bob', 'alice', alice.publicKeyBase64);
    await aliceCrypto.completeSession('alice', 'bob', bob.publicKeyBase64);

    const first = await aliceCrypto.encryptForSession(alice.sessionId, 'hi');
    const second = await aliceCrypto.encryptForSession(alice.sessionId, 'hi');
    expect(first.iv).not.toBe(second.iv);
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});

it('decryptForSession correctly decrypts what encryptForSession encrypted', async () => {
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-dec');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-dec');
  try {
    const alice = await aliceCrypto.createSession('alice', 'bob');
    const bob = await bobCrypto.completeSession('bob', 'alice', alice.publicKeyBase64);
    await aliceCrypto.completeSession('alice', 'bob', bob.publicKeyBase64);

    const msg = await aliceCrypto.encryptForSession(alice.sessionId, 'hello');
    const dec = await bobCrypto.decryptForSession(bob.sessionId, msg.ciphertext, msg.iv);
    expect(dec).toBe('hello');
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});

it('decryptForSession throws with wrong session', async () => {
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-wrong');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-wrong');
  try {
    const alice = await aliceCrypto.createSession('alice', 'bob');
    const bob = await bobCrypto.completeSession('bob', 'alice', alice.publicKeyBase64);
    await aliceCrypto.completeSession('alice', 'bob', bob.publicKeyBase64);

    const msg = await aliceCrypto.encryptForSession(alice.sessionId, 'hello');
    await expect(bobCrypto.decryptForSession('x:y', msg.ciphertext, msg.iv)).rejects.toBeTruthy();
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});

it('closeSession removes the session and makes isSessionActive return false', async () => {
  const aliceCrypto = await import('$lib/services/crypto.js?peer=alice-close');
  const bobCrypto = await import('$lib/services/crypto.js?peer=bob-close');
  try {
    const alice = await aliceCrypto.createSession('alice', 'bob');
    const bob = await bobCrypto.completeSession('bob', 'alice', alice.publicKeyBase64);
    await aliceCrypto.completeSession('alice', 'bob', bob.publicKeyBase64);

    expect(aliceCrypto.isSessionActive(alice.sessionId)).toBe(true);
    aliceCrypto.closeSession(alice.sessionId);
    expect(aliceCrypto.getSession(alice.sessionId)).toBeNull();
    expect(aliceCrypto.isSessionActive(alice.sessionId)).toBe(false);
  } finally {
    aliceCrypto.closeAllSessions();
    bobCrypto.closeAllSessions();
  }
});
