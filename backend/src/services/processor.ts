import { Response } from 'express';
import db from '../db.js';
import { KapScrapeError, scrapeCompany, type KapFetchDetails } from './scraper.js';
import { replaceCompanyData } from './company-data.js';

interface ProcessingState {
  running: boolean;
  aborted: boolean;
  scope: ProcessingScope;
  phase: 'idle' | 'processing' | 'cooldown' | 'stopping' | 'failed';
  message: string;
  current: number;
  total: number;
  processed: number;
  errors: number;
  skipped: number;
  currentCompanyId: number | null;
  currentCompany: string;
  startedAt: string | null;
  lastEventAt: string | null;
}

const state: ProcessingState = {
  running: false,
  aborted: false,
  scope: 'pending',
  phase: 'idle',
  message: '',
  current: 0,
  total: 0,
  processed: 0,
  errors: 0,
  skipped: 0,
  currentCompanyId: null,
  currentCompany: '',
  startedAt: null,
  lastEventAt: null,
};

export type ProcessingScope = 'pending' | 'all' | 'members';

type ProcessingCompany = { id: number; name: string; slug: string; oid: string };

const sseClients = new Set<Response>();

function broadcast(event: string, data: any) {
  state.lastEventAt = new Date().toISOString();
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
    'X-Accel-Buffering': 'no',
  });
  // Send current state immediately
  res.write(`event: state\ndata: ${JSON.stringify(getState())}\n\n`);
  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15_000);
  res.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

export function getState() {
  return { ...state };
}

export function stopProcessing() {
  state.aborted = true;
  state.phase = 'stopping';
  state.message = 'Mevcut istek tamamlandığında işlem durdurulacak';
  broadcast('state', getState());
}

const REQUEST_DELAY_MS = Number(process.env.KAP_REQUEST_DELAY_MS || 3000);
const ERROR_COOLDOWN_THRESHOLD = Number(process.env.KAP_ERROR_COOLDOWN_THRESHOLD || 3);
const ERROR_COOLDOWN_MS = Number(process.env.KAP_ERROR_COOLDOWN_MS || 60_000);

async function interruptibleDelay(ms: number) {
  const deadline = Date.now() + ms;
  while (!state.aborted && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
  }
}

function logPayload(company: { name: string; oid: string; slug: string }, details: Partial<KapFetchDetails>, message?: string) {
  return JSON.stringify({
    companyName: company.name,
    kapId: company.oid,
    source: details.source,
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
  if (scope === 'all') return 'tüm şirket';
  if (scope === 'members') return 'üye şirket';
  return 'bekleyen/hatalı şirket';
}

function selectProcessingCompanies(scope: ProcessingScope, companyIds?: number[]): ProcessingCompany[] {
  if (scope === 'all') {
    return db.prepare(`SELECT id, name, slug, oid FROM companies ORDER BY id`).all() as ProcessingCompany[];
  }

  if (scope === 'members') {
    const ids = cleanIds(companyIds);
    if (ids.length === 0) {
      return db.prepare(`
        SELECT c.id, c.name, c.slug, c.oid
        FROM member_companies mc
        JOIN companies c ON c.id = mc.company_id
        ORDER BY c.name
      `).all() as ProcessingCompany[];
    }
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
  if (state.running) throw new Error('İşlem zaten çalışıyor');

  const companies = selectProcessingCompanies(scope, companyIds);

  state.running = true;
  state.aborted = false;
  state.scope = scope;
  state.phase = 'processing';
  state.message = 'KAP veri çekimi başlatıldı';
  state.current = 0;
  state.total = companies.length;
  state.processed = 0;
  state.errors = 0;
  state.skipped = 0;
  state.currentCompanyId = null;
  state.currentCompany = '';
  state.startedAt = new Date().toISOString();
  state.lastEventAt = state.startedAt;

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  try {

    db.prepare(
      `INSERT INTO processing_log (action, message) VALUES (?, ?)`
    ).run(processingAction(scope), `${companies.length} ${processingLabel(scope)} işleniyor`);

    broadcast('batch_start', { total: companies.length, scope });

    let consecutiveNetworkErrors = 0;

    for (const company of companies) {
      if (state.aborted) {
        db.prepare(`INSERT INTO processing_log (action, message) VALUES ('stop_batch', 'Kullanıcı tarafından durduruldu')`).run();
        broadcast('batch_stopped', { processed, errors, skipped });
        break;
      }

      state.phase = 'processing';
      state.message = `${company.name} KAP verisi çekiliyor`;
      state.current++;
      state.currentCompanyId = company.id;
      state.currentCompany = company.name;

      db.prepare(`UPDATE companies SET status = 'processing' WHERE id = ?`).run(company.id);
      broadcast('progress', {
        current: state.current,
        total: state.total,
        percent: Math.round((state.current / state.total) * 100),
        companyId: company.id,
        companyName: company.name,
        phase: state.phase,
      });

      try {
        const result = await scrapeCompany(company.slug);

        if (result.status === 'no_data') {
          db.prepare(`UPDATE companies SET status = 'no_data', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
          const message = logPayload(company, result.details, result.details.errorMessage || 'Genel bilgiler yok');
          db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'no_data', ?)`).run(company.id, message);
          skipped++;
          state.skipped = skipped;
          broadcast('company_skip', { id: company.id, name: company.name, detail: message, error: result.details.errorMessage || 'Genel bilgiler yok' });
          consecutiveNetworkErrors = 0;
        } else {
          const writeResult = replaceCompanyData(company.id, result.data!);

          db.prepare(`UPDATE companies SET status = 'done', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
          db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'process_company', ?)`).run(
            company.id,
            logPayload(company, result.details, `${writeResult.keysWritten} veri noktası`),
          );
          processed++;
          state.processed = processed;
          consecutiveNetworkErrors = 0;
          broadcast('company_done', { id: company.id, name: company.name, keys: writeResult.keysWritten, detail: logPayload(company, result.details) });
        }
      } catch (err: any) {
        const details = errorDetails(err);
        const message = logPayload(company, details, details.errorMessage);
        db.prepare(`UPDATE companies SET status = 'error', last_processed_at = datetime('now') WHERE id = ?`).run(company.id);
        db.prepare(`INSERT INTO processing_log (company_id, action, message) VALUES (?, 'error', ?)`).run(company.id, message);
        errors++;
        state.errors = errors;
        broadcast('company_error', { id: company.id, name: company.name, error: details.errorMessage, detail: message });

        if (isNetworkLikeError(details)) {
          consecutiveNetworkErrors++;
          if (!state.aborted && consecutiveNetworkErrors >= ERROR_COOLDOWN_THRESHOLD) {
            const cooldownMessage = `${consecutiveNetworkErrors} ardışık KAP ağ hatası alındı; ${Math.ceil(ERROR_COOLDOWN_MS / 1000)} saniye bekleniyor`;
            state.phase = 'cooldown';
            state.message = cooldownMessage;
            db.prepare(`INSERT INTO processing_log (action, message) VALUES ('kap_cooldown', ?)`).run(cooldownMessage);
            broadcast('cooldown', { message: cooldownMessage, durationMs: ERROR_COOLDOWN_MS });
            await interruptibleDelay(ERROR_COOLDOWN_MS);
            state.phase = state.aborted ? 'stopping' : 'processing';
            state.message = state.aborted ? 'İşlem durduruluyor' : 'KAP veri çekimine devam ediliyor';
            consecutiveNetworkErrors = 0;
          }
        } else {
          consecutiveNetworkErrors = 0;
        }
      }

      await interruptibleDelay(REQUEST_DELAY_MS);
    }

    if (!state.aborted) {
      db.prepare(`INSERT INTO processing_log (action, message) VALUES ('complete_batch', ?)`).run(
        `Tamamlandı: ${processed} başarılı, ${errors} hata, ${skipped} veri yok`
      );
      broadcast('batch_done', { processed, errors, skipped });
    }
  } catch (error) {
    state.phase = 'failed';
    state.message = error instanceof Error ? error.message : String(error);
    db.prepare(`INSERT INTO processing_log (action, message) VALUES ('batch_error', ?)`).run(state.message);
    broadcast('batch_error', { error: state.message, processed, errors, skipped });
    throw error;
  } finally {
    state.running = false;
    state.currentCompanyId = null;
    state.currentCompany = '';
    if (state.phase !== 'failed') {
      state.phase = 'idle';
      state.message = state.aborted ? 'İşlem durduruldu' : 'İşlem tamamlandı';
    }
    broadcast('state', getState());
  }
}
