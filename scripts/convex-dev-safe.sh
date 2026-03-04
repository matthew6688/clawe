#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CONVEX_PORT="${CONVEX_PORT:-3210}"

listening_pid=""
if command -v lsof >/dev/null 2>&1; then
  listening_pid="$(lsof -tiTCP:"$CONVEX_PORT" -sTCP:LISTEN 2>/dev/null | head -n1 || true)"
fi

if [ -n "$listening_pid" ]; then
  listening_cmd="$(ps -p "$listening_pid" -o command= 2>/dev/null || true)"
  if echo "$listening_cmd" | grep -q "convex-local-backend"; then
    echo "Convex local backend already running on port $CONVEX_PORT (PID $listening_pid). Reusing existing process."
    exit 0
  fi

  echo "Port $CONVEX_PORT is already in use by a non-Convex process (PID $listening_pid)."
  echo "Stop that process first, then run: pnpm convex:dev"
  exit 1
fi

cd "$ROOT_DIR"
"$ROOT_DIR/scripts/sync-convex-env.sh" &
sync_pid=$!
cleanup() {
  kill "$sync_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT_DIR/packages/backend"
if [ -f "$ROOT_DIR/.env" ]; then
  exec pnpm exec dotenv -e "$ROOT_DIR/.env" -- convex dev
fi
exec pnpm exec convex dev
