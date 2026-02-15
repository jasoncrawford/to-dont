import React from 'react';
import { useViewMode, setViewMode } from '../store';

export function ViewToggle() {
  const viewMode = useViewMode();

  return (
    <div id="viewToggle" className="view-tabs">
      <button
        id="activeViewBtn"
        className={`view-tab${viewMode === 'active' ? ' active' : ''}`}
        onClick={() => setViewMode('active')}
      >
        Active
      </button>
      <button
        id="doneViewBtn"
        className={`view-tab${viewMode === 'done' ? ' active' : ''}`}
        onClick={() => setViewMode('done')}
      >
        Done
      </button>
    </div>
  );
}
