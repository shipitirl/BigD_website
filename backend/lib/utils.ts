// backend/api/lib/utils.ts

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { format } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import type { SessionState } from "./session";
import type { Lead } from "./lead";
import { ensureLeadSchema } from "./lead-migration";

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const SESSIONS_DIR = process.env.SESSIONS_DIR || (IS_SERVERLESS ? "/tmp/.sessions" : path.join(process.cwd(), ".sessions"));

// Ensure sessions directory exists
(async () => {
  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    console.log(`[Storage] persistent session directory ready: ${SESSIONS_DIR}`);
  } catch (err) {
    console.warn(`[Storage] Failed to create session directory: ${err}`);
  }
})();
// SESSION ID GENERATION
// ----------------------
export function generateSessionId(): string {
  return crypto.randomUUID();
}

// ----------------------
// STORAGE INTERFACE
// ----------------------
interface StorageAdapter {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, data: T): Promise<void>;
  delete(key: string): Promise<void>;
}

const fileAdapter: StorageAdapter = {
  async load<T>(key: string): Promise<T | null> {
    try {
      const filePath = path.join(SESSIONS_DIR, `${key}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as T;
    } catch (err) {
      if ((err as any).code !== "ENOENT") {
        console.error(`[Storage] Error loading session ${key}:`, err);
      }
      return null;
    }
  },
  async save<T>(key: string, data: T): Promise<void> {
    try {
      const filePath = path.join(SESSIONS_DIR, `${key}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error(`[Storage] Error saving session ${key}:`, err);
    }
  },
  async delete(key: string): Promise<void> {
    try {
      const filePath = path.join(SESSIONS_DIR, `${key}.json`);
      await fs.unlink(filePath);
    } catch (err) {
      // Ignore if file already missing
    }
  },
};

// ----------------------
// POSTGRESQL STORAGE
// ----------------------
let pgPool: any = null;

async function getPostgresPool() {
  if (pgPool) return pgPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  try {
    // Dynamic import to avoid requiring pg when not needed
    const { Pool } = await import("pg");
    pgPool = new Pool({ connectionString });

    // Initialize table if it doesn't exist
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create index for faster lookups
    await pgPool.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)
    `);

    console.log("[Storage] PostgreSQL connected and initialized");
    return pgPool;
  } catch (err) {
    console.warn("[Storage] PostgreSQL connection failed, using file storage:", err);
    return null;
  }
}

const postgresAdapter: StorageAdapter = {
  async load<T>(key: string): Promise<T | null> {
    const pool = await getPostgresPool();
    if (!pool) return fileAdapter.load(key);

    try {
      const result = await pool.query(
        "SELECT data FROM sessions WHERE session_id = $1",
        [key]
      );
      if (result.rows.length === 0) return null;
      return result.rows[0].data as T;
    } catch (err) {
      console.error("[Storage] PostgreSQL load error:", err);
      return fileAdapter.load(key);
    }
  },

  async save<T>(key: string, data: T): Promise<void> {
    const pool = await getPostgresPool();
    if (!pool) {
      await fileAdapter.save(key, data);
      return;
    }

    try {
      await pool.query(
        `INSERT INTO sessions (session_id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (session_id)
         DO UPDATE SET data = $2, updated_at = NOW()`,
        [key, JSON.stringify(data)]
      );
    } catch (err) {
      console.error("[Storage] PostgreSQL save error:", err);
      await fileAdapter.save(key, data);
    }
  },

  async delete(key: string): Promise<void> {
    const pool = await getPostgresPool();
    if (!pool) {
      await fileAdapter.delete(key);
      return;
    }

    try {
      await pool.query("DELETE FROM sessions WHERE session_id = $1", [key]);
    } catch (err) {
      console.error("[Storage] PostgreSQL delete error:", err);
      await fileAdapter.delete(key);
    }
  },
};

// ----------------------
// SUPABASE STORAGE
// ----------------------
let supabaseClient: any = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) return null;
  
  try {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    console.log("[Storage] Supabase client initialized");
    return supabaseClient;
  } catch (err) {
    console.warn("[Storage] Supabase init failed:", err);
    return null;
  }
}

const supabaseAdapter: StorageAdapter = {
  async load<T>(key: string): Promise<T | null> {
    const client = getSupabaseClient();
    if (!client) return fileAdapter.load(key);
    
    try {
      const { data, error } = await client
        .from("sessions")
        .select("data")
        .eq("session_id", key)
        .single();
      
      if (error || !data) return null;
      return data.data as T;
    } catch (err) {
      console.error("[Storage] Supabase load error:", err);
      return fileAdapter.load(key);
    }
  },

  async save<T>(key: string, data: T): Promise<void> {
    const client = getSupabaseClient();
    if (!client) {
      await fileAdapter.save(key, data);
      return;
    }
    
    try {
      await client
        .from("sessions")
        .upsert({ 
          session_id: key, 
          data: data as any,
          updated_at: new Date().toISOString()
        }, { onConflict: 'session_id' });
    } catch (err) {
      console.error("[Storage] Supabase save error:", err);
      await fileAdapter.save(key, data);
    }
  },

  async delete(key: string): Promise<void> {
    const client = getSupabaseClient();
    if (!client) {
      await fileAdapter.delete(key);
      return;
    }
    
    try {
      await client
        .from("sessions")
        .delete()
        .eq("session_id", key);
    } catch (err) {
      console.error("[Storage] Supabase delete error:", err);
      await fileAdapter.delete(key);
    }
  },
};

// ----------------------
// STORAGE API (Auto-selects adapter)
// ----------------------
async function getAdapter(): Promise<StorageAdapter> {
  // Priority: Supabase > PostgreSQL > File
  const supabase = getSupabaseClient();
  if (supabase) return supabaseAdapter;
  
  if (process.env.DATABASE_URL) {
    const pool = await getPostgresPool();
    if (pool) return postgresAdapter;
  }
  return fileAdapter;
}

export async function loadSession(sessionId: string): Promise<SessionState | null> {
  const adapter = await getAdapter();
  return adapter.load<SessionState>(sessionId);
}

export async function saveSession(sessionId: string, data: SessionState): Promise<void> {
  const adapter = await getAdapter();
  await adapter.save(sessionId, data);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const adapter = await getAdapter();
  await adapter.delete(sessionId);
}

// ----------------------
// FIND SESSION BY PHONE
// ----------------------
export async function findSessionByPhone(phone: string): Promise<SessionState | null> {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  // Try PostgreSQL first if configured
  if (process.env.DATABASE_URL) {
    const pool = await getPostgresPool();
    if (pool) {
      try {
        const result = await pool.query(
          `SELECT data FROM sessions
           WHERE (data->'contact'->>'phone') = $1
              OR (data->'contact'->>'phone') = $2
           ORDER BY updated_at DESC
           LIMIT 1`,
          [normalized, digits]
        );
        if (result.rows.length > 0) {
          return result.rows[0].data as SessionState;
        }
      } catch (err) {
        console.error("[Storage] PostgreSQL findSessionByPhone error:", err);
      }
    }
  }

  // Fallback: scan local session files
  try {
    const files = await fs.readdir(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readFile(path.join(SESSIONS_DIR, file), "utf-8");
        const session = JSON.parse(data) as SessionState;
        const stored = (session?.contact?.phone || "").replace(/\D/g, "");
        const storedNormalized = stored.length === 11 && stored.startsWith("1") ? stored.slice(1) : stored;
        if (storedNormalized && storedNormalized === normalized) {
          return session;
        }
      } catch {
        // ignore malformed session file
      }
    }
  } catch (err) {
    console.error("[Storage] File scan findSessionByPhone error:", err);
  }

  return null;
}

// ----------------------
// SYNC VERSIONS (for backwards compatibility)
// Uses memory store explicitly
// ----------------------
const memoryStore = new Map<string, any>();

export function loadSessionSync<T>(sessionId: string): T | null {
  return (memoryStore.get(sessionId) as T) ?? null;
}

export function saveSessionSync<T>(sessionId: string, data: T): void {
  memoryStore.set(sessionId, data);
}

// ----------------------
// PHONE NUMBER FORMATTING
// ----------------------
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

// ----------------------
// STORAGE INFO
// ----------------------
export async function getStorageType(): Promise<"postgres" | "memory"> {
  if (process.env.DATABASE_URL) {
    const pool = await getPostgresPool();
    if (pool) return "postgres";
  }
  return "memory";
}

// ----------------------
// LEAD STORAGE (with auto-upgrade)
// ----------------------

/**
 * Load a lead, auto-upgrading old SessionState format if needed.
 * Returns null if not found.
 */
export async function loadLead(sessionId: string): Promise<Lead | null> {
  const adapter = await getAdapter();
  const raw = await adapter.load<unknown>(sessionId);
  
  if (!raw) return null;
  
  const lead = ensureLeadSchema(raw);
  
  if (lead) {
    // If this was an upgrade, persist the new format
    const wasUpgraded = !('version' in (raw as object));
    if (wasUpgraded) {
      console.log(`[Storage] Auto-upgraded session ${sessionId} to Lead v${lead.version}`);
      await adapter.save(sessionId, lead);
    }
    return lead;
  }
  
  console.warn(`[Storage] Unknown schema format for session ${sessionId}`);
  return null;
}

/**
 * Save a lead to storage.
 */
export async function saveLead(sessionId: string, lead: Lead): Promise<void> {
  const adapter = await getAdapter();
  await adapter.save(sessionId, lead);
}
