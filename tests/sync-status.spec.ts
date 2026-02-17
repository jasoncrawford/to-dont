import { test, expect } from '@playwright/test';
import { setupPage } from './helpers';

// Helper: set sync state and push notification to React
async function setSyncState(page: any, opts: {
  enabled?: boolean;
  syncing?: boolean;
  retryCount?: number;
  realtimeConnected?: boolean;
}) {
  await page.evaluate((o: any) => {
    const t = (window as any).ToDoSync._test;
    if (o.enabled !== undefined) t.setSyncEnabled(o.enabled);
    if (o.syncing !== undefined) t.setIsSyncing(o.syncing);
    if (o.retryCount !== undefined) t.setRetryCount(o.retryCount);
    if (o.realtimeConnected !== undefined) t.setRealtimeConnected(o.realtimeConnected);
    t.notifyStatus();
  }, opts);
}

// Helper: read the getStatus() result
async function getStatus(page: any) {
  return page.evaluate(() => (window as any).ToDoSync.getStatus());
}

test.describe('Sync Status - State Machine', () => {
  test('returns error when sync is not configured', async ({ page }) => {
    await setupPage(page);
    const status = await getStatus(page);
    expect(status.state).toBe('error');
    expect(status.message).toBe('Sync not configured');
  });

  test('returns synced when enabled with realtime connected', async ({ page }) => {
    await setupPage(page);
    // Simulate configured sync by setting window globals
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    await setSyncState(page, { enabled: true, realtimeConnected: true });
    const status = await getStatus(page);
    expect(status.state).toBe('synced');
  });

  test('returns syncing when isSyncing is true', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    await setSyncState(page, { enabled: true, syncing: true, realtimeConnected: true });
    const status = await getStatus(page);
    expect(status.state).toBe('syncing');
  });

  test('returns error when retryCount > 0', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    await setSyncState(page, { enabled: true, retryCount: 2, realtimeConnected: true });
    const status = await getStatus(page);
    expect(status.state).toBe('error');
    expect(status.retryCount).toBe(2);
    expect(status.maxRetries).toBe(5);
  });

  test('returns reconnecting when enabled but realtime not connected', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    await setSyncState(page, { enabled: true, realtimeConnected: false });
    const status = await getStatus(page);
    expect(status.state).toBe('reconnecting');
  });

  test('returns offline when navigator is offline', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    // Simulate going offline
    await page.context().setOffline(true);
    await setSyncState(page, { enabled: true, realtimeConnected: true });
    const status = await getStatus(page);
    expect(status.state).toBe('offline');
    await page.context().setOffline(false);
  });

  test('error takes priority over reconnecting', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    // Both retryCount > 0 and realtime disconnected
    await setSyncState(page, { enabled: true, retryCount: 1, realtimeConnected: false });
    const status = await getStatus(page);
    expect(status.state).toBe('error');
  });

  test('offline takes priority over error', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    await page.context().setOffline(true);
    await setSyncState(page, { enabled: true, retryCount: 3, realtimeConnected: false });
    const status = await getStatus(page);
    expect(status.state).toBe('offline');
    await page.context().setOffline(false);
  });

  test('error persists through new mutations until sync succeeds', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    // Put into error state
    await setSyncState(page, { enabled: true, retryCount: 3, realtimeConnected: true });
    let status = await getStatus(page);
    expect(status.state).toBe('error');

    // Simulate a new mutation triggering queueServerSync — retryCount should NOT reset
    await page.evaluate(() => {
      (window as any).ToDoSync.onEventsAppended([]);
    });
    status = await getStatus(page);
    expect(status.state).toBe('error');
    expect(status.retryCount).toBe(3);
  });

  test('error clears to syncing when sync cycle starts', async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
    // Error with retryCount > 0, then isSyncing = true
    await setSyncState(page, { enabled: true, retryCount: 3, syncing: true, realtimeConnected: true });
    const status = await getStatus(page);
    // isSyncing causes error check to be skipped, falls through to syncing
    expect(status.state).toBe('syncing');
  });
});

test.describe('Sync Status - UI Indicator', () => {
  // Helper to configure sync globals for UI tests
  async function configureSyncGlobals(page: any) {
    await page.evaluate(() => {
      (window as any).SYNC_SUPABASE_URL = 'http://test';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'test';

      (window as any).SYNC_API_URL = 'http://test';
    });
  }

  test('shows red error indicator when sync is not configured', async ({ page }) => {
    await setupPage(page);
    // Sync not configured (no SYNC_* globals set) → should show red error
    const indicator = page.locator('.sync-status');
    await expect(indicator).toBeVisible();

    const label = page.locator('.sync-label');
    await expect(label).toHaveText('Sync error');

    const dot = page.locator('.sync-dot');
    const bgColor = await dot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    // #f44336 renders as rgb(244, 67, 54)
    expect(bgColor).toContain('244, 67, 54');
  });

  test('shows "Sync not configured" tooltip on hover when sync is not configured', async ({ page }) => {
    await setupPage(page);
    // Sync not configured → error with message
    const tooltip = page.locator('.sync-tooltip');
    await expect(tooltip).toHaveText('Sync not configured');
    // Hidden by default
    await expect(tooltip).toHaveCSS('opacity', '0');
    // Visible on hover
    await page.locator('.sync-status').hover();
    await expect(tooltip).toHaveCSS('opacity', '1');
  });

  test('shows green dot and "Synced" label', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    const indicator = page.locator('.sync-status');
    await expect(indicator).toBeVisible();

    const label = page.locator('.sync-label');
    await expect(label).toHaveText('Synced');

    const dot = page.locator('.sync-dot');
    const bgColor = await dot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    // #4caf50 renders as rgb(76, 175, 80)
    expect(bgColor).toContain('76, 175, 80');
  });

  test('shows red dot and "Sync error" on error state', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, retryCount: 2, realtimeConnected: true });

    const label = page.locator('.sync-label');
    await expect(label).toHaveText('Sync error');

    const dot = page.locator('.sync-dot');
    const bgColor = await dot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    // #f44336 renders as rgb(244, 67, 54)
    expect(bgColor).toContain('244, 67, 54');
  });

  test('shows grey dot and "Reconnecting…" when realtime disconnected', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: false });

    const label = page.locator('.sync-label');
    await expect(label).toHaveText('Reconnecting…');

    const dot = page.locator('.sync-dot');
    const bgColor = await dot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    // #9e9e9e renders as rgb(158, 158, 158)
    expect(bgColor).toContain('158, 158, 158');
  });

  test('shows grey dot and "Offline" when offline', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await page.context().setOffline(true);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    const label = page.locator('.sync-label');
    await expect(label).toHaveText('Offline');

    await page.context().setOffline(false);
  });

  test('error tooltip bubble appears on hover', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, retryCount: 3, realtimeConnected: true });

    const tooltip = page.locator('.sync-tooltip');
    await expect(tooltip).toHaveText(/Retry 3\/5/);
    // Hidden by default
    await expect(tooltip).toHaveCSS('opacity', '0');
    // Visible on hover
    await page.locator('.sync-status').hover();
    await expect(tooltip).toHaveCSS('opacity', '1');
  });

  test('exhausted retries shows "Retries exhausted" tooltip', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, retryCount: 5, realtimeConnected: true });

    const label = page.locator('.sync-label');
    await expect(label).toHaveText('Sync error');

    const tooltip = page.locator('.sync-tooltip');
    await expect(tooltip).toHaveText('Retries exhausted');
  });

  test('synced state has no tooltip bubble', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    const tooltip = page.locator('.sync-tooltip');
    await expect(tooltip).toHaveCount(0);
  });

  test('syncing state is delayed by 3 seconds', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    // Start synced
    await setSyncState(page, { enabled: true, realtimeConnected: true });
    await expect(page.locator('.sync-label')).toHaveText('Synced');

    // Transition to syncing
    await setSyncState(page, { enabled: true, syncing: true, realtimeConnected: true });

    // Should still show synced immediately (3s delay)
    await expect(page.locator('.sync-label')).toHaveText('Synced');

    // After 3+ seconds, should show syncing
    await page.waitForTimeout(3200);
    await expect(page.locator('.sync-label')).toHaveText('Syncing…');

    // Going back to synced should be immediate
    await setSyncState(page, { enabled: true, syncing: false, realtimeConnected: true });
    await expect(page.locator('.sync-label')).toHaveText('Synced');
  });

  test('quick sync cycle does not flash yellow', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });
    await expect(page.locator('.sync-label')).toHaveText('Synced');

    // Brief syncing → synced (under 3s)
    await setSyncState(page, { enabled: true, syncing: true, realtimeConnected: true });
    await page.waitForTimeout(500);
    await setSyncState(page, { enabled: true, syncing: false, realtimeConnected: true });

    // Should never have shown yellow
    await expect(page.locator('.sync-label')).toHaveText('Synced');
  });

  test('error state shows immediately without delay', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });
    await expect(page.locator('.sync-label')).toHaveText('Synced');

    // Error should show immediately
    await setSyncState(page, { enabled: true, retryCount: 1, realtimeConnected: true });
    await expect(page.locator('.sync-label')).toHaveText('Sync error');
  });

  test('indicator is inside the view tabs bar', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    // Verify the indicator is a child of the view tabs
    const indicator = page.locator('.view-tabs .sync-status');
    await expect(indicator).toBeVisible();
  });

  test('dot is positioned to the right of the label', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    // With flex-direction: row-reverse, dot (first in DOM) renders rightmost
    const dot = page.locator('.sync-dot');
    const label = page.locator('.sync-label');

    const dotBox = await dot.boundingBox();
    const labelBox = await label.boundingBox();

    expect(dotBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    // Dot should be to the right of the label
    expect(dotBox!.x).toBeGreaterThan(labelBox!.x);
  });

  test('shows yellow dot when syncing state displays', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    // Transition to syncing and wait for 3s delay
    await setSyncState(page, { enabled: true, syncing: true, realtimeConnected: true });
    await page.waitForTimeout(3200);

    const dot = page.locator('.sync-dot');
    const bgColor = await dot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    // #ffc107 renders as rgb(255, 193, 7)
    expect(bgColor).toContain('255, 193, 7');
  });

  test('label fade resets when re-entering synced', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    // Wait for fade
    await page.waitForTimeout(5200);
    await expect(page.locator('.sync-label')).toHaveClass(/faded/);

    // Go to error then back to synced
    await setSyncState(page, { enabled: true, retryCount: 1, realtimeConnected: true });
    await setSyncState(page, { enabled: true, retryCount: 0, realtimeConnected: true });

    // Label should be visible again (not faded)
    await expect(page.locator('.sync-label')).not.toHaveClass(/faded/);

    // And should fade again after 5s
    await page.waitForTimeout(5200);
    await expect(page.locator('.sync-label')).toHaveClass(/faded/);
  });

  test('synced label fades out after 5 seconds', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    const label = page.locator('.sync-label');
    // Visible initially
    await expect(label).not.toHaveClass(/faded/);

    // After 5+ seconds, label should have faded class
    await page.waitForTimeout(5200);
    await expect(label).toHaveClass(/faded/);
  });

  test('label reappears when state changes from synced', async ({ page }) => {
    await setupPage(page);
    await configureSyncGlobals(page);
    await setSyncState(page, { enabled: true, realtimeConnected: true });

    // Wait for fade
    await page.waitForTimeout(5200);
    await expect(page.locator('.sync-label')).toHaveClass(/faded/);

    // Error state should bring label back
    await setSyncState(page, { enabled: true, retryCount: 1, realtimeConnected: true });
    await expect(page.locator('.sync-label')).not.toHaveClass(/faded/);
  });
});
