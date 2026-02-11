import type { SessionState } from "./session";
import { formatPhone } from "./utils";

const ZAPIER_LEAD_WEBHOOK_URL = process.env.ZAPIER_LEAD_WEBHOOK_URL;
const ZAPIER_MISSED_CALL_WEBHOOK_URL = process.env.ZAPIER_MISSED_CALL_WEBHOOK_URL;
const ZAPIER_REVIEW_WEBHOOK_URL = process.env.ZAPIER_REVIEW_WEBHOOK_URL;
const ZAPIER_TIMEOUT_MS = Number(process.env.ZAPIER_TIMEOUT_MS || 10000);

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

export interface ZapierResult {
  sent: boolean;
  skipped: boolean;
  status?: number;
  error?: string;
}

export interface ZapierLeadPayload {
  event: "lead_submitted";
  submittedAt: string;
  leadId: string;
  source: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  service: string;
  address: string;
  notes: string;
  zip: string;
  urgency: string;
  treeCount: number;
  estimateMin: number | null;
  estimateMax: number | null;
  estimateRange: string;

  // Yardbook-oriented helper fields for Zap mapping
  createCustomer: boolean;
  createEstimate: boolean;
  createInvoice: boolean;
  estimateTitle: string;
  invoiceTitle: string;
  lineItemDescription: string;

  ownerSmsMessage: string;
  customerAutoReplyText: string;
  customerAutoReplyEmailSubject: string;
  customerAutoReplyEmailBody: string;
}

export interface MissedCallPayload {
  event: "missed_call";
  occurredAt: string;
  phone: string;
  name?: string;
  source?: string;
  notes?: string;
}

export interface ReviewRequestPayload {
  event: "review_request";
  requestedAt: string;
  leadId?: string;
  name: string;
  phone: string;
  email: string;
  service?: string;
  completedAt?: string;
  source?: string;
}

function safeString(value: string | null | undefined): string {
  return value?.trim() || "";
}

function getServiceLabel(serviceType: string | null): string {
  if (!serviceType) return serviceLabels.other;
  return serviceLabels[serviceType] || serviceLabels.other;
}

function buildAddress(session: SessionState): string {
  const address = safeString(session.contact.address);
  const city = safeString(session.contact.city);
  const zip = safeString(session.zip);
  return [address, city, zip].filter(Boolean).join(", ");
}

function buildNotes(session: SessionState): string {
  const noteLines: string[] = [];

  if (session.tree_count !== null) {
    noteLines.push(`Tree/stump count: ${session.tree_count}`);
  }
  if (session.access.location) {
    noteLines.push(`Access: ${session.access.location}`);
  }
  if (session.access.gate_width_ft !== null) {
    noteLines.push(`Gate width: ${session.access.gate_width_ft}ft`);
  }
  if (session.access.slope) {
    noteLines.push(`Slope: ${session.access.slope}`);
  }
  if (session.hazards.power_lines !== null) {
    noteLines.push(`Power lines nearby: ${session.hazards.power_lines ? "yes" : "no"}`);
  }
  if (session.hazards.structures_nearby !== null) {
    noteLines.push(`Near structures: ${session.hazards.structures_nearby ? "yes" : "no"}`);
  }
  if (session.haul_away !== null) {
    noteLines.push(`Haul away: ${session.haul_away === true ? "yes" : session.haul_away === false ? "no" : "unsure"}`);
  }
  if (session.photos.count > 0) {
    noteLines.push(`Photos uploaded: ${session.photos.count}`);
  }

  const lastCustomerMessage = [...session.messages]
    .reverse()
    .find((msg) => msg.role === "user" && msg.content?.trim());
  if (lastCustomerMessage) {
    noteLines.push(`Customer note: ${lastCustomerMessage.content.trim().slice(0, 300)}`);
  }

  return noteLines.join(" | ");
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.trim();
  if (!cleaned) return { firstName: "", lastName: "" };

  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function buildOwnerSmsMessage(payload: ZapierLeadPayload): string {
  const name = payload.name || "Unknown";
  return `New landscape lead from ${name} - check sheet or call now`;
}

function buildCustomerAutoReplyText(payload: ZapierLeadPayload): string {
  return `Thanks ${payload.name || "there"}, we got your request. We will follow up shortly with next steps.`;
}

function buildCustomerAutoReplyEmailSubject(): string {
  return "We received your request";
}

function buildCustomerAutoReplyEmailBody(payload: ZapierLeadPayload): string {
  return [
    `Hi ${payload.name || "there"},`,
    "",
    "Thanks for contacting Big D's Tree Service. We received your request and will follow up shortly.",
    "",
    `Service: ${payload.service}`,
    `Address: ${payload.address || "Not provided"}`,
    "",
    "Reply to this message if you want to add anything before we call.",
  ].join("\n");
}

function withTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function") {
    return (AbortSignal as any).timeout(timeoutMs) as AbortSignal;
  }
  return undefined;
}

async function postToZapier(webhookUrl: string | undefined, payload: unknown): Promise<ZapierResult> {
  if (!webhookUrl) {
    return { sent: false, skipped: true };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: withTimeoutSignal(ZAPIER_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        sent: false,
        skipped: false,
        status: response.status,
        error: errorText.slice(0, 500),
      };
    }

    return {
      sent: true,
      skipped: false,
      status: response.status,
    };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      error: String(error),
    };
  }
}

export function buildZapierLeadPayload(session: SessionState): ZapierLeadPayload {
  const service = getServiceLabel(session.service_type);
  const name = safeString(session.contact.name);
  const phone = safeString(session.contact.phone);
  const email = safeString(session.contact.email);
  const address = buildAddress(session);
  const notes = buildNotes(session);
  const estimateMin = session.estimate?.min ?? null;
  const estimateMax = session.estimate?.max ?? null;
  const estimateRange = estimateMin !== null && estimateMax !== null
    ? `$${estimateMin} - $${estimateMax}`
    : "";

  const { firstName, lastName } = splitName(name);

  const payload: ZapierLeadPayload = {
    event: "lead_submitted",
    submittedAt: new Date().toISOString(),
    leadId: session.lead_id,
    source: "website_form_submit",
    name,
    firstName,
    lastName,
    phone: phone ? formatPhone(phone) : "",
    email,
    service,
    address,
    notes,
    zip: safeString(session.zip),
    urgency: session.urgency || "normal",
    treeCount: session.tree_count || 0,
    estimateMin,
    estimateMax,
    estimateRange,

    // Yardbook helpers
    createCustomer: true,
    createEstimate: true,
    createInvoice: true,
    estimateTitle: `${service} - ${name || "New Customer"}`,
    invoiceTitle: `Invoice Draft - ${service} - ${name || "New Customer"}`,
    lineItemDescription: `${service}${estimateRange ? ` (${estimateRange})` : ""}`,

    ownerSmsMessage: "",
    customerAutoReplyText: "",
    customerAutoReplyEmailSubject: "",
    customerAutoReplyEmailBody: "",
  };

  payload.ownerSmsMessage = buildOwnerSmsMessage(payload);
  payload.customerAutoReplyText = buildCustomerAutoReplyText(payload);
  payload.customerAutoReplyEmailSubject = buildCustomerAutoReplyEmailSubject();
  payload.customerAutoReplyEmailBody = buildCustomerAutoReplyEmailBody(payload);

  return payload;
}

export async function sendLeadToZapier(session: SessionState): Promise<ZapierResult> {
  const payload = buildZapierLeadPayload(session);
  return postToZapier(ZAPIER_LEAD_WEBHOOK_URL, payload);
}

export async function sendMissedCallToZapier(payload: MissedCallPayload): Promise<ZapierResult> {
  return postToZapier(ZAPIER_MISSED_CALL_WEBHOOK_URL, payload);
}

export async function sendReviewRequestToZapier(payload: ReviewRequestPayload): Promise<ZapierResult> {
  return postToZapier(ZAPIER_REVIEW_WEBHOOK_URL, payload);
}
