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
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;

    const ae = () => {
      const a = document.activeElement;
      return a ? `${a.tagName}.${a.className}${a.id ? '#' + a.id : ''}` : 'null';
    };

    const el = document.querySelector(`[data-id="${pending.itemId}"] .text`) as HTMLElement | null;
    console.log('[FocusManager] pending:', pending.itemId, 'found:', !!el, 'active before:', ae());
    if (!el) return;

    el.focus();
    if (pending.atEnd) {
      setCursorPosition(el, el.textContent?.length || 0);
    } else if (pending.cursorPos !== undefined) {
      setCursorPosition(el, pending.cursorPos);
    }
    const sel = window.getSelection();
    console.log('[FocusManager] after focus+cursor, active:', ae(), 'isTarget:', document.activeElement === el,
      'sel:', { rangeCount: sel?.rangeCount, collapsed: sel?.isCollapsed, anchorInEl: sel?.anchorNode ? el.contains(sel.anchorNode) : false },
      'contentEditable:', el.contentEditable, 'isConnected:', el.isConnected);

    // Track if anything steals focus
    const targetEl = el;
    setTimeout(() => {
      const stillFocused = document.activeElement === targetEl;
      console.log('[FocusManager] 50ms later, stillFocused:', stillFocused, 'active:', ae());
    }, 50);
    setTimeout(() => {
      const stillFocused = document.activeElement === targetEl;
      console.log('[FocusManager] 200ms later, stillFocused:', stillFocused, 'active:', ae());
    }, 200);
  });

  return { pendingFocusRef };
}
