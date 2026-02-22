import React, { useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';

interface NewItemInputProps {
  visible: boolean;
  onAdd: (text: string) => void;
}

export function NewItemInput({ visible, onAdd }: NewItemInputProps) {
  const inputRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = inputRef.current?.textContent || '';
      if (text.trim()) {
        // Blur first to release focus from this (soon-to-be-hidden) input
        inputRef.current?.blur();
        // flushSync forces the render + useLayoutEffect (which sets focus on
        // the new TodoItem) to complete synchronously within this handler.
        // Without this, React 18 batches the update and focus is set after
        // the handler returns, creating a window where the browser's layout
        // engine can interfere with focus on the hidden element.
        flushSync(() => {
          onAdd(text);
        });
        if (inputRef.current) {
          inputRef.current.textContent = '';
        }
      }
    }
  }, [onAdd]);

  return (
    <div className="new-item" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="checkbox"></div>
      <div
        className="text"
        contentEditable="true"
        suppressContentEditableWarning
        id="newItemInput"
        ref={inputRef}
        onKeyDown={handleKeyDown}
      ></div>
    </div>
  );
}
