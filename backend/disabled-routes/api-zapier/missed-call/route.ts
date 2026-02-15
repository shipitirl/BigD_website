import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendMissedCallToZapier } from "@/api/lib/zapier";
import { formatPhone } from "@/api/lib/utils";

const EVENTS_API_KEY = process.env.ZAPIER_EVENTS_API_KEY || "";

const MissedCallSchema = z.object({
  phone: z.string().min(7),
  name: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
});

function isAuthorized(request: NextRequest): boolean {
  if (!EVENTS_API_KEY) return true;
  return request.headers.get("x-zapier-events-key") === EVENTS_API_KEY;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = MissedCallSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = {
      event: "missed_call" as const,
      occurredAt: parsed.data.occurredAt || new Date().toISOString(),
      phone: formatPhone(parsed.data.phone),
      name: parsed.data.name,
      source: parsed.data.source || "phone_system",
      notes: parsed.data.notes,
    };

    const result = await sendMissedCallToZapier(payload);
    return NextResponse.json({
      success: result.sent,
      skipped: result.skipped,
      status: result.status,
      error: result.error,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process missed call", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "missed-call",
    configured: !!process.env.ZAPIER_MISSED_CALL_WEBHOOK_URL,
  });
}
