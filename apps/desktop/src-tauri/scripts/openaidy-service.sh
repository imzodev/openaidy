#!/usr/bin/env bash
#
# openaidy-service — Wrapper script for the OpenAidy background service
#
# This is installed as the ExecStart for the systemd service or LaunchAgent.
# It sets up the environment and launches the server.

set -e

OPENAIDY_HOME="${OPENAIDY_HOME:-$HOME/.config/openaidy}"
export OPENAIDY_HOME

# Load environment
if [ -f "$OPENAIDY_HOME/.env" ]; then
  set -a
  source "$OPENAIDY_HOME/.env"
  set +a
fi

# Find the server
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../../apps/server/dist/index.js" ]; then
  SERVER="$SCRIPT_DIR/../../../apps/server/dist/index.js"
  RUNNER="node"
else
  SERVER="$SCRIPT_DIR/../../../apps/server/src/server.ts"
  RUNNER="tsx"
fi

exec $RUNNER "$SERVER"