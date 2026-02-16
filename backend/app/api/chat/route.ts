// backend/app/api/chat/route.ts

import { NextResponse } from "next/server";
import { ChatRequestSchema, runChatTurn, streamChatTurn, createNewSession } from "@/lib/chatbot";
import type { ChatRequestBody, ChatResponseBody } from "@/lib/types";
import type { SessionState } from "@/lib/session";
import { generateSessionId, loadSession, saveSession } from "@/lib/utils";

function applyClientCollectedSnapshot(state: SessionState, collected?: ChatRequestBody["clientCollected"]) {
  if (!collected) return;

  if (collected.zip && !state.zip) state.zip = String(collected.zip);

  if (collected.serviceType && !state.service_type) {
    state.service_type = collected.serviceType as SessionState["service_type"];
  }

  if (typeof collected.treeCount === "number" && state.tree_count === null) {
    state.tree_count = collected.treeCount;
  }

  if (collected.access && !state.access.location) {
    const loc = String(collected.access).toLowerCase().trim().replace(/\s+/g, "_");
    if (loc === "backyard" || loc === "back_yard") state.access.location = "backyard";
    if (loc === "front_yard" || loc === "frontyard" || loc === "front") state.access.location = "front_yard";
  }

  if (typeof collected.gateWidthFt === "number" && state.access.gate_width_ft === null) {
    state.access.gate_width_ft = collected.gateWidthFt;
  }

  if (collected.slope && !state.access.slope) {
    const slope = String(collected.slope).toLowerCase();
    if (slope === "easy" || slope === "moderate" || slope === "steep") {
      state.access.slope = slope;
    }
  }

  if (typeof collected.hasPowerLines === "boolean" && state.hazards.power_lines === null) {
    state.hazards.power_lines = collected.hasPowerLines;
  }

  if (typeof collected.hasStructuresNearby === "boolean" && state.hazards.structures_nearby === null) {
    state.hazards.structures_nearby = collected.hasStructuresNearby;
  }

  if ((typeof collected.haulAway === "boolean" || collected.haulAway === "unsure") && state.haul_away === null) {
    state.haul_away = collected.haulAway;
  }

  if (collected.contactName && !state.contact.name) state.contact.name = collected.contactName;
  if (collected.contactPhone && !state.contact.phone) state.contact.phone = collected.contactPhone;
  if (collected.contactEmail && !state.contact.email) state.contact.email = collected.contactEmail;
  if (collected.contactAddress && !state.contact.address) state.contact.address = collected.contactAddress;
  if (collected.contactCity && !state.contact.city) state.contact.city = collected.contactCity;

  if (collected.hasPhotos && !state.photos_uploaded) {
    state.photos_uploaded = true;
  }
}

export async function POST(req: Request) {
  let json: ChatRequestBody;

  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { sessionId: incomingSessionId, message, stream, clientCollected } = parsed.data;

  // Get or create session
  const sessionId = incomingSessionId ?? generateSessionId();
  const existing = await loadSession(sessionId);

  const state: SessionState = existing ?? createNewSession(sessionId);
  if (!existing && incomingSessionId && clientCollected) {
    applyClientCollectedSnapshot(state, clientCollected);
    console.warn(`[Chat] Recovered missing session ${sessionId} from clientCollected snapshot`);
  }

  // Save session immediately so it exists for photo uploads
  // (will be updated again after chat processing completes)
  if (!existing) {
    await saveSession(sessionId, state);
  }

  // Handle streaming response
  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // First, send the session ID
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "session", sessionId })}\n\n`)
          );

          // Stream the response word by word
          const generator = streamChatTurn(state, message);
          let fullMessage = "";

          for await (const chunk of generator) {
            fullMessage += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`)
            );
          }

          // Save the updated state
          await saveSession(sessionId, state);

          // Send final metadata (NO estimate - that's owner-only)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                sessionId,
                readyForPhotos: state.status === "awaiting_photos",
                // estimate intentionally NOT sent to customer
                collected: {
                  zip: state.zip,
                  serviceType: state.service_type,
                  treeCount: state.tree_count,
                  access: state.access.location,
                  slope: state.access.slope,
                  gateWidthFt: state.access.gate_width_ft,
                  hasPowerLines: state.hazards.power_lines,
                  hasStructuresNearby: state.hazards.structures_nearby,
                  haulAway: state.haul_away,
                  contactName: state.contact.name,
                  contactPhone: state.contact.phone,
                  contactEmail: state.contact.email,
                  contactAddress: state.contact.address,
                  contactCity: state.contact.city,
                  hasPhotos: state.photos_uploaded,
                },
              })}\n\n`
            )
          );

          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Stream error" })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Non-streaming response
  const result = await runChatTurn(state, message);
  await saveSession(sessionId, result.updatedState);

  // NOTE: Estimate is NOT sent to customer - it's owner-only (sent via email on finalize)
  const exposeDebug = process.env.EXPOSE_DEBUG_CHAT === "true";

  // Never leak internal debug fields in normal API responses.
  const safeState = { ...(result.updatedState as any) };
  delete safeState._debug_error;

  const response: ChatResponseBody & { state: typeof result.updatedState; debug?: string } = {
    sessionId,
    assistantMessage: result.assistantMessage,
    nextQuestions: result.nextQuestions,
    readyForPhotos: result.readyForPhotos,
    // estimate intentionally NOT included - owner-only via email
    collected: {
      zip: result.updatedState.zip ?? undefined,
      serviceType: result.updatedState.service_type ?? undefined,
      treeCount: result.updatedState.tree_count ?? undefined,
      access: result.updatedState.access.location ?? undefined,
      slope: result.updatedState.access.slope ?? undefined,
      gateWidthFt: result.updatedState.access.gate_width_ft ?? undefined,
      hasPowerLines: result.updatedState.hazards.power_lines ?? undefined,
      hasStructuresNearby: result.updatedState.hazards.structures_nearby ?? undefined,
      haulAway: result.updatedState.haul_away ?? undefined,
      contactName: result.updatedState.contact.name ?? undefined,
      contactPhone: result.updatedState.contact.phone ?? undefined,
      contactEmail: result.updatedState.contact.email ?? undefined,
      contactAddress: result.updatedState.contact.address ?? undefined,
      contactCity: result.updatedState.contact.city ?? undefined,
      hasPhotos: result.updatedState.photos_uploaded,
    },
    // Full state for debugging/testing (includes internal estimate)
    state: safeState,
    ...(exposeDebug && result.debug ? { debug: result.debug } : {}),
  };

  return NextResponse.json(response, {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
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
