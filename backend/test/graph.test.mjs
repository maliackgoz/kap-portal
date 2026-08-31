import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('relationship graph deduplicates owners and classifies subsidiaries as organizations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kap-graph-'));
  const databasePath = join(directory, 'graph.db');
  const script = String.raw`
    import db from './dist/db.js';
    import { buildGraph, getRelationshipSummary } from './dist/services/graph-builder.js';

    db.prepare("INSERT INTO companies (id, name, slug, oid, status) VALUES (1, 'MERKEZ A.Ş.', 'merkez', '1', 'done')").run();
    const insert = db.prepare("INSERT INTO shareholders (company_id, item_key, value) VALUES (1, ?, ?)");
    const corporateOwner = [
      { shareholder: 'ÖRNEK HOLDİNG A.Ş.', ratioInCapital: '51,00', shareInCapital: '510000' },
      { shareholder: 'GLOBAL ENERGY CY SA MERKEZI', ratioInCapital: '20,00', shareInCapital: '200000' },
    ];
    insert.run('kpy41_acc5_sermayede_dogrudan', JSON.stringify(corporateOwner));
    insert.run('kpy41_acc5_ortaklik_yapisi', JSON.stringify(corporateOwner));
    insert.run('kpy41_acc5_son_durum_sermayeye', JSON.stringify([{ shareholder: 'AYŞE YILMAZ', ratioInCapital: '12,50' }]));
    insert.run('kpy41_acc7_bagli_ortakliklar', JSON.stringify([{ companyTitle: 'ALPHA SHIPPING FZCO', ratioOfCapitalShareOfCompany: '100,00' }]));

    const graph = buildGraph();
    const summary = getRelationshipSummary(1, graph);
    process.stdout.write(JSON.stringify({ graph, summary }));
  `;

  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, KAP_DB_PATH: databasePath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.graph.edges.length, 4);
    assert.equal(payload.summary.directOwners.length, 2);
    assert.equal(payload.summary.indirectOwners.length, 1);
    assert.equal(payload.summary.subsidiaries.length, 1);
    assert.equal(
      payload.summary.directOwners.find(item => item.node.label === 'GLOBAL ENERGY CY SA MERKEZI').node.type,
      'shareholder',
    );
    assert.equal(payload.summary.subsidiaries[0].node.type, 'shareholder');
    assert.equal(payload.summary.subsidiaries[0].node.label, 'ALPHA SHIPPING FZCO');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('replacing KAP fields removes stale rows and invalidates the relationship graph', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kap-company-data-'));
  const databasePath = join(directory, 'company-data.db');
  const script = String.raw`
    import db from './dist/db.js';
    import { replaceCompanyData } from './dist/services/company-data.js';
    import { getGraph } from './dist/services/graph-builder.js';

    db.prepare("INSERT INTO companies (id, name, slug, oid, status) VALUES (1, 'MERKEZ A.Ş.', 'merkez', '1', 'done')").run();
    replaceCompanyData(1, {
      kpy41_acc5_sermayede_dogrudan: [{ shareholder: 'ESKİ ORTAK A.Ş.', ratioInCapital: '51,00' }],
      stale_field: 'artık gelmeyen alan',
    });
    const before = getGraph();

    const writeResult = replaceCompanyData(1, {
      kpy41_acc5_sermayede_dogrudan: [{ shareholder: 'YENİ ORTAK A.Ş.', ratioInCapital: '60,00' }],
    });
    const after = getGraph();
    const rows = db.prepare('SELECT item_key FROM shareholders WHERE company_id = 1 ORDER BY item_key').all();
    process.stdout.write(JSON.stringify({ before, after, rows, writeResult }));
  `;

  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, KAP_DB_PATH: databasePath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);

    assert.ok(payload.before.nodes.some(node => node.label === 'ESKİ ORTAK A.Ş.'));
    assert.ok(!payload.after.nodes.some(node => node.label === 'ESKİ ORTAK A.Ş.'));
    assert.ok(payload.after.nodes.some(node => node.label === 'YENİ ORTAK A.Ş.'));
    assert.deepEqual(payload.rows, [{ item_key: 'kpy41_acc5_sermayede_dogrudan' }]);
    assert.equal(payload.writeResult.keysWritten, 1);
    assert.equal(payload.writeResult.graphInvalidated, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
