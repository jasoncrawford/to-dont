// Pure sync status computation — no browser dependencies, easily unit testable.

export type SyncState = 'synced' | 'syncing' | 'error' | 'reconnecting' | 'offline';

export interface SyncStatus {
  state: SyncState;
  retryCount?: number;
  maxRetries?: number;
  nextRetryMs?: number;
  message?: string;
}

export interface SyncStatusInput {
  isConfigured: boolean;
  isOnline: boolean;
  syncEnabled: boolean;
  realtimeConnected: boolean;
  isSyncing: boolean;
  syncPending: boolean;
  retryCount: number;
  lastSyncOk: boolean;
  maxRetries: number;
  baseRetryMs: number;
  maxRetryMs: number;
}

export function computeSyncStatus(input: SyncStatusInput): SyncStatus {
  if (!input.isConfigured) return { state: 'error', message: 'Sync not configured' };
  if (!input.isOnline) return { state: 'offline' };
  if (input.retryCount > 0 && !input.isSyncing) {
    const delay = Math.min(input.baseRetryMs * Math.pow(2, input.retryCount - 1), input.maxRetryMs);
    return { state: 'error', retryCount: input.retryCount, maxRetries: input.maxRetries, nextRetryMs: delay };
  }
  if (input.syncEnabled && !input.realtimeConnected && !input.lastSyncOk) return { state: 'reconnecting' };
  if (input.isSyncing || input.syncPending) return { state: 'syncing' };
  return { state: 'synced' };
}
