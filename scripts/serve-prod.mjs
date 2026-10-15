// Serves dist/ with the same headers and SPA rewrite as vercel.json, so the production build (CSP, caching,
// service worker) can be checked locally. Usage: npm run build && npm run preview:prod [port]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
// vercel.json "source" patterns used here are literal paths or end in (.*)
const SPECIAL = /[.+?^${}|[\]\\]/g;
const matcher = (source) => new RegExp('^' + source.split('(.*)').map(part => part.replace(SPECIAL, (c) => '\\' + c)).join('.*') + '$');
const rules = (config.headers ?? []).map(h => ({ re: matcher(h.source), headers: h.headers }));

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA rewrite
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
  for (const r of rules) if (r.re.test(path)) for (const { key, value } of r.headers) headers[key] = value;
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Serving dist/ with vercel.json headers at http://localhost:${port}`));
