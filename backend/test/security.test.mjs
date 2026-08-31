import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { cors, securityHeaders } from '../dist/security.js';

function responseMock() {
  const headers = new Map();
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
  };
}

test('production config refuses to start without secrets', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "import './dist/config.js'"],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', ADMIN_PASS: '' },
      encoding: 'utf8',
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET must be set/);
});

test('security headers disable framing and content sniffing', () => {
  const res = responseMock();
  let nextCalled = false;
  securityHeaders({}, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('CORS accepts same-origin requests and rejects foreign origins', () => {
  const allowedRes = responseMock();
  let allowedNext = false;
  cors({
    protocol: 'http',
    method: 'POST',
    get(name) {
      if (name === 'origin') return 'http://portal.local';
      if (name === 'host') return 'portal.local';
      return undefined;
    },
  }, allowedRes, () => { allowedNext = true; });

  assert.equal(allowedNext, true);
  assert.equal(allowedRes.headers.get('access-control-allow-origin'), 'http://portal.local');

  const blockedRes = responseMock();
  cors({
    protocol: 'http',
    method: 'POST',
    get(name) {
      if (name === 'origin') return 'https://untrusted.example';
      if (name === 'host') return 'portal.local';
      return undefined;
    },
  }, blockedRes, () => {});

  assert.equal(blockedRes.statusCode, 403);
  assert.equal(blockedRes.body.error, 'Bu kaynaktan erişime izin verilmiyor');
});
