import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { trend } from '@ic/core';
import type { InspectionApi } from './api-client';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const qs = (o: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

/**
 * Read-only tools over the inspection data. Deliberately no write tools: reviewing a
 * finding stays a human action in the UI (least privilege for agents).
 */
export function createInspectionMcpServer(api: InspectionApi) {
  const server = new McpServer({ name: 'inspection-copilot', version: '0.1.0' });

  server.registerTool('list_assets', {
    title: 'List monitored assets',
    description: 'List every gauge/asset the robots inspect, with unit, scale and normal operating band.',
    inputSchema: {},
  }, async () => text(await api.get('/assets')));

  server.registerTool('list_findings', {
    title: 'List inspection findings',
    description: 'List AI inspection findings, most severe first. Filter by status (needs_review, auto_accepted, reviewed), severity (none, low, medium, high) or assetId.',
    inputSchema: {
      status: z.enum(['needs_review', 'auto_accepted', 'reviewed']).optional(),
      severity: z.enum(['none', 'low', 'medium', 'high']).optional(),
      assetId: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
  }, async (args) => {
    const rows: any[] = await api.get(`/findings?${qs(args)}`);
    // Keep responses compact: agents pay per token too.
    return text(rows.map((f) => ({
      id: f.id, assetId: f.assetId, capturedAt: f.capturedAt, status: f.status, severity: f.severity,
      aiValue: f.value, robotValue: f.robotValue, unit: f.unit, confidence: f.confidence, reasons: f.reasons,
    })));
  });

  server.registerTool('get_finding', {
    title: 'Get one finding in detail',
    description: 'Full detail for one finding: robot metadata vs AI reading, every model sample, reason codes and any human review.',
    inputSchema: { id: z.number().int() },
  }, async ({ id }) => text(await api.get(`/findings/${id}`)));

  server.registerTool('get_inspection_image', {
    title: 'View the inspection photo',
    description: 'Return the robot photo for an inspection so you can look at the gauge yourself.',
    inputSchema: { inspectionId: z.string() },
  }, async ({ inspectionId }) => {
    const img = await api.getBinary(`/inspections/${encodeURIComponent(inspectionId)}/image`);
    return { content: [{ type: 'image' as const, data: img.data.toString('base64'), mimeType: img.mediaType }] };
  });

  server.registerTool('analyse_asset_trend', {
    title: 'Trend and early warning for an asset',
    description: 'Fit a trend line to an asset\'s readings over recent days and estimate days until it leaves its normal band. Uses reviewed values where a human corrected the AI.',
    inputSchema: { assetId: z.string(), days: z.number().int().min(1).max(365).default(30) },
  }, async ({ assetId, days }) => {
    const [assets, history] = await Promise.all([
      api.get<any[]>('/assets'),
      api.get<any[]>(`/assets/${encodeURIComponent(assetId)}/history?days=${days}`),
    ]);
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return { ...text(`Unknown asset ${assetId}`), isError: true };
    const t = trend(history.map((h) => ({ at: h.capturedAt, value: h.value })), { min: asset.normalMin, max: asset.normalMax });
    return text({
      asset: { id: asset.id, name: asset.name, unit: asset.unit, normalMin: asset.normalMin, normalMax: asset.normalMax },
      readings: history.map((h) => ({ at: h.capturedAt, value: h.value, audioRmsDb: h.audioRmsDb, severity: h.severity })),
      trend: t ?? 'not enough readable data points (need 3)',
    });
  });

  server.registerTool('inspection_summary', {
    title: 'Programme summary',
    description: 'Counts of findings by status and severity, the most common reason codes (e.g. robot data faults), reviewer agreement with the AI, and model token usage.',
    inputSchema: {},
  }, async () => text(await api.get('/metrics/summary')));

  server.registerPrompt('daily_inspection_brief', {
    title: 'Daily inspection brief',
    description: 'Draft the morning brief for the operations team.',
    argsSchema: {},
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: 'Using the inspection tools, write a short daily brief for the operations team: (1) high and medium severity findings with the asset, value and why; (2) any asset trending towards its limits, with days to breach; (3) findings waiting for human review; (4) robot data-quality problems worth raising with the vendor. Cite finding IDs. Do not speculate beyond the data.',
      },
    }],
  }));

  return server;
}
