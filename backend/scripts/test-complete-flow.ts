// backend/scripts/test-complete-flow.ts
// Complete test with FULL conversation, ALL contact fields, and real photo

import "dotenv/config";
import { notifyOwnerEmail } from "../api/lib/notifications";
import { syncToHubSpot } from "../api/lib/hubspot";
import type { SessionState } from "../api/lib/session";

const APP_URL = process.env.APP_URL || "http://localhost:3001";

console.log("=".repeat(70));
console.log("COMPLETE FLOW TEST");
console.log("Full Conversation + All Contact Fields + Photo + Email + HubSpot");
console.log("=".repeat(70));

// Real photo from uploads
const REAL_PHOTO_URL = "/uploads/de67879f-d236-4dd4-b9f3-48518344ae0f/446d16fb-e376-4245-9b19-472f57ab8c98.png";

// Complete session with ALL fields and FULL conversation
const completeSession: SessionState = {
  lead_id: `complete-test-${Date.now()}`,
  status: "awaiting_owner",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),

  // Job Details - ALL FIELDS
  service_type: "tree_removal",
  tree_count: 2,
  dimensions: {
    height_ft: 50,
    diameter_ft: 2.5
  },
  access: {
    location: "backyard",
    gate_width_ft: 10,
    slope: "moderate"
  },
  hazards: {
    power_lines: true,
    structures_nearby: true
  },
  haul_away: true,
  urgency: "urgent",

  // Customer Info - ALL FIELDS
  zip: "75201",
  contact: {
    name: "John Smith",
    phone: "+12625551234",
    email: "john.smith@example.com",
    address: "123 Oak Street",
    city: "Dallas",
  },

  // Photo - Real uploaded photo
  photos: {
    urls: [REAL_PHOTO_URL],
    count: 1
  },
  photos_uploaded: true,

  // Estimate with drivers
  estimate: {
    min: 1500,
    max: 2500,
    confidence: "medium",
    drivers: [
      "2 large trees (50ft)",
      "Backyard access through 10ft gate",
      "Moderate slope",
      "Power lines nearby - requires extra care",
      "Near structures - precision removal needed",
      "Haul away included",
      "Urgent timeline"
    ],
  },

  // FULL Conversation - All questions asked
  messages: [
    {
      role: "assistant",
      content: "Hi! I'm the Big D's Tree Service assistant. I can help you get a quick estimate. What tree service do you need today?"
    },
    {
      role: "user",
      content: "I have two large oak trees in my backyard that need to be removed"
    },
    {
      role: "assistant",
      content: "I can definitely help with tree removal! To give you an accurate estimate, I'll need to ask a few questions. First, what's your ZIP code?"
    },
    {
      role: "user",
      content: "75201"
    },
    {
      role: "assistant",
      content: "Great, we serve the Dallas 75201 area! How many trees need to be removed?"
    },
    {
      role: "user",
      content: "2 trees"
    },
    {
      role: "assistant",
      content: "Got it - 2 trees. Do you have an estimate of how tall they are?"
    },
    {
      role: "user",
      content: "About 50 feet tall, pretty big trunks maybe 2-3 feet across"
    },
    {
      role: "assistant",
      content: "Those are substantial trees! Are they in the front yard or backyard?"
    },
    {
      role: "user",
      content: "Backyard"
    },
    {
      role: "assistant",
      content: "For backyard access, what's the width of your gate? This helps us know what equipment we can bring in."
    },
    {
      role: "user",
      content: "The gate is about 10 feet wide"
    },
    {
      role: "assistant",
      content: "Perfect, that's wide enough for our equipment. How would you describe the slope of your yard - flat, moderate, or steep?"
    },
    {
      role: "user",
      content: "It's got a moderate slope"
    },
    {
      role: "assistant",
      content: "Thanks. Are there any power lines near the trees?"
    },
    {
      role: "user",
      content: "Yes, there are power lines running near one of them"
    },
    {
      role: "assistant",
      content: "Good to know - we'll need to take extra precautions. Are the trees near any structures like your house, shed, or fence?"
    },
    {
      role: "user",
      content: "Yes, one is pretty close to my shed"
    },
    {
      role: "assistant",
      content: "We'll plan for precision removal. Would you like us to haul away all the debris, or do you want to keep the wood?"
    },
    {
      role: "user",
      content: "Please haul everything away"
    },
    {
      role: "assistant",
      content: "No problem! How soon do you need this done?"
    },
    {
      role: "user",
      content: "As soon as possible, one of the trees is leaning and I'm worried about it"
    },
    {
      role: "assistant",
      content: "I understand the urgency. Let me get your contact information so we can reach out. What's your name?"
    },
    {
      role: "user",
      content: "John Smith"
    },
    {
      role: "assistant",
      content: "Thanks John! What's the best phone number to reach you?"
    },
    {
      role: "user",
      content: "262-555-1234"
    },
    {
      role: "assistant",
      content: "Got it. And your email address?"
    },
    {
      role: "user",
      content: "john.smith@example.com"
    },
    {
      role: "assistant",
      content: "What's your street address for the job site?"
    },
    {
      role: "user",
      content: "123 Oak Street"
    },
    {
      role: "assistant",
      content: "And what city is that in?"
    },
    {
      role: "user",
      content: "Dallas"
    },
    {
      role: "assistant",
      content: "Perfect! One last thing - could you upload a photo of the trees? This really helps us give you the most accurate estimate."
    },
    {
      role: "user",
      content: "[Photo uploaded]"
    },
    {
      role: "assistant",
      content: "Thanks for the photo! Based on everything you've told me, here's your estimate:\n\n**$1,500 - $2,500** for removing 2 large oak trees (~50ft) with haul-away.\n\nPrice factors:\n• Backyard access with moderate slope\n• Power lines nearby (requires extra care)\n• Near structures (precision removal)\n• Urgent timeline\n\nCorey from Big D's Tree Service will review this and reach out to you shortly!"
    },
  ],

  // All questions tracked
  questions_asked: [
    "zip",
    "tree_count",
    "height",
    "diameter",
    "access_location",
    "gate_width",
    "slope",
    "power_lines",
    "structures",
    "haul_debris",
    "urgency",
    "contact_name",
    "contact_phone",
    "contact_email",
    "contact_address",
    "contact_city",
    "photos"
  ],
};

async function runTest() {
  console.log("\n📋 SESSION SUMMARY");
  console.log("-".repeat(70));
  console.log(`Session ID:    ${completeSession.lead_id}`);
  console.log(`Service:       ${completeSession.service_type} (${completeSession.tree_count} trees)`);
  console.log(`Dimensions:    ${completeSession.dimensions.height_ft}ft tall, ${completeSession.dimensions.diameter_ft}ft diameter`);
  console.log(`Access:        ${completeSession.access.location}, ${completeSession.access.gate_width_ft}ft gate, ${completeSession.access.slope} slope`);
  console.log(`Hazards:       Power lines: ${completeSession.hazards.power_lines ? "YES" : "No"}, Near structures: ${completeSession.hazards.structures_nearby ? "YES" : "No"}`);
  console.log(`Haul away:     ${completeSession.haul_away ? "Yes" : "No"}`);
  console.log(`Urgency:       ${completeSession.urgency}`);
  console.log("");
  console.log(`Customer:      ${completeSession.contact.name}`);
  console.log(`Phone:         ${completeSession.contact.phone}`);
  console.log(`Email:         ${completeSession.contact.email}`);
  console.log(`Address:       ${completeSession.contact.address}`);
  console.log(`City/ZIP:      ${completeSession.contact.city}, ${completeSession.zip}`);
  console.log("");
  console.log(`Photos:        ${completeSession.photos.count} uploaded`);
  console.log(`Estimate:      $${completeSession.estimate?.min} - $${completeSession.estimate?.max}`);
  console.log(`Confidence:    ${completeSession.estimate?.confidence}`);
  console.log(`Messages:      ${completeSession.messages.length} (full conversation)`);

  // Step 1: Send Email
  console.log("\n" + "=".repeat(70));
  console.log("📧 STEP 1: Sending Email to Owner");
  console.log("=".repeat(70));

  const emailResult = await notifyOwnerEmail(completeSession);
  console.log(`\n  Result: ${emailResult ? "✅ EMAIL SENT" : "❌ EMAIL FAILED"}`);

  // Step 2: Sync to HubSpot
  console.log("\n" + "=".repeat(70));
  console.log("🔄 STEP 2: Syncing to HubSpot CRM");
  console.log("=".repeat(70));

  const hubspotResult = await syncToHubSpot(completeSession);

  if (hubspotResult.success) {
    console.log(`\n  Result: ✅ HUBSPOT SYNCED`);
    console.log(`  Contact ID: ${hubspotResult.contactId}`);
    console.log(`  Deal ID: ${hubspotResult.dealId}`);
  } else {
    console.log(`\n  Result: ❌ HUBSPOT FAILED`);
    console.log(`  Error: ${hubspotResult.error}`);
  }

  // Final Summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 FINAL RESULTS");
  console.log("=".repeat(70));
  console.log(`\n  Email sent:       ${emailResult ? "✅ YES" : "❌ NO"}`);
  console.log(`  HubSpot synced:   ${hubspotResult.success ? "✅ YES" : "❌ NO"}`);

  console.log("\n📬 CHECK YOUR INBOX:");
  console.log(`   ${process.env.OWNER_EMAIL || "shipithon@gmail.com"}`);
  console.log("   Subject: 🌳 New Estimate: Tree Removal — 75201 — $1,500 - $2,500");

  console.log("\n🔗 CHECK HUBSPOT:");
  console.log("   https://app.hubspot.com/contacts/deals");
  console.log("   Look for: \"Tree Removal - 75201 - John Smith\"");

  console.log("\n📋 VERIFY IN HUBSPOT:");
  console.log("   • Contact: John Smith");
  console.log("   • Phone: +12625551234");
  console.log("   • Email: john.smith@example.com");
  console.log("   • Address: 123 Oak Street");
  console.log("   • City: Dallas");
  console.log("   • ZIP: 75201");
  console.log("   • Deal amount: $2,000 (midpoint)");
  console.log("   • Note with full conversation (33 messages)");

  console.log("\n" + "=".repeat(70));

  // Return for cleanup
  return hubspotResult;
}

runTest().then(result => {
  if (result.success) {
    console.log(`\n🧹 To clean up test data, run:`);
    console.log(`   Contact ID: ${result.contactId}`);
    console.log(`   Deal ID: ${result.dealId}\n`);
  }
}).catch(console.error);
