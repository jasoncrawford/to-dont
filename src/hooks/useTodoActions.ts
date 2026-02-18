import { useCallback, useRef } from 'react';
import { loadTodos, notifyStateChange } from '../store';
import {
  createNewItem, getItemPosition, generatePositionBetween,
  getItemGroup, splitOnArrow,
} from '../utils';
import { sanitizeHTML, textLengthOfHTML } from '../lib/sanitize';
import type { TodoItem, ViewMode } from '../types';
import type { PendingFocus } from './useFocusManager';

const SAVE_DEBOUNCE_MS = 300;

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

  const addTodo = useCallback((text: string) => {
    if (!text.trim()) return;
    const todos = loadTodos();
    const newTodo = createNewItem(sanitizeHTML(text), todos.length, todos);
    const value: Record<string, unknown> = {
      text: newTodo.text, position: newTodo.position,
    };
    if (viewMode === 'important') {
      value.important = true;
    }
    window.EventLog.emitItemCreated(newTodo.id, value);
    pendingFocusRef.current = { itemId: newTodo.id, atEnd: true };
    notifyStateChange();
  }, [pendingFocusRef, viewMode]);

  const deleteTodo = useCallback((id: string) => {
    window.EventLog.emitItemDeleted(id);
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
        const todoIndex = todos.indexOf(todo);
        const newTodo = createNewItem(split.after, todoIndex + 1, todos);
        batch.push({
          type: 'item_created', itemId: newTodo.id, value: {
            text: newTodo.text, position: newTodo.position,
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
    const index = todos.findIndex(t => t.id === afterId);
    if (index === -1) return;

    const newTodo = createNewItem('', index + 1, todos);
    const value: Record<string, unknown> = {
      text: '', position: newTodo.position,
    };
    if (viewMode === 'important') {
      value.important = true;
    }
    window.EventLog.emitItemCreated(newTodo.id, value);
    pendingFocusRef.current = { itemId: newTodo.id, cursorPos: 0 };
    notifyStateChange();
  }, [pendingFocusRef, viewMode]);

  const insertTodoBefore = useCallback((beforeId: string) => {
    const todos = loadTodos();
    const index = todos.findIndex(t => t.id === beforeId);
    if (index === -1) return;

    const newTodo = createNewItem('', index, todos);
    const value: Record<string, unknown> = {
      text: '', position: newTodo.position,
    };
    if (viewMode === 'important') {
      value.important = true;
    }
    window.EventLog.emitItemCreated(newTodo.id, value);
    pendingFocusRef.current = { itemId: beforeId, cursorPos: 0 };
    notifyStateChange();
  }, [pendingFocusRef, viewMode]);

  const splitTodoAt = useCallback((id: string, textBefore: string, textAfter: string) => {
    const todos = loadTodos();
    const index = todos.findIndex(t => t.id === id);
    if (index === -1) return;

    const newTodo = createNewItem(textAfter, index + 1, todos);
    const newItemValue: Record<string, unknown> = { text: newTodo.text, position: newTodo.position };
    if (viewMode === 'important') {
      newItemValue.important = true;
    }
    window.EventLog.emitBatch([
      { type: 'field_changed', itemId: id, field: 'text', value: textBefore.trim() },
      { type: 'item_created', itemId: newTodo.id, value: newItemValue },
    ]);
    pendingFocusRef.current = { itemId: newTodo.id, cursorPos: 0 };
    notifyStateChange();
  }, [pendingFocusRef, viewMode]);

  const mergeWithPrevious = useCallback((currentId: string, prevId: string) => {
    const todos = loadTodos();
    const currentIndex = todos.findIndex(t => t.id === currentId);
    const prevIndex = todos.findIndex(t => t.id === prevId);
    if (currentIndex === -1 || prevIndex === -1) return;

    const currentTodo = todos[currentIndex];
    const prevTodo = todos[prevIndex];
    const cursorPos = textLengthOfHTML(prevTodo.text);
    const mergedText = sanitizeHTML(prevTodo.text + currentTodo.text);

    window.EventLog.emitBatch([
      { type: 'field_changed', itemId: prevId, field: 'text', value: mergedText },
      { type: 'item_deleted', itemId: currentId },
    ]);
    pendingFocusRef.current = { itemId: prevId, cursorPos };
    notifyStateChange();
  }, [pendingFocusRef]);

  const convertToSection = useCallback((id: string) => {
    window.EventLog.emitBatch([
      { type: 'field_changed', itemId: id, field: 'type', value: 'section' },
      { type: 'field_changed', itemId: id, field: 'level', value: 2 },
      { type: 'field_changed', itemId: id, field: 'text', value: '' },
    ]);
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
    const todos = loadTodos();
    const section = todos.find(t => t.id === id);
    if (section && section.type === 'section') {
      window.EventLog.emitFieldChanged(id, 'level', level);
      pendingFocusRef.current = { itemId: id };
      notifyStateChange();
    }
  }, [pendingFocusRef]);

  const moveItemUp = useCallback((id: string) => {
    const todos = loadTodos();
    const active = todos.filter(t => !t.archived);
    const activeIndex = active.findIndex(t => t.id === id);
    if (activeIndex <= 0) return;

    const actualIndex = todos.findIndex(t => t.id === id);
    const currentItem = todos[actualIndex];
    const groupIndices = getItemGroup(todos, actualIndex);

    let insertAt: number;
    if (currentItem.type === 'section') {
      let prevSectionIndex = -1;
      for (let i = actualIndex - 1; i >= 0; i--) {
        if (todos[i].type === 'section' && !todos[i].archived) {
          prevSectionIndex = i;
          break;
        }
      }
      if (prevSectionIndex === -1) {
        insertAt = 0;
      } else {
        const prevGroupIndices = getItemGroup(todos, prevSectionIndex);
        insertAt = prevGroupIndices[0];
      }
    } else {
      const prevActiveId = active[activeIndex - 1].id;
      const prevActualIndex = todos.findIndex(t => t.id === prevActiveId);
      const prevGroupIndices = getItemGroup(todos, prevActualIndex);
      insertAt = prevGroupIndices[0];
    }

    const group = groupIndices.map(i => todos[i]);
    for (let i = groupIndices.length - 1; i >= 0; i--) {
      todos.splice(groupIndices[i], 1);
    }

    const before = insertAt > 0 ? getItemPosition(todos, insertAt - 1) : null;
    const after = insertAt < todos.length ? getItemPosition(todos, insertAt) : null;
    let lastPos = before;
    const positionChanges: Array<{ itemId: string; field: string; value: string }> = [];
    group.forEach((item, i) => {
      const nextPos = i === group.length - 1 ? after : null;
      const newPos = generatePositionBetween(lastPos, nextPos || after);
      positionChanges.push({ itemId: item.id, field: 'position', value: newPos });
      lastPos = newPos;
    });

    window.EventLog.emitFieldsChanged(positionChanges);
    pendingFocusRef.current = { itemId: id };
    notifyStateChange();
  }, [pendingFocusRef]);

  const moveItemDown = useCallback((id: string) => {
    const todos = loadTodos();
    const active = todos.filter(t => !t.archived);
    const activeIndex = active.findIndex(t => t.id === id);
    if (activeIndex === -1 || activeIndex >= active.length - 1) return;

    const actualIndex = todos.findIndex(t => t.id === id);
    const currentItem = todos[actualIndex];
    const groupIndices = getItemGroup(todos, actualIndex);
    const groupSize = groupIndices.length;

    let insertAt: number;
    if (currentItem.type === 'section') {
      let nextSectionIndex = -1;
      for (let i = groupIndices[groupIndices.length - 1] + 1; i < todos.length; i++) {
        if (todos[i].type === 'section' && !todos[i].archived) {
          nextSectionIndex = i;
          break;
        }
      }
      if (nextSectionIndex === -1) {
        insertAt = todos.length;
      } else {
        const nextGroupIndices = getItemGroup(todos, nextSectionIndex);
        insertAt = nextGroupIndices[nextGroupIndices.length - 1] + 1;
      }
    } else {
      let nextIndex = activeIndex + 1;
      while (nextIndex < active.length && groupIndices.includes(todos.findIndex(t => t.id === active[nextIndex].id))) {
        nextIndex++;
      }
      if (nextIndex >= active.length) return;
      const nextActiveId = active[nextIndex].id;
      const nextActualIndex = todos.findIndex(t => t.id === nextActiveId);
      insertAt = nextActualIndex + 1;
    }

    const group = groupIndices.map(i => todos[i]);
    for (let i = groupIndices.length - 1; i >= 0; i--) {
      todos.splice(groupIndices[i], 1);
    }
    const adjustedInsert = insertAt - groupSize;

    const before = adjustedInsert > 0 ? getItemPosition(todos, adjustedInsert - 1) : null;
    const after = adjustedInsert < todos.length ? getItemPosition(todos, adjustedInsert) : null;
    let lastPos = before;
    const positionChanges: Array<{ itemId: string; field: string; value: string }> = [];
    group.forEach((item, i) => {
      const nextPos = i === group.length - 1 ? after : null;
      const newPos = generatePositionBetween(lastPos, nextPos || after);
      positionChanges.push({ itemId: item.id, field: 'position', value: newPos });
      lastPos = newPos;
    });

    window.EventLog.emitFieldsChanged(positionChanges);
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
    const draggedIndex = todos.findIndex(t => t.id === draggedId);
    const targetIndex = todos.findIndex(t => t.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const todosClone = [...todos];
    todosClone.splice(draggedIndex, 1);
    const newTargetIndex = todosClone.findIndex(t => t.id === targetId);

    const before = newTargetIndex > 0 ? getItemPosition(todosClone, newTargetIndex - 1) : null;
    const after = getItemPosition(todosClone, newTargetIndex);
    const newPos = generatePositionBetween(before, after);

    window.EventLog.emitFieldChanged(draggedId, 'position', newPos);
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
    insertTodoBefore,
    splitTodoAt,
    mergeWithPrevious,
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
