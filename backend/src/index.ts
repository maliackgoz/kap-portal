import express from 'express';
import db from './db.js';
import authRouter, { authMiddleware, adminOnly, tokenRole } from './auth.js';
import dashboardRouter from './routes/dashboard.js';
import processingRouter from './routes/processing.js';
import companiesRouter from './routes/companies.js';
import graphRouter from './routes/graph.js';
import ratingRouter from './routes/rating.js';
import membersRouter from './routes/members.js';
import { config } from './config.js';
import { cors, securityHeaders } from './security.js';
import auditRouter from './routes/audit.js';
import { pruneAudit } from './audit.js';
import { requestLog } from './request-log.js';
import { logger } from './logger.js';

const app = express();
const startedAt = new Date().toISOString();

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.use(requestLog);
app.use(securityHeaders);
app.use(cors);
app.use(express.json({ limit: '1mb', strict: true }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'finansal-portal',
    version: config.appVersion,
    startedAt,
  });
});

app.get('/api/ready', (_req, res) => {
  try {
    const result = db.pragma('quick_check', { simple: true });
    const companyCount = (db.prepare('SELECT COUNT(*) AS count FROM companies').get() as { count: number }).count;
    if (result !== 'ok' || companyCount === 0) {
      res.status(503).json({ ok: false, database: result, companyCount });
      return;
    }
    res.json({ ok: true, database: 'ok', companyCount });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Hazırlık kontrolü başarısız',
    });
  }
});

// Public routes
app.use('/api/auth', authRouter);

// SSE endpoint — EventSource can't send headers, so check token via query param
import { addSSEClient } from './services/processor.js';
import jwt from 'jsonwebtoken';
app.get('/api/processing/events', (req, res) => {
  const token = req.query.token as string;
  if (!token) { res.status(401).json({ error: 'Token gerekli' }); return; }
  try {
    const payload = jwt.verify(token, config.jwtSecret, { issuer: 'finansal-portal' });
    if (tokenRole(payload) !== 'admin') { res.status(403).json({ error: 'Bu sayfa için yetkiniz yok' }); return; }
  } catch {
    res.status(401).json({ error: 'Geçersiz token' });
    return;
  }
  addSSEClient(res);
});

// Protected routes
app.use('/api/dashboard', authMiddleware, adminOnly, dashboardRouter);
app.use('/api/processing', authMiddleware, adminOnly, processingRouter);
app.use('/api/companies', authMiddleware, companiesRouter);
app.use('/api/members', authMiddleware, membersRouter);
app.use('/api/graph', authMiddleware, graphRouter);
app.use('/api/rating', authMiddleware, ratingRouter);
app.use('/api/audit', authMiddleware, adminOnly, auditRouter);

// Serve frontend static files in production
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
import fs from 'fs';
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint bulunamadı' });
});

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    res.status(400).json({ error: 'Geçersiz JSON gövdesi' });
    return;
  }

  logger.error('Beklenmeyen API hatasi', { requestId: (_req as any).id, path: _req.originalUrl.split('?')[0], error });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Beklenmeyen bir sunucu hatası oluştu' });
  }
});

async function start() {
  // Auto-seed if companies table is empty
  let count = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c;
  if (count === 0) {
    logger.info('Veritabani bos, seed yapiliyor');
    const { runSeed } = await import('./seed.js');
    runSeed();
    count = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c;
    logger.info('Seed tamamlandi');
  }

  pruneAudit(config.auditRetentionDays);

  app.listen(config.port, '0.0.0.0', () => {
    logger.info('KAP Portal basladi', { port: config.port, version: config.appVersion, companies: count });
  });
}

start().catch(error => {
  logger.error('KAP Portal baslatilamadi', { error });
  process.exit(1);
});
