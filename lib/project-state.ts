// Shared event projection logic used by both client (event-log.js) and server (api/state).
// Events must have camelCase keys (use fromDbEvent() for DB rows first).

interface ProjectEvent {
  itemId: string;
  type: 'item_created' | 'field_changed' | 'item_deleted';
  field: string | null;
  value: any;
  timestamp: number;
}

export function projectState(events: ProjectEvent[]): any[] {
  const items = new Map<string, any>();

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
        type: val.type || 'todo',
        level: val.level || null,
        indented: val.indented || false,
        textUpdatedAt: val.textUpdatedAt || event.timestamp,
        importantUpdatedAt: val.importantUpdatedAt || event.timestamp,
        completedUpdatedAt: val.completedUpdatedAt || event.timestamp,
        positionUpdatedAt: val.positionUpdatedAt || event.timestamp,
        typeUpdatedAt: val.typeUpdatedAt || event.timestamp,
        levelUpdatedAt: val.levelUpdatedAt || event.timestamp,
        indentedUpdatedAt: val.indentedUpdatedAt || event.timestamp,
        archivedUpdatedAt: val.archivedUpdatedAt || event.timestamp,
        parentId: val.parentId !== undefined ? val.parentId : null,
        parentIdUpdatedAt: val.parentIdUpdatedAt || event.timestamp,
      });
    } else if (event.type === 'field_changed') {
      const item = items.get(event.itemId);
      if (!item) continue;

      const field = event.field;
      const tsKey = field + 'UpdatedAt';

      // LWW check: only apply if this event is newer
      if (item[tsKey] !== undefined && event.timestamp < item[tsKey]) continue;

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
        case 'parentId':
          item.parentId = event.value;
          item.parentIdUpdatedAt = event.timestamp;
          break;
      }
    } else if (event.type === 'item_deleted') {
      items.delete(event.itemId);
    }
  }

  // Orphan detection: if an item's parentId points to a non-existent item, reparent to root
  for (const item of items.values()) {
    if (item.parentId && !items.has(item.parentId)) {
      item.parentId = null;
    }
  }

  // Group items by parentId
  const childrenByParent = new Map<string | null, any[]>();
  for (const item of items.values()) {
    const pid = item.parentId || null;
    if (!childrenByParent.has(pid)) {
      childrenByParent.set(pid, []);
    }
    childrenByParent.get(pid)!.push(item);
  }

  // Sort each group by position (with id tiebreaker)
  const sortFn = (a: any, b: any) =>
    (a.position || 'n').localeCompare(b.position || 'n') || a.id.localeCompare(b.id);
  for (const group of childrenByParent.values()) {
    group.sort(sortFn);
  }

  // DFS traversal to flatten into ordered array
  const result: any[] = [];
  function visit(parentId: string | null) {
    const children = childrenByParent.get(parentId);
    if (!children) return;
    for (const item of children) {
      result.push(item);
      visit(item.id);
    }
  }
  visit(null);

  return result;
}
