import assert from 'node:assert/strict';
import test from 'node:test';
import { hasGenelBilgiler, parseRSCPayload } from '../dist/services/scraper.js';

test('KAP RSC parser extracts scalar and table values', () => {
  const html = String.raw`
    1:["x",{"itemKey":"ignored"}]
    \"itemKey\":\"capital\",\"value\":\"250000000\"
    \"itemKey\":\"owners\",\"value\":[{\"name\":\"ORTAK A\",\"ratio\":\"51,0\"}]
  `;
  const parsed = parseRSCPayload(html);

  assert.equal(parsed.capital, '250000000');
  assert.deepEqual(parsed.owners, [{ name: 'ORTAK A', ratio: '51,0' }]);
});
test('KAP page detector accepts current RSC markers', () => {
  assert.equal(hasGenelBilgiler(String.raw`payload \"itemKey\":\"capital\"`), true);
  assert.equal(hasGenelBilgiler('<html><body>temporary page</body></html>'), false);
});
