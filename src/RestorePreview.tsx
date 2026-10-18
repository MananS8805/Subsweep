import { useEffect, useId, useState } from 'react';
import Modal from './Modal';
import { defaultApplySettings, previewBackup, type ImportMode, type RestorePreview as Preview } from './backup';
import { settingLabel, settingText } from './settingsSchema';

interface Props {
  text: string;
  onRestore: (mode: ImportMode, applySettings: boolean) => void;
  onClose: () => void;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Shows exactly what a restore would change, and only changes anything when the person confirms. */
export default function RestorePreview({ text, onRestore, onClose }: Props) {
  const [mode, setMode] = useState<ImportMode>('merge');
  const [apply, setApply] = useState(defaultApplySettings('merge'));
  const [ack, setAck] = useState(false);
  const [p, setP] = useState<Preview | null>(null);
  const id = useId();

  useEffect(() => {
    let live = true;
    previewBackup(text, mode, { applySettings: apply }).then(r => { if (live) setP(r); });
    return () => { live = false; };
  }, [text, mode, apply]);

  const pick = (m: ImportMode) => { setMode(m); setApply(defaultApplySettings(m)); setAck(false); };

  if (!p) return <Modal title="Restore from backup" onClose={onClose}><p className="muted" role="status">Reading the file…</p></Modal>;

  if (!p.valid) {
    return (
      <Modal title="Restore from backup" onClose={onClose}>
        <p className="error" role="alert">This file cannot be restored.</p>
        <ul className="plain">{p.errors.map(e => <li key={e}>{e}</li>)}</ul>
        <p className="muted">Nothing was changed.</p>
        <div className="row-actions"><button className="btn primary" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }

  const { counts } = p;
  const replace = mode === 'replace';
  const settingsWillChange = p.settingsChanges.length > 0;
  return (
    <Modal title="Restore from backup" onClose={onClose} wide>
      <p>This file has <b>{plural(counts.subscriptionsInFile, 'subscription')}</b>. Nothing changes until you press the button below.</p>

      <fieldset className="mode-pick">
        <legend>How should it be restored?</legend>
        <label className="check-pill"><input type="radio" name={`${id}-mode`} checked={!replace} onChange={() => pick('merge')} /> Merge</label>
        <label className="check-pill"><input type="radio" name={`${id}-mode`} checked={replace} onChange={() => pick('replace')} /> Replace</label>
      </fieldset>

      <ul className="plain restore-counts" aria-label="What will happen to subscriptions">
        {replace ? <>
          <li><b>{plural(counts.toReplace, 'current subscription')}</b> will be deleted.</li>
          <li><b>{plural(counts.toAdd, 'subscription')}</b> will be loaded from the file.</li>
        </> : <>
          <li><b>{counts.toAdd}</b> will be added.</li>
          <li><b>{counts.toSkip}</b> will be skipped because they are already here.</li>
        </>}
      </ul>

      <h3 className="sub-h">Settings</h3>
      {!p.hasSettings ? (
        <p className="muted">This backup has no settings, so yours stay exactly as they are.</p>
      ) : (
        <>
          <label className="check"><input type="checkbox" checked={apply} onChange={e => setApply(e.target.checked)} />
            {replace ? ' Also restore the settings in this file' : ' Also overwrite my settings with the ones in this file'}</label>
          {!replace && !apply && <p className="muted"><small>Merge keeps the settings you already have. Settings you have not set yet are still filled in.</small></p>}
          {settingsWillChange || p.settingsKept.length ? (
            <table className="restore-table">
              <caption className="sr-only">Settings in the file compared with yours</caption>
              <thead><tr><th scope="col">Setting</th><th scope="col">Now</th><th scope="col">In the file</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {p.settingsChanges.map(c => <tr key={c.key}><th scope="row">{settingLabel(c.key)}</th><td>{settingText(c.key, c.from)}</td><td>{settingText(c.key, c.to)}</td><td>Will change</td></tr>)}
                {p.settingsKept.map(c => <tr key={c.key}><th scope="row">{settingLabel(c.key)}</th><td>{settingText(c.key, c.from)}</td><td>{settingText(c.key, c.to)}</td><td>Kept as it is</td></tr>)}
              </tbody>
            </table>
          ) : <p className="muted">The settings in this file already match yours.</p>}
        </>
      )}

      {p.warnings.length > 0 && (
        <div className="banner" role="note">
          <ul className="plain">{p.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {replace && (
        <label className="check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> I understand my current subscriptions will be deleted.</label>
      )}
      <div className="row-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={replace ? 'btn danger-btn' : 'btn primary'} disabled={replace && !ack} onClick={() => onRestore(mode, apply)}>
          {replace ? 'Replace and restore' : 'Merge into my data'}
        </button>
      </div>
    </Modal>
  );
}
