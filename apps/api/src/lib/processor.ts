import { reconcile, type Unit } from '@ic/core';
import { readWithConsensus, type VisionModel } from '@ic/vision';
import type { Db } from './db';
import type { ImageStore } from './images';
import * as repo from './repo';

export interface ProcessorDeps {
  db: Db;
  images: ImageStore;
  model: VisionModel;
  samples: number;
  maxAttempts?: number;
  log?: (msg: string, extra?: object) => void;
}

/** Run one queued inspection through vision → consensus → reconciliation → finding. */
export async function processInspection(deps: ProcessorDeps, insp: repo.InspectionRow): Promise<void> {
  const { db, images, model, samples, maxAttempts = 3, log = () => {} } = deps;
  try {
    const asset = await repo.getAsset(db, insp.asset_id);
    if (!asset) throw new Error(`unknown asset ${insp.asset_id}`);
    const image = await images.get(insp.image_path);
    const result = await readWithConsensus(
      model,
      {
        image,
        mediaType: insp.media_type as 'image/jpeg',
        inspectionId: insp.id,
        context: { assetName: asset.name, expectedUnit: asset.unit, scaleMin: asset.scaleMin, scaleMax: asset.scaleMax },
      },
      samples,
      asset.scaleMax - asset.scaleMin,
    );
    const finding = reconcile(
      asset,
      { value: insp.robot_value, unit: insp.robot_unit as Unit | null, confidence: insp.robot_confidence },
      result.consensus,
    );
    await repo.saveResult(db, insp, result, finding);
    log('processed', { id: insp.id, status: finding.status, severity: finding.severity, reasons: finding.reasons });
  } catch (err) {
    await repo.markFailed(db, insp.id, (err as Error).message, maxAttempts);
    log('failed', { id: insp.id, error: (err as Error).message });
  }
}

/** Drain the queue once (used by the worker loop and by tests). Returns the number processed. */
export async function drain(deps: ProcessorDeps, concurrency = 4): Promise<number> {
  let n = 0;
  const runner = async () => {
    for (let job = await repo.claimNext(deps.db); job; job = await repo.claimNext(deps.db)) {
      await processInspection(deps, job);
      n++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, runner));
  return n;
}
