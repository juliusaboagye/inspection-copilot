/**
 * The MCP server talks to the REST API with the *calling user's* token, so every tool
 * call is subject to the same Entra ID roles and audit as the UI. The model never gets
 * more access than the person using it.
 */
export interface InspectionApi {
  get<T = any>(path: string): Promise<T>;
  getBinary(path: string): Promise<{ data: Buffer; mediaType: string }>;
}

export class HttpInspectionApi implements InspectionApi {
  constructor(private baseUrl: string, private token?: string) {}
  private headers(): Record<string, string> { return this.token ? { authorization: `Bearer ${this.token}` } : {}; }
  async get<T>(path: string): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), { headers: this.headers() });
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
    return res.json() as Promise<T>;
  }
  async getBinary(path: string) {
    const res = await fetch(new URL(path, this.baseUrl), { headers: this.headers() });
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
    return { data: Buffer.from(await res.arrayBuffer()), mediaType: res.headers.get('content-type') ?? 'image/jpeg' };
  }
}
