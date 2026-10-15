import { describe, it, expect } from 'vitest';
import { nextTabIndex, trapIndex, pushModal, popModal, isTopModal, modalDepth } from './a11y';

describe('nextTabIndex (tab keyboard handling)', () => {
  it('moves right/left and wraps around', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });
  it('supports Home and End and the vertical arrows', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowUp', 0, 3)).toBe(2);
  });
  it('ignores other keys and empty lists', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
    expect(nextTabIndex('a', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
  it('a single tab stays put', () => {
    expect(nextTabIndex('ArrowRight', 0, 1)).toBe(0);
  });
});

describe('trapIndex (focus trap)', () => {
  it('cycles forward and backward inside the dialog', () => {
    expect(trapIndex(0, 3, false)).toBe(1);
    expect(trapIndex(2, 3, false)).toBe(0);
    expect(trapIndex(0, 3, true)).toBe(2);
    expect(trapIndex(2, 3, true)).toBe(1);
  });
  it('pulls focus in from outside (index -1)', () => {
    expect(trapIndex(-1, 3, false)).toBe(0);
    expect(trapIndex(-1, 3, true)).toBe(2);
  });
  it('has nowhere to go with no focusable elements', () => {
    expect(trapIndex(-1, 0, false)).toBe(-1);
  });
});

describe('modal stack', () => {
  it('only the newest dialog is on top, and it is released on removal', () => {
    const a = Symbol('a'), b = Symbol('b');
    const base = modalDepth();
    pushModal(a); pushModal(b);
    expect(isTopModal(b)).toBe(true);
    expect(isTopModal(a)).toBe(false);
    popModal(b);
    expect(isTopModal(a)).toBe(true);
    popModal(a);
    expect(modalDepth()).toBe(base);
  });
  it('removing an unknown dialog is harmless', () => {
    const base = modalDepth();
    popModal(Symbol('ghost'));
    expect(modalDepth()).toBe(base);
  });
});
