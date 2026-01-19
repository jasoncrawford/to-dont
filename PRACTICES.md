# Development Practices

## Technology Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript (no framework)
- **Storage**: Browser localStorage
- **Testing**: Playwright (end-to-end browser tests)
- **Version Control**: Git

## Project Structure

```
to-dont/
├── index.html        # Main HTML structure
├── styles.css        # All styling
├── app.js            # All application logic
├── tests/            # Playwright test files (120 tests)
│   ├── helpers.ts    # Shared test utilities
│   ├── core.spec.ts  # CRUD, completion, deletion, importance shortcut
│   ├── decay.spec.ts # Fading, opacity, importance escalation
│   ├── done-view.spec.ts    # Done view display, grouping, restrictions
│   ├── keyboard.spec.ts     # Navigation, editing, reordering
│   ├── click-behavior.spec.ts # Click handling
│   ├── reorder.spec.ts      # Drag and drop
│   ├── sections.spec.ts     # Section creation and grouping
│   └── sequence.spec.ts     # Arrow splitting
├── PRODUCT_SPEC.md   # Product specification
├── PRACTICES.md      # This file
└── CLAUDE.md         # Context for AI assistant sessions
```

## Version Control

### Commit Practices
- Commit after each completed feature or bug fix
- Write clear commit messages explaining the "why"
- First line is a brief summary
- Body explains the change in more detail when needed

### Commit Message Format
```
Brief summary of change (imperative mood)

More detailed explanation if needed. Explains what changed
and why, not just what the code does.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Testing

### Philosophy
- Maintain comprehensive test coverage
- Tests verify user-visible behavior, not implementation details
- Add tests for new features
- Run tests before committing

### Running Tests
```bash
# Requires Node.js 18+
npm test

# Or with nvm
source ~/.nvm/nvm.sh && nvm use 18 && npm test
```

### Test Organization
- `core.spec.ts` - Basic CRUD operations, completion, deletion
- `decay.spec.ts` - Fading, opacity, importance escalation
- `done-view.spec.ts` - Done view display, grouping, archive button
- `keyboard.spec.ts` - All keyboard navigation and editing
- `click-behavior.spec.ts` - Click handling for todos and sections
- `reorder.spec.ts` - Drag and drop, keyboard reordering
- `sections.spec.ts` - Section creation, levels, grouping
- `sequence.spec.ts` - Arrow splitting behavior

### Test Helpers
Common utilities in `helpers.ts`:
- `setupPage(page)` - Navigate and clear localStorage
- `addTodo(page, text)` - Add a new todo item
- `createSection(page, title)` - Create a section header
- `completeTodo(page, text)` - Check off a todo
- `getTodoTexts(page)` - Get all todo text contents
- `setVirtualTime(page, days)` - Advance virtual time for testing

### Test Mode
Tests run with `?test-mode=1` URL parameter which:
- Shows time control buttons
- Enables virtual time manipulation
- Allows testing decay/archive without waiting 14 days

## Code Style

### JavaScript
- No build step or transpilation
- Modern ES6+ syntax (const/let, arrow functions, template literals)
- Single `app.js` file for simplicity
- Functions organized by feature area
- Event handlers defined inline in element creation

### CSS
- Single `styles.css` file
- BEM-ish class naming
- CSS custom properties for colors would be nice (not yet implemented)
- Mobile-responsive considerations (not yet fully implemented)

### HTML
- Semantic structure
- Minimal markup - most elements created dynamically in JS
- `contenteditable` divs for inline editing

## Development Workflow

1. **Understand the change** - Read relevant code first
2. **Make the change** - Edit code, keeping changes focused
3. **Test manually** - Open `index.html` in browser, verify behavior
4. **Run automated tests** - `npm test`, fix any failures
5. **Commit** - Clear message explaining what and why

## Common Patterns

### Saving Data
```javascript
// Load
const todos = loadTodos();  // Returns array from localStorage

// Modify
todos.push(newTodo);
// or
const todo = todos.find(t => t.id === id);
todo.text = newText;

// Save
saveTodos(todos);  // Writes to localStorage

// Re-render
render();  // Rebuilds DOM from current state
```

### Debounced Save
Text changes use debounced saving (300ms) to avoid excessive writes:
```javascript
text.oninput = () => {
  debouncedSave(todo.id, text.textContent);
};
```

### View-Specific Behavior
Check `viewMode` to conditionally render or behave:
```javascript
if (viewMode === 'done') {
  // Done view specific behavior
}
```

### Virtual Time (Test Mode)
```javascript
// Get current time (real or virtual)
const now = getVirtualNow();

// Calculate days since creation
const days = getDaysSince(todo.createdAt);
```

## Known Limitations

- No mobile optimization yet
- No keyboard shortcuts help/documentation in UI
- No undo/redo
- No cloud sync
- Single-user only (localStorage)
