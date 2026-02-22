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

    const el = document.querySelector(`[data-id="${pending.itemId}"] .text`) as HTMLElement | null;
    if (!el) return;

    el.focus();
    if (pending.atEnd) {
      setCursorPosition(el, el.textContent?.length || 0);
    } else if (pending.cursorPos !== undefined) {
      setCursorPosition(el, pending.cursorPos);
    }
  });

  return { pendingFocusRef };
}
