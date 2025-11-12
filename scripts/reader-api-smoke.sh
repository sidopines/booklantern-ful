#!/bin/bash
set -e

base=${BASE:-http://localhost:10000}

echo "Testing reader API endpoints (should return 401/redirect without auth)..."
echo ""

echo "1. Testing POST /api/library/save (expect 401 or redirect)..."
status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"book_id":"test:123","title":"Test Book"}' \
  "$base/api/library/save")
echo "Status: $status"
if [ "$status" = "401" ] || [ "$status" = "302" ]; then
  echo "✓ Correctly requires auth"
else
  echo "⚠ Unexpected status (expected 401 or 302)"
fi
echo ""

echo "2. Testing POST /api/reader/progress (expect 401 or redirect)..."
status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"book_id":"test:123","cfi":"epubcfi(/6/4)","progress_percent":50}' \
  "$base/api/reader/progress")
echo "Status: $status"
if [ "$status" = "401" ] || [ "$status" = "302" ]; then
  echo "✓ Correctly requires auth"
else
  echo "⚠ Unexpected status (expected 401 or 302)"
fi
echo ""

echo "3. Testing GET /unified-reader without token (expect 400 or redirect)..."
status=$(curl -sS -o /dev/null -w "%{http_code}" "$base/unified-reader")
echo "Status: $status"
if [ "$status" = "400" ] || [ "$status" = "302" ] || [ "$status" = "401" ]; then
  echo "✓ Correctly handles missing token"
else
  echo "⚠ Unexpected status"
fi
echo ""

echo "Reader API smoke test completed!"
