const FADE_DURATION_DAYS = 14;
const IMPORTANT_ESCALATION_DAYS = 14;
const UPDATE_INTERVAL = 60000;

// Check for test mode via URL parameter
const isTestMode = new URLSearchParams(window.location.search).get('test-mode') === '1';

// Test mode: virtual time offset in days (persisted)
let timeOffsetDays = isTestMode ? parseInt(localStorage.getItem('decay-todos-time-offset') || '0', 10) : 0;

// View mode: 'active' or 'done'
let viewMode = localStorage.getItem('decay-todos-view-mode') || 'active';
// Migration: convert old 'custom' or 'auto' to 'active'
if (viewMode === 'custom' || viewMode === 'auto') {
  viewMode = 'active';
  localStorage.setItem('decay-todos-view-mode', viewMode);
}

// Drag state
let dragState = null;

// Debounced save timers per item
const saveTimers = new Map();
const SAVE_DEBOUNCE_MS = 300;

function debouncedSave(id, text) {
  // Clear existing timer for this item
  if (saveTimers.has(id)) {
    clearTimeout(saveTimers.get(id));
  }
  // Set new timer
  saveTimers.set(id, setTimeout(() => {
    saveTimers.delete(id);
    const todos = loadTodos();
    const todo = todos.find(t => t.id === id);
    if (todo) {
      todo.text = text.trim();
      todo.textUpdatedAt = getVirtualNow(); // CRDT: track text update time
      saveTodos(todos);
    }
  }, SAVE_DEBOUNCE_MS));
}

function loadTodos() {
  const data = localStorage.getItem('decay-todos');
  return data ? JSON.parse(data) : [];
}

function saveTodos(todos) {
  localStorage.setItem('decay-todos', JSON.stringify(todos));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getVirtualNow() {
  return Date.now() + (timeOffsetDays * 24 * 60 * 60 * 1000);
}

// CRDT helpers - use sync layer functions if available, otherwise inline
function generatePositionBetween(before, after) {
  if (window.ToDoSync && window.ToDoSync.generatePositionBetween) {
    return window.ToDoSync.generatePositionBetween(before, after);
  }
  // Fallback inline implementation
  const MID_CHAR = 'n';
  const BASE_CHARS = 'abcdefghijklmnopqrstuvwxyz';
  if (!before && !after) return MID_CHAR;
  if (!before) {
    const lastChar = after[after.length - 1];
    const idx = BASE_CHARS.indexOf(lastChar);
    if (idx > 1) return after.slice(0, -1) + BASE_CHARS[Math.floor(idx / 2)];
    return '0' + MID_CHAR;
  }
  if (!after) {
    const lastChar = before[before.length - 1];
    const idx = BASE_CHARS.indexOf(lastChar);
    if (idx < BASE_CHARS.length - 2) {
      const midIdx = idx + Math.ceil((BASE_CHARS.length - 1 - idx) / 2);
      return before.slice(0, -1) + BASE_CHARS[midIdx];
    }
    return before + MID_CHAR;
  }
  // Midpoint - simplified
  if (before < after) {
    const beforeIdx = BASE_CHARS.indexOf(before[0]);
    const afterIdx = BASE_CHARS.indexOf(after[0]);
    if (afterIdx - beforeIdx > 1) {
      return BASE_CHARS[beforeIdx + Math.floor((afterIdx - beforeIdx) / 2)];
    }
  }
  return before + MID_CHAR;
}

function getItemPosition(todos, index) {
  if (index < 0 || index >= todos.length) return null;
  return todos[index].position || 'n';
}

function createNewItem(text = '', insertIndex = -1, todos = null) {
  const now = getVirtualNow();
  let position = 'n';

  if (todos && insertIndex >= 0) {
    const before = insertIndex > 0 ? getItemPosition(todos, insertIndex - 1) : null;
    const after = insertIndex < todos.length ? getItemPosition(todos, insertIndex) : null;
    position = generatePositionBetween(before, after);
  }

  return {
    id: generateId(),
    text: text.trim(),
    createdAt: now,
    important: false,
    completed: false,
    archived: false,
    // CRDT fields
    position: position,
    textUpdatedAt: now,
    importantUpdatedAt: now,
    completedUpdatedAt: now,
    positionUpdatedAt: now,
  };
}

function getDaysSince(timestamp) {
  return (getVirtualNow() - timestamp) / (1000 * 60 * 60 * 24);
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date(getVirtualNow());
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDayHeader(timestamp) {
  const date = new Date(timestamp);
  const now = new Date(getVirtualNow());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today - itemDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getFadeOpacity(timestamp) {
  const progress = Math.min(getDaysSince(timestamp) / FADE_DURATION_DAYS, 1);
  return 1 - progress;
}

function getImportanceLevel(timestamp) {
  const progress = getDaysSince(timestamp) / IMPORTANT_ESCALATION_DAYS;
  return Math.min(Math.floor(progress * 5) + 1, 5);
}

function setCursorPosition(el, pos) {
  const textNode = el.firstChild;
  if (!textNode) {
    el.focus();
    return;
  }
  const maxPos = textNode.length || 0;
  const targetPos = Math.min(pos, maxPos);
  const range = document.createRange();
  range.setStart(textNode, targetPos);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function shouldArchive(todo) {
  if (todo.type === 'section') return false;
  if (todo.important || todo.completed || todo.archived) return false;
  return getDaysSince(todo.createdAt) >= FADE_DURATION_DAYS;
}

function archiveOldItems(todos) {
  let changed = false;
  todos.forEach(todo => {
    if (shouldArchive(todo)) {
      todo.archived = true;
      todo.archivedAt = Date.now();
      changed = true;
    }
  });
  if (changed) saveTodos(todos);
  return todos;
}

function createTodoElement(todo) {
  const div = document.createElement('div');
  div.className = 'todo-item';
  div.dataset.id = todo.id;

  // Don't show strikethrough in Done view
  if (todo.completed && viewMode !== 'done') div.classList.add('completed');
  if (todo.indented) div.classList.add('indented');

  if (!todo.completed && !todo.archived) {
    if (todo.important) {
      div.classList.add(`important-level-${getImportanceLevel(todo.createdAt)}`);
    } else {
      div.style.opacity = Math.max(0.2, getFadeOpacity(todo.createdAt));
    }
  }

  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = '⋮⋮';

  // Hide drag handle in done view
  if (viewMode === 'done') {
    dragHandle.style.display = 'none';
  }

  dragHandle.onmousedown = (e) => {
    if (todo.archived) return;
    e.preventDefault();
    const rect = div.getBoundingClientRect();

    // Create floating clone that looks identical
    const clone = div.cloneNode(true);
    clone.classList.add('drag-clone');
    clone.style.width = rect.width + 'px';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    document.body.appendChild(clone);

    // Mark original as placeholder
    div.classList.add('placeholder');

    dragState = {
      id: todo.id,
      placeholder: div,
      clone: clone,
      fixedX: rect.left,
      offsetY: e.clientY - rect.top
    };
  };

  const checkbox = document.createElement('div');
  checkbox.className = 'checkbox';
  checkbox.textContent = todo.completed ? '✓' : '';

  const text = document.createElement('div');
  text.className = 'text';
  text.contentEditable = !todo.archived;
  text.textContent = todo.text;

  const date = document.createElement('span');
  date.className = 'date';
  date.textContent = formatDate(todo.createdAt);

  const actions = document.createElement('div');
  actions.className = 'actions';

  // Hide important button in Done view
  if (viewMode !== 'done') {
    const importantBtn = document.createElement('button');
    importantBtn.className = `important-btn ${todo.important ? 'active' : ''}`;
    importantBtn.textContent = '!';
    importantBtn.title = todo.archived ? 'Rescue item' : (todo.important ? 'Remove urgency' : 'Mark urgent');
    importantBtn.onclick = (e) => { e.stopPropagation(); toggleImportant(todo.id); };
    actions.appendChild(importantBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Delete';
  deleteBtn.onclick = (e) => { e.stopPropagation(); deleteTodo(todo.id); };
  actions.appendChild(deleteBtn);

  // Click checkbox to toggle complete (disabled in Done view)
  if (viewMode !== 'done') {
    checkbox.onclick = (e) => {
      e.stopPropagation();
      toggleComplete(todo.id);
    };
  } else {
    checkbox.style.cursor = 'default';
  }

  // Click elsewhere to focus text at end
  div.onclick = (e) => {
    if (e.target === text || e.target.closest('.actions')) return;
    text.focus();
    // Move cursor to end
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // Save on blur (immediate)
  text.onblur = () => {
    updateTodoText(todo.id, text.textContent);
  };

  // Track ! count to detect typing/deleting !
  let prevExclamationCount = (todo.text.match(/!/g) || []).length;

  // Save while typing (debounced) and toggle important on !/delete
  text.oninput = () => {
    debouncedSave(todo.id, text.textContent);

    // Check if ! count changed
    const currentCount = (text.textContent.match(/!/g) || []).length;
    if (currentCount !== prevExclamationCount) {
      const todos = loadTodos();
      const currentTodo = todos.find(t => t.id === todo.id);
      if (currentTodo) {
        let changed = false;
        // Typing a ! turns on important
        if (currentCount > prevExclamationCount && !currentTodo.important) {
          currentTodo.important = true;
          currentTodo.importantUpdatedAt = getVirtualNow();
          changed = true;
        }
        // Deleting last ! turns off important
        if (currentCount === 0 && prevExclamationCount > 0 && currentTodo.important) {
          currentTodo.important = false;
          currentTodo.importantUpdatedAt = getVirtualNow();
          changed = true;
        }
        if (changed) {
          saveTodos(todos);
          // Update visual styling
          const btn = div.querySelector('.important-btn');
          if (currentTodo.important) {
            div.classList.add(`important-level-${getImportanceLevel(currentTodo.createdAt)}`);
            div.style.opacity = '';
            if (btn) btn.classList.add('active');
          } else {
            for (let i = 1; i <= 5; i++) {
              div.classList.remove(`important-level-${i}`);
            }
            div.style.opacity = Math.max(0.2, getFadeOpacity(currentTodo.createdAt));
            if (btn) btn.classList.remove('active');
          }
        }
      }
      prevExclamationCount = currentCount;
    }
  };

  // Paste as plain text only
  text.onpaste = (e) => {
    e.preventDefault();
    const plainText = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, plainText);
  };

  text.onkeydown = (e) => {
    const todoList = document.getElementById('todoList');
    const items = Array.from(todoList.querySelectorAll('.todo-item, .section-header'));
    const currentIndex = items.indexOf(div);

    // Tab: indent todo
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      setTodoIndent(todo.id, true);
      return;
    }

    // Shift-Tab: unindent todo
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      setTodoIndent(todo.id, false);
      return;
    }

    // Cmd+Shift+Up: move item up (check before plain arrow)
    if (e.key === 'ArrowUp' && e.metaKey && e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      updateTodoText(todo.id, text.textContent); // Save text before moving
      moveItemUp(todo.id);
      return;
    }

    // Cmd+Shift+Down: move item down (check before plain arrow)
    if (e.key === 'ArrowDown' && e.metaKey && e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      updateTodoText(todo.id, text.textContent); // Save text before moving
      moveItemDown(todo.id);
      return;
    }

    // Backspace at start: merge with previous item
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);

      // Only merge if no selection (collapsed) and cursor at position 0
      if (!range.collapsed) return; // Let default behavior delete the selection

      const cursorPos = range.startOffset;
      const atStart = cursorPos === 0 && (range.startContainer === text.firstChild || range.startContainer === text);

      if (atStart && currentIndex > 0) {
        const prevItem = items[currentIndex - 1];
        // Only merge with other todos, not sections
        if (prevItem.classList.contains('todo-item')) {
          e.preventDefault();
          const prevId = prevItem.dataset.id;
          text.blur();
          mergeWithPrevious(todo.id, prevId);
          return;
        }
      }
    }

    // Enter: behavior depends on cursor position
    if (e.key === 'Enter') {
      const content = text.textContent;

      if (!content.trim()) {
        e.preventDefault();
        convertToSection(todo.id);
        return;
      }

      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      const cursorPos = range.startOffset;

      // Check if cursor is at start, end, or middle
      const atStart = cursorPos === 0 && range.startContainer === text.firstChild ||
                     (range.startContainer === text && cursorPos === 0);
      const atEnd = (range.startContainer === text.lastChild && cursorPos === text.lastChild.length) ||
                   (range.startContainer === text && cursorPos === text.childNodes.length) ||
                   (range.startContainer.nodeType === 3 && cursorPos === range.startContainer.length && !range.startContainer.nextSibling);

      if (atStart) {
        e.preventDefault();
        text.blur();
        insertTodoBefore(todo.id);
      } else if (atEnd) {
        e.preventDefault();
        text.blur();
        insertTodoAfter(todo.id);
      } else {
        // Middle: split into two todos
        e.preventDefault();
        const textBefore = content.substring(0, cursorPos);
        const textAfter = content.substring(cursorPos);
        text.blur();
        splitTodoAt(todo.id, textBefore, textAfter);
      }
      return;
    }

    // Cmd+Up: jump to first item
    if (e.key === 'ArrowUp' && e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      text.blur();
      const firstText = items[0]?.querySelector('.text');
      if (firstText) {
        firstText.focus();
        setCursorPosition(firstText, 0);
      }
      return;
    }

    // Cmd+Down: jump to last item
    if (e.key === 'ArrowDown' && e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      text.blur();
      const lastText = items[items.length - 1]?.querySelector('.text');
      if (lastText) {
        lastText.focus();
        setCursorPosition(lastText, lastText.textContent.length);
      }
      return;
    }

    // Right arrow at end: move to next item at beginning
    if (e.key === 'ArrowRight' && currentIndex < items.length - 1) {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      const atEnd = range.collapsed &&
        ((range.startContainer === text.lastChild && range.startOffset === text.lastChild.length) ||
         (range.startContainer === text && range.startOffset === text.childNodes.length) ||
         (!text.firstChild && range.startOffset === 0));
      if (atEnd) {
        e.preventDefault();
        text.blur();
        const nextText = items[currentIndex + 1].querySelector('.text');
        if (nextText) {
          nextText.focus();
          setCursorPosition(nextText, 0);
        }
        return;
      }
    }

    // Left arrow at start: move to previous item at end
    if (e.key === 'ArrowLeft' && currentIndex > 0) {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      const atStart = range.collapsed && range.startOffset === 0 &&
        (range.startContainer === text.firstChild || range.startContainer === text || !text.firstChild);
      if (atStart) {
        e.preventDefault();
        text.blur();
        const prevText = items[currentIndex - 1].querySelector('.text');
        if (prevText) {
          prevText.focus();
          setCursorPosition(prevText, prevText.textContent.length);
        }
        return;
      }
    }

    // Up arrow: move to previous item, or start of line if at first
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) {
        const cursorPos = window.getSelection().getRangeAt(0).startOffset;
        text.blur();
        const prevText = items[currentIndex - 1].querySelector('.text');
        if (prevText) {
          prevText.focus();
          setCursorPosition(prevText, cursorPos);
        }
      } else {
        setCursorPosition(text, 0);
      }
      return;
    }

    // Down arrow: move to next item, or end of line if at last
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentIndex < items.length - 1) {
        const cursorPos = window.getSelection().getRangeAt(0).startOffset;
        text.blur();
        const nextText = items[currentIndex + 1].querySelector('.text');
        if (nextText) {
          nextText.focus();
          setCursorPosition(nextText, cursorPos);
        }
      } else {
        setCursorPosition(text, text.textContent.length);
      }
    }
  };

  div.appendChild(dragHandle);
  div.appendChild(checkbox);
  div.appendChild(text);
  div.appendChild(date);
  div.appendChild(actions);

  return div;
}

function createSectionElement(section) {
  const div = document.createElement('div');
  div.className = `section-header level-${section.level || 2}`;
  div.dataset.id = section.id;

  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = '⋮⋮';

  if (viewMode === 'done') {
    dragHandle.style.display = 'none';
  }

  dragHandle.onmousedown = (e) => {
    e.preventDefault();
    const rect = div.getBoundingClientRect();

    // Get all items in this section's group
    const todos = loadTodos();
    const sectionIndex = todos.findIndex(t => t.id === section.id);
    const groupIndices = getItemGroup(todos, sectionIndex);
    const groupIds = groupIndices.map(i => todos[i].id);

    // Get all elements in the group
    const groupElements = [];
    groupIds.forEach(id => {
      const el = document.querySelector(`[data-id="${id}"]`);
      if (el) groupElements.push(el);
    });

    // Calculate total height of the group
    const totalHeight = groupElements.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);

    // Create a placeholder container that maintains the full height
    const placeholderContainer = document.createElement('div');
    placeholderContainer.className = 'section-placeholder-container';
    placeholderContainer.style.height = totalHeight + 'px';

    // Insert placeholder container before the first element
    const todoList = document.getElementById('todoList');
    todoList.insertBefore(placeholderContainer, groupElements[0]);

    // Create the drag clone container
    const cloneContainer = document.createElement('div');
    cloneContainer.className = 'drag-clone-container';
    cloneContainer.style.position = 'fixed';
    cloneContainer.style.left = rect.left + 'px';
    cloneContainer.style.top = rect.top + 'px';
    cloneContainer.style.zIndex = '1000';
    cloneContainer.style.pointerEvents = 'none';
    cloneContainer.style.background = 'white';

    // Move all group elements into the clone container (they become the visual drag)
    groupElements.forEach(el => {
      const clone = el.cloneNode(true);
      clone.style.opacity = '0.95';
      cloneContainer.appendChild(clone);
      el.style.display = 'none'; // Hide originals
    });

    document.body.appendChild(cloneContainer);

    dragState = {
      id: section.id,
      placeholder: placeholderContainer,
      originalElements: groupElements,
      clone: cloneContainer,
      fixedX: rect.left,
      offsetY: e.clientY - rect.top,
      isSection: true
    };
  };

  const text = document.createElement('div');
  text.className = 'text';
  text.contentEditable = true;
  text.textContent = section.text;

  const actions = document.createElement('div');
  actions.className = 'actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Delete section';
  deleteBtn.onclick = (e) => { e.stopPropagation(); deleteTodo(section.id); };
  actions.appendChild(deleteBtn);

  text.onblur = () => {
    updateTodoText(section.id, text.textContent);
  };

  // Save while typing (debounced)
  text.oninput = () => {
    debouncedSave(section.id, text.textContent);
  };

  // Paste as plain text only
  text.onpaste = (e) => {
    e.preventDefault();
    const plainText = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, plainText);
  };

  text.onkeydown = (e) => {
    // Tab: demote to level 2
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      updateTodoText(section.id, text.textContent); // Save text before level change
      setSectionLevel(section.id, 2);
      return;
    }

    // Shift-Tab: promote to level 1
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      updateTodoText(section.id, text.textContent); // Save text before level change
      setSectionLevel(section.id, 1);
      return;
    }

    // Cmd+Shift+Up: move item up (check before plain arrow)
    if (e.key === 'ArrowUp' && e.metaKey && e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      updateTodoText(section.id, text.textContent); // Save text before moving
      moveItemUp(section.id);
      return;
    }

    // Cmd+Shift+Down: move item down (check before plain arrow)
    if (e.key === 'ArrowDown' && e.metaKey && e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      updateTodoText(section.id, text.textContent); // Save text before moving
      moveItemDown(section.id);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      text.blur();
      insertTodoAfter(section.id);
    }

    const todoList = document.getElementById('todoList');
    const items = Array.from(todoList.querySelectorAll('.todo-item, .section-header'));
    const currentIndex = items.indexOf(div);

    // Cmd+Up: jump to first item
    if (e.key === 'ArrowUp' && e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      text.blur();
      const firstText = items[0]?.querySelector('.text');
      if (firstText) {
        firstText.focus();
        setCursorPosition(firstText, 0);
      }
      return;
    }

    // Cmd+Down: jump to last item
    if (e.key === 'ArrowDown' && e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      text.blur();
      const lastText = items[items.length - 1]?.querySelector('.text');
      if (lastText) {
        lastText.focus();
        setCursorPosition(lastText, lastText.textContent.length);
      }
      return;
    }

    // Right arrow at end: move to next item at beginning
    if (e.key === 'ArrowRight' && currentIndex < items.length - 1) {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      const atEnd = range.collapsed &&
        ((range.startContainer === text.lastChild && range.startOffset === text.lastChild.length) ||
         (range.startContainer === text && range.startOffset === text.childNodes.length) ||
         (!text.firstChild && range.startOffset === 0));
      if (atEnd) {
        e.preventDefault();
        text.blur();
        const nextText = items[currentIndex + 1].querySelector('.text');
        if (nextText) {
          nextText.focus();
          setCursorPosition(nextText, 0);
        }
        return;
      }
    }

    // Left arrow at start: move to previous item at end
    if (e.key === 'ArrowLeft' && currentIndex > 0) {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      const atStart = range.collapsed && range.startOffset === 0 &&
        (range.startContainer === text.firstChild || range.startContainer === text || !text.firstChild);
      if (atStart) {
        e.preventDefault();
        text.blur();
        const prevText = items[currentIndex - 1].querySelector('.text');
        if (prevText) {
          prevText.focus();
          setCursorPosition(prevText, prevText.textContent.length);
        }
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentIndex < items.length - 1) {
        const cursorPos = window.getSelection().getRangeAt(0).startOffset;
        text.blur();
        const nextText = items[currentIndex + 1].querySelector('.text');
        if (nextText) {
          nextText.focus();
          setCursorPosition(nextText, cursorPos);
        }
      } else {
        setCursorPosition(text, text.textContent.length);
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) {
        const cursorPos = window.getSelection().getRangeAt(0).startOffset;
        text.blur();
        const prevText = items[currentIndex - 1].querySelector('.text');
        if (prevText) {
          prevText.focus();
          setCursorPosition(prevText, cursorPos);
        }
      } else {
        setCursorPosition(text, 0);
      }
    }
  };

  // Click to focus text at end
  div.onclick = (e) => {
    if (e.target === text || e.target.closest('.actions')) return;
    text.focus();
    // Move cursor to end
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  div.appendChild(dragHandle);
  div.appendChild(text);
  div.appendChild(actions);

  return div;
}

function reorderTodo(draggedId, targetId) {
  const todos = loadTodos();
  const draggedIndex = todos.findIndex(t => t.id === draggedId);
  const targetIndex = todos.findIndex(t => t.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  const [dragged] = todos.splice(draggedIndex, 1);
  const newTargetIndex = todos.findIndex(t => t.id === targetId);

  // Generate new position between neighbors
  const before = newTargetIndex > 0 ? getItemPosition(todos, newTargetIndex - 1) : null;
  const after = getItemPosition(todos, newTargetIndex);
  dragged.position = generatePositionBetween(before, after);
  dragged.positionUpdatedAt = getVirtualNow();

  todos.splice(newTargetIndex, 0, dragged);

  saveTodos(todos);
  render();
}

function render() {
  let todos = loadTodos();
  todos = archiveOldItems(todos);

  const todoList = document.getElementById('todoList');
  todoList.innerHTML = '';
  todoList.classList.remove('done-view');

  // Hide/show elements based on view mode
  const newItemEl = document.querySelector('.new-item');
  const archiveSection = document.getElementById('archiveSection');
  const archiveList = document.getElementById('archiveList');
  const archiveCompletedContainer = document.getElementById('archiveCompletedContainer');

  if (viewMode === 'done') {
    // Done view: show all completed items grouped by day
    todoList.classList.add('done-view');

    const completedItems = todos
      .filter(t => t.completed && t.completedAt)
      .sort((a, b) => b.completedAt - a.completedAt); // Reverse chronological

    // Group by day
    const dayGroups = new Map();
    completedItems.forEach(item => {
      const dayKey = getDayKey(item.completedAt);
      if (!dayGroups.has(dayKey)) {
        dayGroups.set(dayKey, { timestamp: item.completedAt, items: [] });
      }
      dayGroups.get(dayKey).items.push(item);
    });

    // Render with day headers
    dayGroups.forEach((group, dayKey) => {
      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = formatDayHeader(group.timestamp);
      todoList.appendChild(header);

      group.items.forEach(item => {
        todoList.appendChild(createTodoElement(item));
      });
    });

    // Hide other UI elements in Done view
    if (newItemEl) newItemEl.style.display = 'none';
    archiveSection.style.display = 'none';
    if (archiveCompletedContainer) archiveCompletedContainer.style.display = 'none';
  } else {
    // Custom or Auto view
    // Filter out completed+archived items (they only show in Done view)
    const active = todos.filter(t => !t.archived && !(t.completed && t.archived));
    const fadedAway = todos.filter(t => t.archived && !t.completed);

    // Enable/disable archive button based on whether there are completed items
    const hasCompletedItems = todos.some(t => t.completed && !t.archived);
    if (archiveCompletedContainer) {
      archiveCompletedContainer.style.display = 'block';
      const archiveBtn = document.getElementById('archiveCompletedBtn');
      if (archiveBtn) {
        archiveBtn.disabled = !hasCompletedItems;
        archiveBtn.style.opacity = hasCompletedItems ? '1' : '0.4';
        archiveBtn.style.cursor = hasCompletedItems ? 'pointer' : 'default';
      }
    }

    active.forEach(item => {
      if (item.type === 'section') {
        todoList.appendChild(createSectionElement(item));
      } else {
        todoList.appendChild(createTodoElement(item));
      }
    });

    // Only show new-item input if list is empty
    if (newItemEl) {
      newItemEl.style.display = active.length === 0 ? 'flex' : 'none';
    }

    // Show faded away section (auto-archived due to age, not manually archived completed items)
    if (fadedAway.length > 0) {
      archiveSection.style.display = 'block';
      archiveList.innerHTML = '';
      fadedAway.sort((a, b) => b.archivedAt - a.archivedAt);
      fadedAway.forEach(todo => archiveList.appendChild(createTodoElement(todo)));
    } else {
      archiveSection.style.display = 'none';
      archiveList.classList.remove('expanded');
    }
  }
}

function addTodo(text) {
  if (!text.trim()) return;
  const todos = loadTodos();
  // Add to end (where the input is)
  const newTodo = createNewItem(text, todos.length, todos);
  todos.push(newTodo);
  saveTodos(todos);
  render();
}

// Get the group of items that belong under a section
// Level-1 section owns everything until next level-1 section
// Level-2 section owns everything until next section (any level)
// Regular items just own themselves
function getItemGroup(todos, startIndex) {
  const item = todos[startIndex];
  if (!item) return [];

  // Regular items (not sections) just return themselves
  if (item.type !== 'section') {
    return [startIndex];
  }

  const indices = [startIndex];
  const level = item.level || 2;

  for (let i = startIndex + 1; i < todos.length; i++) {
    const next = todos[i];
    if (next.archived) continue;

    // Stop at next section of same or higher level
    if (next.type === 'section') {
      const nextLevel = next.level || 2;
      if (level === 1 && nextLevel === 1) break;
      if (level === 2) break; // Level 2 stops at any section
    }

    indices.push(i);
  }

  return indices;
}

function setSectionLevel(id, level) {
  const todos = loadTodos();
  const section = todos.find(t => t.id === id);
  if (section && section.type === 'section') {
    section.level = level;
    saveTodos(todos);
    render();
    setTimeout(() => {
      const el = document.querySelector(`[data-id="${id}"] .text`);
      if (el) el.focus();
    }, 0);
  }
}

function setTodoIndent(id, indented) {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === id);
  if (todo && todo.type !== 'section') {
    todo.indented = indented;
    saveTodos(todos);
    render();
    setTimeout(() => {
      const el = document.querySelector(`[data-id="${id}"] .text`);
      if (el) el.focus();
    }, 0);
  }
}

function convertToSection(id) {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  todo.type = 'section';
  todo.level = 2; // Default to level 2
  todo.text = '';
  delete todo.completed;
  delete todo.important;
  delete todo.indented;
  saveTodos(todos);
  render();

  // Focus the section
  setTimeout(() => {
    const el = document.querySelector(`[data-id="${id}"] .text`);
    if (el) el.focus();
  }, 0);
}

function insertTodoAfter(afterId) {
  const todos = loadTodos();
  const index = todos.findIndex(t => t.id === afterId);
  if (index === -1) return;

  const newTodo = createNewItem('', index + 1, todos);
  todos.splice(index + 1, 0, newTodo);
  saveTodos(todos);
  render();

  // Focus the new item
  setTimeout(() => {
    const el = document.querySelector(`[data-id="${newTodo.id}"] .text`);
    if (el) el.focus();
  }, 0);
}

function insertTodoBefore(beforeId) {
  const todos = loadTodos();
  const index = todos.findIndex(t => t.id === beforeId);
  if (index === -1) return;

  const newTodo = createNewItem('', index, todos);
  todos.splice(index, 0, newTodo);
  saveTodos(todos);
  render();

  // Keep focus on the original item (at start)
  setTimeout(() => {
    const el = document.querySelector(`[data-id="${beforeId}"] .text`);
    if (el) {
      el.focus();
      setCursorPosition(el, 0);
    }
  }, 0);
}

function splitTodoAt(id, textBefore, textAfter) {
  const todos = loadTodos();
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) return;

  const originalTodo = todos[index];

  // Update original todo with text before cursor
  originalTodo.text = textBefore.trim();
  originalTodo.textUpdatedAt = getVirtualNow();

  // Create new todo with text after cursor
  const newTodo = createNewItem(textAfter, index + 1, todos);
  todos.splice(index + 1, 0, newTodo);
  saveTodos(todos);
  render();

  // Focus the new item at the start
  setTimeout(() => {
    const el = document.querySelector(`[data-id="${newTodo.id}"] .text`);
    if (el) {
      el.focus();
      setCursorPosition(el, 0);
    }
  }, 0);
}

function mergeWithPrevious(currentId, prevId) {
  const todos = loadTodos();
  const currentIndex = todos.findIndex(t => t.id === currentId);
  const prevIndex = todos.findIndex(t => t.id === prevId);
  if (currentIndex === -1 || prevIndex === -1) return;

  const currentTodo = todos[currentIndex];
  const prevTodo = todos[prevIndex];

  // Remember where to place cursor (at end of previous text)
  const cursorPos = prevTodo.text.length;

  // Merge text: previous + current
  prevTodo.text = prevTodo.text + currentTodo.text;

  // Remove current todo
  todos.splice(currentIndex, 1);
  saveTodos(todos);
  render();

  // Focus the merged item at the join point
  setTimeout(() => {
    const el = document.querySelector(`[data-id="${prevId}"] .text`);
    if (el) {
      el.focus();
      setCursorPosition(el, cursorPos);
    }
  }, 0);
}

function moveItemUp(id) {
  const todos = loadTodos();
  const active = todos.filter(t => !t.archived);
  const activeIndex = active.findIndex(t => t.id === id);
  if (activeIndex <= 0) return;

  const actualIndex = todos.findIndex(t => t.id === id);
  const currentItem = todos[actualIndex];
  const groupIndices = getItemGroup(todos, actualIndex);

  // Find where to insert
  let insertAt;
  if (currentItem.type === 'section') {
    // For sections, find the previous section and insert before its group
    let prevSectionIndex = -1;
    for (let i = actualIndex - 1; i >= 0; i--) {
      if (todos[i].type === 'section' && !todos[i].archived) {
        prevSectionIndex = i;
        break;
      }
    }
    if (prevSectionIndex === -1) {
      // No previous section, insert at the start
      insertAt = 0;
    } else {
      const prevGroupIndices = getItemGroup(todos, prevSectionIndex);
      insertAt = prevGroupIndices[0];
    }
  } else {
    // For regular items, insert before the previous item's group
    const prevActiveId = active[activeIndex - 1].id;
    const prevActualIndex = todos.findIndex(t => t.id === prevActiveId);
    const prevGroupIndices = getItemGroup(todos, prevActualIndex);
    insertAt = prevGroupIndices[0];
  }

  // Extract the group
  const group = groupIndices.map(i => todos[i]);
  // Remove from end to preserve indices
  for (let i = groupIndices.length - 1; i >= 0; i--) {
    todos.splice(groupIndices[i], 1);
  }

  // Generate new positions for the group
  const now = getVirtualNow();
  const before = insertAt > 0 ? getItemPosition(todos, insertAt - 1) : null;
  const after = insertAt < todos.length ? getItemPosition(todos, insertAt) : null;
  // Each item in group gets a position between before and after
  let lastPos = before;
  group.forEach((item, i) => {
    const nextPos = i === group.length - 1 ? after : null;
    item.position = generatePositionBetween(lastPos, nextPos || after);
    item.positionUpdatedAt = now;
    lastPos = item.position;
  });

  // Insert at new position
  todos.splice(insertAt, 0, ...group);

  saveTodos(todos);
  render();

  setTimeout(() => {
    const el = document.querySelector(`[data-id="${id}"] .text`);
    if (el) el.focus();
  }, 0);
}

function moveItemDown(id) {
  const todos = loadTodos();
  const active = todos.filter(t => !t.archived);
  const activeIndex = active.findIndex(t => t.id === id);
  if (activeIndex === -1 || activeIndex >= active.length - 1) return;

  const actualIndex = todos.findIndex(t => t.id === id);
  const currentItem = todos[actualIndex];
  const groupIndices = getItemGroup(todos, actualIndex);
  const groupSize = groupIndices.length;

  // Find where to insert
  let insertAt;
  if (currentItem.type === 'section') {
    // For sections, find the next section and insert after its group
    let nextSectionIndex = -1;
    for (let i = groupIndices[groupIndices.length - 1] + 1; i < todos.length; i++) {
      if (todos[i].type === 'section' && !todos[i].archived) {
        nextSectionIndex = i;
        break;
      }
    }
    if (nextSectionIndex === -1) {
      // No next section, insert at the end
      insertAt = todos.length;
    } else {
      const nextGroupIndices = getItemGroup(todos, nextSectionIndex);
      insertAt = nextGroupIndices[nextGroupIndices.length - 1] + 1;
    }
  } else {
    // For regular items, find the next item not in our group and insert after it
    let nextIndex = activeIndex + 1;
    while (nextIndex < active.length && groupIndices.includes(todos.findIndex(t => t.id === active[nextIndex].id))) {
      nextIndex++;
    }
    if (nextIndex >= active.length) return;

    const nextActiveId = active[nextIndex].id;
    const nextActualIndex = todos.findIndex(t => t.id === nextActiveId);
    insertAt = nextActualIndex + 1;
  }

  // Extract the group
  const group = groupIndices.map(i => todos[i]);
  // Remove from end to preserve indices
  for (let i = groupIndices.length - 1; i >= 0; i--) {
    todos.splice(groupIndices[i], 1);
  }
  // Insert at new position (adjusted for removed items)
  const adjustedInsert = insertAt - groupSize;

  // Generate new positions for the group
  const now = getVirtualNow();
  const before = adjustedInsert > 0 ? getItemPosition(todos, adjustedInsert - 1) : null;
  const after = adjustedInsert < todos.length ? getItemPosition(todos, adjustedInsert) : null;
  // Each item in group gets a position between before and after
  let lastPos = before;
  group.forEach((item, i) => {
    const nextPos = i === group.length - 1 ? after : null;
    item.position = generatePositionBetween(lastPos, nextPos || after);
    item.positionUpdatedAt = now;
    lastPos = item.position;
  });

  todos.splice(adjustedInsert, 0, ...group);

  saveTodos(todos);
  render();

  setTimeout(() => {
    const el = document.querySelector(`[data-id="${id}"] .text`);
    if (el) el.focus();
  }, 0);
}

function updateTodoText(id, newText) {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.text = newText.trim();
    todo.textUpdatedAt = getVirtualNow();
    saveTodos(todos);
  }
  // Cancel any pending debounce — this save supersedes it
  if (saveTimers.has(id)) {
    clearTimeout(saveTimers.get(id));
    saveTimers.delete(id);
  }
}

function toggleImportant(id) {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.important = !todo.important;
    todo.importantUpdatedAt = getVirtualNow(); // CRDT: track important update time
    // If rescuing from archive, unarchive but keep original date
    if (todo.archived && todo.important) {
      todo.archived = false;
      todo.archivedAt = null;
    }
    saveTodos(todos);
    render();
  }
}

// Match arrow patterns: ->, -->, --->, or Unicode arrows like →, ➔, ⟶, etc.
const ARROW_PATTERN = /-+>|[→➔➜➝➞⟶⇒⇨]/;

function splitOnArrow(text) {
  const match = text.match(ARROW_PATTERN);
  if (!match) return null;

  const arrowIndex = match.index;
  const arrowLength = match[0].length;
  const before = text.substring(0, arrowIndex).trim();
  const after = text.substring(arrowIndex + arrowLength).trim();

  if (!before || !after) return null;
  return { before, after };
}

function toggleComplete(id) {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  const now = getVirtualNow();
  const wasCompleted = todo.completed;
  todo.completed = !todo.completed;
  todo.completedUpdatedAt = now; // CRDT: track completed update time

  if (todo.completed) {
    todo.completedAt = now;

    // Check for sequence item (contains arrow)
    const split = splitOnArrow(todo.text);
    if (split) {
      // Update current item to just the first part
      todo.text = split.before;
      todo.textUpdatedAt = now;

      // Create new item with the rest
      const todoIndex = todos.indexOf(todo);
      const newTodo = createNewItem(split.after, todoIndex + 1, todos);
      newTodo.indented = todo.indented;
      todos.splice(todoIndex + 1, 0, newTodo);
    }
  } else {
    delete todo.completedAt;
  }

  saveTodos(todos);
  render();
}

function deleteTodo(id) {
  let todos = loadTodos();
  todos = todos.filter(t => t.id !== id);
  saveTodos(todos);
  render();
}

function restoreTodo(id) {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.archived = false;
    todo.archivedAt = null;
    todo.createdAt = getVirtualNow();
    saveTodos(todos);
    render();
  }
}

function archiveCompleted() {
  const todos = loadTodos();
  let changed = false;
  todos.forEach(todo => {
    if (todo.completed && !todo.archived) {
      todo.archived = true;
      todo.archivedAt = getVirtualNow();
      changed = true;
    }
  });
  if (changed) {
    saveTodos(todos);
    render();
  }
}

// New item input
const newItemInput = document.getElementById('newItemInput');
newItemInput.onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const text = newItemInput.textContent;
    if (text.trim()) {
      addTodo(text);
      newItemInput.textContent = '';
    }
  }
};

// Archive toggle
document.getElementById('archiveToggle').onclick = () => {
  const archiveList = document.getElementById('archiveList');
  const toggle = document.getElementById('archiveToggle');
  archiveList.classList.toggle('expanded');
  toggle.textContent = archiveList.classList.contains('expanded')
    ? 'Faded away ▾'
    : 'Faded away ▸';
};

// Test mode controls
function saveTimeOffset() {
  localStorage.setItem('decay-todos-time-offset', timeOffsetDays.toString());
  document.getElementById('timeDisplay').textContent = `Day ${timeOffsetDays}`;
}

document.getElementById('advanceDay').onclick = () => {
  timeOffsetDays++;
  saveTimeOffset();
  render();
};

document.getElementById('resetTime').onclick = () => {
  timeOffsetDays = 0;
  saveTimeOffset();
  render();
};

// Initialize test mode UI
if (isTestMode) {
  document.getElementById('testMode').style.display = 'block';
  document.getElementById('timeDisplay').textContent = `Day ${timeOffsetDays}`;
}

// View toggle
function updateViewToggle() {
  const activeBtn = document.getElementById('activeViewBtn');
  const doneBtn = document.getElementById('doneViewBtn');

  activeBtn.classList.toggle('active', viewMode === 'active');
  doneBtn.classList.toggle('active', viewMode === 'done');
}

document.getElementById('activeViewBtn').onclick = () => {
  viewMode = 'active';
  localStorage.setItem('decay-todos-view-mode', viewMode);
  updateViewToggle();
  render();
};

document.getElementById('doneViewBtn').onclick = () => {
  viewMode = 'done';
  localStorage.setItem('decay-todos-view-mode', viewMode);
  updateViewToggle();
  render();
};

// Archive completed button
document.getElementById('archiveCompletedBtn').onclick = () => {
  archiveCompleted();
};

// Global drag handlers
document.addEventListener('mousemove', (e) => {
  if (!dragState) return;

  // Move clone vertically only
  dragState.clone.style.left = dragState.fixedX + 'px';
  dragState.clone.style.top = (e.clientY - dragState.offsetY) + 'px';

  // Find where to move placeholder
  const todoList = document.getElementById('todoList');
  const isDraggingSection = !!dragState.isSection;

  // Get visible items (excluding hidden originals and placeholder container)
  const items = Array.from(todoList.querySelectorAll('.todo-item, .section-header'))
    .filter(item => item.style.display !== 'none');

  let targetItem = null;
  for (const item of items) {
    // Skip the placeholder itself
    if (item === dragState.placeholder) continue;

    const rect = item.getBoundingClientRect();
    let midY;

    // For section headers when dragging a section, use the full section group height
    if (isDraggingSection && item.classList.contains('section-header')) {
      // Calculate full section height (header + children)
      const itemId = item.dataset.id;
      const todos = loadTodos();
      const sectionIndex = todos.findIndex(t => t.id === itemId);
      if (sectionIndex !== -1) {
        const groupIndices = getItemGroup(todos, sectionIndex);
        let totalHeight = 0;
        for (const idx of groupIndices) {
          const groupItem = todoList.querySelector(`[data-id="${todos[idx].id}"]`);
          if (groupItem && groupItem.style.display !== 'none') {
            totalHeight += groupItem.getBoundingClientRect().height;
          }
        }
        midY = rect.top + totalHeight / 2;
      } else {
        midY = rect.top + rect.height / 2;
      }
    } else {
      midY = rect.top + rect.height / 2;
    }

    if (e.clientY < midY) {
      // When dragging a section, only allow dropping before other sections
      if (isDraggingSection && !item.classList.contains('section-header')) {
        continue;
      }
      targetItem = item;
      break;
    }
  }

  // Move placeholder to new position
  if (targetItem && targetItem !== dragState.placeholder.nextElementSibling) {
    todoList.insertBefore(dragState.placeholder, targetItem);
  } else if (!targetItem && dragState.placeholder.nextElementSibling) {
    // Only move to end if it's not already at the end
    todoList.appendChild(dragState.placeholder);
  }
});

document.addEventListener('mouseup', () => {
  if (!dragState) return;

  // Remove clone
  dragState.clone.remove();

  // Get the dragged item's group
  const todos = loadTodos();
  const draggedIndex = todos.findIndex(t => t.id === dragState.id);
  const groupIndices = getItemGroup(todos, draggedIndex);
  const group = groupIndices.map(i => todos[i]);
  const isDraggingSection = !!dragState.isSection;

  // Get target position from placeholder location in DOM
  const todoList = document.getElementById('todoList');

  // For sections, find position relative to other section headers
  // For items, find position relative to all visible items
  const visibleItems = Array.from(todoList.querySelectorAll('.todo-item, .section-header'))
    .filter(item => item.style.display !== 'none');

  // Find where placeholder is in the DOM
  const allChildren = Array.from(todoList.children);
  const placeholderDomIndex = allChildren.indexOf(dragState.placeholder);

  // Remove group from todos (from end to preserve indices)
  for (let i = groupIndices.length - 1; i >= 0; i--) {
    todos.splice(groupIndices[i], 1);
  }

  // Calculate insert position based on visible items before placeholder
  const draggedIds = group.map(t => t.id);
  const itemsBeforePlaceholder = allChildren.slice(0, placeholderDomIndex)
    .filter(el => el.dataset && el.dataset.id && !draggedIds.includes(el.dataset.id))
    .map(el => el.dataset.id);

  let insertAt = 0;
  if (itemsBeforePlaceholder.length > 0) {
    const lastBeforeId = itemsBeforePlaceholder[itemsBeforePlaceholder.length - 1];
    const lastBeforeIndex = todos.findIndex(t => t.id === lastBeforeId);

    if (isDraggingSection) {
      // For sections, insert after the previous section's entire group
      const lastBeforeItem = todos[lastBeforeIndex];
      if (lastBeforeItem && lastBeforeItem.type === 'section') {
        const prevGroupIndices = getItemGroup(todos, lastBeforeIndex);
        insertAt = prevGroupIndices[prevGroupIndices.length - 1] + 1;
      } else if (lastBeforeItem) {
        // Last item before is a todo - insert after it
        insertAt = lastBeforeIndex + 1;
      }
    } else {
      // For regular items, insert right after the item before placeholder
      insertAt = lastBeforeIndex + 1;
    }
  }

  // Generate new positions for the group (CRDT-friendly ordering)
  const now = getVirtualNow();
  const before = insertAt > 0 ? getItemPosition(todos, insertAt - 1) : null;
  const after = insertAt < todos.length ? getItemPosition(todos, insertAt) : null;
  let lastPos = before;
  group.forEach((item, i) => {
    const nextPos = i === group.length - 1 ? after : null;
    item.position = generatePositionBetween(lastPos, nextPos || after);
    item.positionUpdatedAt = now;
    lastPos = item.position;
  });

  // Insert group at new position
  todos.splice(insertAt, 0, ...group);

  const archived = todos.filter(t => t.archived);
  const active = todos.filter(t => !t.archived);
  saveTodos([...active, ...archived]);

  // Clean up
  if (dragState.isSection) {
    // Remove placeholder container and restore original elements
    dragState.placeholder.remove();
    dragState.originalElements.forEach(el => el.style.display = '');
  } else {
    dragState.placeholder.classList.remove('placeholder');
  }
  dragState = null;
  render();
});

updateViewToggle();
render();
setInterval(() => {
  // Don't re-render if user is actively editing
  const activeEl = document.activeElement;
  const isEditing = activeEl && activeEl.classList.contains('text');
  if (!isEditing) {
    render();
  }
}, UPDATE_INTERVAL);
