import { useEffect, useRef } from 'react';

/** Index of the tab to move to for an arrow/Home/End key, or null when the key is not a tab-navigation key. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return (current + 1) % count;
    case 'ArrowLeft': case 'ArrowUp': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/**
 * Where Tab should land inside a trapped dialog. `current` is the index of the focused element among the
 * dialog's focusable elements, or -1 when focus is outside them (e.g. on the dialog itself).
 */
export function trapIndex(current: number, count: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.hidden && el.getClientRects().length > 0);
}

// Open dialogs, oldest first. Only the top one traps focus and answers Escape (a text box can open over a dialog).
const stack: symbol[] = [];
export const pushModal = (id: symbol) => { stack.push(id); };
export const popModal = (id: symbol) => { const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1); };
export const isTopModal = (id: symbol) => stack[stack.length - 1] === id;
export const modalDepth = () => stack.length;

/**
 * Dialog behaviour: move focus in on open, keep Tab inside, close on Escape, and put focus back on whatever
 * opened the dialog. Everything is released when the component unmounts.
 */
export function useModalA11y(ref: React.RefObject<HTMLElement>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const id = Symbol('modal');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pushModal(id);

    const first = focusableIn(root).find(el => el.getAttribute('aria-label') !== 'Close dialog') ?? root;
    first.focus();

    function onKey(e: KeyboardEvent) {
      if (!isTopModal(id)) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !root) return;
      const items = focusableIn(root);
      if (!items.length) { e.preventDefault(); root.focus(); return; }
      const at = items.indexOf(document.activeElement as HTMLElement);
      const to = trapIndex(at, items.length, e.shiftKey);
      // only take over when we would leave the dialog or wrap; otherwise let the browser move focus
      if (at < 0 || (e.shiftKey && at === 0) || (!e.shiftKey && at === items.length - 1)) { e.preventDefault(); items[to].focus(); }
    }
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      popModal(id);
      const back = opener && opener.isConnected ? opener : document.getElementById('main');
      back?.focus();
    };
  }, [ref]);
}
