// backend/scripts/test-hubspot.ts
// Test HubSpot integration locally

import "dotenv/config";
import { syncToHubSpot, markDealWon, markDealLost } from "../api/lib/hubspot";
import type { SessionState } from "../api/lib/session";

// Create a mock session for testing
const mockSession: SessionState = {
  lead_id: `test-${Date.now()}`,
  status: "awaiting_owner",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),

  service_type: "tree_removal",
  tree_count: 2,
  dimensions: { height_ft: 45, diameter_ft: 2 },
  access: { location: "backyard", gate_width_ft: 8, slope: "moderate" },
  hazards: { power_lines: true, structures_nearby: false },
  haul_away: true,
  urgency: "normal",

  zip: "75001",
  contact: {
    name: "Test Customer",
    phone: "+15551234567",
    email: "test@example.com",
  },

  photos: { urls: ["/uploads/test/photo1.jpg", "/uploads/test/photo2.jpg"], count: 2 },
  photos_uploaded: true,

  estimate: {
    min: 800,
    max: 1200,
    confidence: "medium",
    drivers: ["2 trees", "Backyard access", "Power lines nearby"],
  },

  messages: [
    { role: "assistant", content: "Hi! I'm the Big D's Tree Service assistant. What can I help you with today?" },
    { role: "user", content: "I need two trees removed from my backyard" },
    { role: "assistant", content: "I can help with that! What's your ZIP code?" },
    { role: "user", content: "75001" },
    { role: "assistant", content: "Great, we serve that area. Are there any power lines near the trees?" },
    { role: "user", content: "Yes, one tree is close to power lines" },
    { role: "assistant", content: "Thanks for letting me know. Can I get your name and phone number for the estimate?" },
    { role: "user", content: "Test Customer, 555-123-4567" },
  ],

  questions_asked: ["zip", "tree_count", "power_lines", "contact_name", "contact_phone"],
};

async function runTest() {
  console.log("=".repeat(60));
  console.log("HubSpot Integration Test");
  console.log("=".repeat(60));

  // Check if token is configured
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    console.error("\n❌ HUBSPOT_ACCESS_TOKEN not found in environment");
    console.log("Add it to your .env file and try again\n");
    process.exit(1);
  }

  console.log("\n✓ HUBSPOT_ACCESS_TOKEN found");
  console.log(`\nTest session ID: ${mockSession.lead_id}`);
  console.log(`Customer: ${mockSession.contact.name} (${mockSession.contact.email})`);
  console.log(`Service: ${mockSession.service_type}`);
  console.log(`Estimate: $${mockSession.estimate?.min} - $${mockSession.estimate?.max}`);

  console.log("\n--- Syncing to HubSpot ---\n");

  try {
    const result = await syncToHubSpot(mockSession);

    if (result.success) {
      console.log("\n✓ Sync successful!");
      console.log(`  Contact ID: ${result.contactId}`);
      console.log(`  Deal ID: ${result.dealId}`);

      // Test marking as won
      console.log("\n--- Testing markDealWon ---\n");
      if (result.dealId) {
        const wonResult = await markDealWon(result.dealId, 950);
        console.log(`  Mark as won: ${wonResult ? "✓ Success" : "❌ Failed"}`);

        // Optionally test mark as lost (commented out to not override won status)
        // console.log("\n--- Testing markDealLost ---\n");
        // const lostResult = await markDealLost(result.dealId, "Test - price too high");
        // console.log(`  Mark as lost: ${lostResult ? "✓ Success" : "❌ Failed"}`);
      }

      console.log("\n" + "=".repeat(60));
      console.log("Test completed successfully!");
      console.log("=".repeat(60));
      console.log("\nCheck HubSpot to verify:");
      console.log("  1. Contact created with name, email, phone, ZIP");
      console.log("  2. Deal created with estimate amount and description");
      console.log("  3. Note added with conversation transcript");
      console.log("  4. Deal marked as 'Closed Won' with actual amount $950");
      console.log("\nHubSpot Contacts: https://app.hubspot.com/contacts");
      console.log("HubSpot Deals: https://app.hubspot.com/contacts/deals\n");

    } else {
      console.error("\n❌ Sync failed:", result.error);
      process.exit(1);
    }

  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

runTest();
