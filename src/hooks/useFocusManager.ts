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
  });

  return { pendingFocusRef };
}
