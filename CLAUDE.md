# Claude Session Context

This file contains context for AI assistant sessions working on this project.

## Project Summary

To-Don't is a minimalist todo app where items fade away over 14 days. The core idea is that undone tasks either get done or become irrelevant - the app handles this naturally through visual decay and auto-archiving.

## Key Design Principles

1. **Text-file feeling**: The app should feel like editing a plain text file. Keyboard navigation, Enter/Backspace behavior, and cursor movement all follow text editor conventions.

2. **Lightweight interaction**: Features like typing `!` to mark important reduce friction. No modals or confirmations.

3. **Visual feedback over UI chrome**: Fading opacity, escalating importance colors, and strikethrough communicate state without buttons.

## Architecture

- **Single-page vanilla JS app** - No framework, no build step
- **All logic in app.js** (~1200 lines) - Renders DOM directly, event handlers inline
- **localStorage persistence** - Immediate saves, debounced while typing
- **Playwright tests** - 120 end-to-end browser tests

## Important Implementation Details

### Text Editing
- Uses `contenteditable` divs, not input/textarea
- Cursor position management via Selection/Range API
- Debounced save (300ms) on input, plus save on blur

### Importance Shortcut
The `!` character toggles importance, but with specific semantics:
- Typing `!` turns ON importance (if not already on)
- Deleting the LAST `!` turns OFF importance (if currently on)
- Editing text that contains `!` does NOT re-trigger importance

This is tracked by counting `!` characters and comparing to previous count.

### View Modes
- `viewMode` variable: 'active' or 'done'
- Done view has restrictions: no editing completion state, no reordering, no importance button
- Done view groups by completion date, not creation date

### Sections
- Sections are items with `type: 'section'`
- Created by pressing Enter on empty item
- Move with their children (all items until next section)

### Test Mode
- Enabled via `?test-mode=1` URL parameter
- Shows +1 day / reset buttons for virtual time
- Allows testing 14-day decay without waiting

## Common Patterns

```javascript
// Load, modify, save pattern
const todos = loadTodos();
const todo = todos.find(t => t.id === id);
todo.someProperty = newValue;
saveTodos(todos);
render();

// View-specific behavior
if (viewMode === 'done') {
  // Different behavior for Done view
}

// Virtual time
const now = getVirtualNow();  // Respects test mode offset
```

## Running the App

```bash
# Just open in browser
open index.html

# Run tests (requires Node 18+)
npm test
```

## Recent Session Work (January 2026)

Features implemented:
- Left/right arrow navigation between items
- Empty items persist (no auto-delete)
- Enter at start inserts above but keeps focus on current item
- Debounced auto-save while typing
- Paste as plain text
- Typing `!` toggles important flag
- Done view simplification (no strikethrough, disabled checkboxes, no ! button)

All features have test coverage. 120 tests total, all passing.

## Files to Read First

1. `PRODUCT_SPEC.md` - Full product specification
2. `PRACTICES.md` - Development workflow and patterns
3. `app.js` - All application logic
4. `tests/helpers.ts` - Test utilities and patterns
