import { useRef, useCallback, useEffect } from 'react';

const DIRECTION_THRESHOLD = 10; // px before deciding horizontal vs vertical
const SNAP_THRESHOLD = 60; // px to trigger snap-open
const TRAY_WIDTH_TODO = 100; // px — width of tray with 2 buttons (! and ×)
const TRAY_WIDTH_SECTION = 52; // px — width of tray with 1 button (×)

interface SwipeState {
  startX: number;
  startY: number;
  itemId: string;
  contentEl: HTMLElement;
  trayWidth: number;
  directionDecided: boolean;
  isSwiping: boolean;
}

export function useSwipeToReveal() {
  const swipedItemIdRef = useRef<string | null>(null);
  const swipedContentRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef<SwipeState | null>(null);
  const listenersRef = useRef<Map<HTMLElement, { start: (e: TouchEvent) => void; move: (e: TouchEvent) => void; end: (e: TouchEvent) => void }>>(new Map());

  const closeSwipe = useCallback(() => {
    if (swipedContentRef.current) {
      swipedContentRef.current.style.transform = '';
      swipedContentRef.current.style.transition = 'transform 0.2s ease';
      const el = swipedContentRef.current;
      const cleanup = () => { el.style.transition = ''; el.removeEventListener('transitionend', cleanup); };
      el.addEventListener('transitionend', cleanup);
    }
    swipedItemIdRef.current = null;
    swipedContentRef.current = null;
  }, []);

  const getSwipedItemId = useCallback(() => swipedItemIdRef.current, []);

  const bindSwipeTarget = useCallback((contentEl: HTMLElement | null, itemId: string) => {
    if (!contentEl) return;

    // Avoid double-binding
    if (listenersRef.current.has(contentEl)) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];

      // Close any previously open swipe
      if (swipedItemIdRef.current && swipedItemIdRef.current !== itemId) {
        closeSwipe();
      }

      // Measure tray width (tray is a child of contentEl)
      const tray = contentEl.querySelector('.swipe-actions-tray') as HTMLElement | null;
      let trayWidth = TRAY_WIDTH_TODO;
      if (tray) {
        const buttons = tray.querySelectorAll('button');
        trayWidth = buttons.length === 1 ? TRAY_WIDTH_SECTION : TRAY_WIDTH_TODO;
      }

      stateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        itemId,
        contentEl,
        trayWidth,
        directionDecided: false,
        isSwiping: false,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      const state = stateRef.current;
      if (!state || state.contentEl !== contentEl) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;

      if (!state.directionDecided) {
        const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (dist < DIRECTION_THRESHOLD) return;

        state.directionDecided = true;
        if (Math.abs(deltaX) / Math.abs(deltaY) > 2) {
          state.isSwiping = true;
        } else {
          // Vertical scroll — abandon
          stateRef.current = null;
          return;
        }
      }

      if (!state.isSwiping) return;

      e.preventDefault();

      // If this item is already swiped open, adjust deltaX relative to open position
      let translateX: number;
      if (swipedItemIdRef.current === itemId) {
        translateX = -state.trayWidth + deltaX;
      } else {
        translateX = deltaX;
      }

      // Clamp: no further right than 0, no further left than -trayWidth
      translateX = Math.min(0, Math.max(-state.trayWidth, translateX));

      contentEl.style.transition = '';
      contentEl.style.transform = `translateX(${translateX}px)`;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const state = stateRef.current;
      if (!state || state.contentEl !== contentEl) return;
      stateRef.current = null;

      if (!state.isSwiping) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - state.startX;

      // If already open, check if closing
      if (swipedItemIdRef.current === itemId) {
        const effectiveDelta = deltaX;
        if (effectiveDelta > SNAP_THRESHOLD) {
          // Snap closed
          closeSwipe();
        } else {
          // Stay open — tray stays visible
          contentEl.style.transition = 'transform 0.2s ease';
          contentEl.style.transform = `translateX(-${state.trayWidth}px)`;
          const cleanup = () => { contentEl.style.transition = ''; contentEl.removeEventListener('transitionend', cleanup); };
          contentEl.addEventListener('transitionend', cleanup);
        }
      } else {
        if (deltaX < -SNAP_THRESHOLD) {
          // Snap open — tray stays visible
          contentEl.style.transition = 'transform 0.2s ease';
          contentEl.style.transform = `translateX(-${state.trayWidth}px)`;
          swipedItemIdRef.current = itemId;
          swipedContentRef.current = contentEl;
          const cleanup = () => { contentEl.style.transition = ''; contentEl.removeEventListener('transitionend', cleanup); };
          contentEl.addEventListener('transitionend', cleanup);
        } else {
          // Snap back
          contentEl.style.transition = 'transform 0.2s ease';
          contentEl.style.transform = '';
          const cleanup = () => { contentEl.style.transition = ''; contentEl.removeEventListener('transitionend', cleanup); };
          contentEl.addEventListener('transitionend', cleanup);
        }
      }
    };

    contentEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    contentEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    contentEl.addEventListener('touchend', handleTouchEnd, { passive: true });
    listenersRef.current.set(contentEl, { start: handleTouchStart, move: handleTouchMove, end: handleTouchEnd });
  }, [closeSwipe]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      listenersRef.current.forEach((handlers, el) => {
        el.removeEventListener('touchstart', handlers.start);
        el.removeEventListener('touchmove', handlers.move);
        el.removeEventListener('touchend', handlers.end);
      });
      listenersRef.current.clear();
    };
  }, []);

  // Close swipe on outside tap
  useEffect(() => {
    const handleDocTouch = (e: TouchEvent) => {
      if (!swipedItemIdRef.current) return;
      const target = e.target as HTMLElement;
      // If touch is inside the swiped item, let it through (for tray button taps)
      const swipedEl = swipedContentRef.current?.parentElement;
      if (swipedEl && swipedEl.contains(target)) return;
      closeSwipe();
    };

    document.addEventListener('touchstart', handleDocTouch, { passive: true });
    return () => document.removeEventListener('touchstart', handleDocTouch);
  }, [closeSwipe]);

  return { getSwipedItemId, bindSwipeTarget, closeSwipe };
}
