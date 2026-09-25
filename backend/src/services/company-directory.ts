// KAP'in kendi sitesindeki sirket arama widget'inin on yukledigi tam sirket
// dizinini ceker. scraper.ts'deki RSC regex teknigiyle ayni yontem, farkli
// hedef: itemKey/value degil, companyPermaLinks dizisi. Dogrudan kap.org.tr'den,
// canli veriyle calisir.

const KAP_DIRECTORY_URL = process.env.KAP_DIRECTORY_URL || 'https://www.kap.org.tr/tr/bist-sirketler';

const HEADERS = {
  'User-Agent': process.env.KAP_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Connection: 'close',
};

export type CompanyDirectoryEntry = { name: string; slug: string; oid: string };

// Sayfanin RSC payload'inda gomulu arama indeksindeki her giris:
// {"mkkMemberOid":"...","kapMemberOid":"...","permaLink":"5900-...","title":"...","fundCode":"5900"}
const ENTRY_PATTERN = /\\"mkkMemberOid\\":\\"[^"\\]*\\",\\"kapMemberOid\\":\\"[^"\\]*\\",\\"permaLink\\":\\"([^"\\]*)\\",\\"title\\":\\"([^"\\]*)\\",\\"fundCode\\":\\"([^"\\]*)\\"/g;

export function parseCompanyDirectory(html: string): CompanyDirectoryEntry[] {
  const bySlug = new Map<string, CompanyDirectoryEntry>();
  let match: RegExpExecArray | null;

  ENTRY_PATTERN.lastIndex = 0;
  while ((match = ENTRY_PATTERN.exec(html)) !== null) {
    const [, slug, name, oid] = match;
    if (!slug || !oid || !name) continue;
    // Ayni sirket birden fazla kez gecebilir (birden fazla enstruman/tertip); ilkini tut.
    if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, oid });
  }

  return Array.from(bySlug.values());
}

export async function fetchCompanyDirectory(): Promise<CompanyDirectoryEntry[]> {
  const res = await fetch(KAP_DIRECTORY_URL, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`KAP dizin sayfası HTTP ${res.status} döndürdü (${KAP_DIRECTORY_URL})`);
  }

  const html = await res.text();
  const entries = parseCompanyDirectory(html);

  if (entries.length === 0) {
    throw new Error('KAP dizin sayfasından hiçbir şirket çıkarılamadı — sayfa yapısı değişmiş olabilir');
  }

  return entries;
}
