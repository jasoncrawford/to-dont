import { useRef, useCallback } from 'react';
import { isURL } from '../lib/sanitize';

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
    onSave(itemId, e.currentTarget.innerHTML || '');
  }, [itemId, onSave]);

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const html = el.innerHTML || '';
    onDebouncedSave(itemId, html);

    // Track exclamation marks for importance toggling (use textContent)
    const text = el.textContent || '';
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
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed;

    if (isURL(plainText)) {
      if (hasSelection) {
        // Wrap selected text with the pasted URL
        const range = sel!.getRangeAt(0);
        const anchor = document.createElement('a');
        anchor.href = plainText;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        anchor.appendChild(range.extractContents());
        range.insertNode(anchor);
        range.setStartAfter(anchor);
        range.collapse(true);
        sel!.removeAllRanges();
        sel!.addRange(range);
      } else {
        // Insert a linked URL
        const anchor = document.createElement('a');
        anchor.href = plainText;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        anchor.textContent = plainText;
        const range = sel?.getRangeAt(0);
        if (range) {
          range.deleteContents();
          range.insertNode(anchor);
          // Move cursor after the anchor
          range.setStartAfter(anchor);
          range.collapse(true);
          sel!.removeAllRanges();
          sel!.addRange(range);
        }
      }
    } else {
      // Insert plain text via Range API (replaces deprecated execCommand)
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(plainText));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    // Trigger save after paste
    const el = e.currentTarget;
    onDebouncedSave(itemId, el.innerHTML || '');
  }, [itemId, onDebouncedSave]);

  // Initialize exclamation count on first render
  const initExclamationCount = useCallback((text: string) => {
    if (prevExclamationCountRef.current === null) {
      // Strip HTML for counting
      const div = document.createElement('div');
      div.innerHTML = text;
      const plain = div.textContent || '';
      prevExclamationCountRef.current = (plain.match(/!/g) || []).length;
    }
  }, []);

  return {
    handleBlur,
    handleInput,
    handlePaste,
    initExclamationCount,
  };
}
