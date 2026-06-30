import { Router } from 'express';
import db from '../db.js';
import { KapScrapeError, scrapeCompany, type KapFetchDetails } from '../services/scraper.js';

const router = Router();
const COMPANY_SELECT = `
  SELECT c.id, c.name, c.slug, c.oid, c.ticker, c.status, c.last_processed_at,
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
  FROM companies c
`;

function normalizeSearch(value: string | null | undefined) {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[\u0131\u0130]/g, 'i')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function logPayload(company: { name: string; oid: string; slug: string }, details: Partial<KapFetchDetails>, message?: string) {
  return JSON.stringify({
    companyName: company.name,
    kapId: company.oid,
    resolvedKapUrl: details.resolvedKapUrl,
    requestUrl: details.requestUrl,
    httpStatus: details.httpStatus,
    statusText: details.statusText,
    errorType: details.errorType,
    errorMessage: message || details.errorMessage,
    errorCause: details.errorCause,
    durationMs: details.durationMs,
    retryCount: details.retryCount,
    responseLength: details.responseLength,
    processingStartedAt: details.processingStartedAt,
    processingFinishedAt: details.processingFinishedAt,
  });
}

function errorDetails(error: unknown): Partial<KapFetchDetails> & { errorMessage: string } {
  if (error instanceof KapScrapeError) return { ...error.details, errorMessage: error.details.errorMessage || error.message };
  return {
    errorType: 'UNKNOWN_ERROR',
    errorMessage: error instanceof Error ? error.message : String(error),
    durationMs: 0,
    retryCount: 0,
    processingStartedAt: new Date().toISOString(),
    processingFinishedAt: new Date().toISOString(),
  };
}

router.get('/', (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const status = req.query.status as string;
  const search = req.query.search as string;
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params: any[] = [];

  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  if (search) {
    const rows = db.prepare(
      `${COMPANY_SELECT} WHERE ${where} ORDER BY c.name`
    ).all(...params) as Array<Record<string, any>>;
    const key = normalizeSearch(search);
    const filtered = rows.filter(company => normalizeSearch([
      company.id,
      company.name,
      company.slug,
      company.oid,
      company.ticker || '',
    ].join(' ')).includes(key));
    const companies = filtered.slice(offset, offset + limit);

    res.json({ companies, total: filtered.length, page, pages: Math.ceil(filtered.length / limit) });
    return;
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM companies WHERE ${where}`).get(...params) as any).count;
  const companies = db.prepare(
    `${COMPANY_SELECT} WHERE ${where} ORDER BY c.name LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ companies, total, page, pages: Math.ceil(total / limit) });
});

// List all companies (for dropdown, no pagination) - MUST be before /:id routes
router.get('/all/list', (_req, res) => {
  const companies = db.prepare(
    `${COMPANY_SELECT} ORDER BY c.name`
  ).all();
  res.json(companies);
});

router.get('/:id/data', (req, res) => {
  const rows = db.prepare(
    `SELECT item_key, value, fetched_at FROM shareholders WHERE company_id = ? ORDER BY item_key`
  ).all(req.params.id);

  const data: Record<string, any> = {};
  for (const row of rows as any[]) {
    try { data[row.item_key] = JSON.parse(row.value); } catch { data[row.item_key] = row.value; }
  }

  res.json(data);
});

// Get single company info
router.get('/:id', (req, res) => {
  const company = db.prepare(
    `SELECT id, name, slug, oid, ticker, status, last_processed_at, created_at FROM companies WHERE id = ?`
  ).get(req.params.id);
  if (!company) { res.status(404).json({ error: 'Sirket bulunamadi' }); return; }
  res.json(company);
});

// Scrape single company
router.post('/:id/scrape', async (req, res) => {
  const company = db.prepare(`SELECT id, name, slug, oid FROM companies WHERE id = ?`).get(req.params.id) as any;
  if (!company) { res.status(404).json({ error: 'Sirket bulunamadi' }); return; }

  db.prepare(`UPDATE companies SET status = 'processing' WHERE id = ?`).run(company.id);

  try {
    const result = await scrapeCompany(company.slug);

    if (result.status === 'no_data') {
      db.prepare(`UPDATE companies SET status = 'no_data', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
      const message = logPayload(company, result.details, result.details.errorMessage || 'Genel bilgiler yok');
      db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'no_data', ?)`).run(company.id, message);
      res.json({ status: 'no_data', message: 'Genel bilgiler yok', detail: result.details });
      return;
    }

    const upsertStmt = db.prepare(`
      INSERT INTO shareholders (company_id, item_key, value, fetched_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(company_id, item_key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at
    `);

    const insertMany = db.transaction((items: [number, string, string][]) => {
      for (const [cid, key, val] of items) upsertStmt.run(cid, key, val);
    });

    const items = Object.entries(result.data!).map(
      ([key, val]): [number, string, string] => [company.id, key, JSON.stringify(val)]
    );
    insertMany(items);

    db.prepare(`UPDATE companies SET status = 'done', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
    db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'process_company', ?)`).run(
      company.id, logPayload(company, result.details, `${Object.keys(result.data!).length} veri noktasi`)
    );

    res.json({ status: 'ok', keys: Object.keys(result.data!).length, detail: result.details });
  } catch (err: any) {
    const details = errorDetails(err);
    const message = logPayload(company, details, details.errorMessage);
    db.prepare(`UPDATE companies SET status = 'error', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
    db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'error', ?)`).run(company.id, message);
    res.status(500).json({ status: 'error', message: details.errorMessage, detail: details });
  }
});

export default router;
