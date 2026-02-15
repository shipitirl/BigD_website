import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendReviewRequestToZapier } from "@/api/lib/zapier";
import { formatPhone } from "@/api/lib/utils";

const EVENTS_API_KEY = process.env.ZAPIER_EVENTS_API_KEY || "";

const ReviewRequestSchema = z.object({
  leadId: z.string().optional(),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  service: z.string().optional(),
  completedAt: z.string().datetime().optional(),
  source: z.string().optional(),
}).refine((data) => Boolean(data.phone || data.email), {
  message: "phone or email is required",
  path: ["phone"],
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
    const parsed = ReviewRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = {
      event: "review_request" as const,
      requestedAt: new Date().toISOString(),
      leadId: parsed.data.leadId,
      name: parsed.data.name,
      phone: parsed.data.phone ? formatPhone(parsed.data.phone) : "",
      email: parsed.data.email || "",
      service: parsed.data.service,
      completedAt: parsed.data.completedAt,
      source: parsed.data.source || "manual_trigger",
    };

    const result = await sendReviewRequestToZapier(payload);
    return NextResponse.json({
      success: result.sent,
      skipped: result.skipped,
      status: result.status,
      error: result.error,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process review request", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "review-request",
    configured: !!process.env.ZAPIER_REVIEW_WEBHOOK_URL,
  });
}
