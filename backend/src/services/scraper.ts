const KAP_BASE = 'https://www.kap.org.tr/tr/sirket-bilgileri/genel';

const CONFIG = {
  timeoutMs: Number(process.env.KAP_REQUEST_TIMEOUT_MS || 30_000),
  maxRetry: Number(process.env.KAP_MAX_RETRY || 3),
  retryBaseDelayMs: Number(process.env.KAP_RETRY_BASE_DELAY_MS || 5_000),
};

const KAP_HEADERS = {
  'User-Agent': process.env.KAP_USER_AGENT || 'Mozilla/5.0 compatible internal financial portal crawler',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  Connection: 'close',
};

export type KapErrorType =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | `HTTP_${number}`
  | 'PARSE_ERROR'
  | 'NO_FINANCIAL_DATA'
  | 'UNKNOWN_ERROR';

export type KapFetchDetails = {
  resolvedKapUrl: string;
  requestUrl: string;
  httpStatus?: number;
  statusText?: string;
  errorType?: KapErrorType;
  errorMessage?: string;
  errorCause?: string;
  durationMs: number;
  retryCount: number;
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
  return CONFIG.retryBaseDelayMs * Math.pow(2, attempt - 1);
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
  if (details.errorType === 'TIMEOUT' || details.errorType === 'NETWORK_ERROR') return true;
  if (details.httpStatus === 429) return true;
  if (details.httpStatus && [500, 502, 503, 504].includes(details.httpStatus)) return true;
  return false;
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
    const attemptStarted = Date.now();
    try {
      const res = await fetch(url, {
        headers: KAP_HEADERS,
        signal: AbortSignal.timeout(CONFIG.timeoutMs),
      });
      const html = await res.text();
      const details: KapFetchDetails = {
        resolvedKapUrl: url,
        requestUrl: url,
        httpStatus: res.status,
        statusText: res.statusText,
        durationMs: Date.now() - started,
        retryCount: attempt,
        responseLength: html.length,
        processingStartedAt,
        processingFinishedAt: new Date().toISOString(),
      };

      if (res.ok) return { html, details };

      details.errorType = `HTTP_${res.status}`;
      details.errorMessage = `KAP HTTP ${res.status} ${res.statusText}`;
      lastDetails = details;
      if (!shouldRetry(details) || attempt >= CONFIG.maxRetry) break;
    } catch (error) {
      const details: KapFetchDetails = {
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

    await delay(backoffMs(attempt + 1));

    if (Date.now() - attemptStarted < 100) {
      await delay(250);
    }
  }

  const details = lastDetails || {
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
        errorMessage: 'Genel bilgiler alani bulunamadi',
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
        errorMessage: 'KAP sayfasi geldi ama parse edilebilir itemKey verisi yok',
      },
    };
  }

  return { status: 'ok' as const, data, details };
}
