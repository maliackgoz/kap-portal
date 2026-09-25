import db from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Docker image'da data/ bos olabilir (volume), o zaman build sirasinda
// kopyalanan seed-data/ kullanilir. companies.json guncel tutmak icin:
// npm run companies:refresh (bkz. refresh-companies.ts)
const localPath = path.join(__dirname, '..', 'data', 'companies.json');
const packagedPath = path.join(__dirname, '..', 'seed-data', 'companies.json');
const companiesPath = fs.existsSync(localPath) ? localPath : packagedPath;

if (!fs.existsSync(companiesPath)) {
  console.error(`companies.json bulunamadı. Beklenen konumlar:\n  ${localPath}\n  ${packagedPath}`);
  process.exit(1);
}

const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));

// oid uzerinden upsert: sirket zaten varsa (yeniden adlandirilmis olabilir)
// isim/slug'ini yerinde gunceller, company_id ve tum gecmis veri (shareholders,
// processing_log, member_companies) korunur. Yoksa yeni satir acar.
const upsertStmt = db.prepare(`
  INSERT INTO companies (name, slug, oid) VALUES (?, ?, ?)
  ON CONFLICT(oid) DO UPDATE SET name = excluded.name, slug = excluded.slug
  WHERE name != excluded.name OR slug != excluded.slug
`);

const upsertMany = db.transaction((items: { name: string; slug: string; oid: string }[]) => {
  for (const c of items) {
    upsertStmt.run(c.name, c.slug, c.oid);
  }
});

const before = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c;
upsertMany(companies);
const after = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c;

console.log(`Seed tamamlandı: ${after} şirket (${after - before} yeni, ${companies.length} kaynak kayıt işlendi)`);
