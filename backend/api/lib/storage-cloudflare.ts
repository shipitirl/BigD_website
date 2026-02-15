// ============================================================
// Cloudflare D1 + R2 Storage Adapters
// Works with @cloudflare/next-on-pages
// ============================================================

import type { Lead, PhotoFile } from './lead';
import type { SessionState } from './session';

// ----------------------
// CLOUDFLARE ENV TYPES
// ----------------------

/**
 * Cloudflare bindings available in Pages Functions
 * These are injected by the runtime via getRequestContext()
 */
export interface CloudflareEnv {
  DB: D1Database;      // D1 binding for leads/sessions
  PHOTOS: R2Bucket;    // R2 binding for photo storage
  APP_URL?: string;    // Public URL for constructing photo links
}

// D1 typings (subset used)
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: object;
}

interface D1ExecResult {
  count: number;
  duration: number;
}

// R2 typings (subset used)
interface R2Bucket {
  put(key: string, value: ArrayBuffer | ReadableStream | string, options?: R2PutOptions): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
}

interface R2Object {
  key: string;
  size: number;
  etag: string;
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

interface R2ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

// ----------------------
// D1 ROW SCHEMA
// ----------------------

export interface D1LeadRow {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_zip: string | null;
  service_type: string | null;
  status: string;
  messages_json: string;       // JSON string of ChatMessage[]
  photo_refs_json: string;     // JSON string of PhotoFile[]
  full_lead_json: string;      // JSON string of the complete Lead or SessionState
  created_at: string;
  updated_at: string;
}

// ----------------------
// R2 PHOTO TYPES
// ----------------------

export interface R2PhotoUpload {
  key: string;                  // leads/{lead_id}/photos/{filename}
  data: ArrayBuffer;
  contentType: string;
}

export interface PhotoUploadResult {
  success: boolean;
  url: string;
  key: string;
  error?: string;
}

// ----------------------
// ENV DETECTION
// ----------------------

let cloudflareEnv: CloudflareEnv | null = null;

/**
 * Set the Cloudflare environment from the request context.
 * Call this at the start of each request handler in Cloudflare Pages.
 * 
 * Usage in Next.js API route:
 * ```
 * import { getRequestContext } from '@cloudflare/next-on-pages';
 * import { setCloudflareEnv } from '@/api/lib/storage-cloudflare';
 * 
 * export async function POST(request: NextRequest) {
 *   const { env } = getRequestContext();
 *   setCloudflareEnv(env);
 *   // ... rest of handler
 * }
 * ```
 */
export function setCloudflareEnv(env: CloudflareEnv | null): void {
  cloudflareEnv = env;
}

/**
 * Check if we're running in Cloudflare with D1/R2 available
 */
export function isCloudflareEnv(): boolean {
  return cloudflareEnv !== null && 
         typeof cloudflareEnv.DB !== 'undefined' &&
         typeof cloudflareEnv.PHOTOS !== 'undefined';
}

/**
 * Get the current Cloudflare env (throws if not set)
 */
export function getCloudflareEnv(): CloudflareEnv {
  if (!cloudflareEnv) {
    throw new Error('Cloudflare env not set. Call setCloudflareEnv() first.');
  }
  return cloudflareEnv;
}

// ----------------------
// D1 STORAGE ADAPTER
// ----------------------

const D1_INIT_SQL = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  customer_name TEXT,
  customer_phone TEXT,
  customer_zip TEXT,
  service_type TEXT,
  status TEXT DEFAULT 'collecting',
  messages_json TEXT DEFAULT '[]',
  photo_refs_json TEXT DEFAULT '[]',
  full_lead_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON leads(updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_customer_phone ON leads(customer_phone);
`;

let d1Initialized = false;

/**
 * Initialize D1 tables (run once per cold start)
 */
export async function initD1(): Promise<void> {
  if (d1Initialized) return;
  
  try {
    const { DB } = getCloudflareEnv();
    await DB.exec(D1_INIT_SQL);
    d1Initialized = true;
    console.log('[D1] Database initialized');
  } catch (err) {
    console.error('[D1] Init error:', err);
    throw err;
  }
}

/**
 * Load a session/lead from D1
 */
export async function d1LoadSession(sessionId: string): Promise<SessionState | null> {
  try {
    await initD1();
    const { DB } = getCloudflareEnv();
    
    const row = await DB
      .prepare('SELECT full_lead_json FROM leads WHERE id = ?')
      .bind(sessionId)
      .first<{ full_lead_json: string }>();
    
    if (!row) return null;
    
    return JSON.parse(row.full_lead_json) as SessionState;
  } catch (err) {
    console.error(`[D1] Load error for ${sessionId}:`, err);
    return null;
  }
}

/**
 * Save a session/lead to D1
 */
export async function d1SaveSession(sessionId: string, data: SessionState): Promise<void> {
  try {
    await initD1();
    const { DB } = getCloudflareEnv();
    
    const row: D1LeadRow = {
      id: sessionId,
      customer_name: data.contact?.name || null,
      customer_phone: data.contact?.phone || null,
      customer_zip: data.zip || null,
      service_type: data.service_type || null,
      status: data.status || 'collecting',
      messages_json: JSON.stringify(data.messages || []),
      photo_refs_json: JSON.stringify(data.photos?.urls || []),
      full_lead_json: JSON.stringify(data),
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    };
    
    await DB.prepare(`
      INSERT INTO leads (id, customer_name, customer_phone, customer_zip, service_type, status, messages_json, photo_refs_json, full_lead_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        customer_name = excluded.customer_name,
        customer_phone = excluded.customer_phone,
        customer_zip = excluded.customer_zip,
        service_type = excluded.service_type,
        status = excluded.status,
        messages_json = excluded.messages_json,
        photo_refs_json = excluded.photo_refs_json,
        full_lead_json = excluded.full_lead_json,
        updated_at = excluded.updated_at
    `)
      .bind(
        row.id,
        row.customer_name,
        row.customer_phone,
        row.customer_zip,
        row.service_type,
        row.status,
        row.messages_json,
        row.photo_refs_json,
        row.full_lead_json,
        row.created_at,
        row.updated_at
      )
      .run();
    
    console.log(`[D1] Saved session ${sessionId}`);
  } catch (err) {
    console.error(`[D1] Save error for ${sessionId}:`, err);
    throw err;
  }
}

/**
 * Delete a session from D1
 */
export async function d1DeleteSession(sessionId: string): Promise<void> {
  try {
    await initD1();
    const { DB } = getCloudflareEnv();
    
    await DB.prepare('DELETE FROM leads WHERE id = ?')
      .bind(sessionId)
      .run();
      
    console.log(`[D1] Deleted session ${sessionId}`);
  } catch (err) {
    console.error(`[D1] Delete error for ${sessionId}:`, err);
  }
}

// ----------------------
// R2 STORAGE ADAPTER
// ----------------------

/**
 * Upload a photo to R2
 * 
 * @param sessionId - Session/lead ID for organizing photos
 * @param filename - Filename for the photo
 * @param data - Raw photo data as ArrayBuffer
 * @param contentType - MIME type (e.g., 'image/jpeg')
 * @returns Full public URL and R2 key
 */
export async function r2UploadPhoto(
  sessionId: string,
  filename: string,
  data: ArrayBuffer,
  contentType: string
): Promise<PhotoUploadResult> {
  try {
    const env = getCloudflareEnv();
    const key = `leads/${sessionId}/photos/${filename}`;
    
    await env.PHOTOS.put(key, data, {
      httpMetadata: { contentType },
      customMetadata: {
        sessionId,
        uploadedAt: new Date().toISOString(),
      },
    });
    
    // Construct public URL
    // For public R2 buckets, the URL format is:
    // https://{account-id}.r2.cloudflarestorage.com/{bucket-name}/{key}
    // Or with custom domain: https://photos.yourdomain.com/{key}
    // We'll use APP_URL + /r2/ as a proxy path
    const appUrl = env.APP_URL || '';
    const url = appUrl ? `${appUrl}/r2/${key}` : key;
    
    console.log(`[R2] Uploaded ${key} (${data.byteLength} bytes)`);
    
    return {
      success: true,
      url,
      key,
    };
  } catch (err) {
    console.error(`[R2] Upload error:`, err);
    return {
      success: false,
      url: '',
      key: '',
      error: String(err),
    };
  }
}

/**
 * Get a photo from R2
 */
export async function r2GetPhoto(key: string): Promise<ArrayBuffer | null> {
  try {
    const { PHOTOS } = getCloudflareEnv();
    const obj = await PHOTOS.get(key);
    
    if (!obj) return null;
    
    return await obj.arrayBuffer();
  } catch (err) {
    console.error(`[R2] Get error for ${key}:`, err);
    return null;
  }
}

/**
 * Delete a photo from R2
 */
export async function r2DeletePhoto(key: string): Promise<void> {
  try {
    const { PHOTOS } = getCloudflareEnv();
    await PHOTOS.delete(key);
    console.log(`[R2] Deleted ${key}`);
  } catch (err) {
    console.error(`[R2] Delete error for ${key}:`, err);
  }
}

/**
 * List all photos for a session
 */
export async function r2ListPhotos(sessionId: string): Promise<string[]> {
  try {
    const { PHOTOS } = getCloudflareEnv();
    const prefix = `leads/${sessionId}/photos/`;
    const result = await PHOTOS.list({ prefix, limit: 100 });
    
    return result.objects.map(obj => obj.key);
  } catch (err) {
    console.error(`[R2] List error for ${sessionId}:`, err);
    return [];
  }
}

/**
 * Delete all photos for a session
 */
export async function r2DeleteSessionPhotos(sessionId: string): Promise<void> {
  try {
    const { PHOTOS } = getCloudflareEnv();
    const keys = await r2ListPhotos(sessionId);
    
    if (keys.length > 0) {
      await PHOTOS.delete(keys);
      console.log(`[R2] Deleted ${keys.length} photos for session ${sessionId}`);
    }
  } catch (err) {
    console.error(`[R2] Delete session photos error:`, err);
  }
}

// ----------------------
// LEGACY CONVERSION HELPERS
// ----------------------

/**
 * Prepare a Lead object for storage (legacy helper, kept for compatibility)
 */
export function prepareForCloudflare(
  lead: Lead,
  params: { rawPhotos?: Record<string, ArrayBuffer> } = {}
): { d1Row: D1LeadRow; r2Uploads: R2PhotoUpload[] } {
  const d1Row: D1LeadRow = {
    id: lead.session_id,
    customer_name: lead.customer.name,
    customer_phone: lead.customer.phone,
    customer_zip: lead.customer.zip,
    service_type: lead.job.service_type,
    status: 'collecting',
    messages_json: JSON.stringify(lead.messages),
    photo_refs_json: JSON.stringify(lead.job.photos.files),
    full_lead_json: JSON.stringify(lead),
    created_at: lead.created_at,
    updated_at: lead.updated_at,
  };

  const r2Uploads: R2PhotoUpload[] = [];

  if (params.rawPhotos) {
    for (const photo of lead.job.photos.files) {
      const filename = photo.name || getFilenameFromUrl(photo.url);
      
      if (filename && params.rawPhotos[filename]) {
        r2Uploads.push({
          key: `leads/${lead.session_id}/photos/${filename}`,
          data: params.rawPhotos[filename],
          contentType: photo.content_type || 'application/octet-stream',
        });
      }
    }
  }

  return { d1Row, r2Uploads };
}

function getFilenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    return parts[parts.length - 1];
  } catch {
    const parts = url.split('/');
    return parts[parts.length - 1];
  }
}
