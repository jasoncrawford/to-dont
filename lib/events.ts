// Shared event types for the event sourcing system

export interface EventPayload {
  id: string;
  itemId: string;
  type: 'item_created' | 'field_changed' | 'item_deleted';
  field: string | null;
  value: any;
  timestamp: number;
  clientId: string;
}

export interface DbEvent {
  id: string;
  item_id: string;
  type: 'item_created' | 'field_changed' | 'item_deleted';
  field: string | null;
  value: any;
  timestamp: number;
  client_id: string;
  user_id?: string | null;
  seq: number;
  created_at: string;
}

export function toDbEvent(event: EventPayload): Omit<DbEvent, 'seq' | 'created_at'> {
  return {
    id: event.id,
    item_id: event.itemId,
    type: event.type,
    field: event.field,
    value: event.value,
    timestamp: event.timestamp,
    client_id: event.clientId,
  };
}

export function fromDbEvent(dbEvent: DbEvent): EventPayload & { seq: number } {
  return {
    id: dbEvent.id,
    itemId: dbEvent.item_id,
    type: dbEvent.type,
    field: dbEvent.field,
    value: dbEvent.value,
    timestamp: dbEvent.timestamp,
    clientId: dbEvent.client_id,
    seq: dbEvent.seq,
  };
}
