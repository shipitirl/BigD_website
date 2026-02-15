// ============================================================
// Test Script - Verify Lead schema migration
// ============================================================

import { createLead, getMissingLeadFields, Lead, LEAD_SCHEMA_VERSION } from '../api/lib/lead';
import { upgradeSessionToLead, isLeadSchema, isSessionStateSchema, ensureLeadSchema } from '../api/lib/lead-migration';
import type { SessionState } from '../api/lib/session';

// Mock old SessionState (the format before migration)
const mockOldSession: SessionState = {
  lead_id: 'test-session-123',
  status: 'collecting',
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-22T14:00:00Z',
  
  service_type: 'tree_removal',
  tree_count: 2,
  dimensions: { height_ft: 35, diameter_ft: 2 },
  access: { location: 'backyard', gate_width_ft: 4, slope: 'moderate' },
  hazards: { power_lines: true, structures_nearby: false },
  haul_away: true,
  urgency: 'normal',
  
  zip: '53511',
  contact: { name: 'John Doe', phone: '6085551234', email: 'john@example.com' },
  
  photos: { urls: ['/uploads/photo1.jpg', '/uploads/photo2.jpg'], count: 2 },
  photos_uploaded: true,
  
  estimate: null,
  messages: [
    { role: 'user', content: 'I need some trees removed' },
    { role: 'assistant', content: 'I can help with that!' },
  ],
  questions_asked: ['zip', 'tree_count', 'haul_debris'],
};

// ----------------------
// TESTS
// ----------------------
console.log('=== Lead Schema Migration Tests ===\n');

// Test 1: Schema detection
console.log('Test 1: Schema detection');
const newLead = createLead();
console.log(`  isLeadSchema(newLead): ${isLeadSchema(newLead)} (expected: true)`);
console.log(`  isSessionStateSchema(oldSession): ${isSessionStateSchema(mockOldSession)} (expected: true)`);
console.log(`  isLeadSchema(oldSession): ${isLeadSchema(mockOldSession)} (expected: false)`);
console.log('');

// Test 2: Upgrade old session
console.log('Test 2: Upgrade old SessionState to Lead');
const upgradedLead = upgradeSessionToLead(mockOldSession);
console.log(`  version: ${upgradedLead.version} (expected: ${LEAD_SCHEMA_VERSION})`);
console.log(`  session_id: ${upgradedLead.session_id} (expected: test-session-123)`);
console.log(`  customer.zip: ${upgradedLead.customer.zip} (expected: 53511)`);
console.log(`  customer.name: ${upgradedLead.customer.name} (expected: John Doe)`);
console.log(`  job.service_type: ${upgradedLead.job.service_type} (expected: tree_removal)`);
console.log(`  job.dimensions.quantity: ${upgradedLead.job.dimensions.quantity} (expected: 2)`);
console.log(`  job.access.backyard: ${upgradedLead.job.access.backyard} (expected: true)`);
console.log(`  job.hazards.power_lines: ${upgradedLead.job.hazards.power_lines} (expected: true)`);
console.log(`  job.disposal.haul_away_needed: ${upgradedLead.job.disposal.haul_away_needed} (expected: true)`);
console.log(`  job.photos.files.length: ${upgradedLead.job.photos.files.length} (expected: 2)`);
console.log(`  messages.length: ${upgradedLead.messages.length} (expected: 2)`);
console.log(`  questions_asked: ${JSON.stringify(upgradedLead.questions_asked)}`);
console.log(`  internal.missing_fields: ${JSON.stringify(upgradedLead.internal.missing_fields)}`);
console.log('');

// Test 3: ensureLeadSchema auto-detection
console.log('Test 3: ensureLeadSchema auto-detects and upgrades');
const fromOld = ensureLeadSchema(mockOldSession);
const fromNew = ensureLeadSchema(newLead);
console.log(`  ensureLeadSchema(oldSession)?.version: ${fromOld?.version} (expected: ${LEAD_SCHEMA_VERSION})`);
console.log(`  ensureLeadSchema(newLead)?.version: ${fromNew?.version} (expected: ${LEAD_SCHEMA_VERSION})`);
console.log('');

// Test 4: Missing fields detection
console.log('Test 4: getMissingLeadFields');
const incompleteLead = createLead();
const missingFields = getMissingLeadFields(incompleteLead);
console.log(`  Missing fields for empty lead: ${JSON.stringify(missingFields)}`);
console.log(`  Expected to include: customer.zip, customer.name, job.service_type, job.photos`);
console.log('');

// Test 5: Verify upgraded lead has correct structure
console.log('Test 5: Verify upgraded lead structure');
const hasAllKeys = [
  'version', 'session_id', 'customer', 'job', 'quote',
  'next_questions', 'internal', 'messages', 'questions_asked',
  'created_at', 'updated_at'
].every(key => key in upgradedLead);
console.log(`  Has all required top-level keys: ${hasAllKeys} (expected: true)`);
console.log('');

console.log('=== All tests completed ===');
