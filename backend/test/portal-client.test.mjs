import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { PortalClient } from '../dist/portal-mcp.js';

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function startServer(handler) {
  const server = createServer((req, res) => {
    void handler(req, res).catch(error => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('PortalClient caches successful login tokens', async t => {
  let loginHits = 0;
  const server = await startServer(async (req, res) => {
    if (req.url === '/api/auth/login' && req.method === 'POST') {
      const body = await readJson(req);
      assert.deepEqual(body, { username: 'admin', password: 'kap2024' });
      loginHits += 1;
      sendJson(res, 200, { token: 'token-1' });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
  t.after(server.close);

  const client = new PortalClient({
    baseUrl: `${server.url}/`,
    username: 'admin',
    password: 'kap2024',
  });

  assert.equal(client.baseUrl, server.url);
  assert.equal(await client.login(), 'token-1');
  assert.equal(await client.login(), 'token-1');
  assert.equal(loginHits, 1);
});

test('PortalClient clears expired tokens and retries once on 401', async t => {
  let loginHits = 0;
  let protectedHits = 0;
  const server = await startServer(async (req, res) => {
    if (req.url === '/api/auth/login' && req.method === 'POST') {
      loginHits += 1;
      sendJson(res, 200, { token: `token-${loginHits}` });
      return;
    }

    if (req.url === '/api/protected' && req.method === 'GET') {
      protectedHits += 1;
      if (req.headers.authorization === 'Bearer token-1') {
        sendJson(res, 401, { error: 'expired' });
        return;
      }

      assert.equal(req.headers.authorization, 'Bearer token-2');
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
  t.after(server.close);

  const client = new PortalClient({
    baseUrl: server.url,
    username: 'admin',
    password: 'kap2024',
  });

  assert.deepEqual(await client.request('/api/protected'), { ok: true });
  assert.equal(loginHits, 2);
  assert.equal(protectedHits, 2);
});
