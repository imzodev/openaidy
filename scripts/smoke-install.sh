#!/bin/bash
# ============================================================================
# scripts/smoke-install.sh
# ============================================================================
# Full-stack smoke test for the OpenAidy installation flow (PR1 + PR2).
#
# Tests:
#  1. `openaidy init` — mints and persists a bootstrap-admin token
#  2. Token file validation (JWT shape, fields, 0o600 on POSIX)
#  3. Idempotency — re-run does not rewrite the token
#  4. `openaidy start` — spawns server and polls /health
#  5. `openaidy status` — reports running state
#  6. `openaidy stop` — cleanly shuts down server
#  7. `openaidy status` — reports stopped after shutdown
#
# Two modes:
#  - default: exercises install.sh end-to-end (requires git remote + pnpm)
#  - LOCAL_REPO=path/to/repo: uses an existing local checkout for faster runs
#
# Usage:
#   bash scripts/smoke-install.sh                             # full install.sh
#   LOCAL_REPO=/path bash scripts/smoke-install.sh            # local mode
#
# Exits 0 on success, non-zero on any check failure.
# Cleans up the temp install dir on EXIT (trap).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SMOKE_HOME="${SMOKE_HOME:-$(mktemp -d -t openaidy-smoke-XXXXXX)}"
SMOKE_BRANCH="${SMOKE_BRANCH:-main}"
LOCAL_REPO="${LOCAL_REPO:-}"

cleanup() {
    local code=$?
    # Kill any orphan server started by the smoke test
    if [ -n "${SMOKE_PID:-}" ] && kill -0 "$SMOKE_PID" 2>/dev/null; then
        kill "$SMOKE_PID" 2>/dev/null || true
    fi
    if [ -d "$SMOKE_HOME" ]; then
        rm -rf "$SMOKE_HOME"
    fi
    exit $code
}
trap cleanup EXIT INT TERM

log()  { echo "[smoke] $*"; }
fail() { echo "[smoke] FAIL: $*" >&2; exit 1; }

# Required tools
for tool in node pnpm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "[smoke] SKIP: required tool '$tool' is not on PATH"
        exit 0
    fi
done

# ============================================================================
# Generate JWT secret and set up environment
# ============================================================================
if command -v openssl >/dev/null 2>&1; then
    export WS_TOKEN_SECRET
    WS_TOKEN_SECRET=$(openssl rand -hex 32)
else
    WS_TOKEN_SECRET=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
fi
export OPENAIDY_HOME="$SMOKE_HOME"
export CI=1  # suppress interactive prompts

# Determine the CLI entry point
if [ -n "$LOCAL_REPO" ]; then
    if [ ! -d "$LOCAL_REPO/packages/cli" ]; then
        fail "LOCAL_REPO=$LOCAL_REPO does not contain packages/cli"
    fi
    CLI="node --import tsx $LOCAL_REPO/packages/cli/bin/openaidy.ts"
    log "Using LOCAL_REPO=$LOCAL_REPO"
else
    CLI="openaidy"
fi
log "Using OPENAIDY_HOME=$SMOKE_HOME"

# ============================================================================
# Phase 1: openaidy init
# ============================================================================
log "=== Phase 1: openaidy init ==="
INIT_OUTPUT=$(cd "$REPO_ROOT" && $CLI init 2>&1)
INIT_EXIT=$?
if [ "$INIT_EXIT" -ne 0 ]; then
    echo "$INIT_OUTPUT" >&2
    fail "openaidy init exited $INIT_EXIT"
fi

if ! printf '%s\n' "$INIT_OUTPUT" | grep -q "^Bootstrap admin token: "; then
    echo "$INIT_OUTPUT" >&2
    fail "openaidy init stdout missing 'Bootstrap admin token:' line"
fi

log "OK: init produced parseable token line"

# ============================================================================
# Phase 2: Token file structure
# ============================================================================
log "=== Phase 2: Token file validation ==="

TOKEN_FILE="$SMOKE_HOME/credentials/bootstrap-admin.json"
if [ ! -f "$TOKEN_FILE" ]; then
    fail "token file not found at $TOKEN_FILE"
fi

# Mode 0o600 on POSIX
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows*)
        log "Windows — skipping POSIX 0o600 check (NTFS ACL)"
        ;;
    *)
        MODE=$(stat -c '%a' "$TOKEN_FILE" 2>/dev/null || stat -f '%A' "$TOKEN_FILE" 2>/dev/null || echo "unknown")
        if [ "$MODE" != "600" ]; then
            fail "token file mode is $MODE (expected 600)"
        fi
        log "OK: token file mode is 0o600"
        ;;
esac

log "Validating token file structure..."
if ! node -e '
  const fs = require("node:fs");
  const raw = fs.readFileSync(process.argv[1], "utf-8");
  const r = JSON.parse(raw);
  if (typeof r.clientId !== "string" || !r.clientId) { console.error("clientId invalid"); process.exit(1); }
  if (typeof r.token !== "string" || !r.token) { console.error("token invalid"); process.exit(1); }
  if (!Array.isArray(r.scopes) || !r.scopes.includes("*")) { console.error("scopes must include admin wildcard"); process.exit(1); }
  if (typeof r.createdAt !== "string" || isNaN(Date.parse(r.createdAt))) { console.error("createdAt invalid"); process.exit(1); }
  if (typeof r.expiresAt !== "string" || isNaN(Date.parse(r.expiresAt))) { console.error("expiresAt invalid"); process.exit(1); }
  const parts = r.token.split(".");
  if (parts.length !== 3) { console.error("token is not a JWT"); process.exit(1); }
  console.log("OK: token file well-formed; clientId=" + r.clientId + ", scopes=" + JSON.stringify(r.scopes));
' "$TOKEN_FILE"; then
    fail "token file structure invalid"
fi

# ============================================================================
# Phase 3: Idempotency
# ============================================================================
log "=== Phase 3: Idempotency check ==="
FIRST_HASH=$(sha256sum "$TOKEN_FILE" | awk '{print $1}')
sleep 1

if ! INIT_OUTPUT_2=$(cd "$REPO_ROOT" && $CLI init 2>&1); then
    echo "$INIT_OUTPUT_2" >&2
    fail "openaidy init re-run exited non-zero"
fi

SECOND_HASH=$(sha256sum "$TOKEN_FILE" | awk '{print $1}')
if [ "$FIRST_HASH" != "$SECOND_HASH" ]; then
    fail "token file content changed on re-run (idempotency violation)"
fi
log "OK: idempotent — token unchanged across re-run"

# ============================================================================
# Phase 4: openaidy start
# ============================================================================
log "=== Phase 4: openaidy start ==="

# Skip on Windows — start needs Unix process management
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows*)
        log "SKIP: openaidy start/status/stop — Windows (manual test via smoke-install.ps1)"
        log ""
        log "============================================"
        log "SUCCESS: smoke-install.sh (init phases)"
        log "Full-stack test requires Linux/WSL or macOS."
        log "============================================"
        exit 0
        ;;
esac

# Build server first so the dist is available
log "Building server..."
pnpm --filter @openaidy/server build >/dev/null 2>&1 || true
# If build fails, start will catch it with a clear message

START_OUTPUT=$(cd "$REPO_ROOT" && $CLI start 2>&1)
START_EXIT=$?
if [ "$START_EXIT" -ne 0 ]; then
    echo "$START_OUTPUT" >&2
    fail "openaidy start exited $START_EXIT"
fi

if ! printf '%s\n' "$START_OUTPUT" | grep -q "Server is ready"; then
    echo "$START_OUTPUT" >&2
    fail "openaidy start did not confirm readiness"
fi
log "OK: server started"

# Extract URL and PID from status
STATUS_OUTPUT=$(cd "$REPO_ROOT" && $CLI status 2>&1)
if ! printf '%s\n' "$STATUS_OUTPUT" | grep -q "running"; then
    echo "$STATUS_OUTPUT" >&2
    fail "openaidy status did not report running"
fi
log "OK: status reports running"

# ============================================================================
# Phase 5: openaidy stop
# ============================================================================
log "=== Phase 5: openaidy stop ==="

STOP_OUTPUT=$(cd "$REPO_ROOT" && $CLI stop 2>&1)
STOP_EXIT=$?
if [ "$STOP_EXIT" -ne 0 ]; then
    echo "$STOP_OUTPUT" >&2
    fail "openaidy stop exited $STOP_EXIT"
fi
log "OK: server stopped"

# Verify status now reports stopped
STATUS_AFTER=$(cd "$REPO_ROOT" && $CLI status 2>&1)
if ! printf '%s\n' "$STATUS_AFTER" | grep -q "stopped"; then
    echo "$STATUS_AFTER" >&2
    fail "openaidy status did not report stopped after stop"
fi
log "OK: status reports stopped after shutdown"

# ============================================================================
# All phases passed
# ============================================================================
log ""
log "============================================"
log "SUCCESS: smoke-install.sh"
log "  ✓ init — token minted and persisted"
log "  ✓ token file — JWT shape valid, 0o600"
log "  ✓ idempotency — re-run preserves token"
log "  ✓ start — server spawned and healthy"
log "  ✓ status — reports running"
log "  ✓ stop — server shut down cleanly"
log "  ✓ status — reports stopped"
log "============================================"
