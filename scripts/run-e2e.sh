#!/bin/bash
set -e

echo "--- sourcing ---"
source ~/.booklantern_e2e_env

echo "--- verifying ---"
node -e 'console.log("AUTH_COOKIE set?", !!process.env.AUTH_COOKIE); console.log("len:", (process.env.AUTH_COOKIE||"").length)'

echo ""
echo "=== Running npm run e2e ==="
cd /workspaces/booklantern-ful
npm run e2e -- --reporter=line 2>&1 || true

echo ""
echo "=== Running pdf-favorites spec ==="
npx playwright test tests/e2e/pdf-favorites.spec.js --reporter=line 2>&1 || true

echo ""
echo "=== DONE ==="
