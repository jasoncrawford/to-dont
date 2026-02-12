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

      // Update cursor to the highest seq we received
      const maxSeq = Math.max(...result.events.map(e => e.seq));
      if (maxSeq > getLastSeq()) {
        setLastSeq(maxSeq);
      }

      console.log('[Sync] Pushed', result.events.length, 'events, cursor now at', getLastSeq());
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
  // Old-style sync (kept for backward compat during transition)
  // ============================================

  // Generate UUID for new items (legacy)
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getOrAssignUUID(item) {
    if (item.serverUuid) return item.serverUuid;
    item.serverUuid = generateUUID();
    return item.serverUuid;
  }

  function findItemByUUID(todos, uuid) {
    let index = todos.findIndex(t => t.serverUuid === uuid);
    if (index >= 0) return { index, item: todos[index] };
    index = todos.findIndex(t => t.id === uuid);
    if (index >= 0) return { index, item: todos[index] };
    return { index: -1, item: null };
  }

  // Old-style state-based sync (used as fallback when EventLog not available)
  let oldIsSyncing = false;
  let oldSyncPending = false;
  let lastSyncedState = null;
  let pendingSyncTodos = null;
  const recentlySyncedIds = new Set();
  const RECENTLY_SYNCED_TTL_MS = 10000;
  let pendingRemoteUpdates = [];
  const MID_CHAR = 'n';

  function toDbFormat(item, position) {
    const now = new Date().toISOString();
    return {
      id: getOrAssignUUID(item),
      parent_id: null,
      type: item.type || 'todo',
      text: item.text || '',
      important: item.important || false,
      completed_at: item.completedAt ? new Date(item.completedAt).toISOString() : null,
      created_at: new Date(item.createdAt).toISOString(),
      level: item.level || null,
      indented: item.indented || false,
      position: position || item.position || MID_CHAR,
      text_updated_at: item.textUpdatedAt ? new Date(item.textUpdatedAt).toISOString() : now,
      important_updated_at: item.importantUpdatedAt ? new Date(item.importantUpdatedAt).toISOString() : now,
      completed_updated_at: item.completedUpdatedAt ? new Date(item.completedUpdatedAt).toISOString() : now,
      position_updated_at: item.positionUpdatedAt ? new Date(item.positionUpdatedAt).toISOString() : now,
      type_updated_at: item.typeUpdatedAt ? new Date(item.typeUpdatedAt).toISOString() : now,
      level_updated_at: item.levelUpdatedAt ? new Date(item.levelUpdatedAt).toISOString() : now,
      indented_updated_at: item.indentedUpdatedAt ? new Date(item.indentedUpdatedAt).toISOString() : now,
    };
  }

  function toLocalFormat(dbItem) {
    return {
      id: dbItem.id,
      serverUuid: dbItem.id,
      text: dbItem.text || '',
      createdAt: new Date(dbItem.created_at).getTime(),
      important: dbItem.important || false,
      completed: !!dbItem.completed_at,
      completedAt: dbItem.completed_at ? new Date(dbItem.completed_at).getTime() : undefined,
      archived: false,
      type: dbItem.type === 'section' ? 'section' : undefined,
      level: dbItem.level || undefined,
      indented: dbItem.indented || !!dbItem.parent_id,
      position: dbItem.position || MID_CHAR,
      textUpdatedAt: dbItem.text_updated_at ? new Date(dbItem.text_updated_at).getTime() : Date.now(),
      importantUpdatedAt: dbItem.important_updated_at ? new Date(dbItem.important_updated_at).getTime() : Date.now(),
      completedUpdatedAt: dbItem.completed_updated_at ? new Date(dbItem.completed_updated_at).getTime() : Date.now(),
      positionUpdatedAt: dbItem.position_updated_at ? new Date(dbItem.position_updated_at).getTime() : Date.now(),
      typeUpdatedAt: dbItem.type_updated_at ? new Date(dbItem.type_updated_at).getTime() : Date.now(),
      levelUpdatedAt: dbItem.level_updated_at ? new Date(dbItem.level_updated_at).getTime() : Date.now(),
      indentedUpdatedAt: dbItem.indented_updated_at ? new Date(dbItem.indented_updated_at).getTime() : Date.now(),
    };
  }

  function itemHash(item) {
    return JSON.stringify({
      id: item.id, text: item.text, important: item.important,
      completed: item.completed, completedAt: item.completedAt,
      type: item.type, level: item.level, indented: item.indented,
    });
  }

  function itemHashWithPosition(item) {
    return JSON.stringify({
      id: item.id, text: item.text, important: item.important,
      completed: item.completed, completedAt: item.completedAt,
      type: item.type, position: item.position, level: item.level, indented: item.indented,
    });
  }

  function createStateSnapshot(todos) {
    const snapshot = { itemHashes: new Map(), itemIds: new Set() };
    todos.forEach((item) => {
      snapshot.itemHashes.set(item.id, itemHashWithPosition(item));
      snapshot.itemIds.add(item.id);
    });
    return snapshot;
  }

  function detectChanges(currentTodos) {
    const currentSnapshot = createStateSnapshot(currentTodos);
    if (!lastSyncedState) {
      return { hasChanges: currentTodos.length > 0, modifiedItems: currentTodos, deletedIds: [] };
    }
    const lastSnapshot = createStateSnapshot(lastSyncedState);
    const modifiedItems = [];
    currentTodos.forEach((item) => {
      const currentHash = itemHashWithPosition(item);
      const lastHash = lastSnapshot.itemHashes.get(item.id);
      if (currentHash !== lastHash) modifiedItems.push(item);
    });
    const deletedIds = [];
    lastSnapshot.itemIds.forEach(id => {
      if (!currentSnapshot.itemIds.has(id)) deletedIds.push(id);
    });
    return { hasChanges: modifiedItems.length > 0 || deletedIds.length > 0, modifiedItems, deletedIds };
  }

  function mergeLocalWithRemote(local, remote) {
    const merged = { ...local };
    if ((remote.textUpdatedAt || 0) > (local.textUpdatedAt || 0)) { merged.text = remote.text; merged.textUpdatedAt = remote.textUpdatedAt; }
    if ((remote.importantUpdatedAt || 0) > (local.importantUpdatedAt || 0)) { merged.important = remote.important; merged.importantUpdatedAt = remote.importantUpdatedAt; }
    if ((remote.completedUpdatedAt || 0) > (local.completedUpdatedAt || 0)) { merged.completed = remote.completed; merged.completedAt = remote.completedAt; merged.completedUpdatedAt = remote.completedUpdatedAt; }
    if ((remote.positionUpdatedAt || 0) > (local.positionUpdatedAt || 0)) { merged.position = remote.position; merged.positionUpdatedAt = remote.positionUpdatedAt; }
    if ((remote.typeUpdatedAt || 0) > (local.typeUpdatedAt || 0)) { merged.type = remote.type; merged.typeUpdatedAt = remote.typeUpdatedAt; }
    if ((remote.levelUpdatedAt || 0) > (local.levelUpdatedAt || 0)) { merged.level = remote.level; merged.levelUpdatedAt = remote.levelUpdatedAt; }
    if ((remote.indentedUpdatedAt || 0) > (local.indentedUpdatedAt || 0)) { merged.indented = remote.indented; merged.indentedUpdatedAt = remote.indentedUpdatedAt; }
    return merged;
  }

  async function syncChanges(todos) {
    const { hasChanges, modifiedItems, deletedIds } = detectChanges(todos);
    if (!hasChanges) return;
    const existingIds = new Set(lastSyncedState?.map(t => t.id) || []);
    const storedForUuids = localStorage.getItem('decay-todos');
    if (storedForUuids) {
      const storedTodos = JSON.parse(storedForUuids);
      const uuidByLocalId = new Map();
      for (const st of storedTodos) { if (st.serverUuid) uuidByLocalId.set(st.id, st.serverUuid); }
      for (const item of todos) { if (!item.serverUuid && uuidByLocalId.has(item.id)) item.serverUuid = uuidByLocalId.get(item.id); }
    }
    const deletedUuids = deletedIds.map(localId => {
      const lastItem = lastSyncedState ? lastSyncedState.find(t => t.id === localId) : null;
      const uuid = (lastItem && lastItem.serverUuid) || localId;
      recentlySyncedIds.add(`DELETE:${uuid}`);
      setTimeout(() => recentlySyncedIds.delete(`DELETE:${uuid}`), RECENTLY_SYNCED_TTL_MS);
      return uuid;
    });
    const dbItems = modifiedItems.map((item) => {
      const dbItem = toDbFormat(item, item.position);
      const isNew = !existingIds.has(item.id);
      const eventKey = `${isNew ? 'INSERT' : 'UPDATE'}:${dbItem.id}`;
      recentlySyncedIds.add(eventKey);
      setTimeout(() => recentlySyncedIds.delete(eventKey), RECENTLY_SYNCED_TTL_MS);
      return dbItem;
    });
    localStorage.setItem('decay-todos', JSON.stringify(todos));
    if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
    const sentSnapshot = JSON.parse(JSON.stringify(todos));
    const syncBody = { items: dbItems };
    if (deletedUuids.length > 0) syncBody.deleteIds = deletedUuids;
    const syncResponse = await apiRequest('/api/sync', { method: 'POST', body: JSON.stringify(syncBody) });
    if (syncResponse && syncResponse.mergedItems && syncResponse.mergedItems.length > 0) {
      applyMergedResponse(syncResponse.mergedItems);
      for (const dbItem of syncResponse.mergedItems) {
        const remoteAsLocal = toLocalFormat(dbItem);
        const { index, item: localItem } = findItemByUUID(sentSnapshot, dbItem.id);
        if (index >= 0 && localItem) {
          const merged = mergeLocalWithRemote(localItem, remoteAsLocal);
          merged.id = localItem.id;
          merged.serverUuid = localItem.serverUuid || dbItem.id;
          sentSnapshot[index] = merged;
        }
      }
    }
    lastSyncedState = sentSnapshot;
  }

  function applyMergedResponse(mergedDbItems) {
    const stored = localStorage.getItem('decay-todos');
    const todos = stored ? JSON.parse(stored) : [];
    let changed = false;
    for (const dbItem of mergedDbItems) {
      const remoteAsLocal = toLocalFormat(dbItem);
      const { index, item: localItem } = findItemByUUID(todos, dbItem.id);
      if (index >= 0 && localItem) {
        const merged = mergeLocalWithRemote(localItem, remoteAsLocal);
        merged.id = localItem.id;
        merged.serverUuid = localItem.serverUuid || dbItem.id;
        if (itemHash(localItem) !== itemHash(merged) || localItem.position !== merged.position) {
          todos[index] = merged; changed = true;
        }
      }
    }
    if (changed) {
      todos.sort((a, b) => (a.position || MID_CHAR).localeCompare(b.position || MID_CHAR) || a.id.localeCompare(b.id));
      localStorage.setItem('decay-todos', JSON.stringify(todos));
      if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
      lastSyncedState = JSON.parse(JSON.stringify(todos));
      if (typeof window.render === 'function' && !isUserEditing()) window.render();
    }
  }

  async function syncToServer(todos) {
    if (!syncEnabled || !todos) return;
    if (oldIsSyncing) {
      oldSyncPending = true;
      pendingSyncTodos = todos;
      return;
    }
    oldIsSyncing = true;
    try { await syncChanges(todos); } catch (err) { console.error('[Sync] Sync failed:', err); }
    finally {
      oldIsSyncing = false;
      if (oldSyncPending) {
        oldSyncPending = false;
        const todosToSync = pendingSyncTodos;
        pendingSyncTodos = null;
        if (todosToSync) {
          syncToServer(todosToSync);
        }
      }
    }
  }

  let oldServerSyncTimer = null;
  function oldQueueServerSync(todos) {
    if (oldServerSyncTimer) clearTimeout(oldServerSyncTimer);
    oldServerSyncTimer = setTimeout(() => { oldServerSyncTimer = null; syncToServer(todos); }, SERVER_SYNC_DEBOUNCE_MS);
  }

  function handleRealtimeChange(payload) {
    const itemId = payload.new?.id || payload.old?.id;
    const eventKey = `${payload.eventType}:${itemId}`;
    if (itemId && recentlySyncedIds.has(eventKey)) return;
    if (isUserEditing()) { pendingRemoteUpdates.push(payload); return; }
    applyRemoteChange(payload);
  }

  function applyRemoteChange(payload) {
    const stored = localStorage.getItem('decay-todos');
    const todos = stored ? JSON.parse(stored) : [];
    let changed = false;
    if (payload.eventType === 'INSERT') {
      const newItem = toLocalFormat(payload.new);
      const { index: existingIndex } = findItemByUUID(todos, newItem.id);
      if (existingIndex < 0) {
        let insertIndex = todos.length;
        for (let i = 0; i < todos.length; i++) { if ((todos[i].position || MID_CHAR) > (newItem.position || MID_CHAR)) { insertIndex = i; break; } }
        newItem.serverUuid = newItem.id;
        todos.splice(insertIndex, 0, newItem);
        changed = true;
      }
    } else if (payload.eventType === 'UPDATE') {
      const remoteItem = toLocalFormat(payload.new);
      const { index, item: localItem } = findItemByUUID(todos, remoteItem.id);
      if (index >= 0 && localItem) {
        const merged = mergeLocalWithRemote(localItem, remoteItem);
        merged.id = localItem.id;
        if (itemHash(localItem) !== itemHash(merged) || localItem.position !== merged.position) {
          todos[index] = merged;
          todos.sort((a, b) => (a.position || MID_CHAR).localeCompare(b.position || MID_CHAR) || a.id.localeCompare(b.id));
          changed = true;
        }
      }
    } else if (payload.eventType === 'DELETE') {
      const deletedId = payload.old?.id;
      const { index } = findItemByUUID(todos, deletedId);
      if (index >= 0) { todos.splice(index, 1); changed = true; }
    }
    if (changed) {
      localStorage.setItem('decay-todos', JSON.stringify(todos));
      if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
      lastSyncedState = JSON.parse(JSON.stringify(todos));
      if (typeof window.render === 'function') window.render();
    }
  }

  function applyOldPendingUpdates() {
    if (pendingRemoteUpdates.length === 0) return;
    const updates = pendingRemoteUpdates.slice();
    pendingRemoteUpdates = [];
    updates.forEach(applyRemoteChange);
  }

  async function fetchAndMergeTodos() {
    if (!syncEnabled) return;
    try {
      const serverItems = await apiRequest('/api/items');
      if (!serverItems || !Array.isArray(serverItems)) return;
      const currentLocal = JSON.parse(localStorage.getItem('decay-todos') || '[]');
      const matchedLocalIds = new Set();
      const merged = [];
      for (const serverItem of serverItems) {
        const remoteAsLocal = toLocalFormat(serverItem);
        const { item: localItem } = findItemByUUID(currentLocal, serverItem.id);
        if (localItem) {
          const mergedItem = mergeLocalWithRemote(localItem, remoteAsLocal);
          mergedItem.id = localItem.id;
          mergedItem.serverUuid = serverItem.id;
          merged.push(mergedItem);
          matchedLocalIds.add(localItem.id);
        } else {
          remoteAsLocal.serverUuid = remoteAsLocal.id;
          merged.push(remoteAsLocal);
        }
      }
      for (const localItem of currentLocal) {
        if (!matchedLocalIds.has(localItem.id)) merged.push(localItem);
      }
      merged.sort((a, b) => (a.position || MID_CHAR).localeCompare(b.position || MID_CHAR) || a.id.localeCompare(b.id));
      localStorage.setItem('decay-todos', JSON.stringify(merged));
      if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
      lastSyncedState = JSON.parse(JSON.stringify(merged));
      if (typeof window.render === 'function') window.render();
    } catch (err) {
      console.error('[Sync] Fetch failed:', err);
    }
  }

  function subscribeToOldRealtime() {
    if (!supabaseClient || !syncEnabled) return;
    // Also subscribe to old items table for backward compat
    supabaseClient
      .channel('items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, handleRealtimeChange)
      .subscribe();
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

      // Check if first sync
      const hasSynced = localStorage.getItem('decay-todos-synced') === 'true';

      if (!hasSynced) {
        // First time: push local items to server via old API
        const existingData = localStorage.getItem('decay-todos');
        if (existingData) {
          const existingItems = JSON.parse(existingData);
          if (existingItems.length > 0) {
            const positions = generateInitialPositions(existingItems.length);
            existingItems.forEach((item, index) => {
              if (!item.position) { item.position = positions[index]; item.positionUpdatedAt = Date.now(); }
            });
            existingItems.forEach(item => {
              const uuid = getOrAssignUUID(item);
              recentlySyncedIds.add(`INSERT:${uuid}`);
              setTimeout(() => recentlySyncedIds.delete(`INSERT:${uuid}`), RECENTLY_SYNCED_TTL_MS);
            });
            const dbItems = existingItems.map((item) => toDbFormat(item, item.position));
            const initialSyncResponse = await apiRequest('/api/sync', {
              method: 'POST',
              body: JSON.stringify({ items: dbItems }),
            });
            if (initialSyncResponse && initialSyncResponse.mergedItems && initialSyncResponse.mergedItems.length > 0) {
              applyMergedResponse(initialSyncResponse.mergedItems);
            }
            localStorage.setItem('decay-todos', JSON.stringify(existingItems));
            if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
            lastSyncedState = JSON.parse(JSON.stringify(existingItems));
          }
        }
        localStorage.setItem('decay-todos-synced', 'true');
      }

      // Subscribe to realtime
      subscribeToRealtime();
      // Only subscribe to old items table if EventLog isn't available
      // (when EventLog is active, the events table subscription is the
      // source of truth and old realtime would create duplicates)
      if (!window.EventLog) {
        subscribeToOldRealtime();
      }

      // Pull events and fetch items
      if (window.EventLog) {
        await syncCycle();
      }
      // Only fetch from old items table if EventLog isn't available
      // (when EventLog is active, events are the source of truth and
      // fetchAndMergeTodos would create duplicates)
      if (!window.EventLog) {
        await fetchAndMergeTodos();
      }

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
          if (pendingRemoteUpdates.length > 0) applyOldPendingUpdates();
        }
      }, 100);
    });
  }

  // Re-sync when connectivity returns
  function handleOnline() {
    if (!syncEnabled) return;
    console.log('[Sync] Online - re-syncing');
    // Always trigger old sync path
    const stored = localStorage.getItem('decay-todos');
    const todos = stored ? JSON.parse(stored) : [];
    oldQueueServerSync(todos);
    // Also trigger event-based sync if available
    if (window.EventLog) {
      queueServerSync();
    }
    if (!window.EventLog) {
      setTimeout(fetchAndMergeTodos, SERVER_SYNC_DEBOUNCE_MS + 2000);
    }
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
      // Always call old fetchAndMergeTodos for backward compat
      // (tests mock /api/items and expect this path)
      return fetchAndMergeTodos();
    },
    getConfig: () => ({ ...getConfig() }),
    // Called by app.js saveTodos() and EventLog appendEvents()
    onSave: function(todos) {
      if (syncEnabled) {
        // Always use old sync path for backward compat (writes to items table)
        oldQueueServerSync(todos);
        // Also trigger event-based sync if EventLog is available
        if (window.EventLog) {
          queueServerSync();
        }
      }
    },
    // New hook for event-based sync
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
      triggerSync: () => {
        // Always use old path for tests that call triggerSync directly
        const stored = localStorage.getItem('decay-todos');
        const todos = stored ? JSON.parse(stored) : [];
        return syncToServer(todos);
      },
      triggerEventSync: () => syncCycle(),
      handleOnline: handleOnline,
      // Expose old sync flags (syncToServer uses these)
      isSyncing: () => oldIsSyncing,
      isSyncPending: () => oldSyncPending,
      setIsSyncing: (val) => { oldIsSyncing = val; },
      syncToServer: (todos) => syncToServer(todos),
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
