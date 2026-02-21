// Import order matters: compat sets window globals, then libs read them
import './compat';
import './lib/fractional-index.js';
import './lib/event-log.js';
import './lib/sync.js';

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSyncStatusListener, initAuthListener } from './store';

initSyncStatusListener();
initAuthListener();

// DEBUG: Track all focus changes and keyboard events
document.addEventListener('focusin', (e) => {
  const t = e.target as HTMLElement;
  const desc = `${t.tagName}.${t.className}${t.id ? '#' + t.id : ''}`;
  const inTodo = !!t.closest('.todo-item');
  const inNew = !!t.closest('.new-item');
  console.log('[focusin]', desc, inTodo ? '(todo)' : inNew ? '(new-item)' : '(other)');
}, true);
document.addEventListener('focusout', (e) => {
  const t = e.target as HTMLElement;
  const desc = `${t.tagName}.${t.className}${t.id ? '#' + t.id : ''}`;
  const related = (e as FocusEvent).relatedTarget as HTMLElement | null;
  const relDesc = related ? `${related.tagName}.${related.className}${related.id ? '#' + related.id : ''}` : 'null';
  console.log('[focusout]', desc, '→', relDesc);
}, true);
// Track ALL keydown events at document level (captures before React)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target as HTMLElement;
  const desc = `${t.tagName}.${t.className}${t.id ? '#' + t.id : ''}`;
  const inTodo = !!t.closest('.todo-item');
  const inNew = !!t.closest('.new-item');
  const sel = window.getSelection();
  console.log('[doc keydown Enter]', {
    target: desc,
    inTodo,
    inNew,
    activeElement: document.activeElement === t,
    selRangeCount: sel?.rangeCount,
    selCollapsed: sel?.isCollapsed,
    selAnchorInTarget: sel?.anchorNode ? t.contains(sel.anchorNode) : false,
    contentEditable: t.contentEditable,
    isTrusted: e.isTrusted,
  });
}, true);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
