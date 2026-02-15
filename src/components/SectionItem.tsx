import React, { useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { TodoItem as TodoItemType, ViewMode } from '../types';
import { useContentEditable } from '../hooks/useContentEditable';
import type { TodoActions } from '../hooks/useTodoActions';

interface SectionItemProps {
  section: TodoItemType;
  viewMode: ViewMode;
  actions: TodoActions;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, div: HTMLElement, textEl: HTMLElement, itemId: string) => boolean;
  onDragStart: (e: React.MouseEvent, sectionId: string, div: HTMLElement) => void;
}

export function SectionItemComponent({ section, viewMode, actions, onKeyDown, onDragStart }: SectionItemProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  // Sync text from props to DOM on every render when not focused.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && document.activeElement !== el && el.textContent !== section.text) {
      el.textContent = section.text;
    }
  });

  const { handleBlur, handleInput, handlePaste } = useContentEditable({
    itemId: section.id,
    isImportant: false,
    onSave: actions.updateTodoText,
    onDebouncedSave: actions.debouncedSave,
  });

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

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const div = divRef.current;
    const textEl = textRef.current;
    if (!div || !textEl) return;

    // Tab: demote to level 2
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      actions.updateTodoText(section.id, textEl.textContent || '');
      actions.setSectionLevel(section.id, 2);
      return;
    }

    // Shift-Tab: promote to level 1
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      actions.updateTodoText(section.id, textEl.textContent || '');
      actions.setSectionLevel(section.id, 1);
      return;
    }

    // Enter: insert new todo after section
    if (e.key === 'Enter') {
      e.preventDefault();
      textEl.blur();
      actions.insertTodoAfter(section.id);
      return;
    }

    // Shared navigation handlers
    onKeyDown(e, div, textEl, section.id);
  }, [section.id, actions, onKeyDown]);

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    const div = divRef.current;
    if (div) onDragStart(e, section.id, div);
  }, [section.id, onDragStart]);

  return (
    <div
      ref={divRef}
      className={`section-header level-${section.level || 2}`}
      data-id={section.id}
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
        ref={textRef}
        className="text"
        contentEditable="true"
        suppressContentEditableWarning
        onBlur={handleBlur}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleTextKeyDown}
      />
      <div className="actions">
        <button
          title="Delete section"
          onClick={(e) => { e.stopPropagation(); actions.deleteTodo(section.id); }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
