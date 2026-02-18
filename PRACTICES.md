# Development Practices

## Technology Stack

- **Frontend**: React 19 with TypeScript, built with Vite
- **State**: `useSyncExternalStore` over localStorage (event-sourced)
- **Storage**: Browser localStorage + Supabase sync
- **Backend**: Vercel serverless functions (TypeScript)
- **Database**: Supabase (PostgreSQL) with event sourcing
- **Testing**: Playwright (end-to-end browser tests)

## Project Structure

```
to-dont/
├── index.html              # Shell HTML with <div id="root">
├── styles.css              # All styling
├── vite.config.js          # Vite config (React, PWA, static assets, API proxy)
├── .env.example            # Required env vars template
├── src/
│   ├── main.tsx            # Entry point, renders <App />
│   ├── App.tsx             # Top-level layout and view routing
│   ├── store.ts            # useSyncExternalStore wrappers (todos, view mode, sync status)
│   ├── types.ts            # TodoItem type, ViewMode, window globals
│   ├── utils.ts            # Pure functions (fade, dates, positioning)
│   ├── compat.ts           # Exposes globals on window for legacy script compat
│   ├── lib/
│   │   ├── event-log.js    # Event sourcing: local events → projected state
│   │   ├── sync.js         # Sync layer: push/pull events via Supabase
│   │   └── fractional-index.js  # Fractional indexing for ordering
│   ├── components/
│   │   ├── TodoItem.tsx    # Checkbox, contenteditable text, actions, drag handle
│   │   ├── SectionItem.tsx # Section headers with levels
│   │   ├── TodoList.tsx    # Active/Done views
│   │   ├── NewItemInput.tsx
│   │   ├── ArchiveSection.tsx
│   │   ├── ViewToggle.tsx  # Active/Done tabs + sync status
│   │   ├── SyncStatus.tsx  # Colored dot + label indicator
│   │   └── TestModePanel.tsx
│   └── hooks/
│       ├── useContentEditable.ts  # Blur save, paste, exclamation tracking
│       ├── useDragAndDrop.ts      # Mouse-based reordering
│       ├── useFocusManager.ts     # Post-render focus via ref
│       ├── useKeyboardNav.ts      # Shared arrow/cmd key handlers
│       └── useTodoActions.ts      # All mutation functions via EventLog
├── api/                    # Vercel serverless functions
│   ├── events/             # Push/pull/delete events
│   └── state/              # Server-side state projection
├── lib/                    # Shared backend utilities
│   ├── auth.ts             # Bearer token auth
│   └── supabase.ts         # Database client
├── tests/                  # Playwright tests
├── migrations/             # Database migrations
├── schema.sql              # Database schema (events table)
├── PRODUCT_SPEC.md         # Product specification
├── PRACTICES.md            # This file
└── CLAUDE.md               # Context for AI sessions
```

## Testing

### Philosophy
- Maintain comprehensive test coverage
- Tests verify user-visible behavior, not implementation details
- Add tests for new features
- Run tests before committing

### Running Tests
```bash
npm test
```

### Test Categories
- **Core**: CRUD, completion, deletion, importance
- **Decay**: Fading, opacity, importance escalation
- **Done view**: Display, grouping, restrictions
- **Keyboard**: Navigation, editing, reordering
- **Sections**: Creation, levels, grouping
- **Sync status**: State machine, UI indicator, transitions
- **Sync**: Local integration, E2E cross-browser sync

### Test Mode
Tests run with `?test-mode=1` which enables virtual time manipulation for testing decay without waiting 14 days.

## Development Workflow

1. **Understand the change** - Read relevant code first
2. **Make the change** - Keep changes focused
3. **Test manually** - `npm run dev` and open localhost:3000
4. **Run automated tests** - `npm test`
5. **Commit** - Clear message explaining what and why

### Running Locally
```bash
# Frontend only (no API server)
npm run dev

# Full stack (two terminals)
npm run dev        # Vite dev server on :3000
npm run dev:api    # Vercel dev on :3001 (proxied via Vite)

# Build for production
npm run build
```

Environment variables are read from `.env` (tracked) and `.env.local` (gitignored overrides). Sync config is injected at build time via Vite `define` and read by `compat.ts`.

## Sync Architecture

### Event Sourcing
All mutations emit events (`item_created`, `field_changed`, `item_deleted`) via EventLog. The projected state in `decay-todos` is derived from the event log in `decay-events`.

### Sync Flow
1. Client emits events locally via EventLog
2. Sync layer pushes unpushed events to `/api/events`
3. Server assigns sequence numbers, stores in `events` table
4. Client pulls remote events since last cursor
5. Realtime subscription provides instant notification of remote changes

### Conflict Resolution
Uses Last-Write-Wins (LWW) with per-field timestamps. Each field (`text`, `important`, `completed`, `position`, etc.) has its own `*UpdatedAt` timestamp. Events are applied in timestamp order; later timestamps win.

### Ordering
Uses fractional indexing for position:
- Positions are strings like "a", "n", "z" that sort lexicographically
- Inserting between "a" and "b" creates "an" (midpoint)
- Allows unlimited insertions without reindexing existing items

## Code Patterns

### Mutations (Frontend)
```typescript
// All mutations go through EventLog
window.EventLog.emitFieldChanged(itemId, 'text', newText, now);
notifyStateChange(); // Triggers React re-render via useSyncExternalStore
```

### View-Specific Behavior
```typescript
if (viewMode === 'done') {
  // Done view specific behavior
}
```

## Known Limitations

- No keyboard shortcuts help in UI
- No undo/redo
- Single-user (no collaboration features)
- Bearer token auth (visible in page source)
