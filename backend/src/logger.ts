// Minimal yapisal logger. Bagimlilik yok: stdout/stderr'e yazar, rotasyonu
// Docker (json-file driver, max-size/max-file) yapar.
//   LOG_LEVEL  = debug | info | warn | error   (varsayilan info)
//   LOG_FORMAT = json | text                   (varsayilan: production'da json, degilse text)
// Not: bu modul config.ts'e bagimli degil, cunku config.ts'in kendisi hata firlatabilir.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(process.env.LOG_LEVEL?.trim().toLowerCase() as Level)] ?? LEVELS.info;
const json = (process.env.LOG_FORMAT?.trim().toLowerCase() || (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';
const service = process.env.LOG_SERVICE?.trim() || 'portal';

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, cause: serialize((value as any).cause) };
  }
  return value;
}

function write(level: Level, component: string, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value !== undefined) clean[key] = serialize(value);
  }

  let line: string;
  if (json) {
    line = JSON.stringify({ time, level, service, component, msg, ...clean });
  } else {
    const extra = Object.keys(clean).length ? ' ' + JSON.stringify(clean) : '';
    line = `${time} ${level.toUpperCase().padEnd(5)} [${component}] ${msg}${extra}`;
  }
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export function createLogger(component: string) {
  return {
    debug: (msg: string, fields?: Record<string, unknown>) => write('debug', component, msg, fields),
    info: (msg: string, fields?: Record<string, unknown>) => write('info', component, msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) => write('warn', component, msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => write('error', component, msg, fields),
  };
}

export const logger = createLogger('app');
