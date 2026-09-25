import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCompanyDirectory } from '../dist/services/company-directory.js';

test('KAP sirket dizini RSC payload\'indan cikarilir', () => {
  const html = String.raw`
    ...\"CLIENT_API_BASE_URL\":\"https://kapsitebackend.mkk.com.tr\",\"pageType\":\"IGS\",\"pageState\":\"A\",\"companyPermaLinks\":[{\"mkkMemberOid\":\"402821814da3a99c014f3b4e25ff608e\",\"kapMemberOid\":\"8acae2c57d3bf001017f470f93896e09\",\"permaLink\":\"3651-koleksiyon-mobilya-sanayi-a-s\",\"title\":\"KOLEKSİYON MOBİLYA SANAYİ A.Ş.\",\"fundCode\":\"3651\",\"fundOid\":null},{\"mkkMemberOid\":\"x\",\"kapMemberOid\":\"y\",\"permaLink\":\"5900-1000-yatirimlar-holding-a-s\",\"title\":\"1000 YATIRIMLAR HOLDİNG A.Ş.\",\"fundCode\":\"5900\",\"fundOid\":null}]
  `;

  const entries = parseCompanyDirectory(html);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    name: 'KOLEKSİYON MOBİLYA SANAYİ A.Ş.',
    slug: '3651-koleksiyon-mobilya-sanayi-a-s',
    oid: '3651',
  });
  assert.deepEqual(entries[1], {
    name: '1000 YATIRIMLAR HOLDİNG A.Ş.',
    slug: '5900-1000-yatirimlar-holding-a-s',
    oid: '5900',
  });
});

test('Ayni sirket birden fazla gecerse tekillestirilir', () => {
  const entry = String.raw`\"mkkMemberOid\":\"a\",\"kapMemberOid\":\"b\",\"permaLink\":\"222-ornek-a-s\",\"title\":\"ÖRNEK A.Ş.\",\"fundCode\":\"222\"`;
  const html = `[{${entry}},{${entry}}]`;

  const entries = parseCompanyDirectory(html);
  assert.equal(entries.length, 1);
});

test('Bos veya alakasiz HTML bos dizi doner', () => {
  assert.deepEqual(parseCompanyDirectory('<html><body>ilgisiz</body></html>'), []);
});
