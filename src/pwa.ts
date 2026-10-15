import { useSyncExternalStore } from 'react';

export interface PwaState {
  updateReady: boolean;   // a new service worker is installed and waiting
  canInstall: boolean;    // the browser offered an install prompt we can trigger
  installed: boolean;     // running as an installed app, or just installed
  online: boolean;
  iosHint: boolean;       // iOS Safari: no install prompt exists, so show "Add to Home Screen" instructions
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** True for Safari on iPhone/iPad (not Chrome/Firefox/Edge for iOS, which cannot add to the home screen the same way). */
export function isIosSafariUA(ua: string): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua);
  const other = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  return ios && !other && /Safari/.test(ua);
}

export const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

let waiting: ServiceWorker | null = null;
let deferred: InstallPromptEvent | null = null;
let reloading = false;
let state: PwaState = {
  updateReady: false, canInstall: false, installed: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine, iosHint: false,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };

function trackWaiting(reg: ServiceWorkerRegistration) {
  const check = () => { if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; set({ updateReady: true }); } };
  check();
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed') check(); });
  });
}

/** Register the service worker (production builds only). Failures are logged and never break the app. */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => set({ online: true }));
  window.addEventListener('offline', () => set({ online: false }));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; set({ canInstall: true }); });
  window.addEventListener('appinstalled', () => { deferred = null; set({ canInstall: false, installed: true, iosHint: false }); });
  set({ installed: isStandalone(), iosHint: isIosSafariUA(navigator.userAgent) && !isStandalone() });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) window.location.reload(); });
  const start = () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      trackWaiting(reg);
      // look for a new version whenever the app comes back to the foreground
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch((err) => console.warn('SubSweep: service worker registration failed', err));
  };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
}

/** Activate the waiting worker and reload once it takes control. Only ever called from a user action. */
export function applyUpdate(): void {
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  deferred = null;
  set({ canInstall: false });
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  if (outcome === 'accepted') set({ installed: true });
  return outcome;
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const usePwa = (): PwaState => useSyncExternalStore(subscribe, () => state, () => state);
