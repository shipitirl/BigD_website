
const { getNextQuestion, QUESTION_LIBRARY } = require('../api/lib/questions');
const { getMissingFields } = require('../api/lib/session');

// Mock state
const state = {
  zip: '45488',
  service_type: null,
  tree_count: null, // Missing
  haul_away: null,
  access: { location: null, gate_width_ft: null, slope: null },
  hazards: { power_lines: null, structures_nearby: null },
  contact: { name: null, phone: null },
  photos_uploaded: false,
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

console.log('\n--- Library Order ---');
QUESTION_LIBRARY.forEach(q => console.log(`${q.priority}: ${q.id}`));
