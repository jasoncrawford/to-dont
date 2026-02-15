import { flushSync } from 'react-dom';
import { loadTodos, saveTodos, invalidateTodoCache, notifyStateChange } from './store';
import { generatePositionBetween } from './utils';

// Check for test mode via URL parameter
const isTestMode = new URLSearchParams(window.location.search).get('test-mode') === '1';

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
  ['decay-todos', 'decay-events', 'decay-client-id', 'decay-event-cursor',
   'decay-todos-time-offset', 'decay-todos-view-mode'].forEach(k => localStorage.removeItem(k));
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
