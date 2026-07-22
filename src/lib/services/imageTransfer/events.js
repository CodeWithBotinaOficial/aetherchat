/**
 * Simple pub/sub event bus for image transfer events.
 *
 * This decouples the receiver service from Svelte stores, enabling
 * the service layer to notify the UI when images are ready.
 *
 * Event names:
 * - 'imageReady'       payload: { transferId, messageId, context }
 * - 'transferProgress' payload: { transferId, receivedChunks, totalChunks }
 * - 'transferFailed'   payload: { transferId, error }
 * - 'transferCancelled' payload: { transferId }
 */

/**
 * @type {Map<string, Set<(payload: any) => void>>}
 */
const listeners = new Map();

/**
 * Subscribes to an event.
 * @param {string} eventName
 * @param {(payload: any) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onImageEvent(eventName, callback) {
  const name = String(eventName ?? '').trim();
  if (!name || typeof callback !== 'function') return () => {};

  if (!listeners.has(name)) {
    listeners.set(name, new Set());
  }

  listeners.get(name).add(callback);

  return () => {
    listeners.get(name)?.delete(callback);
  };
}

/**
 * Emits an event to all subscribed listeners.
 * @param {string} eventName
 * @param {any} payload
 * @returns {void}
 */
export function emitImageEvent(eventName, payload) {
  const name = String(eventName ?? '').trim();
  if (!name) return;

  const set = listeners.get(name);
  if (!set) return;

  for (const cb of set) {
    try {
      cb(payload);
    } catch (err) {
      console.error(`onImageEvent callback failed for ${name}`, err);
    }
  }
}

