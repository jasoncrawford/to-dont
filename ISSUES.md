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

## ~~#11 - Old API endpoints and items table are dead weight~~ FIXED (d9a5cef)

## #12 - No sync status indicator in the UI
**Severity: Medium**

Users have no visibility into whether their data is synced or stuck. If sync silently fails (bad network, server down), there's no indication. A subtle status indicator (e.g., a dot or icon showing synced/syncing/error) would build trust for multi-device users.

## #13 - Bearer token visible in page source
**Severity: Medium**

The `SYNC_BEARER_TOKEN` is baked into the JS bundle at build time (via Vite `define`) and visible to anyone who views page source. Anyone who discovers the URL has full read/write/delete access to all data. Consider per-user auth (e.g., Supabase Auth) or at minimum a less exposed auth mechanism.

## ~~#14 - No CI/CD — deploying manually from desktop~~ FIXED (d36a9b2)

## ~~#15 - No PWA support for mobile~~ FIXED (0f5bf20)

## #16 - `?reset=1` is a footgun
**Severity: Low**

The `?reset=1` URL parameter was added for data migration and clears all localStorage without confirmation. Now that migration is complete, it should be removed or guarded (e.g., require a confirmation prompt).

## ~~#17 - Non-module script loading~~ FIXED (130c6f0)

