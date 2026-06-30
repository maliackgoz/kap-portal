import db from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Try local first, then kap-scraper fallback
const localPath = path.join(__dirname, '..', 'data', 'companies.json');
const packagedPath = path.join(__dirname, '..', 'seed-data', 'companies.json');
const scraperPath = path.join(__dirname, '..', '..', '..', 'kap-scraper', 'companies.json');
const companiesPath = fs.existsSync(localPath) ? localPath : fs.existsSync(packagedPath) ? packagedPath : scraperPath;

if (!fs.existsSync(companiesPath)) {
  console.error(`companies.json bulunamadi. Beklenen lokasyonlar:\n  ${localPath}\n  ${packagedPath}\n  ${scraperPath}`);
  process.exit(1);
}

const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));

const stmt = db.prepare(`
  INSERT OR IGNORE INTO companies (name, slug, oid) VALUES (?, ?, ?)
`);

const insertMany = db.transaction((items: { name: string; slug: string; oid: string }[]) => {
  for (const c of items) {
    stmt.run(c.name, c.slug, c.oid);
  }
});

insertMany(companies);

const count = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c;
console.log(`Seed tamamlandi: ${count} sirket`);
