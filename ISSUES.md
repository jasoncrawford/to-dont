# Issues

## ~~#1 - `pushEvents` cursor advancement skips remote events~~ FIXED (a1e6f8e)

## ~~#2 - `archived` field has no LWW protection~~ FIXED (0ccfaa3)

## ~~#3 - Client and server projection diverge~~ FIXED (c3bcb66)

## #4 - Unbounded event log in localStorage
**Severity: High (will eventually break)**

Events accumulate forever in `decay-events`. localStorage has a ~5MB limit. Each event is ~200-300 bytes, giving roughly 15,000-25,000 events before a `QuotaExceededError`. No compaction strategy exists.

**Possible fix:** After events are synced (have `seq`), periodically compact by generating synthetic `item_created` events from current state and discarding the old log.

## ~~#5 - Dual sync still active~~ FIXED (aa2b34e)

## ~~#6 - Double event log projection on page load~~ FIXED (df66023)

## ~~#7 - `loadEvents()` never uses its parsed cache~~ FIXED (6ff8894)

## #8 - No pagination for catch-up pulls
**Severity: Low-Medium**

`pullEvents` uses a server limit of 500 events. A client that's been offline could have thousands to catch up on. There's no follow-up pull when the limit is reached — remaining events are only caught on the next sync cycle.

## #9 - No retry/backoff for sync failures
**Severity: Low**

If `syncCycle` fails, it logs the error and stops. The next sync only happens on a new mutation or online event. No periodic background retry or exponential backoff.

## #10 - Dead code
**Severity: Low**

- `event-log.js`: `isUUID()` defined but never called
- `event-log.js`: `idMap` in `migrateFromState()` declared but never used

## #11 - Old API endpoints and items table are dead weight
**Severity: Low**

The client no longer uses `/api/sync`, `/api/items`, or the items table (all replaced by `/api/events` and `/api/state`). Migration 004 renames items to items_deprecated but hasn't been applied. The old endpoints and table can be cleaned up once event-based sync is proven in production.

## #12 - No sync status indicator in the UI
**Severity: Low-Medium**

Users have no visibility into whether their data is synced or stuck. If sync silently fails (bad network, server down), there's no indication. A subtle status indicator (e.g., a dot or icon showing synced/syncing/error) would build trust for multi-device users.
