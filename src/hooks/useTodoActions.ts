import { useCallback, useRef } from 'react';
import { loadTodos, notifyStateChange } from '../store';
import {
  generateId, generatePositionBetween, getSiblings, splitOnArrow,
  buildConvertToSectionEvents, syncHierarchyFromLinearOrder,
} from '../utils';
import { sanitizeHTML, textLengthOfHTML } from '../lib/sanitize';
import type { TodoItem, ViewMode } from '../types';
import type { PendingFocus } from './useFocusManager';

const SAVE_DEBOUNCE_MS = 300;

// Calculate position after a sibling item within the same parent
function positionAfterSibling(todos: TodoItem[], siblingId: string): { parentId: string | null; position: string } {
  const sibling = todos.find(t => t.id === siblingId);
  if (!sibling) return { parentId: null, position: 'n' };

  const parentId = sibling.parentId || null;
  const siblings = getSiblings(todos, parentId);
  const idx = siblings.findIndex(t => t.id === siblingId);
  const after = idx < siblings.length - 1 ? siblings[idx + 1].position : null;
  return { parentId, position: generatePositionBetween(sibling.position, after) };
}

// Calculate position before a sibling item within the same parent
function positionBeforeSibling(todos: TodoItem[], siblingId: string): { parentId: string | null; position: string } {
  const sibling = todos.find(t => t.id === siblingId);
  if (!sibling) return { parentId: null, position: 'n' };

  const parentId = sibling.parentId || null;
  const siblings = getSiblings(todos, parentId);
  const idx = siblings.findIndex(t => t.id === siblingId);
  const before = idx > 0 ? siblings[idx - 1].position : null;
  return { parentId, position: generatePositionBetween(before, sibling.position) };
}

function syncAndEmit() {
  const changes = syncHierarchyFromLinearOrder(loadTodos());
  if (changes.length > 0) {
    window.EventLog.emitFieldsChanged(changes);
  }
}

export function useTodoActions(pendingFocusRef: React.RefObject<PendingFocus | null>, viewMode: ViewMode = 'active') {
  const saveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const debouncedSave = useCallback((id: string, text: string) => {
    const timers = saveTimersRef.current;
    if (timers.has(id)) {
      clearTimeout(timers.get(id));
    }
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(text).trim());
    }, SAVE_DEBOUNCE_MS));
  }, []);

  const updateTodoText = useCallback((id: string, newText: string) => {
    window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(newText).trim());
    const timers = saveTimersRef.current;
    if (timers.has(id)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  }, []);

  const addTodo = useCallback((text: string): string => {
    if (!text.trim()) return '';
    const todos = loadTodos();

    // Add at end of root-level siblings
    const rootSiblings = getSiblings(todos, null);
    const lastPos = rootSiblings.length > 0 ? rootSiblings[rootSiblings.length - 1].position : null;
    const position = generatePositionBetween(lastPos, null);

    const newId = generateId();
    const value: Record<string, unknown> = {
      text: sanitizeHTML(text).trim(), position, parentId: null,
    };
    if (viewMode === 'important') {
      value.important = true;
    }
    window.EventLog.emitItemCreated(newId, value);
    pendingFocusRef.current = { itemId: newId, atEnd: true };
    notifyStateChange();
    return newId;
  }, [pendingFocusRef, viewMode]);

  const deleteTodo = useCallback((id: string) => {
    window.EventLog.emitItemDeleted(id);
    syncAndEmit();
    notifyStateChange();
  }, []);

  const toggleComplete = useCallback((id: string) => {
    const todos = loadTodos();
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    const newCompleted = !todo.completed;
    const batch: Array<{ type: string; itemId: string; field?: string; value?: unknown }> = [
      { type: 'field_changed', itemId: id, field: 'completed', value: newCompleted },
    ];

    if (newCompleted) {
      // Extract plain text for arrow detection (links are lost on arrow-split)
      const plainDiv = document.createElement('div');
      plainDiv.innerHTML = todo.text;
      const split = splitOnArrow(plainDiv.textContent || '');
      if (split) {
        batch.push({ type: 'field_changed', itemId: id, field: 'text', value: split.before });

        // New item is a sibling after the completed item
        const { parentId, position } = positionAfterSibling(todos, id);
        const newId = generateId();
        batch.push({
          type: 'item_created', itemId: newId, value: {
            text: split.after, position, parentId,
            indented: todo.indented || false,
          },
        });
      }
    }

    window.EventLog.emitBatch(batch);
    notifyStateChange();
  }, []);

  const toggleImportant = useCallback((id: string) => {
    const todos = loadTodos();
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    const newImportant = !todo.important;
    const events: Array<{ itemId: string; field: string; value: unknown }> = [
      { itemId: id, field: 'important', value: newImportant },
    ];
    if (todo.archived && newImportant) {
      events.push({ itemId: id, field: 'archived', value: false });
    }
    window.EventLog.emitFieldsChanged(events);
    notifyStateChange();
  }, []);

  const insertTodoAfter = useCallback((afterId: string) => {
    const todos = loadTodos();
    const afterItem = todos.find(t => t.id === afterId);
    if (!afterItem) return;

    let parentId: string | null;
    let position: string;

    if (afterItem.type === 'section') {
      // Enter on section header → new item is first child of section
      parentId = afterItem.id;
      const children = getSiblings(todos, parentId);
      const after = children.length > 0 ? children[0].position : null;
      position = generatePositionBetween(null, after);
    } else {
      // Enter at end of item → new sibling after current
      ({ parentId, position } = positionAfterSibling(todos, afterId));
    }

    const newId = generateId();
    const value: Record<string, unknown> = { text: '', position, parentId };
    if (afterItem.type !== 'section' && afterItem.indented) {
      value.indented = true;
    }
    if (viewMode === 'important') {
      value.important = true;
    }
    window.EventLog.emitItemCreated(newId, value);
    pendingFocusRef.current = { itemId: newId, cursorPos: 0 };
    notifyStateChange();
  }, [pendingFocusRef, viewMode]);

  const insertLineBefore = useCallback((beforeId: string) => {
    const todos = loadTodos();
    const beforeItem = todos.find(t => t.id === beforeId);
    if (!beforeItem) return;

    const { parentId, position } = positionBeforeSibling(todos, beforeId);
    const newId = generateId();
    const value: Record<string, unknown> = { text: '', position, parentId };

    if (beforeItem.type === 'section') {
      value.type = 'section';
      value.level = beforeItem.level || 2;
    } else {
      if (beforeItem.indented) {
        value.indented = true;
      }
      if (viewMode === 'important') {
        value.important = true;
      }
    }

    window.EventLog.emitItemCreated(newId, value);
    if (beforeItem.type === 'section') syncAndEmit();
    pendingFocusRef.current = { itemId: beforeId, cursorPos: 0 };
    notifyStateChange();
  }, [pendingFocusRef, viewMode]);

  const splitLineAt = useCallback((id: string, textBefore: string, textAfter: string) => {
    const todos = loadTodos();
    const item = todos.find(t => t.id === id);
    if (!item) return;

    const { parentId, position } = positionAfterSibling(todos, id);
    const newId = generateId();
    const newItemValue: Record<string, unknown> = { text: textAfter.trim(), position, parentId };

    if (item.type === 'section') {
      const level = item.level || 2;
      newItemValue.type = 'section';
      newItemValue.level = level;

      // Reparent original section's direct children to the new section
      const children = getSiblings(todos, id);
      const reparentEvents = children.map(child => ({
        type: 'field_changed', itemId: child.id, field: 'parentId', value: newId,
      }));

      window.EventLog.emitBatch([
        { type: 'field_changed', itemId: id, field: 'text', value: textBefore.trim() },
        { type: 'item_created', itemId: newId, value: newItemValue },
        ...reparentEvents,
      ]);
      syncAndEmit();
    } else {
      if (item.indented) {
        newItemValue.indented = true;
      }
      if (viewMode === 'important') {
        newItemValue.important = true;
      }
      window.EventLog.emitBatch([
        { type: 'field_changed', itemId: id, field: 'text', value: textBefore.trim() },
        { type: 'item_created', itemId: newId, value: newItemValue },
      ]);
    }

    pendingFocusRef.current = { itemId: newId, cursorPos: 0 };
    notifyStateChange();
  }, [pendingFocusRef, viewMode]);

  const backspaceOnLine = useCallback((id: string) => {
    const todos = loadTodos();
    const currentItem = todos.find(t => t.id === id);
    if (!currentItem) return;

    const idx = todos.findIndex(t => t.id === id);

    // No previous item — no-op
    if (idx <= 0) {
      pendingFocusRef.current = { itemId: id, cursorPos: 0 };
      notifyStateChange();
      return;
    }

    // If section, convert to regular item first
    if (currentItem.type === 'section') {
      window.EventLog.emitBatch([
        { type: 'field_changed', itemId: id, field: 'type', value: 'todo' },
        { type: 'field_changed', itemId: id, field: 'level', value: null },
      ]);
      syncAndEmit();
    }

    // Find the previous item in visual order (reload after possible syncAndEmit)
    const updatedTodos = loadTodos();
    const prevItem = updatedTodos[updatedTodos.findIndex(t => t.id === id) - 1];
    const cursorPos = textLengthOfHTML(prevItem.text);
    const mergedText = sanitizeHTML(prevItem.text + currentItem.text);
    window.EventLog.emitBatch([
      { type: 'field_changed', itemId: prevItem.id, field: 'text', value: mergedText },
      { type: 'item_deleted', itemId: id },
    ]);
    syncAndEmit();
    pendingFocusRef.current = { itemId: prevItem.id, cursorPos };
    notifyStateChange();
  }, [pendingFocusRef]);

  const convertToSection = useCallback((id: string) => {
    const todos = loadTodos();
    const batch = buildConvertToSectionEvents(todos, id);
    if (!batch) return;

    window.EventLog.emitBatch(batch);
    syncAndEmit();
    pendingFocusRef.current = { itemId: id, cursorPos: 0 };
    notifyStateChange();
  }, [pendingFocusRef]);

  const setTodoIndent = useCallback((id: string, indented: boolean) => {
    const todos = loadTodos();
    const todo = todos.find(t => t.id === id);
    if (todo && todo.type !== 'section') {
      window.EventLog.emitFieldChanged(id, 'indented', indented);
      pendingFocusRef.current = { itemId: id };
      notifyStateChange();
    }
  }, [pendingFocusRef]);

  const setSectionLevel = useCallback((id: string, level: number) => {
    window.EventLog.emitFieldChanged(id, 'level', level);
    syncAndEmit();
    pendingFocusRef.current = { itemId: id };
    notifyStateChange();
  }, [pendingFocusRef]);

  const moveItemUp = useCallback((id: string) => {
    const todos = loadTodos();
    const item = todos.find(t => t.id === id);
    if (!item) return;

    // Move among siblings (same parentId), skipping archived
    const parentId = item.parentId || null;
    const siblings = getSiblings(todos, parentId).filter(t => !t.archived);
    const idx = siblings.findIndex(t => t.id === id);
    if (idx <= 0) return;

    // Position before the previous sibling
    const prevSibling = siblings[idx - 1];
    const beforePrev = idx > 1 ? siblings[idx - 2].position : null;
    const newPosition = generatePositionBetween(beforePrev, prevSibling.position);

    window.EventLog.emitFieldChanged(id, 'position', newPosition);
    syncAndEmit();
    pendingFocusRef.current = { itemId: id };
    notifyStateChange();
  }, [pendingFocusRef]);

  const moveItemDown = useCallback((id: string) => {
    const todos = loadTodos();
    const item = todos.find(t => t.id === id);
    if (!item) return;

    // Move among siblings (same parentId), skipping archived
    const parentId = item.parentId || null;
    const siblings = getSiblings(todos, parentId).filter(t => !t.archived);
    const idx = siblings.findIndex(t => t.id === id);
    if (idx === -1 || idx >= siblings.length - 1) return;

    // Position after the next sibling
    const nextSibling = siblings[idx + 1];
    const afterNext = idx < siblings.length - 2 ? siblings[idx + 2].position : null;
    const newPosition = generatePositionBetween(nextSibling.position, afterNext);

    window.EventLog.emitFieldChanged(id, 'position', newPosition);
    syncAndEmit();
    pendingFocusRef.current = { itemId: id };
    notifyStateChange();
  }, [pendingFocusRef]);

  const archiveOldItems = useCallback(() => {
    const todos = loadTodos();
    const now = window.getVirtualNow();
    const toArchive = todos.filter(t => {
      if (t.type === 'section') return false;
      if (t.important || t.completed || t.archived) return false;
      return (now - t.createdAt) / (1000 * 60 * 60 * 24) >= 14;
    });

    if (toArchive.length > 0) {
      window.EventLog.emitFieldsChanged(toArchive.map(t => ({ itemId: t.id, field: 'archived', value: true })));
      notifyStateChange();
    }
  }, []);

  const archiveCompleted = useCallback(() => {
    const todos = loadTodos();
    const toArchive = todos.filter(t => t.completed && !t.archived);
    if (toArchive.length > 0) {
      window.EventLog.emitFieldsChanged(toArchive.map(t => ({ itemId: t.id, field: 'archived', value: true })));
      notifyStateChange();
    }
  }, []);

  const reorderTodo = useCallback((draggedId: string, targetId: string) => {
    const todos = loadTodos();
    const dragged = todos.find(t => t.id === draggedId);
    const target = todos.find(t => t.id === targetId);
    if (!dragged || !target) return;

    // Determine new parentId: same as target's parent (insert as sibling before target)
    const newParentId = target.parentId || null;
    const siblings = getSiblings(todos, newParentId).filter(t => t.id !== draggedId);
    const targetIdx = siblings.findIndex(t => t.id === targetId);

    const before = targetIdx > 0 ? siblings[targetIdx - 1].position : null;
    const after = target.position;
    const newPos = generatePositionBetween(before, after);

    const events: Array<{ itemId: string; field: string; value: unknown }> = [
      { itemId: draggedId, field: 'position', value: newPos },
    ];

    // Update parentId if moving across sections
    if ((dragged.parentId || null) !== newParentId) {
      events.push({ itemId: draggedId, field: 'parentId', value: newParentId });
    }

    window.EventLog.emitFieldsChanged(events);
    syncAndEmit();
    notifyStateChange();
  }, []);

  return {
    debouncedSave,
    updateTodoText,
    addTodo,
    deleteTodo,
    toggleComplete,
    toggleImportant,
    insertTodoAfter,
    insertLineBefore,
    splitLineAt,
    backspaceOnLine,
    convertToSection,
    setTodoIndent,
    setSectionLevel,
    moveItemUp,
    moveItemDown,
    archiveOldItems,
    archiveCompleted,
    reorderTodo,
  };
}

export type TodoActions = ReturnType<typeof useTodoActions>;
