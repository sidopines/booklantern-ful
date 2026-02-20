#!/bin/bash
set -e
cd /workspaces/booklantern-ful
rm -f _push.sh
git add -A
echo "=== STATUS ==="
git status --short
echo "=== COMMIT ==="
git commit -m "Fix admin pages navbar include + video genres routing" || echo "Nothing to commit"
echo "=== PUSH ==="
git push origin main 2>&1
echo "=== HASH ==="
git rev-parse --short HEAD
echo "=== LOG ==="
git --no-pager log --oneline -3
echo "=== DONE ==="
# Self-cleanup
rm -f /workspaces/booklantern-ful/_git_ops.sh
