// backend/api/lib/chatbot.ts

import { z } from "zod";
import type { SessionState, Estimate } from "./session";
import { createSession } from "./session";
import { validateLLMPatch, type SanitizedPatch } from "./validation";

// Zod schema for server-side validation
export const ChatRequestSchema = z.object({
  sessionId: z.string().nullable().optional(),
  message: z.string().min(1).max(4000),
  stream: z.boolean().optional(),
});

const LLMResponseSchema = z.object({
  assistant_message: z.string().default(""),
  next_questions: z.array(z.string()).default([]),
  updated_fields: z.record(z.any()).optional(),
  memory_note: z.string().optional(),
});

function clip(text: string, max = 280): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function pushFlowEvent(state: SessionState, kind: 'user' | 'assistant' | 'state_update' | 'status', note: string): void {
  state.flow_events.push({ at: new Date().toISOString(), kind, note: clip(note, 320) });
  if (state.flow_events.length > 40) {
    state.flow_events = state.flow_events.slice(-40);
  }
}

function mergeConversationMemory(state: SessionState, userMessage: string, assistantMessage: string, memoryNote?: string): void {
  const pieces = [
    state.conversation_memory || "",
    memoryNote ? `Note: ${clip(memoryNote, 180)}` : "",
    `User: ${clip(userMessage, 180)}`,
    `Assistant: ${clip(assistantMessage, 180)}`,
  ].filter(Boolean);

  const merged = pieces.join(" | ");
  state.conversation_memory = merged.length > 1800 ? merged.slice(merged.length - 1800) : merged;
}

function stripCodeFence(text: string): string {
  let clean = text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return clean;
}

// Some providers prepend reasoning text before the JSON payload.
// Scan brace-delimited segments and return the first parsable JSON object.
function extractParsableJSONObject(text: string): string | null {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === "\\") {
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

import OpenAI from "openai";

// Get LLM config at RUNTIME (not build time) to pick up Vercel env vars
function getLLMConfig() {
  const provider = (process.env.LLM_PROVIDER || (process.env.MINIMAX_API_KEY ? "minimax" : "openai")).toLowerCase();
  const model = process.env.LLM_MODEL ||
    (provider === "minimax"
      ? (process.env.MINIMAX_MODEL || "MiniMax-M2.5")
      : (process.env.OPENAI_MODEL || "gpt-5.1"));
  return { provider, model };
}

// Cache the client at runtime - but check provider each time to handle env changes
let _runtimeClient: OpenAI | null = null;
let _cachedProvider: string | null = null;
function getRuntimeClient(): OpenAI {
  const { provider } = getLLMConfig();
  // Recreate client if provider changed (e.g., after env update)
  if (!_runtimeClient || _cachedProvider !== provider) {
    _runtimeClient = new OpenAI(
      provider === "minimax"
        ? {
            apiKey: process.env.MINIMAX_API_KEY,
            baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1",
          }
        : {
            apiKey: process.env.OPENAI_API_KEY,
          }
    );
    _cachedProvider = provider;
    console.log(`[LLM] Created new client for provider: ${provider}`);
  }
  return _runtimeClient;
}

// ----------------------
// LLM PROMPT GENERATOR
// ----------------------
function generateSystemPrompt(state: SessionState): string {
  const definitions = `
  - Service Types: tree_removal, tree_trimming, stump_grinding, emergency_storm, storm_prep, land_clearing, other
  - Access Location: front_yard, backyard
  - Slope: easy, moderate, steep
  - Urgency: normal, urgent, emergency
  `;

  // Build state with explicit notes for LLM to understand null vs false
  const stateJson = JSON.stringify({
    zip: state.zip || null,
    service_type: state.service_type || null,
    tree_count: state.tree_count || null,
    urgency: state.urgency, // "normal", "urgent", or "emergency"
    access: {
      location: state.access.location || null,
      gate_width_ft: state.access.gate_width_ft,
      slope: state.access.slope || null,
    },
    hazards: {
      // null = not asked yet, false = user said NO, true = user said YES
      power_lines: state.hazards.power_lines,
      structures_nearby: state.hazards.structures_nearby,
    },
    // null = not asked, true = yes, false = no, "unsure" = user doesn't know (valid answer)
    haul_away: state.haul_away,
    contact: state.contact,
    // Fields we've already asked about (don't re-ask these)
    questions_asked: state.questions_asked || [],
    // Rolling memory summary + recent flow events for long sessions
    conversation_memory: state.conversation_memory || null,
    flow_events: (state.flow_events || []).slice(-8),
  });

  return `You are Corey, the friendly and professional AI assistant for Big D's Tree Service.
  Your goal is to collect the following information from the user to provide an estimate:
  1. Zip Code (5-digit number)
  2. Service Type (remove, trim, stump grind, storm clean)
  3. Tree Count (number of trees/stumps)
  4. Location (Front yard / Backyard) - Ask this specifically if unknown.
  5. Power Lines (Yes/No)
  6. Structures Nearby (Yes/No)
  7. Slope (Easy/Moderate/Steep)
  8. Haul Away (Yes/No)
  9. Contact Name, Phone, Email, Address, and City (Ask these LAST, after job details, BUT BEFORE PHOTOS).

  Current Session State: ${stateJson}
  Definitions: ${definitions}

  Instructions:

  CRITICAL - EXTRACTION FIRST:
  - BEFORE responding, carefully scan the ENTIRE user message and extract ALL relevant information.
  - Users may provide multiple details in one message (e.g., "I need 3 trees removed from my backyard at 75201, there are power lines nearby").
  - You MUST capture every piece of information provided, even if it's embedded in a longer message.
  - Include ALL extracted fields in "updated_fields" - do not ignore information just because multiple details were given at once.

  FIELD EXTRACTION HINTS:
  - "Tree removal", "remove", "cut down", "take out" -> service_type: "tree_removal"
  - "Trim", "trimming", "prune", "pruning" -> service_type: "tree_trimming"
  - "Stump", "grind", "grinding" -> service_type: "stump_grinding"
  - "Storm", "emergency", "fallen", "fell", "broke", "crashed", "down", "tree fell", "tree down" -> service_type: "emergency_storm"
  - NOTE: If a tree "fell on" something, it's emergency_storm AND implies tree_count: 1
  - "Front yard", "front" -> access.location: "front_yard"
  - "Backyard", "back yard", "back" -> access.location: "backyard"
  - 5-digit numbers -> likely zip code
  - Numbers followed by "tree(s)" or in context of trees -> tree_count
  - "A tree", "the tree", "a huge tree", "one tree" (singular) -> tree_count: 1
  - "Power lines", "wires", "electrical" -> hazards.power_lines: true
  - "Near house", "close to building", "by the fence" -> hazards.structures_nearby: true
  - "On my house", "hit my house", "on my car", "on my roof", "on the garage", "fell on my house", "fell on house" -> hazards.structures_nearby: true
  - "Flat", "level", "no slope" -> access.slope: "easy"
  - "Hill", "slight incline", "some slope" -> access.slope: "moderate"
  - "Steep", "very hilly", "significant slope", "wet", "soft ground" -> access.slope: "steep"

  URGENCY DETECTION (set urgency field):
  - "Fell on my house", "on my roof", "blocking driveway", "can't get out", "dangerous", "urgent", "ASAP", "emergency", "right away" -> urgency: "emergency"
  - If service_type is "emergency_storm" AND tree is on/near a structure -> urgency: "emergency"

  CONVERSATIONAL STYLE:
  - After extracting all info, acknowledge what you understood (e.g., "Got it - 3 trees for removal in the backyard at 75201, with power lines nearby.")
  - Then ask ONLY for the remaining MISSING details (fields that are null in the Current Session State), ONE or TWO at a time.
  - CRITICAL STATE INTERPRETATION:
    * null = NOT ASKED YET (you should ask)
    * false = USER SAID "NO" (do NOT re-ask!)
    * true = USER SAID "YES" (do NOT re-ask!)
    * "unsure" for haul_away = USER DOESN'T KNOW (valid final answer, do NOT re-ask!)
  - CRITICAL: NEVER ask for information that is already present in the session state above. Check the state BEFORE asking each question.
    * If tree_count is NOT null, do NOT ask "How many trees"
    * If zip is NOT null, do NOT ask for zip code
    * If service_type is NOT null, do NOT ask what service they need
    * If hazards.power_lines is true OR false, do NOT ask about power lines (only ask if null)
    * If haul_away is true, false, OR "unsure", do NOT ask about haul away
    * etc.
  - PHRASING RULE: When asking for tree count (ONLY if tree_count is null), use: "How many trees and/or stumps seem to have issues?"
  - If the user asks a question, answer it briefly.
  - If you have all job details (1-8), ask for Contact Name, Phone, AND Email.
  - EMAIL VALIDATION: An email is valid if it matches this pattern: <local>@<domain>.<tld> where:
    * local part: letters, numbers, dots, underscores, hyphens (e.g., "john.doe", "user123")
    * domain: letters, numbers, hyphens (e.g., "gmail", "company-name")
    * tld: 2+ letters (e.g., "com", "org", "co.uk")
    * VALID examples: john@gmail.com, user.name@company.org, test123@mail.co.uk
    * INVALID examples: john@ (no domain), @gmail.com (no local), john@.com (empty domain), john@com (no TLD dot)
  - ONLY when you have Name, Phone, valid Email, Address, and City, should you say "READY_FOR_PHOTOS" in your thought process.
  - Tell the user: "Thanks! Now I just need to see the trees. Please upload a few photos so Corey can give you an accurate estimate."

  CRITICAL: You must include "updated_fields" in your JSON response for ANY new information you identify.
  Keys must match EXACTLY: zip, service_type, tree_count, access, hazards, haul_away, urgency, contact.
  - access is an object: { location: "front_yard"|"backyard", gate_width_ft: number|null, slope: "easy"|"moderate"|"steep" }
  - hazards is an object: { power_lines: boolean, structures_nearby: boolean }
  - urgency is a string: "normal" | "urgent" | "emergency"
  - contact is an object: { name: string, phone: string, email: string, address: string, city: string }

  You must output a JSON object ONLY:
  {
    "assistant_message": "The text you reply to the user",
    "next_questions": ["Question 1", "Question 2"],
    "updated_fields": { ... },
    "memory_note": "Optional one-line summary of what changed this turn"
  }
  `;
}

// ----------------------
// APPLY VALIDATED PATCH TO STATE
// ----------------------
function applyValidatedPatch(state: SessionState, patch: SanitizedPatch, rawFields: any): void {
  // Apply validated fields from validation layer
  if (patch.zip) state.zip = patch.zip;
  if (patch.service_type) state.service_type = patch.service_type as SessionState['service_type'];
  if (patch.tree_count !== undefined) state.tree_count = patch.tree_count;
  if (patch.urgency) state.urgency = patch.urgency as SessionState['urgency'];
  if (patch.haul_away !== undefined) state.haul_away = patch.haul_away;

  // Handle access object
  if (patch.access) {
    if (patch.access.location) {
      state.access.location = patch.access.location as SessionState['access']['location'];
    }
    if (patch.access.gate_width_ft !== undefined) {
      state.access.gate_width_ft = patch.access.gate_width_ft;
    }
    if (patch.access.slope) {
      state.access.slope = patch.access.slope as SessionState['access']['slope'];
    }
  }

  // Handle hazards object
  if (patch.hazards) {
    if (patch.hazards.power_lines !== undefined) {
      state.hazards.power_lines = patch.hazards.power_lines;
    }
    // Handle both field names (structures_nearby and nearby_structures)
    const structuresNearby = (patch.hazards as any).structures_nearby ?? (patch.hazards as any).nearby_structures;
    if (structuresNearby !== undefined) {
      state.hazards.structures_nearby = structuresNearby;
    }
  }

  // Handle contact - validation layer uses name/phone/email/address/city at root level
  if (patch.name) state.contact.name = patch.name;
  if (patch.phone) state.contact.phone = patch.phone;
  if (patch.email) state.contact.email = patch.email;
  if ((patch as any).address) state.contact.address = (patch as any).address;
  if ((patch as any).city) state.contact.city = (patch as any).city;

  // Handle nested contact object from validated patch
  if ((patch as any).contact) {
    const c = (patch as any).contact;
    if (c.name) state.contact.name = c.name;
    if (c.phone) state.contact.phone = c.phone;
    if (c.email) state.contact.email = c.email;
    if (c.address) state.contact.address = c.address;
    if (c.city) state.contact.city = c.city;
  }

  // Handle location at root level from validated patch
  if ((patch as any).location) {
    state.access.location = (patch as any).location as SessionState['access']['location'];
  }

  // Also check nested contact from raw LLM output (fallback)
  if (rawFields.contact) {
    if (rawFields.contact.name) state.contact.name = rawFields.contact.name;
    if (rawFields.contact.phone && !state.contact.phone) state.contact.phone = rawFields.contact.phone;
    if (rawFields.contact.email && !state.contact.email) state.contact.email = rawFields.contact.email;
    if (rawFields.contact.address && !state.contact.address) state.contact.address = rawFields.contact.address;
    if (rawFields.contact.city && !state.contact.city) state.contact.city = rawFields.contact.city;
  }

  // Handle access.location from raw fields if validation didn't catch it
  if (rawFields.access?.location && !state.access.location) {
    const loc = String(rawFields.access.location).toLowerCase().replace(" ", "_");
    state.access.location = loc === 'backyard' ? 'backyard' : 'front_yard';
  }
}

// ----------------------
// MANUAL EXTRACTION FALLBACK
// ----------------------
function applyManualExtraction(state: SessionState, u: any): void {
  // Fallback extraction when validation rejects the patch
  if (u.zip) state.zip = String(u.zip);

  if (u.service_type) {
    const normalized = String(u.service_type).toLowerCase()
      .replace("tree removal", "tree_removal")
      .replace("stump grinding", "stump_grinding")
      .replace("storm cleanup", "emergency_storm")
      .replace("tree trimming", "tree_trimming")
      .replace("storm prep", "storm_prep")
      .replace(" ", "_");
    state.service_type = normalized as SessionState['service_type'];
  }

  if (u.tree_count !== undefined) {
    state.tree_count = typeof u.tree_count === 'string' ? parseInt(u.tree_count) : u.tree_count;
  }

  if (u.access) {
    if (u.access.location) {
      const loc = String(u.access.location).toLowerCase().replace(" ", "_");
      state.access.location = loc === 'backyard' ? 'backyard' : 'front_yard';
    }
    if (u.access.gate_width_ft !== undefined) {
      state.access.gate_width_ft = typeof u.access.gate_width_ft === 'string'
        ? parseInt(u.access.gate_width_ft)
        : u.access.gate_width_ft;
    }
    if (u.access.slope) {
      const slope = String(u.access.slope).toLowerCase();
      state.access.slope = (slope === 'steep' || slope === 'moderate') ? slope : 'easy';
    }
  }

  if (u.hazards) {
    if (u.hazards.power_lines !== undefined) {
      state.hazards.power_lines = u.hazards.power_lines === true ||
        String(u.hazards.power_lines).toLowerCase() === 'yes' ||
        String(u.hazards.power_lines).toLowerCase() === 'true';
    }
    if (u.hazards.structures_nearby !== undefined) {
      state.hazards.structures_nearby = u.hazards.structures_nearby === true ||
        String(u.hazards.structures_nearby).toLowerCase() === 'yes' ||
        String(u.hazards.structures_nearby).toLowerCase() === 'true';
    }
  }

  if (u.haul_away !== undefined) {
    if (typeof u.haul_away === 'string') {
      const lower = u.haul_away.toLowerCase();
      state.haul_away = lower === 'unsure' ? 'unsure' : (lower === 'yes' || lower === 'true');
    } else {
      state.haul_away = !!u.haul_away;
    }
  }

  if (u.urgency) {
    const urgency = String(u.urgency).toLowerCase();
    state.urgency = (urgency === 'emergency' || urgency === 'urgent') ? 'emergency' : 'normal';
  }

  if (u.contact) {
    if (u.contact.name) state.contact.name = u.contact.name;
    if (u.contact.phone) state.contact.phone = u.contact.phone;
    if (u.contact.email) state.contact.email = u.contact.email;
    if (u.contact.address) state.contact.address = u.contact.address;
    if (u.contact.city) state.contact.city = u.contact.city;
  }
}

// ----------------------
// MAIN CHAT TURN (LLM)
// ----------------------
export async function runChatTurn(state: SessionState, userMessage: string) {
  const { provider, model } = getLLMConfig();
  const client = getRuntimeClient();
  console.log("[runChatTurn] START - provider:", provider, "model:", model);
  // Update timestamp
  state.updated_at = new Date().toISOString();
  state.messages.push({ role: "user", content: userMessage });
  pushFlowEvent(state, 'user', userMessage);

  let assistantMessage = "";
  let nextQuestions: string[] = [];
  let memoryNote: string | undefined;

  try {
    const systemPrompt = generateSystemPrompt(state);
    console.log(`[LLM] Provider=${provider} model=${model} baseURL=${process.env.MINIMAX_BASE_URL || "default"} keypresent=${!!process.env.MINIMAX_API_KEY}`);
    console.log(`[LLM] User message length: ${userMessage.length} chars`);

    // FIX #3: Truncate message history to last 15 messages to reduce latency
    const MAX_MESSAGES = 15;
    const truncatedMessages = state.messages.length > MAX_MESSAGES
      ? state.messages.slice(-MAX_MESSAGES)
      : state.messages;

    console.log(`[LLM] Sending ${truncatedMessages.length} messages (truncated from ${state.messages.length})`);

    let completion;
    try {
      completion = await client.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          ...truncatedMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
        response_format: { type: "json_object" },

        max_completion_tokens: 1500, // More room for detailed responses
      });
    } catch (llmErr: any) {
      console.error("[LLM] Call failed:", llmErr?.message || llmErr);
      console.error("[LLM] Call failed details:", JSON.stringify(llmErr?.response?.data || llmErr));
      throw llmErr;
    }

    const rawContent = completion.choices[0]?.message?.content || "";
    const finishReason = completion.choices[0]?.finish_reason;

    console.log(`[LLM] Finish reason: ${finishReason}`);
    console.log(`[LLM] Raw content length: ${rawContent.length}`);

    // Handle empty or malformed response
    if (!rawContent || rawContent.trim() === "") {
      console.error("LLM returned empty response. Full completion object:", JSON.stringify(completion));
      assistantMessage = "I didn't catch that. Could you please repeat what you said?";
    } else {
      let result: z.infer<typeof LLMResponseSchema> = { assistant_message: "", next_questions: [] };
      try {
        const cleanContent = stripCodeFence(rawContent);
        const jsonPayload = extractParsableJSONObject(cleanContent) || cleanContent;

        const parsedResult = LLMResponseSchema.safeParse(JSON.parse(jsonPayload));
        if (parsedResult.success) {
          result = parsedResult.data;
        } else {
          console.error("LLM schema validation error:", parsedResult.error.flatten());
          assistantMessage = "I had a hiccup processing that. Could you please try again?";
        }
      } catch (parseError) {
        console.error("LLM JSON parse error:", parseError, "Raw:", rawContent.substring(0, 200));
        assistantMessage = "I had a hiccup processing that. Could you please try again?";
      }

      // 1. Validate and Update State using validation layer
      if (result.updated_fields) {
         console.log(`[LLM] Raw extracted fields:`, JSON.stringify(result.updated_fields, null, 2));

         // Validate through validation layer (handles type coercion, range checks, etc.)
         const validation = validateLLMPatch(result.updated_fields, state.service_type || undefined);

         if (validation.ok) {
           const patch = validation.patch;
           if (validation.warnings?.length) {
             console.log(`[Validation] Warnings:`, validation.warnings);
           }

           // Apply validated patch to state
           applyValidatedPatch(state, patch, result.updated_fields);
           console.log(`[LLM] Applied validated fields`);
         } else {
           const failure = validation as { reason: string; details: string };
           console.warn(`[Validation] Rejected: ${failure.reason} - ${failure.details}`);
           // Fall back to manual extraction for rejected patches
           applyManualExtraction(state, result.updated_fields);
         }
      } else {
         console.log(`[LLM] No updated_fields in response`);
      }

      // 2. Set Response
      if (result.assistant_message) {
        assistantMessage = result.assistant_message;
      }
      nextQuestions = result.next_questions || [];
      memoryNote = result.memory_note;

      // FIX #1: Track questions asked to prevent repeating questions
      // Map common question patterns to question IDs
      if (nextQuestions.length > 0 || result.assistant_message) {
        const questionPatterns: Array<{ pattern: RegExp; id: string }> = [
          { pattern: /zip\s*code|what.*zip|your\s*zip/i, id: 'zip' },
          { pattern: /how\s*many\s*tree|tree.*count|number\s*of\s*tree/i, id: 'tree_count' },
          { pattern: /haul\s*away|debris|take.*away|remove.*material/i, id: 'haul_debris' },
          { pattern: /front\s*yard|backyard|where.*located|work\s*area\s*located/i, id: 'access_location' },
          { pattern: /gate\s*width|how\s*wide.*gate/i, id: 'gate_width' },
          { pattern: /slope|steep|ground\s*condition|wet.*ground/i, id: 'slope' },
          { pattern: /power\s*line|electrical|wire/i, id: 'power_lines' },
          { pattern: /structure|house|garage|fence|building/i, id: 'structures' },
          { pattern: /your\s*name|what.*name/i, id: 'contact_name' },
          { pattern: /phone\s*number|reach\s*you|call\s*you/i, id: 'contact_phone' },
          { pattern: /email\s*address|your\s*email/i, id: 'contact_email' },
          { pattern: /address|street\s*address/i, id: 'contact_address' },
          { pattern: /city/i, id: 'contact_city' },
        ];

        const textToCheck = [...nextQuestions, result.assistant_message || ''].join(' ');

        for (const { pattern, id } of questionPatterns) {
          if (pattern.test(textToCheck) && !state.questions_asked.includes(id)) {
            state.questions_asked.push(id);
            console.log(`[Questions] Marked as asked: ${id}`);
          }
        }
      }
    }

  } catch (err: any) {
    console.error("LLM Error:", err);
    const errMsg = err?.message || err?.toString() || "Unknown error";
    const errType = err?.constructor?.name || "Error";
    console.error(`[LLM] Error type: ${errType}, message: ${errMsg}`);
    if (err?.response?.data) {
      console.error("[LLM] Response data:", JSON.stringify(err.response.data));
    }
    // Add debug info to state for response
    (state as any)._debug_error = `ERR: ${errType} - ${errMsg}`;
    assistantMessage = `I'm having trouble connecting to my brain right now (${errType}). Please check your connection or try again.`;
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
     if (!state.photos_uploaded) {
       assistantMessage = `Great, I have most of what I need! Please upload 2-4 photos:\n\n` +
      `* Wide shot showing the full tree(s)\n` +
      `* Close-up of the trunk/base\n` +
      `* Any nearby obstacles (power lines, structures)\n\n` +
      `Use the upload button below when ready.`;
     }
  } else {
    state.status = "collecting";
  }

  mergeConversationMemory(state, userMessage, assistantMessage, memoryNote);
  pushFlowEvent(state, 'assistant', assistantMessage);
  pushFlowEvent(state, 'status', `status=${state.status}`);
  state.messages.push({ role: "assistant", content: assistantMessage });

  const debugInfo = (state as any)._debug_error || null;
  return {
    assistantMessage,
    nextQuestions,
    updatedState: state,
    readyForPhotos,
    estimate: state.estimate,
    debug: debugInfo,
  };
}

// ----------------------
// INCREMENTAL JSON PARSER FOR STREAMING
// Extracts assistant_message content as it streams in
// ----------------------
class AssistantMessageExtractor {
  private buffer = "";
  private inAssistantMessage = false;
  private foundKey = false;
  private stringDepth = 0;
  private escapeNext = false;

  // Feed a chunk and get any extractable assistant_message content
  feed(chunk: string): string {
    let output = "";

    for (const char of chunk) {
      this.buffer += char;

      if (this.inAssistantMessage) {
        // We're inside the assistant_message string value
        if (this.escapeNext) {
          // Previous char was \, so this char is escaped
          output += char;
          this.escapeNext = false;
        } else if (char === "\\") {
          // Escape character - next char is escaped
          this.escapeNext = true;
          output += char;
        } else if (char === '"') {
          // End of assistant_message string
          this.inAssistantMessage = false;
        } else {
          output += char;
        }
      } else {
        // Looking for "assistant_message": "
        if (!this.foundKey && this.buffer.includes('"assistant_message"')) {
          this.foundKey = true;
        }

        if (this.foundKey && !this.inAssistantMessage) {
          // Look for the opening quote of the value
          // Pattern: "assistant_message": "  or  "assistant_message":"
          const match = this.buffer.match(/"assistant_message"\s*:\s*"/);
          if (match) {
            this.inAssistantMessage = true;
            // Clear buffer to avoid re-matching
            this.buffer = "";
          }
        }
      }
    }

    // Unescape common JSON escape sequences for display
    return output
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  reset() {
    this.buffer = "";
    this.inAssistantMessage = false;
    this.foundKey = false;
    this.stringDepth = 0;
    this.escapeNext = false;
  }
}

// ----------------------
// STREAMING GENERATOR (Real OpenAI streaming with incremental JSON parsing)
// ----------------------
export async function* streamChatTurn(
  state: SessionState,
  userMessage: string
): AsyncGenerator<string> {
  // Get runtime config
  const { provider, model } = getLLMConfig();
  const client = getRuntimeClient();
  
  // Update timestamp and add user message
  state.updated_at = new Date().toISOString();
  state.messages.push({ role: "user", content: userMessage });
  pushFlowEvent(state, 'user', userMessage);

  const systemPrompt = generateSystemPrompt(state);
  console.log(`[Stream] Provider=${provider} model=${model}`);

  // Truncate message history to last 15 messages
  const MAX_MESSAGES = 15;
  const truncatedMessages = state.messages.length > MAX_MESSAGES
    ? state.messages.slice(-MAX_MESSAGES)
    : state.messages;

  let fullContent = "";
  let assistantMessage = "";
  let memoryNote: string | undefined;
  const extractor = new AssistantMessageExtractor();

  try {
    // Use actual OpenAI streaming
    const stream = await client.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        ...truncatedMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      stream: true,
    });

    // Stream chunks as they arrive, extracting assistant_message content
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullContent += content;

        // Extract and yield assistant_message content incrementally
        const extracted = extractor.feed(content);
        if (extracted) {
          assistantMessage += extracted;
          yield extracted;
        }
      }
    }

    // Parse the complete JSON response for state updates
    let result: z.infer<typeof LLMResponseSchema> = { assistant_message: assistantMessage, next_questions: [] };
    try {
      const cleanContent = stripCodeFence(fullContent);
      const jsonPayload = extractParsableJSONObject(cleanContent) || cleanContent;
      const parsedResult = LLMResponseSchema.safeParse(JSON.parse(jsonPayload));
      if (parsedResult.success) {
        result = parsedResult.data;
        memoryNote = result.memory_note;
      } else {
        console.error("[Stream] Schema validation error:", parsedResult.error.flatten());
      }
    } catch (parseError) {
      console.error("[Stream] JSON parse error:", parseError);
    }

    // Apply state updates
    if (result.updated_fields) {
      const validation = validateLLMPatch(result.updated_fields, state.service_type || undefined);
      if (validation.ok) {
        applyValidatedPatch(state, validation.patch, result.updated_fields);
      } else {
        applyManualExtraction(state, result.updated_fields);
      }
    }

    // Use parsed assistant_message if extractor missed anything
    if (!assistantMessage && result.assistant_message) {
      assistantMessage = result.assistant_message;
      yield assistantMessage;
    }

    // Track questions asked
    const nextQuestions = result.next_questions || [];
    if (nextQuestions.length > 0 || assistantMessage) {
      const questionPatterns: Array<{ pattern: RegExp; id: string }> = [
        { pattern: /zip\s*code|what.*zip|your\s*zip/i, id: 'zip' },
        { pattern: /how\s*many\s*tree|tree.*count|number\s*of\s*tree/i, id: 'tree_count' },
        { pattern: /haul\s*away|debris|take.*away|remove.*material/i, id: 'haul_debris' },
        { pattern: /front\s*yard|backyard|where.*located|work\s*area\s*located/i, id: 'access_location' },
        { pattern: /gate\s*width|how\s*wide.*gate/i, id: 'gate_width' },
        { pattern: /slope|steep|ground\s*condition|wet.*ground/i, id: 'slope' },
        { pattern: /power\s*line|electrical|wire/i, id: 'power_lines' },
        { pattern: /structure|house|garage|fence|building/i, id: 'structures' },
        { pattern: /your\s*name|what.*name/i, id: 'contact_name' },
        { pattern: /phone\s*number|reach\s*you|call\s*you/i, id: 'contact_phone' },
        { pattern: /email\s*address|your\s*email/i, id: 'contact_email' },
        { pattern: /address|street\s*address/i, id: 'contact_address' },
        { pattern: /city/i, id: 'contact_city' },
      ];

      const textToCheck = [...nextQuestions, assistantMessage].join(' ');
      for (const { pattern, id } of questionPatterns) {
        if (pattern.test(textToCheck) && !state.questions_asked.includes(id)) {
          state.questions_asked.push(id);
        }
      }
    }

  } catch (err) {
    console.error("[Stream] LLM Error:", err);
    assistantMessage = "I'm having trouble connecting right now. Please try again.";
    yield assistantMessage;
  }

  // Check readiness and update status
  const readyForPhotos = isReadyForPhotos(state);
  const readyForEstimate = isReadyForEstimate(state);

  if (readyForEstimate) {
    state.status = "ready_for_estimate";
    state.estimate = calculateEstimate(state);
    assistantMessage = `Thank you! I've received your photos and details.\n\nCorey will personally review everything to ensure accuracy and email you a custom estimate shortly.`;
    yield `\n\n${assistantMessage}`;
  } else if (readyForPhotos && !state.photos_uploaded) {
    state.status = "awaiting_photos";
    const photoMsg = `\n\nGreat, I have most of what I need! Please upload 2-4 photos:\n\n* Wide shot showing the full tree(s)\n* Close-up of the trunk/base\n* Any nearby obstacles (power lines, structures)\n\nUse the upload button below when ready.`;
    assistantMessage += photoMsg;
    yield photoMsg;
  } else {
    state.status = "collecting";
  }

  mergeConversationMemory(state, userMessage, assistantMessage, memoryNote);
  pushFlowEvent(state, 'assistant', assistantMessage);
  pushFlowEvent(state, 'status', `status=${state.status}`);
  state.messages.push({ role: "assistant", content: assistantMessage });
}

// ----------------------
// CREATE NEW SESSION
// ----------------------
export function createNewSession(sessionId: string): SessionState {
  const session = createSession();
  // Override the generated lead_id with the provided sessionId
  session.lead_id = sessionId;
  return session;
}

// ----------------------
// READINESS CHECKERS
// ----------------------
function isReadyForPhotos(state: SessionState): boolean {
  // Ready for photos when we have:
  // 1. Job info (service type, zip, tree count)
  // 2. Basic details (power lines, access location asked)
  // 3. Contact info (name, phone, email required BEFORE photos)
  return !!(
    state.zip &&
    state.service_type &&
    state.tree_count !== null &&
    (state.hazards.power_lines !== null || state.questions_asked?.includes('power_lines')) &&
    (state.access.location !== null || state.questions_asked?.includes('access_location')) &&
    (state.access.slope !== null || state.questions_asked?.includes('slope')) &&
    !!state.contact?.name &&
    !!state.contact?.phone &&
    !!state.contact?.email &&
    !!state.contact?.address &&
    !!state.contact?.city
  );
}

function isReadyForEstimate(state: SessionState): boolean {
  return isReadyForPhotos(state) && state.photos_uploaded === true;
}

// ----------------------
// ESTIMATE CALCULATOR
// ----------------------
export function calculateEstimate(state: SessionState): Estimate {
  const drivers: string[] = [];
  let baseMin = 200;
  let baseMax = 400;

  // Service type pricing
  switch (state.service_type) {
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
    case "tree_trimming":
      baseMin = 200;
      baseMax = 800;
      drivers.push("Trimming/pruning");
      break;
    case "storm_prep":
    case "emergency_storm":
      baseMin = 300;
      baseMax = 1200;
      drivers.push("Storm cleanup/prep");
      break;
    case "land_clearing":
      baseMin = 800;
      baseMax = 3000;
      drivers.push("Land clearing");
      break;
  }

  // Tree count multiplier
  const count = state.tree_count || 1;
  if (count > 1) {
    baseMin *= count * 0.8; // Slight discount for multiple
    baseMax *= count * 0.9;
    drivers.push(`${count} trees/stumps`);
  }

  // Access difficulty based on slope and backyard location
  if (state.access.slope === "steep") {
    baseMin *= 1.3;
    baseMax *= 1.4;
    drivers.push("Steep slope (+30-40%)");
  } else if (state.access.slope === "moderate") {
    baseMin *= 1.1;
    baseMax *= 1.15;
    drivers.push("Moderate slope (+10-15%)");
  }

  // Backyard with narrow gate
  if (state.access.location === "backyard" && state.access.gate_width_ft !== null && state.access.gate_width_ft < 4) {
    baseMin *= 1.15;
    baseMax *= 1.2;
    drivers.push("Narrow gate access (+15-20%)");
  }

  // Power lines
  if (state.hazards.power_lines === true) {
    baseMin *= 1.2;
    baseMax *= 1.3;
    drivers.push("Near power lines (+20-30%)");
  }

  // Structures nearby
  if (state.hazards.structures_nearby === true) {
    baseMin *= 1.1;
    baseMax *= 1.15;
    drivers.push("Near structures (+10-15%)");
  }

  // Haul away
  if (state.haul_away === true) {
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
  if (state.photos_uploaded && state.tree_count && state.access.location) {
    confidence = "high";
  } else if (state.zip && state.service_type !== null) {
    confidence = "medium";
  }

  return {
    min: Math.round(baseMin),
    max: Math.round(baseMax),
    confidence,
    drivers,
  };
}
