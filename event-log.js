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
      // Return deep copy since callers may mutate
      return JSON.parse(_eventsCacheJson);
    }
    _eventsCacheJson = data;
    _eventsCache = JSON.parse(data);
    return JSON.parse(data);
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
          createdAt: event.timestamp,
          important: val.important || false,
          completed: false,
          archived: val.archived || false,
          position: val.position || 'n',
          type: val.type || undefined,
          level: val.level || undefined,
          indented: val.indented || false,
          // Track per-field timestamps for LWW
          textUpdatedAt: event.timestamp,
          importantUpdatedAt: event.timestamp,
          completedUpdatedAt: event.timestamp,
          positionUpdatedAt: event.timestamp,
          typeUpdatedAt: event.timestamp,
          levelUpdatedAt: event.timestamp,
          indentedUpdatedAt: event.timestamp,
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
            break;
        }
      } else if (event.type === 'item_deleted') {
        items.delete(event.itemId);
      }
    }

    // Convert to array and sort by position
    const result = Array.from(items.values());
    result.sort((a, b) => (a.position || 'n').localeCompare(b.position || 'n'));
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
  // Migration from existing state
  // ============================================

  function migrateFromState() {
    // If we already have events, no migration needed
    const existingEvents = localStorage.getItem(EVENTS_KEY);
    if (existingEvents && JSON.parse(existingEvents).length > 0) return;

    // If we have existing todos, generate synthetic events
    const existingTodos = localStorage.getItem(TODOS_KEY);
    if (!existingTodos) return;

    const todos = JSON.parse(existingTodos);
    if (todos.length === 0) return;

    const events = [];
    // Map from event itemId (UUID) back to original id for materialized state
    const idMap = new Map();

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
  }

  function isUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  }

  // ============================================
  // Initialization
  // ============================================

  // Run migration on load (idempotent)
  migrateFromState();

  // Always ensure materialized state is consistent with event log
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
  };

})();
