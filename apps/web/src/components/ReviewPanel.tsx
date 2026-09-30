import { useState } from 'react';
import { explainReason } from '../reasons';
import type { FindingDetail, ReviewInput } from '../types';

interface Props {
  finding: FindingDetail;
  imageUrl: string;
  onSubmit: (review: ReviewInput) => void;
  submitting?: boolean;
}

const fmt = (v: number | null | undefined, unit?: string | null) => (v === null || v === undefined ? '—' : `${v}${unit ? ` ${unit}` : ''}`);

export function ReviewPanel({ finding: f, imageUrl, onSubmit, submitting }: Props) {
  const [mode, setMode] = useState<'idle' | 'correct'>('idle');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const parsed = Number(value);
  const valueValid = value.trim() !== '' && Number.isFinite(parsed);
  const reviewed = f.status === 'reviewed';

  return (
    <section className="panel" aria-label={`Finding ${f.id}`}>
      <header className="panel-head">
        <h2>{f.assetName}</h2>
        <span className={`sev sev-${f.severity}`}>{f.severity === 'none' ? 'in band' : `${f.severity} severity`}</span>
      </header>
      <div className="panel-body">
        <img src={imageUrl} alt={`Robot photo for ${f.assetId}`} className="photo" />
        <div>
          <table className="compare">
            <thead><tr><th /><th>Robot</th><th>AI</th></tr></thead>
            <tbody>
              <tr><th scope="row">Reading</th><td>{fmt(f.robotValue, f.robotUnit)}</td><td>{fmt(f.value, f.unit)}</td></tr>
              <tr><th scope="row">Confidence</th><td>{Math.round(f.robotConfidence * 100)}%</td><td>{Math.round(f.confidence * 100)}%</td></tr>
            </tbody>
          </table>
          <p className="muted">Normal band {f.normalMin}–{f.normalMax} {f.unit}{f.audioRmsDb !== null ? ` · sound level ${f.audioRmsDb} dB` : ''}</p>
          <h3>Why this was flagged</h3>
          <ul className="reasons">
            {f.reasons.length === 0 ? <li>No issues found.</li> : f.reasons.map((r) => <li key={r}>{explainReason(r)}</li>)}
          </ul>
          {f.reading && (
            <details>
              <summary>Model samples ({f.reading.samples.length}) · {f.reading.model}</summary>
              <ol>{f.reading.samples.map((s, i) => <li key={i}>{s.readable ? fmt(s.value, f.unit) : 'unreadable'} — {s.notes}</li>)}</ol>
            </details>
          )}
        </div>
      </div>

      {reviewed ? (
        <p className="done" role="status">Reviewed: {f.reviewDecision}{f.reviewedValue !== null && f.reviewedValue !== undefined ? ` (${f.reviewedValue} ${f.unit})` : ''}</p>
      ) : (
        <form className="review" onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'correct' && valueValid) onSubmit({ decision: 'correct', value: parsed, note: note || undefined });
        }}>
          <label>Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
          <div className="actions">
            <button type="button" disabled={submitting || f.value === null} onClick={() => onSubmit({ decision: 'confirm', note: note || undefined })}>
              Confirm AI reading
            </button>
            <button type="button" disabled={submitting} onClick={() => setMode('correct')}>Correct value</button>
            <button type="button" disabled={submitting} onClick={() => onSubmit({ decision: 'unreadable', note: note || undefined })}>
              Mark unreadable
            </button>
          </div>
          {mode === 'correct' && (
            <div className="correct">
              <label>Correct value ({f.unit}) <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></label>
              <button type="submit" disabled={!valueValid || submitting}>Save correction</button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
