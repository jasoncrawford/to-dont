// Event Log for To-Don't
// Client-side event sourcing: all mutations are recorded as events.
// Current state is derived by projecting (replaying) the event log.
// The materialized state is cached in localStorage 'decay-todos' for
// backward compatibility with existing code that reads it.

(function() {
  'use strict';

  const EVENTS_KEY = 'decay-events';
  const TODOS_KEY = 'decay-todos';
  const CLIENT_ID_KEY = 'decay-client-id';

  // In-memory cache for the event log JSON string (same pattern as _todosCacheJson)
  let _eventsCacheJson = null;
  let _eventsCache = null;

  // ============================================
  // Client ID
  // ============================================

  function getOrCreateClientId() {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
      clientId = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, clientId);
    }
    return clientId;
  }

  const clientId = getOrCreateClientId();

  // ============================================
  // Event Log Storage
  // ============================================

  function loadEvents() {
    const data = localStorage.getItem(EVENTS_KEY);
    if (!data) {
      _eventsCacheJson = null;
      _eventsCache = null;
      return [];
    }
    if (_eventsCacheJson !== null && data === _eventsCacheJson) {
      return structuredClone(_eventsCache);
    }
    _eventsCacheJson = data;
    _eventsCache = JSON.parse(data);
    return structuredClone(_eventsCache);
  }

  function saveEvents(events) {
    const json = JSON.stringify(events);
    localStorage.setItem(EVENTS_KEY, json);
    _eventsCacheJson = json;
    _eventsCache = events;
  }

  // ============================================
  // Event Creation
  // ============================================

  function createEvent(type, itemId, field, value) {
    const now = (typeof window.getVirtualNow === 'function')
      ? window.getVirtualNow()
      : Date.now();

    return {
      id: crypto.randomUUID(),
      itemId: itemId,
      type: type,
      field: field || null,
      value: value,
      timestamp: now,
      clientId: clientId,
      seq: null, // Assigned by server on push
    };
  }

  // ============================================
  // State Projection
  // ============================================

  function projectState(events) {
    const items = new Map(); // itemId -> item

    for (const event of events) {
      if (event.type === 'item_created') {
        const val = event.value || {};
        items.set(event.itemId, {
          id: event.itemId,
          text: val.text || '',
          createdAt: val.createdAt || event.timestamp,
          important: val.important || false,
          completed: val.completed || false,
          completedAt: val.completedAt || undefined,
          archived: val.archived || false,
          archivedAt: val.archivedAt || undefined,
          position: val.position || 'n',
          type: val.type || undefined,
          level: val.level || undefined,
          indented: val.indented || false,
          // Track per-field timestamps for LWW
          textUpdatedAt: val.textUpdatedAt || event.timestamp,
          importantUpdatedAt: val.importantUpdatedAt || event.timestamp,
          completedUpdatedAt: val.completedUpdatedAt || event.timestamp,
          positionUpdatedAt: val.positionUpdatedAt || event.timestamp,
          typeUpdatedAt: val.typeUpdatedAt || event.timestamp,
          levelUpdatedAt: val.levelUpdatedAt || event.timestamp,
          indentedUpdatedAt: val.indentedUpdatedAt || event.timestamp,
          archivedUpdatedAt: val.archivedUpdatedAt || event.timestamp,
        });
      } else if (event.type === 'field_changed') {
        const item = items.get(event.itemId);
        if (!item) continue;

        const field = event.field;
        const tsKey = field + 'UpdatedAt';

        // LWW check: only apply if this event is newer
        if (item[tsKey] !== undefined && event.timestamp < item[tsKey]) continue;

        // Apply field change
        switch (field) {
          case 'text':
            item.text = event.value;
            item.textUpdatedAt = event.timestamp;
            break;
          case 'important':
            item.important = event.value;
            item.importantUpdatedAt = event.timestamp;
            break;
          case 'completed':
            item.completed = event.value;
            if (event.value) {
              item.completedAt = event.timestamp;
            } else {
              delete item.completedAt;
            }
            item.completedUpdatedAt = event.timestamp;
            break;
          case 'position':
            item.position = event.value;
            item.positionUpdatedAt = event.timestamp;
            break;
          case 'type':
            item.type = event.value;
            item.typeUpdatedAt = event.timestamp;
            break;
          case 'level':
            item.level = event.value;
            item.levelUpdatedAt = event.timestamp;
            break;
          case 'indented':
            item.indented = event.value;
            item.indentedUpdatedAt = event.timestamp;
            break;
          case 'archived':
            item.archived = event.value;
            if (event.value) {
              item.archivedAt = event.timestamp;
            } else {
              item.archivedAt = null;
            }
            item.archivedUpdatedAt = event.timestamp;
            break;
        }
      } else if (event.type === 'item_deleted') {
        items.delete(event.itemId);
      }
    }

    // Convert to array and sort by position
    const result = Array.from(items.values());
    result.sort((a, b) => (a.position || 'n').localeCompare(b.position || 'n') || a.id.localeCompare(b.id));
    return result;
  }

  // ============================================
  // Core Append
  // ============================================

  function appendEvents(newEvents) {
    const events = loadEvents();
    events.push(...newEvents);
    saveEvents(events);

    // Re-project and materialize state
    const state = projectState(events);
    materializeState(state);

    // Notify sync layer (backward compat via onSave)
    if (window.ToDoSync && window.ToDoSync.onSave) {
      window.ToDoSync.onSave(state);
    }
    // New hook for event-based sync (Issue C)
    if (window.ToDoSync && window.ToDoSync.onEventsAppended) {
      window.ToDoSync.onEventsAppended(newEvents);
    }
  }

  function materializeState(state) {
    // Preserve serverUuid from existing stored state (set by sync.js old path)
    const existing = localStorage.getItem(TODOS_KEY);
    if (existing) {
      const existingTodos = JSON.parse(existing);
      const uuidMap = new Map();
      for (const t of existingTodos) {
        if (t.serverUuid) uuidMap.set(t.id, t.serverUuid);
      }
      for (const item of state) {
        if (!item.serverUuid && uuidMap.has(item.id)) {
          item.serverUuid = uuidMap.get(item.id);
        }
      }
    }
    const json = JSON.stringify(state);
    localStorage.setItem(TODOS_KEY, json);
    // Update the app.js cache so loadTodos() sees fresh data
    if (typeof invalidateTodoCache === 'function') {
      invalidateTodoCache();
    }
  }

  // ============================================
  // High-level Mutation API
  // ============================================

  function emitItemCreated(itemId, initialState) {
    const event = createEvent('item_created', itemId, null, initialState);
    appendEvents([event]);
  }

  function emitFieldChanged(itemId, field, value) {
    const event = createEvent('field_changed', itemId, field, value);
    appendEvents([event]);
  }

  function emitFieldsChanged(changes) {
    // changes: [{ itemId, field, value }, ...]
    const events = changes.map(c => createEvent('field_changed', c.itemId, c.field, c.value));
    appendEvents(events);
  }

  function emitItemDeleted(itemId) {
    const event = createEvent('item_deleted', itemId, null, null);
    appendEvents([event]);
  }

  function emitBatch(eventSpecs) {
    // eventSpecs: [{ type, itemId, field, value }, ...]
    const events = eventSpecs.map(s => createEvent(s.type, s.itemId, s.field || null, s.value));
    appendEvents(events);
  }

  // ============================================
  // Sync Helpers (for Issue C)
  // ============================================

  function getUnpushedEvents() {
    return loadEvents().filter(e => e.seq === null);
  }

  function markEventsPushed(seqMap) {
    // seqMap: { eventId: seq, ... }
    const events = loadEvents();
    let changed = false;
    for (const event of events) {
      if (seqMap[event.id] !== undefined) {
        event.seq = seqMap[event.id];
        changed = true;
      }
    }
    if (changed) saveEvents(events);
  }

  function appendRemoteEvents(remoteEvents) {
    // Append events from server (already have seq), de-duplicate by ID
    const events = loadEvents();
    const existingIds = new Set(events.map(e => e.id));
    const newEvents = remoteEvents.filter(e => !existingIds.has(e.id));
    if (newEvents.length === 0) return;

    events.push(...newEvents);
    saveEvents(events);

    // Re-project and materialize
    const state = projectState(events);
    materializeState(state);
  }

  // ============================================
  // Log Compaction
  // ============================================

  function compactEvents() {
    const events = loadEvents();
    if (events.length === 0) return;

    // Keep unsynced events — they haven't reached the server yet
    const unsynced = events.filter(e => e.seq === null);

    // Project current state from ALL events
    const state = projectState(events);

    // Create one synthetic item_created per live item, capturing full state
    const syntheticEvents = state.map(item => ({
      id: crypto.randomUUID(),
      itemId: item.id,
      type: 'item_created',
      field: null,
      value: {
        text: item.text,
        createdAt: item.createdAt,
        important: item.important,
        completed: item.completed,
        completedAt: item.completedAt,
        archived: item.archived,
        archivedAt: item.archivedAt,
        position: item.position,
        type: item.type,
        level: item.level,
        indented: item.indented,
        textUpdatedAt: item.textUpdatedAt,
        importantUpdatedAt: item.importantUpdatedAt,
        completedUpdatedAt: item.completedUpdatedAt,
        positionUpdatedAt: item.positionUpdatedAt,
        typeUpdatedAt: item.typeUpdatedAt,
        levelUpdatedAt: item.levelUpdatedAt,
        indentedUpdatedAt: item.indentedUpdatedAt,
        archivedUpdatedAt: item.archivedUpdatedAt,
      },
      timestamp: item.createdAt,
      clientId: clientId,
      seq: 0, // Marks as already synced
    }));

    // New log = snapshots + unsynced edits
    const compacted = syntheticEvents.concat(unsynced);
    saveEvents(compacted);

    console.log('[EventLog] Compacted', events.length, 'events to', compacted.length,
      '(' + syntheticEvents.length, 'snapshots +', unsynced.length, 'unsynced)');
  }

  // ============================================
  // Migration from existing state
  // ============================================

  function migrateFromState() {
    // If we already have events, no migration needed
    const existingEvents = localStorage.getItem(EVENTS_KEY);
    if (existingEvents && JSON.parse(existingEvents).length > 0) return false;

    // If we have existing todos, generate synthetic events
    const existingTodos = localStorage.getItem(TODOS_KEY);
    if (!existingTodos) return false;

    const todos = JSON.parse(existingTodos);
    if (todos.length === 0) return false;

    const events = [];

    for (const todo of todos) {
      // Use existing ID as the event itemId — preserves old IDs during transition
      const itemId = todo.id;

      // Create item_created event
      events.push({
        id: crypto.randomUUID(),
        itemId: itemId,
        type: 'item_created',
        field: null,
        value: {
          text: todo.text || '',
          position: todo.position || 'n',
          type: todo.type || undefined,
          level: todo.level || undefined,
          indented: todo.indented || false,
          important: todo.important || false,
          archived: todo.archived || false,
        },
        timestamp: todo.createdAt || Date.now(),
        clientId: clientId,
        seq: null,
      });

      // If completed, add field_changed event
      if (todo.completed) {
        events.push({
          id: crypto.randomUUID(),
          itemId: itemId,
          type: 'field_changed',
          field: 'completed',
          value: true,
          timestamp: todo.completedUpdatedAt || todo.completedAt || Date.now(),
          clientId: clientId,
          seq: null,
        });
      }
    }

    saveEvents(events);

    // Re-project and materialize. Preserve serverUuid and other sync fields
    // from the original items that projectState doesn't know about.
    const projected = projectState(events);
    const originalById = new Map(todos.map(t => [t.id, t]));
    for (const item of projected) {
      const orig = originalById.get(item.id);
      if (orig && orig.serverUuid) {
        item.serverUuid = orig.serverUuid;
      }
    }
    materializeState(projected);
    return true;
  }

  // ============================================
  // Initialization
  // ============================================

  // Run migration on load (idempotent)
  const migrated = migrateFromState();

  if (!migrated) {
    // Ensure materialized state is consistent with event log
    const initEvents = loadEvents();
    if (initEvents.length > 0) {
      const state = projectState(initEvents);
      // Preserve serverUuid from existing materialized state
      const existingTodos = localStorage.getItem(TODOS_KEY);
      if (existingTodos) {
        const existing = JSON.parse(existingTodos);
        const uuidById = new Map();
        for (const t of existing) {
          if (t.serverUuid) uuidById.set(t.id, t.serverUuid);
        }
        for (const item of state) {
          if (uuidById.has(item.id)) {
            item.serverUuid = uuidById.get(item.id);
          }
        }
      }
      materializeState(state);
    }
  }

  // ============================================
  // Public API
  // ============================================

  window.EventLog = {
    // Mutation API
    emitItemCreated: emitItemCreated,
    emitFieldChanged: emitFieldChanged,
    emitFieldsChanged: emitFieldsChanged,
    emitItemDeleted: emitItemDeleted,
    emitBatch: emitBatch,

    // State access
    loadState: function() {
      const data = localStorage.getItem(TODOS_KEY);
      return data ? JSON.parse(data) : [];
    },
    projectState: projectState,

    // Sync helpers
    getClientId: function() { return clientId; },
    loadEvents: loadEvents,
    getUnpushedEvents: getUnpushedEvents,
    markEventsPushed: markEventsPushed,
    appendRemoteEvents: appendRemoteEvents,
    compactEvents: compactEvents,
  };

})();
