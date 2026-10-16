import { useEffect, useRef, useState } from 'react';

interface Props {
  message: string;
  actionLabel: string;
  durationMs: number;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * A short-lived message with one action (Undo). It is announced by the app's live region, not by itself, so it is
 * never read twice. The timer pauses while the pointer or keyboard focus is on it, Escape dismisses it, and if focus
 * was inside it when it goes away, focus moves to the main content instead of being dropped. Ctrl/Cmd+Z triggers the action.
 */
export default function Toast({ message, actionLabel, durationMs, onAction, onDismiss }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs);
  const started = useRef(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const finish = (run: () => void) => {
    if (box.current?.contains(document.activeElement)) document.getElementById('main')?.focus();
    run();
  };

  useEffect(() => {
    if (paused) return;
    started.current = Date.now();
    const t = setTimeout(() => finish(() => dismissRef.current()), remaining.current);
    return () => { clearTimeout(t); remaining.current -= Date.now() - started.current; };
  }, [paused]);

  // Ctrl/Cmd+Z undoes while the toast is showing, like every other app. Text fields keep their own undo.
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      finish(() => actionRef.current());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      ref={box} className="toast" role="region" aria-label="Recent action"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onKeyDown={e => { if (e.key === 'Escape') finish(onDismiss); }}
    >
      <span className="toast-text">{message}</span>
      <button className="btn primary" aria-keyshortcuts="Control+Z Meta+Z" title="Ctrl+Z" onClick={() => finish(onAction)}>{actionLabel}</button>
      <button className="link" aria-label="Dismiss notification" onClick={() => finish(onDismiss)}>✕</button>
    </div>
  );
}
