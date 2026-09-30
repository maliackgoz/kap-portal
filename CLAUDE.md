# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**KAP Portal** (bir donem "Finansal Portal" adini tasidi; JWT issuer ve health `service` alaninda hala `finansal-portal` gecer, oturumlar bozulmasin diye degistirilmedi) — Turk sermaye piyasasi sirketleri icin kurumsal analiz platformu.
Tek Docker container icinde uc servis birlikte calisir:

1. **Backend** (`backend/`, Express + TypeScript) — KAP verisi, ortaklik grafi, auth, REST API, statik frontend sunumu
2. **Frontend** (`frontend/`, React 19 + Vite) — SPA arayuz
3. **Rating service** (`rating-service/`, Python + FastAPI) — kredi rating ve finansal haber toplama, kendi MCP sunucusu

Ayrica backend icinde ayri bir **MCP sunucusu** (`mcp.ts`/`mcp-http.ts`) calisir ve portal + rating verisini Onyx (AI asistan platformu) gibi MCP istemcilerine tool olarak sunar.

Bu proje vibe coding ile gelistiriliyor ve oyle devam edecek — asiri muhendislik yapmadan, mevcut kod stiliyle (raw SQL, minimal soyutlama) tutarli kal.

## Proje Gecmisi ve Kararlar

### Veri Cekme Yaklasimi (KAP)
- KAP sayfasi Next.js ile yapilmis, veri RSC (React Server Components) payload'inda gomulu geliyor
- **Playwright/headless browser GEREKLI DEGIL** — basit HTTP GET + regex ile RSC payload parse ediliyor
- `scraper.ts` regex kullaniyor: `\"itemKey\":\"...\",\"value\":...`
- Her sirket sayfasinda ~25 veri noktasi var (iletisim, faaliyet, sermaye, yonetim, bagli ortakliklar)
- KAP rate-limit uyguluyor: istekler arasi ~1.5-3sn bekleme (`KAP_REQUEST_DELAY_MS`), hata durumunda retry + cooldown (`KAP_MAX_RETRY`, `KAP_ERROR_COOLDOWN_*`)

### Sirket Dizini Yenileme (services/company-directory.ts)
- `companies.json` artik elle/donuk degil — `npm run companies:refresh` ile kap.org.tr'nin CANLI sirket arama widget'indan (`/tr/bist-sirketler` sayfasinda gomulu `companyPermaLinks` RSC verisi) yeniden uretilebiliyor
- Dogrudan kap.org.tr'den canli scrape ediliyor
- **oid tabanli fark analizi** — sadece slug'a bakarsak yeniden adlandirilan sirketler (ayni oid, farkli isim/slug — orn. "TBA TRKSH" -> "FREEDOM BANK A.Ş.") yanlislikla silme+ekleme sanilir. `companies.oid` uzerinde `idx_companies_oid` UNIQUE index var (db.ts), `seed.ts` `ON CONFLICT(oid) DO UPDATE` ile upsert yapiyor — yeniden adlandirmada company_id ve tum gecmis veri (shareholders, processing_log, member_companies) korunur, kopya satir acilmaz
- `refresh-companies.ts` gercek-yeni / gercek-kaldirilan / yeniden-adlandirilan ayrimini raporda gosterir. KAP dizininden kalkan sirketler DB'den otomatik silinmez (elle karar gerekir)
- Yeniden adlandirma tespit edildiginde eski isim otomatik olarak `backend/data/company-aliases.json`'a yazilir (oid -> {currentName, previousNames[]}) — elle giris degil, `refresh-companies.ts` her calistiginda birikir. Bu dosya `rating-service/sync_companies.py` tarafindan okunuyor (asagida)
- Kullanim: `npm run companies:refresh -- --dry-run` (onizleme, dosya degismez) / `npm run companies:refresh` (companies.json + company-aliases.json'i gunceller, companies.json icin `.bak-TARIH` yedek birakir, DB'ye dokunmaz)

### Kazimaya Alternatif: MicroStrategy (planlaniyor)
- MKK VYK API entegrasyonu (kap-api.ts, mkk:probe, KAP_DATA_SOURCE/MKK_* env) 2026-09-25'te KALDIRILDI. Tek aktif kaynak `scraper.ts`
- Plan: KAP verisi kurum DB'sinde tablolara basiliyor ama dogrudan DB erisimi yok; bu tablolardan bir MicroStrategy raporu yapilip MSTR REST API ile cekilecek. Tasarim: `docs/mstr-kaynak-tasarimi.md`
- **`companies.oid` MKK member id DEGIL** — KAP'in kisa sirket kodu (fundCode, orn. Akbank = `2413`, slug'in basindaki sayi). MKK'nin 32 haneli hex `mkkMemberOid`'i DB'de tutulmuyor (company-directory.ts regex'i goruyor ama kaydetmiyor)

### Graph Yapisi (docs/graph-design.md)
- 3 node tipi: Company (KAP sirketi), Shareholder (tuzel kisi), Person (gercek kisi)
- 3 edge tipi: OWNS_DIRECTLY, OWNS_INDIRECTLY, HAS_SUBSIDIARY
- "DIGER", "TOPLAM", "HALKA ACIK" gibi satirlar atlanir (graph'ta node yapilmaz)
- Isim eslestirme: normalize (Turkce karakter + A.S./TICARET/SANAYI/VE kaldirma) + tam eslestirme
- Hub node korumasi: 15+ baglantili node'lar subgraph BFS'te 2. derecede atlanir
- Frontend'de bu ekran `pages/OwnershipGraph.tsx` (rota: `/graph`). `pages/GraphPlaceholder.tsx` silindi (kullanilmiyordu, dogrulanmis olu kod).

### Rating & Haber Servisi
- Ayri bir Python uygulamasi, DB kullanmiyor — hersey `rating-service/data/*.jsonl` (append-only) + `data/exports/*` (CSV/MD)
- Kaynak bazinda scraper'lar: `app/scrapers/{jcr,kobirate,turkrating,saha,news}.py`
- Kendi FastAPI REST API'si + kendi MCP sunucusu (`app/mcp_server.py`, `/mcp` path)
- Backend, `routes/rating.ts` uzerinden bu servise duz proxy yapiyor (kendi DB'sine yazmiyor)
- Manuel CSV fallback importlari icin `data/imports/` var (Bloomberg gibi kaynaklar icin)
- **Global ajanslar (Fitch/S&P/Moody's) kaldirildi** (2026-09-29) — resmi API erisimi olmadan public arama sayfalari ya `NO_MATCH` ya da bot korumasindan `BLOCKED` donuyordu (bkz. gecmis run_log kayitlari), gercek veri cekilemiyordu. `app/scrapers/{fitch,spglobal,moodys,global_providers}.py`, `app/global_priority.yaml`, `global_provider_*` ayarlari (config.py, docker-compose.yml) ve `/api/refresh/{fitch,spglobal,moodys}` uc noktalari silindi. Aktif rating kaynaklari artik sadece TurkRating/JCR/SAHA/KobiRate — dordu de kendi yayinladiklari listeleme sayfasini kaziyor, KAP sirketine ozel arama yapmiyor
- **Sirket adi eslestirme (`normalizer.py`)**: portal ile rating-service arasinda foreign key YOK, her istekte `company.name` duz metin olarak gonderiliyor, rating-service `company_match_key()` + `rapidfuzz.fuzz.WRatio` (cutoff 88/92) ile eslestiriyor. Guvenilirlik `companies.yaml`'daki alias tablosuna bagli
- **`companies.yaml` artik portal'dan otomatik uretiliyor** (`rating-service/sync_companies.py`) — eskiden elle yazilmis 8 sirketlik bir listeydi. Global ajanslar kaldirildiktan sonra bu dosyanin tek islevi TurkRating/JCR/SAHA/KobiRate'in kendi listeledigi sirket isimlerini KAP adlarina eslestiren alias tablosu. Sync script `backend/data/companies.json` (tum KAP dizini) + `backend/data/company-aliases.json`'i (KAP'ta tespit edilen yeniden adlandirmalar, bkz. yukarida) okuyup `data/config/companies.yaml`'i yeniden uretir
  - Elle girilmis kayitlar (KAP uyesi olmayan ama rating alan sirketler, orn. varlik yonetim/faktoring) OLDUGU GIBI korunur
  - Portal kaydi elle girilmis bir ALIAS ile cakisirsa (ayni sirket, farkli yazim) ayri satir acilmaz, mevcut kayda alias olarak eklenir — cakisma tespiti icin `app.normalizer.company_match_key()` KULLANILIYOR (kendi basit normalize fonksiyonunu yazma, runtime'daki gercek eslestirmeyle ayni olmali yoksa iki kayit ayni anahtara dusup biri digerini sessizce ezer — bu hatayi yaparak bulduk)
  - Kullanim: `npm run companies:sync-rating` (repo kokunden) / `python sync_companies.py [--dry-run]` (rating-service icinden)

### Uye Sirketler (Members / Watchlist)
- `member_companies` tablosu: kullanicinin takip listesine ekledigi sirketler (company_id -> created_at)
- `routes/members.ts`: GET listele, PUT ile tum listeyi degistir, POST/DELETE ile tek sirket ekle/cikar
- `services/processor.ts`'deki `ProcessingScope` uc deger alir: `'pending' | 'all' | 'members'` — batch isleme sadece uye sirketlerle sinirlanabilir

### Bilinen Sorunlar
- 62 sirketin "Genel Bilgiler" sekmesi yok (BIST disi, status: no_data)
- 35 sirket hata verdi (KAP rate-limit veya sayfa yuklenemedi)
- Isim eslestirme %100 dogru degil — farkli yazimlar (A.S. vs ANONIM SIRKETI)
- Ticker sadece BIST sirketlerinde var (604/1083)
- Sema migrasyonu yok — `db.ts` icinde `CREATE TABLE IF NOT EXISTS` + ek kolonlar icin `try { ALTER TABLE ... } catch {}`. Yeni kolon eklerken bu pattern'i takip et.

## Build & Run

### Development (hepsi birden)
```bash
npm install                 # root workspace (backend + frontend)
npm run dev                 # backend (3001) + frontend (5173) + rating-service (8787) birlikte
npm run dev:portal          # sadece backend + frontend (rating-service olmadan)
```

### Rating service tek basina
```bash
npm run rating:install      # cd rating-service && pip install -e .[dev]
npm run rating:dev          # uvicorn --reload, port 8787
npm run rating:test         # pytest
```

### Seed (ilk kurulum)
```bash
npm run seed                # companies.json'daki sirketleri DB'ye yukler (oid'e gore upsert)
# Ticker'lar veri cekildikten sonra otomatik dolar
# index.ts DB bossa baslangicta otomatik seed de yapar
```

### Testler
```bash
npm test                    # backend build+test, rating pytest, frontend lint, full build
```

### Docker (production, tum servisler tek container)
```bash
cp .env.example .env        # ADMIN_PASS, JWT_SECRET, MCP_ALLOWED_HOSTS zorunlu
docker compose up -d --build
# Portal:  http://localhost:8063
# MCP:     http://localhost:8060/mcp  (health: :8060/health)
# Rating:  http://localhost:8064
```
`backend/src/start-all.ts` production'da ucunu de tek process manager olarak baslatiyor (portal, mcp-http, rating uvicorn — child process olarak spawn).

**Baska bir makinede, repo'yu klonlamadan, Docker Hub'a push edilmis image'i cekerek calistirmak icin** `docker-compose.deploy.yml` var — `docker-compose.yml`'den farki `build:`/`pull_policy: build` yok, bu yuzden her zaman image'i CEKER, yeniden build ETMEZ. Volume'lar (`kapportal_backend_data`, `kapportal_rating_data`) ayni isimde ama o makinede ilk kez calistigi icin bombos baslar — KAP verisi/rating/haber kayitlari bilincli olarak tasinmiyor (o makinenin kendi ag/proxy kosullarinda gercek bir ilk-calistirma testi icin). Kullanim: `cp .env.example .env && docker compose -f docker-compose.deploy.yml up -d` (`KAP_PORTAL_IMAGE` .env'de ayarlanmazsa varsayilan `maliackgoz/kapportal-mcp:latest`).

### Login
- Dev: `admin` / `kap2024` (config.ts fallback, sadece `NODE_ENV=production` degilken)
- Prod: `.env` icindeki `ADMIN_USER` / `ADMIN_PASS` — **production'da bu env var'lar yoksa app crash olur** (config.ts kasitli fail-fast)
- Viewer (salt okunur, opsiyonel): `.env` icindeki `VIEWER_USER` / `VIEWER_PASS`. JWT'de `role: 'viewer'` tasir; Ana Panel ve Veri Isleme menude yok, `/api/dashboard` + `/api/processing` `adminOnly`, `authMiddleware` viewer'in GET disindaki tum isteklerini 403 ile reddeder (scrape, rating yenileme, graph rebuild, uye listesi degisikligi). Frontend'de `useAuth().isAdmin` ile aksiyon butonlari gizleniyor. Role alani olmayan eski token'lar admin sayilir

## Mimari

```
backend/src/
  config.ts         — Ortam, kimlik dogrulama ve guvenlik ayarlari (prod'da secret yoksa throw eder)
  security.ts       — Guvenlik basliklari ve origin denetimi
  index.ts          — Express app, statik sunum, auth middleware, SSE token dogrulama
  db.ts             — SQLite baglantisi (WAL), migration (companies, shareholders, processing_log, member_companies)
  auth.ts           — JWT login, deneme sinirlama ve auth middleware
  seed.ts           — companies.json → SQLite (oid'e gore upsert)
  refresh-companies.ts — companies.json'i kap.org.tr'nin canli dizininden yeniden uretir (npm run companies:refresh)
  start-all.ts      — production'da portal + mcp-http + rating-service'i tek process olarak spawn eder
  mcp.ts            — MCP sunucusu (stdio transport, ~577 satir)
  mcp-http.ts        — MCP sunucusu (HTTP/Streamable transport, Onyx icin)
  portal-mcp.ts      — MCP tool tanimlari (kap_search_companies, kap_get_company_ratings, kap_find_relationship_path, vb. — tam liste docs/mcp-server.md)
  services/
    scraper.ts       — Sure asimi/tekrar denemeli KAP fetch ve RSC parser
    company-directory.ts — kap.org.tr'nin canli sirket arama widget'inden {name,slug,oid} listesi ceker (refresh-companies.ts kullanir)
    processor.ts      — Batch isleme (scope: pending/all/members), SSE broadcast, startProcessing/stopProcessing
    graph-builder.ts  — buildGraph(), getSubgraph(), findPath(), getClusters(), getSectors(), getRelationshipSummary()
    company-data.ts   — Sirket alanlarini shareholders tablosuna yazma + graph cache invalidation
  routes/
    dashboard.ts    — GET /stats, /activity
    companies.ts    — CRUD + tek sirket scrape + ticker search
    members.ts      — Uye sirket (watchlist) CRUD
    processing.ts   — POST /start (scope: pending/all/members), /stop, GET /state, /events (SSE)
    graph.ts        — GET /data, /stats, /sectors, /path, /clusters, POST /rebuild
    rating.ts        — rating-service'e duz HTTP proxy (health, ratings, news, refresh, export)

frontend/src/
  App.tsx           — BrowserRouter, ThemeProvider, AuthProvider
  api.ts            — fetch wrapper, JWT header, tum API methodlari
  context/          — AuthContext (login/logout), ThemeContext (dark/light)
  hooks/
    useSSE.ts             — EventSource hook (processing events)
    useMemberCompanies.ts — Uye sirket listesi state yonetimi
  components/       — Layout (sidebar), LoginForm, AppErrorBoundary
  pages/
    Dashboard.tsx       — Istatistik kartlari + son islemler tablosu
    CompanyDetail.tsx   — Dropdown + arama, tum veriler filtrelenebilir, tek scrape
    DataProcessing.tsx  — Batch start/stop, SSE progress, log tablosu
    OwnershipGraph.tsx  — vis-network graph, filtreler, yol bulma, cluster renkleri (aktif graph sayfasi, rota /graph)
    RatingCenter.tsx    — Kredi rating goruntuleme/arama (rating-service proxy'si uzerinden)
    NewsCenter.tsx      — Finansal haber goruntuleme/arama (rating-service proxy'si uzerinden)
    NotFound.tsx

rating-service/
  sync_companies.py    — companies.yaml'i portal'in canli sirket dizininden yeniden uretir (npm run companies:sync-rating)
  app/
    main.py          — FastAPI app, Jinja2 dashboard, optional Bearer API key middleware
    mcp_server.py     — Bu servisin kendi MCP tool sunucusu (/mcp path)
    config.py         — Settings (env prefix RATING_MCP_), data_dir altinda ratings/news/run_log/raw/pdfs/exports/imports/config
    cli.py            — `rating-mcp` CLI entry point
    normalizer.py, dedupe.py — Rating/haber kaydi normalize etme ve tekillestirme
    scrapers/         — Kaynak basina bir dosya: jcr, kobirate, turkrating, saha, news
    services/         — ratings.py, news.py, reports.py (is mantigi, scraper'lari cagirir)
    default_config/, data/config/ — companies.yaml, sources.yaml (izlenen sirket/kaynak listeleri)
  data/               — JSONL depolama (DB yok): ratings.jsonl, news.jsonl, run_log.jsonl + exports/raw/pdfs/imports alt klasorleri
  tests/              — pytest suite (Makefile: make test)
```

## Veritabani Semasi (backend, SQLite)

```sql
companies:         id, name, slug, oid, ticker, status, last_processed_at, created_at
shareholders:       id, company_id, item_key, value (JSON string), fetched_at
processing_log:     id, company_id, action, message, created_at
member_companies:   company_id (PK, FK->companies, CASCADE), created_at
```

- `shareholders.item_key` ornekleri: `kpy41_acc5_sermayede_dogrudan`, `kpy41_acc5_odenmis_sermaye`, `kpy41_acc7_bagli_ortakliklar`
- `shareholders.value` JSON olabilir (array/object) veya duz string
- Rating/haber verisi bu DB'de DEGIL — rating-service kendi JSONL dosyalarinda tutuyor

## MCP Sunuculari (iki ayri sunucu var, karistirma)

1. **Backend MCP** (`backend/src/mcp.ts` / `mcp-http.ts`, port 8060, path `/mcp`) — portal + graph + rating + haber verisini tek yerden birlestirip Onyx'e sunar. 16 tool: `kap_status`, `kap_search_companies`, `kap_get_member_companies`, `kap_get_company_profile`, `kap_get_rating_sources`, `kap_get_company_ratings`, `kap_get_company_news`, `kap_search_rating_news`, `kap_get_company_financial_overview`, `kap_find_nodes`, `kap_get_company_relationships`, `kap_find_relationship_path`, `kap_top_relationship_clusters`, `kap_rebuild_relationship_graph`, `kap_start_kap_processing`, `kap_refresh_company_from_kap`. Tam liste ve onerilen Onyx sistem promptu: `docs/mcp-server.md`.
2. **Rating service MCP** (`rating-service/app/mcp_server.py`, port 8787 dev / 8064 prod, path `/mcp`) — sadece rating/haber tool'lari, Onyx'e ayrica direkt de baglanabilir.

Backend MCP, portal API'sine kendi JWT login'ini yaparak erisir (`start-all.ts` icinde `KAP_PORTAL_USERNAME`/`KAP_PORTAL_PASSWORD` env, varsayilan olarak `ADMIN_USER`/`ADMIN_PASS`'i kullanir).

## Onemli Notlar

- Graph cache bellekte tutuluyor, `/api/graph/rebuild` veya `company-data.ts` uzerinden veri yazildiginda otomatik invalidate edilir
- SSE endpoint (`/api/processing/events`) auth'u query param token ile yapiyor (EventSource header gonderemiyor) — yeni SSE endpoint eklersen ayni pattern'i kullan
- Frontend Vite proxy ile `/api` isteklerini backend'e yonlendiriyor (dev modda)
- Production'da backend frontend build'ini static olarak serve ediyor (`backend/public/`)
- Turkce karakter normalizasyonu `graph-builder.ts` ve `routes/companies.ts` icindeki normalize fonksiyonlarinda ayri ayri yapiliyor
- `config.ts` prod'da `JWT_SECRET`/`ADMIN_PASS` yoksa throw ediyor — env eksikse app hic baslamaz (kasitli, guvenlik icin)
- Rating servisi DB kullanmiyor, hersey dosya tabanli (`.jsonl` + CSV/MD export) — rating/haber debug ederken SQLite'a bakma, `rating-service/data/` klasorune bak
- Docker'da tek image, tek container, uc port (8060 MCP, 8063 portal, 8064 rating) — `docker-compose.yml` health check ucunu de kontrol ediyor
