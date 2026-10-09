import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from './logger.js';
import { auditFromRequest } from './audit.js';

const log = createLogger('http');
// Gurultu: saglik kontrolleri 30 sn'de bir geliyor
const QUIET_PATHS = new Set(['/api/health', '/api/ready']);

// Her isteğe bir id verir (X-Request-Id), bitince erişim logu yazar.
// /api altındaki veri değiştiren (GET dışı) kimlikli istekleri audit_log'a da işler;
// login olayları auth.ts'te kendi detayıyla yazıldığı için burada atlanır.
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const id = (req.get('x-request-id') || '').slice(0, 64) || crypto.randomUUID();
  (req as any).id = id;
  res.setHeader('X-Request-Id', id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (!path.startsWith('/api')) return; // statik dosyalar
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const status = res.statusCode;

    if (!QUIET_PATHS.has(path)) {
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      log[level]('istek', {
        requestId: id,
        method: req.method,
        path,
        status,
        durationMs,
        user: (req as any).user?.username,
        ip: req.ip,
      });
    }

    const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (mutating && !path.startsWith('/api/auth/') && (req as any).user) {
      auditFromRequest(req, {
        action: `http.${req.method}`,
        outcome: status < 400 ? 'success' : status === 401 || status === 403 ? 'denied' : 'failure',
        target: path,
        detail: { status },
      });
    }
  });
  next();
}
