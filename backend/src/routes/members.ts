import { Router } from 'express';
import db from '../db.js';

const router = Router();

const MEMBER_SELECT = `
  SELECT c.id, c.name, c.slug, c.oid, c.ticker, c.status, c.last_processed_at,
         mc.created_at as member_created_at,
         (
           SELECT pl.action FROM processing_log pl
           WHERE pl.company_id = c.id
           ORDER BY pl.created_at DESC, pl.id DESC
           LIMIT 1
         ) as last_log_action,
         (
           SELECT pl.message FROM processing_log pl
           WHERE pl.company_id = c.id
           ORDER BY pl.created_at DESC, pl.id DESC
           LIMIT 1
         ) as last_log_message,
         (
           SELECT pl.created_at FROM processing_log pl
           WHERE pl.company_id = c.id
           ORDER BY pl.created_at DESC, pl.id DESC
           LIMIT 1
         ) as last_log_created_at
  FROM member_companies mc
  JOIN companies c ON c.id = mc.company_id
`;

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(Number)
      .filter(id => Number.isFinite(id) && id > 0),
  ));
}

function listMembers() {
  return db.prepare(`${MEMBER_SELECT} ORDER BY mc.created_at ASC, c.name ASC`).all();
}

router.get('/', (_req, res) => {
  res.json({ members: listMembers() });
});

router.put('/', (req, res) => {
  const companyIds = cleanIds(req.body?.companyIds);
  const replaceMembers = db.transaction((ids: number[]) => {
    db.prepare('DELETE FROM member_companies').run();
    const insert = db.prepare('INSERT OR IGNORE INTO member_companies (company_id) VALUES (?)');
    for (const id of ids) insert.run(id);
  });

  replaceMembers(companyIds);
  res.json({ members: listMembers() });
});

router.post('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Geçersiz şirket kimliği' });
    return;
  }

  const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(id);
  if (!company) {
    res.status(404).json({ error: 'Şirket bulunamadı' });
    return;
  }

  db.prepare('INSERT OR IGNORE INTO member_companies (company_id) VALUES (?)').run(id);
  res.json({ members: listMembers() });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Geçersiz şirket kimliği' });
    return;
  }

  db.prepare('DELETE FROM member_companies WHERE company_id = ?').run(id);
  res.json({ members: listMembers() });
});

export default router;
