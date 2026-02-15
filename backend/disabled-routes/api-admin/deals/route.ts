// backend/app/api/admin/deals/route.ts
// Admin API for managing HubSpot deals

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadSession, saveSession } from "@/api/lib/utils";
import { markDealWon, markDealLost, updateDealStage, updateDealEstimate, markEstimateApproved } from "@/api/lib/hubspot";
import { verifyAdminToken } from "@/api/lib/tokens";

// ----------------------
// AUTH HELPER
// ----------------------
function validateAdminAuth(request: NextRequest, leadId: string): { valid: boolean; error?: string } {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");

  // In development, allow access without token
  if (process.env.NODE_ENV === "development" && !token) {
    return { valid: true };
  }

  if (!token) {
    return { valid: false, error: "Token required" };
  }

  const result = verifyAdminToken(token, leadId, "lead_admin");
  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  return { valid: true };
}

// ----------------------
// REQUEST SCHEMAS
// ----------------------
const UpdateDealSchema = z.object({
  sessionId: z.string().min(1),
  action: z.enum(["won", "lost", "stage", "adjust", "approve"]),
  actualAmount: z.number().optional(),
  lostReason: z.string().optional(),
  // For estimate adjustment
  adjustedMin: z.number().optional(),
  adjustedMax: z.number().optional(),
  adjustmentReason: z.string().optional(),
  stage: z.enum([
    "appointmentscheduled",
    "qualifiedtobuy",
    "presentationscheduled",
    "decisionmakerboughtin",
    "contractsent",
    "closedwon",
    "closedlost",
  ]).optional(),
});

// ----------------------
// POST /api/admin/deals - Update deal status
// ----------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = UpdateDealSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId, action, actualAmount, lostReason, stage, adjustedMin, adjustedMax, adjustmentReason } = parsed.data;

    // Validate token
    const authResult = validateAdminAuth(request, sessionId);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error },
        { status: 403 }
      );
    }

    // Load session to get HubSpot deal ID
    const session = await loadSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const dealId = session.hubspot_deal_id;
    if (!dealId) {
      return NextResponse.json(
        { error: "No HubSpot deal associated with this session" },
        { status: 400 }
      );
    }

    let success = false;
    let updatedStatus = "";

    switch (action) {
      case "won":
        success = await markDealWon(dealId, actualAmount);
        if (success) {
          session.status = "completed";
          session.actual_amount = actualAmount;
          session.completed_at = new Date().toISOString();
          await saveSession(sessionId, session);
          updatedStatus = "closedwon";
        }
        break;

      case "lost":
        success = await markDealLost(dealId, lostReason);
        if (success) {
          session.lost_reason = lostReason;
          session.status = "lost";
          await saveSession(sessionId, session);
          updatedStatus = "closedlost";
        }
        break;

      case "stage":
        if (!stage) {
          return NextResponse.json(
            { error: "Stage is required for stage action" },
            { status: 400 }
          );
        }
        success = await updateDealStage(dealId, stage);
        if (success) {
          updatedStatus = stage;
        }
        break;

      case "adjust":
        if (!adjustedMin || !adjustedMax) {
          return NextResponse.json(
            { error: "adjustedMin and adjustedMax are required for adjust action" },
            { status: 400 }
          );
        }
        success = await updateDealEstimate(dealId, adjustedMin, adjustedMax, adjustmentReason);
        if (success) {
          // Update session estimate
          if (session.estimate) {
            session.estimate.min = adjustedMin;
            session.estimate.max = adjustedMax;
            session.estimate.confidence = "high"; // Owner-adjusted = high confidence
            session.estimate.drivers.push(`Owner adjusted: ${adjustmentReason || "Manual adjustment"}`);
          }
          await saveSession(sessionId, session);
          updatedStatus = "owner_adjusted";
        }
        break;

      case "approve":
        success = await markEstimateApproved(dealId);
        if (success) {
          session.status = "approved";
          await saveSession(sessionId, session);
          updatedStatus = "customer_approved";
        }
        break;

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update HubSpot deal" },
        { status: 500 }
      );
    }

    console.log(`[Admin] Deal ${dealId} updated: ${action} -> ${updatedStatus}`);

    return NextResponse.json({
      success: true,
      dealId,
      action,
      updatedStatus,
      sessionId,
    });
  } catch (error) {
    console.error("Admin deals error:", error);
    return NextResponse.json(
      { error: "Update failed", details: (error as Error).message },
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
