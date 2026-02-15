import { useRef, useEffect, useCallback } from 'react';
import { loadTodos, notifyStateChange } from '../store';
import { getItemGroup, getItemPosition, generatePositionBetween } from '../utils';
import type { TodoItem } from '../types';

interface DragState {
  id: string;
  placeholder: HTMLElement;
  originalElements?: HTMLElement[];
  clone: HTMLElement;
  fixedX: number;
  offsetY: number;
  isSection?: boolean;
}

export function useDragAndDrop() {
  const dragStateRef = useRef<DragState | null>(null);

  const startItemDrag = useCallback((e: React.MouseEvent, itemId: string, div: HTMLElement) => {
    e.preventDefault();
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
      offsetY: e.clientY - rect.top,
    };
  }, []);

  const startSectionDrag = useCallback((e: React.MouseEvent, sectionId: string, div: HTMLElement) => {
    e.preventDefault();
    const rect = div.getBoundingClientRect();

    const todos = loadTodos();
    const sectionIndex = todos.findIndex(t => t.id === sectionId);
    const groupIndices = getItemGroup(todos, sectionIndex);
    const groupIds = groupIndices.map(i => todos[i].id);

    const groupElements: HTMLElement[] = [];
    groupIds.forEach(id => {
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
    cloneContainer.style.background = 'white';

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
      offsetY: e.clientY - rect.top,
      isSection: true,
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      dragState.clone.style.left = dragState.fixedX + 'px';
      dragState.clone.style.top = (e.clientY - dragState.offsetY) + 'px';

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
          const sectionIndex = todos.findIndex(t => t.id === itemId);
          if (sectionIndex !== -1) {
            const groupIndices = getItemGroup(todos, sectionIndex);
            let totalHeight = 0;
            for (const idx of groupIndices) {
              const groupItem = todoList.querySelector(`[data-id="${todos[idx].id}"]`) as HTMLElement | null;
              if (groupItem && groupItem.style.display !== 'none') {
                totalHeight += groupItem.getBoundingClientRect().height;
              }
            }
            midY = rect.top + totalHeight / 2;
          } else {
            midY = rect.top + rect.height / 2;
          }
        } else {
          midY = rect.top + rect.height / 2;
        }

        if (e.clientY < midY) {
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

    const handleMouseUp = () => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      dragState.clone.remove();

      const todos = loadTodos();
      const draggedIndex = todos.findIndex(t => t.id === dragState.id);
      const groupIndices = getItemGroup(todos, draggedIndex);
      const group = groupIndices.map(i => todos[i]);
      const isDraggingSection = !!dragState.isSection;

      const todoList = document.getElementById('todoList');
      if (!todoList) return;

      const allChildren = Array.from(todoList.children) as HTMLElement[];
      const placeholderDomIndex = allChildren.indexOf(dragState.placeholder);

      for (let i = groupIndices.length - 1; i >= 0; i--) {
        todos.splice(groupIndices[i], 1);
      }

      const draggedIds = group.map(t => t.id);
      const itemsBeforePlaceholder = allChildren.slice(0, placeholderDomIndex)
        .filter(el => el.dataset && el.dataset.id && !draggedIds.includes(el.dataset.id))
        .map(el => el.dataset.id!);

      let insertAt = 0;
      if (itemsBeforePlaceholder.length > 0) {
        const lastBeforeId = itemsBeforePlaceholder[itemsBeforePlaceholder.length - 1];
        const lastBeforeIndex = todos.findIndex(t => t.id === lastBeforeId);

        if (isDraggingSection) {
          const lastBeforeItem = todos[lastBeforeIndex];
          if (lastBeforeItem && lastBeforeItem.type === 'section') {
            const prevGroupIndices = getItemGroup(todos, lastBeforeIndex);
            insertAt = prevGroupIndices[prevGroupIndices.length - 1] + 1;
          } else if (lastBeforeItem) {
            insertAt = lastBeforeIndex + 1;
          }
        } else {
          insertAt = lastBeforeIndex + 1;
        }
      }

      const before = insertAt > 0 ? getItemPosition(todos, insertAt - 1) : null;
      const after = insertAt < todos.length ? getItemPosition(todos, insertAt) : null;
      let lastPos = before;
      const positionChanges: Array<{ itemId: string; field: string; value: string }> = [];
      group.forEach((item, i) => {
        const nextPos = i === group.length - 1 ? after : null;
        const newPos = generatePositionBetween(lastPos, nextPos || after);
        positionChanges.push({ itemId: item.id, field: 'position', value: newPos });
        item.position = newPos;
        lastPos = newPos;
      });

      window.EventLog.emitFieldsChanged(positionChanges);

      // Clean up
      if (dragState.isSection) {
        dragState.placeholder.remove();
        dragState.originalElements?.forEach(el => { el.style.display = ''; });
      } else {
        dragState.placeholder.classList.remove('placeholder');
      }
      dragStateRef.current = null;
      notifyStateChange();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return { startItemDrag, startSectionDrag };
}
