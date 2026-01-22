#!/bin/bash
SESSION_ID="dead_end_test_$(date +%s)"
API_URL="http://localhost:3001/api/chat"

echo "Starting session $SESSION_ID"

# 1. Start Conversation
echo "1. Sending 'Hi'"
curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"Hi\"}" > /dev/null

# 2. Bot asks for Zip (we assume). We give garbage.
echo "2. Sending garbage for Zip: 'banana'"
curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"banana\"}" > /dev/null

# 3. Bot asks Service Type. We give garbage.
echo "3. Sending garbage for Service: 'apple'"
curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"apple\"}" > /dev/null

# 4. Bot asks Tree Count. We give garbage.
echo "4. Sending garbage for Tree Count: 'orange'"
curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"orange\"}" > /dev/null

# 5. Bot asks Location. We give garbage.
echo "5. Sending garbage for Location: 'grape'"
curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"grape\"}" > /dev/null

# 6. Check status. It should NOT say "I think I have everything".
# It likely ran out of questions.
echo "6. Sending 'What next?'"
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"What next?\"}")

echo "Final Response:"
echo $RESPONSE

if echo $RESPONSE | grep -q "I think I have everything"; then
  echo "FAIL: Chatbot gave up even though we gave it garbage."
  exit 1
elif echo $RESPONSE | grep -q "readyForPhotos\":true"; then
  echo "FAIL: Chatbot thinks it's ready for photos despite garbage input."
  exit 1
else
  echo "PASS: Chatbot did not give up (or behavior is different than expected dead end)."
fi
