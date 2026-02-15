import { useRef, useEffect, useCallback } from 'react';
import { setCursorPosition } from '../utils';

export interface PendingFocus {
  itemId: string;
  cursorPos?: number;
  atEnd?: boolean;
}

export function useFocusManager() {
  const pendingFocusRef = useRef<PendingFocus | null>(null);

  useEffect(() => {
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

  const requestFocus = useCallback((itemId: string, cursorPos?: number, atEnd?: boolean) => {
    pendingFocusRef.current = { itemId, cursorPos, atEnd };
  }, []);

  return { requestFocus, pendingFocusRef };
}
