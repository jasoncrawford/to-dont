import React, { useRef, useCallback } from 'react';

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
        onAdd(text);
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
