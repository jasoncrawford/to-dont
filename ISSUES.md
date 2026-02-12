# Issues

## #1 - `pushEvents` cursor advancement skips remote events
**Severity: High (data loss)**

In `sync.js:137-143`, `pushEvents()` advances the event cursor to the max seq of the events it just pushed. Then `pullEvents()` fetches `since=getLastSeq()`. If other clients pushed events with seq values between the old cursor and your pushed events' max seq, those events are permanently skipped.

**Example:**
1. Cursor = 40
2. Other client pushed events at seq 41-47 while you were offline
3. You push, server assigns your events seq 48-50
4. `pushEvents` advances cursor to 50
5. `pullEvents` fetches `since=50` — events 41-47 are never pulled

**Fix:** Remove the cursor advancement from `pushEvents()`. Only `pullEvents()` should advance the cursor, since it fetches ALL events (including your own) and advances past all of them.

## #2 - `archived` field has no LWW protection
**Severity: Medium**

In `event-log.js:119`, the LWW guard checks `item[tsKey]`, but for `archived`, `tsKey` = `'archivedUpdatedAt'` which is never initialized in `item_created` and never set in the `archived` switch case. So `item[tsKey]` is always `undefined`, the guard is always skipped, and out-of-order archived events apply in array order rather than by timestamp.

## #3 - Client and server projection diverge
**Severity: Medium**

The client `projectState` (`event-log.js`) applies LWW for `type`, `level`, and `indented` using `*UpdatedAt` timestamps. The server `api/state/index.ts` applies those field changes unconditionally with no LWW check. This means `GET /api/state` can return different results than the client for the same event log when events arrive out of order.

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
