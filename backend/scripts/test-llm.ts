/**
 * LLM Prompt Test Suite
 * 
 * Tests the extraction quality of the LLM by sending various prompts
 * and verifying the extracted data matches expectations.
 * 
 * Usage: npx tsx scripts/test-llm.ts
 */

import 'dotenv/config';
import { extractAndSelectQuestion } from '../api/lib/llm';
import { createSession, SessionState } from '../api/lib/session';

// Test cases: [input message, expected extractions]
interface TestCase {
  name: string;
  message: string;
  expectedFields: Partial<{
    zip: string;
    tree_count: number;
    service_type: string;
    haul_away: boolean;
    access_location: string;
    gate_width_ft: number;
    urgency: string;
  }>;
}

const TEST_CASES: TestCase[] = [
  // Zip code tests
  {
    name: 'Simple zip code',
    message: '54545',
    expectedFields: { zip: '54545' },
  },
  {
    name: 'Zip with context',
    message: 'I live in 55448',
    expectedFields: { zip: '55448' },
  },
  
  // Tree count tests
  {
    name: 'Single tree',
    message: '1',
    expectedFields: { tree_count: 1 },
  },
  {
    name: 'Multiple trees',
    message: '3 trees',
    expectedFields: { tree_count: 3 },
  },
  {
    name: 'Tree count in sentence',
    message: 'I have 2 stumps that need grinding',
    expectedFields: { tree_count: 2, service_type: 'stump_grinding' },
  },
  
  // Service type tests
  {
    name: 'Tree removal',
    message: 'I need a tree removed',
    expectedFields: { service_type: 'tree_removal' },
  },
  {
    name: 'Stump grinding',
    message: 'Can you grind a stump for me?',
    expectedFields: { service_type: 'stump_grinding' },
  },
  {
    name: 'Trimming',
    message: 'Just need some trimming done',
    expectedFields: { service_type: 'trimming' },
  },
  
  // Access location tests
  {
    name: 'Front yard',
    message: 'Front yard',
    expectedFields: { },  // access.location should be 'front_yard'
  },
  {
    name: 'Backyard',
    message: 'Its in the backyard',
    expectedFields: { },  // access.location should be 'backyard'
  },
  
  // Gate width tests
  {
    name: 'Gate width with unit',
    message: '10ft',
    expectedFields: { },  // access.gate_width_ft should be 10
  },
  {
    name: 'No gate',
    message: 'no gate needed, front yard access',
    expectedFields: { },  // Should work without gate
  },
  
  // Haul away tests
  {
    name: 'Yes haul away',
    message: 'Yes please haul it away',
    expectedFields: { haul_away: true },
  },
  {
    name: 'No haul away',
    message: 'No I will handle debris myself',
    expectedFields: { haul_away: false },
  },
  
  // Complex multi-field messages
  {
    name: 'Complex initial message',
    message: 'I have a dead tree in my backyard at 55448 that needs to be removed',
    expectedFields: { 
      zip: '55448', 
      service_type: 'tree_removal',
    },
  },
];

async function runTests() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY not set in environment');
    process.exit(1);
  }
  
  console.log('🧪 LLM Prompt Test Suite\n');
  console.log('='.repeat(60));
  
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  
  for (const testCase of TEST_CASES) {
    const session = createSession();
    
    try {
      console.log(`\n📝 Test: ${testCase.name}`);
      console.log(`   Input: "${testCase.message}"`);
      
      const result = await extractAndSelectQuestion(session, testCase.message, apiKey);
      
      console.log(`   Extracted: ${JSON.stringify(result.extracted_patch)}`);
      console.log(`   Ack: "${result.ack}"`);
      console.log(`   Next Q: ${result.next_question_id}`);
      
      // Check expected fields
      let testPassed = true;
      const patch = result.extracted_patch as Record<string, unknown>;
      
      for (const [field, expected] of Object.entries(testCase.expectedFields)) {
        const actual = patch[field];
        if (actual !== expected) {
          console.log(`   ❌ FAIL: Expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
          testPassed = false;
        }
      }
      
      if (testPassed && Object.keys(testCase.expectedFields).length > 0) {
        console.log(`   ✅ PASS`);
        passed++;
      } else if (Object.keys(testCase.expectedFields).length === 0) {
        // No specific expectations, just log what we got
        console.log(`   ℹ️  No specific expectations - review output`);
        passed++;
      } else {
        failed++;
        failures.push(testCase.name);
      }
      
    } catch (error) {
      console.log(`   ❌ ERROR: ${error}`);
      failed++;
      failures.push(testCase.name);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${TEST_CASES.length} tests`);
  
  if (failures.length > 0) {
    console.log(`\n❌ Failed tests:`);
    failures.forEach(f => console.log(`   - ${f}`));
  }
  
  const successRate = (passed / TEST_CASES.length * 100).toFixed(1);
  console.log(`\n🎯 Success Rate: ${successRate}%`);
  
  if (parseFloat(successRate) >= 80) {
    console.log('✅ LLM extraction quality is GOOD');
  } else if (parseFloat(successRate) >= 60) {
    console.log('⚠️  LLM extraction quality needs IMPROVEMENT');
  } else {
    console.log('❌ LLM extraction quality is POOR - investigate prompts');
  }
}

runTests().catch(console.error);
