// Build-time helpers for the service worker. Pure functions so they can be unit tested; vite.config.ts wires them up.

/** Files that must never be precached: the worker itself, source maps and anything else that is not part of the shell. */
const SKIP = (f: string) => f === 'sw.js' || f.endsWith('.map');

/** URLs to precache for the app shell. "/" is the navigation entry, and every built file is listed by its public path. */
export function precacheUrls(files: string[]): string[] {
  const urls = files.filter(f => !SKIP(f)).map(f => '/' + f.replace(/\\/g, '/').replace(/^\/+/, ''));
  return ['/', ...[...new Set(urls)].sort()];
}

const VERSION_STMT = "const VERSION = '__VERSION__';";
const PRECACHE_STMT = 'const PRECACHE = /*__PRECACHE__*/[];';

/** Fill in the placeholders in public/sw.js. Throws if the template was changed and a statement is missing. */
export function injectSw(source: string, version: string, urls: string[]): string {
  if (!source.includes(VERSION_STMT) || !source.includes(PRECACHE_STMT)) {
    throw new Error('sw.js is missing its "const VERSION" or "const PRECACHE" placeholder statement');
  }
  // function replacers: a "$" in the version or a URL must not be read as a replacement pattern
  return source
    .replace(VERSION_STMT, () => `const VERSION = ${JSON.stringify(version)};`)
    .replace(PRECACHE_STMT, () => `const PRECACHE = ${JSON.stringify(urls)};`);
}
