// companies.json'i KAP'in canli sirket dizininden yeniden uretir.
// Hem CLI (`tsx src/refresh-companies.ts [--dry-run]`) hem de
// routes/companies.ts'teki POST /directory/refresh tarafindan cagrilir.

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { fetchCompanyDirectory, type CompanyDirectoryEntry } from './services/company-directory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companiesPath = path.join(__dirname, '..', 'data', 'companies.json');
const aliasesPath = path.join(__dirname, '..', 'data', 'company-aliases.json');

type AliasEntry = { oid: string; currentName: string; previousNames: string[] };
type Renamed = { before: CompanyDirectoryEntry; after: CompanyDirectoryEntry };

export type RefreshReport = {
  total: number;
  before: number;
  added: CompanyDirectoryEntry[];
  removed: CompanyDirectoryEntry[];
  renamed: Renamed[];
  dryRun: boolean;
};

function updateAliases(renamed: Renamed[]): AliasEntry[] {
  const existing: AliasEntry[] = fs.existsSync(aliasesPath)
    ? JSON.parse(fs.readFileSync(aliasesPath, 'utf-8'))
    : [];
  const byOid = new Map(existing.map(e => [e.oid, e]));

  for (const { before, after } of renamed) {
    const entry = byOid.get(after.oid) ?? { oid: after.oid, currentName: after.name, previousNames: [] };
    if (!entry.previousNames.includes(before.name) && before.name !== after.name) {
      entry.previousNames.push(before.name);
    }
    entry.currentName = after.name;
    byOid.set(after.oid, entry);
  }

  return Array.from(byOid.values()).sort((a, b) => a.currentName.localeCompare(b.currentName, 'tr'));
}

export async function refreshCompanyDirectory(options: { dryRun?: boolean } = {}): Promise<RefreshReport> {
  const dryRun = options.dryRun ?? false;

  const existing: CompanyDirectoryEntry[] = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));
  const existingByOid = new Map(existing.map(c => [c.oid, c]));

  const fresh = await fetchCompanyDirectory();
  const freshByOid = new Map(fresh.map(c => [c.oid, c]));

  // oid degismedigi surece slug/isim degisikligi gercek ekleme/kaldirma degil,
  // yeniden adlandirmadir (DB'de sadece slug UNIQUE, oid degil -> ayrimini
  // yanlis yaparsak reseed'de ayni sirket icin iki satir olusur).
  const added = fresh.filter(c => !existingByOid.has(c.oid));
  const removed = existing.filter(c => !freshByOid.has(c.oid));
  const renamed = fresh
    .map(c => ({ before: existingByOid.get(c.oid), after: c }))
    .filter((x): x is Renamed => Boolean(x.before) && x.before!.slug !== x.after.slug);

  if (!dryRun) {
    const backupPath = `${companiesPath}.bak-${new Date().toISOString().slice(0, 10)}`;
    fs.copyFileSync(companiesPath, backupPath);

    const sorted = [...fresh].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    fs.writeFileSync(companiesPath, `${JSON.stringify(sorted, null, 2)}\n`);

    if (renamed.length) {
      const aliases = updateAliases(renamed);
      fs.writeFileSync(aliasesPath, `${JSON.stringify(aliases, null, 2)}\n`);
    }
  }

  return { total: fresh.length, before: existing.length, added, removed, renamed, dryRun };
}

function printReport(report: RefreshReport) {
  console.log(`\nMevcut companies.json : ${report.before} şirket`);
  console.log(`KAP'tan çekilen       : ${report.total} şirket`);
  console.log(`Gerçek yeni           : ${report.added.length}`);
  console.log(`Gerçek kaldırılan     : ${report.removed.length}`);
  console.log(`Yeniden adlandırılan  : ${report.renamed.length} (aynı oid, farklı slug/isim — ekleme/kaldırma SAYILMADI)`);

  if (report.added.length) {
    console.log(`\n--- Yeni eklenecekler (ilk 20) ---`);
    for (const c of report.added.slice(0, 20)) console.log(`  ${c.oid}\t${c.name}`);
    if (report.added.length > 20) console.log(`  ... ve ${report.added.length - 20} tane daha`);
  }
  if (report.removed.length) {
    console.log(`\n--- Gerçekten kaldırılacaklar (KAP dizininde oid'i artık yok) ---`);
    for (const c of report.removed) console.log(`  ${c.oid}\t${c.name}`);
  }
  if (report.renamed.length) {
    console.log(`\n--- Yeniden adlandırılanlar (oid aynı kaldı) ---`);
    for (const { before, after } of report.renamed) console.log(`  ${after.oid}\t"${before.name}" -> "${after.name}"`);
  }

  if (report.dryRun) {
    console.log(`\n--dry-run: dosya değiştirilmedi.`);
    return;
  }

  console.log(`\ncompanies.json güncellendi (${report.total} şirket).`);
  console.log(`DB'ye uygulamak için: npm run seed (oid'e göre upsert yapar — yeniden adlandırılan`);
  console.log(`şirketler için mevcut satırı günceller, kopya satır açmaz; sadece gerçekten yeni`);
  console.log(`oid'ler için yeni satır ekler).`);
  console.log(`Rating servisine uygulamak için: npm run companies:sync-rating (companies.yaml'ı`);
  console.log(`bu listeden yeniden üretir, elle eklenmiş kayıtları/alias'ları korur).`);
  if (report.removed.length) {
    console.log(`Not: KAP dizininden kalkan ${report.removed.length} şirket DB'den otomatik silinmiyor (mevcut veri korunuyor, elle karar vermeniz gerekir).`);
  }
}

const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCliEntry) {
  console.log(`KAP dizin sayfası çekiliyor...`);
  refreshCompanyDirectory({ dryRun: process.argv.includes('--dry-run') })
    .then(printReport)
    .catch(err => {
      console.error('Hata:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
