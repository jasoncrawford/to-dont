# To-Don't: Known Issues & Architectural Weaknesses

Identified 2026-02-07 during code review.

## Critical: Security

### 1. Hardcoded credentials committed to repo
**File:** `sync-config.js:12-15`

Supabase URL, anon key, bearer token, and API URL are hardcoded in a committed file. Anyone with repo access has full database access.

### 2. No Row-Level Security, single shared token
**Files:** `lib/auth.ts`, `schema.sql`

Authentication is a single static bearer token compared with string equality. No user accounts, no RLS policies on the Supabase table. The anon key is exposed client-side, so a client could bypass the API entirely and query Supabase directly.

---

## Critical: Data Loss Bugs

### ~~3. `fetchAndMergeTodos` doesn't merge — it replaces~~ FIXED
**File:** `sync.js:604`

~~The function does `localStorage.setItem('decay-todos', JSON.stringify(localItems))` — a full overwrite. Any local changes not yet synced are silently destroyed. Called during `enableSync()`, so on every page load with sync enabled, unsynced local changes are lost.~~

Fixed in 8b1e279: rewrote to merge server state with local state via `mergeLocalWithRemote`, preserving unsynced local items and local-only fields.

### 4. `updateTodoText` doesn't set `textUpdatedAt`
**File:** `app.js:1273-1280`

The `onblur` handler calls `updateTodoText()`, which saves text without updating the CRDT timestamp. Only `debouncedSave` (line 38) sets `textUpdatedAt`. If a user types then immediately blurs (before the 300ms debounce fires), the CRDT timestamp still reflects the *previous* text. A concurrent edit on another device with an older timestamp could then "win" during merge.

### ~~5. `toLocalFormat` hardcodes `archived: false`~~ FIXED
**File:** `sync.js:235`

~~Every item from the server has `archived` forced to `false`. Combined with issue #3 (replace-not-merge), archived items are un-archived on every sync fetch. Archive state cannot survive a page reload if sync is enabled.~~

Fixed in 8b1e279: `fetchAndMergeTodos` now merges via `mergeLocalWithRemote` which spreads from local first, so `archived`/`archivedAt` are preserved. `toLocalFormat` still defaults `archived: false` for genuinely new items, which is correct.

---

## High: Sync Protocol Issues

### 6. Sync response is completely ignored
**File:** `sync.js:380-383`

The `/api/sync` endpoint returns `{ items, mergedItems, syncedAt }`. The client throws it away. If the server resolved a conflict differently, the client never learns about it and local state diverges from server.

### 7. `level`, `indented`, and `type` have no CRDT timestamps
**Files:** `sync.js:496-509`, `api/sync/index.ts:35`

Per-field LWW covers text, important, completed, and position — but `level`, `indented`, and `type` have no timestamps. Two devices changing a section's level simultaneously produce inconsistent results.

### 8. Inconsistent merge direction for non-CRDT fields
**Files:** `api/sync/index.ts:35`, `sync.js:496-509`

Server-side merge always takes client's `level` and `indented`. Client-side merge takes remote's if different. These are opposite strategies for the same fields.

### 9. Deletions are sequential, not batched
**File:** `sync.js:387-402`

Deletions are individual DELETE requests in a `for` loop. If one fails, remaining deletions stop, but `lastSyncedState` is still updated (line 404), so failed deletes won't be retried.

---

## High: Architectural Weaknesses

### 10. Three copies of fractional indexing algorithm
**Files:** `lib/fractional-index.ts`, `sync.js:48-134`, `app.js:62-94`

Three implementations with different edge case behavior. If sync.js loads first, app.js uses the sync version; if not, it uses its own. Non-deterministic behavior.

### 11. Monkey-patching `saveTodos` via polling
**File:** `sync.js:741-764`

Sync layer polls every 50ms for `window.saveTodos` to exist, then wraps it. Has a 5-second timeout, after which it silently gives up. If app.js loads slowly, sync never hooks in with no error or indication.

### 12. Dual ID system creates fragility
**File:** `sync.js:140-182`

Items have local IDs (timestamp-based) and UUIDs (for server). Mapping stored in separate localStorage key. If mapping gets corrupted or cleared, items duplicate on server. Reverse lookup is O(n) over all mappings.

### 13. No offline recovery mechanism
**File:** `sync.js:411-422`

If offline, sync silently fails. When connectivity returns, nothing triggers re-sync. User must make a new edit to trigger the debounced sync.

---

## Medium: Bugs

### 14. PATCH endpoint references nonexistent `sort_order` field
**File:** `api/items/[id].ts:34`

`sort_order` doesn't exist in `DbItem` or the schema. The field is `position`. PATCH also can't update `indented`, `position`, or any CRDT timestamp fields.

### 15. `archiveOldItems` uses `Date.now()` instead of `getVirtualNow()`
**File:** `app.js:196`

`todo.archivedAt = Date.now()` should be `getVirtualNow()`. Inconsistent with every other timestamp in the app.

### 16. `contentEditable` set to boolean
**File:** `app.js:261`

`text.contentEditable = !todo.archived` sets the attribute to boolean `true`/`false`, but the DOM attribute expects string `"true"`/`"false"`.

---

## Medium: Performance

### 17. Full DOM teardown/rebuild on every change
**File:** `app.js:857`

`render()` does `todoList.innerHTML = ''` and recreates every element. Destroys focus, selection, scroll position, and CSS transitions. The codebase is filled with `setTimeout(() => el.focus(), 0)` workarounds.

### 18. `loadTodos()` parses JSON from localStorage on every call
**File:** `app.js:44-47`

No in-memory cache. Keyboard navigation, drag-and-drop mousemove (`app.js:1487` calls `loadTodos()` per pixel of movement), and `render()` all parse full JSON repeatedly.

### 19. No pagination — all items fetched always
**Files:** `api/items/index.ts:20-23`, `api/sync/index.ts`

Both GET and POST endpoints fetch the entire items table. Since items are never hard-deleted server-side, this grows unboundedly.

---

## Lower Priority

### 20. `document.execCommand('insertText')` is deprecated
**Files:** `app.js:366`, `app.js:672`

Used for paste-as-plain-text. Will eventually break in browsers.

### 21. Duplicated keyboard handler code
**Files:** `app.js` `createSectionElement` vs `createTodoElement`

~130 lines of near-identical keyboard handling code duplicated between the two element constructors.

### 22. Sync dropped if already in progress
**File:** `sync.js:412`

`isSyncing` guard prevents concurrent syncs. If debounce fires while a sync is in progress, the sync is silently dropped (not re-queued).

### 23. `generateInitialPositions` produces duplicates for large lists
**Files:** `sync.js:122-134`, `lib/fractional-index.ts:168-184`

Only 22 distinct single-char positions between 'c' and 'x'. Lists with >22 items get duplicate positions.
