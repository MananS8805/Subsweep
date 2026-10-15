// Renders the PNG app icons from the SVG sources. Run with: node scripts/icons.mjs
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';

const any = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const maskable = readFileSync(new URL('./icon-maskable.svg', import.meta.url), 'utf8');
const jobs = [
  ['public/icons/icon-192.png', any, 192, true],
  ['public/icons/icon-512.png', any, 512, true],
  ['public/icons/icon-maskable-512.png', maskable, 512, false],
  ['public/icons/apple-touch-icon.png', maskable, 180, false], // iOS rounds the corners itself
];

const browser = await launch();
const page = await browser.newPage();
for (const [path, svg, size, transparent] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL('../' + path, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', path);
}
await browser.close();
