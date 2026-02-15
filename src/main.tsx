// Import order matters: compat sets window globals, then libs read them
import './compat';
import './lib/fractional-index.js';
import './lib/event-log.js';
import './lib/sync.js';

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
