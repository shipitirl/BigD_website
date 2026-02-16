// backend/api/lib/notifications.ts

import nodemailer from "nodemailer";
import type { SessionState, Estimate } from "./session";
import { formatPhone } from "./utils";

// ----------------------
// CONFIG
// ----------------------
function cleanEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) return "";
  return raw.replace(/\s+#.*$/, "").trim();
}

const OWNER_EMAIL = cleanEnv("OWNER_EMAIL") || cleanEnv("GMAIL_USER") || "shipithon@gmail.com";
const OWNER_PHONE = process.env.OWNER_PHONE || "";
const APP_URL = process.env.APP_URL || "http://localhost:3001";

// Twilio config
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Gmail config
const GMAIL_USER = cleanEnv("GMAIL_USER");
const GMAIL_APP_PASSWORD = cleanEnv("GMAIL_APP_PASSWORD").replace(/\s+/g, "");

// ----------------------
// SERVICE LABELS
// ----------------------
const serviceLabels: Record<string, string> = {
  tree_removal: "Tree Removal",
  tree_trimming: "Tree Trimming",
  stump_grinding: "Stump Grinding",
  storm_prep: "Storm Preparation",
  emergency_storm: "Emergency Storm Cleanup",
  land_clearing: "Land Clearing",
  tree_health: "Tree Health",
  pest_management: "Pest Management",
  disease_management: "Disease Management",
  consulting: "Consulting",
  other: "Tree Service",
};

// ----------------------
// EMAIL: Send via Gmail
// ----------------------
export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const EMAIL_TIMEOUT_MS = envMs("EMAIL_TIMEOUT_MS", 12000);
const SMS_TIMEOUT_MS = envMs("SMS_TIMEOUT_MS", 12000);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments: EmailAttachment[] = []
): Promise<boolean> {
  console.log(`[Email] Sending to ${to}: ${subject} (timeout=${EMAIL_TIMEOUT_MS}ms)`);

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn("[Email] Skipped: GMAIL_USER or GMAIL_APP_PASSWORD not set");
    console.log("--- Email Content ---");
    console.log(text);
    console.log("---------------------");
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS,
  });

  try {
    await withTimeout(
      transporter.sendMail({
        from: `"Big D's Tree Service" <${GMAIL_USER}>`,
        to,
        subject,
        html,
        text,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      }),
      EMAIL_TIMEOUT_MS,
      "email send"
    );
    console.log("[Email] Sent successfully via Gmail");
    return true;
  } catch (err) {
    console.error("[Email] Failed to send:", err);
    return false;
  }
}

// ----------------------
// SMS: Send via Twilio
// ----------------------
async function sendSMS(to: string, body: string): Promise<boolean> {
  console.log(`[SMS] Sending to ${to}`);

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log("=== SMS skipped (No Twilio Config) ===");
    console.log("To:", to);
    console.log("Body:", body);
    console.log("=====================================");
    return false;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: TWILIO_PHONE_NUMBER,
        Body: body,
      }),
      signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[SMS] Twilio error:", error);
      return false;
    }

    console.log("[SMS] Sent successfully");
    return true;
  } catch (error) {
    console.error("[SMS] Send error:", error);
    return false;
  }
}

// ----------------------
// BUILD OWNER EMAIL HTML
// ----------------------
function buildOwnerEmailHtml(session: SessionState, attachmentCount = 0): string {
  const estimate = session.estimate;
  const contact = session.contact;
  const serviceType = serviceLabels[session.service_type || "other"];

  const estimateRange = estimate
    ? `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()}`
    : "Pending review";

  const photoUrls = session.photos?.urls || [];
  const photosHtml = photoUrls.length > 0
    ? photoUrls.map(url =>
        `<a href="${APP_URL}${url}" target="_blank"><img src="${APP_URL}${url}" width="150" style="margin: 4px; border-radius: 8px;"></a>`
      ).join("")
    : (attachmentCount > 0
      ? `<p>${attachmentCount} photo(s) attached to this email (not persisted on server).</p>`
      : "<p>No photos uploaded</p>");

  const driversHtml = estimate?.drivers.length
    ? `<ul>${estimate.drivers.map(d => `<li>${d}</li>`).join("")}</ul>`
    : "<p>No modifiers</p>";

  const conversationHtml = session.messages.map(msg => `
    <div style="margin-bottom: 12px; ${msg.role === "user" ? "text-align: right;" : ""}">
      <span style="display: inline-block; padding: 8px 12px; border-radius: 12px; max-width: 80%; ${
        msg.role === "user"
          ? "background: #4a7c23; color: white;"
          : "background: #e9ecef; color: #333;"
      }">
        ${msg.content}
      </span>
      <div style="font-size: 10px; color: #999; margin-top: 2px;">${msg.role === "user" ? "Customer" : "Bot"}</div>
    </div>
  `).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2d5016 0%, #4a7c23 100%); color: white; padding: 20px; border-radius: 12px 12px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border-radius: 0 0 12px 12px; }
    .estimate-box { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #4a7c23; }
    .estimate-range { font-size: 24px; font-weight: bold; color: #2d5016; }
    .section { margin: 20px 0; }
    .label { font-weight: bold; color: #666; font-size: 12px; text-transform: uppercase; }
    .photos { display: flex; flex-wrap: wrap; gap: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">🌳 New Estimate Request</h1>
    <p style="margin: 8px 0 0 0; opacity: 0.9;">Big D's Tree Service — ${session.zip || "Unknown ZIP"}</p>
  </div>

  <div class="content">
    ${session.urgency === "emergency" ? '<div style="background: #dc3545; color: white; padding: 12px; border-radius: 8px; margin-bottom: 16px;">🚨 EMERGENCY REQUEST</div>' : ""}

    <div class="estimate-box">
      <div class="label">Estimated Range</div>
      <div class="estimate-range">${estimateRange}</div>
      <div style="color: #666; font-size: 14px;">${estimate?.confidence || "low"} confidence</div>
    </div>

    <div class="section">
      <div class="label">Service Details</div>
      <p><strong>${serviceType}</strong> — ${session.tree_count || 1} tree(s)/stump(s)</p>
      <p>Location: ${session.access.location || "Not specified"}</p>
      <p>Slope: ${session.access.slope || "Not specified"}</p>
      <p>${session.hazards.power_lines ? "⚡ Power lines nearby" : "✓ No power lines"}</p>
      <p>${session.hazards.structures_nearby ? "🏠 Near structures" : "✓ Open area"}</p>
    </div>

    <div class="section">
      <div class="label">Price Drivers</div>
      ${driversHtml}
    </div>

    <div class="section">
      <div class="label">Customer Contact</div>
      <p>
        <strong>${contact.name || "Unknown"}</strong><br>
        📞 <a href="tel:${contact.phone}">${contact.phone || "No phone"}</a><br>
        ${contact.email ? `✉️ ${contact.email}<br>` : ""}
        ${contact.address ? `📍 ${contact.address}<br>` : ""}
        ${contact.city ? `${contact.city}, ` : ""}${session.zip || ""}
      </p>
    </div>

    <div class="section">
      <div class="label">Photos (${photoUrls.length || attachmentCount})</div>
      <div class="photos">${photosHtml}</div>
    </div>

    <div class="section" style="margin-top: 30px;">
      <div class="label">Conversation</div>
      <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; max-height: 400px; overflow-y: auto;">
        ${conversationHtml}
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ----------------------
// BUILD PLAIN TEXT EMAIL
// ----------------------
function buildOwnerEmailText(session: SessionState, attachmentCount = 0): string {
  const estimate = session.estimate;
  const contact = session.contact;
  const serviceType = serviceLabels[session.service_type || "other"];

  const estimateRange = estimate
    ? `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()}`
    : "Pending review";

  const photoUrls = session.photos?.urls || [];

  return `
New Estimate Request - Big D's Tree Service
==========================================

${session.urgency === "emergency" ? "⚠️ EMERGENCY REQUEST\n" : ""}
Service: ${serviceType}
Count: ${session.tree_count || 1}
ZIP: ${session.zip || "Unknown"}

ESTIMATE: ${estimateRange} (${estimate?.confidence || "low"} confidence)
${estimate?.drivers.length ? `\nPrice Drivers:\n  - ${estimate.drivers.join("\n  - ")}` : ""}

CUSTOMER:
  Name: ${contact.name || "Unknown"}
  Phone: ${contact.phone || "No phone"}
  Email: ${contact.email || "No email"}
  Address: ${contact.address || "Not provided"}
  City: ${contact.city || "Not provided"}, ${session.zip || ""}

LOCATION: ${session.access.location || "Not specified"}
SLOPE: ${session.access.slope || "Not specified"}
POWER LINES: ${session.hazards.power_lines ? "YES" : "No"}
NEAR STRUCTURES: ${session.hazards.structures_nearby ? "YES" : "No"}

PHOTOS (${photoUrls.length || attachmentCount}):
${photoUrls.length > 0
    ? photoUrls.map(url => `  ${APP_URL}${url}`).join("\n")
    : (attachmentCount > 0
      ? `  ${attachmentCount} photo(s) attached to this email (not persisted on server)`
      : "  No photos uploaded")}
  `.trim();
}

// ----------------------
// NOTIFY OWNER (Email)
// ----------------------
export async function notifyOwnerEmail(
  session: SessionState,
  attachments: EmailAttachment[] = []
): Promise<boolean> {
  const serviceType = serviceLabels[session.service_type || "other"];
  const estimate = session.estimate;
  const estimateRange = estimate
    ? `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()}`
    : "TBD";

  const subject = `🌳 New Estimate: ${serviceType} — ${session.zip || "ZIP?"} — ${estimateRange}`;

  return sendEmail(
    OWNER_EMAIL,
    subject,
    buildOwnerEmailHtml(session, attachments.length),
    buildOwnerEmailText(session, attachments.length),
    attachments
  );
}

// ----------------------
// NOTIFY OWNER (SMS)
// ----------------------
export async function notifyOwnerSMS(session: SessionState): Promise<boolean> {
  if (!OWNER_PHONE) {
    console.log("[SMS] No OWNER_PHONE configured, skipping owner SMS");
    return true;
  }

  const serviceType = serviceLabels[session.service_type || "other"];
  const estimate = session.estimate;
  const estimateRange = estimate
    ? `$${estimate.min} - $${estimate.max}`
    : "TBD";

  const body = `🌳 New lead: ${serviceType}\n` +
    `${session.zip || "No ZIP"} | ${session.tree_count || 1} tree(s)\n` +
    `Est: ${estimateRange}\n` +
    `Customer: ${session.contact.name || "?"} ${session.contact.phone || ""}\n` +
    `${session.urgency === "emergency" ? "🚨 EMERGENCY" : ""}`;

  return sendSMS(formatPhone(OWNER_PHONE), body);
}

// ----------------------
// SEND ESTIMATE TO CUSTOMER (SMS)
// ----------------------
export async function sendEstimateToCustomer(session: SessionState): Promise<boolean> {
  if (!session.contact.phone) {
    console.error("[SMS] No phone number for customer");
    return false;
  }

  const estimate = session.estimate;
  if (!estimate) {
    console.error("[SMS] No estimate available");
    return false;
  }

  const serviceType = serviceLabels[session.service_type || "other"];

  const body = `Big D's Tree Service estimate:\n\n` +
    `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()} for ${serviceType}\n\n` +
    `Reply YES to approve and schedule, or call (262) 215-0497 with questions.`;

  return sendSMS(formatPhone(session.contact.phone), body);
}

// ----------------------
// SEND BOOKING CONFIRMATION (SMS)
// ----------------------
export async function sendBookingConfirmation(session: SessionState, bookingLink?: string): Promise<boolean> {
  if (!session.contact.phone) {
    return false;
  }

  const body = `Thanks for choosing Big D's Tree Service! 🌳\n\n` +
    (bookingLink ? `Schedule your appointment here:\n${bookingLink}\n\n` : "") +
    `We'll be in touch soon!\n- Corey and the Big D's team`;

  return sendSMS(formatPhone(session.contact.phone), body);
}

// ----------------------
// COMBINED: Notify all parties
// ----------------------
export async function notifyAll(
  session: SessionState,
  options?: { emailAttachments?: EmailAttachment[] }
): Promise<{ emailSent: boolean; smsSent: boolean }> {
  const [emailResult, smsResult] = await Promise.allSettled([
    notifyOwnerEmail(session, options?.emailAttachments || []),
    notifyOwnerSMS(session),
  ]);

  const emailSent = emailResult.status === "fulfilled" ? emailResult.value : false;
  const smsSent = smsResult.status === "fulfilled" ? smsResult.value : false;

  if (emailResult.status === "rejected") {
    console.error("[NotifyAll] Email branch failed:", emailResult.reason);
  }
  if (smsResult.status === "rejected") {
    console.error("[NotifyAll] SMS branch failed:", smsResult.reason);
  }

  return { emailSent, smsSent };
}
