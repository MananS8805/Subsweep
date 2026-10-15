import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { precacheUrls, injectSw } from './swBuild';
import { isIosSafariUA } from './pwa';

const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('precacheUrls', () => {
  it('lists the shell with "/" first, public paths, sorted and de-duplicated', () => {
    expect(precacheUrls(['index.html', 'assets/index-abc.js', 'assets/index-abc.css', 'manifest.webmanifest', 'icons/icon-192.png', 'assets/index-abc.js']))
      .toEqual(['/', '/assets/index-abc.css', '/assets/index-abc.js', '/icons/icon-192.png', '/index.html', '/manifest.webmanifest']);
  });
  it('never precaches the worker itself or source maps', () => {
    const urls = precacheUrls(['sw.js', 'assets/a.js', 'assets/a.js.map']);
    expect(urls).toEqual(['/', '/assets/a.js']);
  });
  it('normalizes Windows separators', () => {
    expect(precacheUrls(['assets\\a.js'])).toEqual(['/', '/assets/a.js']);
  });
});

describe('injectSw (public/sw.js template)', () => {
  it('fills in the version and the precache list', () => {
    const out = injectSw(swSource, '0.5.0-abc12345', ['/', '/assets/a.js']);
    expect(out).toContain('const VERSION = "0.5.0-abc12345";');
    expect(out).toContain('const PRECACHE = ["/","/assets/a.js"];');
    expect(out).not.toContain("'__VERSION__'");
    expect(out).not.toContain('/*__PRECACHE__*/');
  });
  it('produces a different cache name for a different version', () => {
    const a = injectSw(swSource, '0.5.0-aaaa', ['/']), b = injectSw(swSource, '0.5.0-bbbb', ['/']);
    expect(a).not.toEqual(b);
    expect(a).toContain("'subsweep-' + VERSION");
  });
  it('refuses a template with a missing placeholder', () => {
    expect(() => injectSw('const VERSION = "x";', '1', [])).toThrow(/placeholder/);
  });
  it('replaces the real constants, not mentions in comments, and treats "$" literally', () => {
    const tpl = ["// mentions __VERSION__ and /*__PRECACHE__*/[] in a comment", "const VERSION = '__VERSION__';", 'const PRECACHE = /*__PRECACHE__*/[];'].join('\n');
    const out = injectSw(tpl, 'a$&b', ['/x$1']);
    expect(out).toContain('const VERSION = "a$&b";');
    expect(out).toContain('const PRECACHE = ["/x$1"];');
    expect(out.split('\n')[0]).toContain('__VERSION__'); // the comment is untouched
  });
});

describe('service worker policy (static checks on the template)', () => {
  it('does not auto-activate: skipWaiting only happens on a SKIP_WAITING message', () => {
    const calls = swSource.match(/skipWaiting\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(swSource).toMatch(/type === 'SKIP_WAITING'\) self\.skipWaiting\(\)/);
    expect(swSource).not.toMatch(/install[\s\S]{0,200}skipWaiting/);
  });
  it('deletes only its own old caches and never touches IndexedDB', () => {
    expect(swSource).toContain("k.startsWith('subsweep-') && k !== CACHE");
    const code = swSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/indexedDB/i);
  });
  it('uses cache-first for hashed assets and a network-first navigation fallback', () => {
    expect(swSource).toContain("pathname.startsWith('/assets/')");
    expect(swSource).toMatch(/mode === 'navigate'/);
  });
});

describe('isIosSafariUA', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1';
  const chromeDesktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36';
  it('is true only for Safari on iOS', () => {
    expect(isIosSafariUA(safari)).toBe(true);
    expect(isIosSafariUA(chromeIos)).toBe(false);
    expect(isIosSafariUA(chromeDesktop)).toBe(false);
  });
});
