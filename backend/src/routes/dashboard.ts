import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/stats', (_req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as processed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'no_data' THEN 1 ELSE 0 END) as no_data
    FROM companies
  `).get();
  res.json(stats);
});

router.get('/activity', (_req, res) => {
  const logs = db.prepare(`
    SELECT pl.id, pl.action, pl.message, pl.created_at,
           c.name as company_name, c.slug as company_slug
    FROM processing_log pl
    LEFT JOIN companies c ON pl.company_id = c.id
    ORDER BY pl.created_at DESC
    LIMIT 50
  `).all();
  res.json(logs);
});

export default router;
