// Sync layer for To-Don't
// Wraps localStorage operations to also sync with server via Supabase
// Uses CRDT-inspired per-field timestamps and fractional indexing

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
  let pendingSyncTodos = null;

  // Track last synced state to detect what actually changed
  let lastSyncedState = null;

  // Debounce timer for server sync
  let serverSyncTimer = null;
  const SERVER_SYNC_DEBOUNCE_MS = 2000; // Increased debounce

  // Track recently synced item IDs to ignore our own realtime events
  const recentlySyncedIds = new Set();
  const RECENTLY_SYNCED_TTL_MS = 10000; // 10 seconds

  // Pending remote updates (queued while user is editing)
  let pendingRemoteUpdates = [];

  // ============================================
  // Fractional Indexing - uses shared module
  // ============================================
  const generatePositionBetween = window.FractionalIndex.generatePositionBetween;
  const generateInitialPositions = window.FractionalIndex.generateInitialPositions;
  const MID_CHAR = 'n';

  // ============================================
  // UUID and ID Management
  // ============================================

  // Generate UUID for new items
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Get or assign a serverUuid directly on the item
  function getOrAssignUUID(item) {
    if (item.serverUuid) return item.serverUuid;
    item.serverUuid = generateUUID();
    return item.serverUuid;
  }

  // Find item in todos by UUID (checks serverUuid property, then direct ID match)
  function findItemByUUID(todos, uuid) {
    // First try serverUuid property
    let index = todos.findIndex(t => t.serverUuid === uuid);
    if (index >= 0) return { index, item: todos[index] };

    // Fallback: try direct ID match (item ID might be the UUID itself)
    index = todos.findIndex(t => t.id === uuid);
    if (index >= 0) return { index, item: todos[index] };

    return { index: -1, item: null };
  }

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

  // Convert localStorage item to database format
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
      // CRDT fields
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

  // Convert database item to localStorage format
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
      indented: dbItem.indented || !!dbItem.parent_id, // Support both new column and legacy parent_id
      // CRDT fields
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

  // Create a hash of an item for comparison (without position)
  function itemHash(item) {
    return JSON.stringify({
      id: item.id,
      text: item.text,
      important: item.important,
      completed: item.completed,
      completedAt: item.completedAt,
      type: item.type,
      level: item.level,
      indented: item.indented,
    });
  }

  // Create a hash of an item for comparison (includes position for reorder detection)
  function itemHashWithPosition(item) {
    return JSON.stringify({
      id: item.id,
      text: item.text,
      important: item.important,
      completed: item.completed,
      completedAt: item.completedAt,
      type: item.type,
      position: item.position,
      level: item.level,
      indented: item.indented,
    });
  }

  // Create a snapshot of current state for comparison
  function createStateSnapshot(todos) {
    const snapshot = {
      itemHashes: new Map(),
      itemIds: new Set(),
    };
    todos.forEach((item) => {
      snapshot.itemHashes.set(item.id, itemHashWithPosition(item));
      snapshot.itemIds.add(item.id);
    });
    return snapshot;
  }

  // Detect all changes: modifications, additions, deletions, reorders
  function detectChanges(currentTodos) {
    const currentSnapshot = createStateSnapshot(currentTodos);

    if (!lastSyncedState) {
      // First sync - everything is new
      return {
        hasChanges: currentTodos.length > 0,
        modifiedItems: currentTodos,
        deletedIds: [],
      };
    }

    const lastSnapshot = createStateSnapshot(lastSyncedState);

    // Find modified/added items (hash changed or new)
    const modifiedItems = [];
    currentTodos.forEach((item) => {
      const currentHash = itemHashWithPosition(item);
      const lastHash = lastSnapshot.itemHashes.get(item.id);
      if (currentHash !== lastHash) {
        modifiedItems.push(item);
      }
    });

    // Find deleted items (in last but not in current)
    const deletedIds = [];
    lastSnapshot.itemIds.forEach(id => {
      if (!currentSnapshot.itemIds.has(id)) {
        deletedIds.push(id);
      }
    });

    return {
      hasChanges: modifiedItems.length > 0 || deletedIds.length > 0,
      modifiedItems,
      deletedIds,
    };
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

  // Sync changes to server (modifications, additions, deletions, reorders)
  async function syncChanges(todos) {
    const { hasChanges, modifiedItems, deletedIds } = detectChanges(todos);

    if (!hasChanges) {
      return; // Nothing to sync
    }

    const changes = [];
    if (modifiedItems.length > 0) changes.push(`${modifiedItems.length} modified`);
    if (deletedIds.length > 0) changes.push(`${deletedIds.length} deleted`);
    console.log('[Sync] Syncing:', changes.join(', '));

    // Resolve deleted UUIDs upfront and set up realtime echo suppression
    const deletedUuids = deletedIds.map(localId => {
      // Find the item in lastSyncedState to get its serverUuid
      const lastItem = lastSyncedState ? lastSyncedState.find(t => t.id === localId) : null;
      const uuid = (lastItem && lastItem.serverUuid) || localId;
      const eventKey = `DELETE:${uuid}`;
      recentlySyncedIds.add(eventKey);
      setTimeout(() => recentlySyncedIds.delete(eventKey), RECENTLY_SYNCED_TTL_MS);
      return uuid;
    });

    // Determine which items are new vs updated
    const existingIds = new Set(lastSyncedState?.map(t => t.id) || []);

    // Before assigning UUIDs, inherit any serverUuid values from localStorage
    // that may have been saved by a previous sync but aren't on our todos array
    // (which was captured earlier in a queueServerSync closure).
    const storedForUuids = localStorage.getItem('decay-todos');
    if (storedForUuids) {
      const storedTodos = JSON.parse(storedForUuids);
      const uuidByLocalId = new Map();
      for (const st of storedTodos) {
        if (st.serverUuid) uuidByLocalId.set(st.id, st.serverUuid);
      }
      for (const item of todos) {
        if (!item.serverUuid && uuidByLocalId.has(item.id)) {
          item.serverUuid = uuidByLocalId.get(item.id);
        }
      }
    }

    const dbItems = modifiedItems.map((item) => {
      const dbItem = toDbFormat(item, item.position);
      // Track this ID with event type so we ignore only our own echo
      // New items will get INSERT echo, existing items will get UPDATE echo
      const isNew = !existingIds.has(item.id);
      const eventKey = `${isNew ? 'INSERT' : 'UPDATE'}:${dbItem.id}`;
      recentlySyncedIds.add(eventKey);
      setTimeout(() => recentlySyncedIds.delete(eventKey), RECENTLY_SYNCED_TTL_MS);
      return dbItem;
    });

    // Save updated todos back to localStorage immediately so new serverUuid
    // fields persist before the API call. This ensures concurrent loadTodos()
    // calls (from user actions) will see the serverUuid.
    localStorage.setItem('decay-todos', JSON.stringify(todos));
    if (typeof invalidateTodoCache === 'function') invalidateTodoCache();

    // Snapshot what we're about to send - this is what the server will know about.
    // We must capture this BEFORE the await because user actions during the API
    // call may modify localStorage, and we need lastSyncedState to reflect only
    // what the server has confirmed, not unsynced local changes.
    const sentSnapshot = JSON.parse(JSON.stringify(todos));

    // Send modifications and deletions together in one request
    const syncBody = { items: dbItems };
    if (deletedUuids.length > 0) {
      syncBody.deleteIds = deletedUuids;
    }

    const syncResponse = await apiRequest('/api/sync', {
      method: 'POST',
      body: JSON.stringify(syncBody),
    });

    // Apply server's merged results back to local state AND to our snapshot
    if (syncResponse && syncResponse.mergedItems && syncResponse.mergedItems.length > 0) {
      applyMergedResponse(syncResponse.mergedItems);
      // Also apply merge results to our snapshot so lastSyncedState reflects
      // what the server actually has (which may differ from what we sent)
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

    // Update last synced state from our snapshot (what we sent to the server
    // plus any server merge results). We do NOT re-read from localStorage
    // because user actions during the API call may have changed it, and those
    // unsynced changes would incorrectly appear "already synced".
    lastSyncedState = sentSnapshot;

    console.log('[Sync] ✓ Done');
  }

  // Apply server's merged results back to local state
  function applyMergedResponse(mergedDbItems) {
    const stored = localStorage.getItem('decay-todos');
    const todos = stored ? JSON.parse(stored) : [];
    let changed = false;

    for (const dbItem of mergedDbItems) {
      const remoteAsLocal = toLocalFormat(dbItem);
      const { index, item: localItem } = findItemByUUID(todos, dbItem.id);

      if (index >= 0 && localItem) {
        const merged = mergeLocalWithRemote(localItem, remoteAsLocal);
        merged.id = localItem.id; // Preserve local ID
        merged.serverUuid = localItem.serverUuid || dbItem.id; // Ensure serverUuid is set

        if (itemHash(localItem) !== itemHash(merged) ||
            localItem.position !== merged.position) {
          todos[index] = merged;
          changed = true;
        }
      }
    }

    if (changed) {
      todos.sort((a, b) => (a.position || MID_CHAR).localeCompare(b.position || MID_CHAR));
      localStorage.setItem('decay-todos', JSON.stringify(todos));
      if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
      lastSyncedState = JSON.parse(JSON.stringify(todos));
      // Only render if user is not actively editing to avoid disrupting input
      if (typeof window.render === 'function' && !isUserEditing()) {
        window.render();
      }
      console.log('[Sync] Applied server merge results');
    }
  }

  // Sync local todos to server
  async function syncToServer(todos) {
    if (!syncEnabled) return;

    if (isSyncing) {
      // A sync is already in progress; mark as pending so it runs after
      syncPending = true;
      pendingSyncTodos = todos;
      return;
    }

    isSyncing = true;
    try {
      await syncChanges(todos);
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
    } finally {
      isSyncing = false;

      // If another sync was requested while we were busy, run it now
      if (syncPending) {
        syncPending = false;
        const todosToSync = pendingSyncTodos;
        pendingSyncTodos = null;
        syncToServer(todosToSync);
      }
    }
  }

  // Debounced server sync
  function queueServerSync(todos) {
    if (serverSyncTimer) {
      clearTimeout(serverSyncTimer);
    }

    serverSyncTimer = setTimeout(() => {
      serverSyncTimer = null;
      syncToServer(todos);
    }, SERVER_SYNC_DEBOUNCE_MS);
  }

  // Check if user is actively editing
  function isUserEditing() {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    return activeElement.isContentEditable ||
           activeElement.tagName === 'INPUT' ||
           activeElement.tagName === 'TEXTAREA';
  }

  // Handle realtime changes from other devices
  function handleRealtimeChange(payload) {
    const itemId = payload.new?.id || payload.old?.id;
    const eventKey = `${payload.eventType}:${itemId}`;

    // Ignore our own changes (match by event type + ID to allow different operations)
    if (itemId && recentlySyncedIds.has(eventKey)) {
      return; // Silent ignore - no log spam
    }

    console.log('[Sync] Remote:', payload.eventType, payload.new?.text?.substring(0, 20) || itemId?.substring(0, 8));

    // If user is editing, queue the update
    if (isUserEditing()) {
      pendingRemoteUpdates.push(payload);
      return;
    }

    applyRemoteChange(payload);
  }

  // Per-field merge: take the newer value for each field
  function mergeLocalWithRemote(local, remote) {
    const merged = { ...local };

    // Text field
    if ((remote.textUpdatedAt || 0) > (local.textUpdatedAt || 0)) {
      merged.text = remote.text;
      merged.textUpdatedAt = remote.textUpdatedAt;
    }

    // Important field
    if ((remote.importantUpdatedAt || 0) > (local.importantUpdatedAt || 0)) {
      merged.important = remote.important;
      merged.importantUpdatedAt = remote.importantUpdatedAt;
    }

    // Completed field
    if ((remote.completedUpdatedAt || 0) > (local.completedUpdatedAt || 0)) {
      merged.completed = remote.completed;
      merged.completedAt = remote.completedAt;
      merged.completedUpdatedAt = remote.completedUpdatedAt;
    }

    // Position field
    if ((remote.positionUpdatedAt || 0) > (local.positionUpdatedAt || 0)) {
      merged.position = remote.position;
      merged.positionUpdatedAt = remote.positionUpdatedAt;
    }

    // Type field
    if ((remote.typeUpdatedAt || 0) > (local.typeUpdatedAt || 0)) {
      merged.type = remote.type;
      merged.typeUpdatedAt = remote.typeUpdatedAt;
    }

    // Level field
    if ((remote.levelUpdatedAt || 0) > (local.levelUpdatedAt || 0)) {
      merged.level = remote.level;
      merged.levelUpdatedAt = remote.levelUpdatedAt;
    }

    // Indented field
    if ((remote.indentedUpdatedAt || 0) > (local.indentedUpdatedAt || 0)) {
      merged.indented = remote.indented;
      merged.indentedUpdatedAt = remote.indentedUpdatedAt;
    }

    return merged;
  }

  // Apply a single remote change
  function applyRemoteChange(payload) {
    const stored = localStorage.getItem('decay-todos');
    const todos = stored ? JSON.parse(stored) : [];
    let changed = false;

    if (payload.eventType === 'INSERT') {
      const newItem = toLocalFormat(payload.new);
      // Check if item exists by serverUuid or direct ID
      const { index: existingIndex } = findItemByUUID(todos, newItem.id);
      if (existingIndex < 0) {
        // Insert in correct position based on fractional index
        let insertIndex = todos.length;
        for (let i = 0; i < todos.length; i++) {
          if ((todos[i].position || MID_CHAR) > (newItem.position || MID_CHAR)) {
            insertIndex = i;
            break;
          }
        }
        newItem.serverUuid = newItem.id;
        todos.splice(insertIndex, 0, newItem);
        changed = true;
        console.log('[Sync] + Added:', newItem.text.substring(0, 30));
      }
    } else if (payload.eventType === 'UPDATE') {
      const remoteItem = toLocalFormat(payload.new);
      // Find item by UUID (checks serverUuid property and direct ID)
      const { index, item: localItem } = findItemByUUID(todos, remoteItem.id);
      if (index >= 0 && localItem) {
        // Per-field merge
        const merged = mergeLocalWithRemote(localItem, remoteItem);
        // Preserve the local ID (don't overwrite with UUID)
        merged.id = localItem.id;
        if (itemHash(localItem) !== itemHash(merged) ||
            localItem.position !== merged.position) {
          todos[index] = merged;
          // Re-sort by position if position changed
          todos.sort((a, b) => (a.position || MID_CHAR).localeCompare(b.position || MID_CHAR));
          changed = true;
          console.log('[Sync] ~ Updated:', merged.text.substring(0, 30));
        }
      }
    } else if (payload.eventType === 'DELETE') {
      const deletedId = payload.old?.id;
      // Find item by UUID (checks serverUuid property and direct ID)
      const { index } = findItemByUUID(todos, deletedId);
      if (index >= 0) {
        todos.splice(index, 1);
        changed = true;
        console.log('[Sync] - Deleted:', deletedId.substring(0, 8));
      }
    }

    if (changed) {
      localStorage.setItem('decay-todos', JSON.stringify(todos));
      if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
      // Update our synced state to include this remote change
      lastSyncedState = JSON.parse(JSON.stringify(todos));
      if (typeof window.render === 'function') {
        window.render();
      }
    }
  }

  // Apply all pending remote updates
  function applyPendingUpdates() {
    if (pendingRemoteUpdates.length === 0) return;

    console.log('[Sync] Applying', pendingRemoteUpdates.length, 'queued updates');
    const updates = pendingRemoteUpdates.slice();
    pendingRemoteUpdates = [];

    updates.forEach(applyRemoteChange);
  }

  // Fetch todos from server and merge with local state
  async function fetchAndMergeTodos() {
    if (!syncEnabled) return;

    try {
      const serverItems = await apiRequest('/api/items');

      if (!serverItems || !Array.isArray(serverItems)) {
        console.warn('[Sync] Invalid server response');
        return;
      }

      const currentLocal = JSON.parse(localStorage.getItem('decay-todos') || '[]');
      const matchedLocalIds = new Set();
      const merged = [];

      for (const serverItem of serverItems) {
        const remoteAsLocal = toLocalFormat(serverItem);
        const { item: localItem } = findItemByUUID(currentLocal, serverItem.id);

        if (localItem) {
          // Merge: local fields preserved, CRDT fields resolved by timestamp
          const mergedItem = mergeLocalWithRemote(localItem, remoteAsLocal);
          mergedItem.id = localItem.id;
          mergedItem.serverUuid = serverItem.id;
          merged.push(mergedItem);
          matchedLocalIds.add(localItem.id);
        } else {
          // New from server
          remoteAsLocal.serverUuid = remoteAsLocal.id;
          merged.push(remoteAsLocal);
        }
      }

      // Keep local-only items (unsynced new items)
      for (const localItem of currentLocal) {
        if (!matchedLocalIds.has(localItem.id)) {
          merged.push(localItem);
        }
      }

      // Sort by position and save
      merged.sort((a, b) => (a.position || MID_CHAR).localeCompare(b.position || MID_CHAR));
      localStorage.setItem('decay-todos', JSON.stringify(merged));
      if (typeof invalidateTodoCache === 'function') invalidateTodoCache();

      lastSyncedState = JSON.parse(JSON.stringify(merged));

      if (typeof window.render === 'function') {
        window.render();
      }

      console.log('[Sync] Merged', serverItems.length, 'server items with', currentLocal.length, 'local items');

    } catch (err) {
      console.error('[Sync] Fetch failed:', err);
    }
  }

  // Subscribe to realtime changes
  function subscribeToRealtime() {
    if (!supabaseClient || !syncEnabled) return;

    realtimeChannel = supabaseClient
      .channel('items-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items' },
        handleRealtimeChange
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

  // Enable sync
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
        // First time: push local items to server
        const existingData = localStorage.getItem('decay-todos');
        if (existingData) {
          const existingItems = JSON.parse(existingData);
          if (existingItems.length > 0) {
            console.log('[Sync] Initial sync:', existingItems.length, 'local items');
            // Assign initial positions if not present
            const positions = generateInitialPositions(existingItems.length);
            existingItems.forEach((item, index) => {
              if (!item.position) {
                item.position = positions[index];
                item.positionUpdatedAt = Date.now();
              }
            });
            // Mark all as recently synced to ignore INSERT echoes
            existingItems.forEach(item => {
              const uuid = getOrAssignUUID(item);
              const eventKey = `INSERT:${uuid}`;
              recentlySyncedIds.add(eventKey);
              setTimeout(() => recentlySyncedIds.delete(eventKey), RECENTLY_SYNCED_TTL_MS);
            });
            const dbItems = existingItems.map((item) => toDbFormat(item, item.position));
            const initialSyncResponse = await apiRequest('/api/sync', {
              method: 'POST',
              body: JSON.stringify({ items: dbItems }),
            });

            if (initialSyncResponse && initialSyncResponse.mergedItems && initialSyncResponse.mergedItems.length > 0) {
              applyMergedResponse(initialSyncResponse.mergedItems);
            }
            // Save updated items with positions
            localStorage.setItem('decay-todos', JSON.stringify(existingItems));
            if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
            lastSyncedState = JSON.parse(JSON.stringify(existingItems));
          }
        }
        localStorage.setItem('decay-todos-synced', 'true');
      }

      // Subscribe to realtime
      subscribeToRealtime();

      // Fetch latest from server
      await fetchAndMergeTodos();

      console.log('[Sync] ✓ Enabled');
      return true;

    } catch (err) {
      console.error('[Sync] Enable failed:', err);
      syncEnabled = false;
      return false;
    }
  }

  // Disable sync
  function disableSync() {
    syncEnabled = false;
    unsubscribeFromRealtime();
    console.log('[Sync] Disabled');
  }

  // Apply pending updates when user stops editing
  function setupBlurHandler() {
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!isUserEditing() && pendingRemoteUpdates.length > 0) {
          applyPendingUpdates();
        }
      }, 100);
    });
  }

  // Re-sync when connectivity returns
  function handleOnline() {
    if (!syncEnabled) return;
    console.log('[Sync] Online - re-syncing');
    const stored = localStorage.getItem('decay-todos');
    const todos = stored ? JSON.parse(stored) : [];
    queueServerSync(todos);
    // Fetch remote changes after the push sync completes
    // Delay beyond the debounce so local changes are pushed first
    setTimeout(fetchAndMergeTodos, SERVER_SYNC_DEBOUNCE_MS + 2000);
  }

  // Migrate from old idMapping localStorage key to serverUuid on items
  function migrateIdMapping() {
    const oldMapping = localStorage.getItem('decay-todos-id-mapping');
    if (!oldMapping) return;
    const mapping = JSON.parse(oldMapping);
    const stored = localStorage.getItem('decay-todos');
    if (!stored) {
      localStorage.removeItem('decay-todos-id-mapping');
      return;
    }
    const todos = JSON.parse(stored);
    let changed = false;
    for (const item of todos) {
      if (!item.serverUuid && mapping[item.id]) {
        item.serverUuid = mapping[item.id];
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem('decay-todos', JSON.stringify(todos));
      if (typeof invalidateTodoCache === 'function') invalidateTodoCache();
    }
    localStorage.removeItem('decay-todos-id-mapping');
  }

  // Initialize
  function init() {
    // Run migration before anything else (even in test mode, so tests can verify it)
    migrateIdMapping();

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
    refresh: fetchAndMergeTodos,
    getConfig: () => ({ ...getConfig() }),
    // Called by app.js saveTodos() to notify sync layer of changes
    onSave: function(todos) {
      if (syncEnabled) {
        queueServerSync(todos);
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
        const stored = localStorage.getItem('decay-todos');
        const todos = stored ? JSON.parse(stored) : [];
        return syncToServer(todos);
      },
      handleOnline: handleOnline,
      isSyncing: () => isSyncing,
      isSyncPending: () => syncPending,
      setIsSyncing: (val) => { isSyncing = val; },
      syncToServer: (todos) => syncToServer(todos),
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
