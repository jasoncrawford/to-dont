import { useRef, useCallback } from 'react';

interface UseContentEditableOptions {
  itemId: string;
  isImportant: boolean;
  onSave: (id: string, text: string) => void;
  onDebouncedSave: (id: string, text: string) => void;
  onImportantChange?: (id: string, newImportant: boolean) => void;
}

export function useContentEditable({
  itemId,
  isImportant,
  onSave,
  onDebouncedSave,
  onImportantChange,
}: UseContentEditableOptions) {
  const prevExclamationCountRef = useRef<number | null>(null);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    onSave(itemId, e.currentTarget.textContent || '');
  }, [itemId, onSave]);

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const text = el.textContent || '';
    onDebouncedSave(itemId, text);

    // Track exclamation marks for importance toggling
    if (onImportantChange) {
      const currentCount = (text.match(/!/g) || []).length;
      const prevCount = prevExclamationCountRef.current;

      if (prevCount !== null && currentCount !== prevCount) {
        // Typing a ! turns on important
        if (currentCount > prevCount && !isImportant) {
          onImportantChange(itemId, true);
        }
        // Deleting last ! turns off important
        if (currentCount === 0 && prevCount > 0 && isImportant) {
          onImportantChange(itemId, false);
        }
      }
      prevExclamationCountRef.current = currentCount;
    }
  }, [itemId, isImportant, onDebouncedSave, onImportantChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const plainText = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, plainText);
  }, []);

  // Initialize exclamation count on first render
  const initExclamationCount = useCallback((text: string) => {
    if (prevExclamationCountRef.current === null) {
      prevExclamationCountRef.current = (text.match(/!/g) || []).length;
    }
  }, []);

  return {
    handleBlur,
    handleInput,
    handlePaste,
    initExclamationCount,
  };
}
