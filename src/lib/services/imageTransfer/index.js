/**
 * Public API for image transfer services.
 *
 * UI phases import from this index only. Receiver functions are internal
 * and should not be exposed here—they are called from the router.
 */

export { sendImage, cancelOutgoingTransfer } from './sender.js';
export { onImageEvent, emitImageEvent } from './events.js';
export { cleanupStaleTransfers } from './cleanup.js';
export { validateImageFile, getImageDimensions } from '$lib/utils/imageValidator.js';
export { SUPPORTED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_AVATAR_BYTES } from './types.js';

