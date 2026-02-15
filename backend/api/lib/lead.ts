// ============================================================
// Lead Schema - Canonical data structure for all leads (v1.0)
// ============================================================

import { v4 as uuidv4 } from 'uuid';

// ----------------------
// CONSTANTS
// ----------------------
export const LEAD_SCHEMA_VERSION = '1.0';
export const MAX_MESSAGE_HISTORY = 30;

// ----------------------
// SERVICE TYPES
// ----------------------
export type ServiceType =
  | 'tree_removal'
  | 'tree_trimming'
  | 'stump_grinding'
  | 'storm_cleanup'
  | 'emergency_storm'
  | 'land_clearing'
  | 'other';

export type UrgencyType = 'flexible' | 'soon' | 'urgent' | 'emergency';
export type PropertyType = 'residential' | 'commercial';
export type ContactPreference = 'text' | 'email' | 'call';

// ----------------------
// SUB-TYPES
// ----------------------
export interface PhotoFile {
  url: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
}

export interface Customer {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  zip: string | null;
  preferred_contact: ContactPreference;
}

export interface JobAccess {
  gate_width_ft: number | null;
  backyard: boolean | null;
  fence: boolean | null;
  driveway_access: boolean | null;
  distance_from_street_ft: number | null;
}

export interface JobHazards {
  power_lines: boolean | null;
  near_structure: boolean | null;
  unknown_utilities: boolean | null;
}

export interface JobDimensions {
  // Stump fields (used when service_type includes stump work)
  stump_diameter_in: number | null;
  stump_width_ft: number | null;
  stump_height_ft: number | null;
  // Tree fields (used for tree removal/trimming)
  tree_height_ft: number | null;
  tree_diameter_in: number | null;
  // Common
  quantity: number; // default 1
}

export interface JobDisposal {
  haul_away_needed: boolean | null;
  chips_left_on_site: boolean | null;
}

export interface JobPhotos {
  requested: boolean;
  received: boolean;
  files: PhotoFile[];
}

export interface Job {
  service_type: ServiceType | null;
  urgency: UrgencyType | null;
  property_type: PropertyType | null;
  description_raw: string | null;
  access: JobAccess;
  hazards: JobHazards;
  dimensions: JobDimensions;
  disposal: JobDisposal;
  photos: JobPhotos;
}

export interface Quote {
  site_visit_required: boolean;
  confidence: number; // 0.0 - 1.0
}

export interface NextQuestion {
  id: string; // dotted path, e.g., "customer.zip"
  question: string;
  type: 'short_text' | 'number' | 'buttons' | 'phone' | 'email';
  choices?: string[];
}

export interface InternalMeta {
  missing_fields: string[]; // dotted paths: "customer.zip", "job.access.gate_width_ft"
  notes_for_owner: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ----------------------
// CANONICAL LEAD INTERFACE
// ----------------------
export interface Lead {
  version: string;
  session_id: string;

  customer: Customer;
  job: Job;
  quote: Quote;

  next_questions: NextQuestion[];
  internal: InternalMeta;

  // Conversation history (capped at MAX_MESSAGE_HISTORY)
  messages: ChatMessage[];
  messages_truncated: boolean;

  // Question IDs that have been asked (dotted paths)
  questions_asked: string[];

  // Timestamps (ISO-8601)
  created_at: string;
  updated_at: string;
}

// ----------------------
// FACTORY
// ----------------------
export function createLead(sessionId?: string): Lead {
  const now = new Date().toISOString();

  return {
    version: LEAD_SCHEMA_VERSION,
    session_id: sessionId ?? uuidv4(),

    customer: {
      name: null,
      phone: null,
      email: null,
      address: null,
      zip: null,
      preferred_contact: 'text',
    },

    job: {
      service_type: null,
      urgency: null,
      property_type: null,
      description_raw: null,
      access: {
        gate_width_ft: null,
        backyard: null,
        fence: null,
        driveway_access: null,
        distance_from_street_ft: null,
      },
      hazards: {
        power_lines: null,
        near_structure: null,
        unknown_utilities: null,
      },
      dimensions: {
        stump_diameter_in: null,
        stump_width_ft: null,
        stump_height_ft: null,
        tree_height_ft: null,
        tree_diameter_in: null,
        quantity: 1,
      },
      disposal: {
        haul_away_needed: null,
        chips_left_on_site: null,
      },
      photos: {
        requested: false,
        received: false,
        files: [],
      },
    },

    quote: {
      site_visit_required: false,
      confidence: 0,
    },

    next_questions: [],

    internal: {
      missing_fields: [],
      notes_for_owner: [],
    },

    messages: [],
    messages_truncated: false,
    questions_asked: [],

    created_at: now,
    updated_at: now,
  };
}

// ----------------------
// HELPERS
// ----------------------

/**
 * Truncate messages to MAX_MESSAGE_HISTORY, keeping most recent
 */
export function truncateMessages(lead: Lead): Lead {
  if (lead.messages.length <= MAX_MESSAGE_HISTORY) {
    return lead;
  }

  return {
    ...lead,
    messages: lead.messages.slice(-MAX_MESSAGE_HISTORY),
    messages_truncated: true,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Get all missing required fields as dotted paths
 */
export function getMissingLeadFields(lead: Lead): string[] {
  const missing: string[] = [];

  // Customer fields
  if (!lead.customer.zip) missing.push('customer.zip');
  if (!lead.customer.name) missing.push('customer.name');
  if (!lead.customer.phone) missing.push('customer.phone');
  if (!lead.customer.email) missing.push('customer.email');

  // Job core fields
  if (!lead.job.service_type) missing.push('job.service_type');

  // Access fields
  if (lead.job.access.backyard === null) missing.push('job.access.backyard');
  if (lead.job.access.backyard === true && lead.job.access.gate_width_ft === null) {
    missing.push('job.access.gate_width_ft');
  }

  // Hazards
  if (lead.job.hazards.power_lines === null) missing.push('job.hazards.power_lines');
  if (lead.job.hazards.near_structure === null) missing.push('job.hazards.near_structure');

  // Disposal
  if (lead.job.disposal.haul_away_needed === null) missing.push('job.disposal.haul_away_needed');

  // Dimensions based on service type
  if (lead.job.service_type === 'stump_grinding') {
    if (lead.job.dimensions.stump_diameter_in === null) {
      missing.push('job.dimensions.stump_diameter_in');
    }
  } else if (lead.job.service_type === 'tree_removal' || lead.job.service_type === 'tree_trimming') {
    // Tree height is helpful but not strictly required
  }

  // Photos
  if (!lead.job.photos.received) missing.push('job.photos');

  return missing;
}

/**
 * Update lead timestamp
 */
export function touchLead(lead: Lead): Lead {
  return {
    ...lead,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Add a message and auto-truncate if needed
 */
export function addMessage(lead: Lead, role: 'user' | 'assistant', content: string): Lead {
  const updated = {
    ...lead,
    messages: [...lead.messages, { role, content }],
    updated_at: new Date().toISOString(),
  };

  return truncateMessages(updated);
}

/**
 * Mark a question as asked
 */
export function markQuestionAsked(lead: Lead, questionId: string): Lead {
  if (lead.questions_asked.includes(questionId)) {
    return lead;
  }

  return {
    ...lead,
    questions_asked: [...lead.questions_asked, questionId],
    updated_at: new Date().toISOString(),
  };
}
