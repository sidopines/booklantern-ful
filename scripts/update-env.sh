#!/bin/bash
# Write the env file with auth cookies.
# NEVER hardcode real cookies here — paste them at the prompt.
set -euo pipefail

read -rp "Paste AUTH_COOKIE value (bl_sub=...; bl.sid=...): " cookie
if [ -z "$cookie" ]; then
  echo "ERROR: AUTH_COOKIE cannot be empty." >&2
  exit 1
fi

cat > ~/.booklantern_e2e_env << ENVEOF
export BASE_URL=https://booklantern.org
export AUTH_COOKIE="$cookie"
ENVEOF
echo "Env file updated at ~/.booklantern_e2e_env"
