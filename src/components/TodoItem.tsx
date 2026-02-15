import React, { useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { TodoItem as TodoItemType, ViewMode } from '../types';
import { formatDate, getFadeOpacity, getImportanceLevel, getCursorOffset } from '../utils';
import { useContentEditable } from '../hooks/useContentEditable';
import type { TodoActions } from '../hooks/useTodoActions';

interface TodoItemProps {
  todo: TodoItemType;
  viewMode: ViewMode;
  now: number;
  actions: TodoActions;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, div: HTMLElement, textEl: HTMLElement, itemId: string) => boolean;
  onDragStart: (e: React.MouseEvent, itemId: string, div: HTMLElement) => void;
}

export function TodoItemComponent({ todo, viewMode, now, actions, onKeyDown, onDragStart }: TodoItemProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  // Sync text from props to DOM on every render when not focused.
  // Runs synchronously before paint (useLayoutEffect) so that
  // window.render() callers see the DOM updated immediately (via flushSync).
  // No deps array — must run every render to catch cases where todo.text
  // hasn't changed but the DOM was modified by user typing.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && document.activeElement !== el && el.textContent !== todo.text) {
      el.textContent = todo.text;
    }
  });

  const onImportantChange = useCallback((id: string, newImportant: boolean) => {
    window.EventLog.emitFieldChanged(id, 'important', newImportant);
  }, []);

  const { handleBlur, handleInput, handlePaste, initExclamationCount } = useContentEditable({
    itemId: todo.id,
    isImportant: todo.important,
    onSave: actions.updateTodoText,
    onDebouncedSave: actions.debouncedSave,
    onImportantChange: viewMode !== 'done' ? onImportantChange : undefined,
  });

  useEffect(() => {
    initExclamationCount(todo.text);
  }, []);

  // Build className
  let className = 'todo-item';
  if (todo.completed && viewMode !== 'done') className += ' completed';
  if (todo.indented) className += ' indented';
  if (!todo.completed && !todo.archived && todo.important) {
    className += ` important-level-${getImportanceLevel(todo.createdAt, now)}`;
  }

  // Fade opacity
  let style: React.CSSProperties | undefined;
  if (!todo.completed && !todo.archived && !todo.important) {
    style = { opacity: Math.max(0.2, getFadeOpacity(todo.createdAt, now)) };
  }

  const handleDivClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target === textRef.current || target.closest('.actions')) return;
    const el = textRef.current;
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }, []);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    actions.toggleComplete(todo.id);
  }, [todo.id, actions]);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const div = divRef.current;
    const textEl = textRef.current;
    if (!div || !textEl) return;

    // Tab: indent todo
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      actions.setTodoIndent(todo.id, true);
      return;
    }

    // Shift-Tab: unindent
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      actions.setTodoIndent(todo.id, false);
      return;
    }

    // Backspace at start: merge with previous
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);

      if (!range.collapsed) return; // Let default behavior delete selection

      if (getCursorOffset(textEl) === 0) {
        const todoList = document.getElementById('todoList');
        if (!todoList) return;
        const items = Array.from(todoList.querySelectorAll('.todo-item, .section-header'));
        const currentIndex = items.indexOf(div);
        if (currentIndex > 0) {
          const prevItem = items[currentIndex - 1] as HTMLElement;
          if (prevItem.classList.contains('todo-item')) {
            e.preventDefault();
            const prevId = prevItem.dataset.id;
            textEl.blur();
            if (prevId) actions.mergeWithPrevious(todo.id, prevId);
            return;
          }
        }
      }
    }

    // Enter: depends on cursor position
    if (e.key === 'Enter') {
      const content = textEl.textContent || '';

      if (!content.trim()) {
        e.preventDefault();
        actions.convertToSection(todo.id);
        return;
      }

      e.preventDefault();
      const offset = getCursorOffset(textEl);

      if (offset === 0) {
        textEl.blur();
        actions.insertTodoBefore(todo.id);
      } else if (offset >= content.length) {
        textEl.blur();
        actions.insertTodoAfter(todo.id);
      } else {
        const textBefore = content.substring(0, offset);
        const textAfter = content.substring(offset);
        textEl.blur();
        actions.splitTodoAt(todo.id, textBefore, textAfter);
      }
      return;
    }

    // Shared navigation handlers
    onKeyDown(e, div, textEl, todo.id);
  }, [todo.id, actions, onKeyDown]);

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (todo.archived) return;
    const div = divRef.current;
    if (div) onDragStart(e, todo.id, div);
  }, [todo.id, todo.archived, onDragStart]);

  return (
    <div
      ref={divRef}
      className={className}
      data-id={todo.id}
      style={style}
      onClick={handleDivClick}
    >
      <div
        className="drag-handle"
        style={viewMode === 'done' ? { display: 'none' } : undefined}
        onMouseDown={handleDragMouseDown}
      >
        ⋮⋮
      </div>
      <div
        className="checkbox"
        onClick={viewMode !== 'done' ? handleCheckboxClick : undefined}
        style={viewMode === 'done' ? { cursor: 'default' } : undefined}
      >
        {todo.completed ? '✓' : ''}
      </div>
      <div
        ref={textRef}
        className="text"
        contentEditable={!todo.archived}
        suppressContentEditableWarning
        onBlur={handleBlur}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleTextKeyDown}
      />
      <span className="date">{formatDate(todo.createdAt, now)}</span>
      <div className="actions">
        {viewMode !== 'done' && (
          <button
            className={`important-btn${todo.important ? ' active' : ''}`}
            title={todo.archived ? 'Rescue item' : (todo.important ? 'Remove urgency' : 'Mark urgent')}
            onClick={(e) => { e.stopPropagation(); actions.toggleImportant(todo.id); }}
          >
            !
          </button>
        )}
        <button
          title="Delete"
          onClick={(e) => { e.stopPropagation(); actions.deleteTodo(todo.id); }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
