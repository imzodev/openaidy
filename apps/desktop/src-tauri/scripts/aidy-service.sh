#!/usr/bin/env bash
#
# aidy-service — Wrapper script for the Aidy background service
#
# This is installed as the ExecStart for the systemd service or LaunchAgent.
# It sets up the environment and launches the server.

set -e

AIDY_HOME="${AIDY_HOME:-$HOME/.config/aidy}"
export AIDY_HOME

# Load environment
if [ -f "$AIDY_HOME/.env" ]; then
  set -a
  source "$AIDY_HOME/.env"
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