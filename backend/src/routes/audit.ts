import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/audit?limit=100&action=auth&username=admin
router.get('/', (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
  const where: string[] = [];
  const params: unknown[] = [];
  if (typeof req.query.action === 'string' && req.query.action) {
    where.push('action LIKE ?');
    params.push(`${req.query.action}%`);
  }
  if (typeof req.query.username === 'string' && req.query.username) {
    where.push('username = ?');
    params.push(req.query.username);
  }
  const rows = db.prepare(
    `SELECT id, created_at, username, action, outcome, target, detail, ip, request_id
     FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY id DESC LIMIT ?`
  ).all(...params, limit);
  res.json(rows);
});

export default router;
