import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

function ownOrigin(req: Request) {
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : '';
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
    ].join('; '),
  );
  next();
}

export function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (!origin) {
    next();
    return;
  }

  const allowed = origin === ownOrigin(req) || config.allowedOrigins.includes(origin);
  if (!allowed) {
    res.status(403).json({ error: 'Bu kaynaktan erişime izin verilmiyor' });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}
