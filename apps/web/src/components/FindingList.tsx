import type { FindingRow } from '../types';

export function FindingList({ findings, selectedId, onSelect }: { findings: FindingRow[]; selectedId?: number; onSelect: (id: number) => void }) {
  if (findings.length === 0) return <p className="muted">Nothing here. 🎉</p>;
  return (
    <ul className="list" aria-label="Findings">
      {findings.map((f) => (
        <li key={f.id}>
          <button className={f.id === selectedId ? 'item selected' : 'item'} onClick={() => onSelect(f.id)} aria-current={f.id === selectedId}>
            <span className={`dot sev-${f.severity}`} aria-hidden />
            <span className="item-main">
              <strong>{f.assetId}</strong> {f.value ?? '—'} {f.unit}
              <small>{new Date(f.capturedAt).toLocaleString()} · {f.reasons.length} reason(s)</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
