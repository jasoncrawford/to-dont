// Sync layer for To-Don't
// Event-based sync: pushes local events to server, pulls remote events.
// Echo suppression is trivial: compare clientId.

(function() {
  'use strict';

  // Configuration - reads from window.SYNC_* variables dynamically
  function getConfig() {
    return {
      supabaseUrl: window.SYNC_SUPABASE_URL || '',
      supabaseAnonKey: window.SYNC_SUPABASE_ANON_KEY || '',
      bearerToken: window.SYNC_BEARER_TOKEN || '',
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

  // Fractional Indexing - uses shared module
  const generatePositionBetween = window.FractionalIndex.generatePositionBetween;
  const generateInitialPositions = window.FractionalIndex.generateInitialPositions;

  // Check if sync is properly configured
  function isSyncConfigured() {
    const config = getConfig();
    return !!(config.supabaseUrl &&
              config.supabaseAnonKey &&
              config.bearerToken &&
              config.apiUrl);
  }

  // Initialize Supabase client
  function initSupabase() {
    if (!isSyncConfigured()) return null;
    if (typeof window.supabase === 'undefined') {
      console.warn('[Sync] Supabase client not loaded');
      return null;
    }
    const config = getConfig();
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      db: { schema: config.schema },
    });
  }

  // Make API request with auth
  async function apiRequest(endpoint, options = {}) {
    const config = getConfig();
    const url = `${config.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.bearerToken}`,
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

  // Push unpushed local events to server
  async function pushEvents() {
    if (!window.EventLog) return;

    const unpushed = EventLog.getUnpushedEvents();
    if (unpushed.length === 0) return;

    console.log('[Sync] Pushing', unpushed.length, 'events');

    // Convert to API format (camelCase)
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
      // Build seq map from response
      const seqMap = {};
      for (const e of result.events) {
        seqMap[e.id] = e.seq;
      }
      EventLog.markEventsPushed(seqMap);

      console.log('[Sync] Pushed', result.events.length, 'events');
    }
  }

  // Pull new events from server, paginating until all caught up
  async function pullEvents() {
    if (!window.EventLog) return;

    const myClientId = EventLog.getClientId();
    let allRemoteEvents = [];
    let pageCount = 0;
    let hasMore = true;

    while (hasMore && pageCount < MAX_PULL_PAGES) {
      const since = getLastSeq();
      const result = await apiRequest(`/api/events?since=${since}&limit=${PULL_PAGE_SIZE}`);

      if (!result || !result.events || result.events.length === 0) break;

      // Filter out our own events (trivial echo suppression by clientId)
      const remoteEvents = result.events.filter(e => e.clientId !== myClientId);
      if (remoteEvents.length > 0) {
        allRemoteEvents = allRemoteEvents.concat(remoteEvents);
      }

      // Update cursor to the highest seq from ALL events (including ours)
      const maxSeq = Math.max(...result.events.map(e => e.seq));
      if (maxSeq > getLastSeq()) {
        setLastSeq(maxSeq);
      }

      pageCount++;

      // If we got fewer than PULL_PAGE_SIZE, we've caught up
      hasMore = result.events.length >= PULL_PAGE_SIZE;
    }

    if (allRemoteEvents.length > 0) {
      console.log('[Sync] Pulled', allRemoteEvents.length, 'remote events in', pageCount, 'page(s)');
      EventLog.appendRemoteEvents(allRemoteEvents);

      // Render if not editing
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
      retryCount = 0;
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
    try {
      await pushEvents();
      await pullEvents();

      // Success - reset retry state
      retryCount = 0;
      clearRetryTimer();

      // Compact event log if all events are synced
      if (window.EventLog) {
        const unpushed = EventLog.getUnpushedEvents();
        if (unpushed.length === 0) {
          EventLog.compactEvents();
        }
      }
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
      scheduleRetry();
    } finally {
      isSyncing = false;

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

    // A new mutation supersedes any pending retry
    clearRetryTimer();
    retryCount = 0;

    serverSyncTimer = setTimeout(() => {
      serverSyncTimer = null;
      syncCycle();
    }, SERVER_SYNC_DEBOUNCE_MS);
  }

  // Handle realtime INSERT on events table
  function handleRealtimeEvent(payload) {
    if (!window.EventLog) return;
    if (payload.eventType !== 'INSERT') return;

    const dbEvent = payload.new;
    if (!dbEvent) return;

    // Trivial echo suppression: skip our own events
    const myClientId = EventLog.getClientId();
    if (dbEvent.client_id === myClientId) return;

    // Convert from DB format (snake_case) to local format (camelCase)
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

    // If user is editing, queue the event
    if (isUserEditing()) {
      pendingRemoteEvents.push(event);
      return;
    }

    // Apply immediately
    EventLog.appendRemoteEvents([event]);
    // Update cursor
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

    EventLog.appendRemoteEvents(events);

    // Update cursor
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

    const config = getConfig();
    realtimeChannel = supabaseClient
      .channel('events-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: config.schema, table: 'events' },
        handleRealtimeEvent
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Sync] Realtime connected');
        }
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

      // Subscribe to realtime events
      subscribeToRealtime();

      // Initial sync cycle: push local events, pull remote
      await syncCycle();

      console.log('[Sync] ✓ Enabled');
      return true;

    } catch (err) {
      console.error('[Sync] Enable failed:', err);
      syncEnabled = false;
      return false;
    }
  }

  function disableSync() {
    syncEnabled = false;
    clearRetryTimer();
    retryCount = 0;
    unsubscribeFromRealtime();
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

  // Initialize
  function init() {
    if (isTestMode) {
      console.log('[Sync] Test mode - disabled');
      return;
    }

    setupBlurHandler();
    window.addEventListener('online', handleOnline);

    if (isSyncConfigured()) {
      setTimeout(() => {
        enableSync().catch(err => {
          console.error('[Sync] Init failed:', err);
        });
      }, 100);
    }
  }

  // Expose API
  window.ToDoSync = {
    enable: enableSync,
    disable: disableSync,
    isEnabled: () => syncEnabled,
    isConfigured: isSyncConfigured,
    refresh: function() {
      return syncCycle();
    },
    getConfig: () => ({ ...getConfig() }),
    // Called by EventLog appendEvents()
    onSave: function(todos) {
      if (syncEnabled) {
        queueServerSync();
      }
    },
    // Hook for event-based sync
    onEventsAppended: function(newEvents) {
      if (syncEnabled) {
        queueServerSync();
      }
    },
    // CRDT helpers for app.js
    generatePositionBetween: generatePositionBetween,
    generateInitialPositions: generateInitialPositions,
  };

  // Expose internals for testing
  if (isTestMode) {
    window.ToDoSync._test = {
      setSyncEnabled: (val) => { syncEnabled = val; },
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
