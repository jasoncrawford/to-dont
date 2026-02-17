import React, { useEffect } from 'react';
import { loadTodos, useStateVersion, useViewMode, useAuthState } from './store';
import { UPDATE_INTERVAL } from './utils';
import { useFocusManager } from './hooks/useFocusManager';
import { useTodoActions } from './hooks/useTodoActions';
import { useCommonKeydown } from './hooks/useKeyboardNav';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { ViewToggle } from './components/ViewToggle';
import { TestModePanel } from './components/TestModePanel';
import { NewItemInput } from './components/NewItemInput';
import { TodoList } from './components/TodoList';
import { Login } from './components/Login';
import { getSupabaseClient } from './lib/supabase-client';

export default function App() {
  useStateVersion(); // subscribe to state changes
  const viewMode = useViewMode();
  const authState = useAuthState();
  const { pendingFocusRef } = useFocusManager();
  const actions = useTodoActions(pendingFocusRef, viewMode);
  const handleCommonKeydown = useCommonKeydown(actions);
  const { startItemDrag, startSectionDrag } = useDragAndDrop();

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

  // Auth gate: if sync is configured and user not authenticated, show login
  const syncConfigured = !!getSupabaseClient();
  if (syncConfigured && authState === 'loading') {
    return null; // Brief flash while checking session
  }
  if (syncConfigured && authState === 'unauthenticated') {
    return <Login />;
  }

  // Read state
  let todos = loadTodos();
  const now = window.getVirtualNow();

  // Archive old items (side effect on every render, same as old app.js)
  todos = actions.archiveOldItems(todos);

  // Compute derived data
  const activeItems = todos.filter(t => !t.archived);
  const importantItems = todos.filter(t => !t.archived && !t.completed && t.important && t.type !== 'section');
  const hasCompletedItems = todos.some(t => t.completed && !t.archived);

  return (
    <>
      <ViewToggle />
      {viewMode === 'active' && (
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
      {viewMode === 'important' && (
        <NewItemInput
          visible={importantItems.length === 0}
          onAdd={actions.addTodo}
        />
      )}
      {viewMode === 'active' && (
        <NewItemInput
          visible={activeItems.length === 0}
          onAdd={actions.addTodo}
        />
      )}
      <TestModePanel />
    </>
  );
}
