import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { injectSw, precacheUrls } from './src/swBuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** After the build, stamp public/sw.js with a content-based version and the list of files to precache. */
function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'subsweep-sw-precache',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      const dir = resolve(outDir);
      const swPath = join(dir, 'sw.js');
      if (!existsSync(swPath)) return;
      const files = walk(dir).map(f => relative(dir, f).replace(/\\/g, '/')).filter(f => f !== 'sw.js');
      const hash = createHash('sha1');
      for (const f of [...files].sort()) { hash.update(f); hash.update(readFileSync(join(dir, f))); }
      const version = `${pkg.version}-${hash.digest('hex').slice(0, 8)}`;
      writeFileSync(swPath, injectSw(readFileSync(swPath, 'utf8'), version, precacheUrls(files)));
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPrecache()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { environment: 'node' },
});
