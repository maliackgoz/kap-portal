# KAP Portal

KAP şirket profilleri, sermaye ve ortaklık verileri, kredi rating kayıtları,
finansal haberler ve ortaklık grafiğini tek kurumsal arayüzde birleştiren analiz
portalıdır.

## Bileşenler

- Portal ve REST API: `8063`
- Onyx uyumlu MCP endpoint: `8060/mcp`
- MCP sağlık kontrolü: `8060/health`
- Rating servisi: `8064`
- Veritabanı: SQLite
- Arayüz: React + Vite
- API: Express + TypeScript
- Rating servisi: FastAPI

Tek Docker container üç servisi birlikte çalıştırır. Portal veritabanı ve rating
önbelleği Docker volume'larında kalıcı tutulur.

## Şirket Sunucusuna Kurulum

Gereksinimler:

- Docker Engine 24+
- Docker Compose v2
- Sunucuda boş `8060`, `8063` ve `8064` portları

Projeyi alın:

```bash
git clone https://github.com/MehmetAliDascilar/kap-portal.git
cd kap-portal
cp .env.example .env
```

`.env` içinde en az şu değerleri değiştirin:

```dotenv
ADMIN_PASS=UZUN_VE_BENZERSIZ_BIR_SIFRE
JWT_SECRET=EN_AZ_64_KARAKTER_RASTGELE_BIR_DEGER
MCP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,0.0.0.0,SUNUCU_IP
```

KAP ve rating kaynakları container içinden çözülemiyorsa `.env` içindeki
`PRIMARY_DNS` ve `SECONDARY_DNS` değerlerini şirket DNS adresleriyle değiştirin.
Varsayılan değerler `1.1.1.1` ve `8.8.8.8`'dir.

Rastgele değer üretmek için Linux'ta:

```bash
openssl rand -hex 32
```

PowerShell'de:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Sistemi build edip başlatın:

```bash
docker compose up -d --build
docker compose ps
```

Kontrol:

```bash
curl -f http://127.0.0.1:8063/api/ready
curl -f http://127.0.0.1:8060/health
curl -f http://127.0.0.1:8064/health
```

Portal:

```text
http://SUNUCU_IP:8063
```

Kullanıcı adı `.env` içindeki `ADMIN_USER`, şifre `ADMIN_PASS` değeridir.

## Onyx MCP Bağlantısı

Onyx MCP URL:

```text
http://SUNUCU_IP:8060/mcp
```

Transport: `Streamable HTTP`

MCP ağı güvenilir değilse `.env` içinde `MCP_API_KEY` tanımlayın. Aynı değeri
Onyx bağlantısına `Authorization: Bearer ...` veya `X-API-Key` başlığı olarak
ekleyin.

MCP endpoint tarayıcıda sayfa olarak açılmaz. Bağlantı kontrolü için:

```text
http://SUNUCU_IP:8060/health
```

Tool listesi ve örnek sistem promptu için
[MCP kılavuzuna](docs/mcp-server.md) bakın.

## Veri Kalıcılığı

Compose iki kalıcı volume oluşturur:

- `kapportal_backend_data`: KAP veritabanı, üyeler ve işlem kayıtları
- `kapportal_rating_data`: rating, haber ve kaynak çalışma kayıtları

Container'ı silmek bu volume'ları silmez:

```bash
docker compose down
docker compose up -d
```

Volume'ları yalnızca tüm portal verisini bilinçli olarak sıfırlamak istediğinizde
silin:

```bash
docker compose down -v
```

## Güncelleme

Kaynak koddan çalışan kurulum:

```bash
git pull --ff-only
docker compose up -d --build
```

Hazır imaj kullanan kurulum:

```bash
docker compose pull
docker compose up -d
```

## Geliştirme

Gereksinimler:

- Node.js 22+
- Python 3.11+

```bash
npm ci
python -m pip install -e "./rating-service[dev]"
npm run dev
```

Geliştirme adresleri:

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:3001`
- Rating: `http://127.0.0.1:8787`

Yerel geliştirme hesabı: `admin / kap2024`. Bu demo şifresi üretimde
kullanılmamalıdır; Docker çalıştırırken `.env` zorunludur.

Tüm kontroller:

```bash
npm test
```

## Güvenlik

Portalı doğrudan internete açmak yerine kurumsal VPN, güvenlik duvarı veya TLS
sonlandıran bir reverse proxy arkasında çalıştırın. Ayrıntılar
[SECURITY.md](SECURITY.md) dosyasındadır.
