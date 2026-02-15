// backend/scripts/test-interactive-deal.ts
// Create a deal you can interact with in HubSpot - does NOT auto-complete

import "dotenv/config";
import { notifyOwnerEmail } from "../api/lib/notifications";
import { syncToHubSpot } from "../api/lib/hubspot";
import type { SessionState } from "../api/lib/session";

console.log("=".repeat(70));
console.log("INTERACTIVE DEAL TEST");
console.log("Creates a deal you can view and adjust in HubSpot");
console.log("=".repeat(70));

// Realistic chat session - customer wants stump grinding
const session: SessionState = {
  lead_id: `interactive-${Date.now()}`,
  status: "awaiting_owner",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),

  service_type: "stump_grinding",
  tree_count: 4,
  dimensions: { height_ft: null, diameter_ft: 1.5 },
  access: { location: "backyard", gate_width_ft: 6, slope: "moderate" },
  hazards: { power_lines: false, structures_nearby: true },
  haul_away: true,
  urgency: "normal",

  zip: "75204",
  contact: {
    name: "Sarah Johnson",
    phone: "+12145559876",
    email: "sarah.johnson@email.com",
    address: "789 Maple Drive",
    city: "Dallas",
  },

  photos: { urls: ["/uploads/test/stump1.jpg", "/uploads/test/stump2.jpg"], count: 2 },
  photos_uploaded: true,

  estimate: {
    min: 400,
    max: 700,
    confidence: "medium",
    drivers: [
      "4 stumps",
      "Average 18\" diameter",
      "Backyard access - 6ft gate (tight)",
      "Moderate slope",
      "Near fence/structure",
      "Debris haul-away included"
    ],
  },

  messages: [
    { role: "assistant", content: "Hi! I'm the Big D's Tree Service assistant. What can I help you with today?" },
    { role: "user", content: "Hi, I need to get some stumps ground down" },
    { role: "assistant", content: "I can help with stump grinding! How many stumps do you need removed?" },
    { role: "user", content: "4 stumps from trees we had cut down last year" },
    { role: "assistant", content: "Got it - 4 stumps. About how wide are they? A rough estimate is fine." },
    { role: "user", content: "I'd say they're about a foot and a half across, maybe 18 inches" },
    { role: "assistant", content: "Thanks! What's your ZIP code so I can confirm we service your area?" },
    { role: "user", content: "75204" },
    { role: "assistant", content: "Great, we serve Dallas 75204! Are the stumps in the front yard or backyard?" },
    { role: "user", content: "They're all in the backyard" },
    { role: "assistant", content: "For backyard work, we need to bring equipment through. How wide is your gate?" },
    { role: "user", content: "It's about 6 feet wide I think" },
    { role: "assistant", content: "That's a bit tight but we can work with it. How's the slope of your yard?" },
    { role: "user", content: "There's a moderate slope towards the back" },
    { role: "assistant", content: "Good to know. Are any of the stumps near structures like fences, the house, or a shed?" },
    { role: "user", content: "Yeah, two of them are pretty close to the back fence" },
    { role: "assistant", content: "We'll be careful with those. Are there any power lines running over where the stumps are?" },
    { role: "user", content: "No, no power lines back there" },
    { role: "assistant", content: "Perfect. Would you like us to haul away all the wood chips and debris?" },
    { role: "user", content: "Yes please, I don't need any of it" },
    { role: "assistant", content: "No problem! Now let me get your contact info. What's your name?" },
    { role: "user", content: "Sarah Johnson" },
    { role: "assistant", content: "Thanks Sarah! Best phone number to reach you?" },
    { role: "user", content: "214-555-9876" },
    { role: "assistant", content: "And your email?" },
    { role: "user", content: "sarah.johnson@email.com" },
    { role: "assistant", content: "What's the street address for the job?" },
    { role: "user", content: "789 Maple Drive" },
    { role: "assistant", content: "And the city?" },
    { role: "user", content: "Dallas" },
    { role: "assistant", content: "Could you upload a couple photos of the stumps? It helps us give you the most accurate estimate." },
    { role: "user", content: "[Uploaded 2 photos]" },
    { role: "assistant", content: "Thanks for the photos Sarah! Based on everything you've told me:\n\n**Estimate: $400 - $700** for grinding 4 stumps (~18\" diameter) with debris removal.\n\nFactors affecting price:\n• Backyard access through 6ft gate (tight fit for equipment)\n• Moderate slope\n• 2 stumps near fence (requires extra care)\n• Full cleanup included\n\nCorey from Big D's will review this and reach out to confirm. Is there anything else you'd like to add?" },
    { role: "user", content: "That sounds good, thank you!" },
    { role: "assistant", content: "You're welcome! Corey will be in touch soon. Have a great day!" },
  ],

  questions_asked: [
    "service_type", "tree_count", "diameter", "zip", "access_location",
    "gate_width", "slope", "structures", "power_lines", "haul_debris",
    "contact_name", "contact_phone", "contact_email", "contact_address",
    "contact_city", "photos"
  ],
};

async function runTest() {
  console.log("\n📋 LEAD SUMMARY");
  console.log("-".repeat(70));
  console.log(`Service:       ${session.service_type} (${session.tree_count} stumps)`);
  console.log(`Estimate:      $${session.estimate?.min} - $${session.estimate?.max}`);
  console.log(`Confidence:    ${session.estimate?.confidence}`);
  console.log("");
  console.log(`Customer:      ${session.contact.name}`);
  console.log(`Phone:         ${session.contact.phone}`);
  console.log(`Email:         ${session.contact.email}`);
  console.log(`Address:       ${session.contact.address}, ${session.contact.city} ${session.zip}`);
  console.log("");
  console.log(`Conversation:  ${session.messages.length} messages`);
  console.log(`Photos:        ${session.photos.count} uploaded`);

  // Send email notification
  console.log("\n" + "=".repeat(70));
  console.log("📧 Sending Email to Owner...");
  console.log("=".repeat(70));

  const emailSent = await notifyOwnerEmail(session);
  console.log(`Result: ${emailSent ? "✅ Email sent" : "❌ Email failed"}`);

  // Sync to HubSpot
  console.log("\n" + "=".repeat(70));
  console.log("🔄 Creating HubSpot Deal...");
  console.log("=".repeat(70));

  const result = await syncToHubSpot(session);

  if (!result.success) {
    console.error("❌ Failed:", result.error);
    return;
  }

  console.log(`\n✅ Deal created successfully!`);
  console.log(`   Deal ID: ${result.dealId}`);
  console.log(`   Contact ID: ${result.contactId}`);

  // Instructions for the user
  console.log("\n" + "=".repeat(70));
  console.log("🎯 NOW GO TO HUBSPOT AND TRY THESE:");
  console.log("=".repeat(70));

  console.log(`
1. OPEN THE DEAL:
   https://app.hubspot.com/contacts/deals
   Look for: "Stump Grinding - 75204 - Sarah Johnson"

2. VIEW THE DEAL DETAILS:
   • Amount: $550 (midpoint of $400-$700)
   • Stage: Appointment Scheduled
   • Description: Full job details
   • Associated Contact: Sarah Johnson

3. READ THE NOTE:
   • Click on the deal
   • Look for the note with the full conversation transcript

4. TRY ADJUSTING THE AMOUNT:
   • Edit the deal
   • Change amount from $550 to $600 (you priced it higher)
   • Save and see how it updates

5. MOVE THROUGH STAGES:
   • Appointment Scheduled → Qualified to Buy → Contract Sent → etc.

6. OR USE THE API TO ADJUST:

   # Adjust estimate via API:
   curl -X POST http://localhost:3001/api/admin/deals \\
     -H "Content-Type: application/json" \\
     -d '{
       "sessionId": "${session.lead_id}",
       "action": "adjust",
       "adjustedMin": 500,
       "adjustedMax": 750,
       "adjustmentReason": "Stumps larger than expected from photos"
     }'

   # Mark as won when job completes:
   curl -X POST http://localhost:3001/api/admin/deals \\
     -H "Content-Type: application/json" \\
     -d '{
       "sessionId": "${session.lead_id}",
       "action": "won",
       "actualAmount": 625
     }'
`);

  console.log("=".repeat(70));
  console.log(`Session ID: ${session.lead_id}`);
  console.log(`Deal ID: ${result.dealId}`);
  console.log(`Contact ID: ${result.contactId}`);
  console.log("=".repeat(70));
}

runTest().catch(console.error);
