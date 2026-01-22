/**
 * Validation Layer - Treats LLM output as untrusted input
 * 
 * Returns sanitized patch + reject reason for logging/retry decisions
 */

import { z } from 'zod';

// ============================================================
// Types
// ============================================================

export type FieldSource = 'user' | 'inferred' | 'owner_override';

export interface FieldWithProvenance<T> {
  value: T;
  source: FieldSource;
  timestamp: string;
}

export type RejectReason = 
  | 'unknown_field'
  | 'bad_type'
  | 'out_of_range'
  | 'invalid_format'
  | 'parse_error'
  | 'empty_patch';

export interface ValidationSuccess {
  ok: true;
  patch: SanitizedPatch;
  warnings?: string[];
}

export interface ValidationFailure {
  ok: false;
  reason: RejectReason;
  details: string;
  field?: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// ============================================================
// Schema Definitions with Bounds
// ============================================================

// Allowed fields whitelist
const ALLOWED_FIELDS = [
  'service_type',
  'tree_count',
  'diameter_inches',
  'height_ft',
  'zip',
  'name',
  'phone',
  'email',
  'access',
  'hazards',
  'urgency',
  'haul_away',
  'gate_width_ft',
] as const;

// Value ranges for clamping/nulling
const FIELD_RANGES = {
  tree_count: { min: 1, max: 50, clampThreshold: 5 },
  diameter_inches: { min: 1, max: 120, clampThreshold: 10 },
  height_ft: { min: 1, max: 200, clampThreshold: 20 },
  gate_width_ft: { min: 0, max: 50, clampThreshold: 5 },
  stump_count: { min: 1, max: 50, clampThreshold: 5 },
} as const;

// Service types that imply context for unit parsing
const SERVICE_CONTEXT = {
  'stump_grinding': ['diameter_inches', 'stump_count'],
  'tree_removal': ['diameter_inches', 'height_ft', 'tree_count'],
  'tree_trimming': ['height_ft', 'tree_count'],
  'land_clearing': ['tree_count'],
  'emergency_storm': ['diameter_inches', 'height_ft', 'tree_count'],
} as const;

// Zod schemas for each field type
const accessSchema = z.object({
  gate_width_ft: z.number().optional(),
  slope: z.enum(['easy', 'moderate', 'steep']).optional(),
}).optional();

const hazardsSchema = z.object({
  power_lines: z.boolean().optional(),
  nearby_structures: z.boolean().optional(),
  other: z.string().optional(),
}).optional();

// ... (existing code ranges/contexts) ...

// All valid service types
const SERVICE_TYPES = [
  'tree_removal',
  'tree_trimming',
  'tree_health',
  'stump_grinding',
  'tree_planting',
  'shrub_care',
  'fertilization',
  'soil_care',
  'pest_management',
  'disease_management',
  'storm_prep',
  'emergency_storm',
  'utility_vegetation',
  'land_clearing',
  'mulching',
  'lawn_care',
  'consulting',
  'plant_health_care',
  'airspading',
  'fire_abatement',
  'herbicide',
  'substation',
  'weather_protection',
  'municipal',
  'work_planning',
  'tree_preservation',
  'other',
] as const;

// Main patch schema - using z.coerce for automatic type coercion
// LLM often returns wrong types (zip as number, tree_count as string)
const patchSchema = z.object({
  service_type: z.enum(SERVICE_TYPES).optional(),
  tree_count: z.coerce.number().int().optional(),  // Auto-converts "1" -> 1
  diameter_inches: z.coerce.number().optional(),
  height_ft: z.coerce.number().optional(),
  zip: z.coerce.string().optional(),  // Auto-converts 54855 -> "54855"
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  access: accessSchema,
  hazards: hazardsSchema,
  urgency: z.enum(['normal', 'urgent', 'emergency']).optional(),
  haul_away: z.union([z.boolean(), z.literal('unsure')]).optional(),  // Accept bool or 'unsure'
}).strict(); // Reject unknown fields

export type SanitizedPatch = z.infer<typeof patchSchema>;

// ============================================================
// Unit Parsing
// ============================================================

interface UnitParseResult {
  value: number;
  unit: 'ft' | 'in' | 'none';
  field?: string;
}

const UNIT_PATTERNS = [
  // "10ft", "10 ft", "10 feet", "10 foot"
  { pattern: /(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)/i, unit: 'ft' as const },
  // "120in", "120 in", "120 inches", "120 inch"  
  { pattern: /(\d+(?:\.\d+)?)\s*(?:in|inches|inch)/i, unit: 'in' as const },
  // Plain number
  { pattern: /^(\d+(?:\.\d+)?)$/, unit: 'none' as const },
];

/**
 * Parse unit-containing text and normalize to standard units
 * 
 * @param text - User input like "10ft wide" or "120 inches"
 * @param contextField - What field this is for (diameter_inches, height_ft, etc.)
 */
export function parseUnits(text: string, contextField?: string): UnitParseResult | null {
  for (const { pattern, unit } of UNIT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      let value = parseFloat(match[1]);
      
      // Normalize inches to feet if the target field expects feet
      if (unit === 'in' && contextField?.includes('_ft')) {
        value = value / 12;
      }
      // Normalize feet to inches if the target field expects inches
      else if (unit === 'ft' && contextField?.includes('_inches')) {
        value = value * 12;
      }
      
      return { value, unit, field: contextField };
    }
  }
  return null;
}

/**
 * Normalize units in a text value based on service context
 */
export function normalizeUnitsInPatch(
  patch: Record<string, unknown>,
  serviceType?: string
): Record<string, unknown> {
  const result = { ...patch };
  
  // Get context-relevant fields
  const contextFields = serviceType 
    ? SERVICE_CONTEXT[serviceType as keyof typeof SERVICE_CONTEXT] || []
    : [];
  
  // Process string values that might contain units
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      // Check if this looks like a measurement
      const parsed = parseUnits(value, key);
      if (parsed && !isNaN(parsed.value)) {
        result[key] = parsed.value;
      }
    }
  }
  
  return result;
}

// ============================================================
// Range Clamping/Nulling
// ============================================================

interface RangeResult {
  value: number | null;
  clamped: boolean;
  nulled: boolean;
  original: number;
}

/**
 * Clamp or null a numeric value based on field bounds
 * 
 * Rules:
 * - Small out-of-bounds (within threshold): clamp
 * - Nonsense values (negative, way out of bounds): null
 */
function applyRangeBounds(
  value: number,
  field: keyof typeof FIELD_RANGES
): RangeResult {
  const range = FIELD_RANGES[field];
  if (!range) {
    return { value, clamped: false, nulled: false, original: value };
  }
  
  const { min, max, clampThreshold } = range;
  
  // Nonsense values (negative or way too high) → null
  if (value < 0 || value > max + clampThreshold * 2) {
    return { value: null, clamped: false, nulled: true, original: value };
  }
  
  // Small under-bounds → clamp to min
  if (value < min) {
    return { value: min, clamped: true, nulled: false, original: value };
  }
  
  // Small over-bounds → clamp to max
  if (value > max && value <= max + clampThreshold) {
    return { value: max, clamped: true, nulled: false, original: value };
  }
  
  // Within bounds
  return { value, clamped: false, nulled: false, original: value };
}

// ============================================================
// Main Validation Function
// ============================================================

/**
 * Validate and sanitize an LLM patch
 * 
 * @param rawPatch - The raw patch from LLM extraction
 * @param serviceType - Current service type for context-aware parsing
 * @returns Sanitized patch or rejection with reason
 */
export function validateLLMPatch(
  rawPatch: unknown,
  serviceType?: string
): ValidationResult {
  // Handle null/undefined
  if (!rawPatch || typeof rawPatch !== 'object') {
    return {
      ok: false,
      reason: 'parse_error',
      details: 'Patch is not an object',
    };
  }
  
  const patch = rawPatch as Record<string, unknown>;
  
  // Check for empty patch
  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      reason: 'empty_patch',
      details: 'No fields extracted',
    };
  }
  
  // Check for unknown fields
  const unknownFields = Object.keys(patch).filter(
    key => !ALLOWED_FIELDS.includes(key as any)
  );
  if (unknownFields.length > 0) {
    return {
      ok: false,
      reason: 'unknown_field',
      details: `Unknown fields: ${unknownFields.join(', ')}`,
      field: unknownFields[0],
    };
  }

  // TYPE COERCION: LLM often returns wrong types
  // Fix zip: LLM returns number (54855) but we need string ("54855")
  if ('zip' in patch && typeof patch.zip === 'number') {
    patch.zip = String(patch.zip);
  }
  
  // Fix tree_count: LLM might return string ("1") but we need number (1)
  if ('tree_count' in patch && typeof patch.tree_count === 'string') {
    const parsed = parseInt(patch.tree_count, 10);
    if (!isNaN(parsed)) {
      patch.tree_count = parsed;
    }
  }
  
  // Normalize units
  const normalizedPatch = normalizeUnitsInPatch(patch, serviceType);
  
  // Apply range bounds to numeric fields
  const warnings: string[] = [];
  const boundedPatch = { ...normalizedPatch };
  
  for (const [field, range] of Object.entries(FIELD_RANGES)) {
    if (field in boundedPatch && typeof boundedPatch[field] === 'number') {
      const result = applyRangeBounds(
        boundedPatch[field] as number,
        field as keyof typeof FIELD_RANGES
      );
      
      if (result.nulled) {
        delete boundedPatch[field];
        warnings.push(`${field}: ${result.original} is out of range, ignored`);
      } else if (result.clamped) {
        boundedPatch[field] = result.value;
        warnings.push(`${field}: ${result.original} clamped to ${result.value}`);
      }
    }
  }

  // Normalize root-level gate_width_ft -> access.gate_width_ft
  if ('gate_width_ft' in boundedPatch && typeof boundedPatch.gate_width_ft === 'number') {
    boundedPatch.access = boundedPatch.access || {};
    (boundedPatch.access as any).gate_width_ft = boundedPatch.gate_width_ft;
    delete boundedPatch.gate_width_ft;
  }
  
  // Handle nested access.gate_width_ft
  if (boundedPatch.access && typeof boundedPatch.access === 'object') {
    const access = boundedPatch.access as Record<string, unknown>;
    if ('gate_width_ft' in access && typeof access.gate_width_ft === 'number') {
      const result = applyRangeBounds(access.gate_width_ft, 'gate_width_ft');
      if (result.nulled) {
        delete access.gate_width_ft;
        warnings.push(`access.gate_width_ft: ${result.original} is out of range, ignored`);
      } else if (result.clamped) {
        access.gate_width_ft = result.value;
        warnings.push(`access.gate_width_ft: ${result.original} clamped to ${result.value}`);
      }
    }
  }
  
  // Validate zip format
  if ('zip' in boundedPatch && typeof boundedPatch.zip === 'string') {
    const zip = boundedPatch.zip.replace(/\D/g, ''); // Extract digits
    if (zip.length === 5) {
      boundedPatch.zip = zip;
    } else if (zip.length > 0) {
      // Try to extract 5-digit zip from longer string
      const match = boundedPatch.zip.match(/\b(\d{5})\b/);
      if (match) {
        boundedPatch.zip = match[1];
      } else {
        delete boundedPatch.zip;
        warnings.push('zip: invalid format, ignored');
      }
    }
  }
  
  // Validate phone format (normalize to digits only)
  if ('phone' in boundedPatch && typeof boundedPatch.phone === 'string') {
    const digits = boundedPatch.phone.replace(/\D/g, '');
    if (digits.length === 10) {
      boundedPatch.phone = digits;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      boundedPatch.phone = digits.slice(1);
    } else {
      delete boundedPatch.phone;
      warnings.push('phone: invalid format, ignored');
    }
  }
  
  // Final schema validation
  const parsed = patchSchema.safeParse(boundedPatch);
  
  if (!parsed.success) {
    const error = parsed.error.errors[0];
    return {
      ok: false,
      reason: 'bad_type',
      details: `${error.path.join('.')}: ${error.message}`,
      field: error.path.join('.'),
    };
  }
  
  return {
    ok: true,
    patch: parsed.data,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ============================================================
// State Gates
// ============================================================

export const REQUIRED_FOR_PHOTOS = ['zip', 'service_type'] as const;
export const REQUIRED_FOR_FINALIZE = ['name', 'phone', 'zip', 'service_type'] as const;
export const REQUIRED_FOR_ESTIMATE = ['zip', 'service_type'] as const;

export interface AllowedActions {
  canChat: boolean;
  canUpload: boolean;
  canFinalize: boolean;
  canOwnerApprove: boolean;
  canTextCustomer: boolean;
  missingFor: {
    upload?: string[];
    finalize?: string[];
    estimate?: string[];
  };
}

/**
 * Get all allowed actions for current state
 * Single source of truth for state gates
 */
export function getAllowedActions(state: Record<string, unknown>): AllowedActions {
  const hasField = (field: string) => {
    const value = state[field];
    return value !== undefined && value !== null && value !== '';
  };
  
  const missingForUpload = REQUIRED_FOR_PHOTOS.filter(f => !hasField(f));
  const missingForFinalize = REQUIRED_FOR_FINALIZE.filter(f => !hasField(f));
  const missingForEstimate = REQUIRED_FOR_ESTIMATE.filter(f => !hasField(f));
  
  const hasEstimate = state.estimate !== undefined;
  const hasPhotos = Array.isArray(state.photos) && state.photos.length > 0;
  const ownerApproved = state.status === 'approved' || state.ownerApprovedWithoutPhotos === true;
  const needsSiteVisit = state.needsSiteVisit === true;
  const ownerMustConfirm = state.ownerMustConfirm === true;
  
  return {
    canChat: true, // Always allowed
    canUpload: missingForUpload.length === 0,
    canFinalize: missingForFinalize.length === 0 && hasEstimate,
    canOwnerApprove: hasPhotos || state.ownerApprovedWithoutPhotos === true,
    canTextCustomer: ownerApproved && !needsSiteVisit && !ownerMustConfirm,
    missingFor: {
      upload: missingForUpload.length > 0 ? [...missingForUpload] : undefined,
      finalize: missingForFinalize.length > 0 ? [...missingForFinalize] : undefined,
      estimate: missingForEstimate.length > 0 ? [...missingForEstimate] : undefined,
    },
  };
}
