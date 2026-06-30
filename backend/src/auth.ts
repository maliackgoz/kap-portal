import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'kap-portal-secret-2024';
const USERS: Record<string, string> = {
  admin: process.env.ADMIN_PASS || 'kap2024',
};

const router = Router();

router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Kullanici adi ve sifre gerekli' });
    return;
  }
  if (USERS[username] !== password) {
    res.status(401).json({ error: 'Gecersiz kullanici adi veya sifre' });
    return;
  }
  const token = jwt.sign({ username }, SECRET, { expiresIn: '24h' });
  res.json({ token, username });
});

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token gerekli' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), SECRET);
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Gecersiz token' });
  }
}

export default router;
