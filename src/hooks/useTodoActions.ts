import { useCallback, useRef } from 'react';
import { loadTodos, notifyStateChange, getViewMode } from '../store';
import {
  generateId, generatePositionBetween, getSiblings, splitOnArrow,
  buildConvertToSectionEvents, syncHierarchyFromLinearOrder,
} from '../utils';
import { sanitizeHTML, textLengthOfHTML } from '../lib/sanitize';
import { pushUndo, isSaveSuppressed } from '../lib/undo-manager';
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
  const saveTimersRef = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; text: string }>());

  // withUndo: wraps an action to capture events and push to undo stack
  function withUndo(
    beforeFocus: PendingFocus | null,
    action: () => void,
    afterFocus?: PendingFocus | null,
  ): void {
    const beforeViewMode = getViewMode();
    window.EventLog.beginCapture();
    action();
    const captured = window.EventLog.endCapture();
    const afterViewMode = getViewMode();
    if (captured && captured.length > 0) {
      pushUndo({
        addedEventIds: captured.map(c => c.id),
        addedEvents: captured.map(c => c.event),
        beforeViewMode,
        beforeFocus,
        afterViewMode,
        afterFocus: afterFocus !== undefined ? afterFocus : pendingFocusRef.current,
      });
    }
  }

  const debouncedSave = useCallback((id: string, text: string) => {
    if (isSaveSuppressed()) return;
    const timers = saveTimersRef.current;
    if (timers.has(id)) {
      clearTimeout(timers.get(id)!.timer);
    }
    timers.set(id, {
      timer: setTimeout(() => {
        timers.delete(id);
        withUndo(
          { itemId: id },
          () => window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(text).trim()),
          { itemId: id },
        );
      }, SAVE_DEBOUNCE_MS),
      text,
    });
  }, []);

  const updateTodoText = useCallback((id: string, newText: string) => {
    if (isSaveSuppressed()) return;
    const sanitized = sanitizeHTML(newText).trim();
    // Skip if item doesn't exist or text hasn't changed
    const todos = loadTodos();
    const item = todos.find(t => t.id === id);
    if (!item) return;
    if (item.text === sanitized) {
      // Still cancel any pending debounce
      const timers = saveTimersRef.current;
      if (timers.has(id)) {
        clearTimeout(timers.get(id)!.timer);
        timers.delete(id);
      }
      return;
    }
    withUndo(
      { itemId: id },
      () => {
        window.EventLog.emitFieldChanged(id, 'text', sanitized);
        const timers = saveTimersRef.current;
        if (timers.has(id)) {
          clearTimeout(timers.get(id)!.timer);
          timers.delete(id);
        }
      },
      { itemId: id },
    );
  }, []);

  const flushPendingSaves = useCallback(() => {
    const timers = saveTimersRef.current;
    for (const [id, { timer, text }] of timers.entries()) {
      clearTimeout(timer);
      timers.delete(id);
      withUndo(
        { itemId: id },
        () => window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(text).trim()),
        { itemId: id },
      );
    }
  }, []);

  const addTodo = useCallback((text: string): string => {
    if (!text.trim()) return '';
    let newId = '';
    withUndo(
      null,
      () => {
        const todos = loadTodos();
        const rootSiblings = getSiblings(todos, null);
        const lastPos = rootSiblings.length > 0 ? rootSiblings[rootSiblings.length - 1].position : null;
        const position = generatePositionBetween(lastPos, null);

        newId = generateId();
        const value: Record<string, unknown> = {
          text: sanitizeHTML(text).trim(), position, parentId: null,
        };
        if (viewMode === 'important') {
          value.important = true;
        }
        window.EventLog.emitItemCreated(newId, value);
        pendingFocusRef.current = { itemId: newId, atEnd: true };
        notifyStateChange();
      },
    );
    return newId;
  }, [pendingFocusRef, viewMode]);

  const deleteTodo = useCallback((id: string) => {
    const todos = loadTodos();
    const idx = todos.findIndex(t => t.id === id);
    const prevItem = idx > 0 ? todos[idx - 1] : null;
    withUndo(
      { itemId: id },
      () => {
        const todos2 = loadTodos();
        const item = todos2.find(t => t.id === id);
        if (item && item.type === 'section') {
          const children = todos2.filter(t => (t.parentId || null) === id);
          const newParentId = item.parentId || null;
          const batch: Array<{ type: string; itemId: string; field?: string; value?: unknown }> = [];
          for (const child of children) {
            batch.push({ type: 'field_changed', itemId: child.id, field: 'parentId', value: newParentId });
          }
          batch.push({ type: 'item_deleted', itemId: id });
          window.EventLog.emitBatch(batch);
        } else {
          window.EventLog.emitItemDeleted(id);
        }
        syncAndEmit();
        notifyStateChange();
      },
      prevItem ? { itemId: prevItem.id } : null,
    );
  }, []);

  const toggleComplete = useCallback((id: string) => {
    withUndo(
      { itemId: id },
      () => {
        const todos = loadTodos();
        const todo = todos.find(t => t.id === id);
        if (!todo) return;

        const newCompleted = !todo.completed;
        const batch: Array<{ type: string; itemId: string; field?: string; value?: unknown }> = [
          { type: 'field_changed', itemId: id, field: 'completed', value: newCompleted },
        ];

        if (newCompleted) {
          const plainDiv = document.createElement('div');
          plainDiv.innerHTML = todo.text;
          const split = splitOnArrow(plainDiv.textContent || '');
          if (split) {
            batch.push({ type: 'field_changed', itemId: id, field: 'text', value: split.before });
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
      },
      { itemId: id },
    );
  }, []);

  const toggleImportant = useCallback((id: string) => {
    withUndo(
      { itemId: id },
      () => {
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
      },
      { itemId: id },
    );
  }, []);

  const insertTodoAfter = useCallback((afterId: string) => {
    withUndo(
      { itemId: afterId },
      () => {
        const todos = loadTodos();
        const afterItem = todos.find(t => t.id === afterId);
        if (!afterItem) return;

        let parentId: string | null;
        let position: string;

        if (afterItem.type === 'section') {
          parentId = afterItem.id;
          const children = getSiblings(todos, parentId);
          const after = children.length > 0 ? children[0].position : null;
          position = generatePositionBetween(null, after);
        } else {
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
      },
    );
  }, [pendingFocusRef, viewMode]);

  const insertLineBefore = useCallback((beforeId: string) => {
    withUndo(
      { itemId: beforeId, cursorPos: 0 },
      () => {
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
      },
    );
  }, [pendingFocusRef, viewMode]);

  const splitLineAt = useCallback((id: string, textBefore: string, textAfter: string) => {
    withUndo(
      { itemId: id },
      () => {
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
      },
    );
  }, [pendingFocusRef, viewMode]);

  const backspaceOnLine = useCallback((id: string, currentText?: string) => {
    const todos = loadTodos();
    const currentItem = todos.find(t => t.id === id);
    if (!currentItem) return;
    const idx = todos.findIndex(t => t.id === id);

    // For beforeFocus, we'll figure out the cursor position that will result
    const prevItem = idx > 0 ? todos[idx - 1] : null;

    withUndo(
      { itemId: id, cursorPos: 0 },
      () => {
        // If currentText provided, emit text change and cancel pending debounce
        if (currentText !== undefined) {
          window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(currentText).trim());
          const timers = saveTimersRef.current;
          if (timers.has(id)) {
            clearTimeout(timers.get(id)!.timer);
            timers.delete(id);
          }
        }

        const latestTodos = loadTodos();
        const latestItem = latestTodos.find(t => t.id === id);
        if (!latestItem) return;
        const latestIdx = latestTodos.findIndex(t => t.id === id);

        if (latestIdx <= 0) {
          pendingFocusRef.current = { itemId: id, cursorPos: 0 };
          notifyStateChange();
          return;
        }

        if (latestItem.type === 'section') {
          window.EventLog.emitBatch([
            { type: 'field_changed', itemId: id, field: 'type', value: 'todo' },
            { type: 'field_changed', itemId: id, field: 'level', value: null },
          ]);
          syncAndEmit();
        }

        const updatedTodos = loadTodos();
        const updatedPrev = updatedTodos[updatedTodos.findIndex(t => t.id === id) - 1];
        const cursorPos = textLengthOfHTML(updatedPrev.text);
        const mergedText = sanitizeHTML(updatedPrev.text + latestItem.text);
        window.EventLog.emitBatch([
          { type: 'field_changed', itemId: updatedPrev.id, field: 'text', value: mergedText },
          { type: 'item_deleted', itemId: id },
        ]);
        syncAndEmit();
        pendingFocusRef.current = { itemId: updatedPrev.id, cursorPos };
        notifyStateChange();
      },
      prevItem ? { itemId: prevItem.id, cursorPos: textLengthOfHTML(prevItem.text) } : { itemId: id, cursorPos: 0 },
    );
  }, [pendingFocusRef]);

  const convertToSection = useCallback((id: string) => {
    withUndo(
      { itemId: id },
      () => {
        const todos = loadTodos();
        const batch = buildConvertToSectionEvents(todos, id);
        if (!batch) return;

        window.EventLog.emitBatch(batch);
        syncAndEmit();
        pendingFocusRef.current = { itemId: id, cursorPos: 0 };
        notifyStateChange();
      },
      { itemId: id, cursorPos: 0 },
    );
  }, [pendingFocusRef]);

  const promoteItemToSection = useCallback((id: string, currentText?: string) => {
    withUndo(
      { itemId: id },
      () => {
        if (currentText !== undefined) {
          window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(currentText).trim());
          const timers = saveTimersRef.current;
          if (timers.has(id)) {
            clearTimeout(timers.get(id)!.timer);
            timers.delete(id);
          }
        }

        const todos = loadTodos();
        const item = todos.find(t => t.id === id);
        if (!item || item.type === 'section') return;

        window.EventLog.emitBatch([
          { type: 'field_changed', itemId: id, field: 'type', value: 'section' },
          { type: 'field_changed', itemId: id, field: 'level', value: 2 },
          { type: 'field_changed', itemId: id, field: 'indented', value: false },
        ]);
        syncAndEmit();
        pendingFocusRef.current = { itemId: id };
        notifyStateChange();
      },
      { itemId: id },
    );
  }, [pendingFocusRef]);

  const convertSectionToItem = useCallback((id: string, currentText?: string) => {
    withUndo(
      { itemId: id },
      () => {
        if (currentText !== undefined) {
          window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(currentText).trim());
          const timers = saveTimersRef.current;
          if (timers.has(id)) {
            clearTimeout(timers.get(id)!.timer);
            timers.delete(id);
          }
        }

        const todos = loadTodos();
        const item = todos.find(t => t.id === id);
        if (!item || item.type !== 'section') return;

        window.EventLog.emitBatch([
          { type: 'field_changed', itemId: id, field: 'type', value: 'todo' },
          { type: 'field_changed', itemId: id, field: 'level', value: null },
        ]);
        syncAndEmit();
        pendingFocusRef.current = { itemId: id };
        notifyStateChange();
      },
      { itemId: id },
    );
  }, [pendingFocusRef]);

  const setTodoIndent = useCallback((id: string, indented: boolean) => {
    withUndo(
      { itemId: id },
      () => {
        const todos = loadTodos();
        const todo = todos.find(t => t.id === id);
        if (todo && todo.type !== 'section') {
          window.EventLog.emitFieldChanged(id, 'indented', indented);
          pendingFocusRef.current = { itemId: id };
          notifyStateChange();
        }
      },
      { itemId: id },
    );
  }, [pendingFocusRef]);

  const setSectionLevel = useCallback((id: string, level: number, currentText?: string) => {
    withUndo(
      { itemId: id },
      () => {
        if (currentText !== undefined) {
          window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(currentText).trim());
          const timers = saveTimersRef.current;
          if (timers.has(id)) {
            clearTimeout(timers.get(id)!.timer);
            timers.delete(id);
          }
        }

        window.EventLog.emitFieldChanged(id, 'level', level);
        syncAndEmit();
        pendingFocusRef.current = { itemId: id };
        notifyStateChange();
      },
      { itemId: id },
    );
  }, [pendingFocusRef]);

  const moveItemUp = useCallback((id: string, currentText?: string) => {
    withUndo(
      { itemId: id },
      () => {
        if (currentText !== undefined) {
          window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(currentText).trim());
          const timers = saveTimersRef.current;
          if (timers.has(id)) {
            clearTimeout(timers.get(id)!.timer);
            timers.delete(id);
          }
        }

        const todos = loadTodos();
        const item = todos.find(t => t.id === id);
        if (!item) return;

        const parentId = item.parentId || null;
        const siblings = getSiblings(todos, parentId).filter(t => !t.archived);
        const idx = siblings.findIndex(t => t.id === id);
        if (idx <= 0) return;

        const prevSibling = siblings[idx - 1];
        const beforePrev = idx > 1 ? siblings[idx - 2].position : null;
        const newPosition = generatePositionBetween(beforePrev, prevSibling.position);

        window.EventLog.emitFieldChanged(id, 'position', newPosition);
        syncAndEmit();
        pendingFocusRef.current = { itemId: id };
        notifyStateChange();
      },
      { itemId: id },
    );
  }, [pendingFocusRef]);

  const moveItemDown = useCallback((id: string, currentText?: string) => {
    withUndo(
      { itemId: id },
      () => {
        if (currentText !== undefined) {
          window.EventLog.emitFieldChanged(id, 'text', sanitizeHTML(currentText).trim());
          const timers = saveTimersRef.current;
          if (timers.has(id)) {
            clearTimeout(timers.get(id)!.timer);
            timers.delete(id);
          }
        }

        const todos = loadTodos();
        const item = todos.find(t => t.id === id);
        if (!item) return;

        const parentId = item.parentId || null;
        const siblings = getSiblings(todos, parentId).filter(t => !t.archived);
        const idx = siblings.findIndex(t => t.id === id);
        if (idx === -1 || idx >= siblings.length - 1) return;

        const nextSibling = siblings[idx + 1];
        const afterNext = idx < siblings.length - 2 ? siblings[idx + 2].position : null;
        const newPosition = generatePositionBetween(nextSibling.position, afterNext);

        window.EventLog.emitFieldChanged(id, 'position', newPosition);
        syncAndEmit();
        pendingFocusRef.current = { itemId: id };
        notifyStateChange();
      },
      { itemId: id },
    );
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
    withUndo(
      null,
      () => {
        const todos = loadTodos();
        const toArchive = todos.filter(t => t.completed && !t.archived);
        if (toArchive.length > 0) {
          window.EventLog.emitFieldsChanged(toArchive.map(t => ({ itemId: t.id, field: 'archived', value: true })));
          notifyStateChange();
        }
      },
    );
  }, []);

  const reorderTodo = useCallback((draggedId: string, targetId: string) => {
    withUndo(
      { itemId: draggedId },
      () => {
        const todos = loadTodos();
        const dragged = todos.find(t => t.id === draggedId);
        const target = todos.find(t => t.id === targetId);
        if (!dragged || !target) return;

        const newParentId = target.parentId || null;
        const siblings = getSiblings(todos, newParentId).filter(t => t.id !== draggedId);
        const targetIdx = siblings.findIndex(t => t.id === targetId);

        const before = targetIdx > 0 ? siblings[targetIdx - 1].position : null;
        const after = target.position;
        const newPos = generatePositionBetween(before, after);

        const events: Array<{ itemId: string; field: string; value: unknown }> = [
          { itemId: draggedId, field: 'position', value: newPos },
        ];

        if ((dragged.parentId || null) !== newParentId) {
          events.push({ itemId: draggedId, field: 'parentId', value: newParentId });
        }

        window.EventLog.emitFieldsChanged(events);
        syncAndEmit();
        notifyStateChange();
      },
      { itemId: draggedId },
    );
  }, []);

  return {
    debouncedSave,
    updateTodoText,
    flushPendingSaves,
    addTodo,
    deleteTodo,
    toggleComplete,
    toggleImportant,
    insertTodoAfter,
    insertLineBefore,
    splitLineAt,
    backspaceOnLine,
    convertToSection,
    promoteItemToSection,
    convertSectionToItem,
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
