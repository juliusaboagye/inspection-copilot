import type { FindingDetail, FindingRow, ReviewInput } from './types';

export type TokenProvider = () => Promise<string | null>;
let getToken: TokenProvider = async () => null;
export const setTokenProvider = (fn: TokenProvider) => { getToken = fn; };

const BASE = import.meta.env.VITE_API_URL ?? '/api';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  findings: (status?: string) => request<FindingRow[]>(`/findings${status ? `?status=${status}` : ''}`),
  finding: (id: number) => request<FindingDetail>(`/findings/${id}`),
  review: (id: number, body: ReviewInput) => request<{ ok: true }>(`/findings/${id}/review`, { method: 'POST', body: JSON.stringify(body) }),
  summary: () => request<any>('/metrics/summary'),
  /** Image URL for <img>; in Entra mode fetch it with the token instead (see ImageWithAuth). */
  imagePath: (inspectionId: string) => `${BASE}/inspections/${encodeURIComponent(inspectionId)}/image`,
};
