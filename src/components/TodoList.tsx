import React from 'react';
import type { TodoItem as TodoItemType, ViewMode } from '../types';
import { formatDayHeader, getDayKey } from '../utils';
import { TodoItemComponent } from './TodoItem';
import { SectionItemComponent } from './SectionItem';
import type { TodoActions } from '../hooks/useTodoActions';

interface TodoListProps {
  todos: TodoItemType[];
  viewMode: ViewMode;
  now: number;
  actions: TodoActions;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, div: HTMLElement, textEl: HTMLElement, itemId: string) => boolean;
  onItemDragStart: (e: React.MouseEvent, itemId: string, div: HTMLElement) => void;
  onSectionDragStart: (e: React.MouseEvent, sectionId: string, div: HTMLElement) => void;
}

export function TodoList({
  todos,
  viewMode,
  now,
  actions,
  onKeyDown,
  onItemDragStart,
  onSectionDragStart,
}: TodoListProps) {
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
              />
            ))}
          </React.Fragment>
        ))}
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
          />
        )
      )}
    </div>
  );
}
