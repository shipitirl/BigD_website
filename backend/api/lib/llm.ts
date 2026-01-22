// ============================================================
// LLM Service - Chat brain for extraction + question selection
// ============================================================

import OpenAI from 'openai';
import { SessionState, ExtractedPatch, ServiceType } from './session';
import { QUESTION_LIBRARY, Question } from './questions';

// ----------------------
// CONFIG
// ----------------------
const NANO_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MINI_MODEL = 'gpt-4o'; // Backup with stronger model if mini fails

// ----------------------
// RESPONSE TYPE
// ----------------------
export interface LLMResponse {
  extracted_patch: ExtractedPatch;
  next_question_id: string | null;
  ack: string;
}

// ----------------------
// SYSTEM PROMPT
// ----------------------
function buildSystemPrompt(questionLibrary: Question[]): string {
  const questionList = questionLibrary.map(q =>
    `- ${q.id}: "${q.text}" (type: ${q.type}${q.choices ? `, choices: ${q.choices.join('/')}` : ''})`
  ).join('\n');

  return `You are the friendly intake assistant for Big D's Tree Service in Janesville, Wisconsin.

PERSONALITY:
- Midwest-friendly, warm, and professional
- Talk like a helpful neighbor, not a robot
- Use casual language ("sounds good", "gotcha", "no problem")
- Show you understand their situation ("that can be a hassle", "we see that a lot")
- Keep responses SHORT and natural (1-2 sentences max)
- Be conversational and make the customer feel heard

YOUR JOB:
1. Extract any job details from the customer's message into structured fields
2. Acknowledge what they said in a natural, conversational way
3. Guide them through our intake - we need their info to provide a quote

SERVICES WE OFFER (detect which applies):
- Tree removal (including hazardous or dead trees)
- Tree trimming and pruning (structural, maintenance, aesthetic)
- Tree health inspection, diagnosis, and treatment
- Stump grinding or removal
- Tree planting and transplanting (including large tree moving)
- Shrub pruning and care
- Tree and shrub fertilization (deep root feeding)
- Soil care and analysis (root protection, aeration)
- Pest and insect management (Emerald Ash Borer treatment, etc.)
- Disease management and prevention
- Storm preparation, damage prevention, cabling and bracing
- Emergency storm response and cleanup (24/7)
- Utility vegetation management (line clearance, right-of-way)
- Land clearing and lot clearing
- Mulching and brush chipping
- Lawn care (fertilization, aeration, pest control)
- Consulting, evaluations, arborist reports
- Plant health care (PHC) programs
- Airspading (root excavation, soil improvement)
- Fire abatement and hazard reduction
- Herbicide application
- Weather and animal protection for trees
- Municipal tree management
- Tree preservation and impact mitigation

QUESTION LIBRARY (pick next_question_id from these):
${questionList}

EXTRACTION FIELDS:
- service_type: one of: "tree_removal" | "tree_trimming" | "tree_health" | "stump_grinding" | "tree_planting" | "shrub_care" | "fertilization" | "soil_care" | "pest_management" | "disease_management" | "storm_prep" | "emergency_storm" | "utility_vegetation" | "land_clearing" | "mulching" | "lawn_care" | "consulting" | "plant_health_care" | "airspading" | "fire_abatement" | "herbicide" | "weather_protection" | "municipal" | "work_planning" | "tree_preservation" | "other"
- tree_count: integer (number of trees/stumps/items)
- access: {location: "front_yard"|"backyard", gate_width_ft: number, slope: "easy"|"moderate"|"steep"}
- hazards: {power_lines: boolean, structures_nearby: boolean}
- haul_away: boolean (if they want debris removed)
- urgency: "normal"|"urgent"|"emergency"
- zip: 5-digit string
- contact: {name: string, phone: string}

EMERGENCY DETECTION - set urgency to "emergency" if:
- Storm damage, fallen tree, tree on house/car/roof
- Blocking road/driveway, dangerous situation
- Words like "emergency", "urgent", "ASAP", "need help now"

OUTPUT FORMAT (JSON only, no markdown):
{
  "extracted_patch": { ... only include fields clearly stated ... },
  "next_question_id": "zip" | null,
  "ack": "Gotcha, sounds like you need some tree trimming. We handle that all the time."
}

ACKNOWLEDGMENT EXAMPLES (be natural like these):
- "Gotcha, sounds like a removal job."
- "Ah, storm damage - we'll get you taken care of right away."
- "No problem, we do a lot of stump grinding."
- "Tree health inspection - smart move catching issues early."
- "Emerald Ash Borer treatment - we see a lot of that around here."
- "Land clearing for a new project? We can definitely help."
- "Got it, I'll make a note about the power lines."

RULES:
- ONLY include fields that were clearly stated - never guess
- Keep ack to 1-2 short sentences max
- Match the customer's energy (if they're stressed, be reassuring)
- If all required info is gathered, set next_question_id to null
- Be helpful and guide them - we want to capture their needs accurately`;
}

// ----------------------
// BUILD MESSAGES
// ----------------------
function buildMessages(
  state: SessionState,
  userMessage: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const systemPrompt = buildSystemPrompt(QUESTION_LIBRARY);

  // Build a clear summary of what we know and what's missing
  const knownFields: string[] = [];
  const missingFields: string[] = [];

  if (state.zip) knownFields.push(`zip: ${state.zip}`);
  else missingFields.push('zip');

  if (state.service_type) knownFields.push(`service: ${state.service_type}`);
  else missingFields.push('service_type');

  if (state.tree_count) knownFields.push(`count: ${state.tree_count}`);
  else missingFields.push('tree_count');

  if (state.access.location) knownFields.push(`location: ${state.access.location}`);
  else missingFields.push('access_location');

  if (state.hazards.power_lines !== null) knownFields.push(`power_lines: ${state.hazards.power_lines}`);
  else missingFields.push('power_lines');

  if (state.hazards.structures_nearby !== null) knownFields.push(`near_structures: ${state.hazards.structures_nearby}`);
  else missingFields.push('structures');

  if (state.haul_away !== null) knownFields.push(`haul_away: ${state.haul_away}`);
  else missingFields.push('haul_debris');

  const stateContext = `CURRENT JOB INFO:
Known: ${knownFields.length > 0 ? knownFields.join(', ') : 'nothing yet'}
Still need: ${missingFields.join(', ')}
Questions already asked: ${state.questions_asked?.length ? state.questions_asked.join(', ') : 'none'}
DO NOT ask any of the above questions again, even if the answer was unclear.

Full state: ${JSON.stringify({
    service_type: state.service_type,
    tree_count: state.tree_count,
    zip: state.zip,
    access: state.access,
    hazards: state.hazards,
    haul_away: state.haul_away,
    urgency: state.urgency,
    questions_asked: state.questions_asked,
  }, null, 2)}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: stateContext },
    ...state.messages.slice(-10), // Last 10 messages for context
    { role: 'user', content: userMessage },
  ];

  return messages;
}

// ----------------------
// CALL LLM
// ----------------------
export async function extractAndSelectQuestion(
  state: SessionState,
  userMessage: string,
  apiKey: string
): Promise<LLMResponse> {
  const openai = new OpenAI({ apiKey });
  const messages = buildMessages(state, userMessage);

  let model = NANO_MODEL;
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        max_completion_tokens: 500,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      // Extract JSON from response (may be wrapped in markdown or text)
      let jsonStr = content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr) as LLMResponse;

      // Validate response structure
      if (!parsed.ack || typeof parsed.ack !== 'string') {
        throw new Error('Invalid response: missing ack');
      }

      // Ensure extracted_patch exists
      parsed.extracted_patch = parsed.extracted_patch || {};

      return parsed;

    } catch (error) {
      attempts++;
      console.error(`LLM attempt ${attempts} failed (${model}):`, error);

      if (attempts === 1 && model === NANO_MODEL) {
        // Retry with more capable model
        model = MINI_MODEL;
        console.log('Retrying with', MINI_MODEL);
      } else {
        // Return fallback response
        return {
          extracted_patch: {},
          next_question_id: null, // Let getNextQuestion decide based on missing fields
          ack: "I got your message. Let me gather a few details to give you an estimate.",
        };
      }
    }
  }

  // Should never reach here, but TypeScript wants a return
  return {
    extracted_patch: {},
    next_question_id: null,
    ack: "Thanks for reaching out to Big D's Tree Service!",
  };
}

// ----------------------
// EMERGENCY DETECTION (fast, no LLM)
// ----------------------
const EMERGENCY_KEYWORDS = [
  'emergency', 'storm damage', 'fallen on', 'fell on', 'crashed into',
  'blocking road', 'blocking driveway', 'dangerous', 'urgent',
  'on my roof', 'on my car', 'on my house', 'power line down',
  'tree down on', 'limb down on', 'need help now', 'asap',
  'hit my house', 'hit the house', 'on the roof', 'leaning on',
  'about to fall', 'gonna fall', 'going to fall',
];

export function detectEmergency(text: string): boolean {
  const lower = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some(kw => lower.includes(kw));
}

// ----------------------
// SERVICE TYPE DETECTION (fast, no LLM)
// ----------------------
const SERVICE_PATTERNS: [RegExp, ServiceType][] = [
  // Emergency first (highest priority)
  [/emergency|storm.*damage|fallen.*tree|tree.*down|urgent|asap/i, 'emergency_storm'],

  // Removal & Grinding
  [/stump|grinding|grind|ground out/i, 'stump_grinding'],
  [/remov|cut.*down|take.*down|fell|get rid of.*tree|chop down|hazardous.*tree|dead.*tree/i, 'tree_removal'],

  // Trimming & Pruning
  [/trim|prun|shap|cut.*back|thin out|crown|structur.*prun|maintenan/i, 'tree_trimming'],

  // Health & Inspection
  [/health.*inspect|diagnos|treat|disease|insect|dying|sick.*tree/i, 'tree_health'],
  [/emerald ash borer|eab|pest|insect.*control|bug/i, 'pest_management'],
  [/disease|fungus|infection|rot|blight/i, 'disease_management'],

  // Planting & Moving
  [/plant|transplant|moving.*tree|big.*tree.*mov/i, 'tree_planting'],

  // Shrub & Care
  [/shrub|bush|hedge/i, 'shrub_care'],
  [/fertiliz|deep.*root.*feed|feed.*tree/i, 'fertilization'],
  [/soil|root.*protect|aerat/i, 'soil_care'],

  // Storm & Support
  [/storm.*prep|cable|brac|support.*system|prevent.*damage/i, 'storm_prep'],

  // Utility & Land
  [/utility|line.*clear|right.*of.*way|power.*line/i, 'utility_vegetation'],
  [/land.*clear|lot.*clear|clear.*land/i, 'land_clearing'],
  [/mulch|chip|brush.*chip/i, 'mulching'],

  // Lawn & Property
  [/lawn|grass|turf/i, 'lawn_care'],

  // Consulting & Reports
  [/consult|evaluat|arborist.*report|hazard.*assess|inventor/i, 'consulting'],
  [/plant.*health.*care|phc/i, 'plant_health_care'],

  // Specialized
  [/airspade|airspading|root.*excavat/i, 'airspading'],
  [/fire.*abate|fire.*hazard|wildfire/i, 'fire_abatement'],
  [/herbicide|weed.*kill|chemical/i, 'herbicide'],
  [/substation|restorat/i, 'substation'],
  [/weather.*protect|animal.*protect|wrap/i, 'weather_protection'],
  [/municipal|city.*tree|public.*tree|planning|budget/i, 'municipal'],
  [/work.*plan|vegetation.*manag/i, 'work_planning'],
  [/preserv|protect.*tree|impact.*mitigat|save.*tree/i, 'tree_preservation'],

  // Cleanup (lower priority - catch-all for debris)
  [/clean|debris|brush|limb|branch|haul away|pick up/i, 'land_clearing'],
];

export function detectServiceType(text: string): ServiceType | null {
  for (const [pattern, service] of SERVICE_PATTERNS) {
    if (pattern.test(text)) {
      return service;
    }
  }
  return null;
}
