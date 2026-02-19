import { describe, test, expect } from 'vitest';
import { computeSyncStatus, type SyncStatusInput } from '../../src/lib/sync-status';

const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 60000;
const MAX_RETRIES = 5;

function defaults(overrides: Partial<SyncStatusInput> = {}): SyncStatusInput {
  return {
    isConfigured: true,
    isOnline: true,
    syncEnabled: true,
    realtimeConnected: true,
    isSyncing: false,
    syncPending: false,
    retryCount: 0,
    lastSyncOk: false,
    maxRetries: MAX_RETRIES,
    baseRetryMs: BASE_RETRY_MS,
    maxRetryMs: MAX_RETRY_MS,
    ...overrides,
  };
}

describe('computeSyncStatus', () => {
  test('returns error when sync is not configured', () => {
    const status = computeSyncStatus(defaults({ isConfigured: false }));
    expect(status.state).toBe('error');
    expect(status.message).toBe('Sync not configured');
  });

  test('returns synced when enabled with realtime connected', () => {
    const status = computeSyncStatus(defaults());
    expect(status.state).toBe('synced');
  });

  test('returns syncing when isSyncing is true', () => {
    const status = computeSyncStatus(defaults({ isSyncing: true }));
    expect(status.state).toBe('syncing');
  });

  test('returns syncing when syncPending is true', () => {
    const status = computeSyncStatus(defaults({ syncPending: true }));
    expect(status.state).toBe('syncing');
  });

  test('returns error when retryCount > 0 and not syncing', () => {
    const status = computeSyncStatus(defaults({ retryCount: 2 }));
    expect(status.state).toBe('error');
    expect(status.retryCount).toBe(2);
    expect(status.maxRetries).toBe(MAX_RETRIES);
    expect(status.nextRetryMs).toBe(BASE_RETRY_MS * 2); // 2^(2-1) * 5000
  });

  test('returns reconnecting when realtime disconnected and no successful sync', () => {
    const status = computeSyncStatus(defaults({ realtimeConnected: false }));
    expect(status.state).toBe('reconnecting');
  });

  test('returns synced after sleep/wake: realtime disconnected but last sync succeeded', () => {
    const status = computeSyncStatus(defaults({
      realtimeConnected: false,
      lastSyncOk: true,
    }));
    expect(status.state).toBe('synced');
  });

  test('returns offline when navigator is offline', () => {
    const status = computeSyncStatus(defaults({ isOnline: false }));
    expect(status.state).toBe('offline');
  });

  // Priority tests
  test('offline takes priority over everything else', () => {
    const status = computeSyncStatus(defaults({
      isOnline: false,
      retryCount: 3,
      realtimeConnected: false,
    }));
    expect(status.state).toBe('offline');
  });

  test('error takes priority over reconnecting', () => {
    const status = computeSyncStatus(defaults({
      retryCount: 1,
      realtimeConnected: false,
    }));
    expect(status.state).toBe('error');
  });

  test('not-configured takes priority over offline', () => {
    const status = computeSyncStatus(defaults({
      isConfigured: false,
      isOnline: false,
    }));
    expect(status.state).toBe('error');
    expect(status.message).toBe('Sync not configured');
  });

  test('error clears to syncing when sync cycle starts (isSyncing overrides retryCount)', () => {
    const status = computeSyncStatus(defaults({
      retryCount: 3,
      isSyncing: true,
    }));
    expect(status.state).toBe('syncing');
  });

  test('reconnecting shows when sync disabled does not apply', () => {
    // syncEnabled: false means the reconnecting check is skipped
    const status = computeSyncStatus(defaults({
      syncEnabled: false,
      realtimeConnected: false,
    }));
    expect(status.state).toBe('synced');
  });

  // Retry delay calculation
  test('retry delay uses exponential backoff', () => {
    const status1 = computeSyncStatus(defaults({ retryCount: 1 }));
    expect(status1.nextRetryMs).toBe(BASE_RETRY_MS); // 5000 * 2^0

    const status2 = computeSyncStatus(defaults({ retryCount: 3 }));
    expect(status2.nextRetryMs).toBe(BASE_RETRY_MS * 4); // 5000 * 2^2

    const status5 = computeSyncStatus(defaults({ retryCount: 5 }));
    expect(status5.nextRetryMs).toBe(MAX_RETRY_MS); // capped at 60000
  });
});
