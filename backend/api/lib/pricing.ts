// ============================================================
// Pricing Engine - Deterministic rules-based estimation
// ============================================================

import { SessionState, Estimate } from './session';

// ----------------------
// PRICING CONFIGURATION
// ----------------------
export const PRICING_CONFIG = {
  // Base rates by service type
  stump_grinding: {
    base_per_inch: 3,      // $3 per inch of diameter
    minimum: 75,
    per_additional: 50,    // Each additional stump
  },
  tree_removal: {
    small: [300, 600],     // Under 15ft
    medium: [600, 1200],   // 15-40ft
    large: [1200, 2500],   // 40ft+
    per_additional: 200,
  },
  trimming: {
    small: [150, 300],
    medium: [300, 600],
    large: [600, 1000],
    per_additional: 100,
  },
  cleanup: {
    base: [200, 500],
    per_additional: 75,
  },

  // Modifiers
  modifiers: {
    power_lines: { adder: 200, label: 'Power line proximity' },
    structures: { adder: 100, label: 'Near structure' },
    backyard: { multiplier: 1.0, label: 'Backyard access' },
    narrow_gate: { multiplier: 1.1, label: 'Narrow gate access (under 4ft)' },
    very_narrow_gate: { multiplier: 1.25, label: 'Very narrow gate (under 3ft)' },
    slope_moderate: { multiplier: 1.1, label: 'Moderate slope' },
    slope_steep: { multiplier: 1.2, label: 'Steep slope' },
    haul_away: { adder: [100, 200], label: 'Debris haul away' },
    emergency: { multiplier: 1.5, label: 'Emergency service' },
    after_hours: { adder: 150, label: 'After-hours response' },
  },

  // Confidence thresholds
  confidence: {
    high: { missing_max: 1, variance: 0.10 },    // ±10%
    medium: { missing_max: 3, variance: 0.20 },  // ±20%
    low: { variance: 0.35 },                      // ±35%
  },
};

// ----------------------
// EXTENDED ESTIMATE WITH ESCALATION
// ----------------------
export interface ExtendedEstimate extends Estimate {
  needsSiteVisit: boolean;
  ownerMustConfirm: boolean;
  escalationReasons: string[];
}

// ----------------------
// ESTIMATE CALCULATOR
// ----------------------
export function calculateEstimate(state: SessionState): ExtendedEstimate {
  const drivers: string[] = [];
  let min = 0;
  let max = 0;
  let multiplier = 1.0;

  const count = state.tree_count || 1;
  const service = state.service_type || 'tree_removal';

  // --- Base price by service type ---
  switch (service) {
    case 'stump_grinding': {
      const config = PRICING_CONFIG.stump_grinding;
      const diameter = state.dimensions.diameter_ft || 12; // Default 12" if unknown
      const basePrice = Math.max(config.minimum, diameter * config.base_per_inch);
      min = basePrice;
      max = basePrice * 1.3; // 30% variance for unknowns

      if (count > 1) {
        const additionalCost = (count - 1) * config.per_additional;
        min += additionalCost;
        max += additionalCost;
        drivers.push(`${count - 1} additional stump(s) +$${additionalCost}`);
      }
      break;
    }

    case 'tree_removal':
    case 'emergency_storm': {
      const config = PRICING_CONFIG.tree_removal;
      const height = state.dimensions.height_ft;
      let size: 'small' | 'medium' | 'large' = 'medium';

      if (height && height < 15) size = 'small';
      else if (height && height > 40) size = 'large';

      [min, max] = config[size];

      if (count > 1) {
        const additionalCost = (count - 1) * config.per_additional;
        min += additionalCost;
        max += additionalCost;
        drivers.push(`${count - 1} additional tree(s) +$${additionalCost}`);
      }
      break;
    }

    case 'tree_trimming':
    case 'shrub_care': {
      const config = PRICING_CONFIG.trimming;
      const height = state.dimensions.height_ft;
      let size: 'small' | 'medium' | 'large' = 'medium';

      if (height && height < 15) size = 'small';
      else if (height && height > 40) size = 'large';

      [min, max] = config[size];

      if (count > 1) {
        const additionalCost = (count - 1) * config.per_additional;
        min += additionalCost;
        max += additionalCost;
        drivers.push(`${count - 1} additional tree(s) +$${additionalCost}`);
      }
      break;
    }

    case 'land_clearing':
    case 'mulching': {
      const config = PRICING_CONFIG.cleanup;
      [min, max] = config.base;
      break;
    }

    // All other services - provide a general estimate range
    // Owner will finalize based on specifics
    default: {
      // General service estimate - requires owner review
      min = 200;
      max = 800;
      drivers.push('Service requires custom quote');
      break;
    }
  }

  // --- Apply modifiers ---
  const mods = PRICING_CONFIG.modifiers;

  // Power lines
  if (state.hazards.power_lines) {
    min += mods.power_lines.adder;
    max += mods.power_lines.adder;
    drivers.push(`${mods.power_lines.label} +$${mods.power_lines.adder}`);
  }

  // Structures nearby
  if (state.hazards.structures_nearby) {
    min += mods.structures.adder;
    max += mods.structures.adder;
    drivers.push(`${mods.structures.label} +$${mods.structures.adder}`);
  }

  // Narrow gate
  if (state.access.location === 'backyard' && state.access.gate_width_ft !== null) {
    if (state.access.gate_width_ft < 3) {
      // Very narrow - may need hand-carry equipment
      multiplier *= mods.very_narrow_gate.multiplier;
      drivers.push(mods.very_narrow_gate.label);
    } else if (state.access.gate_width_ft < 4) {
      multiplier *= mods.narrow_gate.multiplier;
      drivers.push(mods.narrow_gate.label);
    }
  }

  // Slope
  if (state.access.slope === 'moderate') {
    multiplier *= mods.slope_moderate.multiplier;
    drivers.push(mods.slope_moderate.label);
  } else if (state.access.slope === 'steep') {
    multiplier *= mods.slope_steep.multiplier;
    drivers.push(mods.slope_steep.label);
  }

  // Haul away
  if (state.haul_away === true) {
    const [haulMin, haulMax] = mods.haul_away.adder as [number, number];
    min += haulMin;
    max += haulMax;
    drivers.push(`${mods.haul_away.label} +$${haulMin}-${haulMax}`);
  }

  // Emergency/urgency
  if (state.urgency === 'emergency') {
    multiplier *= mods.emergency.multiplier;
    drivers.push(`${mods.emergency.label} ×${mods.emergency.multiplier}`);
  }

  // Apply multiplier
  min = Math.round(min * multiplier);
  max = Math.round(max * multiplier);

  // --- Calculate confidence ---
  const missingCount = countMissingFactors(state);
  let confidence: 'high' | 'medium' | 'low';

  if (missingCount <= PRICING_CONFIG.confidence.high.missing_max) {
    confidence = 'high';
  } else if (missingCount <= PRICING_CONFIG.confidence.medium.missing_max) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Widen range based on confidence
  if (confidence === 'medium') {
    const variance = PRICING_CONFIG.confidence.medium.variance;
    min = Math.round(min * (1 - variance));
    max = Math.round(max * (1 + variance));
  } else if (confidence === 'low') {
    const variance = PRICING_CONFIG.confidence.low.variance;
    min = Math.round(min * (1 - variance));
    max = Math.round(max * (1 + variance));
  }

  // Build initial estimate
  const estimate: ExtendedEstimate = {
    min,
    max,
    confidence,
    drivers,
    needsSiteVisit: false,
    ownerMustConfirm: false,
    escalationReasons: [],
  };

  // Apply escalation rules
  return applyEscalationRules(state, estimate);
}

// ----------------------
// ESCALATION RULES
// ----------------------
function applyEscalationRules(
  state: SessionState,
  estimate: ExtendedEstimate
): ExtendedEstimate {
  const escalationReasons: string[] = [];
  let needsSiteVisit = false;
  let ownerMustConfirm = false;

  // Rule 1: Power lines = max medium confidence, needs site visit
  if (state.hazards.power_lines) {
    if (estimate.confidence === 'high') {
      estimate.confidence = 'medium';
    }
    needsSiteVisit = true;
    ownerMustConfirm = true;
    escalationReasons.push('Power lines present - site visit recommended');
  }

  // Rule 2: Narrow gate (< 4ft) = potential access issues
  if (state.access.gate_width_ft !== null && state.access.gate_width_ft < 4) {
    if (estimate.confidence === 'high') {
      estimate.confidence = 'medium';
    }
    if (state.access.gate_width_ft < 3) {
      estimate.confidence = 'low';
      needsSiteVisit = true;
      escalationReasons.push('Very narrow access - may require manual equipment');
    } else {
      escalationReasons.push('Narrow access may limit equipment options');
    }
  }

  // Rule 3: Steep slope = site visit advised
  if (state.access.slope === 'steep') {
    needsSiteVisit = true;
    escalationReasons.push('Steep/soft ground - site visit advised');
  }

  // Rule 4: Very tall trees (60ft+) = owner must confirm
  if (state.dimensions.height_ft && state.dimensions.height_ft >= 60) {
    ownerMustConfirm = true;
    if (estimate.confidence === 'high') {
      estimate.confidence = 'medium';
    }
    escalationReasons.push('Large tree (60ft+) requires owner review');
  }

  // Rule 5: High value estimate (> $2000) = owner must confirm
  if (estimate.max > 2000) {
    ownerMustConfirm = true;
    escalationReasons.push('High-value estimate requires owner review');
  }

  // Rule 6: Emergency + hazards = must confirm
  if (state.urgency === 'emergency' && (state.hazards.power_lines || state.hazards.structures_nearby)) {
    ownerMustConfirm = true;
    escalationReasons.push('Emergency with hazards - owner must confirm');
  }

  // Rule 7: Too many unknowns (> 3) = widen range further
  const unknownCount = countMissingFactors(state);
  if (unknownCount > 3) {
    estimate.min = Math.round(estimate.min * 0.8);
    estimate.max = Math.round(estimate.max * 1.2);
    estimate.confidence = 'low';
    escalationReasons.push('Multiple unknowns - wider estimate range');
  }

  // Apply escalation flags
  estimate.needsSiteVisit = needsSiteVisit;
  estimate.ownerMustConfirm = ownerMustConfirm;
  estimate.escalationReasons = escalationReasons;

  // Add escalation notes to drivers
  if (escalationReasons.length > 0) {
    estimate.drivers.push('See escalation notes');
  }

  return estimate;
}

// ----------------------
// HELPER: Count missing factors
// ----------------------
function countMissingFactors(state: SessionState): number {
  let missing = 0;

  if (state.dimensions.height_ft === null) missing++;
  if (state.dimensions.diameter_ft === null) missing++;
  if (state.hazards.power_lines === null) missing++;
  if (state.hazards.structures_nearby === null) missing++;
  if (state.access.slope === null) missing++;
  if (state.haul_away === null) missing++;

  return missing;
}

// ----------------------
// FORMAT ESTIMATE FOR DISPLAY
// ----------------------
export function formatEstimateText(estimate: Estimate | ExtendedEstimate): string {
  const range = `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()}`;
  const confidenceLabel = {
    high: 'High confidence',
    medium: 'Medium confidence',
    low: 'Rough estimate',
  }[estimate.confidence];

  let text = `${range} (${confidenceLabel})`;

  // Add escalation warning if present
  if ('needsSiteVisit' in estimate && estimate.needsSiteVisit) {
    text += ' - Site visit recommended';
  }

  return text;
}

// ----------------------
// NUDGE TEXT GENERATION
// ----------------------
export function generateNudgeText(
  estimate: ExtendedEstimate,
  ownerApproved: boolean
): string {
  if (ownerApproved) {
    return `Final estimate $${estimate.min}-$${estimate.max}. Reply YES to approve and schedule.`;
  } else {
    let nudge = `\n\nWant us to finalize this today? We'll text you once it's confirmed.`;
    nudge += `\n\nLicensed & insured - Serving Rock & Walworth County - Usually respond within 2 hours`;
    return nudge;
  }
}
