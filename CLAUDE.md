# Claude Session Context

This file contains context for AI assistant sessions working on this project.

## Project Summary

To-Don't is a minimalist todo app where items fade away over 14 days. The core idea is that undone tasks either get done or become irrelevant - the app handles this naturally through visual decay and auto-archiving.

## Key Design Principles

1. **Text-file feeling**: The app should feel like editing a plain text file. Keyboard navigation, Enter/Backspace behavior, and cursor movement all follow text editor conventions.

2. **Lightweight interaction**: Features like typing `!` to mark important reduce friction. No modals or confirmations.

3. **Visual feedback over UI chrome**: Fading opacity, escalating importance colors, and strikethrough communicate state without buttons.

## Architecture

### Frontend
- **React 19 SPA** - ES module entry point (`src/main.tsx`), components in `src/components/`
- **Legacy scripts** - `sync.js`, `event-log.js`, `fractional-index.js`, `sync-config.js` loaded as non-module `<script>` tags before React
- **State via `useSyncExternalStore`** - React reads from localStorage via `loadTodos()`, notified via `window.render()` / `notifyStateChange()`
- **Uncontrolled contenteditable** - Text set via `useLayoutEffect` ref, never as React children. Preserves cursor/focus during re-renders
- **Vite dev server** with `@vitejs/plugin-react` - Serves frontend, generates `sync-config.js` from env vars, proxies `/api/*` to Vercel dev

### Data & Sync
- **localStorage** for immediate persistence
- **Supabase** for optional cross-device sync
- **CRDT-inspired sync** with per-field Last-Write-Wins timestamps
- **Fractional indexing** for conflict-free ordering
- Realtime updates via Supabase subscriptions

### API (Vercel serverless)
- `api/events/` - Event push/pull endpoint
- `api/state/` - Materialized state endpoint
- `lib/` - Shared utilities (auth, Supabase client, fractional indexing)

### Testing
- **Playwright** for end-to-end browser tests
- Tests cover both offline behavior and live sync scenarios
- **All tests must pass with zero skipped.** If any test is failing or skipped, investigate and fix it — don't leave broken or disabled tests behind. Run `npm test` to verify before finishing work.

## Key Concepts

### Items
- **Todos**: Regular items with checkbox, text, optional importance
- **Sections**: Headers that group items (level 1 or 2)
- Both use the same data structure, differentiated by `type` field

### CRDT Fields
Each item tracks per-field timestamps for conflict resolution:
- `textUpdatedAt`, `importantUpdatedAt`, `completedUpdatedAt`, `positionUpdatedAt`
- Sync merges by taking the newer value for each field independently

### Views
- **Active**: Working items, user-defined order, drag-and-drop enabled
- **Done**: Completed items grouped by date, read-only

## Running the App

```bash
# Start Vite dev server (frontend only, sync disabled)
npm run dev

# Start Vite + API server (full stack with sync)
npm run dev        # Terminal 1: Vite on :3000
npm run dev:api    # Terminal 2: Vercel dev on :3001 (proxied via Vite)

# Build for production
npm run build

# Run tests
npm test
```

## Files to Read First

1. `PRODUCT_SPEC.md` - Full product specification
2. `PRACTICES.md` - Development workflow and patterns
3. `src/App.tsx` - React app shell, state management, component composition
4. `src/hooks/useTodoActions.ts` - All mutation functions (add, delete, toggle, merge, split, reorder, etc.)
5. `sync.js` - Sync layer implementation
6. `event-log.js` - Event sourcing layer
