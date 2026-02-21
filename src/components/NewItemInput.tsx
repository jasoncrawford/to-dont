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
      const ae = () => {
        const a = document.activeElement;
        return a ? `${a.tagName}.${a.className}${a.id ? '#' + a.id : ''}` : 'null';
      };
      console.log('[NewItemInput Enter] text:', JSON.stringify(text), 'active:', ae());
      if (text.trim()) {
        console.log('[NewItemInput] before blur, active:', ae());
        inputRef.current?.blur();
        console.log('[NewItemInput] after blur, active:', ae());
        console.log('[NewItemInput] calling flushSync...');
        flushSync(() => {
          console.log('[NewItemInput] inside flushSync, calling onAdd');
          onAdd(text);
          console.log('[NewItemInput] onAdd returned, active:', ae());
        });
        console.log('[NewItemInput] flushSync returned, active:', ae());
        console.log('[NewItemInput] todoItems:', document.querySelectorAll('.todo-item').length);
        console.log('[NewItemInput] newItem display:', getComputedStyle(document.querySelector('.new-item')!).display);
        if (inputRef.current) {
          inputRef.current.textContent = '';
        }
        console.log('[NewItemInput] handler done, active:', ae());
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
