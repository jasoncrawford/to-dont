import type { ViewMode } from '../types';
import type { PendingFocus } from '../hooks/useFocusManager';
import { setViewMode } from '../store';
import { notifyStateChange } from '../store';

export interface UndoEntry {
  addedEventIds: string[];
  addedEvents: unknown[];
  beforeViewMode: ViewMode;
  beforeFocus: PendingFocus | null;
  afterViewMode: ViewMode;
  afterFocus: PendingFocus | null;
}

const MAX_STACK_SIZE = 100;

let undoStack: UndoEntry[] = [];
let redoStack: UndoEntry[] = [];

// Grouping support: when grouping, pushUndo collects into a temporary buffer
let _groupBuffer: UndoEntry[] | null = null;

// Flag to suppress event emission during undo/redo (checked by blur handlers)
let _suppressSaves = false;

export function isSaveSuppressed(): boolean {
  return _suppressSaves;
}

export function pushUndo(entry: UndoEntry): void {
  if (_groupBuffer !== null) {
    _groupBuffer.push(entry);
    return;
  }
  undoStack.push(entry);
  if (undoStack.length > MAX_STACK_SIZE) {
    undoStack.shift();
  }
  redoStack = [];
}

export function beginGroup(): void {
  _groupBuffer = [];
}

export function endGroup(): void {
  const buffer = _groupBuffer;
  _groupBuffer = null;
  if (!buffer || buffer.length === 0) return;

  // Merge all buffered entries into one
  const merged: UndoEntry = {
    addedEventIds: buffer.flatMap(e => e.addedEventIds),
    addedEvents: buffer.flatMap(e => e.addedEvents),
    beforeViewMode: buffer[0].beforeViewMode,
    beforeFocus: buffer[0].beforeFocus,
    afterViewMode: buffer[buffer.length - 1].afterViewMode,
    afterFocus: buffer[buffer.length - 1].afterFocus,
  };
  undoStack.push(merged);
  if (undoStack.length > MAX_STACK_SIZE) {
    undoStack.shift();
  }
  redoStack = [];
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function performUndo(pendingFocusRef: React.RefObject<PendingFocus | null>): void {
  if (undoStack.length === 0) return;
  const entry = undoStack.pop()!;

  // Suppress saves so blur handlers during re-render don't emit events
  _suppressSaves = true;

  // Blur the active element before changing state, so layout effects can update text
  const active = document.activeElement as HTMLElement | null;
  if (active && active.isContentEditable) {
    active.blur();
  }

  // Remove the events from the log
  window.EventLog.removeEventsByIds(entry.addedEventIds);

  // Push to redo stack
  redoStack.push(entry);

  // Restore view mode and focus
  setViewMode(entry.beforeViewMode);
  if (entry.beforeFocus) {
    pendingFocusRef.current = entry.beforeFocus;
  }
  notifyStateChange();

  // Allow saves again after paint (after React commits + layout effects)
  requestAnimationFrame(() => { _suppressSaves = false; });
}

export function performRedo(pendingFocusRef: React.RefObject<PendingFocus | null>): void {
  if (redoStack.length === 0) return;
  const entry = redoStack.pop()!;

  // Suppress saves so blur handlers during re-render don't emit events
  _suppressSaves = true;

  // Blur the active element before changing state, so layout effects can update text
  const active = document.activeElement as HTMLElement | null;
  if (active && active.isContentEditable) {
    active.blur();
  }

  // Re-append the events
  window.EventLog.reappendEvents(entry.addedEvents);

  // Push back to undo stack (without clearing redo)
  undoStack.push(entry);
  if (undoStack.length > MAX_STACK_SIZE) {
    undoStack.shift();
  }

  // Restore view mode and focus
  setViewMode(entry.afterViewMode);
  if (entry.afterFocus) {
    pendingFocusRef.current = entry.afterFocus;
  }
  notifyStateChange();

  // Allow saves again after paint (after React commits + layout effects)
  requestAnimationFrame(() => { _suppressSaves = false; });
}
