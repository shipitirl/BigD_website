/**
 * Idempotency Layer
 * 
 * Prevents duplicate side-effects across all endpoints:
 * - /api/finalize (don't email twice)
 * - /api/lead/[id] approve (don't text twice)
 * - /api/upload (don't duplicate attachments)
 * - /api/sms-webhook (don't process same message twice)
 */

// In-memory store (would be Redis/DB in production)
const idempotencyStore = new Map<string, IdempotencyEntry>();

interface IdempotencyEntry {
  key: string;
  result: unknown;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    if (entry.expiresAt < now) {
      idempotencyStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

export type IdempotencyAction = 
  | 'finalize'
  | 'owner_approve'
  | 'owner_adjust'
  | 'customer_approve'
  | 'send_sms'
  | 'send_email'
  | 'upload_photo';

interface IdempotencyKey {
  action: IdempotencyAction;
  leadId: string;
  extra?: string; // For SMS: messageSid, for upload: file hash
}

/**
 * Generate an idempotency key
 */
export function generateKey(params: IdempotencyKey): string {
  const parts = [params.action, params.leadId];
  if (params.extra) {
    parts.push(params.extra);
  }
  return parts.join(':');
}

/**
 * Check if an action has already been performed
 * 
 * @returns The previous result if found, undefined otherwise
 */
export function checkIdempotency<T>(key: string): T | undefined {
  const entry = idempotencyStore.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.result as T;
  }
  return undefined;
}

/**
 * Store the result of an action for idempotency
 * 
 * @param key - The idempotency key
 * @param result - The result to store
 * @param ttlMs - Time to live in milliseconds (default 24h)
 */
export function storeIdempotency<T>(
  key: string,
  result: T,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const now = Date.now();
  idempotencyStore.set(key, {
    key,
    result,
    createdAt: now,
    expiresAt: now + ttlMs,
  });
}

/**
 * Wrapper for idempotent operations
 * 
 * If the action was already performed, returns the cached result.
 * Otherwise, executes the action and caches the result.
 * 
 * @param key - Idempotency key parameters
 * @param action - The async action to perform
 * @returns { result, wasIdempotent } - The result and whether it was cached
 */
export async function withIdempotency<T>(
  key: IdempotencyKey,
  action: () => Promise<T>
): Promise<{ result: T; wasIdempotent: boolean }> {
  const keyString = generateKey(key);
  
  // Check for existing result
  const existing = checkIdempotency<T>(keyString);
  if (existing !== undefined) {
    return { result: existing, wasIdempotent: true };
  }
  
  // Execute action
  const result = await action();
  
  // Store result
  storeIdempotency(keyString, result);
  
  return { result, wasIdempotent: false };
}

/**
 * Clear idempotency entry (for testing or manual override)
 */
export function clearIdempotency(key: string): boolean {
  return idempotencyStore.delete(key);
}

/**
 * Get stats about the idempotency store
 */
export function getIdempotencyStats(): {
  totalEntries: number;
  memoryEstimate: number;
} {
  return {
    totalEntries: idempotencyStore.size,
    memoryEstimate: JSON.stringify([...idempotencyStore.values()]).length,
  };
}

// ============================================================
// Specialized Helpers for Common Actions
// ============================================================

/**
 * Check if finalize email was already sent for a lead
 */
export function wasFinalizeEmailSent(leadId: string): boolean {
  return checkIdempotency(generateKey({ action: 'finalize', leadId })) !== undefined;
}

/**
 * Check if owner approval was already processed
 */
export function wasOwnerApprovalProcessed(leadId: string): boolean {
  return checkIdempotency(generateKey({ action: 'owner_approve', leadId })) !== undefined;
}

/**
 * Check if SMS was already processed (by message SID)
 */
export function wasSmsProcessed(leadId: string, messageSid: string): boolean {
  return checkIdempotency(generateKey({ 
    action: 'send_sms', 
    leadId, 
    extra: messageSid 
  })) !== undefined;
}

/**
 * Check if photo was already uploaded (by hash)
 */
export function wasPhotoUploaded(leadId: string, fileHash: string): boolean {
  return checkIdempotency(generateKey({ 
    action: 'upload_photo', 
    leadId, 
    extra: fileHash 
  })) !== undefined;
}
