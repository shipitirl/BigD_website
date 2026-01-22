
import { getNextQuestion, QUESTION_LIBRARY, Question } from '../api/lib/questions';
import { getMissingFields, SessionState } from '../api/lib/session';

// Use a simplified mock state
const state: any = {
  zip: '45488',
  service_type: null,
  tree_count: null,
  haul_away: null,
  access: { location: null, gate_width_ft: null, slope: null },
  hazards: { power_lines: null, structures_nearby: null },
  contact: { name: null, phone: null },
  photos_uploaded: false,
  messages: [],
  status: 'active'
};

console.log('--- Mock State ---');
console.log(JSON.stringify(state, null, 2));

console.log('\n--- Missing Fields ---');
const missing = getMissingFields(state);
console.log(missing);

console.log('\n--- Next Question ---');
const nextQ = getNextQuestion(state);
console.log('Returned ID:', nextQ ? nextQ.id : 'null');
if (nextQ) console.log('Priority:', nextQ.priority);

console.log('\n--- Library Order (top 15) ---');
// QUESTION_LIBRARY.sort((a,b) => a.priority - b.priority); // Simulate the sort in getNextQuestion if needed
QUESTION_LIBRARY.slice(0, 15).forEach((q: Question) => console.log(`${q.priority}: ${q.id} (Condition: ${!!q.condition})`));
