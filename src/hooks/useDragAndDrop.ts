import { useRef, useEffect, useCallback } from 'react';
import { loadTodos, notifyStateChange } from '../store';
import { getDescendantIds, getSiblings, generatePositionBetween } from '../utils';
import type { TodoItem } from '../types';

interface DragState {
  id: string;
  placeholder: HTMLElement;
  originalElements?: HTMLElement[];
  clone: HTMLElement;
  fixedX: number;
  offsetY: number;
  isSection?: boolean;
  isTouch?: boolean;
}

interface LongPressState {
  timerId: ReturnType<typeof setTimeout>;
  startX: number;
  startY: number;
  itemId: string;
  div: HTMLElement;
  isSection: boolean;
}

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_THRESHOLD = 10;
const AUTO_SCROLL_ZONE = 60; // px from edge
const AUTO_SCROLL_SPEED = 8; // px per frame

export function useDragAndDrop() {
  const dragStateRef = useRef<DragState | null>(null);
  const longPressRef = useRef<LongPressState | null>(null);
  const autoScrollRef = useRef<number | null>(null);

  // Internal: set up item drag from coordinates
  const initItemDrag = useCallback((clientX: number, clientY: number, itemId: string, div: HTMLElement, isTouch: boolean) => {
    const rect = div.getBoundingClientRect();

    const clone = div.cloneNode(true) as HTMLElement;
    clone.classList.add('drag-clone');
    const pad = 16;
    clone.style.width = (rect.width + pad * 2) + 'px';
    clone.style.left = (rect.left - pad) + 'px';
    clone.style.top = rect.top + 'px';
    clone.style.paddingLeft = pad + 'px';
    clone.style.paddingRight = pad + 'px';
    document.body.appendChild(clone);

    div.classList.add('placeholder');

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    dragStateRef.current = {
      id: itemId,
      placeholder: div,
      clone: clone,
      fixedX: rect.left - pad,
      offsetY: clientY - rect.top,
      isTouch,
    };
  }, []);

  // Internal: set up section drag from coordinates
  const initSectionDrag = useCallback((clientX: number, clientY: number, sectionId: string, div: HTMLElement, isTouch: boolean) => {
    const rect = div.getBoundingClientRect();

    const todos = loadTodos();
    const descendantIds = getDescendantIds(todos, sectionId);
    const allIds = [sectionId, ...descendantIds];

    const groupElements: HTMLElement[] = [];
    allIds.forEach(id => {
      const el = document.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (el) groupElements.push(el);
    });

    const totalHeight = groupElements.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);

    const placeholderContainer = document.createElement('div');
    placeholderContainer.className = 'section-placeholder-container';
    placeholderContainer.style.height = totalHeight + 'px';

    const todoList = document.getElementById('todoList');
    if (todoList && groupElements[0]) {
      todoList.insertBefore(placeholderContainer, groupElements[0]);
    }

    const pad = 16;
    const cloneContainer = document.createElement('div');
    cloneContainer.className = 'drag-clone-container';
    cloneContainer.style.position = 'fixed';
    cloneContainer.style.left = (rect.left - pad) + 'px';
    cloneContainer.style.top = rect.top + 'px';
    cloneContainer.style.width = (rect.width + pad * 2) + 'px';
    cloneContainer.style.zIndex = '1000';
    cloneContainer.style.pointerEvents = 'none';
    cloneContainer.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim();
    cloneContainer.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.18)';
    cloneContainer.style.transform = 'scale(1.02)';
    cloneContainer.style.borderRadius = '8px';
    cloneContainer.style.paddingLeft = pad + 'px';
    cloneContainer.style.paddingRight = pad + 'px';
    cloneContainer.style.boxSizing = 'border-box';

    groupElements.forEach(el => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.opacity = '0.95';
      cloneContainer.appendChild(clone);
      el.style.display = 'none';
    });

    document.body.appendChild(cloneContainer);

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    dragStateRef.current = {
      id: sectionId,
      placeholder: placeholderContainer,
      originalElements: groupElements,
      clone: cloneContainer,
      fixedX: rect.left - pad,
      offsetY: clientY - rect.top,
      isSection: true,
      isTouch,
    };
  }, []);

  // Public: mouse drag start for items
  const startItemDrag = useCallback((e: React.MouseEvent, itemId: string, div: HTMLElement) => {
    e.preventDefault();
    initItemDrag(e.clientX, e.clientY, itemId, div, false);
  }, [initItemDrag]);

  // Public: mouse drag start for sections
  const startSectionDrag = useCallback((e: React.MouseEvent, sectionId: string, div: HTMLElement) => {
    e.preventDefault();
    initSectionDrag(e.clientX, e.clientY, sectionId, div, false);
  }, [initSectionDrag]);

  // Public: long-press touch handler
  const handleTouchStartForDrag = useCallback((itemId: string, div: HTMLElement, isSection: boolean, touch: { clientX: number; clientY: number }) => {
    cancelLongPress();
    const timerId = setTimeout(() => {
      longPressRef.current = null;
      navigator.vibrate?.(50);
      if (isSection) {
        initSectionDrag(touch.clientX, touch.clientY, itemId, div, true);
      } else {
        initItemDrag(touch.clientX, touch.clientY, itemId, div, true);
      }
    }, LONG_PRESS_MS);

    longPressRef.current = {
      timerId,
      startX: touch.clientX,
      startY: touch.clientY,
      itemId,
      div,
      isSection,
    };
  }, [initItemDrag, initSectionDrag]);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timerId);
      longPressRef.current = null;
    }
  }, []);

  const isDragActive = useCallback(() => dragStateRef.current !== null, []);

  // Auto-scroll helper
  function startAutoScroll(clientY: number) {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }

    const viewportHeight = window.innerHeight;
    let speed = 0;
    if (clientY < AUTO_SCROLL_ZONE) {
      speed = -AUTO_SCROLL_SPEED * (1 - clientY / AUTO_SCROLL_ZONE);
    } else if (clientY > viewportHeight - AUTO_SCROLL_ZONE) {
      speed = AUTO_SCROLL_SPEED * (1 - (viewportHeight - clientY) / AUTO_SCROLL_ZONE);
    }

    if (speed === 0) return;

    const scroll = () => {
      window.scrollBy(0, speed);
      autoScrollRef.current = requestAnimationFrame(scroll);
    };
    autoScrollRef.current = requestAnimationFrame(scroll);
  }

  function stopAutoScroll() {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }

  // Shared move logic
  function handleDragMove(clientY: number) {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    dragState.clone.style.left = dragState.fixedX + 'px';
    dragState.clone.style.top = (clientY - dragState.offsetY) + 'px';

    const todoList = document.getElementById('todoList');
    if (!todoList) return;
    const isDraggingSection = !!dragState.isSection;

    const items = Array.from(todoList.querySelectorAll('.todo-item, .section-header'))
      .filter(item => (item as HTMLElement).style.display !== 'none') as HTMLElement[];

    let targetItem: HTMLElement | null = null;
    for (const item of items) {
      if (item === dragState.placeholder) continue;

      const rect = item.getBoundingClientRect();
      let midY: number;

      if (isDraggingSection && item.classList.contains('section-header')) {
        const itemId = (item as HTMLElement).dataset.id;
        const todos = loadTodos();
        if (itemId) {
          const descIds = getDescendantIds(todos, itemId);
          let totalHeight = rect.height;
          for (const descId of descIds) {
            const descEl = todoList.querySelector(`[data-id="${descId}"]`) as HTMLElement | null;
            if (descEl && descEl.style.display !== 'none') {
              totalHeight += descEl.getBoundingClientRect().height;
            }
          }
          midY = rect.top + totalHeight / 2;
        } else {
          midY = rect.top + rect.height / 2;
        }
      } else {
        midY = rect.top + rect.height / 2;
      }

      if (clientY < midY) {
        if (isDraggingSection && !item.classList.contains('section-header')) {
          continue;
        }
        targetItem = item;
        break;
      }
    }

    if (targetItem && targetItem !== dragState.placeholder.nextElementSibling) {
      todoList.insertBefore(dragState.placeholder, targetItem);
    } else if (!targetItem && dragState.placeholder.nextElementSibling) {
      todoList.appendChild(dragState.placeholder);
    }
  }

  // Shared drop logic
  function handleDragEnd() {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    stopAutoScroll();
    dragState.clone.remove();

    const todos = loadTodos();
    const isDraggingSection = !!dragState.isSection;
    const draggedItem = todos.find(t => t.id === dragState.id);
    if (!draggedItem) {
      cleanup(dragState);
      return;
    }

    const todoList = document.getElementById('todoList');
    if (!todoList) {
      cleanup(dragState);
      return;
    }

    if (isDraggingSection) {
      const parentId = draggedItem.parentId || null;
      const siblings = getSiblings(todos, parentId).filter(t => !t.archived && t.id !== dragState.id);

      const allChildren = Array.from(todoList.children) as HTMLElement[];
      const placeholderIdx = allChildren.indexOf(dragState.placeholder);
      let targetSiblingId: string | null = null;

      for (let i = placeholderIdx + 1; i < allChildren.length; i++) {
        const el = allChildren[i];
        const id = el.dataset?.id;
        if (id && siblings.some(s => s.id === id)) {
          targetSiblingId = id;
          break;
        }
      }

      let newPosition: string;
      if (targetSiblingId) {
        const targetIdx = siblings.findIndex(s => s.id === targetSiblingId);
        const before = targetIdx > 0 ? siblings[targetIdx - 1].position : null;
        const after = siblings[targetIdx].position;
        newPosition = generatePositionBetween(before, after);
      } else {
        const lastPos = siblings.length > 0 ? siblings[siblings.length - 1].position : null;
        newPosition = generatePositionBetween(lastPos, null);
      }

      window.EventLog.emitFieldChanged(dragState.id, 'position', newPosition);
    } else {
      const allChildren = Array.from(todoList.children) as HTMLElement[];
      const placeholderIdx = allChildren.indexOf(dragState.placeholder);

      let targetId: string | null = null;
      for (let i = placeholderIdx + 1; i < allChildren.length; i++) {
        const el = allChildren[i];
        if (el.dataset?.id && el.dataset.id !== dragState.id) {
          targetId = el.dataset.id;
          break;
        }
      }

      let prevId: string | null = null;
      for (let i = placeholderIdx - 1; i >= 0; i--) {
        const el = allChildren[i];
        if (el.dataset?.id && el.dataset.id !== dragState.id) {
          prevId = el.dataset.id;
          break;
        }
      }

      let newParentId: string | null = null;
      if (targetId) {
        const targetItem = todos.find(t => t.id === targetId);
        if (targetItem) {
          newParentId = targetItem.parentId || null;
        }
      } else if (prevId) {
        const prevItem = todos.find(t => t.id === prevId);
        if (prevItem) {
          newParentId = prevItem.parentId || null;
        }
      }

      const newSiblings = getSiblings(todos, newParentId).filter(t => t.id !== dragState.id);
      let newPosition: string;

      if (targetId) {
        const targetIdx = newSiblings.findIndex(t => t.id === targetId);
        if (targetIdx >= 0) {
          const before = targetIdx > 0 ? newSiblings[targetIdx - 1].position : null;
          const after = newSiblings[targetIdx].position;
          newPosition = generatePositionBetween(before, after);
        } else {
          const lastPos = newSiblings.length > 0 ? newSiblings[newSiblings.length - 1].position : null;
          newPosition = generatePositionBetween(lastPos, null);
        }
      } else {
        const lastPos = newSiblings.length > 0 ? newSiblings[newSiblings.length - 1].position : null;
        newPosition = generatePositionBetween(lastPos, null);
      }

      const events: Array<{ itemId: string; field: string; value: unknown }> = [
        { itemId: dragState.id, field: 'position', value: newPosition },
      ];
      if ((draggedItem.parentId || null) !== newParentId) {
        events.push({ itemId: dragState.id, field: 'parentId', value: newParentId });
      }
      window.EventLog.emitFieldsChanged(events);
    }

    cleanup(dragState);
    notifyStateChange();
  }

  function cleanup(dragState: DragState) {
    if (dragState.isSection) {
      dragState.placeholder.remove();
      dragState.originalElements?.forEach(el => { el.style.display = ''; });
    } else {
      dragState.placeholder.classList.remove('placeholder');
    }
    // Restore text selection
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    dragStateRef.current = null;
  }

  useEffect(() => {
    // Mouse handlers
    const handleMouseMove = (e: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.isTouch) return;
      handleDragMove(e.clientY);
    };

    const handleMouseUp = () => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.isTouch) return;
      handleDragEnd();
    };

    // Touch handlers
    const handleTouchMove = (e: TouchEvent) => {
      // Cancel long-press if finger moves too much
      if (longPressRef.current) {
        const touch = e.touches[0];
        const dx = touch.clientX - longPressRef.current.startX;
        const dy = touch.clientY - longPressRef.current.startY;
        if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD) {
          cancelLongPress();
        }
      }

      const dragState = dragStateRef.current;
      if (!dragState || !dragState.isTouch) return;

      e.preventDefault();
      const touch = e.touches[0];
      handleDragMove(touch.clientY);
      startAutoScroll(touch.clientY);
    };

    const handleTouchEnd = () => {
      cancelLongPress();

      const dragState = dragStateRef.current;
      if (!dragState || !dragState.isTouch) return;
      handleDragEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
      stopAutoScroll();
    };
  }, []);

  return { startItemDrag, startSectionDrag, handleTouchStartForDrag, cancelLongPress, isDragActive };
}
