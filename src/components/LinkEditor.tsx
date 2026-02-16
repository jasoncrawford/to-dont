import { useRef, useEffect, useCallback, useState } from 'react';

interface LinkEditorProps {
  rect: DOMRect;
  initialUrl: string;
  isEditing: boolean;
  onSubmit: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function LinkEditor({ rect, initialUrl, isEditing, onSubmit, onRemove, onClose }: LinkEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(initialUrl);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = url.trim();
      if (trimmed && /^(https?:\/\/|mailto:)/i.test(trimmed)) {
        onSubmit(trimmed);
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [url, onSubmit, onClose]);

  // Position below selection rect
  const top = rect.bottom + 4;
  const left = rect.left;

  return (
    <div
      ref={containerRef}
      className="link-editor"
      style={{ top, left }}
    >
      <input
        ref={inputRef}
        type="text"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Paste or type a URL..."
      />
      {isEditing && (
        <button className="remove-link" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  );
}
