// ============================================================
// Session State - Core data structure for intake conversations
// ============================================================

import { v4 as uuidv4 } from 'uuid';

// ----------------------
// TYPE DEFINITIONS
// ----------------------
export type ServiceType =
  | 'tree_removal'
  | 'tree_trimming'
  | 'tree_health'
  | 'stump_grinding'
  | 'tree_planting'
  | 'shrub_care'
  | 'fertilization'
  | 'soil_care'
  | 'pest_management'
  | 'disease_management'
  | 'storm_prep'
  | 'emergency_storm'
  | 'utility_vegetation'
  | 'land_clearing'
  | 'mulching'
  | 'lawn_care'
  | 'consulting'
  | 'plant_health_care'
  | 'airspading'
  | 'fire_abatement'
  | 'herbicide'
  | 'substation'
  | 'weather_protection'
  | 'municipal'
  | 'work_planning'
  | 'tree_preservation'
  | 'other';
export type SessionStatus = 'collecting' | 'awaiting_photos' | 'ready_for_estimate' | 'awaiting_owner' | 'approved' | 'scheduled' | 'completed' | 'lost';
export type AccessLocation = 'front_yard' | 'backyard';
export type SlopeType = 'easy' | 'moderate' | 'steep';
export type UrgencyType = 'normal' | 'urgent' | 'emergency';

export interface Dimensions {
  height_ft: number | null;
  diameter_ft: number | null;
}

export interface Access {
  location: AccessLocation | null;
  gate_width_ft: number | null;
  slope: SlopeType | null;
}

export interface Hazards {
  power_lines: boolean | null;
  structures_nearby: boolean | null;
}

export interface Contact {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
}

export interface Photos {
  urls: string[];
  count: number;
}

export interface Estimate {
  min: number;
  max: number;
  confidence: 'high' | 'medium' | 'low';
  drivers: string[];
}

export interface FlowEvent {
  at: string;
  kind: 'user' | 'assistant' | 'state_update' | 'status';
  note: string;
}

export interface SessionState {
  lead_id: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;

  // Job details
  service_type: ServiceType | null;
  tree_count: number | null;
  dimensions: Dimensions;
  access: Access;
  hazards: Hazards;
  haul_away: boolean | 'unsure' | null;
  urgency: UrgencyType;

  // Customer info
  zip: string | null;
  contact: Contact;

  // Assets
  photos: Photos;
  photos_uploaded: boolean;

  // Computed
  estimate: Estimate | null;

  // Conversation history for context
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;

  // Questions tracking - prevents repeating questions
  questions_asked: string[];

  // Rolling memory + flow tracking across long conversations
  conversation_memory: string | null;
  flow_events: FlowEvent[];

  // Outcome tracking (populated when deal closes)
  actual_amount?: number;
  lost_reason?: string;
  completed_at?: string;
}

// ----------------------
// FACTORY
// ----------------------
export function createSession(): SessionState {
  return {
    lead_id: uuidv4(),
    status: 'collecting',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),

    service_type: null,
    tree_count: null,
    dimensions: { height_ft: null, diameter_ft: null },
    access: { location: null, gate_width_ft: null, slope: null },
    hazards: { power_lines: null, structures_nearby: null },
    haul_away: null,
    urgency: 'normal',

    zip: null,
    contact: { name: null, phone: null, email: null, address: null, city: null },

    photos: { urls: [], count: 0 },
    photos_uploaded: false,
    estimate: null,
    messages: [],
    questions_asked: [],
    conversation_memory: null,
    flow_events: [],
  };
}

// ----------------------
// STATE UPDATES
// ----------------------
export interface ExtractedPatch {
  service_type?: ServiceType;
  tree_count?: number;
  dimensions?: Partial<Dimensions>;
  access?: Partial<Access>;
  hazards?: Partial<Hazards>;
  haul_away?: boolean | 'unsure';
  urgency?: UrgencyType;
  zip?: string;
  contact?: Partial<Contact>;
}

export function applyPatch(state: SessionState, patch: ExtractedPatch): SessionState {
  const updated = { ...state, updated_at: new Date().toISOString() };

  if (patch.service_type !== undefined) updated.service_type = patch.service_type;
  if (patch.tree_count !== undefined) updated.tree_count = patch.tree_count;
  if (patch.haul_away !== undefined) updated.haul_away = patch.haul_away;
  if (patch.urgency !== undefined) updated.urgency = patch.urgency;
  if (patch.zip !== undefined) updated.zip = patch.zip;

  if (patch.dimensions) {
    updated.dimensions = { ...updated.dimensions, ...patch.dimensions };
  }
  if (patch.access) {
    updated.access = { ...updated.access, ...patch.access };
  }
  if (patch.hazards) {
    updated.hazards = { ...updated.hazards, ...patch.hazards };
  }
  if (patch.contact) {
    updated.contact = { ...updated.contact, ...patch.contact };
  }

  return updated;
}

// ----------------------
// REQUIRED FIELDS CHECK
// ----------------------
export function getMissingFields(state: SessionState): string[] {
  const missing: string[] = [];

  // Order matches QUESTION_LIBRARY priorities:
  // P1: zip
  if (!state.zip) missing.push('zip');

  // P2: tree_count (use === null to allow 0 as a valid value)
  if (state.tree_count === null) missing.push('tree_count');

  // P3: haul_debris
  if (state.haul_away === null) missing.push('haul_debris');

  // P4: access_location
  if (!state.access.location) missing.push('access_location');

  // Optional enrichments (not blocking):
  // gate width, slope, and hazards help pricing confidence, but should not stall flow.

  // P10: Contact info required before photos (short flow):
  // Name + phone + street address are required.
  // Email and city are optional at intake.
  if (!state.contact.name) missing.push('contact_name');
  if (!state.contact.phone) missing.push('contact_phone');
  if (!state.contact.address) missing.push('contact_address');

  return missing;
}

export function isReadyForEstimate(state: SessionState): boolean {
  // Need: job essentials + core contact fields captured.
  return state.service_type !== null && 
         state.tree_count !== null && 
         state.zip !== null && 
         !!state.contact.name && 
         !!state.contact.phone && 
         !!state.contact.address;
}

// ----------------------
// IN-MEMORY STORAGE (Replace with DB in production)
// ----------------------
const sessions = new Map<string, SessionState>();

export function getSession(leadId: string): SessionState | null {
  return sessions.get(leadId) || null;
}

export function saveSession(state: SessionState): void {
  sessions.set(state.lead_id, state);
}

export function deleteSession(leadId: string): void {
  sessions.delete(leadId);
}
