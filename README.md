# Finansal Portal

KAP (Kamuyu Aydinlatma Platformu) sirket verileri ile kredi rating/haber verilerini tek portalda birlestiren finansal analiz platformu.

Bu klasor artik tek proje kokudur:

- `backend/`: Express + TypeScript API, auth, KAP isleme, graph ve rating proxy
- `frontend/`: React + Vite portal arayuzu
- `rating-service/`: FastAPI tabanli Rating MCP servisi ve dosya tabanli rating/haber cache'i

## Ozellikler

- **Dashboard** — 1083 KAP sirketi, islem istatistikleri, son islemler
- **Sirket Detay** — Dropdown/arama ile sirket sec, tum KAP verilerini tablolar halinde goruntule, tek sirket guncelle
- **Kredi Rating** - TurkRating, JCR, SAHA, KobiRate, S&P Global Ratings, Moody's Ratings, Fitch Ratings kaynaklari, son notlar, rating haberleri, kaynak durumlari
- **Veri Isleme** - Bekleyen/hatalilar veya tum KAP sirketleri icin toplu veri cekme, SSE ile canli ilerleme, hata yonetimi
- **Ortaklik Grafi** — vis-network ile interaktif graph gorunumu
  - 6400+ dugum (sirket, ortak, kisi), 6500+ kenar
  - Derinlik, sektor, holding grubu, min pay orani filtreleri
  - Yol bulma (iki sirket arasi ortaklik zinciri)
  - Cluster renklendirme
  - Node boyutu (sermaye/baglanti sayisi)
- **Dark/Light tema**
- **Ticker destegi** — 604 BIST sirketi icin borsa kodu

## Tech Stack

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React 18, Vite, vis-network, lucide-react |
| Backend | Express, TypeScript, tsx |
| Rating Servisi | FastAPI, FastMCP, dosya tabanli JSONL cache |
| Veritabani | SQLite (better-sqlite3) |
| Auth | JWT (jsonwebtoken) |
| Veri Kaynagi | KAP (kap.org.tr) RSC payload parse |

## Hizli Baslangic

### Gereksinimler

- Node.js 18+
- npm

### Kurulum

```bash
git clone https://github.com/kenan2x/kapportal.git
cd kapportal

# Backend bagimliklar
cd backend && npm install && cd ..

# Frontend bagimlikllar
cd frontend && npm install && cd ..

# Root bagimliklar
npm install

# Rating servisi Python bagimliklari
npm run rating:install
```

### Veritabanini Olustur

```bash
cd backend
npx tsx src/seed.ts
```

Bu komut `kap-scraper/companies.json` dosyasindan 1083 sirketi SQLite'a yukler.

### Calistir

```bash
# Backend (3001), frontend (5173), rating servisi (8787)
npm run dev
```

Tarayicida: **http://localhost:5173**

Giris: `admin` / `kap2024`

Sadece KAP portalini calistirmak icin:

```bash
npm run dev:portal
```

### Veri Cekme

1. Portala giris yap
2. "Veri Isle" sekmesine git
3. Ilk kurulum icin "Bekleyen & Hatali Olanlari Isle" butonuna bas
4. Gunluk tazeleme icin "Tum KAP Verilerini Yenile" butonuna bas
5. 1083 sirket sirayla islenir (~1.5 saniye aralikla, ~30 dakika)

---

## Docker

Tek container portal, MCP HTTP endpoint ve rating servisini beraber baslatir.

### Build & Calistir

```bash
docker compose up --build -d
```

MCP health: **http://localhost:8060/health**
Onyx MCP URL: **http://localhost:8060/mcp**
Portal: **http://localhost:8063**
Rating health: **http://localhost:8064/health**

### Sadece Build

```bash
docker compose build
```

### Durdur

```bash
docker compose down
```

### Ortam Degiskenleri

| Degisken | Varsayilan | Aciklama |
|----------|-----------|----------|
| `PORT` | 8063 | Portal port |
| `MCP_PORT` | 8060 | MCP HTTP port |
| `MCP_PATH` | /mcp | MCP endpoint path |
| `RATING_SERVICE_PORT` | 8064 | Rating servisi port |
| `JWT_SECRET` | kap-portal-secret-2024 | JWT imzalama anahtari |
| `ADMIN_PASS` | kap2024 | Admin sifresi |

---

## API Endpointleri

### Auth
| Method | Path | Aciklama |
|--------|------|----------|
| POST | `/api/auth/login` | `{username, password}` → `{token}` |

### Dashboard
| Method | Path | Aciklama |
|--------|------|----------|
| GET | `/api/dashboard/stats` | Toplam/islenmis/hata/bekleyen sayilari |
| GET | `/api/dashboard/activity` | Son 50 islem logu |

### Sirketler
| Method | Path | Aciklama |
|--------|------|----------|
| GET | `/api/companies?search=X&status=done&page=1` | Sirket listesi (sayfalamali) |
| GET | `/api/companies/all/list` | Tum sirketler (dropdown icin) |
| GET | `/api/companies/:id` | Tek sirket bilgisi |
| GET | `/api/companies/:id/data` | Sirketin tum KAP verileri |
| POST | `/api/companies/:id/scrape` | Tek sirketi yeniden cek |

### Veri Isleme
| Method | Path | Aciklama |
|--------|------|----------|
| POST | `/api/processing/start` | Toplu islemeyi baslat. Body: `{ "scope": "pending" }` veya `{ "scope": "all" }` |
| POST | `/api/processing/stop` | Durdur |
| GET | `/api/processing/state` | Mevcut durum |
| GET | `/api/processing/events` | SSE stream (canli ilerleme) |

### Graph
| Method | Path | Aciklama |
|--------|------|----------|
| GET | `/api/graph/data?company_id=X&depth=2` | Graph verisi (tam veya subgraph) |
| GET | `/api/graph/stats` | Dugum/kenar sayilari |
| GET | `/api/graph/sectors` | Sektor listesi |
| GET | `/api/graph/path?from=X&to=Y` | Iki node arasi en kisa yol |
| GET | `/api/graph/clusters` | Bagli bilesenleri (cluster) |
| POST | `/api/graph/rebuild` | Graph cache'i yeniden olustur |

---

## MCP Server

Bu repo tek container icinde Onyx icin MCP HTTP endpoint'ini `8060`, portali `8063` ve rating servisini `8064` portunda acar.

```powershell
docker rm -f kapportal-mcp kapportal-mcp-remote kap-portal-kapportal-mcp-1 2>$null
docker pull memobaba44/kapportal-mcp:latest
docker run -d --name kapportal-mcp -p 8060:8060 -p 8063:8063 -p 8064:8064 memobaba44/kapportal-mcp:latest
```

Yeni portal: `http://172.30.146.31:8063`

Onyx MCP URL: `http://172.30.146.31:8060/mcp`

`/mcp` tarayicida normal sayfa gibi acilmaz; kontrol icin
`http://172.30.146.31:8060/health` kullanin. Varsayilan imaj `localhost`,
`127.0.0.1` ve `172.30.146.31` hostlarini kabul eder. IP degisirse
container'i `-e MCP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,0.0.0.0,YENI_IP`
ile calistirin.

Detayli kurulum ve 16 MCP tool listesi icin: [`docs/mcp-server.md`](docs/mcp-server.md)

Baslica tool'lar:

- `kap_status`
- `kap_search_companies`
- `kap_get_member_companies`
- `kap_get_company_profile`
- `kap_get_rating_sources`
- `kap_get_company_ratings`
- `kap_get_company_news`
- `kap_search_rating_news`
- `kap_get_company_financial_overview`
- `kap_get_company_relationships`
- `kap_find_relationship_path`
- `kap_start_kap_processing`
- `kap_refresh_company_from_kap`

---

## Proje Yapisi

```
kap-portal/
├── backend/
│   └── src/
│       ├── index.ts              # Express sunucu
│       ├── db.ts                 # SQLite baglantisi ve migration
│       ├── auth.ts               # JWT auth
│       ├── seed.ts               # companies.json → SQLite
│       ├── routes/
│       │   ├── dashboard.ts      # İstatistik API
│       │   ├── companies.ts      # Sirket CRUD + tek scrape
│       │   ├── processing.ts     # Toplu isleme + SSE
│       │   └── graph.ts          # Graph API
│       └── services/
│           ├── scraper.ts        # KAP RSC payload parser
│           ├── processor.ts      # Batch orchestrator
│           └── graph-builder.ts  # Graph olusturucu
├── frontend/
│   └── src/
│       ├── App.tsx               # Router + providers
│       ├── api.ts                # Backend API client
│       ├── components/
│       │   ├── Layout.tsx        # Sidebar + tema toggle
│       │   └── LoginForm.tsx     # Giris formu
│       ├── context/
│       │   ├── AuthContext.tsx    # JWT auth state
│       │   └── ThemeContext.tsx   # Dark/light tema
│       ├── hooks/
│       │   └── useSSE.ts         # EventSource hook
│       └── pages/
│           ├── Dashboard.tsx     # Istatistik kartlari
│           ├── CompanyDetail.tsx  # Sirket detay + filtreler
│           ├── DataProcessing.tsx # Toplu isleme UI
│           └── GraphPlaceholder.tsx # Ortaklik grafi
├── docs/
│   └── graph-design.md          # Graph tasarim dokumani
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## Lisans

MIT
