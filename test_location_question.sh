#!/bin/bash
SESSION_ID="loc_test_$(date +%s)"
API_URL="http://localhost:3001/api/chat"

echo "Starting session $SESSION_ID"

# 1. Start Conversation
echo "1. Sending 'Hi'"
curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"Hi\"}" | grep -o '"assistantMessage":".*"'
echo ""

# 2. Provide basic info but no location
echo "2. Sending 'I need a tree removed in 53545. It is just one tree.'"
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"I need a tree removed in 53545. It is just one tree.\"}")
echo $RESPONSE | grep -o '"nextQuestions":\[.*\]'

# Check if location question is in nextQuestions
if echo $RESPONSE | grep -q "front yard or back yard"; then
  echo "PASS: Chatbot asked for location."
else
  echo "FAIL: Chatbot did NOT ask for location."
  exit 1
fi

# 3. Provide location
echo "3. Sending 'It is in the front yard'"
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"It is in the front yard\"}")
# Verify state update implicitly by seeing if it asks for something else or moves on
echo $RESPONSE | grep -o '"assistantMessage":".*"'
