export interface TodoItem {
  id: string;
  text: string;
  createdAt: number;
  important: boolean;
  completed: boolean;
  completedAt?: number;
  archived: boolean;
  archivedAt?: number;
  position: string;
  type?: 'section';
  level?: number;
  indented?: boolean;
  parentId?: string | null;       // ID of containing section, null for top-level
  serverUuid?: string;
  // CRDT per-field timestamps
  textUpdatedAt: number;
  importantUpdatedAt: number;
  completedUpdatedAt: number;
  positionUpdatedAt: number;
  typeUpdatedAt: number;
  levelUpdatedAt: number;
  indentedUpdatedAt: number;
  archivedUpdatedAt?: number;
  parentIdUpdatedAt?: number;      // CRDT timestamp for parentId
}

export type ViewMode = 'important' | 'active' | 'faded' | 'done';

declare global {
  interface Window {
    EventLog: {
      emitItemCreated: (itemId: string, value: Record<string, unknown>) => void;
      emitFieldChanged: (itemId: string, field: string, value: unknown) => void;
      emitFieldsChanged: (changes: Array<{ itemId: string; field: string; value: unknown }>) => void;
      emitItemDeleted: (itemId: string) => void;
      emitBatch: (specs: Array<{ type: string; itemId: string; field?: string; value?: unknown }>) => void;
      beginCapture: () => void;
      endCapture: () => Array<{ id: string; event: unknown }> | null;
      removeEventsByIds: (ids: string[]) => void;
      reappendEvents: (events: unknown[]) => void;
      projectState: (events: unknown[]) => TodoItem[];
      getClientId: () => string;
      loadEvents: () => unknown[];
      getUnpushedEvents: () => unknown[];
      markEventsPushed: (seqMap: Record<string, number>) => void;
      appendRemoteEvents: (events: unknown[]) => void;
      compactEvents: () => void;
    };
    ToDoSync: {
      enable: () => Promise<boolean>;
      disable: () => void;
      isEnabled: () => boolean;
      isConfigured: () => boolean;
      refresh: () => Promise<void>;
      getConfig: () => Record<string, string>;
      onEventsAppended: (events: unknown[]) => void;
      getStatus: () => { state: string; retryCount?: number; maxRetries?: number; nextRetryMs?: number };
      onStatusChange: (cb: (status: any) => void) => void;
      generatePositionBetween: (before: string | null, after: string | null) => string;
      generateInitialPositions: (count: number) => string[];
      _test?: Record<string, unknown>;
    };
    FractionalIndex: {
      generatePositionBetween: (before: string | null, after: string | null) => string;
      generateInitialPositions: (count: number) => string[];
    };
    loadTodos: () => TodoItem[];
    saveTodos: (todos: TodoItem[]) => void;
    invalidateTodoCache: () => void;
    getVirtualNow: () => number;
    render: () => void;
    SYNC_SUPABASE_URL?: string;
    SYNC_SUPABASE_ANON_KEY?: string;
    SYNC_SUPABASE_SCHEMA?: string;
    SYNC_API_URL?: string;
  }
}
