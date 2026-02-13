# Issues

## ~~#1 - `pushEvents` cursor advancement skips remote events~~ FIXED (a1e6f8e)

## ~~#2 - `archived` field has no LWW protection~~ FIXED (0ccfaa3)

## ~~#3 - Client and server projection diverge~~ FIXED (c3bcb66)

## ~~#4 - Unbounded event log in localStorage~~ FIXED (e2b5ec5)

## ~~#5 - Dual sync still active~~ FIXED (aa2b34e)

## ~~#6 - Double event log projection on page load~~ FIXED (df66023)

## ~~#7 - `loadEvents()` never uses its parsed cache~~ FIXED (6ff8894)

## ~~#8 - No pagination for catch-up pulls~~ FIXED (4df5a16)

## ~~#9 - No retry/backoff for sync failures~~ FIXED (00c3dca)

## ~~#10 - Dead code~~ FIXED (9fc8984)

## #11 - Old API endpoints and items table are dead weight
**Severity: Low**

The client no longer uses `/api/sync`, `/api/items`, or the items table (all replaced by `/api/events` and `/api/state`). Migration 004 renames items to items_deprecated but hasn't been applied. The old endpoints and table can be cleaned up once event-based sync is proven in production.

## #12 - No sync status indicator in the UI
**Severity: Low-Medium**

Users have no visibility into whether their data is synced or stuck. If sync silently fails (bad network, server down), there's no indication. A subtle status indicator (e.g., a dot or icon showing synced/syncing/error) would build trust for multi-device users.
