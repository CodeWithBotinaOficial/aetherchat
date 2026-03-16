import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// jsdom doesn't guarantee Web Crypto or IndexedDB. We rely on both for unit tests.
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}

