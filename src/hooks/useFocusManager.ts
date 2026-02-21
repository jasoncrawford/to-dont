import { useRef, useLayoutEffect } from 'react';
import { setCursorPosition } from '../utils';

export interface PendingFocus {
  itemId: string;
  cursorPos?: number;
  atEnd?: boolean;
}

export function useFocusManager() {
  const pendingFocusRef = useRef<PendingFocus | null>(null);

  // useLayoutEffect ensures focus is set synchronously during the commit phase,
  // after child useLayoutEffects (which set innerHTML) but before browser paint.
  // This prevents a gap where the element is rendered but not focused.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;

    const el = document.querySelector(`[data-id="${pending.itemId}"] .text`) as HTMLElement | null;
    const beforeFocus = document.activeElement;
    console.log('[FocusManager]', {
      itemId: pending.itemId,
      found: !!el,
      elTag: el?.tagName,
      elClass: el?.className,
      beforeFocus: beforeFocus?.tagName + '.' + beforeFocus?.className,
      allDataIds: Array.from(document.querySelectorAll('[data-id]')).map(e => e.getAttribute('data-id')),
    });
    if (!el) return;

    el.focus();
    if (pending.atEnd) {
      setCursorPosition(el, el.textContent?.length || 0);
    } else if (pending.cursorPos !== undefined) {
      setCursorPosition(el, pending.cursorPos);
    }
    console.log('[FocusManager] after focus:', { activeElement: document.activeElement?.tagName + '.' + document.activeElement?.className, isTarget: document.activeElement === el });

    // Track if something steals focus after we set it
    const focusHandler = (e: Event) => {
      const fe = e as FocusEvent;
      const newTarget = fe.target as HTMLElement;
      console.log('[FocusManager] FOCUS STOLEN!', {
        newTarget: newTarget?.tagName + '.' + newTarget?.className,
        newTargetId: newTarget?.id,
        inTodoItem: !!newTarget?.closest('.todo-item'),
        inNewItem: !!newTarget?.closest('.new-item'),
        relatedTarget: (fe.relatedTarget as HTMLElement)?.tagName + '.' + (fe.relatedTarget as HTMLElement)?.className,
      });
      console.trace('[FocusManager] focus change stack trace');
    };
    document.addEventListener('focusin', focusHandler);
    setTimeout(() => {
      document.removeEventListener('focusin', focusHandler);
      console.log('[FocusManager] 1s check:', {
        activeElement: document.activeElement?.tagName + '.' + document.activeElement?.className,
        inTodoItem: !!document.activeElement?.closest('.todo-item'),
        inNewItem: !!document.activeElement?.closest('.new-item'),
      });
    }, 1000);
  });

  return { pendingFocusRef };
}
