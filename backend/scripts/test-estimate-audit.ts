// backend/scripts/test-estimate-audit.ts
// Test estimate audit trail: Initial → Owner Adjusted → Customer Approved

import "dotenv/config";
import { syncToHubSpot, updateDealEstimate, markEstimateApproved, markDealWon } from "../api/lib/hubspot";
import type { SessionState } from "../api/lib/session";

console.log("=".repeat(70));
console.log("ESTIMATE AUDIT TRAIL TEST");
console.log("Initial → Owner Adjusted → Customer Approved → Won");
console.log("=".repeat(70));

// Session with initial chatbot estimate
const session: SessionState = {
  lead_id: `audit-test-${Date.now()}`,
  status: "awaiting_owner",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),

  service_type: "tree_removal",
  tree_count: 1,
  dimensions: { height_ft: 60, diameter_ft: 3 },
  access: { location: "front_yard", gate_width_ft: null, slope: "easy" },
  hazards: { power_lines: true, structures_nearby: false },
  haul_away: true,
  urgency: "normal",

  zip: "75203",
  contact: {
    name: "Audit Test Customer",
    phone: "+15559991234",
    email: "audit.test@example.com",
    address: "456 Elm Avenue",
    city: "Dallas",
  },

  photos: { urls: ["/uploads/test/tree.jpg"], count: 1 },
  photos_uploaded: true,

  // Initial chatbot estimate (will be adjusted)
  estimate: {
    min: 1200,
    max: 1800,
    confidence: "medium",  // Maps to "needs_review" in HubSpot
    drivers: ["Large tree (60ft)", "Power lines nearby", "Haul away included"],
  },

  messages: [
    { role: "assistant", content: "What tree service do you need?" },
    { role: "user", content: "Remove a large oak near power lines" },
    { role: "assistant", content: "I estimate $1,200 - $1,800 for this job." },
  ],

  questions_asked: ["service_type", "tree_count", "power_lines", "contact_name"],
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log("\n📋 INITIAL SESSION");
  console.log("-".repeat(70));
  console.log(`Customer: ${session.contact.name}`);
  console.log(`Service: ${session.service_type}`);
  console.log(`Initial Estimate: $${session.estimate?.min} - $${session.estimate?.max}`);
  console.log(`Confidence: ${session.estimate?.confidence} → "needs_review" in HubSpot`);

  // STEP 1: Create initial deal
  console.log("\n" + "=".repeat(70));
  console.log("STEP 1: Create Deal with Initial Chatbot Estimate");
  console.log("=".repeat(70));

  const result = await syncToHubSpot(session);

  if (!result.success || !result.dealId) {
    console.error("❌ Failed to create deal:", result.error);
    return;
  }

  console.log(`\n✅ Deal created: ${result.dealId}`);
  console.log(`   Contact: ${result.contactId}`);
  console.log("\n   HubSpot should show:");
  console.log("   • initial_estimate_min: 1200");
  console.log("   • initial_estimate_max: 1800");
  console.log("   • final_estimate_min: 1200");
  console.log("   • final_estimate_max: 1800");
  console.log("   • estimate_status: chatbot_generated");
  console.log("   • chatbot_confidence: needs_review");

  await sleep(1000);

  // STEP 2: Owner adjusts estimate
  console.log("\n" + "=".repeat(70));
  console.log("STEP 2: Owner Adjusts Estimate");
  console.log("=".repeat(70));

  const newMin = 1500;
  const newMax = 2000;
  const reason = "Added crane rental for power line clearance - requires certified lineman";

  console.log(`\n   Adjusting: $1,200-$1,800 → $${newMin}-$${newMax}`);
  console.log(`   Reason: ${reason}`);

  const adjustResult = await updateDealEstimate(result.dealId, newMin, newMax, reason);

  if (adjustResult) {
    console.log("\n✅ Estimate adjusted");
    console.log("\n   HubSpot should now show:");
    console.log("   • initial_estimate_min: 1200 (unchanged)");
    console.log("   • initial_estimate_max: 1800 (unchanged)");
    console.log(`   • final_estimate_min: ${newMin} (UPDATED)`);
    console.log(`   • final_estimate_max: ${newMax} (UPDATED)`);
    console.log("   • estimate_status: owner_adjusted (UPDATED)");
    console.log(`   • estimate_adjustment_reason: "${reason}" (UPDATED)`);
    console.log(`   • amount: ${Math.round((newMin + newMax) / 2)} (UPDATED)`);
  } else {
    console.log("❌ Failed to adjust estimate");
  }

  await sleep(1000);

  // STEP 3: Customer approves
  console.log("\n" + "=".repeat(70));
  console.log("STEP 3: Customer Approves Estimate");
  console.log("=".repeat(70));

  const approveResult = await markEstimateApproved(result.dealId);

  if (approveResult) {
    console.log("\n✅ Estimate approved by customer");
    console.log("\n   HubSpot should now show:");
    console.log("   • estimate_status: customer_approved (UPDATED)");
    console.log("   • dealstage: qualifiedtobuy (UPDATED)");
  } else {
    console.log("❌ Failed to mark as approved");
  }

  await sleep(1000);

  // STEP 4: Job completed - mark as won
  console.log("\n" + "=".repeat(70));
  console.log("STEP 4: Job Completed - Mark as Won");
  console.log("=".repeat(70));

  const actualAmount = 1750;
  const wonResult = await markDealWon(result.dealId, actualAmount);

  if (wonResult) {
    console.log(`\n✅ Deal marked as WON with actual amount: $${actualAmount}`);
    console.log("\n   HubSpot should now show:");
    console.log("   • dealstage: closedwon (UPDATED)");
    console.log(`   • amount: ${actualAmount} (UPDATED to actual)`);
  } else {
    console.log("❌ Failed to mark as won");
  }

  // FINAL SUMMARY
  console.log("\n" + "=".repeat(70));
  console.log("📊 AUDIT TRAIL SUMMARY");
  console.log("=".repeat(70));
  console.log(`
  Stage                    | Min    | Max    | Amount | Status
  -------------------------|--------|--------|--------|------------------
  1. Chatbot Generated     | $1,200 | $1,800 | $1,500 | chatbot_generated
  2. Owner Adjusted        | $1,500 | $2,000 | $1,750 | owner_adjusted
  3. Customer Approved     | $1,500 | $2,000 | $1,750 | customer_approved
  4. Job Completed (Won)   | $1,500 | $2,000 | $1,750 | closedwon
  `);

  console.log("🔗 VERIFY IN HUBSPOT:");
  console.log("   https://app.hubspot.com/contacts/deals");
  console.log(`   Deal: "Tree Removal - 75203 - Audit Test Customer"`);
  console.log(`   Deal ID: ${result.dealId}`);

  console.log("\n📋 Check these custom properties:");
  console.log("   • initial_estimate_min: 1200");
  console.log("   • initial_estimate_max: 1800");
  console.log("   • final_estimate_min: 1500");
  console.log("   • final_estimate_max: 2000");
  console.log("   • estimate_status: customer_approved");
  console.log("   • estimate_adjustment_reason: (should have the reason)");
  console.log("   • chatbot_confidence: needs_review");
  console.log("   • dealstage: closedwon");
  console.log("   • amount: 1750");

  console.log("\n" + "=".repeat(70));

  return result;
}

runTest().then(result => {
  if (result?.success) {
    console.log(`\n🧹 To clean up, delete:`);
    console.log(`   Contact: ${result.contactId}`);
    console.log(`   Deal: ${result.dealId}\n`);
  }
}).catch(console.error);
