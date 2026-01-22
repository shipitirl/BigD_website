#!/bin/bash
SESSION_ID="full_flow_test_$(date +%s)"
API_URL="http://localhost:3001/api"
CHAT_URL="$API_URL/chat"
FINALIZE_URL="$API_URL/finalize"

echo "=== STARTING FULL FLOW TEST $SESSION_ID ==="

# Helper function to send message and print assistant response
send_msg() {
  local msg="$1"
  echo "User: $msg"
  RESPONSE=$(curl -s -X POST $CHAT_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"$msg\"}")
  # Extract assistant message for readability (using sed as lightweight parser)
  echo "Bot: $(echo $RESPONSE | grep -o '"assistantMessage":".*"' | cut -d'"' -f4)"
  echo "Debug Response: $RESPONSE"
  sleep 1
}

# 1. Start
send_msg "Hi"

# 2. Provide Zip (Bot likely asked for Zip + Service)
send_msg "53545"

# 3. Provide Service (Bot likely asked Service + Tree Count)
send_msg "Tree removal"

# 4. Provide Tree Count (Bot likely asked Tree Count + Location)
send_msg "2 trees"

# 5. Provide Location (Bot should have asked "Front or Back yard?")
# We check if it asked location in the previous step implicitly by answering now
send_msg "It is in the front yard"

# 6. Provide Power Lines / Access / Haul Away
# Since "Front yard" implies Easy access, it might skip access question.
# It handles remaining questions (Power Lines, Haul Away)
send_msg "No power lines"
send_msg "Yes haul it away"

# 7. Contact Info
send_msg "My name is John Doe"
send_msg "555-019-9999"

echo "--- Conversation Complete. Attempting Finalize ---"

# 8. Call Finalize
# Note: The frontend calls finalize with the accumulated contact info.
# We mimic that here.
FINALIZE_RESP=$(curl -s -X POST $FINALIZE_URL -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\", \"contact\":{\"name\":\"John Doe\", \"phone\":\"555-019-9999\", \"email\":\"john@example.com\"}}")

echo "Finalize Response: $FINALIZE_RESP"

if echo $FINALIZE_RESP | grep -q '"emailSent":true'; then
  echo "✅ PASS: Full flow completed and Email sent."
else
  echo "❌ FAIL: Email not sent."
  exit 1
fi
