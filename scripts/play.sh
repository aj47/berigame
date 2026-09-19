#!/usr/bin/env bash
# One-command local playtest for BeriGame.
# Starts a local SpacetimeDB (if none is running), publishes the game module,
# regenerates client bindings, and starts the Vite dev server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STDB_URL="http://127.0.0.1:3000"
STDB_DATA="$ROOT/.spacetime-data"
DB_NAME="berigame"
CLIENT_PORT="${PORT:-5173}"

log()  { printf '\033[1;36m[play]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[play]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. spacetime CLI --------------------------------------------------------
SPACETIME=""
for candidate in "$(command -v spacetime 2>/dev/null || true)" "$HOME/.local/bin/spacetime" "$HOME/.stdb/spacetime"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then SPACETIME="$candidate"; break; fi
done
[ -n "$SPACETIME" ] || fail "spacetime CLI not found. Install it with:
    curl -sSf https://install.spacetimedb.com | sh
then reopen your shell and run this again."
# The installer's launcher needs to know its root when it isn't on PATH.
STDB_ARGS=()
case "$SPACETIME" in "$HOME/.stdb/spacetime") STDB_ARGS=("--root-dir=$HOME/.stdb");; esac
stdb() { "$SPACETIME" "${STDB_ARGS[@]}" "$@"; }
log "spacetime CLI: $SPACETIME ($(stdb --version 2>/dev/null | head -1 | sed 's/spacetime Path: //'))"

# --- 2. node -----------------------------------------------------------------
command -v node >/dev/null || fail "node not found. Install Node 22 (nvm install 22 && nvm use)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node $NODE_MAJOR is too old. Run: nvm use   (needs Node 18+, .nvmrc says 22)"

# --- 3. dependencies ---------------------------------------------------------
for dir in shared spacetimedb frontend; do
  if [ ! -d "$dir/node_modules" ]; then
    log "installing dependencies in $dir/"
    (cd "$dir" && npm install --no-audit --no-fund)
  fi
done

# --- 4. local server ---------------------------------------------------------
STARTED_SERVER=0
SERVER_PID=""
if curl -sf "$STDB_URL/v1/ping" >/dev/null 2>&1; then
  log "SpacetimeDB already running at $STDB_URL"
else
  mkdir -p "$STDB_DATA"
  log "starting SpacetimeDB at $STDB_URL (data in .spacetime-data/, log in .spacetime-data/server.log)"
  stdb start --data-dir "$STDB_DATA" --listen-addr 127.0.0.1:3000 --non-interactive \
    > "$STDB_DATA/server.log" 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1
  for _ in $(seq 1 60); do
    curl -sf "$STDB_URL/v1/ping" >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -sf "$STDB_URL/v1/ping" >/dev/null 2>&1 || fail "SpacetimeDB did not start; see $STDB_DATA/server.log"
fi

cleanup() {
  if [ "$STARTED_SERVER" = 1 ] && [ -n "$SERVER_PID" ]; then
    log "stopping SpacetimeDB (pid $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --- 5. publish module -------------------------------------------------------
stdb server add local --url "$STDB_URL" >/dev/null 2>&1 || true
log "publishing module '$DB_NAME' to local server"
if ! (cd spacetimedb && stdb publish "$DB_NAME" --server local --yes); then
  log "publish failed (schema changed?). Retrying with --delete-data=always, which wipes local game data."
  (cd spacetimedb && stdb publish "$DB_NAME" --server local --yes --delete-data=always)
fi

# --- 6. client bindings ------------------------------------------------------
log "regenerating client bindings"
stdb generate --lang typescript --out-dir frontend/src/module_bindings --module-path spacetimedb >/dev/null

# --- 7. client ---------------------------------------------------------------
cat <<TIP

  ============================================================
   BeriGame is ready: http://127.0.0.1:$CLIENT_PORT
   Open it in two windows (one normal, one incognito) to
   get two players. Click the ground to walk, 1/2/3 to switch
   stance, click a player -> Attack, click a tree -> Harvest,
   I for inventory, Enter to chat. Ctrl-C stops everything.
  ============================================================

TIP
cd frontend && exec npx vite --host 127.0.0.1 --port "$CLIENT_PORT"
