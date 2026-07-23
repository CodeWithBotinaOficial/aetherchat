/**
 * Boot-time cleanup for stale image transfers.
 *
 * Called on app initialization to clean up any transfers that got stuck
 * or were interrupted in previous sessions.
 */

import { getStaleTransfers, updateImageTransferState, cleanOldImageAttachments } from '$lib/services/db.js';
import { clearAssembly, getStaleAssemblies } from './assemblyBuffer.js';

/**
 * Cleans up stale image transfers and old attachments.
 * @returns {Promise<void>}
 */
export async function cleanupStaleTransfers() {
  try {
    // Clean stale in-memory assemblies (older than 30 minutes)
    const ASSEMBLY_TIMEOUT_MS = 30 * 60 * 1000;
    const staleAssemblyIds = getStaleAssemblies(ASSEMBLY_TIMEOUT_MS);
    for (const id of staleAssemblyIds) {
      clearAssembly(id);
    }

    // Clean stale DB transfer records (older than 30 minutes)
    const TRANSFER_TIMEOUT_MS = 30 * 60 * 1000;
    const staleTransfers = await getStaleTransfers(TRANSFER_TIMEOUT_MS);
    for (const transfer of staleTransfers) {
      if (transfer.transferId) {
        await updateImageTransferState(transfer.transferId, 'failed', {
          errorMessage: 'Transfer timed out'
        });
      }
    }

    // Clean old attachments (older than 30 days)
    const ATTACHMENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    const deletedCount = await cleanOldImageAttachments(ATTACHMENT_AGE_MS);
    if (deletedCount > 0) {
      console.warn(`Cleaned ${deletedCount} old image attachments`);
    }
  } catch (err) {
    console.error('cleanupStaleTransfers failed', err);
  }
}

