// backend/scripts/test-email.ts
// Test email notification locally

import "dotenv/config";
import { notifyOwnerEmail } from "../api/lib/notifications";
import type { SessionState } from "../api/lib/session";

// Check env vars
console.log("=".repeat(60));
console.log("Email Configuration Check");
console.log("=".repeat(60));
console.log(`GMAIL_USER: ${process.env.GMAIL_USER ? "✓ Set" : "❌ NOT SET"}`);
console.log(`GMAIL_APP_PASSWORD: ${process.env.GMAIL_APP_PASSWORD ? "✓ Set (" + process.env.GMAIL_APP_PASSWORD.slice(0, 4) + "...)" : "❌ NOT SET"}`);
console.log(`OWNER_EMAIL: ${process.env.OWNER_EMAIL || "(using default)"}`);

// Create a mock session for testing
const mockSession: SessionState = {
  lead_id: `email-test-${Date.now()}`,
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
    name: "Email Test Customer",
    phone: "+15551234567",
    email: "test@example.com",
  },

  photos: { urls: ["/uploads/test/photo1.jpg"], count: 1 },
  photos_uploaded: true,

  estimate: {
    min: 800,
    max: 1200,
    confidence: "medium",
    drivers: ["2 trees", "Backyard access", "Power lines nearby"],
  },

  messages: [
    { role: "assistant", content: "Hi! What can I help you with today?" },
    { role: "user", content: "I need two trees removed" },
    { role: "assistant", content: "What's your ZIP code?" },
    { role: "user", content: "75001" },
  ],

  questions_asked: ["zip", "tree_count"],
};

async function runTest() {
  console.log("\n" + "=".repeat(60));
  console.log("Sending Test Email");
  console.log("=".repeat(60));

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log("\n⚠️  Gmail not configured - email will be logged to console only\n");
  }

  console.log(`\nSending to: ${process.env.OWNER_EMAIL || "shipithon@gmail.com"}`);
  console.log(`Subject: 🌳 New Estimate: Tree Removal — 75001 — $800 - $1,200\n`);

  try {
    const result = await notifyOwnerEmail(mockSession);

    if (result) {
      console.log("\n✓ Email function returned success");

      if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        console.log("✓ Email should have been sent via Gmail");
        console.log(`\nCheck inbox: ${process.env.OWNER_EMAIL || "shipithon@gmail.com"}`);
      } else {
        console.log("⚠️  Email content was logged above (Gmail not configured)");
      }
    } else {
      console.log("\n❌ Email function returned false");
    }

  } catch (error) {
    console.error("\n❌ Error sending email:", error);
  }

  console.log("\n" + "=".repeat(60));
}

runTest();
