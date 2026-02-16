import React from 'react';
import { useViewMode, setViewMode } from '../store';
import { SyncStatus } from './SyncStatus';

export function ViewToggle() {
  const viewMode = useViewMode();

  return (
    <div id="viewToggle" className="view-tabs">
      <div className="view-tabs-left">
        <button
          id="activeViewBtn"
          className={`view-tab${viewMode === 'active' ? ' active' : ''}`}
          onClick={() => setViewMode('active')}
        >
          Active
        </button>
        <button
          id="fadedViewBtn"
          className={`view-tab${viewMode === 'faded' ? ' active' : ''}`}
          onClick={() => setViewMode('faded')}
        >
          Faded
        </button>
        <button
          id="doneViewBtn"
          className={`view-tab${viewMode === 'done' ? ' active' : ''}`}
          onClick={() => setViewMode('done')}
        >
          Done
        </button>
      </div>
      <SyncStatus />
    </div>
  );
}
