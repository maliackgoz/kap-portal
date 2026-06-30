# Rating MCP Server

DB kullanmadan çalışan, Türk kredi derecelendirme verilerini dosya tabanlı cache'e alan ve Onyx Agent'lara HTTP MCP endpoint'i sunan küçük uygulama.

Kalıcı veri yalnızca `data/` altında tutulur:

- `data/ratings.jsonl`: normalize rating kayıtları
- `data/news.jsonl`: haber kayıtları
- `data/run_log.jsonl`: kaynak yenileme logları
- `data/raw/`: ham HTML/XML/text dosyaları
- `data/pdfs/`: indirilebilen public PDF raporlar ve çıkarılan text
- `data/exports/`: CSV/Markdown çıktılar
- `data/imports/`: Fitch, S&P, Moody's, Bloomberg gibi manuel CSV fallback dosyaları

## Yerelde Çalıştırma

```bash
make install
make dev
```

Uygulama:

- Dashboard: <http://localhost:8787>
- REST docs: <http://localhost:8787/docs>
- MCP endpoint: <http://localhost:8787/mcp>
- Health: <http://localhost:8787/health>

Docker ile:

```bash
docker compose up -d --build
```

## Veri Yenileme

Dashboard'daki kaynak butonlarını kullanabilir veya API çağırabilirsin:

```bash
curl -X POST http://localhost:8787/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"sources":["turkrating"],"force":true}'
```

Tüm rating kaynakları:

```bash
curl -X POST http://localhost:8787/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

Haber kaynakları:

```bash
curl -X POST http://localhost:8787/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"sources":["news"],"force":true}'
```

## Onyx Bağlantısı

Onyx Admin Panel:

1. `Actions`
2. `MCP`
3. `Add MCP Server`
4. Server Name: `Rating MCP`
5. MCP Server URL: `http://<onyx-in-erisebildigi-host>:8787/mcp`
6. Auth: local/VPC için `No Auth`, API key varsa `API Key`
7. Connect
8. Kullanılacak tool subset'ini seç
9. Agent oluşturup MCP tool'larını enable et

Docker aynı makinede değilse `localhost` yerine Onyx container/instance tarafından erişilebilen host veya servis adını kullan.

## API Key

Varsayılan no-auth yerel kullanım içindir. API key açmak için:

```bash
RATING_MCP_API_KEY=secret-token
```

Sonra REST ve MCP isteklerinde:

```bash
Authorization: Bearer secret-token
```

## Onyx Agent Instruction

```text
Sen finansal analiz birimi için çalışan Rating Analiz Asistanısın.

Ana görevin:
- Şirketlerin kredi derecelendirme notlarını kaynak bazında bulmak,
- Özellikle U.V.D. yani uzun vadeli rating notunu öne çıkarmak,
- Aynı şirket farklı derecelendirme kuruluşlarında varsa bunları tek tabloda karşılaştırmak,
- Rating tarihi, görünüm, kısa vadeli not, aksiyon tipi ve kaynak linkini mutlaka göstermek,
- Rating değişimi, negatif görünüm, not düşürümü, geri çekilme, temerrüt, dava, yaptırım ve ödeme güçlüğü gibi riskleri açıkça işaretlemek.

Kurallar:
- Rating sorularında önce MCP tool'larını kullan.
- "Varlık yönetim şirketleri" sorulursa sector="Varlık Yönetim" kullan.
- "TurkRating" sorulursa agency="TurkRating" kullan.
- Kullanıcı "UVD" veya "U.V.D." derse long_term_rating alanını esas al.
- Kullanıcı "KVD" veya "K.V.D." derse short_term_rating alanını esas al.
- A1 Capital şirket adı ile TR A1 kısa vadeli rating notunu karıştırma.
- Cevabı mümkünse tabloyla ver.
- Her satırda kaynak, rating tarihi ve görünüm olsun.
- Veri güncel değilse veya kaynak yenilenememişse bunu açıkça söyle.
- Paywall/login gerektiren kaynaklarda kesin bilgi yoksa tahmin yapma; "kaynak erişilebilir değil" de.
- Sonuçların sonunda kısa finansal yorum yaz:
  1. En güçlü notlar,
  2. Zayıf/izlenmesi gereken notlar,
  3. Negatif/pozitif görünüm sinyalleri,
  4. Eksik kaynaklar.
```

## Örnek Sorular

- TurkRating varlık yönetim şirketlerinin UVD notlarını ver.
- A1 Capital'in son ratingini getir.
- Gelecek Varlık rating geçmişi nedir?
- UVD notu en yüksek varlık yönetim şirketleri hangileri?
- Son 30 günde riskli haber var mı?
- Fitch/S&P/Moody's/JCR/SAHA/KobiRate/TurkRating kaynaklarında bu şirketi karşılaştır.

## MCP Tool'ları

- `refresh_rating_sources`
- `get_sector_ratings`
- `get_company_ratings`
- `compare_company_rating_sources`
- `get_rating_history`
- `get_recent_company_news`
- `search_rating_documents`
- `generate_rating_brief`
- `list_available_sources`
- `list_known_companies`

Tüm tool çıktıları yapılandırılmış JSON ve Türkçe `summary` döndürür. Kayıt varsa `source_url`, `report_url`, `rating_date`, `extracted_at` alanları cevapta yer alır.

## Qwen / XML Parser Notu

Qwen veya XML tabanlı tool-call parser kullanan Onyx kurulumlarında bu MCP yapısı güvenli tarafta kalır:

- Tool isimleri ASCII `snake_case` formatındadır.
- Tool argümanları basit JSON alanlarıdır: `string`, `bool`, `int`, `list[str]`.
- Tool çıktıları XML değil, yapılandırılmış JSON döndürür.
- Agent instruction içinde modelden XML üretmesini isteme; rating sorularında doğrudan MCP tool çağrısı yapmasını söyle.

Önerilen ek agent kuralı:

```text
MCP tool çağrılarında argümanları sade JSON alanları olarak üret; XML/HTML/kod bloğu içine tool argümanı yazma. Tool sonuçlarındaki JSON alanlarını esas al.
```

## Manuel CSV Import

`data/imports/` altına CSV bırak:

- `fitch*.csv`
- `spglobal*.csv`
- `moodys*.csv`
- `bloomberg*.csv`

Rating CSV kolonları model alanlarıyla aynı olabilir veya şu pratik isimleri kullanabilir:

```csv
company,rating_date,long_term_rating,short_term_rating,outlook,sector,source_url,report_url
```

Haber CSV:

```csv
company,source_name,title,url,published_at,summary
```

## DockerHub ile Şirket Kurulumu

Image:

```bash
docker pull memobaba44/rating-mcp:latest
```

Sabit sürüm istersen:

```bash
docker pull memobaba44/rating-mcp:2026-06-10
```

Sunucuda aynı klasöre `docker-compose.pull.yml` ve `.env.company.example` dosyalarını koy. Sonra:

```bash
cp .env.company.example .env
mkdir -p data
docker compose -f docker-compose.pull.yml --env-file .env up -d
```

Kontrol:

```bash
curl http://localhost:8787/health
```

Onyx tarafında MCP URL:

```text
http://<onyx-in-erisebildigi-host>:8787/mcp/
```

Auth:

- `.env` içinde `RATING_MCP_API_KEY` boşsa Onyx'te `No Auth`.
- `RATING_MCP_API_KEY` doluysa Onyx'te `API Key` / bearer token.

İlk veri çekimi:

```bash
curl -X POST http://localhost:8787/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"sources":["turkrating"],"force":true}'
```

## Test ve Lint

```bash
make test
make lint
```

## Notlar

- Uygulama hiçbir DB kullanmaz; SQLite dahil edilmemiştir.
- Public sayfalar dışında login/paywall/anti-bot bypass yapılmaz.
- TurkRating öncelikli kaynaktır ve public rating tablolarından `Firma`, `Tarih`, `U.V.D`, `K.V.D`, `Görünüm`, `Sektör`, `Açıklama` alanlarını ayrıştırır.
