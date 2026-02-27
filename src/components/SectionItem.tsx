import React, { useRef, useCallback, useLayoutEffect, useState } from 'react';
import type { TodoItem as TodoItemType, ViewMode } from '../types';
import { getCursorOffset, splitHTMLAtCursor } from '../utils';
import { useContentEditable } from '../hooks/useContentEditable';
import { sanitizeHTML } from '../lib/sanitize';
import { isTouchDevice } from '../lib/touch-detect';
import type { TodoActions } from '../hooks/useTodoActions';
import type { TouchProps } from './TodoList';

interface SectionItemProps {
  section: TodoItemType;
  viewMode: ViewMode;
  actions: TodoActions;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, div: HTMLElement, textEl: HTMLElement, itemId: string) => boolean;
  onDragStart: (e: React.MouseEvent, sectionId: string, div: HTMLElement) => void;
  touchProps: TouchProps;
}

export function SectionItemComponent({ section, viewMode, actions, onKeyDown, onDragStart, touchProps }: SectionItemProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [touchEditing, setTouchEditing] = useState(false);

  // Sync text from props to DOM on every render when not focused.
  useLayoutEffect(() => {
    const el = textRef.current;
    const sanitized = sanitizeHTML(section.text);
    if (el && document.activeElement !== el && el.innerHTML !== sanitized) {
      el.innerHTML = sanitized;
    }
  });

  const { handleBlur: onBlurSave, handleInput, handlePaste } = useContentEditable({
    itemId: section.id,
    isImportant: false,
    onSave: actions.updateTodoText,
    onDebouncedSave: actions.debouncedSave,
  });

  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    setTouchEditing(false);
    onBlurSave(e);
  }, [onBlurSave]);

  const handleDivClick = useCallback((e: React.MouseEvent) => {
    // If swipe tray is open or was just closed, close it and blur instead of focusing
    if (touchProps.getSwipedItemId() === section.id || touchProps.wasRecentlyClosed()) {
      touchProps.closeSwipe();
      textRef.current?.blur();
      return;
    }

    const target = e.target as HTMLElement;
    const el = textRef.current;
    if (!el) return;

    // On touch devices, tapping text when not editing should enter edit mode
    if (isTouchDevice && !touchEditing && (target === el || el.contains(target))) {
      setTouchEditing(true);
      el.setAttribute('contenteditable', 'true');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return;
    }

    if (target === el || target.closest('.actions')) return;

    if (isTouchDevice && !touchEditing) {
      setTouchEditing(true);
      el.setAttribute('contenteditable', 'true');
    }
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [touchProps.getSwipedItemId, touchProps.closeSwipe, touchProps.wasRecentlyClosed, section.id, touchEditing]);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const div = divRef.current;
    const textEl = textRef.current;
    if (!div || !textEl) return;

    // Tab: demote — L1 → L2, L2 → item
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if ((section.level || 2) === 1) {
        actions.setSectionLevel(section.id, 2, textEl.innerHTML || '');
      } else {
        actions.convertSectionToItem(section.id, textEl.innerHTML || '');
      }
      return;
    }

    // Shift-Tab: promote to level 1
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      actions.setSectionLevel(section.id, 1, textEl.innerHTML || '');
      return;
    }

    // Backspace at start: convert to item and merge with previous
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.getRangeAt(0).collapsed && getCursorOffset(textEl) === 0) {
        e.preventDefault();
        actions.backspaceOnLine(section.id, textEl.innerHTML || '');
        return;
      }
    }

    // Enter: depends on cursor position
    if (e.key === 'Enter') {
      e.preventDefault();
      const content = textEl.textContent || '';
      const offset = getCursorOffset(textEl);

      if (offset === 0) {
        // Insert same-level section above
        textEl.blur();
        actions.insertLineBefore(section.id);
      } else if (offset >= content.length) {
        // Insert child item after section (existing behavior)
        textEl.blur();
        actions.insertTodoAfter(section.id);
      } else {
        // Split section text into two sections
        const { before, after } = splitHTMLAtCursor(textEl);
        textEl.blur();
        actions.splitLineAt(section.id, before, after);
      }
      return;
    }

    // Shared navigation handlers
    onKeyDown(e, div, textEl, section.id);
  }, [section.id, actions, onKeyDown]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    const div = divRef.current;
    if (div) onDragStart(e, section.id, div);
  }, [section.id, onDragStart]);

  // Swipe ref callback for content wrapper
  const contentRefCallback = useCallback((el: HTMLDivElement | null) => {
    if (el) touchProps.bindSwipeTarget(el, section.id);
  }, [touchProps.bindSwipeTarget, section.id]);

  // Long-press touch handler on outer div
  const handleSectionTouchStart = useCallback((e: React.TouchEvent) => {
    if (viewMode === 'done') return;

    const target = e.target as HTMLElement;
    if (target.closest('.text[contenteditable]') || target.closest('.swipe-actions-tray')) return;

    // Close any open swipe tray before starting drag
    if (touchProps.getSwipedItemId()) {
      touchProps.closeSwipe();
    }

    const div = divRef.current;
    if (div) {
      touchProps.handleTouchStartForDrag(section.id, div, true, e.touches[0]);
    }
  }, [section.id, viewMode, touchProps.handleTouchStartForDrag, touchProps.getSwipedItemId, touchProps.closeSwipe]);

  return (
    <div
      ref={divRef}
      className={`section-header level-${section.level || 2}`}
      data-id={section.id}
      onClick={handleDivClick}
      onTouchStart={handleSectionTouchStart}
    >
      <div className="section-content" ref={contentRefCallback}>
        <div
          className="drag-handle"
          style={viewMode === 'done' ? { display: 'none' } : undefined}
          onMouseDown={handleDragStart}
        >
          ⋮⋮
        </div>
        <div
          ref={textRef}
          className="text"
          contentEditable={isTouchDevice ? touchEditing : true}
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
        <div className="swipe-actions-tray">
          <button
            className="swipe-btn-delete"
            onClick={(e) => { e.stopPropagation(); touchProps.closeSwipe(); actions.deleteTodo(section.id); }}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
