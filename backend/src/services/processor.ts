import { Response } from 'express';
import db from '../db.js';
import { KapScrapeError, scrapeCompany, type KapFetchDetails } from './scraper.js';

interface ProcessingState {
  running: boolean;
  aborted: boolean;
  scope: ProcessingScope;
  current: number;
  total: number;
  currentCompany: string;
  startedAt: string | null;
}

const state: ProcessingState = {
  running: false,
  aborted: false,
  scope: 'pending',
  current: 0,
  total: 0,
  currentCompany: '',
  startedAt: null,
};

export type ProcessingScope = 'pending' | 'all' | 'members';

type ProcessingCompany = { id: number; name: string; slug: string; oid: string };

const sseClients = new Set<Response>();

function broadcast(event: string, data: any) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

export function addSSEClient(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  // Send current state immediately
  res.write(`event: state\ndata: ${JSON.stringify(getState())}\n\n`);
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

export function getState() {
  return { ...state };
}

export function stopProcessing() {
  state.aborted = true;
}

const REQUEST_DELAY_MS = Number(process.env.KAP_REQUEST_DELAY_MS || 3000);
const ERROR_COOLDOWN_THRESHOLD = Number(process.env.KAP_ERROR_COOLDOWN_THRESHOLD || 3);
const ERROR_COOLDOWN_MS = Number(process.env.KAP_ERROR_COOLDOWN_MS || 60_000);

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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

function isNetworkLikeError(details: Partial<KapFetchDetails>) {
  return details.errorType === 'NETWORK_ERROR' || details.errorType === 'TIMEOUT';
}

function cleanIds(ids: unknown) {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(
    ids
      .map(Number)
      .filter(id => Number.isFinite(id) && id > 0),
  ));
}

function processingAction(scope: ProcessingScope) {
  if (scope === 'all') return 'refresh_all_kap';
  if (scope === 'members') return 'refresh_member_kap';
  return 'start_batch';
}

function processingLabel(scope: ProcessingScope) {
  if (scope === 'all') return 'tum sirket';
  if (scope === 'members') return 'uye sirket';
  return 'bekleyen/hata sirket';
}

function selectProcessingCompanies(scope: ProcessingScope, companyIds?: number[]): ProcessingCompany[] {
  if (scope === 'all') {
    return db.prepare(`SELECT id, name, slug, oid FROM companies ORDER BY id`).all() as ProcessingCompany[];
  }

  if (scope === 'members') {
    const ids = cleanIds(companyIds);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(
      `SELECT id, name, slug, oid FROM companies WHERE id IN (${placeholders}) ORDER BY name`,
    ).all(...ids) as ProcessingCompany[];
  }

  return db.prepare(
    `SELECT id, name, slug, oid FROM companies WHERE status IN ('pending', 'error', 'processing', 'no_data') ORDER BY id`,
  ).all() as ProcessingCompany[];
}

export async function startProcessing(scope: ProcessingScope = 'pending', companyIds?: number[]) {
  if (state.running) throw new Error('Zaten calisiyor');

  const companies = selectProcessingCompanies(scope, companyIds);

  state.running = true;
  state.aborted = false;
  state.scope = scope;
  state.current = 0;
  state.total = companies.length;
  state.currentCompany = '';
  state.startedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO processing_log (action, message) VALUES (?, ?)`
  ).run(processingAction(scope), `${companies.length} ${processingLabel(scope)} isleniyor`);

  broadcast('batch_start', { total: companies.length, scope });

  const upsertStmt = db.prepare(`
    INSERT INTO shareholders (company_id, item_key, value, fetched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(company_id, item_key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at
  `);

  let processed = 0;
  let errors = 0;
  let consecutiveNetworkErrors = 0;

  for (const company of companies) {
    if (state.aborted) {
      db.prepare(`INSERT INTO processing_log (action, message) VALUES ('stop_batch', 'Kullanici tarafindan durduruldu')`).run();
      broadcast('batch_stopped', { processed, errors });
      break;
    }

    state.current++;
    state.currentCompany = company.name;

    db.prepare(`UPDATE companies SET status = 'processing' WHERE id = ?`).run(company.id);
    broadcast('progress', {
      current: state.current,
      total: state.total,
      percent: Math.round((state.current / state.total) * 100),
      companyName: company.name,
    });

    try {
      const result = await scrapeCompany(company.slug);

      if (result.status === 'no_data') {
        db.prepare(`UPDATE companies SET status = 'no_data', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
        const message = logPayload(company, result.details, result.details.errorMessage || 'Genel bilgiler yok');
        db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'no_data', ?)`).run(company.id, message);
        broadcast('company_skip', { id: company.id, name: company.name, detail: message, error: result.details.errorMessage || 'Genel bilgiler yok' });
        consecutiveNetworkErrors = 0;
      } else {
        // Upsert all parsed key-value pairs
        const insertMany = db.transaction((items: [number, string, string][]) => {
          for (const [cid, key, val] of items) {
            upsertStmt.run(cid, key, val);
          }
        });

        const items = Object.entries(result.data!).map(
          ([key, val]): [number, string, string] => [company.id, key, JSON.stringify(val)]
        );
        insertMany(items);

        db.prepare(`UPDATE companies SET status = 'done', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
        db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'process_company', ?)`).run(
          company.id,
          logPayload(company, result.details, `${Object.keys(result.data!).length} veri noktasi`),
        );
        processed++;
        consecutiveNetworkErrors = 0;
        broadcast('company_done', { id: company.id, name: company.name, keys: Object.keys(result.data!).length, detail: logPayload(company, result.details) });
      }
    } catch (err: any) {
      const details = errorDetails(err);
      const message = logPayload(company, details, details.errorMessage);
      db.prepare(`UPDATE companies SET status = 'error', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
      db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'error', ?)`).run(company.id, message);
      errors++;
      broadcast('company_error', { id: company.id, name: company.name, error: details.errorMessage, detail: message });

      if (isNetworkLikeError(details)) {
        consecutiveNetworkErrors++;
        if (!state.aborted && consecutiveNetworkErrors >= ERROR_COOLDOWN_THRESHOLD) {
          const cooldownMessage = `${consecutiveNetworkErrors} ardisik KAP ag hatasi alindi; ${ERROR_COOLDOWN_MS}ms bekleniyor`;
          db.prepare(`INSERT INTO processing_log (action, message) VALUES ('kap_cooldown', ?)`).run(cooldownMessage);
          broadcast('cooldown', { message: cooldownMessage, durationMs: ERROR_COOLDOWN_MS });
          await delay(ERROR_COOLDOWN_MS);
          consecutiveNetworkErrors = 0;
        }
      } else {
        consecutiveNetworkErrors = 0;
      }
    }

    // Rate limit
    await delay(REQUEST_DELAY_MS);
  }

  if (!state.aborted) {
    db.prepare(`INSERT INTO processing_log (action, message) VALUES ('complete_batch', ?)`).run(
      `Tamamlandi: ${processed} basarili, ${errors} hata`
    );
    broadcast('batch_done', { processed, errors });
  }

  state.running = false;
  state.currentCompany = '';
}
