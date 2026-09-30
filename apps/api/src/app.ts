import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { RobotPayload } from '@ic/core';
import type { Db } from './lib/db';
import type { ImageStore } from './lib/images';
import { authenticate, requireRole, ROLES, type AuthConfig } from './lib/auth';
import * as repo from './lib/repo';

export interface AppDeps { db: Db; images: ImageStore; auth: AuthConfig; logger?: boolean }

const IngestBody = RobotPayload.extend({
  image: z.object({
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    base64: z.string().min(16),
  }),
});
const ReviewBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('confirm'), note: z.string().max(1000).optional() }),
  z.object({ decision: z.literal('correct'), value: z.number(), note: z.string().max(1000).optional() }),
  z.object({ decision: z.literal('unreadable'), note: z.string().max(1000).optional() }),
]);
const FindingQuery = z.object({
  status: z.enum(['auto_accepted', 'needs_review', 'reviewed']).optional(),
  severity: z.enum(['none', 'low', 'medium', 'high']).optional(),
  assetId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Express 5: async handlers that throw or reject are passed to the error middleware
 * automatically, so no try/catch or asyncHandler wrapper is needed.
 */
export function buildApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '15mb' }));
  if (deps.logger) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => console.log(JSON.stringify({ method: req.method, url: req.originalUrl, status: res.statusCode, ms: Date.now() - start })));
      next();
    });
  }

  app.get('/health', (_req, res) => { res.json({ ok: true }); });

  // Everything below requires an authenticated user.
  const api = express.Router();
  api.use(authenticate(deps.auth));

  /** Robot vendor pushes a capture. 202 = queued for AI processing; 200 = duplicate, ignored. */
  api.post('/inspections', requireRole(ROLES.ingest), async (req, res) => {
    const body = IngestBody.parse(req.body);
    const asset = await repo.getAsset(deps.db, body.assetId);
    if (!asset) return void res.status(422).json({ error: `unknown asset ${body.assetId}` });
    const ext = body.image.mediaType.split('/')[1];
    const imagePath = await deps.images.put(`${body.inspectionId}.${ext}`, Buffer.from(body.image.base64, 'base64'));
    const created = await repo.insertInspection(deps.db, body, imagePath, body.image.mediaType);
    res.status(created ? 202 : 200).json({ inspectionId: body.inspectionId, queued: created });
  });

  api.get('/inspections/:id/image', requireRole(ROLES.read), async (req, res) => {
    const insp = await repo.getInspection(deps.db, String(req.params.id));
    if (!insp) return void res.status(404).json({ error: 'not found' });
    res.type(insp.media_type).send(await deps.images.get(insp.image_path));
  });

  api.get('/assets', requireRole(ROLES.read), async (_req, res) => {
    res.json(await repo.listAssets(deps.db));
  });

  api.get('/assets/:id/history', requireRole(ROLES.read), async (req, res) => {
    res.json(await repo.assetHistory(deps.db, String(req.params.id), Number(req.query.days ?? 30)));
  });

  api.get('/findings', requireRole(ROLES.read), async (req, res) => {
    res.json(await repo.listFindings(deps.db, FindingQuery.parse(req.query)));
  });

  api.get('/findings/:id', requireRole(ROLES.read), async (req, res) => {
    const f = await repo.getFinding(deps.db, Number(req.params.id));
    if (!f) return void res.status(404).json({ error: 'not found' });
    res.json(f);
  });

  api.post('/findings/:id/review', requireRole(ROLES.review), async (req, res) => {
    const body = ReviewBody.parse(req.body);
    const ok = await repo.reviewFinding(deps.db, Number(req.params.id), body, req.user!.id);
    if (!ok) return void res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  api.get('/metrics/summary', requireRole(ROLES.read), async (_req, res) => {
    res.json(await repo.summary(deps.db));
  });

  app.use(api);

  // Central error handler: validation errors -> 400, malformed JSON / too large -> their status, else 500.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'validation', issues: err.issues });
    const status = typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });

  return app;
}
