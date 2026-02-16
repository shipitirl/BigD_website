#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.pids"

kill_pid_file() {
  local name="$1"
  local file="$PID_DIR/$2"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file" || true)"
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
      echo "Stopping ${name} (PID ${pid})..."
      kill "${pid}" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

kill_pid_file "backend" "backend.pid"
kill_pid_file "frontend" "frontend.pid"

echo "Stopped."

