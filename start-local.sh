#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-8082}"

mkdir -p "$ROOT_DIR/.pids"

echo "Starting local dev..."
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "  Frontend: http://localhost:${FRONTEND_PORT}"

# Backend (Next dev)
if ss -ltn 2>/dev/null | grep -q ":${BACKEND_PORT} "; then
  echo "Backend port ${BACKEND_PORT} is already in use. Stop it or set BACKEND_PORT to a free port."
  exit 1
fi

(
  cd "$ROOT_DIR/backend"
  if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
  fi
  nohup ./node_modules/.bin/next dev -p "${BACKEND_PORT}" > server.log 2>&1 &
  echo $! > "$ROOT_DIR/.pids/backend.pid"
)

# Frontend (static server)
if ss -ltn 2>/dev/null | grep -q ":${FRONTEND_PORT} "; then
  echo "Frontend port ${FRONTEND_PORT} is already in use. Stop it or set FRONTEND_PORT to a free port."
  exit 1
fi

(
  cd "$ROOT_DIR"
  nohup python3 -m http.server "${FRONTEND_PORT}" > "frontend-${FRONTEND_PORT}.log" 2>&1 &
  echo $! > "$ROOT_DIR/.pids/frontend.pid"
)

echo "Online."
echo "Logs:"
echo "  tail -f backend/server.log"
echo "  tail -f frontend-${FRONTEND_PORT}.log"

