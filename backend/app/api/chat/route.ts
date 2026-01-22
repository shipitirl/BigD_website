// backend/app/api/chat/route.ts

import { NextResponse } from "next/server";
import { ChatRequestSchema, runChatTurn, streamChatTurn, createNewSession } from "@/api/lib/chatbot";
import type { ChatRequestBody, ChatResponseBody, SessionState } from "@/api/lib/types";
import { generateSessionId, loadSession, saveSession } from "@/api/lib/utils";

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

  const { sessionId: incomingSessionId, message, stream } = parsed.data;

  // Get or create session
  const sessionId = incomingSessionId ?? generateSessionId();
  const existing = await loadSession(sessionId);

  const state: SessionState = existing ?? createNewSession(sessionId);

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

          // Send final metadata
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                sessionId,
                readyForPhotos: state.status === "awaiting_photos",
                estimate: state.estimate,
                collected: {
                  zip: state.zip,
                  serviceType: state.serviceType,
                  treeCount: state.treeCount,
                  access: state.access,
                  hasPowerLines: state.hasPowerLines,
                  hasPhotos: state.hasPhotos,
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

  const response: ChatResponseBody = {
    sessionId,
    assistantMessage: result.assistantMessage,
    nextQuestions: result.nextQuestions,
    readyForPhotos: result.readyForPhotos,
    estimate: result.estimate,
    collected: {
      zip: result.updatedState.zip,
      serviceType: result.updatedState.serviceType,
      treeCount: result.updatedState.treeCount,
      access: result.updatedState.access,
      hasPowerLines: result.updatedState.hasPowerLines,
      hasPhotos: result.updatedState.hasPhotos,
    },
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
