#!/bin/bash
cd /workspaces/booklantern-ful
git add routes/reading.js utils/bookHelpers.js routes/favorites.js views/account.ejs views/favorites.ejs
git commit -m "fix: dedupe favorites + guarantee resolvable open_url"
git push origin main
echo "=== COMMIT HASH ==="
git log --oneline -1
