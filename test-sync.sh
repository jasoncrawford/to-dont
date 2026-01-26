#!/bin/bash
# Quick test script for sync functionality
# Usage: ./test-sync.sh

echo "=== Sync Test Script ==="
echo ""

# Check if vercel dev is running
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "❌ Vercel dev is not running on localhost:3000"
    echo "   Run: vercel dev"
    exit 1
fi

echo "✓ Server is running"

# Test API endpoints
echo ""
echo "Testing API endpoints..."

# Test /api/items (GET)
ITEMS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $(grep SYNC_BEARER_TOKEN .env.local | cut -d= -f2)" http://localhost:3000/api/items)
if [ "$ITEMS_STATUS" = "200" ]; then
    echo "✓ GET /api/items works (status: $ITEMS_STATUS)"
else
    echo "❌ GET /api/items failed (status: $ITEMS_STATUS)"
fi

# Test /api/sync (POST)
SYNC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $(grep SYNC_BEARER_TOKEN .env.local | cut -d= -f2)" -H "Content-Type: application/json" -d '{"items":[]}' http://localhost:3000/api/sync)
if [ "$SYNC_STATUS" = "200" ]; then
    echo "✓ POST /api/sync works (status: $SYNC_STATUS)"
else
    echo "❌ POST /api/sync failed (status: $SYNC_STATUS)"
    echo ""
    echo "⚠️  You need to restart vercel dev to pick up new API files."
    echo "   Press Ctrl+C in the vercel dev terminal, then run: vercel dev"
fi

# Test /api/debug (GET)
DEBUG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/debug)
if [ "$DEBUG_STATUS" = "200" ]; then
    echo "✓ GET /api/debug works (status: $DEBUG_STATUS)"
else
    echo "❌ GET /api/debug failed (status: $DEBUG_STATUS)"
fi

echo ""
echo "To run full tests: node tests/sync-integration.mjs"
