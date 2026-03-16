import {
  decryptMessage,
  deriveSharedSecret,
  encryptMessage,
  exportPublicKey,
  generateKeyPair,
  importPublicKey
} from '$lib/services/crypto.js';

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

