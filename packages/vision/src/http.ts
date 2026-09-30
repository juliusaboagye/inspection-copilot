import { ProviderError } from './model';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PostOptions {
  retries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** POST JSON with timeout and exponential back-off on rate limits / transient errors. */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  { retries = 3, timeoutMs = 60_000, sleep = defaultSleep }: PostOptions = {},
): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) { await sleep(backoff(attempt)); continue; }
      throw new ProviderError(`network error: ${(err as Error).message}`, undefined, true);
    }
    clearTimeout(timer);
    if (res.ok) return res.json();
    const text = await res.text().catch(() => '');
    if (RETRYABLE.has(res.status) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
      continue;
    }
    throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, RETRYABLE.has(res.status));
  }
}

const backoff = (attempt: number) => 500 * 2 ** attempt + Math.floor(Math.random() * 250);
