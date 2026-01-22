// backend/app/api/finalize/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadSession, saveSession } from "@/api/lib/utils";
import { calculateEstimate, createNewSession } from "@/api/lib/chatbot";
import { notifyAll, sendEstimateToCustomer } from "@/api/lib/notifications";
import type { FinalizeRequestBody, FinalizeResponseBody, SessionState } from "@/api/lib/types";

// Zod schema for validation
const FinalizeSchema = z.object({
  sessionId: z.string().min(1),
  contact: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().min(10).optional(),
    email: z.string().email().optional(),
  }).optional(),
});

// Track finalized sessions for idempotency
const finalizedSessions = new Set<string>();

// ----------------------
// POST /api/finalize
// ----------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = FinalizeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId, contact } = parsed.data;

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
    }

    // Validate we have minimum required info
    const missingFields: string[] = [];
    if (!session.zip) missingFields.push("zip");
    if (!session.serviceType || session.serviceType === "unknown") missingFields.push("serviceType");
    if (!session.contact.phone && !session.contact.email) missingFields.push("phone or email");

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
    session.status = "estimate_sent";
    session.updatedAt = new Date().toISOString();

    // Save session
    await saveSession(sessionId, session);

    // Send notifications
    const { emailSent, smsSent } = await notifyAll(session);

    // Send estimate to customer if they have a phone
    let customerSmsSent = false;
    if (session.contact.phone) {
      customerSmsSent = await sendEstimateToCustomer(session);
    }

    // Mark as finalized for idempotency
    finalizedSessions.add(sessionId);

    console.log(`[Finalize] Session ${sessionId} finalized. Email: ${emailSent}, Owner SMS: ${smsSent}, Customer SMS: ${customerSmsSent}`);

    const response: FinalizeResponseBody = {
      success: true,
      sessionId,
      estimate: session.estimate,
      emailSent,
      smsSent: smsSent || customerSmsSent,
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
