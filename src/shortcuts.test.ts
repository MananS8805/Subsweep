import { describe, it, expect } from 'vitest';
import { createShortcutEngine, isTypingTarget, SHORTCUTS } from './shortcuts';

const el = (tagName: string, attrs: Record<string, string> = {}, extra = {}) => ({ tagName, getAttribute: (n: string) => attrs[n] ?? null, ...extra });

describe('isTypingTarget', () => {
  it('treats text fields, textareas, selects and contenteditable as typing', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('DIV', {}, { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el('DIV', { role: 'textbox' }))).toBe(true);
  });
  it('does not treat buttons, checkboxes or the page as typing', () => {
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('shortcut engine', () => {
  const mk = (blocked = () => false) => { let t = 0; const e = createShortcutEngine({ now: () => t, blocked }); return { e, at: (ms: number) => { t = ms; } }; };
  it('maps single keys, case-insensitively', () => {
    const { e } = mk();
    expect(e.handle({ key: 'n' })).toBe('add');
    expect(e.handle({ key: 'N' })).toBe('add');
    expect(e.handle({ key: '/' })).toBe('filter');
    expect(e.handle({ key: '?' })).toBe('help');
    expect(e.handle({ key: 'r' })).toBe('review');
    expect(e.handle({ key: 'x' })).toBeNull();
  });
  it('ignores keys typed into fields and keys with modifiers', () => {
    const { e } = mk();
    expect(e.handle({ key: 'n', target: el('INPUT') })).toBeNull();
    expect(e.handle({ key: 'n', ctrlKey: true })).toBeNull();
    expect(e.handle({ key: 'n', metaKey: true })).toBeNull();
    expect(e.handle({ key: 'n', altKey: true })).toBeNull();
    expect(e.handle({ key: 'n', isComposing: true })).toBeNull();
    expect(e.handle({ key: 'n', defaultPrevented: true })).toBeNull();
  });
  it('does nothing while a dialog is open', () => {
    let open = true;
    const { e } = mk(() => open);
    expect(e.handle({ key: 'n' })).toBeNull();
    open = false;
    expect(e.handle({ key: 'n' })).toBe('add');
  });
  it('G then a view key navigates, within one second only', () => {
    const { e, at } = mk();
    at(0); expect(e.handle({ key: 'g' })).toBeNull();
    at(500); expect(e.handle({ key: 'l' })).toBe('go-list');
    at(1000); expect(e.handle({ key: 'g' })).toBeNull();
    at(2500); expect(e.handle({ key: 'l' })).toBeNull();
  });
  it('a sequence is cancelled by another key or by typing', () => {
    const { e, at } = mk();
    at(0); e.handle({ key: 'g' });
    expect(e.handle({ key: 'n' })).toBe('add');
    expect(e.handle({ key: 'l' })).toBeNull();
    e.handle({ key: 'g' });
    e.handle({ key: 'x', target: el('INPUT') });
    expect(e.handle({ key: 'y' })).toBeNull();
  });
  it('cheat sheet lists every action once', () => {
    expect(new Set(SHORTCUTS.map(s => s.action)).size).toBe(SHORTCUTS.length);
  });
});
