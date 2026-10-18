import Modal from './Modal';
import { SHORTCUTS } from './shortcuts';

/** The keyboard cheat sheet. Reachable from Settings and the footer as well as with the ? key. */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <p className="muted">Shortcuts work when you are not typing in a field and no dialog is open. Everything here also has a button.</p>
      <table className="restore-table">
        <caption className="sr-only">Keyboard shortcuts</caption>
        <thead><tr><th scope="col">Keys</th><th scope="col">What it does</th></tr></thead>
        <tbody>
          {SHORTCUTS.map(s => (
            <tr key={s.action}>
              <th scope="row">{s.keys.split(' then ').map((k, i) => <span key={k}>{i > 0 && ' then '}<kbd>{k}</kbd></span>)}</th>
              <td>{s.label}</td>
            </tr>
          ))}
          <tr><th scope="row"><kbd>Esc</kbd></th><td>Close a dialog, or leave select mode</td></tr>
          <tr><th scope="row"><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd></th><td>Undo the last action while the Undo bar is showing</td></tr>
        </tbody>
      </table>
      <div className="row-actions"><button className="btn primary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
