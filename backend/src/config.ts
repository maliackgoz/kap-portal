function parseList(value: string | undefined, fallback: string[] = []) {
  if (!value) return fallback;
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const production = process.env.NODE_ENV === 'production';

function secret(name: string, developmentFallback: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (production) {
    throw new Error(`${name} must be set when NODE_ENV=production`);
  }
  return developmentFallback;
}

export const config = Object.freeze({
  production,
  port: parsePositiveInt(process.env.PORT, 3001),
  appVersion: process.env.APP_VERSION?.trim() || 'dev',
  jwtSecret: secret('JWT_SECRET', 'kap-portal-development-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || '8h',
  adminUsername: process.env.ADMIN_USER?.trim() || 'admin',
  adminPassword: secret('ADMIN_PASS', 'kap2024'),
  loginMaxAttempts: parsePositiveInt(process.env.LOGIN_MAX_ATTEMPTS, 8),
  loginWindowMs: parsePositiveInt(process.env.LOGIN_WINDOW_MS, 15 * 60 * 1000),
  allowedOrigins: parseList(
    process.env.PORTAL_ALLOWED_ORIGINS,
    production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  ),
  trustProxy: process.env.TRUST_PROXY?.trim() || '',
});
