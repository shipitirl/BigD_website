#!/bin/bash
SESSION_ID="persist_test_$(date +%s)"
API_URL="http://localhost:3001/api/chat"

echo "Starting session $SESSION_ID"

# 1. Create Session & Add Data
echo "1. Adding data (Zip 53545)"
curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"Hi, zip is 53545\"}" > /dev/null

# 2. Verify Data Saved
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"status\"}")
if echo $RESPONSE | grep -q "53545"; then
  echo "Data saved successfully."
else
  echo "FAIL: Data not saved initially."
  exit 1
fi

# 3. RESTART SERVER (Simulate Crash/Restart)
echo "3. Restarting Server..."
fuser -k -n tcp 3001
sleep 2
cd /home/travis/Projects/BigD_website/backend && npm run dev > /dev/null 2>&1 &
# Wait for server to come up
sleep 10

# 4. Check Data Again (Should persist)
echo "4. Checking if data persists..."
RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"what is my zip?\"}")
echo "Response: $RESPONSE"

if echo $RESPONSE | grep -q "53545"; then
  echo "PASS: Session persisted across restart!"
else
  # Also check if it's in the collected state returned by API
  CHECK_STATE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"update\"}")
  if echo $CHECK_STATE | grep -q "53545"; then
     echo "PASS: Session persisted across restart (found in state)!"
  else
     echo "FAIL: Session LOST after restart."
     exit 1
  fi
fi
