// Denetim kaydi (kim, ne zaman, ne yapti). Teknik log'dan (logger.ts) ayri:
// SQLite'ta kalici durur, /api/audit uzerinden admin'e gosterilir.
// Sifre/token/istek govdesi ASLA yazilmaz.
import type { Request } from 'express';
import db from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('audit');

export interface AuditEntry {
  action: string;               // orn. auth.login, auth.login_failed, http.POST
  outcome: 'success' | 'failure' | 'denied';
  username?: string | null;
  target?: string | null;       // orn. istek yolu ya da sirket id
  detail?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
}

const insert = db.prepare(
  `INSERT INTO audit_log (username, action, outcome, target, detail, ip, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

export function audit(entry: AuditEntry) {
  try {
    insert.run(
      entry.username ?? null,
      entry.action,
      entry.outcome,
      entry.target ?? null,
      entry.detail ? JSON.stringify(entry.detail) : null,
      entry.ip ?? null,
      entry.requestId ?? null,
    );
  } catch (error) {
    // Denetim yazilamadi diye istek patlamasin, ama sessizce de yutma
    log.error('audit kaydi yazilamadi', { action: entry.action, error });
  }
}

export function auditFromRequest(req: Request, entry: Omit<AuditEntry, 'ip' | 'requestId' | 'username'> & { username?: string | null }) {
  audit({
    ...entry,
    username: entry.username ?? (req as any).user?.username ?? null,
    ip: req.ip || req.socket.remoteAddress || null,
    requestId: (req as any).id ?? null,
  });
}

// Eski kayitlari at (acilista bir kez)
export function pruneAudit(days: number) {
  const result = db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', ?)`).run(`-${days} days`);
  if (result.changes) log.info('eski denetim kayitlari silindi', { deleted: result.changes, olderThanDays: days });
}
