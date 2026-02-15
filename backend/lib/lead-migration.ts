// ============================================================
// Lead Migration - Upgrade old SessionState to Lead (v1.0)
// ============================================================

import type { Lead, PhotoFile, ServiceType, UrgencyType } from './lead';
import { createLead, LEAD_SCHEMA_VERSION } from './lead';
import type { SessionState } from './session';

// ----------------------
// TYPE GUARDS
// ----------------------

/**
 * Check if a persisted object is the new Lead schema
 */
export function isLeadSchema(obj: unknown): obj is Lead {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'version' in obj &&
    typeof (obj as Lead).version === 'string'
  );
}

/**
 * Check if a persisted object is the old SessionState schema
 */
export function isSessionStateSchema(obj: unknown): obj is SessionState {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'lead_id' in obj &&
    !('version' in obj)
  );
}

// ----------------------
// SERVICE TYPE MAPPING
// ----------------------
const SERVICE_TYPE_MAP: Record<string, ServiceType> = {
  'tree_removal': 'tree_removal',
  'tree_trimming': 'tree_trimming',
  'stump_grinding': 'stump_grinding',
  'storm_cleanup': 'storm_cleanup',
  'emergency_storm': 'emergency_storm',
  'land_clearing': 'land_clearing',
  // Old schema aliases
  'trimming': 'tree_trimming',
  'unknown': 'other',
  'other': 'other',
};

function mapServiceType(old: string | null): ServiceType | null {
  if (!old) return null;
  return SERVICE_TYPE_MAP[old] ?? 'other';
}

// ----------------------
// URGENCY MAPPING
// ----------------------
const URGENCY_MAP: Record<string, UrgencyType> = {
  'normal': 'flexible',
  'flexible': 'flexible',
  'soon': 'soon',
  'urgent': 'urgent',
  'emergency': 'emergency',
};

function mapUrgency(old: string | null | undefined): UrgencyType | null {
  if (!old) return null;
  return URGENCY_MAP[old] ?? 'flexible';
}

// ----------------------
// UPGRADE FUNCTION
// ----------------------

/**
 * Upgrade an old SessionState to the new Lead schema
 */
export function upgradeSessionToLead(session: SessionState): Lead {
  const lead = createLead(session.lead_id);

  // Timestamps
  lead.created_at = session.created_at;
  lead.updated_at = session.updated_at;

  // Customer
  lead.customer.zip = session.zip ?? null;
  lead.customer.name = session.contact?.name ?? null;
  lead.customer.phone = session.contact?.phone ?? null;
  lead.customer.email = session.contact?.email ?? null;

  // Job core
  lead.job.service_type = mapServiceType(session.service_type);
  lead.job.urgency = mapUrgency(session.urgency);

  // Job dimensions
  lead.job.dimensions.tree_height_ft = session.dimensions?.height_ft ?? null;
  lead.job.dimensions.tree_diameter_in = session.dimensions?.diameter_ft 
    ? session.dimensions.diameter_ft * 12 // Convert ft to inches
    : null;
  lead.job.dimensions.quantity = session.tree_count ?? 1;

  // Job access
  lead.job.access.backyard = session.access?.location === 'backyard';
  lead.job.access.gate_width_ft = session.access?.gate_width_ft ?? null;
  // Map old slope to fence (rough approximation)
  if (session.access?.slope === 'steep') {
    lead.internal.notes_for_owner.push('Old session had steep slope noted');
  }

  // Job hazards
  lead.job.hazards.power_lines = session.hazards?.power_lines ?? null;
  lead.job.hazards.near_structure = session.hazards?.structures_nearby ?? null;

  // Job disposal
  lead.job.disposal.haul_away_needed = 
    session.haul_away === true ? true :
    session.haul_away === false ? false :
    null;

  // Photos
  lead.job.photos.received = session.photos_uploaded ?? false;
  lead.job.photos.requested = true; // Always set to true for migrated sessions
  if (session.photos?.urls) {
    lead.job.photos.files = session.photos.urls.map((url): PhotoFile => ({
      url,
    }));
  }

  // Messages (already in correct format)
  lead.messages = session.messages ?? [];
  lead.messages_truncated = false;

  // Questions asked - map old IDs to new dotted paths
  if (session.questions_asked) {
    lead.questions_asked = session.questions_asked.map(mapQuestionIdToPath);
  }

  // Compute missing fields
  lead.internal.missing_fields = computeMissingFieldsForMigration(lead);

  // Add migration note
  lead.internal.notes_for_owner.push(
    `Migrated from SessionState schema on ${new Date().toISOString()}`
  );

  return lead;
}

// ----------------------
// QUESTION ID MAPPING
// ----------------------
const QUESTION_ID_TO_PATH: Record<string, string> = {
  'zip': 'customer.zip',
  'tree_count': 'job.dimensions.quantity',
  'haul_debris': 'job.disposal.haul_away_needed',
  'access_location': 'job.access.backyard',
  'gate_width': 'job.access.gate_width_ft',
  'slope': 'job.access.slope',
  'power_lines': 'job.hazards.power_lines',
  'structures': 'job.hazards.near_structure',
  'contact_name': 'customer.name',
  'contact_phone': 'customer.phone',
  'contact_email': 'customer.email',
};

function mapQuestionIdToPath(oldId: string): string {
  return QUESTION_ID_TO_PATH[oldId] ?? oldId;
}

// ----------------------
// MISSING FIELDS (for migration)
// ----------------------
function computeMissingFieldsForMigration(lead: Lead): string[] {
  const missing: string[] = [];

  if (!lead.customer.zip) missing.push('customer.zip');
  if (!lead.customer.name) missing.push('customer.name');
  if (!lead.customer.phone) missing.push('customer.phone');
  if (!lead.job.service_type) missing.push('job.service_type');
  if (lead.job.access.backyard === null) missing.push('job.access.backyard');
  if (lead.job.hazards.power_lines === null) missing.push('job.hazards.power_lines');
  if (lead.job.disposal.haul_away_needed === null) missing.push('job.disposal.haul_away_needed');
  if (!lead.job.photos.received) missing.push('job.photos');

  return missing;
}

// ----------------------
// AUTO-DETECT AND UPGRADE
// ----------------------

/**
 * Load a persisted object and upgrade if needed.
 * Returns a Lead in the current schema version.
 */
export function ensureLeadSchema(obj: unknown): Lead | null {
  if (isLeadSchema(obj)) {
    // Already new schema
    return obj;
  }

  if (isSessionStateSchema(obj)) {
    // Upgrade from old schema
    return upgradeSessionToLead(obj);
  }

  // Unknown format
  return null;
}
