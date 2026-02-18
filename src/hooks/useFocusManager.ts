import { useRef, useEffect } from 'react';
import { setCursorPosition } from '../utils';

export interface PendingFocus {
  itemId: string;
  cursorPos?: number;
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
    if (pending.cursorPos !== undefined) {
      setCursorPosition(el, pending.cursorPos);
    }
  });

  return { pendingFocusRef };
}
