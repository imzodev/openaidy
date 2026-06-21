#!/bin/bash
# ============================================================================
# scripts/smoke-install-pr1.sh
# ============================================================================
# PR1 smoke test for the OpenAidy install flow.
#
# Two modes:
#  - default: exercises the install.sh end-to-end (requires git remote + pnpm)
#  - LOCAL_REPO=path/to/repo: exercises just the `openaidy init` step using
#    an existing local repo checkout. Useful in CI sandboxes and on
#    developer machines where a network clone is slow or unavailable.
#
# Verifies:
#  - `openaidy init` produces a parseable `Bootstrap admin token: <jwt>` line
#  - the token file at $OPENAIDY_HOME/credentials/bootstrap-admin.json exists
#  - on POSIX the file has mode 0o600
#  - the JSON shape is well-formed: clientId, token, scopes (incl. `*`),
#    createdAt, expiresAt — all the documented fields
#  - re-running init is idempotent (mtime unchanged, content unchanged)
#
# Usage:
#   bash scripts/smoke-install-pr1.sh                          # full install.sh
#   LOCAL_REPO=/path bash scripts/smoke-install-pr1.sh        # local mode
#
# Exits 0 on success, non-zero on any check failure. Cleans up the temp
# install dir on EXIT (trap).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SMOKE_HOME="${SMOKE_HOME:-$(mktemp -d -t openaidy-smoke-pr1-XXXXXX)}"
SMOKE_BRANCH="${SMOKE_BRANCH:-main}"
SMOKE_REPO_URL="${SMOKE_REPO_URL:-}"
LOCAL_REPO="${LOCAL_REPO:-}"

cleanup() {
    local code=$?
    if [ -d "$SMOKE_HOME" ]; then
        rm -rf "$SMOKE_HOME"
    fi
    exit $code
}
trap cleanup EXIT INT TERM

log()  { echo "[smoke-pr1] $*"; }
fail() { echo "[smoke-pr1] FAIL: $*" >&2; exit 1; }

# Required tools — smoke skips (exit 0) when missing on POSIX runners
for tool in node pnpm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "[smoke-pr1] SKIP: required tool '$tool' is not on PATH"
        exit 0
    fi
done

# ============================================================================
# Mode 1 (default): end-to-end install.sh
# ============================================================================
if [ -z "$LOCAL_REPO" ]; then
    for tool in git curl openssl; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "[smoke-pr1] SKIP: required tool '$tool' is not on PATH (set LOCAL_REPO to skip network and use a local checkout)"
            exit 0
        fi
    done

    SMOKE_REPO_URL="${SMOKE_REPO_URL:-https://github.com/imzodev/openaidy.git}"
    log "Using OPENAIDY_HOME=$SMOKE_HOME"
    log "Using repo URL=$SMOKE_REPO_URL (branch=$SMOKE_BRANCH)"

    log "Running install.sh..."
    if ! bash "$REPO_ROOT/install.sh" --dir "$SMOKE_HOME" --branch "$SMOKE_BRANCH" \
            > "$SMOKE_HOME/install.log" 2>&1; then
        cat "$SMOKE_HOME/install.log" >&2
        fail "install.sh exited non-zero"
    fi

    if ! grep -q "Bootstrap admin token:" "$SMOKE_HOME/install.log"; then
        cat "$SMOKE_HOME/install.log" >&2
        fail "install log missing 'Bootstrap admin token:' line"
    fi
    if ! grep -q "Server startup is delivered in the next release" "$SMOKE_HOME/install.log"; then
        cat "$SMOKE_HOME/install.log" >&2
        fail "install log missing honest PR1 server-startup caveat"
    fi

# ============================================================================
# Mode 2: LOCAL_REPO — exercise just `openaidy init` against a local repo
# ============================================================================
else
    if [ ! -d "$LOCAL_REPO/packages/cli" ]; then
        fail "LOCAL_REPO=$LOCAL_REPO does not contain packages/cli"
    fi

    log "Using LOCAL_REPO=$LOCAL_REPO"
    log "Using OPENAIDY_HOME=$SMOKE_HOME"

    # Generate a real JWT secret
    if command -v openssl >/dev/null 2>&1; then
        export WS_TOKEN_SECRET
        WS_TOKEN_SECRET=$(openssl rand -hex 32)
    else
        # Portable fallback
        WS_TOKEN_SECRET=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
    fi
    export OPENAIDY_HOME="$SMOKE_HOME"

    log "Running: openaidy init (LOCAL_REPO mode)"
    INIT_OUTPUT=$(cd "$LOCAL_REPO" && node --import tsx "$LOCAL_REPO/packages/cli/bin/openaidy.ts" init 2>&1)
    INIT_EXIT=$?
    if [ "$INIT_EXIT" -ne 0 ]; then
        echo "$INIT_OUTPUT" >&2
        fail "openaidy init exited $INIT_EXIT"
    fi

    if ! printf '%s\n' "$INIT_OUTPUT" | grep -q "^Bootstrap admin token: "; then
        echo "$INIT_OUTPUT" >&2
        fail "openaidy init stdout missing 'Bootstrap admin token:' line"
    fi
fi

# ============================================================================
# Common assertions (both modes)
# ============================================================================

TOKEN_FILE="$SMOKE_HOME/credentials/bootstrap-admin.json"
if [ ! -f "$TOKEN_FILE" ]; then
    if [ -n "${SMOKE_HOME:-}/install.log" ]; then
        cat "$SMOKE_HOME/install.log" >&2
    fi
    fail "token file not found at $TOKEN_FILE"
fi

# Mode 0o600 on POSIX (skip on Windows where NTFS ACLs are used)
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows*)
        log "Windows detected — skipping POSIX 0o600 mode check (NTFS ACL is best-effort)"
        ;;
    *)
        MODE=$(stat -c '%a' "$TOKEN_FILE" 2>/dev/null || stat -f '%A' "$TOKEN_FILE" 2>/dev/null || echo "unknown")
        if [ "$MODE" != "600" ]; then
            fail "token file mode is $MODE (expected 600)"
        fi
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

# Idempotency: re-run init and assert token file unchanged
log "Re-running init to check idempotency..."
FIRST_HASH=$(sha256sum "$TOKEN_FILE" | awk '{print $1}')
FIRST_MTIME=$(stat -c '%Y' "$TOKEN_FILE" 2>/dev/null || stat -f '%m' "$TOKEN_FILE" 2>/dev/null || echo "0")
sleep 1

if [ -z "$LOCAL_REPO" ]; then
    if ! bash "$REPO_ROOT/install.sh" --dir "$SMOKE_HOME" --branch "$SMOKE_BRANCH" \
            > "$SMOKE_HOME/install-2.log" 2>&1; then
        cat "$SMOKE_HOME/install-2.log" >&2
        fail "second install.sh exited non-zero"
    fi
else
    cd "$LOCAL_REPO" && node --import tsx "$LOCAL_REPO/packages/cli/bin/openaidy.ts" init > /dev/null 2>&1
fi

SECOND_HASH=$(sha256sum "$TOKEN_FILE" | awk '{print $1}')
SECOND_MTIME=$(stat -c '%Y' "$TOKEN_FILE" 2>/dev/null || stat -f '%m' "$TOKEN_FILE" 2>/dev/null || echo "0")

if [ "$FIRST_HASH" != "$SECOND_HASH" ]; then
    fail "token file content changed on re-run (idempotency violation)"
fi
if [ "$FIRST_MTIME" != "$SECOND_MTIME" ]; then
    fail "token file mtime changed on re-run (idempotency violation)"
fi

log "OK: idempotent — token unchanged across re-run"
log "SUCCESS: smoke-install-pr1.sh"
