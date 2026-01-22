// backend/api/lib/chatbot.ts

import { z } from "zod";
import type { SessionState, Estimate } from "./types";

// Zod schema for server-side validation
export const ChatRequestSchema = z.object({
  sessionId: z.string().nullable().optional(),
  message: z.string().min(1).max(4000),
  stream: z.boolean().optional(),
});

import OpenAI from "openai";

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ----------------------
// LLM PROMPT GENERATOR
// ----------------------
function generateSystemPrompt(state: SessionState): string {
  const definitions = `
  - Service Types: tree_removal, stump_grinding, trimming, storm_cleanup
  - Access: easy (driveway/front yard), medium (gate/fence), hard (tight/steep/backyard if difficult)
  - Urgency: normal, urgent (soon), emergency (immediate hazard)
  - Location: front_yard, back_yard, side_yard
  `;

  const stateJson = JSON.stringify({
    zip: state.zip || null,
    serviceType: state.serviceType || "unknown",
    treeCount: state.treeCount || null,
    hasPowerLines: state.hasPowerLines,
    access: state.access || null,
    location: state.location || null,
    haulAway: state.haulAway,
    contact: state.contact,
  });

  return `You are Corey, the friendly and professional AI assistant for Big D's Tree Service.
  Your goal is to collect the following information from the user to provide an estimate:
  1. Zip Code
  2. Service Type (remove, trim, stump grind, storm clean)
  3. Tree Count (number of trees/stumps)
  4. Location (Front/Back/Side yard) - Ask this specifically if unknown.
  5. Power Lines (Yes/No)
  6. Access (Easy/Medium/Hard)
  7. Haul Away (Yes/No)
  8. Contact Name & Phone (Ask these LAST, after job details).

  Current Session State: \${stateJson}
  Definitions: \${definitions}

  Instructions:
  - Analyze the user's message and extract any new information.
  - If the user provides info, update the corresponding field.
  - "Tree removal" -> serviceType: "tree_removal" (Catch both "remove" and "removal").
  - "Front yard" implies access: "easy" AND location: "front_yard".
  - If specific details are missing, ask for them politely ONE or TWO at a time.
  - Do NOT ask for everything at once.
  - If the user asks a question, answer it briefly.
  - If you have all job details (1-7), ask for Contact Name & Phone.
  - If you have Name & Phone, say "READY_FOR_FINAL" in your thought process, and tell the user you will get their photos to Corey.

  CRITICAL: You must include "updated_fields" in your JSON response for ANY new information you identify.
  Keys must match EXACTLY: zip, serviceType, treeCount, hasPowerLines, access, location, haulAway, contact.

  You must output a JSON object ONLY:
  {
    "assistant_message": "The text you reply to the user",
    "next_questions": ["Question 1", "Question 2"],
    "updated_fields": { ... }
  }
  `;
}

// ----------------------
// MAIN CHAT TURN (LLM)
// ----------------------
export async function runChatTurn(state: SessionState, userMessage: string) {
  // Update timestamp
  state.updatedAt = new Date().toISOString();
  state.messages.push({ role: "user", content: userMessage });

  let assistantMessage = "";
  let nextQuestions: string[] = [];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Using the latest mini model
      messages: [
        { role: "system", content: generateSystemPrompt(state) },
        ...state.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      response_format: { type: "json_object" },
      temperature: 0.2, // Low temp for extraction reliability
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");

    // 1. Update State (with safe coercion)
    if (result.updated_fields) {
       const u = result.updated_fields;
       if (u.zip) state.zip = u.zip;
       
       if (u.serviceType) state.serviceType = u.serviceType.toLowerCase().replace("tree removal", "tree_removal").replace("stump grinding", "stump_grinding").replace("storm cleanup", "storm_cleanup"); // Basic normalization in case LLM forgets underscore

       if (u.treeCount !== undefined) state.treeCount = typeof u.treeCount === 'string' ? parseInt(u.treeCount) : u.treeCount;
       
       if (u.hasPowerLines !== undefined) {
          if (typeof u.hasPowerLines === 'string') {
             const lower = u.hasPowerLines.toLowerCase();
             state.hasPowerLines = (lower === 'yes' || lower === 'true');
          } else {
             state.hasPowerLines = !!u.hasPowerLines;
          }
       }

       if (u.access) state.access = u.access.toLowerCase();
       if (u.location) state.location = u.location.toLowerCase().replace(" ", "_"); // front yard -> front_yard if LLM slips up

       if (u.haulAway !== undefined) {
         if (typeof u.haulAway === 'string') {
             const lower = u.haulAway.toLowerCase();
             state.haulAway = (lower === 'yes' || lower === 'true');
          } else {
             state.haulAway = !!u.haulAway;
          }
       }

       if (u.contact) {
         if (u.contact.name) state.contact.name = u.contact.name;
         if (u.contact.phone) state.contact.phone = u.contact.phone;
         if (u.contact.email) state.contact.email = u.contact.email;
       }
    }

    // 2. Set Response
    assistantMessage = result.assistant_message || "I'm sorry, I missed that. Could you repeat?";
    nextQuestions = result.next_questions || [];

  } catch (err) {
    console.error("LLM Error:", err);
    assistantMessage = "I'm having trouble connecting to my brain right now. Please check your connection or try again.";
  }

  // 3. Check Readiness
  const readyForPhotos = isReadyForPhotos(state);
  const readyForEstimate = isReadyForEstimate(state);

   // Update status
  if (readyForEstimate) {
    state.status = "ready_for_estimate";
    // We calculate it for internal records/email, but DO NOT show it to user
    state.estimate = calculateEstimate(state);
    
    assistantMessage = `Thank you! I've received your photos and details.\n\n` +
      `Corey will personally review everything to ensure accuracy and email you a custom estimate shortly.`;
  } else if (readyForPhotos) {
    state.status = "awaiting_photos";
     if (!state.hasPhotos) {
       assistantMessage = `Great, I have most of what I need! Please upload 2-4 photos:\n\n` +
      `* Wide shot showing the full tree(s)\n` +
      `* Close-up of the trunk/base\n` +
      `* Any nearby obstacles (power lines, structures)\n\n` +
      `Use the upload button below when ready.`;
     }
  } else {
    state.status = "collecting";
  }

  state.messages.push({ role: "assistant", content: assistantMessage });

  return {
    assistantMessage,
    nextQuestions,
    updatedState: state,
    readyForPhotos,
    estimate: state.estimate,
  };
}

// ----------------------
// STREAMING GENERATOR
// ----------------------
export async function* streamChatTurn(
  state: SessionState,
  userMessage: string
): AsyncGenerator<string> {
  const result = await runChatTurn(state, userMessage);

  // Simulate streaming by yielding chunks
  const words = result.assistantMessage.split(" ");
  let buffer = "";

  for (const word of words) {
    buffer += (buffer ? " " : "") + word;
    yield word + " ";
    // Small delay to simulate streaming feel
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ----------------------
// CREATE NEW SESSION
// ----------------------
export function createNewSession(sessionId: string): SessionState {
  const now = new Date().toISOString();
  return {
    sessionId,
    status: "collecting",
    createdAt: now,
    updatedAt: now,
    serviceType: "unknown",
    photoUrls: [],
    contact: {},
    messages: [],
    questions_asked: [],
  };
}

// ----------------------
// READINESS CHECKERS
// ----------------------
function isReadyForPhotos(state: SessionState): boolean {
  // Ready for photos when we have:
  // 1. Job info (service type, zip, tree count)
  // 2. Basic details (power lines, access asked)
  // 3. Contact info (phone required for finalize)
  return !!(
    state.zip &&
    state.serviceType &&
    state.serviceType !== "unknown" &&
    state.treeCount !== undefined &&
    (state.hasPowerLines !== undefined || state.questions_asked?.includes('power_lines')) &&
    (state.access !== undefined || state.questions_asked?.includes('access')) &&
    (state.location !== undefined || state.questions_asked?.includes('location')) &&
    state.contact?.phone  // Contact required before photos
  );
}

function isReadyForEstimate(state: SessionState): boolean {
  return isReadyForPhotos(state) && state.hasPhotos === true;
}

// ----------------------
// ESTIMATE CALCULATOR
// ----------------------
export function calculateEstimate(state: SessionState): Estimate {
  const drivers: string[] = [];
  let baseMin = 200;
  let baseMax = 400;

  // Service type pricing
  switch (state.serviceType) {
    case "tree_removal":
      baseMin = 500;
      baseMax = 1500;
      drivers.push("Tree removal");
      break;
    case "stump_grinding":
      baseMin = 100;
      baseMax = 400;
      drivers.push("Stump grinding");
      break;
    case "trimming":
      baseMin = 200;
      baseMax = 800;
      drivers.push("Trimming/pruning");
      break;
    case "storm_cleanup":
      baseMin = 300;
      baseMax = 1200;
      drivers.push("Storm cleanup");
      break;
  }

  // Tree count multiplier
  const count = state.treeCount || 1;
  if (count > 1) {
    baseMin *= count * 0.8; // Slight discount for multiple
    baseMax *= count * 0.9;
    drivers.push(`${count} trees/stumps`);
  }

  // Access difficulty
  if (state.access === "hard") {
    baseMin *= 1.3;
    baseMax *= 1.4;
    drivers.push("Difficult access (+30-40%)");
  } else if (state.access === "medium") {
    baseMin *= 1.1;
    baseMax *= 1.15;
    drivers.push("Gate/fence access (+10-15%)");
  }

  // Power lines
  if (state.hasPowerLines) {
    baseMin *= 1.2;
    baseMax *= 1.3;
    drivers.push("Near power lines (+20-30%)");
  }

  // Haul away
  if (state.haulAway === true) {
    baseMin += 100;
    baseMax += 200;
    drivers.push("Debris removal (+$100-200)");
  }

  // Emergency surcharge
  if (state.urgency === "emergency") {
    baseMin *= 1.5;
    baseMax *= 1.5;
    drivers.push("Emergency service (+50%)");
  }

  // Confidence based on info completeness
  let confidence: "high" | "medium" | "low" = "low";
  if (state.hasPhotos && state.treeCount && state.access) {
    confidence = "high";
  } else if (state.zip && state.serviceType !== "unknown") {
    confidence = "medium";
  }

  return {
    min: Math.round(baseMin),
    max: Math.round(baseMax),
    confidence,
    drivers,
  };
}
