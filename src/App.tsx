import React, { useEffect, useCallback } from 'react';
import { loadTodos, useStateVersion, useViewMode, useAuthState } from './store';
import { UPDATE_INTERVAL } from './utils';
import { useFocusManager } from './hooks/useFocusManager';
import { useTodoActions } from './hooks/useTodoActions';
import { useCommonKeydown } from './hooks/useKeyboardNav';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useSwipeToReveal } from './hooks/useSwipeToReveal';
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
  const { startItemDrag, startSectionDrag, handleTouchStartForDrag, cancelLongPress, isDragActive } = useDragAndDrop();
  const { getSwipedItemId, bindSwipeTarget, closeSwipe } = useSwipeToReveal();

  // NewItemInput Enter: create the typed item, then an empty line after it
  const handleNewItemAdd = useCallback((text: string) => {
    const newId = actions.addTodo(text);
    if (newId) actions.insertTodoAfter(newId);
  }, [actions]);

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

  // Archive old items after each render
  useEffect(() => {
    actions.archiveOldItems();
  });

  // Auth gate: if sync is configured and user not authenticated, show login
  const syncConfigured = !!getSupabaseClient();
  if (syncConfigured && authState === 'loading') {
    return null; // Brief flash while checking session
  }
  if (syncConfigured && authState === 'unauthenticated') {
    return <Login />;
  }

  // Read state
  const todos = loadTodos();
  const now = window.getVirtualNow();

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
            className="archive-completed-btn"
            disabled={!hasCompletedItems}
            style={{ opacity: hasCompletedItems ? 1 : 0.4 }}
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
        touchProps={{
          handleTouchStartForDrag,
          cancelLongPress,
          isDragActive,
          getSwipedItemId,
          bindSwipeTarget,
          closeSwipe,
        }}
      />
      {viewMode === 'important' && (
        <NewItemInput
          visible={importantItems.length === 0}
          onAdd={handleNewItemAdd}
        />
      )}
      {viewMode === 'active' && (
        <NewItemInput
          visible={activeItems.length === 0}
          onAdd={handleNewItemAdd}
        />
      )}
      <TestModePanel />
    </>
  );
}
