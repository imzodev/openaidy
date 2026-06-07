#!/usr/bin/env bash
#
# openaidy-service — Wrapper script for the OpenAidy background service
#
# This is installed as the ExecStart for the systemd service or LaunchAgent.
# It sets up the environment and launches the server.

set -e

OPENAIDY_HOME="${OPENAIDY_HOME:-$HOME/.config/openaidy}"
export OPENAIDY_HOME

# Load env file if present
ENV_FILE="$OPENAIDY_HOME/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Determine if we should use tsx (dev) or node (prod)
SERVER_ENTRY="$OPENAIDY_HOME/../../../apps/server/dist/index.js"
if [ ! -f "$SERVER_ENTRY" ]; then
  SERVER_ENTRY="$OPENAIDY_HOME/../../../apps/server/src/server.ts"
  RUNNER="tsx"
else
  RUNNER="node"
fi

# Change to workspace root
cd "$(dirname "$SERVER_ENTRY")/../../../../"

# Run the server
exec $RUNNER "$SERVER_ENTRY"