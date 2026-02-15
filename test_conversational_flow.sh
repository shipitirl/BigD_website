#!/bin/bash
SESSION_ID="conv_test_$(date +%s)"
API_URL="http://localhost:3001/api/chat"

echo "Starting session $SESSION_ID"

# 1. Start with initial problem description
echo "1. Sending 'I have a few broken branches that need to be removed in 53545'"
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"I have a few broken branches that need to be removed in 53545\"}")

ASSISTANT=$(echo $RESPONSE | jq -r '.assistantMessage')
echo "Assistant: $ASSISTANT"

# 2. Check for specific phrasing
REQUIRED_PHRASE="How many trees and/or stumps seem to have issues?"
if [[ "$ASSISTANT" == *"$REQUIRED_PHRASE"* ]]; then
  echo "PASS: Bot used the required phrasing."
else
  echo "FAIL: Bot did NOT use the required phrasing."
  echo "Expected: $REQUIRED_PHRASE"
  exit 1
fi

# 3. Check for conversational acknowledgment (Heuristic: length > 30 chars or contains key words)
# We expect something like "Got it..." or "I can help..." before the question
if [[ ${#ASSISTANT} -gt 60 ]]; then
   echo "PASS: Response seems conversational (length > 60)."
else
   echo "WARN: Response might be too short for conversational style."
fi
