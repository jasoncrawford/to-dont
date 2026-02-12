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

  // Debounce timer for server sync
  let serverSyncTimer = null;
  const SERVER_SYNC_DEBOUNCE_MS = 2000;

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
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
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

  // Pull new events from server
  async function pullEvents() {
    if (!window.EventLog) return;

    const since = getLastSeq();
    const result = await apiRequest(`/api/events?since=${since}`);

    if (!result || !result.events || result.events.length === 0) return;

    // Filter out our own events (trivial echo suppression by clientId)
    const myClientId = EventLog.getClientId();
    const remoteEvents = result.events.filter(e => e.clientId !== myClientId);

    if (remoteEvents.length > 0) {
      console.log('[Sync] Pulled', remoteEvents.length, 'remote events');
      EventLog.appendRemoteEvents(remoteEvents);

      // Render if not editing
      if (typeof window.render === 'function' && !isUserEditing()) {
        window.render();
      }
    }

    // Update cursor to the highest seq from ALL events (including ours)
    const maxSeq = Math.max(...result.events.map(e => e.seq));
    if (maxSeq > getLastSeq()) {
      setLastSeq(maxSeq);
    }
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

      // Compact event log if all events are synced
      if (window.EventLog) {
        const unpushed = EventLog.getUnpushedEvents();
        if (unpushed.length === 0) {
          EventLog.compactEvents();
        }
      }
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
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

    realtimeChannel = supabaseClient
      .channel('events-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
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
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
