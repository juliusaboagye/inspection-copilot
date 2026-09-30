import type { AssetSpec, Finding, RobotPayload } from '@ic/core';
import type { ConsensusResult } from '@ic/vision';
import type { Db } from './db';
import { tx } from './db';

export interface InspectionRow {
  id: string; asset_id: string; robot_id: string; captured_at: Date; image_path: string; media_type: string;
  robot_value: number | null; robot_unit: string | null; robot_confidence: number; audio_rms_db: number | null;
  status: string; attempts: number;
}

const toAsset = (r: any): AssetSpec => ({
  id: r.id, name: r.name, unit: r.unit, scaleMin: r.scale_min, scaleMax: r.scale_max,
  normalMin: r.normal_min, normalMax: r.normal_max, site: r.site ?? undefined, area: r.area ?? undefined,
});

export async function upsertAssets(db: Db, assets: AssetSpec[]) {
  for (const a of assets) {
    await db.query(
      `INSERT INTO asset (id, name, unit, scale_min, scale_max, normal_min, normal_max, site, area)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, unit=EXCLUDED.unit, scale_min=EXCLUDED.scale_min,
         scale_max=EXCLUDED.scale_max, normal_min=EXCLUDED.normal_min, normal_max=EXCLUDED.normal_max,
         site=EXCLUDED.site, area=EXCLUDED.area`,
      [a.id, a.name, a.unit, a.scaleMin, a.scaleMax, a.normalMin, a.normalMax, a.site ?? null, a.area ?? null],
    );
  }
}

export async function listAssets(db: Db): Promise<AssetSpec[]> {
  return (await db.query('SELECT * FROM asset ORDER BY id')).rows.map(toAsset);
}

export async function getAsset(db: Db, id: string): Promise<AssetSpec | null> {
  const r = (await db.query('SELECT * FROM asset WHERE id = $1', [id])).rows[0];
  return r ? toAsset(r) : null;
}

/** Idempotent: re-sending the same inspection id is a no-op. Returns true if newly created. */
export async function insertInspection(db: Db, p: RobotPayload, imagePath: string, mediaType: string): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO inspection (id, asset_id, robot_id, captured_at, image_path, media_type, robot_value, robot_unit, robot_confidence, audio_rms_db)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [p.inspectionId, p.assetId, p.robotId, p.capturedAt, imagePath, mediaType,
     p.robotReading.value, p.robotReading.unit, p.robotReading.confidence, p.audio?.rmsDb ?? null],
  );
  return r.rowCount === 1;
}

export async function getInspection(db: Db, id: string): Promise<InspectionRow | null> {
  return (await db.query('SELECT * FROM inspection WHERE id = $1', [id])).rows[0] ?? null;
}

/**
 * Claim the next job. FOR UPDATE SKIP LOCKED lets many workers pull from the same
 * table without double-processing; stale 'processing' rows are reclaimed after 5 minutes.
 */
export async function claimNext(db: Db): Promise<InspectionRow | null> {
  const r = await db.query(
    `UPDATE inspection SET status = 'processing', attempts = attempts + 1, locked_at = now()
     WHERE id = (
       SELECT id FROM inspection
       WHERE status = 'queued' OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
       ORDER BY received_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1)
     RETURNING *`,
  );
  return r.rows[0] ?? null;
}

export async function saveResult(db: Db, inspection: InspectionRow, result: ConsensusResult, finding: Finding) {
  await tx(db, async (c) => {
    await c.query(
      `INSERT INTO reading (inspection_id, model, samples, consensus, input_tokens, output_tokens, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (inspection_id) DO UPDATE SET model=EXCLUDED.model, samples=EXCLUDED.samples, consensus=EXCLUDED.consensus,
         input_tokens=EXCLUDED.input_tokens, output_tokens=EXCLUDED.output_tokens, latency_ms=EXCLUDED.latency_ms, created_at=now()`,
      [inspection.id, result.model, JSON.stringify(result.samples), JSON.stringify(result.consensus),
       result.usage.inputTokens, result.usage.outputTokens, result.latencyMs],
    );
    await c.query(
      `INSERT INTO finding (inspection_id, asset_id, status, value, unit, confidence, severity, reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (inspection_id) DO UPDATE SET status=EXCLUDED.status, value=EXCLUDED.value, unit=EXCLUDED.unit,
         confidence=EXCLUDED.confidence, severity=EXCLUDED.severity, reasons=EXCLUDED.reasons`,
      [inspection.id, inspection.asset_id, finding.status, finding.value, finding.unit, result.consensus.confidence, finding.severity, finding.reasons],
    );
    await c.query(`UPDATE inspection SET status='done', locked_at=NULL, last_error=NULL WHERE id=$1`, [inspection.id]);
  });
}

export async function markFailed(db: Db, id: string, error: string, maxAttempts: number) {
  await db.query(
    `UPDATE inspection SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'queued' END,
       locked_at = NULL, last_error = $2 WHERE id = $1`,
    [id, error.slice(0, 1000), maxAttempts],
  );
}

export interface FindingFilter { status?: string; severity?: string; assetId?: string; limit?: number }

const FINDING_SELECT = `
  SELECT f.id, f.inspection_id AS "inspectionId", f.asset_id AS "assetId", a.name AS "assetName", f.status,
         f.value, f.unit, f.confidence, f.severity, f.reasons, f.created_at AS "createdAt",
         i.captured_at AS "capturedAt", i.robot_value AS "robotValue", i.robot_unit AS "robotUnit",
         i.robot_confidence AS "robotConfidence", i.audio_rms_db AS "audioRmsDb",
         a.normal_min AS "normalMin", a.normal_max AS "normalMax",
         f.review_decision AS "reviewDecision", f.reviewed_value AS "reviewedValue",
         f.reviewed_by AS "reviewedBy", f.reviewed_at AS "reviewedAt", f.review_note AS "reviewNote"
  FROM finding f JOIN inspection i ON i.id = f.inspection_id JOIN asset a ON a.id = f.asset_id`;

const SEVERITY_SORT = `CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`;

export async function listFindings(db: Db, f: FindingFilter) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status) { args.push(f.status); where.push(`f.status = $${args.length}`); }
  if (f.severity) { args.push(f.severity); where.push(`f.severity = $${args.length}`); }
  if (f.assetId) { args.push(f.assetId); where.push(`f.asset_id = $${args.length}`); }
  args.push(Math.min(f.limit ?? 50, 200));
  const sql = `${FINDING_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY ${SEVERITY_SORT}, i.captured_at DESC LIMIT $${args.length}`;
  return (await db.query(sql, args)).rows;
}

export async function getFinding(db: Db, id: number) {
  const row = (await db.query(`${FINDING_SELECT} WHERE f.id = $1`, [id])).rows[0];
  if (!row) return null;
  const reading = (await db.query('SELECT model, samples, consensus, input_tokens, output_tokens, latency_ms FROM reading WHERE inspection_id=$1', [row.inspectionId])).rows[0];
  return { ...row, reading: reading ?? null };
}

export async function reviewFinding(
  db: Db, id: number, review: { decision: 'confirm' | 'correct' | 'unreadable'; value?: number; note?: string }, userId: string,
) {
  const r = await db.query(
    `UPDATE finding SET status='reviewed', review_decision=$2,
       reviewed_value = CASE WHEN $2 = 'confirm' THEN value WHEN $2 = 'correct' THEN $3::double precision ELSE NULL END,
       reviewed_by=$4, reviewed_at=now(), review_note=$5
     WHERE id=$1 RETURNING id`,
    [id, review.decision, review.value ?? null, userId, review.note ?? null],
  );
  return r.rowCount === 1;
}

export async function assetHistory(db: Db, assetId: string, days: number) {
  return (await db.query(
    `SELECT i.captured_at AS "capturedAt", coalesce(f.reviewed_value, f.value) AS value, f.unit, f.severity, f.status, i.audio_rms_db AS "audioRmsDb"
     FROM finding f JOIN inspection i ON i.id = f.inspection_id
     WHERE f.asset_id = $1 AND i.captured_at >= now() - make_interval(days => $2)
     ORDER BY i.captured_at`,
    [assetId, days],
  )).rows;
}

export async function summary(db: Db) {
  const [byStatus, bySeverity, reasons, tokens, review] = await Promise.all([
    db.query(`SELECT status, count(*)::int AS n FROM finding GROUP BY status`),
    db.query(`SELECT severity, count(*)::int AS n FROM finding GROUP BY severity`),
    db.query(`SELECT r AS reason, count(*)::int AS n FROM finding, unnest(reasons) r GROUP BY r ORDER BY n DESC`),
    db.query(`SELECT coalesce(sum(input_tokens),0)::int AS "inputTokens", coalesce(sum(output_tokens),0)::int AS "outputTokens", coalesce(avg(latency_ms),0)::int AS "avgLatencyMs" FROM reading`),
    // How often did reviewers agree with the AI? (the metric that decides whether to raise auto-accept)
    db.query(`SELECT count(*)::int AS reviewed,
                     count(*) FILTER (WHERE review_decision = 'confirm')::int AS confirmed,
                     count(*) FILTER (WHERE review_decision = 'correct')::int AS corrected
              FROM finding WHERE status = 'reviewed'`),
  ]);
  const toMap = (rows: any[], k: string) => Object.fromEntries(rows.map((r) => [r[k], r.n]));
  return {
    findingsByStatus: toMap(byStatus.rows, 'status'),
    findingsBySeverity: toMap(bySeverity.rows, 'severity'),
    reasons: toMap(reasons.rows, 'reason'),
    usage: tokens.rows[0],
    review: review.rows[0],
  };
}
