// Sync layer for To-Don't
// Event-based sync: pushes local events to server, pulls remote events.

import { getSupabaseClient, getAccessToken } from './supabase-client.ts';
import { computeSyncStatus } from './sync-status.ts';

// Configuration - reads from window.SYNC_* variables set by compat.ts
function getConfig() {
  return {
    supabaseUrl: window.SYNC_SUPABASE_URL || '',
    supabaseAnonKey: window.SYNC_SUPABASE_ANON_KEY || '',
    apiUrl: window.SYNC_API_URL || '',
    schema: window.SYNC_SUPABASE_SCHEMA || 'public',
  };
}

// Check for test mode - disable sync in test mode
const isTestMode = new URLSearchParams(window.location.search).get('test-mode') === '1';

// Sync state
let syncEnabled = false;
let supabaseClient = null;
let realtimeChannel = null;
let isSyncing = false;
let syncPending = false;
let lastSyncOk = false;

// Event cursor - persisted in localStorage
const CURSOR_KEY = 'decay-event-cursor';

function getLastSeq() {
  return parseInt(localStorage.getItem(CURSOR_KEY) || '0', 10);
}

function setLastSeq(seq) {
  localStorage.setItem(CURSOR_KEY, String(seq));
}

// Pull pagination constants
const PULL_PAGE_SIZE = 500;
const MAX_PULL_PAGES = 50;

// Debounce timer for server sync
let serverSyncTimer = null;
const SERVER_SYNC_DEBOUNCE_MS = 2000;

// Retry with exponential backoff
let retryTimer = null;
let retryCount = 0;
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 60000;

// Pending remote events (queued while user is editing)
let pendingRemoteEvents = [];

// Test override for access token (set via _test.setAccessTokenOverride)
let _testAccessToken = null;

// Status notification callback
let _statusCallback = null;
let realtimeConnected = false;

function notifyStatus() {
  if (!_statusCallback) return;
  _statusCallback(getSyncStatus());
}

function getSyncStatus() {
  return computeSyncStatus({
    isConfigured: isSyncConfigured(),
    isOnline: navigator.onLine,
    syncEnabled,
    realtimeConnected,
    isSyncing,
    syncPending,
    retryCount,
    lastSyncOk,
    maxRetries: MAX_RETRIES,
    baseRetryMs: BASE_RETRY_MS,
    maxRetryMs: MAX_RETRY_MS,
  });
}

// Check if sync is properly configured (no longer requires bearer token)
function isSyncConfigured() {
  const config = getConfig();
  return !!(config.supabaseUrl &&
            config.supabaseAnonKey &&
            config.apiUrl);
}

// Initialize Supabase client (use shared singleton)
function initSupabase() {
  if (!isSyncConfigured()) return null;
  return getSupabaseClient();
}

// Make API request with auth (JWT from Supabase session)
async function apiRequest(endpoint, options = {}) {
  const config = getConfig();
  const url = `${config.apiUrl}${endpoint}`;

  // Get JWT from current auth session (or test override)
  const token = _testAccessToken || await getAccessToken();
  if (!token) {
    throw new Error('No auth session — not signed in');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

// Check if user is actively editing
function isUserEditing() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  return activeElement.isContentEditable ||
         activeElement.tagName === 'INPUT' ||
         activeElement.tagName === 'TEXTAREA';
}

// ============================================
// Event-based sync
// ============================================

async function pushEvents() {
  if (!window.EventLog) return;

  const unpushed = window.EventLog.getUnpushedEvents();
  if (unpushed.length === 0) return;

  console.log('[Sync] Pushing', unpushed.length, 'events');

  const payload = unpushed.map(e => ({
    id: e.id,
    itemId: e.itemId,
    type: e.type,
    field: e.field,
    value: e.value,
    timestamp: e.timestamp,
    clientId: e.clientId,
  }));

  const result = await apiRequest('/api/events', {
    method: 'POST',
    body: JSON.stringify({ events: payload }),
  });

  if (result && result.events) {
    const seqMap = {};
    for (const e of result.events) {
      seqMap[e.id] = e.seq;
    }
    window.EventLog.markEventsPushed(seqMap);

    console.log('[Sync] Pushed', result.events.length, 'events');
  }
}

async function pullEvents() {
  if (!window.EventLog) return;

  const myClientId = window.EventLog.getClientId();
  let allRemoteEvents = [];
  let pageCount = 0;
  let hasMore = true;

  while (hasMore && pageCount < MAX_PULL_PAGES) {
    const since = getLastSeq();
    const result = await apiRequest(`/api/events?since=${since}&limit=${PULL_PAGE_SIZE}`);

    if (!result || !result.events || result.events.length === 0) break;

    const remoteEvents = result.events.filter(e => e.clientId !== myClientId);
    if (remoteEvents.length > 0) {
      allRemoteEvents = allRemoteEvents.concat(remoteEvents);
    }

    const maxSeq = Math.max(...result.events.map(e => e.seq));
    if (maxSeq > getLastSeq()) {
      setLastSeq(maxSeq);
    }

    pageCount++;
    hasMore = result.events.length >= PULL_PAGE_SIZE;
  }

  if (allRemoteEvents.length > 0) {
    console.log('[Sync] Pulled', allRemoteEvents.length, 'remote events in', pageCount, 'page(s)');
    window.EventLog.appendRemoteEvents(allRemoteEvents);

    if (typeof window.render === 'function' && !isUserEditing()) {
      window.render();
    }
  }
}

// Clear any pending retry timer
function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

// Schedule a retry with exponential backoff
function scheduleRetry() {
  if (retryCount >= MAX_RETRIES) {
    console.warn('[Sync] Max retries reached (' + MAX_RETRIES + '), giving up until next trigger');
    return;
  }

  const delay = Math.min(BASE_RETRY_MS * Math.pow(2, retryCount), MAX_RETRY_MS);
  retryCount++;
  console.log('[Sync] Scheduling retry ' + retryCount + '/' + MAX_RETRIES + ' in ' + delay + 'ms');

  clearRetryTimer();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    syncCycle();
  }, delay);
}

// Full sync cycle: push then pull
async function syncCycle() {
  if (!syncEnabled) return;

  if (isSyncing) {
    syncPending = true;
    return;
  }

  isSyncing = true;
  notifyStatus();
  try {
    await pushEvents();
    await pullEvents();

    retryCount = 0;
    lastSyncOk = true;
    clearRetryTimer();

    if (window.EventLog) {
      const unpushed = window.EventLog.getUnpushedEvents();
      if (unpushed.length === 0) {
        window.EventLog.compactEvents();
      }
    }
  } catch (err) {
    console.error('[Sync] Sync failed:', err);
    lastSyncOk = false;
    scheduleRetry();
  } finally {
    isSyncing = false;
    notifyStatus();

    if (syncPending) {
      syncPending = false;
      syncCycle();
    }
  }
}

// Debounced sync trigger
function queueServerSync() {
  if (serverSyncTimer) {
    clearTimeout(serverSyncTimer);
  }

  clearRetryTimer();

  serverSyncTimer = setTimeout(() => {
    serverSyncTimer = null;
    syncCycle();
  }, SERVER_SYNC_DEBOUNCE_MS);
  notifyStatus();
}

// Handle realtime INSERT on events table
function handleRealtimeEvent(payload) {
  if (!window.EventLog) return;
  if (payload.eventType !== 'INSERT') return;

  const dbEvent = payload.new;
  if (!dbEvent) return;

  const myClientId = window.EventLog.getClientId();
  if (dbEvent.client_id === myClientId) return;

  const event = {
    id: dbEvent.id,
    itemId: dbEvent.item_id,
    type: dbEvent.type,
    field: dbEvent.field,
    value: dbEvent.value,
    timestamp: dbEvent.timestamp,
    clientId: dbEvent.client_id,
    seq: dbEvent.seq,
  };

  console.log('[Sync] Realtime event:', event.type, event.field || '', event.itemId?.substring(0, 8));

  if (isUserEditing()) {
    pendingRemoteEvents.push(event);
    return;
  }

  window.EventLog.appendRemoteEvents([event]);
  if (event.seq > getLastSeq()) {
    setLastSeq(event.seq);
  }
  if (typeof window.render === 'function') {
    window.render();
  }
}

// Apply all pending remote events
function applyPendingEvents() {
  if (pendingRemoteEvents.length === 0) return;

  console.log('[Sync] Applying', pendingRemoteEvents.length, 'queued events');
  const events = pendingRemoteEvents.slice();
  pendingRemoteEvents = [];

  window.EventLog.appendRemoteEvents(events);

  const maxSeq = Math.max(...events.map(e => e.seq).filter(s => s != null));
  if (maxSeq > getLastSeq()) {
    setLastSeq(maxSeq);
  }

  if (typeof window.render === 'function') {
    window.render();
  }
}

// Subscribe to realtime changes on events table
function subscribeToRealtime() {
  if (!supabaseClient || !syncEnabled) return;

  // Listen for socket-level disconnect/reconnect
  const rt = supabaseClient.realtime;
  if (rt && !rt._syncStatusHooked) {
    rt._syncStatusHooked = true;
    if (typeof rt.onOpen === 'function') {
      rt.onOpen(() => { realtimeConnected = true; notifyStatus(); });
    }
    if (typeof rt.onClose === 'function') {
      rt.onClose(() => { realtimeConnected = false; notifyStatus(); });
    }
    if (typeof rt.onError === 'function') {
      rt.onError(() => { realtimeConnected = false; notifyStatus(); });
    }
  }

  const config = getConfig();
  realtimeChannel = supabaseClient
    .channel('events-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: config.schema, table: 'events' },
      handleRealtimeEvent
    )
    .subscribe((status) => {
      console.log('[Sync] Realtime status:', status);
      const wasConnected = realtimeConnected;
      realtimeConnected = (status === 'SUBSCRIBED');
      if (realtimeConnected !== wasConnected) notifyStatus();
    });
}

// Unsubscribe from realtime
function unsubscribeFromRealtime() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ============================================
// Enable/Disable
// ============================================

async function enableSync() {
  if (isTestMode) {
    console.log('[Sync] Disabled in test mode');
    return false;
  }

  if (!isSyncConfigured()) {
    console.warn('[Sync] Not configured');
    return false;
  }

  try {
    supabaseClient = initSupabase();
    if (!supabaseClient) {
      throw new Error('Failed to initialize Supabase');
    }

    syncEnabled = true;
    notifyStatus();
    subscribeToRealtime();
    await syncCycle();

    console.log('[Sync] ✓ Enabled');
    return true;

  } catch (err) {
    console.error('[Sync] Enable failed:', err);
    syncEnabled = false;
    notifyStatus();
    return false;
  }
}

function disableSync() {
  syncEnabled = false;
  realtimeConnected = false;
  lastSyncOk = false;
  clearRetryTimer();
  retryCount = 0;
  unsubscribeFromRealtime();
  notifyStatus();
  console.log('[Sync] Disabled');
}

// Apply pending updates when user stops editing
function setupBlurHandler() {
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isUserEditing()) {
        if (pendingRemoteEvents.length > 0) applyPendingEvents();
      }
    }, 100);
  });
}

// Re-sync when connectivity returns
function handleOnline() {
  if (!syncEnabled) return;
  console.log('[Sync] Online - re-syncing');
  queueServerSync();
}

// Initialize — no longer auto-enables (auth listener handles that)
function init() {
  if (isTestMode) {
    console.log('[Sync] Test mode - disabled');
    return;
  }

  setupBlurHandler();
  window.addEventListener('online', () => { handleOnline(); notifyStatus(); });
  window.addEventListener('offline', notifyStatus);

  // Don't auto-enable here — initAuthListener() in store.ts handles
  // enabling sync after authentication is confirmed.
}

// Public API
const ToDoSync = {
  enable: enableSync,
  disable: disableSync,
  isEnabled: () => syncEnabled,
  isConfigured: isSyncConfigured,
  refresh: function() {
    return syncCycle();
  },
  getConfig: () => ({ ...getConfig() }),
  onEventsAppended: function(newEvents) {
    if (syncEnabled) {
      queueServerSync();
    }
  },
  getStatus: getSyncStatus,
  onStatusChange: function(cb) { _statusCallback = cb; },
};

// Expose internals for testing
if (isTestMode) {
  ToDoSync._test = {
    setSyncEnabled: (val) => { syncEnabled = val; },
    setAccessTokenOverride: (token) => { _testAccessToken = token; },
    setIsSyncing: (val) => { isSyncing = val; },
    setRetryCount: (val) => { retryCount = val; },
    setRealtimeConnected: (val) => { realtimeConnected = val; },
    setLastSyncOk: (val) => { lastSyncOk = val; },
    lastSyncOk: () => lastSyncOk,
    notifyStatus: notifyStatus,
    triggerEventSync: () => syncCycle(),
    handleOnline: handleOnline,
    isSyncing: () => isSyncing,
    isSyncPending: () => syncPending,
    pullEvents: pullEvents,
    PULL_PAGE_SIZE: PULL_PAGE_SIZE,
    MAX_PULL_PAGES: MAX_PULL_PAGES,
    retryCount: () => retryCount,
    retryTimer: () => retryTimer,
    clearRetryTimer: clearRetryTimer,
    MAX_RETRIES: MAX_RETRIES,
    BASE_RETRY_MS: BASE_RETRY_MS,
    MAX_RETRY_MS: MAX_RETRY_MS,
  };
}

// Window global for backward compat (tests use window.ToDoSync)
window.ToDoSync = ToDoSync;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export default ToDoSync;
