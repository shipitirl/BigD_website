#!/bin/bash
SESSION_ID="perf_test_$(date +%s)"
API_URL="http://localhost:3001/api/chat"

echo "Starting Latency Test (Session: $SESSION_ID)"

# Helper to measure time
measure_request() {
  local MSG="$1"
  local START=$(date +%s%N)
  echo "Sending: '$MSG'"
  
  # For streaming endpoint, we just want to see time to first byte vs total time
  # But here we are using the JSON endpoint for simplicity unless we curl the stream?
  # The frontend uses Stream=true. Let's test that.
  
  curl -s -X POST $API_URL \
       -H "Content-Type: application/json" \
       -d "{\"sessionId\":\"$SESSION_ID\", \"message\":\"$MSG\", \"stream\":true}" > /dev/null
       
  local END=$(date +%s%N)
  local DUR=$(( (END - START) / 1000000 ))
  echo "Duration: ${DUR}ms"
}

# 1. Warmup / Start
measure_request "Hi"

# 2. Provide Zip Code (The reported slow step)
measure_request "53545"

# 3. Provide Service
measure_request "Tree removal"
