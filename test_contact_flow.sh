#!/bin/bash
SESSION_ID="contact_test_$(date +%s)"
API_URL="http://localhost:3001/api/chat"

echo "Starting session $SESSION_ID"

# 1. Provide all job details
echo "1. Providing Job Details..."
curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"I need a tree removed in 53545. It is on the side yard. No power lines. Easy access. Just 1 tree. You can take the wood.\"}" > /dev/null

# 2. Check status - should ask for contact
echo "2. Checking response (Expect request for contact info)..."
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"What next?\"}")

echo "Assistant: $(echo $RESPONSE | jq -r '.assistantMessage')"

# 3. Provide Name and Phone ONLY
echo "3. Providing Name and Phone (No Email)..."
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"My name is John Doe and phone is 608-555-1234.\"}")
READY=$(echo $RESPONSE | jq -r '.readyForPhotos')

if [ "$READY" == "true" ]; then
  echo "FAIL: Ready for photos without email!"
  exit 1
else
  echo "PASS: Not ready yet (Email missing)."
fi

# 4. Provide Invalid Email
echo "4. Providing Invalid Email..."
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"My email is john.doe at gmail\"}")
echo "Assistant: $(echo $RESPONSE | jq -r '.assistantMessage')"
# Heuristic check - normally the LLM should ask for a valid email or say it's invalid
if echo $RESPONSE | grep -q "valid email"; then
   echo "PASS: Bot asked for valid email (heuristic match)."
else
   echo "WARN: Bot might not have explicitly complained about validity, checking manually."
fi

# 5. Provide Valid Email
echo "5. Providing Valid Email..."
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"john.doe@gmail.com\"}")
READY=$(echo $RESPONSE | jq -r '.readyForPhotos')
ASSISTANT=$(echo $RESPONSE | jq -r '.assistantMessage')

echo "Assistant: $ASSISTANT"

if [ "$READY" == "true" ]; then
  echo "PASS: Ready for photos!"
else
  echo "FAIL: Still not ready for photos."
  echo "Debug: $(echo $RESPONSE | jq '.collected')"
  exit 1
fi
