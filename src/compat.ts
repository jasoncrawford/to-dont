import { flushSync } from 'react-dom';
import { loadTodos, saveTodos, invalidateTodoCache, notifyStateChange } from './store';
import { generatePositionBetween } from './utils';
import { getSupabaseClient } from './lib/supabase-client';

// Vite compile-time constants (replaces sync-config.js)
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __SUPABASE_SCHEMA__: string;

// Check for test mode via URL parameter
const isTestMode = new URLSearchParams(window.location.search).get('test-mode') === '1';

// Sync config — set window globals that sync.js reads via getConfig()
// In test mode, skip so isSyncConfigured() returns false
if (!isTestMode) {
  window.SYNC_SUPABASE_URL = __SUPABASE_URL__;
  window.SYNC_SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
  window.SYNC_SUPABASE_SCHEMA = __SUPABASE_SCHEMA__;
  window.SYNC_API_URL = window.location.origin;
  if (window.SYNC_SUPABASE_URL) {
    console.log('[Sync Config] Credentials loaded for', window.SYNC_SUPABASE_URL);
  }
}

// Test mode: virtual time offset in days (persisted)
let timeOffsetDays = isTestMode ? parseInt(localStorage.getItem('decay-todos-time-offset') || '0', 10) : 0;

export function getVirtualNow(): number {
  return Date.now() + (timeOffsetDays * 24 * 60 * 60 * 1000);
}

export function getTimeOffsetDays(): number {
  return timeOffsetDays;
}

export function setTimeOffsetDays(days: number): void {
  timeOffsetDays = days;
  localStorage.setItem('decay-todos-time-offset', days.toString());
}

export function getIsTestMode(): boolean {
  return isTestMode;
}

// Check for reset via URL parameter — clears all app data and reloads
if (new URLSearchParams(window.location.search).get('reset') === '1') {
  if (confirm('This will delete all local data. Are you sure?')) {
    ['decay-todos', 'decay-events', 'decay-client-id', 'decay-event-cursor',
     'decay-todos-time-offset', 'decay-todos-view-mode'].forEach(k => localStorage.removeItem(k));
  }
  window.location.replace(window.location.pathname);
}

// Expose globals that sync.js, event-log.js, and tests depend on
window.loadTodos = loadTodos;
window.saveTodos = saveTodos;
window.invalidateTodoCache = invalidateTodoCache;
window.getVirtualNow = getVirtualNow;
// window.render() must be synchronous like old app.js — callers expect
// the DOM to be updated when the call returns.
window.render = () => {
  flushSync(() => {
    notifyStateChange();
  });
};
(window as any).generatePositionBetween = generatePositionBetween;
// Expose Supabase client for test access (e.g. signInWithPassword in sync-e2e tests)
(window as any).getSupabaseClient = getSupabaseClient;
