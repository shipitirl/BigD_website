// ============================================================
// Question Library - Fixed bank of intake questions
// ============================================================

import { SessionState, getMissingFields } from './session';

// ----------------------
// TYPES
// ----------------------
export type QuestionType = 'text' | 'buttons' | 'phone';

export interface Question {
  id: string;
  priority: number;
  text: string;
  field: string;
  type: QuestionType;
  choices?: string[];
  validation?: RegExp;
  condition?: (state: SessionState) => boolean;
}

// ----------------------
// QUESTION DEFINITIONS
// ZIP first to qualify location, then job details, photos before estimate, contact after photos
// ----------------------
export const QUESTION_LIBRARY: Question[] = [
  {
    id: 'zip',
    priority: 1,
    text: "First, what's your zip code so I can confirm you're in our service area?",
    field: 'zip',
    type: 'text',
    validation: /^\d{5}$/,
  },
  {
    id: 'tree_count',
    priority: 2,
    text: 'How many trees, stumps, or areas are we looking at?',
    field: 'tree_count',
    type: 'buttons',
    choices: ['Just 1', '2-3', '4 or more'],
  },
  {
    id: 'haul_debris',
    priority: 3,
    text: 'Would you like us to haul away any debris or material when done?',
    field: 'haul_away',
    type: 'buttons',
    choices: ['Yes, take everything', 'No, leave it', 'Not sure yet'],
  },
  {
    id: 'access_location',
    priority: 4,
    text: 'Where is the work area located?',
    field: 'access.location',
    type: 'buttons',
    choices: ['Front yard', 'Backyard'],
  },
  {
    id: 'gate_width',
    priority: 5,
    text: "About how wide is your gate? (We need at least 3ft for most equipment)",
    field: 'access.gate_width_ft',
    type: 'buttons',
    choices: ['Under 3 ft', '3-5 ft', '6+ ft', 'No gate needed'],
    condition: (state) => state.access.location === 'backyard',
  },
  {
    id: 'slope',
    priority: 6,
    text: 'Is there any steep slope or soft/wet ground in the work area?',
    field: 'access.slope',
    type: 'buttons',
    choices: ['Flat/easy ground', 'Some slope', 'Steep or wet/soft'],
  },
  {
    id: 'power_lines',
    priority: 7,
    text: 'Are there any power lines nearby (within 10 feet)?',
    field: 'hazards.power_lines',
    type: 'buttons',
    choices: ['Yes, power lines nearby', 'No power lines', 'Not sure'],
  },
  {
    id: 'structures',
    priority: 8,
    text: 'Is the work area close to any structures (house, garage, fence, etc.)?',
    field: 'hazards.structures_nearby',
    type: 'buttons',
    choices: ['Yes, near structures', 'No, open area', 'Not sure'],
  },
  {
    id: 'contact_name',
    priority: 10,
    text: "Almost done! What's your name?",
    field: 'contact.name',
    type: 'text',
    // Contact info is collected after job questions, before photo upload
  },
  {
    id: 'contact_phone',
    priority: 11,
    text: "And what's the best phone number to reach you?",
    field: 'contact.phone',
    type: 'phone',
    // Contact info is collected after job questions, before photo upload
  },
];

// ----------------------
// QUESTION SELECTION
// ----------------------
export function getNextQuestion(state: SessionState): Question | null {
  const missing = getMissingFields(state);

  if (missing.length === 0) {
    return null; // All required fields collected
  }

  // Track which questions have already been asked to prevent repetition
  const alreadyAsked = new Set(state.questions_asked || []);

  // Map missing field names to question IDs
  // NOTE: service_type is auto-detected, not asked - so not included here
  const fieldToQuestionId: Record<string, string> = {
    'tree_count': 'tree_count',
    'zip': 'zip',
    'haul_debris': 'haul_debris',
    'access_location': 'access_location',
    'gate_width': 'gate_width',
    'slope': 'slope',
    'power_lines': 'power_lines',
    'structures': 'structures',
    'contact_phone': 'contact_phone',
    'contact_name': 'contact_name',
  };

  // Sort by priority and find first missing question that meets conditions
  const sortedQuestions = [...QUESTION_LIBRARY].sort((a, b) => a.priority - b.priority);

  for (const question of sortedQuestions) {
    const questionId = question.id;
    const isMissing = missing.some(m => fieldToQuestionId[m] === questionId);

    if (isMissing) {
      // Skip if already asked (even if answer wasn't captured)
      if (alreadyAsked.has(questionId)) {
        continue;
      }
      // Check condition if present
      if (question.condition && !question.condition(state)) {
        continue;
      }
      return question;
    }
  }

  return null;
}

// ----------------------
// ANSWER PARSING
// ----------------------
export function parseAnswer(questionId: string, rawText: string): unknown {
  const text = rawText.trim().toLowerCase();

  switch (questionId) {
    case 'zip':
      const zipMatch = text.match(/\d{5}/);
      return zipMatch ? zipMatch[0] : null;

    case 'tree_count':
      if (text.includes('4') || text.includes('more') || text.includes('+')) return 4;
      if (text.includes('2') || text.includes('3')) return 2;
      return 1;

    case 'haul_debris':
      if (text.includes('yes') || text.includes('take')) return true;
      if (text.includes('no') || text.includes('leave')) return false;
      return 'unsure';

    case 'access_location':
      if (text.includes('back')) return 'backyard';
      return 'front_yard';

    case 'gate_width':
      // Handle button choices
      if (text.includes('under') || text.includes('less than 3') || text.includes('narrow')) return 2;
      if (text.includes('3-5') || text.includes('3 to 5')) return 4;
      if (text.includes('6+') || text.includes('6 ft') || text.includes('wide')) return 6;
      if (text.includes('no gate')) return 10; // No gate = wide access
      // Handle numeric input
      const widthMatch = text.match(/\d+/);
      return widthMatch ? parseInt(widthMatch[0]) : null;

    case 'slope':
      if (text.includes('steep') || text.includes('wet') || text.includes('soft')) return 'steep';
      if (text.includes('some slope') || text.includes('moderate')) return 'moderate';
      return 'easy';

    case 'power_lines':
      if (text.includes('yes') || text.includes('nearby')) return true;
      if (text.includes('not sure')) return true; // Err on side of caution
      return false;

    case 'structures':
      if (text.includes('yes') || text.includes('near') || text.includes('close')) return true;
      if (text.includes('not sure')) return true; // Err on side of caution
      return false;

    case 'contact_name':
      return rawText.trim();

    case 'contact_phone':
      return rawText.replace(/\D/g, '').slice(-10);

    default:
      return rawText;
  }
}

// ----------------------
// GET QUESTION BY ID
// ----------------------
export function getQuestionById(id: string): Question | undefined {
  return QUESTION_LIBRARY.find(q => q.id === id);
}
