# KAP Portal + MCP Kurulum

Bu Docker imaji tek container icinde KAP Portal'i, Onyx icin MCP HTTP endpoint'ini ve rating servisini beraber kaldirir.

- Portal: `http://172.30.146.31:8063`
- MCP endpoint: `http://172.30.146.31:8060/mcp`
- MCP health: `http://172.30.146.31:8060/health`
- Rating health: `http://172.30.146.31:8064/health`
- Login: `admin` / `kap2024`
- Tool sayisi: `16`

IP farkliysa `172.30.146.31` yerine sunucunun IP adresini yaz.

## Eski KAP Portal Containerlarini Temizle

Asagidaki komut sadece bu portal icin daha once acilan container isimlerini kaldirir. Onyx veya baska servis containerlarina dokunmaz.

```powershell
docker rm -f kapportal-mcp kapportal-mcp-remote kap-portal-kapportal-mcp-1 2>$null
```

Portlari kontrol etmek istersen:

```powershell
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

## Pull + Run

```powershell
docker pull memobaba44/kapportal-mcp:latest

docker run -d --name kapportal-mcp `
  -p 8060:8060 `
  -p 8063:8063 `
  -p 8064:8064 `
  -e PORT=8063 `
  -e MCP_PORT=8060 `
  -e MCP_PATH=/mcp `
  -e KAP_PORTAL_URL=http://127.0.0.1:8063 `
  -e KAP_PORTAL_USERNAME=admin `
  -e KAP_PORTAL_PASSWORD=kap2024 `
  -e MCP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,0.0.0.0,172.30.146.31 `
  memobaba44/kapportal-mcp:latest
```

Linux shell kullanirsan satir sonu karakteri olarak backtick yerine `\` kullan:

```bash
docker pull memobaba44/kapportal-mcp:latest

docker run -d --name kapportal-mcp \
  -p 8060:8060 \
  -p 8063:8063 \
  -p 8064:8064 \
  -e PORT=8063 \
  -e MCP_PORT=8060 \
  -e MCP_PATH=/mcp \
  -e KAP_PORTAL_URL=http://127.0.0.1:8063 \
  -e KAP_PORTAL_USERNAME=admin \
  -e KAP_PORTAL_PASSWORD=kap2024 \
  -e MCP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,0.0.0.0,172.30.146.31 \
  memobaba44/kapportal-mcp:latest
```

## Kontrol

```powershell
curl http://172.30.146.31:8060/health
curl http://172.30.146.31:8064/health
```

Beklenen MCP health cevabi:

```json
{"ok":true,"mcpPath":"/mcp","portal":"http://127.0.0.1:8063"}
```

Portal kontrolu:

```text
http://172.30.146.31:8063
```

## Onyx Baglantisi

Onyx MCP server URL:

```text
http://172.30.146.31:8060/mcp
```

Transport tipi sorarsa: `Streamable HTTP`.

`/mcp` tarayicida normal web sayfasi gibi acilmaz. Kontrol icin `/health` endpoint'ini kullan.

## Tool'lar

| Tool | Amac |
|------|------|
| `kap_status` | Portal isleme sayilari, graph node/edge sayilari ve sektor sayisini dondurur. |
| `kap_search_companies` | Sirketleri ad, slug, OID, ticker, status veya sayfalama ile arar. |
| `kap_get_member_companies` | Portale kaydedilen uye sirket listesini dondurur. |
| `kap_get_company_profile` | Tek sirketi ve onemli KAP alanlarini getirir. |
| `kap_get_rating_sources` | Rating ve haber kaynaklarinin durumunu, kayit sayilarini ve hatalarini getirir. |
| `kap_get_company_ratings` | Sirketin tum kredi rating alanlarini getirir; UVD, KVD, gorunum, aksiyon, tarih ve rapor linklerini dondurur. |
| `kap_get_company_news` | Sirket haberlerini kaynak, tarih, risk seviyesi, olay tipi ve linkleriyle getirir. |
| `kap_search_rating_news` | Rating/haber kaynaklarinda konu, sirket veya risk odakli haber arar. |
| `kap_get_company_financial_overview` | KAP profili, ratingler, haberler ve ortaklik graph ozetini tek cevapta birlestirir. |
| `kap_find_nodes` | Graph icindeki company/shareholder/person node'larini arar. |
| `kap_get_company_relationships` | Bir sirket icin sinirli ortaklik subgraph'i getirir. |
| `kap_find_relationship_path` | Iki sirket/node arasindaki en kisa iliski yolunu bulur. |
| `kap_top_relationship_clusters` | En buyuk bagli graph bilesenlerini listeler. |
| `kap_rebuild_relationship_graph` | Graph cache'ini yeniden olusturur. |
| `kap_start_kap_processing` | Tum sirketleri veya sadece uye sirketleri KAP'tan islemeye baslatir. |
| `kap_refresh_company_from_kap` | Tek sirketi KAP'tan tekrar ceker; `confirm=true` ister. |

## Ornek Sorular

- `BIM'in dogrudan ortaklari kimler?`
- `Aygaz KVD/UVD rating bilgilerini getir.`
- `VAKIF, ZIRAAT ve HALK icin portale kayitli veriler var mi?`
- `Kayitli uye sirketlerin KAP ortaklik ozetini getir.`
- `Sabanci Holding ile Akbank arasindaki iliskiyi acikla.`
