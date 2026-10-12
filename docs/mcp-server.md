# SPP MCP

MCP endpoint portal, rating, haber ve ortaklık grafi verilerini Onyx'e sunar.

## Bağlantı

```text
URL: http://SUNUCU_IP:8060/mcp
Transport: Streamable HTTP
```

Sağlık kontrolü:

```text
http://SUNUCU_IP:8060/health
```

`MCP_API_KEY` tanımlandıysa Onyx bağlantısına aşağıdaki başlıklardan birini
ekleyin:

```text
Authorization: Bearer MCP_API_KEY_DEGERI
```

veya:

```text
X-API-Key: MCP_API_KEY_DEGERI
```

## Tool Listesi

| Tool | Amaç |
| --- | --- |
| `spp_status` | Portal, işlem ve graph durumunu getirir. |
| `spp_search_companies` | Şirketleri ad, kod, OID, slug ve durumla arar. |
| `spp_get_member_companies` | Kaydedilmiş üye şirketleri getirir. |
| `spp_get_company_profile` | Şirket profilini ve önemli KAP alanlarını getirir. |
| `spp_get_rating_sources` | Rating/haber kaynaklarının son durumunu getirir. |
| `spp_get_company_ratings` | UVD, KVD, görünüm ve rating raporlarını getirir. |
| `spp_get_company_news` | Şirkete ait finansal haberleri getirir. |
| `spp_search_rating_news` | Rating ve haber kayıtlarında arama yapar. |
| `spp_get_company_financial_overview` | Profil, rating, haber ve ortaklık özetini birleştirir. |
| `spp_find_nodes` | Graph içindeki şirket, ortak ve kişileri arar. |
| `spp_get_company_relationships` | Şirketin sınırlı ortaklık alt grafını getirir. |
| `spp_find_relationship_path` | İki node arasındaki en kısa ilişki yolunu bulur. |
| `spp_top_relationship_clusters` | En büyük bağlantılı graph kümelerini getirir. |
| `spp_rebuild_relationship_graph` | Ortaklık grafiğini yeniden oluşturur. |
| `spp_start_kap_processing` | `scope`: `pending` (hiç çekilmemişler), `error` (hatalılar), `all` veya `members`. |
| `spp_refresh_company_from_kap` | Tek şirketin KAP verisini yeniler. |

## Önerilen Onyx Sistem Promptu

```text
Sen SPP MCP asistanısın. KAP şirket profilleri, üye şirketler,
ortaklık grafiği, kredi rating kayıtları ve finansal haberler için önce MCP
tool'larını kullan.

Şirket adı belirsizse önce spp_search_companies ile eşleştir. Güçlü birden fazla
eşleşme varsa kısa bir seçim sorusu sor.

KVD kısa vadeli rating notudur ve short_term_rating alanına karşılık gelir.
UVD uzun vadeli rating notudur ve long_term_rating alanına karşılık gelir.
Kullanıcı KVD, UVD, rating veya derecelendirme sorarsa
spp_get_company_ratings tool'unu mutlaka çağır.

Kullanıcı "üyeler" veya "bizim üyeler" derse önce spp_get_member_companies
tool'unu çağır ve sonraki sorguyu yalnızca bu şirketlerle sınırla.

Ortaklık sorularında doğrudan ortak, dolaylı ortak, bağlı ortaklık, sermaye
oranı ve oy hakkını birbirinden ayır. İlişki zinciri sorularında graph
tool'larını kullan.

Kaynak BLOCKED, PARSE_ERROR, LOGIN_REQUIRED veya SUBSCRIPTION_REQUIRED
dönerse durumu açık Türkçeyle belirt ve source_url, report_url veya pdf_url
varsa kullanıcıya ver.

Tahminle rating, ortaklık oranı, sermaye veya KAP bilgisi üretme. Veri yoksa
"Portal verisinde bulunamadı" de.

Yenileme ve toplu işlem side effect oluşturur. Kullanıcı açıkça istemedikçe
spp_refresh_company_from_kap, spp_start_kap_processing veya
spp_rebuild_relationship_graph çağırma. Yalnızca üyeler yenilenecekse
scope="members" kullan.

Cevapları Türkçe, kısa ve kaynaklı ver. Ham JSON, container ve backend
detaylarını kullanıcı istemedikçe gösterme.
```

## Sorun Giderme

`8060/health` çalışıyor ama Onyx bağlanamıyorsa:

1. `MCP_ALLOWED_HOSTS` içinde Onyx'in kullandığı sunucu host/IP değerini kontrol edin.
2. Güvenlik duvarında `8060/tcp` erişimini kontrol edin.
3. `MCP_API_KEY` kullanılıyorsa Onyx başlığının aynı değeri taşıdığını doğrulayın.
4. Container logunu inceleyin:

```bash
docker compose logs --tail=200 spp-mcp
```
