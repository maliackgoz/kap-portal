import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const router = Router();

interface LoginAttempt {
  failures: number;
  resetAt: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

function sameValue(left: string, right: string) {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function attemptKey(req: Request) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function currentAttempt(key: string) {
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.resetAt > Date.now()) return attempt;
  loginAttempts.delete(key);
  return undefined;
}

export type Role = 'admin' | 'viewer';

function matchUser(username: string, password: string): Role | null {
  // Iki hesabi da her seferinde kontrol et (zamanlama farki olusmasin)
  const admin = sameValue(username, config.adminUsername) && sameValue(password, config.adminPassword);
  const viewerEnabled = Boolean(config.viewerUsername && config.viewerPassword);
  const viewer = viewerEnabled
    && sameValue(username, config.viewerUsername)
    && sameValue(password, config.viewerPassword);
  if (admin) return 'admin';
  if (viewer) return 'viewer';
  return null;
}

router.post('/login', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password) {
    res.status(400).json({ error: 'Kullanici adi ve sifre gerekli' });
    return;
  }

  const key = attemptKey(req);
  const attempt = currentAttempt(key);
  if (attempt && attempt.failures >= config.loginMaxAttempts) {
    const retryAfter = Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Çok fazla başarısız deneme. Lütfen daha sonra tekrar deneyin.' });
    return;
  }

  const role = matchUser(username, password);
  if (!role) {
    loginAttempts.set(key, {
      failures: (attempt?.failures || 0) + 1,
      resetAt: attempt?.resetAt || Date.now() + config.loginWindowMs,
    });
    res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
    return;
  }

  loginAttempts.delete(key);
  const token = jwt.sign(
    { username, role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'], issuer: 'finansal-portal' },
  );
  res.json({ token, username, role });
});

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token gerekli' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { issuer: 'finansal-portal' });
    (req as any).user = payload;
  } catch {
    res.status(401).json({ error: 'Geçersiz token' });
    return;
  }
  // Viewer salt okunur: veri degistiren/tetikleyen hicbir istegi yapamaz
  if (!isAdmin(req) && req.method !== 'GET') {
    res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
    return;
  }
  next();
}

// Eski token'larda role alani yok; hepsi admin olarak uretilmisti
export function tokenRole(payload: unknown): Role {
  return (payload as { role?: string } | null)?.role === 'viewer' ? 'viewer' : 'admin';
}

function isAdmin(req: Request) {
  return tokenRole((req as any).user) === 'admin';
}

export function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Bu sayfa için yetkiniz yok' });
    return;
  }
  next();
}

export default router;
