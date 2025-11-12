#!/bin/bash
set -e

base=${BASE:-http://localhost:10000}

echo "Testing federated search API..."
echo "Query: tolstoy"
echo ""

response=$(curl -sS "$base/api/search?q=tolstoy")

echo "$response" | jq '.items[0] | {title, format, token: (.token | .[0:20] + "...")}'

echo ""
echo "Search test completed successfully!"
