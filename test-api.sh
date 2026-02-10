#!/bin/bash
# Test all API endpoints
TOKEN="8f512bd8190c0501c6ec356f821fdd32eff914a7770bd9e13b96b10923bfdb65"
BASE="http://localhost:3000"

echo "Testing API endpoints..."
echo ""

test_endpoint() {
    local name=$1
    local method=$2
    local path=$3
    local data=$4

    if [ -z "$data" ]; then
        status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE$path")
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$data" "$BASE$path")
    fi

    if [ "$status" = "200" ] || [ "$status" = "201" ] || [ "$status" = "204" ]; then
        echo "✓ $name ($method $path) - $status"
        return 0
    else
        echo "✗ $name ($method $path) - $status"
        return 1
    fi
}

test_endpoint "GET items" "GET" "/api/items"
TEST_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
test_endpoint "POST items" "POST" "/api/items" '{"id":"'$TEST_UUID'","text":"test","type":"todo","created_at":"2026-01-01T00:00:00Z","position":"n"}'
test_endpoint "POST sync" "POST" "/api/sync" '{"items":[]}'
test_endpoint "GET debug" "GET" "/api/debug"

echo ""
echo "If all pass, sync should work. Restart vercel dev if you see failures."
