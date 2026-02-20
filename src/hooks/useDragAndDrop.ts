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

export function useDragAndDrop() {
  const dragStateRef = useRef<DragState | null>(null);

  const startItemDrag = useCallback((e: React.MouseEvent | React.TouchEvent, itemId: string, div: HTMLElement) => {
    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const isTouch = 'touches' in e;
    const rect = div.getBoundingClientRect();

    const clone = div.cloneNode(true) as HTMLElement;
    clone.classList.add('drag-clone');
    clone.style.width = rect.width + 'px';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    document.body.appendChild(clone);

    div.classList.add('placeholder');

    dragStateRef.current = {
      id: itemId,
      placeholder: div,
      clone: clone,
      fixedX: rect.left,
      offsetY: clientY - rect.top,
      isTouch,
    };
  }, []);

  const startSectionDrag = useCallback((e: React.MouseEvent | React.TouchEvent, sectionId: string, div: HTMLElement) => {
    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const isTouch = 'touches' in e;
    const rect = div.getBoundingClientRect();

    const todos = loadTodos();
    // Get all descendants via parentId tree
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

    const cloneContainer = document.createElement('div');
    cloneContainer.className = 'drag-clone-container';
    cloneContainer.style.position = 'fixed';
    cloneContainer.style.left = rect.left + 'px';
    cloneContainer.style.top = rect.top + 'px';
    cloneContainer.style.zIndex = '1000';
    cloneContainer.style.pointerEvents = 'none';
    cloneContainer.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim();

    groupElements.forEach(el => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.opacity = '0.95';
      cloneContainer.appendChild(clone);
      el.style.display = 'none';
    });

    document.body.appendChild(cloneContainer);

    dragStateRef.current = {
      id: sectionId,
      placeholder: placeholderContainer,
      originalElements: groupElements,
      clone: cloneContainer,
      fixedX: rect.left,
      offsetY: clientY - rect.top,
      isSection: true,
      isTouch,
    };
  }, []);

  useEffect(() => {
    const handleDragMove = (clientY: number) => {
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
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current || dragStateRef.current.isTouch) return;
      handleDragMove(e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragStateRef.current || !dragStateRef.current.isTouch) return;
      e.preventDefault(); // Prevent scrolling while dragging
      handleDragMove(e.touches[0].clientY);
    };

    const handleDragEnd = () => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

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
        // Section drag: only change the section's position among its siblings
        const parentId = draggedItem.parentId || null;
        const siblings = getSiblings(todos, parentId).filter(t => !t.archived && t.id !== dragState.id);

        // Find which sibling the placeholder is before in the DOM
        const allChildren = Array.from(todoList.children) as HTMLElement[];
        const placeholderIdx = allChildren.indexOf(dragState.placeholder);
        let targetSiblingId: string | null = null;

        // Look forward from placeholder to find the next sibling section
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
          // Insert before this sibling
          const targetIdx = siblings.findIndex(s => s.id === targetSiblingId);
          const before = targetIdx > 0 ? siblings[targetIdx - 1].position : null;
          const after = siblings[targetIdx].position;
          newPosition = generatePositionBetween(before, after);
        } else {
          // Insert at end
          const lastPos = siblings.length > 0 ? siblings[siblings.length - 1].position : null;
          newPosition = generatePositionBetween(lastPos, null);
        }

        window.EventLog.emitFieldChanged(dragState.id, 'position', newPosition);
      } else {
        // Item drag: determine new parentId and position from drop target
        const allChildren = Array.from(todoList.children) as HTMLElement[];
        const placeholderIdx = allChildren.indexOf(dragState.placeholder);

        // Find the item the placeholder is before
        let targetId: string | null = null;
        for (let i = placeholderIdx + 1; i < allChildren.length; i++) {
          const el = allChildren[i];
          if (el.dataset?.id && el.dataset.id !== dragState.id) {
            targetId = el.dataset.id;
            break;
          }
        }

        // Find the item the placeholder is after
        let prevId: string | null = null;
        for (let i = placeholderIdx - 1; i >= 0; i--) {
          const el = allChildren[i];
          if (el.dataset?.id && el.dataset.id !== dragState.id) {
            prevId = el.dataset.id;
            break;
          }
        }

        // Determine parentId: match the parent of the adjacent item
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

        // Calculate position among new siblings
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

      // Clean up
      cleanup(dragState);
      notifyStateChange();
    };

    function cleanup(dragState: DragState) {
      if (dragState.isSection) {
        dragState.placeholder.remove();
        dragState.originalElements?.forEach(el => { el.style.display = ''; });
      } else {
        dragState.placeholder.classList.remove('placeholder');
      }
      dragStateRef.current = null;
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);
    document.addEventListener('touchcancel', handleDragEnd);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleDragEnd);
      document.removeEventListener('touchcancel', handleDragEnd);
    };
  }, []);

  return { startItemDrag, startSectionDrag };
}
