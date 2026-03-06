#!/bin/bash
set -e

echo "--- sourcing ---"
source ~/.booklantern_e2e_env

# Pre-flight: never print real cookie values
echo "--- verifying ---"
if [ -z "$AUTH_COOKIE" ]; then
  echo "ERROR: AUTH_COOKIE is not set. Run scripts/update-env.sh first." >&2
  exit 1
fi
echo "AUTH_COOKIE set? true  len: ${#AUTH_COOKIE}"

echo ""
echo "=== Running npm run e2e ==="
cd /workspaces/booklantern-ful
npm run e2e -- --reporter=line 2>&1 || true

echo ""
echo "=== Running pdf-favorites spec ==="
npx playwright test tests/e2e/pdf-favorites.spec.js --reporter=line 2>&1 || true

echo ""
echo "=== DONE ==="
