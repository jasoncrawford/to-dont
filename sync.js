// Sync layer for To-Don't
// Wraps localStorage operations to also sync with server via Supabase

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
  let syncInitialized = false;
  let supabaseClient = null;
  let realtimeChannel = null;
  let isSyncing = false;

  // Maps localStorage IDs to UUIDs
  let idMapping = JSON.parse(localStorage.getItem('decay-todos-id-mapping') || '{}');

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

  // Generate UUID for new items
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Get or create UUID for a localStorage item
  function getOrCreateUUID(localId) {
    if (!idMapping[localId]) {
      idMapping[localId] = generateUUID();
      localStorage.setItem('decay-todos-id-mapping', JSON.stringify(idMapping));
    }
    return idMapping[localId];
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
  function toDbFormat(item, sortOrder) {
    return {
      id: getOrCreateUUID(item.id),
      parent_id: null,
      type: item.type || 'todo',
      text: item.text || '',
      important: item.important || false,
      completed_at: item.completedAt ? new Date(item.completedAt).toISOString() : null,
      created_at: new Date(item.createdAt).toISOString(),
      sort_order: sortOrder,
      level: item.level || null,
    };
  }

  // Convert database item to localStorage format
  function toLocalFormat(dbItem) {
    return {
      id: dbItem.id,
      text: dbItem.text || '',
      createdAt: new Date(dbItem.created_at).getTime(),
      important: dbItem.important || false,
      completed: !!dbItem.completed_at,
      completedAt: dbItem.completed_at ? new Date(dbItem.completed_at).getTime() : undefined,
      archived: false,
      type: dbItem.type === 'section' ? 'section' : undefined,
      level: dbItem.level || undefined,
      indented: !!dbItem.parent_id,
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
    });
  }

  // Create a hash of an item for comparison (includes position for reorder detection)
  function itemHashWithPosition(item, position) {
    return JSON.stringify({
      id: item.id,
      text: item.text,
      important: item.important,
      completed: item.completed,
      completedAt: item.completedAt,
      type: item.type,
      position: position,
    });
  }

  // Create a snapshot of current state for comparison
  function createStateSnapshot(todos) {
    const snapshot = {
      itemHashes: new Map(),
      itemIds: new Set(),
    };
    todos.forEach((item, index) => {
      snapshot.itemHashes.set(item.id, itemHashWithPosition(item, index));
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
    currentTodos.forEach((item, index) => {
      const currentHash = itemHashWithPosition(item, index);
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

    // Handle modifications/additions via bulk sync
    if (modifiedItems.length > 0) {
      const dbItems = modifiedItems.map((item) => {
        const dbItem = toDbFormat(item, todos.indexOf(item));
        // Track this ID so we ignore the realtime echo
        recentlySyncedIds.add(dbItem.id);
        setTimeout(() => recentlySyncedIds.delete(dbItem.id), RECENTLY_SYNCED_TTL_MS);
        return dbItem;
      });

      await apiRequest('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ items: dbItems }),
      });
    }

    // Handle deletions
    for (const id of deletedIds) {
      // Track this ID so we ignore the realtime echo
      recentlySyncedIds.add(id);
      setTimeout(() => recentlySyncedIds.delete(id), RECENTLY_SYNCED_TTL_MS);

      try {
        await apiRequest(`/api/items/${id}`, { method: 'DELETE' });
      } catch (err) {
        // Item might already be deleted - that's OK
        console.log('[Sync] Delete may have already happened:', id.substring(0, 8));
      }
    }

    // Update last synced state
    lastSyncedState = JSON.parse(JSON.stringify(todos));

    console.log('[Sync] ✓ Done');
  }

  // Sync local todos to server
  async function syncToServer(todos) {
    if (!syncEnabled || isSyncing) return;

    isSyncing = true;
    try {
      await syncChanges(todos);
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
    } finally {
      isSyncing = false;
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

    // Ignore our own changes
    if (itemId && recentlySyncedIds.has(itemId)) {
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

  // Apply a single remote change
  function applyRemoteChange(payload) {
    const stored = localStorage.getItem('decay-todos');
    const todos = stored ? JSON.parse(stored) : [];
    let changed = false;

    if (payload.eventType === 'INSERT') {
      const newItem = toLocalFormat(payload.new);
      const exists = todos.some(t => t.id === newItem.id);
      if (!exists) {
        todos.push(newItem);
        idMapping[newItem.id] = newItem.id;
        localStorage.setItem('decay-todos-id-mapping', JSON.stringify(idMapping));
        changed = true;
        console.log('[Sync] + Added:', newItem.text.substring(0, 30));
      }
    } else if (payload.eventType === 'UPDATE') {
      const updatedItem = toLocalFormat(payload.new);
      const index = todos.findIndex(t => t.id === updatedItem.id);
      if (index >= 0) {
        // Only update if actually different
        if (itemHash(todos[index]) !== itemHash(updatedItem)) {
          todos[index] = updatedItem;
          changed = true;
          console.log('[Sync] ~ Updated:', updatedItem.text.substring(0, 30));
        }
      }
    } else if (payload.eventType === 'DELETE') {
      const deletedId = payload.old?.id;
      const index = todos.findIndex(t => t.id === deletedId);
      if (index >= 0) {
        todos.splice(index, 1);
        changed = true;
        console.log('[Sync] - Deleted:', deletedId.substring(0, 8));
      }
    }

    if (changed) {
      localStorage.setItem('decay-todos', JSON.stringify(todos));
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

  // Fetch todos from server (initial load only)
  async function fetchAndMergeTodos() {
    if (!syncEnabled) return;

    try {
      const serverItems = await apiRequest('/api/items');

      if (!serverItems || !Array.isArray(serverItems)) {
        console.warn('[Sync] Invalid server response');
        return;
      }

      const localItems = serverItems.map(toLocalFormat);
      localStorage.setItem('decay-todos', JSON.stringify(localItems));

      // Update ID mapping
      serverItems.forEach(item => {
        idMapping[item.id] = item.id;
      });
      localStorage.setItem('decay-todos-id-mapping', JSON.stringify(idMapping));

      // Set initial synced state
      lastSyncedState = JSON.parse(JSON.stringify(localItems));

      if (typeof window.render === 'function') {
        window.render();
      }

      console.log('[Sync] Loaded', serverItems.length, 'items from server');

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

      // Load ID mapping
      const storedMapping = localStorage.getItem('decay-todos-id-mapping');
      if (storedMapping) {
        idMapping = JSON.parse(storedMapping);
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
            // Mark all as recently synced to ignore echoes
            existingItems.forEach(item => {
              const uuid = getOrCreateUUID(item.id);
              recentlySyncedIds.add(uuid);
              setTimeout(() => recentlySyncedIds.delete(uuid), RECENTLY_SYNCED_TTL_MS);
            });
            const dbItems = existingItems.map((item, index) => toDbFormat(item, index));
            await apiRequest('/api/sync', {
              method: 'POST',
              body: JSON.stringify({ items: dbItems }),
            });
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

  // Wrap saveTodos to also sync to server
  function wrapSaveTodos() {
    const checkForSaveTodos = setInterval(() => {
      if (typeof window.saveTodos === 'function' && !window._originalSaveTodos) {
        clearInterval(checkForSaveTodos);

        window._originalSaveTodos = window.saveTodos;

        window.saveTodos = function(todos) {
          window._originalSaveTodos(todos);

          if (syncEnabled) {
            queueServerSync(todos);
          }
        };

        console.log('[Sync] ✓ Hooked saveTodos');
        syncInitialized = true;
      }
    }, 50);

    setTimeout(() => {
      clearInterval(checkForSaveTodos);
    }, 5000);
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

  // Initialize
  function init() {
    if (isTestMode) {
      console.log('[Sync] Test mode - disabled');
      return;
    }

    wrapSaveTodos();
    setupBlurHandler();

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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
