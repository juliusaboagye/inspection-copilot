import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { buildApp } from '../src/app';
import { MemoryImageStore } from '../src/lib/images';
import { freshDb } from './helpers';
import type { Db } from '../src/lib/db';

const TENANT = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = '22222222-2222-2222-2222-222222222222';
let app: Express;
let db: Db;
let sign: (claims: Record<string, unknown>, opts?: { aud?: string }) => Promise<string>;

beforeAll(async () => {
  // A local key pair stands in for Entra ID's signing keys.
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  sign = (claims, opts = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`).setAudience(opts.aud ?? AUDIENCE)
      .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  db = await freshDb();
  app = buildApp({ db, images: new MemoryImageStore(), auth: { mode: 'entra', tenantId: TENANT, audience: AUDIENCE, getKey: createLocalJWKSet({ keys: [jwk] }) } });
});
afterAll(async () => { await db.end(); });

describe('Entra ID auth', () => {
  it('401 without a token', async () => {
    expect((await request(app).get('/findings')).status).toBe(401);
  });
  it('401 with a token for a different audience', async () => {
    const t = await sign({ oid: 'u1', roles: ['Inspection.Read'] }, { aud: 'someone-else' });
    expect((await request(app).get('/findings').set('authorization', `Bearer ${t}`)).status).toBe(401);
  });
  it('403 when the user lacks the required app role', async () => {
    const t = await sign({ oid: 'u1', roles: ['Inspection.Read'] });
    const res = await request(app).post('/findings/1/review').set('authorization', `Bearer ${t}`).send({ decision: 'confirm' });
    expect(res.status).toBe(403);
  });
  it('200 with a valid token and role', async () => {
    const t = await sign({ oid: 'u1', roles: ['Inspection.Read'] });
    expect((await request(app).get('/findings').set('authorization', `Bearer ${t}`)).status).toBe(200);
  });
  it('/health stays public', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
