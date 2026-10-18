import type { PwaState } from './pwa';

interface Props {
  pwa: PwaState;
  version: string;
  hasSubscriptions: boolean;
  sampleLoaded: boolean;
  onInstall: () => void;
  onLoadSample: () => void;
  onRemoveSample: () => void;
  onShortcuts: () => void;
  onReview: () => void;
}

/** App-level settings: install, offline status, version and the demo data. */
export default function AppSettingsCard({ pwa, version, hasSubscriptions, sampleLoaded, onInstall, onLoadSample, onRemoveSample, onShortcuts, onReview }: Props) {
  return (
    <section className="card" id="app-settings" aria-labelledby="app-settings-title">
      <h2 id="app-settings-title">App</h2>
      <p className="muted">
        Version {version} · {pwa.online ? 'online' : 'offline'}. Once loaded, SubSweep works without a connection and
        keeps your data on this device.
      </p>

      {pwa.installed ? (
        <p className="notice">SubSweep is installed on this device.</p>
      ) : pwa.canInstall ? (
        <div className="actions"><button className="btn primary" onClick={onInstall}>Install app</button></div>
      ) : pwa.iosHint ? (
        <p className="muted">To install on iPhone or iPad, tap the Share button in Safari, then choose <b>Add to Home Screen</b>.</p>
      ) : (
        <p className="muted">If your browser supports installing web apps, look for an install option in its menu or address bar.</p>
      )}

      <h3 className="sub-h">Keyboard and review</h3>
      <div className="actions">
        <button className="btn" onClick={onShortcuts}>Keyboard shortcuts</button>
        <button className="btn" onClick={onReview}>Start monthly review</button>
      </div>

      <h3 className="sub-h">Sample data</h3>
      {sampleLoaded ? (
        <div className="actions">
          <button className="btn" onClick={onRemoveSample}>Remove sample data</button>
        </div>
      ) : (
        <>
          <p className="muted">Try SubSweep with fake subscriptions in INR, USD and EUR. It is clearly labelled, only works in an empty SubSweep so it never mixes with your own data, and you can remove it again.</p>
          <div className="actions">
            <button className="btn" onClick={onLoadSample} disabled={hasSubscriptions}>Load sample data</button>
          </div>
          {hasSubscriptions && <p className="muted"><small>Available only when there are no subscriptions yet.</small></p>}
        </>
      )}
    </section>
  );
}
