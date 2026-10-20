interface Props {
  onScan: () => void;
  onAdd: () => void;
  onSample: () => void;
  onSkip: () => void;
}

/** First-run panel for an empty SubSweep: three ways to start, and a plain statement of the privacy model. */
export default function Welcome({ onScan, onAdd, onSample, onSkip }: Props) {
  return (
    <section className="card welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">Welcome to SubSweep</h2>
      <p>Find out what your subscriptions really cost. Pick a way to start:</p>
      <ul className="welcome-actions">
        <li>
          <button className="btn primary" onClick={onScan}>Scan a bank statement CSV</button>
          <p className="muted">Export a CSV from your bank. SubSweep finds the repeating charges on this device.</p>
        </li>
        <li>
          <button className="btn" onClick={onAdd}>Add one manually</button>
          <p className="muted">Just a name, a price and the next renewal date.</p>
        </li>
        <li>
          <button className="btn" onClick={onSample}>Try with sample data</button>
          <p className="muted">Fake subscriptions in a few currencies, clearly labelled. Easy to remove.</p>
        </li>
      </ul>
      <p className="privacy-line"><b>Everything stays in this browser. Nothing is uploaded.</b></p>
      <div className="row-actions start"><button className="link" onClick={onSkip}>Skip</button></div>
    </section>
  );
}
