import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createInspectionMcpServer } from './server';
import type { InspectionApi } from './api-client';

const day = (d: number) => new Date(Date.UTC(2026, 8, 1 + d)).toISOString();
const calls: string[] = [];
const fakeApi: InspectionApi = {
  async get(path: string): Promise<any> {
    calls.push(path);
    if (path === '/assets') return [{ id: 'PG-102', name: 'Feed pump P-102', unit: 'bar', normalMin: 6, normalMax: 10 }];
    if (path.startsWith('/assets/PG-102/history')) return [9, 8, 7].map((v, d) => ({ capturedAt: day(d), value: v, audioRmsDb: 65, severity: 'none' }));
    if (path.startsWith('/findings?')) return [{ id: 7, assetId: 'PG-102', status: 'needs_review', severity: 'high', value: 4, robotValue: 40, unit: 'bar', confidence: 0.9, reasons: ['robot_decimal_shift'], extra: 'dropped' }];
    throw new Error(`unexpected ${path}`);
  },
  async getBinary() { return { data: Buffer.from('jpeg-bytes'), mediaType: 'image/jpeg' }; },
};

let client: Client;
beforeAll(async () => {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createInspectionMcpServer(fakeApi).connect(serverT);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientT);
});

describe('inspection MCP server', () => {
  it('exposes only read-only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'analyse_asset_trend', 'get_finding', 'get_inspection_image', 'inspection_summary', 'list_assets', 'list_findings',
    ]);
  });

  it('passes filters to the API and returns compact rows', async () => {
    const res: any = await client.callTool({ name: 'list_findings', arguments: { status: 'needs_review', severity: 'high' } });
    expect(calls).toContain('/findings?status=needs_review&severity=high&limit=20');
    const rows = JSON.parse(res.content[0].text);
    expect(rows[0]).toMatchObject({ id: 7, aiValue: 4, robotValue: 40 });
    expect(rows[0].extra).toBeUndefined();
  });

  it('computes a trend with days to breach', async () => {
    const res: any = await client.callTool({ name: 'analyse_asset_trend', arguments: { assetId: 'PG-102', days: 7 } });
    const body = JSON.parse(res.content[0].text);
    expect(body.trend.direction).toBe('falling');
    expect(body.trend.daysToBreach).toBeCloseTo(1, 5);
  });

  it('returns an error result (not a crash) for an unknown asset', async () => {
    const res: any = await client.callTool({ name: 'analyse_asset_trend', arguments: { assetId: 'NOPE' } });
    expect(res.isError).toBe(true);
  });

  it('returns the photo as MCP image content', async () => {
    const res: any = await client.callTool({ name: 'get_inspection_image', arguments: { inspectionId: 'insp-1' } });
    expect(res.content[0]).toEqual({ type: 'image', data: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' });
  });

  it('offers a daily brief prompt', async () => {
    const p = await client.getPrompt({ name: 'daily_inspection_brief', arguments: {} });
    expect((p.messages[0]!.content as any).text).toMatch(/daily brief/);
  });
});
