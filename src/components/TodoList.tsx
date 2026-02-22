import React from 'react';
import type { TodoItem as TodoItemType, ViewMode } from '../types';
import { formatDayHeader, getDayKey } from '../utils';
import { TodoItemComponent } from './TodoItem';
import { SectionItemComponent } from './SectionItem';
import type { TodoActions } from '../hooks/useTodoActions';

export interface TouchProps {
  handleTouchStartForDrag: (itemId: string, div: HTMLElement, isSection: boolean, touch: { clientX: number; clientY: number }) => void;
  cancelLongPress: () => void;
  isDragActive: () => boolean;
  getSwipedItemId: () => string | null;
  bindSwipeTarget: (contentEl: HTMLElement | null, itemId: string) => void;
  closeSwipe: () => void;
}

interface TodoListProps {
  todos: TodoItemType[];
  viewMode: ViewMode;
  now: number;
  actions: TodoActions;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, div: HTMLElement, textEl: HTMLElement, itemId: string) => boolean;
  onItemDragStart: (e: React.MouseEvent, itemId: string, div: HTMLElement) => void;
  onSectionDragStart: (e: React.MouseEvent, sectionId: string, div: HTMLElement) => void;
  touchProps: TouchProps;
}

export function TodoList({
  todos,
  viewMode,
  now,
  actions,
  onKeyDown,
  onItemDragStart,
  onSectionDragStart,
  touchProps,
}: TodoListProps) {
  if (viewMode === 'faded') {
    // Faded view: archived but not completed items, sorted by archivedAt descending
    const fadedItems = todos
      .filter(t => t.archived && !t.completed)
      .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

    return (
      <div id="todoList" className="faded-view">
        {fadedItems.map(item => (
          <TodoItemComponent
            key={item.id}
            todo={item}
            viewMode={viewMode}
            now={now}
            actions={actions}
            onKeyDown={onKeyDown}
            onDragStart={onItemDragStart}
            touchProps={touchProps}
          />
        ))}
      </div>
    );
  }

  if (viewMode === 'done') {
    // Done view: completed items grouped by day
    const completedItems = todos
      .filter(t => t.completed && t.completedAt)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    const dayGroups = new Map<string, { timestamp: number; items: TodoItemType[] }>();
    completedItems.forEach(item => {
      const dayKey = getDayKey(item.completedAt!);
      if (!dayGroups.has(dayKey)) {
        dayGroups.set(dayKey, { timestamp: item.completedAt!, items: [] });
      }
      dayGroups.get(dayKey)!.items.push(item);
    });

    return (
      <div id="todoList" className="done-view">
        {Array.from(dayGroups.entries()).map(([dayKey, group]) => (
          <React.Fragment key={dayKey}>
            <div className="day-header">{formatDayHeader(group.timestamp, now)}</div>
            {group.items.map(item => (
              <TodoItemComponent
                key={item.id}
                todo={item}
                viewMode={viewMode}
                now={now}
                actions={actions}
                onKeyDown={onKeyDown}
                onDragStart={onItemDragStart}
                touchProps={touchProps}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    );
  }

  if (viewMode === 'important') {
    // Important view: non-archived important items, with section headers shown
    // only when they have important items under them
    const nonArchived = todos.filter(t => !t.archived);
    const importantItems: TodoItemType[] = [];
    let pendingL1: TodoItemType | null = null;
    let pendingL2: TodoItemType | null = null;

    for (const item of nonArchived) {
      if (item.type === 'section') {
        const level = item.level || 2;
        if (level === 1) {
          pendingL1 = item;
          pendingL2 = null;
        } else {
          pendingL2 = item;
        }
      } else if (item.important) {
        if (pendingL1) { importantItems.push(pendingL1); pendingL1 = null; }
        if (pendingL2) { importantItems.push(pendingL2); pendingL2 = null; }
        importantItems.push(item);
      }
    }

    return (
      <div id="todoList">
        {importantItems.map(item =>
          item.type === 'section' ? (
            <SectionItemComponent
              key={item.id}
              section={item}
              viewMode={viewMode}
              actions={actions}
              onKeyDown={onKeyDown}
              onDragStart={onSectionDragStart}
              touchProps={touchProps}
            />
          ) : (
            <TodoItemComponent
              key={item.id}
              todo={item}
              viewMode={viewMode}
              now={now}
              actions={actions}
              onKeyDown={onKeyDown}
              onDragStart={onItemDragStart}
              touchProps={touchProps}
            />
          )
        )}
      </div>
    );
  }

  // Active view
  const activeItems = todos.filter(t => !t.archived);

  return (
    <div id="todoList">
      {activeItems.map(item =>
        item.type === 'section' ? (
          <SectionItemComponent
            key={item.id}
            section={item}
            viewMode={viewMode}
            actions={actions}
            onKeyDown={onKeyDown}
            onDragStart={onSectionDragStart}
            touchProps={touchProps}
          />
        ) : (
          <TodoItemComponent
            key={item.id}
            todo={item}
            viewMode={viewMode}
            now={now}
            actions={actions}
            onKeyDown={onKeyDown}
            onDragStart={onItemDragStart}
            touchProps={touchProps}
          />
        )
      )}
    </div>
  );
}
