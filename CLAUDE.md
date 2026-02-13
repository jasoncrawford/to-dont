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
- **Single-page vanilla JS app** - Non-module scripts served by Vite
- **Core logic in app.js** - Renders DOM directly, event handlers inline
- **Sync layer in sync.js** - Optional cloud sync, loaded separately
- **Vite dev server** - Serves frontend, generates `sync-config.js` from env vars, proxies `/api/*` to Vercel dev
- Uses `contenteditable` divs for text editing with Selection/Range API

### Data & Sync
- **localStorage** for immediate persistence
- **Supabase** for optional cross-device sync
- **CRDT-inspired sync** with per-field Last-Write-Wins timestamps
- **Fractional indexing** for conflict-free ordering
- Realtime updates via Supabase subscriptions

### API (Vercel serverless)
- `api/sync/` - Main sync endpoint with LWW merge
- `api/items/` - CRUD operations
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
npm run dev        # Terminal 1: Vite on :5173
npm run dev:api    # Terminal 2: Vercel dev on :3001 (proxied via Vite)

# Build for production
npm run build

# Run tests
npm test
```

## Files to Read First

1. `PRODUCT_SPEC.md` - Full product specification
2. `PRACTICES.md` - Development workflow and patterns
3. `app.js` - Frontend application logic
4. `sync.js` - Sync layer implementation
