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

// DEBUG: Track all focus changes
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

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
