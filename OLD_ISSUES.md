# To-Don't: Known Issues & Architectural Weaknesses

Identified 2026-02-07 during code review.

## Critical: Security

### ~~1. Hardcoded credentials committed to repo~~ NOT AN ISSUE
**File:** `sync-config.js:12-15`

~~Supabase URL, anon key, bearer token, and API URL are hardcoded in a committed file. Anyone with repo access has full database access.~~

`sync-config.js` is in `.gitignore` — it is not committed to the repo.

### 2. No Row-Level Security, single shared token
**Files:** `lib/auth.ts`, `schema.sql`

Authentication is a single static bearer token compared with string equality. No user accounts, no RLS policies on the Supabase table. The anon key is exposed client-side, so a client could bypass the API entirely and query Supabase directly.

---

## Critical: Data Loss Bugs

### ~~3. `fetchAndMergeTodos` doesn't merge — it replaces~~ FIXED
**File:** `sync.js:604`

~~The function does `localStorage.setItem('decay-todos', JSON.stringify(localItems))` — a full overwrite. Any local changes not yet synced are silently destroyed. Called during `enableSync()`, so on every page load with sync enabled, unsynced local changes are lost.~~

Fixed in 8b1e279: rewrote to merge server state with local state via `mergeLocalWithRemote`, preserving unsynced local items and local-only fields.

### ~~4. `updateTodoText` doesn't set `textUpdatedAt`~~ FIXED
**File:** `app.js:1273-1280`

~~The `onblur` handler calls `updateTodoText()`, which saves text without updating the CRDT timestamp. Only `debouncedSave` (line 38) sets `textUpdatedAt`. If a user types then immediately blurs (before the 300ms debounce fires), the CRDT timestamp still reflects the *previous* text. A concurrent edit on another device with an older timestamp could then "win" during merge.~~

Fixed in 7899144: `updateTodoText` now sets `textUpdatedAt` when saving, ensuring the CRDT timestamp always reflects the latest text.

### ~~5. `toLocalFormat` hardcodes `archived: false`~~ FIXED
**File:** `sync.js:235`

~~Every item from the server has `archived` forced to `false`. Combined with issue #3 (replace-not-merge), archived items are un-archived on every sync fetch. Archive state cannot survive a page reload if sync is enabled.~~

Fixed in 8b1e279: `fetchAndMergeTodos` now merges via `mergeLocalWithRemote` which spreads from local first, so `archived`/`archivedAt` are preserved. `toLocalFormat` still defaults `archived: false` for genuinely new items, which is correct.

### ~~24. Section text lost on Tab/Shift+Tab level change~~ FIXED
**File:** `app.js:677-688`

~~Tab and Shift+Tab handlers in `createSectionElement` called `setSectionLevel()` without first saving the text via `updateTodoText()`. Since `setSectionLevel` triggers a full DOM rebuild (issue #17), any text typed since the last blur/save was silently discarded. The Cmd+Shift+Arrow handlers already had the correct pattern.~~

Fixed in 26dd26a: added `updateTodoText()` calls before `setSectionLevel()` in both Tab and Shift+Tab handlers.

---

## High: Sync Protocol Issues

### ~~6. Sync response is completely ignored~~ FIXED
**File:** `sync.js:380-383`

~~The `/api/sync` endpoint returns `{ items, mergedItems, syncedAt }`. The client throws it away. If the server resolved a conflict differently, the client never learns about it and local state diverges from server.~~

Fixed: `syncChanges()` now captures the sync response and applies `mergedItems` back to local state via new `applyMergedResponse()` function. Uses existing `mergeLocalWithRemote()` for per-field LWW, preserves local IDs, only re-renders if actual changes detected. Same pattern applied to initial sync path in `enableSync()`.

### ~~7. `level`, `indented`, and `type` have no CRDT timestamps~~ FIXED
**Files:** `sync.js:496-509`, `api/sync/index.ts:35`

~~Per-field LWW covers text, important, completed, and position — but `level`, `indented`, and `type` have no timestamps. Two devices changing a section's level simultaneously produce inconsistent results.~~

Fixed: Added `type_updated_at`, `level_updated_at`, `indented_updated_at` columns and per-field LWW merge logic matching the existing CRDT pattern. Timestamps set in `app.js` wherever these fields change.

### ~~8. Inconsistent merge direction for non-CRDT fields~~ FIXED
**Files:** `api/sync/index.ts:35`, `sync.js:496-509`

~~Server-side merge always takes client's `level` and `indented`. Client-side merge takes remote's if different. These are opposite strategies for the same fields.~~

Fixed: Both server and client now use LWW timestamp comparison for `type`, `level`, and `indented` (resolved by #7's CRDT timestamps).

### ~~9. Deletions are sequential, not batched~~ FIXED
**File:** `sync.js:387-402`

~~Deletions are individual DELETE requests in a `for` loop. If one fails, remaining deletions stop, but `lastSyncedState` is still updated (line 404), so failed deletes won't be retried.~~

Fixed: Deletions are now sent as `deleteIds` in the `/api/sync` POST body (single batch request). If the request fails, `lastSyncedState` is not updated, so deletions are naturally retried on the next sync cycle.

---

## High: Architectural Weaknesses

### ~~10. Three copies of fractional indexing algorithm~~ FIXED
**Files:** `lib/fractional-index.ts`, `sync.js:48-134`, `app.js:62-94`

~~Three implementations with different edge case behavior. If sync.js loads first, app.js uses the sync version; if not, it uses its own. Non-deterministic behavior.~~

Fixed: Extracted canonical implementation into `fractional-index.js` loaded via script tag before both consumers. `sync.js` and `app.js` both delegate to `window.FractionalIndex`. Deleted dead `lib/fractional-index.ts`.

### ~~11. Monkey-patching `saveTodos` via polling~~ FIXED
**File:** `sync.js:741-764`

~~Sync layer polls every 50ms for `window.saveTodos` to exist, then wraps it. Has a 5-second timeout, after which it silently gives up. If app.js loads slowly, sync never hooks in with no error or indication.~~

Fixed: Replaced polling/monkey-patching with an explicit `onSave` hook on `window.ToDoSync`. `app.js`'s `saveTodos()` calls the hook directly after saving to localStorage. No polling, no timeouts, no global `_originalSaveTodos`.

### ~~12. Dual ID system creates fragility~~ FIXED
**File:** `sync.js:140-182`

~~Items have local IDs (timestamp-based) and UUIDs (for server). Mapping stored in separate localStorage key. If mapping gets corrupted or cleared, items duplicate on server. Reverse lookup is O(n) over all mappings.~~

Fixed: UUID now stored directly on each item as `serverUuid` property, eliminating the separate `decay-todos-id-mapping` localStorage key. Includes one-time migration for existing users. No more mapping corruption risk.

### ~~13. No offline recovery mechanism~~ FIXED
**File:** `sync.js:411-422`

~~If offline, sync silently fails. When connectivity returns, nothing triggers re-sync. User must make a new edit to trigger the debounced sync.~~

Fixed: Added `handleOnline()` listener for the browser `'online'` event. When connectivity returns, pending local changes are pushed and remote changes are pulled automatically.

---

## Medium: Bugs

### ~~14. PATCH endpoint references nonexistent `sort_order` field~~ FIXED
**File:** `api/items/[id].ts:34`

~~`sort_order` doesn't exist in `DbItem` or the schema. The field is `position`. PATCH also can't update `indented`, `position`, or any CRDT timestamp fields.~~

Fixed: Replaced `sort_order` with `position`, added `indented` and all 7 CRDT timestamp fields to the PATCH handler. Also cleaned up stale `sort_order` references in test scripts.

### ~~15. `archiveOldItems` uses `Date.now()` instead of `getVirtualNow()`~~ FIXED
**File:** `app.js:196`

~~`todo.archivedAt = Date.now()` should be `getVirtualNow()`. Inconsistent with every other timestamp in the app.~~

Fixed in b2c050e: changed `Date.now()` to `getVirtualNow()` in `archiveOldItems`.

### ~~16. `contentEditable` set to boolean~~ FIXED
**File:** `app.js:261`

~~`text.contentEditable = !todo.archived` sets the attribute to boolean `true`/`false`, but the DOM attribute expects string `"true"`/`"false"`.~~

Fixed in fd9ddbb: changed to `String(!todo.archived)` in `createTodoElement` and `'true'` in `createSectionElement`.

---

## Medium: Performance

### 17. Full DOM teardown/rebuild on every change
**File:** `app.js:857`

`render()` does `todoList.innerHTML = ''` and recreates every element. Destroys focus, selection, scroll position, and CSS transitions. The codebase is filled with `setTimeout(() => el.focus(), 0)` workarounds.

### ~~18. `loadTodos()` parses JSON from localStorage on every call~~ FIXED
**File:** `app.js:44-47`

~~No in-memory cache. Keyboard navigation, drag-and-drop mousemove (`app.js:1487` calls `loadTodos()` per pixel of movement), and `render()` all parse full JSON repeatedly.~~

Fixed: Added in-memory JSON string cache. `loadTodos()` uses `===` comparison to detect changes, avoiding redundant parsing. `saveTodos()` updates the cache. New `invalidateTodoCache()` called by sync.js wherever it writes localStorage directly.

### 19. No pagination — all items fetched always
**Files:** `api/items/index.ts:20-23`, `api/sync/index.ts`

Both GET and POST endpoints fetch the entire items table. Since items are never hard-deleted server-side, this grows unboundedly.

---

## Lower Priority

### 20. `document.execCommand('insertText')` is deprecated
**Files:** `app.js:366`, `app.js:672`

Used for paste-as-plain-text. Will eventually break in browsers.

### ~~21. Duplicated keyboard handler code~~ FIXED
**Files:** `app.js` `createSectionElement` vs `createTodoElement`

~~~130 lines of near-identical keyboard handling code duplicated between the two element constructors.~~

Fixed: Extracted 8 shared keyboard navigation patterns into `handleCommonKeydown()`. Both element constructors delegate to it, reducing app.js by 90 lines.

### ~~22. Sync dropped if already in progress~~ FIXED
**File:** `sync.js:412`

~~`isSyncing` guard prevents concurrent syncs. If debounce fires while a sync is in progress, the sync is silently dropped (not re-queued).~~

Fixed: When a sync is requested while `isSyncing` is true, a `syncPending` flag is set. After the current sync completes, the pending sync runs automatically so changes are never lost.

### ~~23. `generateInitialPositions` produces duplicates for large lists~~ FIXED
**Files:** `sync.js:122-134`, `lib/fractional-index.ts:168-184`

~~Only 22 distinct single-char positions between 'c' and 'x'. Lists with >22 items get duplicate positions.~~

Fixed: For lists >22 items, `generateInitialPositions` now computes multi-character positions using base-26 arithmetic, ensuring unique, lexicographically sorted positions for any list size.

### ~~25. Flaky sync-e2e tests due to timing~~ FIXED
**Files:** `tests/sync-e2e.spec.ts`

~~Several sync-e2e tests are intermittently flaky, particularly "creating a section syncs to database" and "unindenting a todo syncs to database". They rely on fixed `waitForTimeout` delays (2-4 seconds) for sync debounce + server round-trip, which can be insufficient when tests run serially after many prior tests. Since sync-e2e tests run serially (shared database state), one flaky failure cascades and skips all subsequent tests.~~

Fixed: Replaced all sync-related `waitForTimeout` calls with `waitForDbCondition()`, a polling helper that queries the database every 300ms until the expected state appears (12s timeout). Also uses Playwright's `toPass()` for cross-browser UI assertions. Remaining `waitForTimeout` calls are short UI/DOM waits (50-500ms) only.
