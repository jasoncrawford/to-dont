import type { TodoItem } from './types';
import { generatePositionBetween as _generatePositionBetween } from './lib/fractional-index.js';

export const FADE_DURATION_DAYS = 14;
export const IMPORTANT_ESCALATION_DAYS = 14;
export const UPDATE_INTERVAL = 60000;
export const SAVE_DEBOUNCE_MS = 300;

// Match arrow patterns: ->, -->, --->, or Unicode arrows like →, ➔, ⟶, etc.
const ARROW_PATTERN = /-+>|[→➔➜➝➞⟶⇒⇨]/;

export function getDaysSince(timestamp: number, now: number): number {
  return (now - timestamp) / (1000 * 60 * 60 * 24);
}

export function formatDate(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const isToday = date.toDateString() === nowDate.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDayHeader(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function getDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function getFadeOpacity(timestamp: number, now: number): number {
  const progress = Math.min(getDaysSince(timestamp, now) / FADE_DURATION_DAYS, 1);
  return 1 - progress;
}

export function getImportanceLevel(timestamp: number, now: number): number {
  const progress = getDaysSince(timestamp, now) / IMPORTANT_ESCALATION_DAYS;
  return Math.min(Math.floor(progress * 5) + 1, 5);
}

export function shouldArchive(todo: TodoItem, now: number): boolean {
  if (todo.type === 'section') return false;
  if (todo.important || todo.completed || todo.archived) return false;
  return getDaysSince(todo.createdAt, now) >= FADE_DURATION_DAYS;
}

export function setCursorPosition(el: HTMLElement, pos: number): void {
  const textNode = el.firstChild;
  if (!textNode) {
    el.focus();
    return;
  }
  const maxPos = (textNode as Text).length || 0;
  const targetPos = Math.min(pos, maxPos);
  const range = document.createRange();
  range.setStart(textNode, targetPos);
  range.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function generatePositionBetween(before: string | null, after: string | null): string {
  return _generatePositionBetween(before, after);
}

export function getItemPosition(todos: TodoItem[], index: number): string | null {
  if (index < 0 || index >= todos.length) return null;
  return todos[index].position || 'n';
}

export function createNewItem(text: string = '', insertIndex: number = -1, todos: TodoItem[] | null = null): TodoItem {
  const now = window.getVirtualNow();
  let position = 'n';

  if (todos && insertIndex >= 0) {
    const before = insertIndex > 0 ? getItemPosition(todos, insertIndex - 1) : null;
    const after = insertIndex < todos.length ? getItemPosition(todos, insertIndex) : null;
    position = generatePositionBetween(before, after);
  }

  return {
    id: generateId(),
    text: text.trim(),
    createdAt: now,
    important: false,
    completed: false,
    archived: false,
    position: position,
    textUpdatedAt: now,
    importantUpdatedAt: now,
    completedUpdatedAt: now,
    positionUpdatedAt: now,
    typeUpdatedAt: now,
    levelUpdatedAt: now,
    indentedUpdatedAt: now,
  };
}

// Get the group of items that belong under a section
export function getItemGroup(todos: TodoItem[], startIndex: number): number[] {
  const item = todos[startIndex];
  if (!item) return [];

  if (item.type !== 'section') {
    return [startIndex];
  }

  const indices = [startIndex];
  const level = item.level || 2;

  for (let i = startIndex + 1; i < todos.length; i++) {
    const next = todos[i];
    if (next.archived) continue;

    if (next.type === 'section') {
      const nextLevel = next.level || 2;
      if (level === 1 && nextLevel === 1) break;
      if (level === 2) break;
    }

    indices.push(i);
  }

  return indices;
}

export function splitOnArrow(text: string): { before: string; after: string } | null {
  const match = text.match(ARROW_PATTERN);
  if (!match) return null;

  const arrowIndex = match.index!;
  const arrowLength = match[0].length;
  const before = text.substring(0, arrowIndex).trim();
  const after = text.substring(arrowIndex + arrowLength).trim();

  if (!before || !after) return null;
  return { before, after };
}
