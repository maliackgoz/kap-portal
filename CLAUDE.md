# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

KAP Portal — Turk sermaye piyasasi sirketlerinin ortaklik yapilarini analiz eden web platformu.
KAP (Kamuyu Aydinlatma Platformu, kap.org.tr) verilerini ceker, SQLite'a kaydeder, ortaklik graph'i olusturur.

## Proje Gecmisi ve Kararlar

### Veri Cekme Yaklasimi
- KAP sayfasi Next.js ile yapilmis, veri RSC (React Server Components) payload'inda gomulu geliyor
- **Playwright/headless browser GEREKLI DEGIL** — basit HTTP GET + regex ile RSC payload parse ediliyor
- `parse.py` ve `scraper.ts` ayni regex'i kullaniyor: `\"itemKey\":\"...\",\"value\":...`
- Her sirket sayfasinda ~25 veri noktasi var (iletisim, faaliyet, sermaye, yonetim, bagli ortakliklar)
- KAP rate-limit uyguluyor: istekler arasi ~1.5sn bekleme, hata durumunda 2 retry

### Graph Yapisi (docs/graph-design.md)
- 3 node tipi: Company (KAP sirketi), Shareholder (tuzel kisi), Person (gercek kisi)
- 3 edge tipi: OWNS_DIRECTLY, OWNS_INDIRECTLY, HAS_SUBSIDIARY
- "DIGER", "TOPLAM", "HALKA ACIK" gibi satirlar atlanir (graph'ta node yapilmaz)
- Isim eslestirme: normalize (Turkce karakter + A.S./TICARET/SANAYI/VE kaldirma) + tam eslestirme
- Hub node korumasi: 15+ baglantili node'lar subgraph BFS'te 2. derecede atlanir

### Bilinen Sorunlar
- 62 sirketin "Genel Bilgiler" sekmesi yok (BIST disi, status: no_data)
- 35 sirket hata verdi (KAP rate-limit veya sayfa yuklenemedi)
- Isim eslestirme %100 dogru degil — farkli yazimlar (A.S. vs ANONIM SIRKETI)
- Ticker sadece BIST sirketlerinde var (604/1083)

## Build & Run

### Development
```bash
# Backend (port 3001)
cd backend && npm install && npx tsx src/index.ts

# Frontend (port 5173, proxy /api → 3001)
cd frontend && npm install && npx vite
```

### Seed (ilk kurulum)
```bash
cd backend && npx tsx src/seed.ts
# companies.json'dan 1083 sirketi DB'ye yukler
# Ticker'lar veri cekildikten sonra otomatik dolar
```

### Docker
```bash
docker compose up --build
# http://localhost:3001
```

### Login
- Kullanici: `admin`
- Sifre: `kap2024` (ADMIN_PASS env ile degistirilebilir)

## Mimari

```
backend/src/
  index.ts          — Express app, CORS, static serve, auth middleware
  db.ts             — SQLite baglantisi, migration (companies, shareholders, processing_log)
  auth.ts           — JWT login + middleware (hardcoded admin/kap2024)
  seed.ts           — companies.json → SQLite
  services/
    scraper.ts      — fetchCompanyPage() + parseRSCPayload() (curl + regex)
    processor.ts    — Batch isleme, SSE broadcast, startProcessing/stopProcessing
    graph-builder.ts — buildGraph(), getSubgraph(), findPath(), getClusters(), getSectors()
  routes/
    dashboard.ts    — GET /stats, /activity
    companies.ts    — CRUD + tek sirket scrape + ticker search
    processing.ts   — POST /start, /stop, GET /state, /events (SSE)
    graph.ts        — GET /data, /stats, /sectors, /path, /clusters, POST /rebuild

frontend/src/
  App.tsx           — BrowserRouter, ThemeProvider, AuthProvider
  api.ts            — fetch wrapper, JWT header, tum API methodlari
  context/          — AuthContext (login/logout), ThemeContext (dark/light)
  hooks/useSSE.ts   — EventSource hook (processing events)
  components/       — Layout (sidebar), LoginForm
  pages/
    Dashboard.tsx       — Istatistik kartlari + son islemler tablosu
    CompanyDetail.tsx   — Dropdown + arama, tum veriler filtrelenebilir, tek scrape
    DataProcessing.tsx  — Batch start/stop, SSE progress, log tablosu
    GraphPlaceholder.tsx — vis-network graph, filtreler, yol bulma, cluster renkleri
```

## Veritabani Semasi

```sql
companies: id, name, slug, oid, ticker, status, last_processed_at, created_at
shareholders: id, company_id, item_key, value (JSON string), fetched_at
processing_log: id, company_id, action, message, created_at
```

- shareholders.item_key ornekleri: kpy41_acc5_sermayede_dogrudan, kpy41_acc5_odenmis_sermaye, kpy41_acc7_bagli_ortakliklar
- shareholders.value JSON olabilir (array/object) veya duz string

## Onemli Notlar

- Graph cache bellekte tutuluyor, /api/graph/rebuild ile yenilenir
- SSE endpoint (/api/processing/events) auth'u query param token ile yapiyor (EventSource header gonderemiyor)
- Frontend Vite proxy ile /api isteklerini backend'e yonlendiriyor (dev modda)
- Production'da backend frontend build'ini static olarak serve ediyor
- Turkce karakter normalizasyonu graph-builder.ts'teki TURKISH_MAP ile yapiliyor
