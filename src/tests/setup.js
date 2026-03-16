import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// jsdom doesn't guarantee Web Crypto or IndexedDB. We rely on both for unit tests.
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}

// jsdom doesn't implement Web Animations API; Svelte transitions rely on it.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = () => {
    return {
      cancel() {},
      finish() {},
      play() {},
      pause() {},
      reverse() {},
      updatePlaybackRate() {},
      onfinish: null,
      oncancel: null,
      finished: Promise.resolve()
    };
  };
}

// jsdom doesn't implement Canvas 2D; some components generate avatars during hover/tap flows.
if (typeof HTMLCanvasElement !== 'undefined') {
  // Always override: jsdom's default throws "Not implemented".
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') return null;
    return {
      // stateful props (assigned by drawing code)
      fillStyle: '',
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      save() {},
      restore() {},
      clearRect() {},
      beginPath() {},
      arc() {},
      closePath() {},
      clip() {},
      fillRect() {},
      fillText() {}
    };
  };

  HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
    // Minimal valid PNG header base64 (not a real image, but good enough for tests).
    return 'data:image/png;base64,iVBORw0KGgo=';
  };
}
