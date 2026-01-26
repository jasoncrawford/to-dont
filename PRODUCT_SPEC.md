# To-Don't - Product Specification

## Overview

To-Don't is a minimalist todo application where items naturally fade away over time. The core philosophy is that most tasks either get done or become irrelevant - items that linger without action gradually disappear, reducing mental clutter without requiring manual cleanup.

## Core Concepts

### Decay and Fading
- Items fade in opacity over 14 days from creation
- After 14 days, items are automatically archived (hidden from Active view)
- Archived items appear in the "Faded away" section at the bottom
- This creates gentle pressure to act on items while they're visible

### Importance
- Items can be marked as "important" (urgent)
- Important items never fade or auto-archive
- Important items visually escalate over time (increasingly prominent styling)
- Escalation levels increase approximately every 3-4 days
- This makes neglected important items increasingly hard to ignore

### Views
- **Active view**: Shows incomplete items in user-defined order, with completed items shown but struck through
- **Done view**: Shows completed items grouped by completion date (Today, Yesterday, or date), in reverse chronological order

### Sections
- Empty items can be converted to section headers by pressing Enter
- Sections group related items visually
- Two levels: Level 1 (prominent) and Level 2 (subtle, indented)
- Sections and their children move together when reordered

### Indentation
- Todos can be indented with Tab for visual grouping
- Indented items appear nested under the item above them
- Unindent with Shift+Tab

### Sequences
- Items containing arrows (`->`, `-->`, `→`, etc.) represent sequential tasks
- When completed, the item splits: text before arrow is marked done, text after becomes a new item
- Example: "draft email -> send email" when checked becomes "[x] draft email" and "[ ] send email"

## User Interface

### Layout
- Tab bar at top: Active | Done
- Todo list in the middle
- New item input at bottom (Active view only)
- "Archive completed" button (Active view only, when completed items exist)
- "Faded away" expandable section at bottom (when archived items exist)

### Item Display
- Checkbox on left
- Item text (editable)
- Creation date on right
- Action buttons on hover: ! (importance toggle), × (delete)
- Drag handle on hover (Active view only)

### Done View Specifics
- Items grouped under day headers (Today, Yesterday, or "Jan 15" format)
- No strikethrough styling
- Checkboxes are disabled (read-only)
- No importance button
- No drag handles
- No new item input

## Keyboard Behavior

The application is designed to feel like editing a text file. All keyboard behaviors support this metaphor.

### Navigation
| Key | Behavior |
|-----|----------|
| ArrowUp | Move focus to previous item (with cursor) |
| ArrowDown | Move focus to next item (with cursor) |
| ArrowLeft (at start) | Move to end of previous item |
| ArrowRight (at end) | Move to start of next item |
| Cmd+ArrowUp | Jump to first item |
| Cmd+ArrowDown | Jump to last item |

### Editing
| Key | Behavior |
|-----|----------|
| Enter (at end) | Insert new item below, focus new item |
| Enter (at start) | Insert new item above, keep focus on current item |
| Enter (in middle) | Split item at cursor, focus second part |
| Enter (on empty item) | Convert to section header |
| Backspace (at start) | Merge with previous item, cursor at join point |
| Tab | Indent item (or demote section to level 2) |
| Shift+Tab | Unindent item (or promote section to level 1) |

### Reordering
| Key | Behavior |
|-----|----------|
| Cmd+Shift+ArrowUp | Move item/section up |
| Cmd+Shift+ArrowDown | Move item/section down |

Note: Sections move with all their children when reordered.

### Importance Shortcut
- Typing `!` in item text turns on the important flag
- Deleting the last `!` from item text turns off the important flag
- This is additive to the ! button (editing text with existing `!` doesn't re-trigger)

## Data Persistence

### Local Storage
- Primary storage in localStorage for offline-first experience
- Key: `decay-todos` (array of todo objects)
- Key: `decay-todos-view-mode` (string: 'active' or 'done')
- Text auto-saves 300ms after typing stops (debounced)
- Also saves on blur as fallback

### Cross-Device Sync (Optional)
- Syncs to Supabase when configured
- CRDT-inspired conflict resolution with per-field timestamps
- Each field (text, important, completed, position) has its own timestamp
- Conflicts resolved by Last-Write-Wins on a per-field basis
- Fractional indexing for ordering (allows insertions without reindexing)
- Realtime updates pushed to other connected devices

## Test Mode

Adding `?test-mode=1` to the URL enables:
- Virtual time controls (+1 day button, reset button)
- Time offset persisted in `decay-todos-time-offset`
- Useful for testing decay/archive behavior

## Other Behaviors

- Paste strips formatting (plain text only)
- Empty items are allowed (not auto-deleted)
- Drag and drop for reordering (Active view only)
- Completed items in Active view show strikethrough
