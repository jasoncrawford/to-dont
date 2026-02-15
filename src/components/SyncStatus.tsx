import React, { useEffect, useRef, useState } from 'react';
import { useSyncStatus, type SyncState } from '../store';

const SYNCING_DELAY_MS = 3000;
const LABEL_FADE_MS = 5000;

const DOT_COLORS: Record<SyncState, string> = {
  synced: '#4caf50',
  syncing: '#ffc107',
  error: '#f44336',
  reconnecting: '#9e9e9e',
  offline: '#9e9e9e',
  disabled: 'transparent',
};

const LABELS: Record<SyncState, string> = {
  synced: 'Synced',
  syncing: 'Syncing\u2026',
  error: 'Sync error',
  reconnecting: 'Reconnecting\u2026',
  offline: 'Offline',
  disabled: '',
};

export function SyncStatus() {
  const status = useSyncStatus();
  const [displayState, setDisplayState] = useState<SyncState>(status.state);
  const [labelFaded, setLabelFaded] = useState(false);
  const syncingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status.state === 'syncing' && displayState === 'synced') {
      // Delay showing yellow — only show if unsynced for >3s
      syncingTimer.current = setTimeout(() => {
        setDisplayState('syncing');
      }, SYNCING_DELAY_MS);
    } else if (status.state === 'synced') {
      // Clear any pending syncing timer and go straight to green
      if (syncingTimer.current) {
        clearTimeout(syncingTimer.current);
        syncingTimer.current = null;
      }
      setDisplayState('synced');
    } else {
      // Error, offline, disabled — show immediately
      if (syncingTimer.current) {
        clearTimeout(syncingTimer.current);
        syncingTimer.current = null;
      }
      setDisplayState(status.state);
    }

    return () => {
      if (syncingTimer.current) {
        clearTimeout(syncingTimer.current);
      }
    };
  }, [status.state]);

  useEffect(() => {
    if (displayState === 'synced') {
      fadeTimer.current = setTimeout(() => {
        setLabelFaded(true);
      }, LABEL_FADE_MS);
    } else {
      setLabelFaded(false);
    }
    return () => {
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
    };
  }, [displayState]);

  if (displayState === 'disabled') return null;

  const dotColor = DOT_COLORS[displayState];
  const label = LABELS[displayState];

  let detail: string | null = null;
  if (displayState === 'error' && status.retryCount != null) {
    detail = status.retryCount >= (status.maxRetries || 5)
      ? 'Retries exhausted'
      : `Retry ${status.retryCount}/${status.maxRetries} in ${Math.round((status.nextRetryMs || 0) / 1000)}s`;
  }

  return (
    <div className="sync-status">
      <span className="sync-dot" style={{ backgroundColor: dotColor }} />
      <span className={`sync-label${labelFaded ? ' faded' : ''}`}>{label}</span>
      {detail && <span className="sync-tooltip">{detail}</span>}
    </div>
  );
}
