#!/bin/bash
# Test script for long initial input handling and JSON extraction
# This tests that the chatbot properly extracts multiple fields from a single message

SESSION_ID="long_input_test_$(date +%s)"
API_URL="http://localhost:3001/api/chat"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================================="
echo "TEST: Long Initial Input & JSON Field Extraction"
echo "Session: $SESSION_ID"
echo "=================================================="

# TEST 1: Send a long initial message with MANY details
echo -e "\n${YELLOW}TEST 1: Long initial message with multiple fields${NC}"
LONG_MESSAGE="Hi, I need help with some tree work. I have 3 large oak trees in my backyard at 53545 that need to be removed. There are power lines running right next to them and my shed is pretty close too. The yard has a moderate slope. I'd like you to haul away all the debris when you're done."

echo "Sending: $LONG_MESSAGE"
echo ""

RESPONSE=$(curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"$LONG_MESSAGE\"}")

ASSISTANT=$(echo $RESPONSE | jq -r '.assistantMessage')
STATE=$(echo $RESPONSE | jq -r '.state // empty')

echo "Assistant: $ASSISTANT"
echo ""

# Parse extracted fields from state
ZIP=$(echo $RESPONSE | jq -r '.state.zip // "null"')
SERVICE=$(echo $RESPONSE | jq -r '.state.service_type // "null"')
TREE_COUNT=$(echo $RESPONSE | jq -r '.state.tree_count // "null"')
LOCATION=$(echo $RESPONSE | jq -r '.state.access.location // "null"')
SLOPE=$(echo $RESPONSE | jq -r '.state.access.slope // "null"')
POWER_LINES=$(echo $RESPONSE | jq -r '.state.hazards.power_lines // "null"')
STRUCTURES=$(echo $RESPONSE | jq -r '.state.hazards.structures_nearby // "null"')
HAUL_AWAY=$(echo $RESPONSE | jq -r '.state.haul_away // "null"')

echo "--- Extracted Fields ---"
echo "ZIP: $ZIP"
echo "Service Type: $SERVICE"
echo "Tree Count: $TREE_COUNT"
echo "Location: $LOCATION"
echo "Slope: $SLOPE"
echo "Power Lines: $POWER_LINES"
echo "Structures Nearby: $STRUCTURES"
echo "Haul Away: $HAUL_AWAY"
echo "------------------------"

# Check extractions
PASS_COUNT=0
FAIL_COUNT=0

check_field() {
  local field_name=$1
  local actual=$2
  local expected=$3

  if [[ "$actual" == "$expected" ]]; then
    echo -e "${GREEN}✓ $field_name: $actual${NC}"
    ((PASS_COUNT++))
  else
    echo -e "${RED}✗ $field_name: Got '$actual', expected '$expected'${NC}"
    ((FAIL_COUNT++))
  fi
}

echo ""
echo "--- Field Extraction Checks ---"
check_field "ZIP" "$ZIP" "53545"
check_field "Service Type" "$SERVICE" "tree_removal"
check_field "Tree Count" "$TREE_COUNT" "3"
check_field "Location" "$LOCATION" "backyard"
check_field "Slope" "$SLOPE" "moderate"
check_field "Power Lines" "$POWER_LINES" "true"
check_field "Structures" "$STRUCTURES" "true"
check_field "Haul Away" "$HAUL_AWAY" "true"

# TEST 2: Should only ask for MISSING info (contact details)
echo -e "\n${YELLOW}TEST 2: Bot should only ask for missing info (contact)${NC}"

# Check that bot is NOT asking for already-provided info
ASKING_ZIP=$(echo "$ASSISTANT" | grep -iE "zip|postal" | wc -l)
ASKING_SERVICE=$(echo "$ASSISTANT" | grep -iE "what.*service|type.*work|kind.*service" | wc -l)
ASKING_TREES=$(echo "$ASSISTANT" | grep -iE "how many tree" | wc -l)

if [[ $ASKING_ZIP -eq 0 && $ASKING_SERVICE -eq 0 && $ASKING_TREES -eq 0 ]]; then
  echo -e "${GREEN}✓ Bot correctly NOT asking for already-provided info${NC}"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ Bot may be asking for info already provided${NC}"
  ((FAIL_COUNT++))
fi

# TEST 3: Provide contact info and check it extracts properly
echo -e "\n${YELLOW}TEST 3: Provide contact info${NC}"
CONTACT_MSG="My name is John Smith, phone is 262-555-1234, and email is john.smith@example.com"
echo "Sending: $CONTACT_MSG"

RESPONSE2=$(curl -s -X POST $API_URL -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"$CONTACT_MSG\"}")

ASSISTANT2=$(echo $RESPONSE2 | jq -r '.assistantMessage')
CONTACT_NAME=$(echo $RESPONSE2 | jq -r '.state.contact.name // "null"')
CONTACT_PHONE=$(echo $RESPONSE2 | jq -r '.state.contact.phone // "null"')
CONTACT_EMAIL=$(echo $RESPONSE2 | jq -r '.state.contact.email // "null"')
READY_PHOTOS=$(echo $RESPONSE2 | jq -r '.readyForPhotos // "null"')
STATUS=$(echo $RESPONSE2 | jq -r '.state.status // "null"')

echo "Assistant: $ASSISTANT2"
echo ""
echo "--- Contact Extraction ---"
echo "Name: $CONTACT_NAME"
echo "Phone: $CONTACT_PHONE"
echo "Email: $CONTACT_EMAIL"
echo "Ready for Photos: $READY_PHOTOS"
echo "Status: $STATUS"

# Verify contact extraction (allow for variations in name extraction)
if [[ "$CONTACT_NAME" != "null" && "$CONTACT_NAME" != "" ]]; then
  echo -e "${GREEN}✓ Name extracted: $CONTACT_NAME${NC}"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ Name not extracted${NC}"
  ((FAIL_COUNT++))
fi

if [[ "$CONTACT_PHONE" != "null" && "$CONTACT_PHONE" != "" ]]; then
  echo -e "${GREEN}✓ Phone extracted: $CONTACT_PHONE${NC}"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ Phone not extracted${NC}"
  ((FAIL_COUNT++))
fi

if [[ "$CONTACT_EMAIL" == *"@"* ]]; then
  echo -e "${GREEN}✓ Email extracted: $CONTACT_EMAIL${NC}"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ Email not extracted or invalid${NC}"
  ((FAIL_COUNT++))
fi

# TEST 4: Check ready for photos after contact provided
echo -e "\n${YELLOW}TEST 4: Check if ready for photos${NC}"
if [[ "$READY_PHOTOS" == "true" || "$STATUS" == "awaiting_photos" ]]; then
  echo -e "${GREEN}✓ Bot correctly moved to photo stage after contact info${NC}"
  ((PASS_COUNT++))
else
  echo -e "${YELLOW}⚠ Bot not ready for photos yet. Status: $STATUS${NC}"
  # Not a failure - might need gate width for backyard
fi

# TEST 5: Verify JSON structure is preserved for email (check state completeness)
echo -e "\n${YELLOW}TEST 5: Verify complete state for email labeling${NC}"
FULL_STATE=$(echo $RESPONSE2 | jq '.state')
echo "Full State JSON:"
echo "$FULL_STATE" | jq '.'

# Check that JSON keys match expected structure
HAS_SERVICE=$(echo "$FULL_STATE" | jq 'has("service_type")')
HAS_HAZARDS=$(echo "$FULL_STATE" | jq 'has("hazards")')
HAS_ACCESS=$(echo "$FULL_STATE" | jq 'has("access")')
HAS_CONTACT=$(echo "$FULL_STATE" | jq 'has("contact")')

if [[ "$HAS_SERVICE" == "true" && "$HAS_HAZARDS" == "true" && "$HAS_ACCESS" == "true" && "$HAS_CONTACT" == "true" ]]; then
  echo -e "${GREEN}✓ State has all required JSON keys for email labeling${NC}"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ State missing required JSON keys${NC}"
  ((FAIL_COUNT++))
fi

# SUMMARY
echo ""
echo "=================================================="
echo "SUMMARY"
echo "=================================================="
echo -e "Passed: ${GREEN}$PASS_COUNT${NC}"
echo -e "Failed: ${RED}$FAIL_COUNT${NC}"

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "\n${GREEN}ALL TESTS PASSED!${NC}"
  exit 0
else
  echo -e "\n${RED}SOME TESTS FAILED${NC}"
  exit 1
fi
