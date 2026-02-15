// backend/scripts/test-full-finalize.ts
// Test FULL finalize flow: Email + HubSpot

import "dotenv/config";
import { notifyOwnerEmail } from "../api/lib/notifications";
import { syncToHubSpot } from "../api/lib/hubspot";
import type { SessionState } from "../api/lib/session";

console.log("=".repeat(60));
console.log("Full Finalize Flow Test (Email + HubSpot)");
console.log("=".repeat(60));

// Check config
console.log("\nConfiguration:");
console.log(`  GMAIL_USER: ${process.env.GMAIL_USER ? "✓" : "❌"}`);
console.log(`  GMAIL_APP_PASSWORD: ${process.env.GMAIL_APP_PASSWORD ? "✓" : "❌"}`);
console.log(`  HUBSPOT_ACCESS_TOKEN: ${process.env.HUBSPOT_ACCESS_TOKEN ? "✓" : "❌"}`);
console.log(`  OWNER_EMAIL: ${process.env.OWNER_EMAIL || "shipithon@gmail.com"}`);

// Create mock session
const mockSession: SessionState = {
  lead_id: `full-test-${Date.now()}`,
  status: "awaiting_owner",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),

  service_type: "stump_grinding",
  tree_count: 3,
  dimensions: { height_ft: null, diameter_ft: 1.5 },
  access: { location: "front_yard", gate_width_ft: null, slope: "easy" },
  hazards: { power_lines: false, structures_nearby: true },
  haul_away: true,
  urgency: "normal",

  zip: "75002",
  contact: {
    name: "Full Test Customer",
    phone: "+15559876543",
    email: "fulltest@example.com",
  },

  photos: { urls: ["/uploads/test/stump1.jpg", "/uploads/test/stump2.jpg"], count: 2 },
  photos_uploaded: true,

  estimate: {
    min: 300,
    max: 500,
    confidence: "high",
    drivers: ["3 stumps", "Easy access", "Near structure"],
  },

  messages: [
    { role: "assistant", content: "Hi! What tree service do you need?" },
    { role: "user", content: "I have 3 stumps that need grinding" },
    { role: "assistant", content: "I can help with that. What's your ZIP?" },
    { role: "user", content: "75002" },
    { role: "assistant", content: "Are any stumps near structures or power lines?" },
    { role: "user", content: "One is near my shed but no power lines" },
  ],

  questions_asked: ["zip", "tree_count", "service_type", "structures"],
};

async function runTest() {
  console.log("\n" + "-".repeat(60));
  console.log("Test Data:");
  console.log(`  Session ID: ${mockSession.lead_id}`);
  console.log(`  Customer: ${mockSession.contact.name}`);
  console.log(`  Email: ${mockSession.contact.email}`);
  console.log(`  Service: ${mockSession.service_type}`);
  console.log(`  Estimate: $${mockSession.estimate?.min} - $${mockSession.estimate?.max}`);

  // Step 1: Send Email
  console.log("\n" + "-".repeat(60));
  console.log("Step 1: Sending Email to Owner...");
  console.log("-".repeat(60));

  const emailResult = await notifyOwnerEmail(mockSession);
  console.log(`\n  Email: ${emailResult ? "✓ SENT" : "❌ FAILED"}`);

  // Step 2: Sync to HubSpot
  console.log("\n" + "-".repeat(60));
  console.log("Step 2: Syncing to HubSpot...");
  console.log("-".repeat(60));

  const hubspotResult = await syncToHubSpot(mockSession);

  if (hubspotResult.success) {
    console.log(`\n  HubSpot: ✓ SYNCED`);
    console.log(`  Contact ID: ${hubspotResult.contactId}`);
    console.log(`  Deal ID: ${hubspotResult.dealId}`);
  } else {
    console.log(`\n  HubSpot: ❌ FAILED`);
    console.log(`  Error: ${hubspotResult.error}`);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`  Email sent:     ${emailResult ? "✓ YES" : "❌ NO"}`);
  console.log(`  HubSpot synced: ${hubspotResult.success ? "✓ YES" : "❌ NO"}`);

  if (hubspotResult.success) {
    console.log(`\n  → Check HubSpot Deals: https://app.hubspot.com/contacts/deals`);
    console.log(`  → Look for: "Stump Grinding - 75002 - Full Test Customer"`);
  }

  console.log(`\n  → Check Email: ${process.env.OWNER_EMAIL || "shipithon@gmail.com"}`);
  console.log("=".repeat(60));

  // Return IDs for cleanup
  return hubspotResult;
}

runTest().then(result => {
  if (result.success) {
    console.log(`\nTo clean up, delete:`);
    console.log(`  Contact: ${result.contactId}`);
    console.log(`  Deal: ${result.dealId}`);
  }
}).catch(console.error);
