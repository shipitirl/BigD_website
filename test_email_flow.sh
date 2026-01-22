#!/bin/bash
SESSION_ID="email_test_$(date +%s)"
API_URL="http://localhost:3001/api"

echo "Starting session $SESSION_ID"

# 1. Start & Provide Zip
echo "1. Sending Zip '53545'"
curl -s -X POST "$API_URL/chat" -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"Hi, I need help in 53545\"}" > /dev/null

# 2. Provide Service & Tree Count
echo "2. Sending 'I have 2 trees to remove'"
curl -s -X POST "$API_URL/chat" -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"I have 2 trees to remove\"}" > /dev/null

# 3. Provide Location
echo "3. Sending 'They are in the back yard'"
curl -s -X POST "$API_URL/chat" -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"They are in the back yard\"}" > /dev/null

# 4. Finalize with Contact Info
echo "4. Finalizing with Contact Info..."
RESPONSE=$(curl -s -X POST "$API_URL/finalize" -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"contact\":{\"name\":\"Test User\", \"phone\":\"555-019-9999\", \"email\":\"test@example.com\"}}")

echo "Final Response:"
echo $RESPONSE

if echo $RESPONSE | grep -q '"emailSent":true'; then
  echo "PASS: Email sent successfully."
else
  echo "FAIL: Email was NOT sent."
  exit 1
fi
