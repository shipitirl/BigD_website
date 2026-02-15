// backend/api/lib/types.ts
// Synchronized with session.ts - these are API-facing types

import type { SessionState, ServiceType, Estimate } from "./session";

// Re-export canonical types from session.ts
export type { ServiceType, Estimate };

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// API Request/Response Types
export interface ChatRequestBody {
  sessionId?: string | null;
  message: string;
  stream?: boolean;
}

// Collected fields for API response (subset of session data)
export interface CollectedFields {
  zip?: string | null;
  serviceType?: string | null;
  treeCount?: number | null;
  access?: string | null;
  hasPowerLines?: boolean | null;
  hasPhotos?: boolean;
}

export interface ChatResponseBody {
  sessionId: string;
  assistantMessage: string;
  nextQuestions?: string[];
  collected?: CollectedFields;
  readyForPhotos?: boolean;
  estimate?: Estimate; // Only included for internal/owner use
}

// Upload types
export interface UploadRequestBody {
  sessionId: string;
}

export interface UploadResponseBody {
  success: boolean;
  uploaded: number;
  totalPhotos: number;
  maxPhotos: number;
  urls: string[];
  skipped?: { reason: string; filename: string }[];
}

// Finalize types
export interface FinalizeRequestBody {
  sessionId: string;
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
  };
}

export interface FinalizeResponseBody {
  success: boolean;
  sessionId: string;
  estimate?: Estimate;
  emailSent: boolean;
  smsSent: boolean;
  zapier?: {
    sent: boolean;
    skipped: boolean;
    error?: string;
  };
  hubspot?: {
    synced: boolean;
    dealId?: string;
    contactId?: string;
  };
}
