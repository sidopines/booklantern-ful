#!/bin/bash
# Write the env file with new auth cookies
cat > ~/.booklantern_e2e_env << 'ENVEOF'
export BASE_URL=https://booklantern.org
export AUTH_COOKIE="bl_sub=REDACTED; bl.sid=REDACTED"
ENVEOF
echo "Env file updated"
cat ~/.booklantern_e2e_env
