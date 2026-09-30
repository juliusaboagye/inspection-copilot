import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AnthropicVisionModel, FakeVisionModel, OpenAICompatibleVisionModel, type GroundTruth, type VisionModel } from '@ic/vision';
import type { AuthConfig } from './lib/auth';

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === '') throw new Error(`missing env ${k}`);
  return v;
};

export const config = {
  databaseUrl: () => env('DATABASE_URL', 'postgres://ic:ic@localhost:5432/ic'),
  imageDir: () => env('IMAGE_DIR', './data/uploads'),
  samples: () => Number(env('VISION_SAMPLES', '3')),
  port: () => Number(env('PORT', '3000')),
  auth: (): AuthConfig =>
    env('AUTH_MODE', 'none') === 'entra'
      ? { mode: 'entra', tenantId: env('ENTRA_TENANT_ID'), audience: env('ENTRA_API_CLIENT_ID') }
      : { mode: 'none' },
};

/** Pick the vision model from environment: fake (offline demo), anthropic, or openai-compatible (Azure OpenAI / vLLM / Ollama). */
export function visionModelFromEnv(datasetDir = path.resolve(process.cwd(), '../../data/synthetic')): VisionModel {
  const provider = env('VISION_PROVIDER', 'fake');
  if (provider === 'anthropic') {
    return new AnthropicVisionModel({ apiKey: env('ANTHROPIC_API_KEY'), model: env('ANTHROPIC_MODEL') });
  }
  if (provider === 'openai-compatible') {
    return new OpenAICompatibleVisionModel({
      baseUrl: env('OPENAI_BASE_URL'), apiKey: process.env.OPENAI_API_KEY, model: env('OPENAI_MODEL'),
      azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || undefined,
    });
  }
  return new FakeVisionModel(loadTruth(datasetDir));
}

export function loadTruth(datasetDir: string) {
  const labels: GroundTruth[] = JSON.parse(readFileSync(path.join(datasetDir, 'labels.json'), 'utf8'));
  const inspections: Array<{ inspectionId: string; assetId: string }> = JSON.parse(readFileSync(path.join(datasetDir, 'inspections.json'), 'utf8'));
  const assets: Array<{ id: string; scaleMin: number; scaleMax: number }> = JSON.parse(readFileSync(path.join(datasetDir, 'assets.json'), 'utf8'));
  const assetOf = new Map(inspections.map((i) => [i.inspectionId, assets.find((a) => a.id === i.assetId)!]));
  return new Map(labels.map((l) => [l.inspectionId, { ...l, scaleMin: assetOf.get(l.inspectionId)!.scaleMin, scaleMax: assetOf.get(l.inspectionId)!.scaleMax }]));
}
