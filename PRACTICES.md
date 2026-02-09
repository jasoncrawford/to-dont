# Development Practices

## Technology Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript (no framework)
- **Storage**: Browser localStorage + optional Supabase sync
- **Backend**: Vercel serverless functions (TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Testing**: Playwright (end-to-end browser tests)

## Project Structure

```
to-dont/
├── index.html          # Main HTML structure
├── styles.css          # All styling
├── app.js              # Frontend application logic
├── sync.js             # Sync layer (Supabase integration)
├── fractional-index.js # Shared fractional indexing (CRDT ordering)
├── api/                # Vercel serverless functions
│   ├── sync/           # Main sync endpoint (LWW merge)
│   └── items/          # CRUD operations
├── lib/                # Shared backend utilities
│   ├── auth.ts         # Bearer token auth
│   └── supabase.ts     # Database client + types
├── tests/              # Playwright tests
│   └── helpers.ts      # Shared test utilities
├── migrations/         # Database migrations
├── schema.sql          # Database schema
├── PRODUCT_SPEC.md     # Product specification
├── PRACTICES.md        # This file
└── CLAUDE.md           # Context for AI sessions
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
- **Sync**: Local integration, E2E cross-browser sync

### Test Mode
Tests run with `?test-mode=1` which enables virtual time manipulation for testing decay without waiting 14 days.

## Development Workflow

1. **Understand the change** - Read relevant code first
2. **Make the change** - Keep changes focused
3. **Test manually** - Open `index.html` in browser
4. **Run automated tests** - `npm test`
5. **Commit** - Clear message explaining what and why

### Running Locally with Sync
```bash
# Start the API server
vercel dev

# Then open index.html in browser
# Sync will auto-enable if configured
```

## Sync Architecture

### Conflict Resolution
Uses CRDT-inspired Last-Write-Wins (LWW) with per-field timestamps:
- Each field (`text`, `important`, `completed`, `position`) has its own `*_updated_at` timestamp
- When syncing, each field is resolved independently by taking the newer value
- This allows concurrent edits to different fields without conflict

### Ordering
Uses fractional indexing for position:
- Positions are strings like "a", "n", "z" that sort lexicographically
- Inserting between "a" and "b" creates "an" (midpoint)
- Allows unlimited insertions without reindexing existing items

### Sync Flow
1. Client detects changes via hash comparison
2. Client sends modified items to `/api/sync`
3. Server merges with existing data using per-field LWW
4. Server returns merged state + all items updated since last sync
5. Client applies server changes via realtime subscription or poll

## Code Patterns

### Saving Data (Frontend)
```javascript
const todos = loadTodos();
const todo = todos.find(t => t.id === id);
todo.text = newText;
todo.textUpdatedAt = getVirtualNow();  // CRDT timestamp
saveTodos(todos);
render();
```

### View-Specific Behavior
```javascript
if (viewMode === 'done') {
  // Done view specific behavior
}
```

## Known Limitations

- No mobile optimization
- No keyboard shortcuts help in UI
- No undo/redo
- Single-user (no collaboration features)
