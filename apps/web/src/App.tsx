import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { FindingList } from './components/FindingList';
import { ReviewPanel } from './components/ReviewPanel';
import { Summary } from './components/Summary';
import type { ReviewInput } from './types';

type Tab = 'needs_review' | 'auto_accepted' | 'reviewed' | 'summary';
const TABS: Array<[Tab, string]> = [['needs_review', 'Review queue'], ['auto_accepted', 'Auto-accepted'], ['reviewed', 'Reviewed'], ['summary', 'Summary']];

export function App() {
  const [tab, setTab] = useState<Tab>('needs_review');
  const [selected, setSelected] = useState<number>();
  const qc = useQueryClient();

  const list = useQuery({ queryKey: ['findings', tab], queryFn: () => api.findings(tab), enabled: tab !== 'summary' });
  const detail = useQuery({ queryKey: ['finding', selected], queryFn: () => api.finding(selected!), enabled: selected !== undefined });
  const summary = useQuery({ queryKey: ['summary'], queryFn: api.summary, enabled: tab === 'summary' });
  const review = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ReviewInput }) => api.review(id, body),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="app">
      <header className="top">
        <h1>Inspection Copilot</h1>
        <nav>{TABS.map(([t, label]) => <button key={t} className={t === tab ? 'tab on' : 'tab'} onClick={() => { setTab(t); setSelected(undefined); }}>{label}</button>)}</nav>
      </header>
      {tab === 'summary' ? (
        summary.data ? <Summary data={summary.data} /> : <p>Loading…</p>
      ) : (
        <main className="split">
          <aside>{list.isLoading ? <p>Loading…</p> : list.error ? <p role="alert">{String(list.error)}</p> : <FindingList findings={list.data ?? []} selectedId={selected} onSelect={setSelected} />}</aside>
          <div>
            {detail.data ? (
              <ReviewPanel
                finding={detail.data}
                imageUrl={api.imagePath(detail.data.inspectionId)}
                submitting={review.isPending}
                onSubmit={(body) => review.mutate({ id: detail.data!.id, body })}
              />
            ) : <p className="muted">Select a finding.</p>}
          </div>
        </main>
      )}
    </div>
  );
}
