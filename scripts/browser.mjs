// Shared by the one-off tooling scripts (icons, screenshots). Uses an installed Chrome/Edge: no browser download.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function launch(options = {}) {
  const executablePath = CANDIDATES.find(p => existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH to a browser executable.');
  return chromium.launch({ executablePath, headless: true, ...options });
}
