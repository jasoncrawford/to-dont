// Event Log for To-Don't
// Client-side event sourcing: all mutations are recorded as events.
// Current state is derived by projecting (replaying) the event log.
// The materialized state is cached in localStorage 'decay-todos' for
// backward compatibility with existing code that reads it.

import { projectState } from '../../lib/project-state';

const EVENTS_KEY = 'decay-events';
const TODOS_KEY = 'decay-todos';
const CLIENT_ID_KEY = 'decay-client-id';

// In-memory cache for the event log JSON string
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
// Core Append
// ============================================

function appendEvents(newEvents) {
  const events = loadEvents();
  events.push(...newEvents);
  saveEvents(events);

  // Re-project and materialize state
  const state = projectState(events);
  materializeState(state);

  // Notify sync layer
  if (window.ToDoSync && window.ToDoSync.onEventsAppended) {
    window.ToDoSync.onEventsAppended(newEvents);
  }
}

function materializeState(state) {
  // Preserve serverUuid from existing stored state
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
  // Invalidate the store cache so React sees fresh data
  if (typeof window.invalidateTodoCache === 'function') {
    window.invalidateTodoCache();
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
  const events = changes.map(c => createEvent('field_changed', c.itemId, c.field, c.value));
  appendEvents(events);
}

function emitItemDeleted(itemId) {
  const event = createEvent('item_deleted', itemId, null, null);
  appendEvents([event]);
}

function emitBatch(eventSpecs) {
  const events = eventSpecs.map(s => createEvent(s.type, s.itemId, s.field || null, s.value));
  appendEvents(events);
}

// ============================================
// Sync Helpers
// ============================================

function getUnpushedEvents() {
  return loadEvents().filter(e => e.seq === null);
}

function markEventsPushed(seqMap) {
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

  const unsynced = events.filter(e => e.seq === null);
  const state = projectState(events);

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

  const compacted = syntheticEvents.concat(unsynced);
  saveEvents(compacted);

  console.log('[EventLog] Compacted', events.length, 'events to', compacted.length,
    '(' + syntheticEvents.length, 'snapshots +', unsynced.length, 'unsynced)');
}

// ============================================
// Migration from existing state
// ============================================

function migrateFromState() {
  const existingEvents = localStorage.getItem(EVENTS_KEY);
  if (existingEvents && JSON.parse(existingEvents).length > 0) return false;

  const existingTodos = localStorage.getItem(TODOS_KEY);
  if (!existingTodos) return false;

  const todos = JSON.parse(existingTodos);
  if (todos.length === 0) return false;

  const events = [];

  for (const todo of todos) {
    const itemId = todo.id;

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

const migrated = migrateFromState();

if (!migrated) {
  const initEvents = loadEvents();
  if (initEvents.length > 0) {
    const state = projectState(initEvents);
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

const EventLog = {
  // Mutation API
  emitItemCreated,
  emitFieldChanged,
  emitFieldsChanged,
  emitItemDeleted,
  emitBatch,

  // State access
  projectState,

  // Sync helpers
  getClientId: function() { return clientId; },
  loadEvents,
  getUnpushedEvents,
  markEventsPushed,
  appendRemoteEvents,
  compactEvents,
};

// Window global for backward compat (tests and sync.js use window.EventLog)
window.EventLog = EventLog;

export default EventLog;
