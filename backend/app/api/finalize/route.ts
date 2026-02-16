// backend/app/api/finalize/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadSession, saveSession } from "@/lib/utils";
import { calculateEstimate, createNewSession } from "@/lib/chatbot";
import { notifyAll, sendEstimateToCustomer, type EmailAttachment } from "@/lib/notifications";
import { syncToHubSpot } from "@/lib/hubspot";
import type { FinalizeRequestBody, FinalizeResponseBody } from "@/lib/types";
import type { SessionState } from "@/lib/session";

// Zod schema for validation
const FinalizeSchema = z.object({
  sessionId: z.string().min(1),
  contact: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().min(10).optional(),
    email: z.string().email().optional(),
    address: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
  }).optional(),
});

// Track finalized sessions for idempotency
const finalizedSessions = new Set<string>();
const ENABLE_NATIVE_NOTIFICATIONS = process.env.ENABLE_NATIVE_NOTIFICATIONS === "true";
const ENABLE_HUBSPOT_SYNC = process.env.ENABLE_HUBSPOT_SYNC === "true";

// ----------------------
// POST /api/finalize
// ----------------------
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let sessionId = "";
    let contact: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      city?: string;
    } | undefined;
    let emailAttachments: EmailAttachment[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      sessionId = String(form.get("sessionId") || "").trim();
      if (!sessionId) {
        return NextResponse.json(
          { error: "Invalid request", details: { sessionId: ["Required"] } },
          { status: 400 }
        );
      }

      contact = {
        name: (form.get("contact_name") as string) || undefined,
        phone: (form.get("contact_phone") as string) || undefined,
        email: (form.get("contact_email") as string) || undefined,
        address: (form.get("contact_address") as string) || undefined,
        city: (form.get("contact_city") as string) || undefined,
      };

      const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
      const maxPhotos = Number(process.env.MAX_EMAIL_PHOTOS || 6);
      const maxFileBytes = Number(process.env.MAX_EMAIL_PHOTO_BYTES || 8 * 1024 * 1024);

      for (const file of files.slice(0, maxPhotos)) {
        if (!file.type?.startsWith("image/")) continue;
        if (file.size > maxFileBytes) continue;

        const bytes = await file.arrayBuffer();
        const content = Buffer.from(bytes);

        emailAttachments.push({
          filename: file.name || `photo-${emailAttachments.length + 1}.jpg`,
          content,
          contentType: file.type || "application/octet-stream",
        });
      }
    } else {
      const body = await request.json();

      const parsed = FinalizeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request", details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      sessionId = parsed.data.sessionId;
      contact = parsed.data.contact;
    }

    // Check idempotency
    if (finalizedSessions.has(sessionId)) {
      console.log(`[Finalize] Session ${sessionId} already finalized (idempotent)`);
      const session = await loadSession(sessionId);
      return NextResponse.json({
        success: true,
        sessionId,
        estimate: session?.estimate,
        emailSent: true,
        smsSent: true,
        wasCached: true,
      });
    }

    // Get or create session
    let session = await loadSession(sessionId);
    if (!session) {
      // Session doesn't exist (e.g., server restarted) - create a minimal one
      console.log(`[Finalize] Creating new session for ${sessionId} (was not found)`);
      session = createNewSession(sessionId);
      await saveSession(sessionId, session);
    }

    // Update contact info if provided
    if (contact) {
      if (contact.name) session.contact.name = contact.name;
      if (contact.phone) session.contact.phone = contact.phone;
      if (contact.email) session.contact.email = contact.email;
      if (contact.address) session.contact.address = contact.address;
      if (contact.city) session.contact.city = contact.city;
    }

    // Validate we have minimum required info
    const missingFields: string[] = [];
    if (!session.zip) missingFields.push("zip");
    if (!session.service_type) missingFields.push("service_type");
    if (!session.contact.phone && !session.contact.email) missingFields.push("phone or email");
    if (!session.contact.address) missingFields.push("address");

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot finalize yet",
          missingFields,
          message: `Please provide: ${missingFields.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Calculate estimate if not already done
    if (!session.estimate) {
      session.estimate = calculateEstimate(session);
    }

    // Update status
    session.status = "awaiting_owner"; // session.ts uses 'awaiting_owner' instead of 'estimate_sent'
    session.updated_at = new Date().toISOString();

    // Email-only photo mode: keep only lightweight metadata (no persisted photo files/URLs)
    if (emailAttachments.length > 0) {
      session.photos = { urls: [], count: emailAttachments.length };
      session.photos_uploaded = true;
    }

    // Save session
    await saveSession(sessionId, session);

    let emailSent = false;
    let smsSent = false;
    let customerSmsSent = false;

    const notificationResult = await notifyAll(session, { emailAttachments });
    emailSent = notificationResult.emailSent;
    smsSent = notificationResult.smsSent;

    if (session.contact.phone) {
      customerSmsSent = await sendEstimateToCustomer(session);
    }

    // Optional CRM sync (off by default for Zapier-first workflow)
    let hubspotResult: { success: boolean; dealId?: string; contactId?: string } = { success: false };
    if (ENABLE_HUBSPOT_SYNC) {
      const result = await syncToHubSpot(session);
      hubspotResult = { success: result.success, dealId: result.dealId, contactId: result.contactId };
      if (result.success && result.dealId) {
        // Store HubSpot deal ID in session for future updates
        session.hubspot_deal_id = result.dealId;
        session.hubspot_contact_id = result.contactId;
        await saveSession(sessionId, session);
      }
    } else {
      console.log("[Finalize] HubSpot sync skipped (ENABLE_HUBSPOT_SYNC != true)");
    }

    // Mark as finalized for idempotency
    finalizedSessions.add(sessionId);

    console.log(
      `[Finalize] Session ${sessionId} finalized. ` +
      `Email: ${emailSent}, Owner SMS: ${smsSent}, Customer SMS: ${customerSmsSent}, ` +
      `HubSpot: ${hubspotResult.success ? hubspotResult.dealId || "synced" : "skipped/failed"}`
    );

    const response: FinalizeResponseBody = {
      success: true,
      sessionId,
      estimate: session.estimate,
      emailSent,
      smsSent: smsSent || customerSmsSent,
      hubspot: {
        synced: hubspotResult.success,
        dealId: hubspotResult.dealId,
        contactId: hubspotResult.contactId,
      },
    };

    return NextResponse.json(response, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Finalize error:", error);
    return NextResponse.json(
      { error: "Finalize failed" },
      { status: 500 }
    );
  }
}

// ----------------------
// OPTIONS (CORS preflight)
// ----------------------
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
