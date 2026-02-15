import { useSyncExternalStore, useEffect, useState } from 'react';
import type { TodoItem, ViewMode } from './types';

// In-memory cache for parsed todos
let _todosCacheJson: string | null = null;
let _todosCacheParsed: TodoItem[] | null = null;

let _listeners: Set<() => void> = new Set();
let _stateVersion = 0;

export function loadTodos(): TodoItem[] {
  const data = localStorage.getItem('decay-todos');
  if (!data) {
    _todosCacheJson = null;
    _todosCacheParsed = null;
    return [];
  }
  if (_todosCacheJson !== null && data === _todosCacheJson && _todosCacheParsed !== null) {
    return _todosCacheParsed.slice();
  }
  _todosCacheJson = data;
  _todosCacheParsed = JSON.parse(data);
  return _todosCacheParsed!.slice();
}

export function saveTodos(todos: TodoItem[]): void {
  const json = JSON.stringify(todos);
  localStorage.setItem('decay-todos', json);
  _todosCacheJson = json;
  _todosCacheParsed = todos;
  if (window.ToDoSync && window.ToDoSync.onSave) {
    window.ToDoSync.onSave(todos);
  }
}

export function invalidateTodoCache(): void {
  _todosCacheJson = null;
  _todosCacheParsed = null;
}

export function notifyStateChange(): void {
  _stateVersion++;
  _listeners.forEach(cb => cb());
}

function subscribe(callback: () => void): () => void {
  _listeners.add(callback);
  return () => { _listeners.delete(callback); };
}

function getSnapshot(): number {
  return _stateVersion;
}

export function useStateVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// View mode store
let _viewMode: ViewMode = (localStorage.getItem('decay-todos-view-mode') as ViewMode) || 'active';
// Migration
if (_viewMode === 'custom' as string || _viewMode === 'auto' as string) {
  _viewMode = 'active';
  localStorage.setItem('decay-todos-view-mode', _viewMode);
}

let _viewListeners: Set<() => void> = new Set();
let _viewVersion = 0;

export function getViewMode(): ViewMode {
  return _viewMode;
}

export function setViewMode(mode: ViewMode): void {
  _viewMode = mode;
  localStorage.setItem('decay-todos-view-mode', mode);
  _viewVersion++;
  _viewListeners.forEach(cb => cb());
}

export function useViewMode(): ViewMode {
  useSyncExternalStore(
    (cb) => { _viewListeners.add(cb); return () => { _viewListeners.delete(cb); }; },
    () => _viewVersion,
  );
  return _viewMode;
}

// Sync status store
export type SyncState = 'synced' | 'syncing' | 'error' | 'reconnecting' | 'offline' | 'disabled';

export interface SyncStatus {
  state: SyncState;
  retryCount?: number;
  maxRetries?: number;
  nextRetryMs?: number;
}

let _syncStatus: SyncStatus = { state: 'disabled' };
let _syncListeners: Set<() => void> = new Set();
let _syncVersion = 0;

export function initSyncStatusListener(): void {
  if (window.ToDoSync && window.ToDoSync.onStatusChange) {
    window.ToDoSync.onStatusChange((status: SyncStatus) => {
      _syncStatus = status;
      _syncVersion++;
      _syncListeners.forEach(cb => cb());
    });
    // Read initial status
    if (window.ToDoSync.getStatus) {
      _syncStatus = window.ToDoSync.getStatus() as SyncStatus;
    }
  }
}

export function useSyncStatus(): SyncStatus {
  useSyncExternalStore(
    (cb) => { _syncListeners.add(cb); return () => { _syncListeners.delete(cb); }; },
    () => _syncVersion,
  );
  return _syncStatus;
}
