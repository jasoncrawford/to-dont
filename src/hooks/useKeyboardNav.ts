import { useCallback } from 'react';
import { setCursorPosition, getCursorOffset } from '../utils';
import { performUndo, performRedo, canUndo, canRedo } from '../lib/undo-manager';
import type { TodoActions } from './useTodoActions';
import type { PendingFocus } from './useFocusManager';

// Shared keyboard navigation handlers for both todos and sections
export function useCommonKeydown(actions: TodoActions, pendingFocusRef: React.RefObject<PendingFocus | null>) {
  return useCallback((
    e: React.KeyboardEvent<HTMLDivElement>,
    div: HTMLElement,
    textEl: HTMLElement,
    itemId: string,
  ): boolean => {
    // Cmd+Z: undo
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      if (canUndo()) {
        actions.flushPendingSaves();
        performUndo(pendingFocusRef);
      }
      return true;
    }

    // Shift+Cmd+Z: redo
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      if (canRedo()) {
        performRedo(pendingFocusRef);
      }
      return true;
    }

    // Cmd+Shift+Up: move item up
    if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      actions.moveItemUp(itemId, textEl.innerHTML || '');
      return true;
    }

    // Cmd+Shift+Down: move item down
    if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      actions.moveItemDown(itemId, textEl.innerHTML || '');
      return true;
    }

    const todoList = document.getElementById('todoList');
    if (!todoList) return false;
    const items = Array.from(todoList.querySelectorAll('.todo-item, .section-header'));
    const currentIndex = items.indexOf(div);

    // Cmd+Up: jump to first item
    if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      textEl.blur();
      const firstText = items[0]?.querySelector('.text') as HTMLElement | null;
      if (firstText) {
        firstText.focus();
        setCursorPosition(firstText, 0);
      }
      return true;
    }

    // Cmd+Down: jump to last item
    if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      textEl.blur();
      const lastText = items[items.length - 1]?.querySelector('.text') as HTMLElement | null;
      if (lastText) {
        lastText.focus();
        setCursorPosition(lastText, lastText.textContent?.length || 0);
      }
      return true;
    }

    // Right arrow at end: move to next item at beginning
    if (e.key === 'ArrowRight' && currentIndex < items.length - 1) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      const content = textEl.textContent || '';
      const atEnd = range.collapsed && getCursorOffset(textEl) >= content.length;
      if (atEnd) {
        e.preventDefault();
        textEl.blur();
        const nextText = items[currentIndex + 1].querySelector('.text') as HTMLElement | null;
        if (nextText) {
          nextText.focus();
          setCursorPosition(nextText, 0);
        }
        return true;
      }
    }

    // Left arrow at start: move to previous item at end
    if (e.key === 'ArrowLeft' && currentIndex > 0) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      const atStart = range.collapsed && getCursorOffset(textEl) === 0;
      if (atStart) {
        e.preventDefault();
        textEl.blur();
        const prevText = items[currentIndex - 1].querySelector('.text') as HTMLElement | null;
        if (prevText) {
          prevText.focus();
          setCursorPosition(prevText, prevText.textContent?.length || 0);
        }
        return true;
      }
    }

    // Up arrow: move to previous item
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) {
        const cursorPos = getCursorOffset(textEl);
        textEl.blur();
        const prevText = items[currentIndex - 1].querySelector('.text') as HTMLElement | null;
        if (prevText) {
          prevText.focus();
          setCursorPosition(prevText, cursorPos);
        }
      } else {
        setCursorPosition(textEl, 0);
      }
      return true;
    }

    // Down arrow: move to next item
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentIndex < items.length - 1) {
        const cursorPos = getCursorOffset(textEl);
        textEl.blur();
        const nextText = items[currentIndex + 1].querySelector('.text') as HTMLElement | null;
        if (nextText) {
          nextText.focus();
          setCursorPosition(nextText, cursorPos);
        }
      } else {
        setCursorPosition(textEl, textEl.textContent?.length || 0);
      }
      return true;
    }

    return false;
  }, [actions, pendingFocusRef]);
}
