const KAP_BASE = 'https://www.kap.org.tr/tr/sirket-bilgileri/genel';

const CONFIG = {
  timeoutMs: Number(process.env.KAP_REQUEST_TIMEOUT_MS || 20_000),
  totalTimeoutMs: Number(process.env.KAP_TOTAL_TIMEOUT_MS || 75_000),
  maxRetry: Number(process.env.KAP_MAX_RETRY || 2),
  retryBaseDelayMs: Number(process.env.KAP_RETRY_BASE_DELAY_MS || 2_500),
};

const KAP_HEADERS = {
  'User-Agent': process.env.KAP_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Connection: 'close',
};

export type KapErrorType =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'KAP_BLOCKED'
  | `HTTP_${number}`
  | 'PARSE_ERROR'
  | 'NO_FINANCIAL_DATA'
  | 'UNKNOWN_ERROR';

export type KapDataSource = 'kap_web';

export type KapFetchDetails = {
  source?: KapDataSource;
  resolvedKapUrl: string;
  requestUrl: string;
  httpStatus?: number;
  statusText?: string;
  errorType?: KapErrorType;
  errorMessage?: string;
  errorCause?: string;
  durationMs: number;
  retryCount: number;
  retryAfterMs?: number;
  responseLength?: number;
  processingStartedAt: string;
  processingFinishedAt: string;
};

export class KapScrapeError extends Error {
  readonly details: KapFetchDetails;

  constructor(message: string, details: KapFetchDetails) {
    super(message);
    this.name = 'KapScrapeError';
    this.details = details;
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffMs(attempt: number) {
  const base = CONFIG.retryBaseDelayMs * Math.pow(2, attempt - 1);
  return base + Math.floor(Math.random() * Math.max(250, CONFIG.retryBaseDelayMs / 2));
}

function kapUrl(slug: string) {
  return slug.startsWith('http') ? slug : `${KAP_BASE}/${slug}`;
}

function errorCause(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return error.message;
  const record = cause as Record<string, unknown>;
  return JSON.stringify({
    code: record.code,
    errno: record.errno,
    syscall: record.syscall,
    address: record.address,
    port: record.port,
  });
}

function classifyFetchError(error: unknown): KapErrorType {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'TIMEOUT';
  const cause = (error as Error & { cause?: Record<string, unknown> }).cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  if (['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) return 'TIMEOUT';
  if (['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET'].includes(code)) return 'NETWORK_ERROR';
  if (error instanceof Error && error.message === 'fetch failed') return 'NETWORK_ERROR';
  return 'UNKNOWN_ERROR';
}

function shouldRetry(details: KapFetchDetails) {
  if (details.errorType === 'TIMEOUT' || details.errorType === 'NETWORK_ERROR' || details.errorType === 'KAP_BLOCKED') return true;
  if (details.httpStatus && [403, 408, 425, 429, 500, 502, 503, 504].includes(details.httpStatus)) return true;
  return false;
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 60_000);
  return undefined;
}

function looksLikeAccessBlock(html: string) {
  const sample = html.slice(0, 80_000).toLocaleLowerCase('en-US');
  return [
    'cf-chl-',
    'cloudflare',
    'captcha',
    'access denied',
    'request blocked',
    'too many requests',
  ].some(marker => sample.includes(marker));
}

function buildErrorMessage(details: KapFetchDetails) {
  const parts = [
    details.errorType || 'UNKNOWN_ERROR',
    details.httpStatus ? `HTTP ${details.httpStatus}` : null,
    details.errorMessage,
    `retry=${details.retryCount}`,
    `${details.durationMs}ms`,
  ].filter(Boolean);
  return parts.join(' | ');
}

async function fetchWithRetry(url: string): Promise<{ html: string; details: KapFetchDetails }> {
  const processingStartedAt = new Date().toISOString();
  const started = Date.now();
  let lastDetails: KapFetchDetails | null = null;

  for (let attempt = 0; attempt <= CONFIG.maxRetry; attempt++) {
    const remainingMs = CONFIG.totalTimeoutMs - (Date.now() - started);
    if (remainingMs <= 0) break;
    const attemptStarted = Date.now();
    try {
      const res = await fetch(url, {
        headers: KAP_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.max(1, Math.min(CONFIG.timeoutMs, remainingMs))),
      });
      const html = await res.text();
      const details: KapFetchDetails = {
        source: 'kap_web',
        resolvedKapUrl: url,
        requestUrl: url,
        httpStatus: res.status,
        statusText: res.statusText,
        durationMs: Date.now() - started,
        retryCount: attempt,
        retryAfterMs: retryAfterMs(res.headers.get('retry-after')),
        responseLength: html.length,
        processingStartedAt,
        processingFinishedAt: new Date().toISOString(),
      };

      if (res.ok && !looksLikeAccessBlock(html)) return { html, details };

      if (res.ok) {
        details.errorType = 'KAP_BLOCKED';
        details.errorMessage = 'KAP erişim doğrulama sayfası döndürdü';
      } else {
        details.errorType = `HTTP_${res.status}`;
        details.errorMessage = `KAP HTTP ${res.status} ${res.statusText}`;
      }
      lastDetails = details;
      if (!shouldRetry(details) || attempt >= CONFIG.maxRetry) break;
    } catch (error) {
      const details: KapFetchDetails = {
        source: 'kap_web',
        resolvedKapUrl: url,
        requestUrl: url,
        errorType: classifyFetchError(error),
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCause: errorCause(error),
        durationMs: Date.now() - started,
        retryCount: attempt,
        processingStartedAt,
        processingFinishedAt: new Date().toISOString(),
      };
      lastDetails = details;
      if (!shouldRetry(details) || attempt >= CONFIG.maxRetry) break;
    }

    const waitMs = lastDetails?.retryAfterMs ?? backoffMs(attempt + 1);
    const remainingAfterAttempt = CONFIG.totalTimeoutMs - (Date.now() - started);
    if (remainingAfterAttempt <= 0) break;
    await delay(Math.min(waitMs, remainingAfterAttempt));

    if (Date.now() - attemptStarted < 100) {
      await delay(250);
    }
  }

  const details = lastDetails || {
    source: 'kap_web' as const,
    resolvedKapUrl: url,
    requestUrl: url,
    errorType: 'UNKNOWN_ERROR' as const,
    errorMessage: 'KAP fetch failed before a response was captured',
    durationMs: Date.now() - started,
    retryCount: CONFIG.maxRetry,
    processingStartedAt,
    processingFinishedAt: new Date().toISOString(),
  };
  throw new KapScrapeError(buildErrorMessage(details), details);
}

export async function fetchCompanyPage(slug: string): Promise<{ html: string; details: KapFetchDetails }> {
  return fetchWithRetry(kapUrl(slug));
}

export function parseRSCPayload(html: string): Record<string, any> {
  const pattern = /\\"itemKey\\":\\"([^"]+?)\\",\\"value\\":((?:\[(?:[^\[\]]*|\[(?:[^\[\]]*|\[[^\[\]]*\])*\])*\])|(?:\\"[^"]*?\\"))/g;
  const result: Record<string, any> = {};
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const key = match[1];
    let rawVal = match[2];
    rawVal = rawVal.replace(/\\\\"/g, '"').replace(/\\"/g, '"');
    try {
      result[key] = JSON.parse(rawVal);
    } catch {
      result[key] = rawVal.replace(/^"|"$/g, '');
    }
  }

  return result;
}

export function hasGenelBilgiler(html: string): boolean {
  return html.includes('Genel Bilgiler') || html.includes('company__sgbf') || html.includes('\\"itemKey\\":');
}

export async function scrapeCompany(slug: string) {
  const { html, details } = await fetchCompanyPage(slug);

  if (!hasGenelBilgiler(html)) {
    return {
      status: 'no_data' as const,
      data: null,
      details: {
        ...details,
        errorType: 'NO_FINANCIAL_DATA' as const,
        errorMessage: 'Genel bilgiler alanı bulunamadı',
      },
    };
  }

  const data = parseRSCPayload(html);
  if (Object.keys(data).length === 0) {
    return {
      status: 'no_data' as const,
      data: null,
      details: {
        ...details,
        errorType: 'NO_FINANCIAL_DATA' as const,
        errorMessage: 'KAP sayfası geldi ancak işlenebilir veri alanı bulunamadı',
      },
    };
  }

  return { status: 'ok' as const, data, details };
}
