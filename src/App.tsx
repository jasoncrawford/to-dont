import React, { useEffect, useCallback } from 'react';
import { loadTodos, useStateVersion, useViewMode } from './store';
import { UPDATE_INTERVAL } from './utils';
import { useFocusManager } from './hooks/useFocusManager';
import { useTodoActions } from './hooks/useTodoActions';
import { useCommonKeydown } from './hooks/useKeyboardNav';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { ViewToggle } from './components/ViewToggle';
import { TestModePanel } from './components/TestModePanel';
import { NewItemInput } from './components/NewItemInput';
import { TodoList } from './components/TodoList';
import { TodoItemComponent } from './components/TodoItem';

export default function App() {
  useStateVersion(); // subscribe to state changes
  const viewMode = useViewMode();
  const { pendingFocusRef } = useFocusManager();
  const actions = useTodoActions(pendingFocusRef);
  const handleCommonKeydown = useCommonKeydown(actions);
  const { startItemDrag, startSectionDrag } = useDragAndDrop();

  // Read state
  let todos = loadTodos();
  const now = window.getVirtualNow();

  // Archive old items (side effect on every render, same as old app.js)
  todos = actions.archiveOldItems(todos);

  // Periodic re-render when not editing
  useEffect(() => {
    const interval = setInterval(() => {
      const activeEl = document.activeElement;
      const isEditing = activeEl && (activeEl as HTMLElement).classList.contains('text');
      if (!isEditing) {
        window.render();
      }
    }, UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Archive toggle handler
  const handleArchiveToggle = useCallback(() => {
    const list = document.getElementById('archiveList');
    const toggle = document.getElementById('archiveToggle');
    if (list && toggle) {
      list.classList.toggle('expanded');
      toggle.textContent = list.classList.contains('expanded')
        ? 'Faded away ▾'
        : 'Faded away ▸';
    }
  }, []);

  // Compute derived data
  const activeItems = todos.filter(t => !t.archived && !(t.completed && t.archived));
  const fadedAway = todos.filter(t => t.archived && !t.completed);
  const hasCompletedItems = todos.some(t => t.completed && !t.archived);

  return (
    <>
      <ViewToggle />
      {viewMode !== 'done' && (
        <div id="archiveCompletedContainer" style={{ marginBottom: 20, display: 'block' }}>
          <button
            id="archiveCompletedBtn"
            disabled={!hasCompletedItems}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              cursor: hasCompletedItems ? 'pointer' : 'default',
              border: '1px solid #ddd',
              background: 'white',
              borderRadius: 4,
              color: '#666',
              opacity: hasCompletedItems ? 1 : 0.4,
            }}
            onClick={actions.archiveCompleted}
          >
            Archive completed
          </button>
        </div>
      )}
      <TodoList
        todos={todos}
        viewMode={viewMode}
        now={now}
        actions={actions}
        onKeyDown={handleCommonKeydown}
        onItemDragStart={startItemDrag}
        onSectionDragStart={startSectionDrag}
      />
      {viewMode !== 'done' && (
        <NewItemInput
          visible={activeItems.length === 0}
          onAdd={actions.addTodo}
        />
      )}
      <TestModePanel />
      {viewMode !== 'done' && (
        <div id="archiveSection" style={{ display: fadedAway.length > 0 ? 'block' : 'none' }}>
          <div className="archive-header" id="archiveToggle" onClick={handleArchiveToggle}>
            Faded away ▸
          </div>
          <div className="archive-list" id="archiveList">
            {[...fadedAway]
              .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0))
              .map(todo => (
                <TodoItemComponent
                  key={todo.id}
                  todo={todo}
                  viewMode={viewMode}
                  now={now}
                  actions={actions}
                  onKeyDown={handleCommonKeydown}
                  onDragStart={startItemDrag}
                />
              ))}
          </div>
        </div>
      )}
    </>
  );
}
