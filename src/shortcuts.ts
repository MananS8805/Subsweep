import { useEffect, useRef } from 'react';
import { modalDepth } from './a11y';

export type ShortcutAction = 'add' | 'filter' | 'help' | 'review' | 'go-board' | 'go-yearly' | 'go-digest' | 'go-list';

export interface ShortcutDef { keys: string; action: ShortcutAction; label: string }
/** The single source of truth for the cheat sheet and for the key handling. */
export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'N', action: 'add', label: 'Quick-add a subscription' },
  { keys: '/', action: 'filter', label: 'Filter by name' },
  { keys: '?', action: 'help', label: 'Show this list' },
  { keys: 'R', action: 'review', label: 'Start the monthly review' },
  { keys: 'G then E', action: 'go-board', label: 'Go to Explore' },
  { keys: 'G then Y', action: 'go-yearly', label: 'Go to Yearly' },
  { keys: 'G then D', action: 'go-digest', label: 'Go to Next 30 days' },
  { keys: 'G then L', action: 'go-list', label: 'Go to List' },
];

const SEQUENCE: Record<string, ShortcutAction> = { e: 'go-board', y: 'go-yearly', d: 'go-digest', l: 'go-list' };
const SINGLE: Record<string, ShortcutAction> = { n: 'add', '/': 'filter', '?': 'help', r: 'review' };
export const SEQUENCE_TIMEOUT_MS = 1000;

export interface KeyLike {
  key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
  target?: unknown; defaultPrevented?: boolean; isComposing?: boolean; repeat?: boolean;
}

/** True when keystrokes belong to a text field, so a shortcut must not steal them. */
export function isTypingTarget(t: unknown): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null;
  if (!el || typeof el !== 'object') return false;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute?.('type') ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/**
 * Stateful key interpreter. `handle` returns the action a keypress triggers (or null) and tracks the "G then X" sequence.
 * `blocked` is checked per key, e.g. while a dialog is open, so shortcuts never act behind a modal.
 */
export function createShortcutEngine(opts: { now?: () => number; blocked?: () => boolean } = {}) {
  const now = opts.now ?? Date.now;
  let gAt = -Infinity;
  return {
    handle(e: KeyLike): ShortcutAction | null {
      if (e.defaultPrevented || e.isComposing || e.repeat) return null;
      if (e.ctrlKey || e.metaKey || e.altKey) { gAt = -Infinity; return null; }
      if (isTypingTarget(e.target) || opts.blocked?.()) { gAt = -Infinity; return null; }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (now() - gAt <= SEQUENCE_TIMEOUT_MS) {
        gAt = -Infinity;
        if (SEQUENCE[k]) return SEQUENCE[k];
        // any other key just behaves normally
      }
      if (k === 'g') { gAt = now(); return null; }
      return SINGLE[k] ?? null;
    },
    reset() { gAt = -Infinity; },
  };
}

/** Wire the engine to the window. `onAction` may change every render; the listener is installed once. */
export function useShortcuts(onAction: (a: ShortcutAction) => void, enabled = true) {
  const cb = useRef(onAction);
  cb.current = onAction;
  useEffect(() => {
    if (!enabled) return;
    const engine = createShortcutEngine({ blocked: () => modalDepth() > 0 });
    const onKey = (e: KeyboardEvent) => {
      const a = engine.handle(e);
      if (a) { e.preventDefault(); cb.current(a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
