import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface User { id: string; name?: string; roles: string[] }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: User }
  }
}

export const ROLES = {
  ingest: 'Inspection.Ingest',     // the robot integration (client-credentials app)
  read: 'Inspection.Read',
  review: 'Inspection.Review',     // engineers who confirm / correct findings
} as const;

export type AuthConfig =
  | { mode: 'none' }
  | { mode: 'entra'; tenantId: string; audience: string; getKey?: JWTVerifyGetKey };

/**
 * Entra ID: validate the bearer token (signature via the tenant's JWKS, issuer, audience)
 * and take app roles from the `roles` claim. 'none' is for local development only.
 */
export function authenticate(cfg: AuthConfig) {
  if (cfg.mode === 'none') {
    return (req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'local-dev', name: 'Local developer', roles: Object.values(ROLES) };
      next();
    };
  }
  const getKey = cfg.getKey ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${cfg.tenantId}/discovery/v2.0/keys`));
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return void res.status(401).json({ error: 'missing bearer token' });
    try {
      const { payload } = await jwtVerify(token, getKey, {
        issuer: `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`,
        audience: cfg.audience,
      });
      req.user = {
        id: String(payload.oid ?? payload.sub),
        name: typeof payload.name === 'string' ? payload.name : undefined,
        roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      };
    } catch {
      return void res.status(401).json({ error: 'invalid token' });
    }
    next();
  };
}

export const requireRole = (role: string) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.roles.includes(role)) return void res.status(403).json({ error: `requires role ${role}` });
  next();
};
