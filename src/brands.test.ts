import { describe, it, expect } from 'vitest';
import { brandFor, prefersLightInk, initialOf } from './brands';

describe('brandFor', () => {
  it('uses a bundled logo for well-known services', () => {
    for (const n of ['Netflix', 'NETFLIX.COM', 'Spotify', 'Apple', 'Jio', 'Dropbox', 'GitHub']) {
      const b = brandFor(n);
      expect(b.path, n).toBeTruthy();
      expect(b.hex).toMatch(/^[0-9a-f]{6}$/i);
    }
  });
  it('knows the brand colour for services with no bundled logo', () => {
    for (const [n, label] of [['Hulu', 'Hulu'], ['Amazon', 'Amazon Prime'], ['Hotstar', 'JioHotstar'], ['Planet', 'Planet Fitness'], ['Adobe Creative Cloud', 'Adobe']]) {
      const b = brandFor(n);
      expect(b.path).toBeUndefined();
      expect(b.label).toBe(label);
    }
  });
  it('prefers the more specific brand (Apple Music over Apple, YouTube Music over YouTube)', () => {
    expect(brandFor('Apple Music').label).toBe('Apple Music');
    expect(brandFor('YouTube Music').label).toBe('YouTube Music');
    expect(brandFor('iCloud+').label).toBe('iCloud');
  });
  it('gives unknown services a stable colour and a monogram', () => {
    const a = brandFor('Zorblax Weekly'), b = brandFor('Zorblax Weekly');
    expect(a).toEqual(b);
    expect(a.id).toBe('unknown');
    expect(initialOf(a.label)).toBe('Z');
  });
  it('picks readable ink for light and dark backgrounds', () => {
    expect(prefersLightInk('000000')).toBe(true);
    expect(prefersLightInk('FFFFFF')).toBe(false);
    expect(prefersLightInk('1ED760')).toBe(false);
  });
});
