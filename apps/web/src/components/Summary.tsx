export function Summary({ data }: { data: any }) {
  const reviewed = data.review?.reviewed ?? 0;
  const tiles: Array<[string, string]> = [
    ['Needs review', String(data.findingsByStatus?.needs_review ?? 0)],
    ['Auto-accepted', String(data.findingsByStatus?.auto_accepted ?? 0)],
    ['Reviewed', String(reviewed)],
    ['Reviewer agreed with AI', reviewed ? `${Math.round((data.review.confirmed / reviewed) * 100)}%` : '—'],
    ['Model tokens (in/out)', `${data.usage?.inputTokens ?? 0} / ${data.usage?.outputTokens ?? 0}`],
    ['Avg model latency', `${data.usage?.avgLatencyMs ?? 0} ms`],
  ];
  return (
    <section>
      <div className="tiles">{tiles.map(([k, v]) => <div key={k} className="tile"><div className="tile-v">{v}</div><div className="tile-k">{k}</div></div>)}</div>
      <h3>Reason codes</h3>
      <table className="compare">
        <tbody>{Object.entries(data.reasons ?? {}).map(([r, n]) => <tr key={r}><th scope="row">{r}</th><td>{String(n)}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
