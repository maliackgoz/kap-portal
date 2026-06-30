import express from 'express';
import db from './db.js';
import authRouter, { authMiddleware } from './auth.js';
import dashboardRouter from './routes/dashboard.js';
import processingRouter from './routes/processing.js';
import companiesRouter from './routes/companies.js';
import graphRouter from './routes/graph.js';
import ratingRouter from './routes/rating.js';
import membersRouter from './routes/members.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Public routes
app.use('/api/auth', authRouter);

// SSE endpoint — EventSource can't send headers, so check token via query param
import { addSSEClient } from './services/processor.js';
import jwt from 'jsonwebtoken';
const SECRET = process.env.JWT_SECRET || 'kap-portal-secret-2024';
app.get('/api/processing/events', (req, res) => {
  const token = req.query.token as string;
  if (!token) { res.status(401).json({ error: 'Token gerekli' }); return; }
  try { jwt.verify(token, SECRET); } catch { res.status(401).json({ error: 'Gecersiz token' }); return; }
  addSSEClient(res);
});

// Protected routes
app.use('/api/dashboard', authMiddleware, dashboardRouter);
app.use('/api/processing', authMiddleware, processingRouter);
app.use('/api/companies', authMiddleware, companiesRouter);
app.use('/api/members', authMiddleware, membersRouter);
app.use('/api/graph', authMiddleware, graphRouter);
app.use('/api/rating', authMiddleware, ratingRouter);

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

async function start() {
  // Auto-seed if companies table is empty
  let count = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c;
  if (count === 0) {
    console.log('Veritabani bos, seed yapiliyor...');
    await import('./seed.js');
    count = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c;
    console.log('Seed tamamlandi');
  }

  app.listen(PORT, () => {
    console.log(`\nFinansal Portal: http://localhost:${PORT}`);
    console.log(`Sirket sayisi: ${count}`);
  });
}

start().catch(error => {
  console.error('KAP Portal baslatilamadi:', error);
  process.exit(1);
});
