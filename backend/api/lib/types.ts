// backend/api/lib/types.ts

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ServiceType = "tree_removal" | "stump_grinding" | "trimming" | "storm_cleanup" | "unknown";
export type AccessLevel = "easy" | "medium" | "hard";
export type SessionStatus = "collecting" | "awaiting_photos" | "ready_for_estimate" | "estimate_sent" | "approved" | "scheduled";

export interface ContactInfo {
  name?: string;
  phone?: string;
  email?: string;
}

export interface Estimate {
  min: number;
  max: number;
  confidence: "high" | "medium" | "low";
  drivers: string[];
}

export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;

  // intake fields
  zip?: string;
  serviceType?: ServiceType;
  treeCount?: number;
  access?: AccessLevel;
  location?: "front_yard" | "backyard" | "side_yard";
  hasPowerLines?: boolean;
  hasStructuresNearby?: boolean;
  haulAway?: boolean | "unsure";
  urgency?: "normal" | "urgent" | "emergency";

  // photos
  photoUrls: string[];
  hasPhotos?: boolean;

  // contact info
  contact: ContactInfo;

  // estimate
  estimate?: Estimate;

  // conversation memory
  messages: ChatMessage[];

  // Questions tracking - prevents repeating questions
  questions_asked: string[];
}

export interface ChatRequestBody {
  sessionId?: string;
  message: string;
  stream?: boolean;  // optional: request streaming response
}

export interface ChatResponseBody {
  sessionId: string;
  assistantMessage: string;
  nextQuestions?: string[];
  collected?: Partial<SessionState>;
  readyForPhotos?: boolean;
  estimate?: Estimate;
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
  contact: ContactInfo;
}

export interface FinalizeResponseBody {
  success: boolean;
  sessionId: string;
  estimate?: Estimate;
  emailSent: boolean;
  smsSent: boolean;
}
