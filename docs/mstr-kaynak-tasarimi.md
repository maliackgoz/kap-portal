# KAP Verisi için MicroStrategy Kaynağı — Tasarım

Durum: **taslak** (2026-09-25). Rapor yapısı kurum DB/MSTR ekibiyle netleştikten sonra kodlanacak.

## Amaç

KAP şirket genel bilgileri bugün `kap.org.tr` sayfaları tek tek kazınarak alınıyor (`backend/src/services/scraper.ts`). Aynı veri kurum DB'sinde tablolara basılıyor, ama DB'ye doğrudan erişim yok. Bu tablolardan bir **MicroStrategy raporu** hazırlanacak, portal da raporu **MSTR REST API** ile çekecek. Kazıyıcı yedek kaynak olarak kalacak.

## Kazıyıcıdan temel farkı: toplu çekim

| | Kazıyıcı | MSTR |
|---|---|---|
| Birim | Şirket başına 1 HTTP isteği | Tek rapor, tüm şirketler |
| 1.553 şirket | ~1,5–3 saat (KAP rate-limit, 1,5–3 sn bekleme) | Birkaç sayfa isteği, dakikalar |
| Hata türü | Şirket bazında (timeout, engel) | Çoğunlukla hep-ya-hiç (login, rapor hatası) |

Bu yüzden MSTR kaynağı `processor.ts`'deki şirket şirket döngüye takılmaz. Ayrı bir **"toplu senkron"** işi olur: raporu baştan sona sayfalayarak okur, şirketlere göre gruplar ve her şirketi mevcut yazma yoluyla (`company-data.ts` → `shareholders` tablosu + graph cache invalidation) kaydeder. `shareholders` tablosu, graph-builder, MCP tool'ları ve frontend **değişmez**, çünkü MSTR'dan gelen veri aynı `{item_key: value}` şekline çevrilir.

## Rapor sözleşmesi (MSTR ekibinden istenecek)

Portal `shareholders` tablosunda her şirket için `item_key → value` tutuyor. Bazı alanlar düz metin (sektör, adres), bazıları satır listesi (ortaklar, bağlı ortaklıklar, yönetim kurulu). Hepsini tek raporda taşıyabilmek için **uzun (long) format** öneriyoruz:

| Kolon | Tip | Açıklama |
|---|---|---|
| `KAP_KODU` | metin | Şirketin KAP kodu (Akbank = `2413`; KAP sayfa adresindeki sayı). Eşleştirme anahtarı, bkz. *Açık sorular 1* |
| `ALAN_KODU` | metin | KAP alan kodu, örn. `kpy41_acc5_sermayede_dogrudan` |
| `SATIR_NO` | sayı | Liste alanlarında satır sırası (1, 2, 3…). Düz alanlarda boş veya 0 |
| `ALT_ALAN` | metin | Liste satırındaki alan adı, örn. `shareholder`, `ratioInCapital`. Düz alanlarda boş |
| `DEGER` | metin | Değer. Sayılar da metin olarak, KAP'taki biçimiyle (`18,37`) |
| `GUNCELLEME_TARIHI` | tarih | (opsiyonel) Verinin DB'ye yazıldığı an. "Son işlenme" alanında gösterilir |

Hepsi **attribute** olmalı, metric değil. Metric olursa MSTR satırları toplar veya sayıları biçimlendirir.

Örnek satırlar:

```
KAP_KODU | ALAN_KODU                        | SATIR_NO | ALT_ALAN         | DEGER
2413     | kpy41_acc2_sektor                |          |                  | BANKALAR
2413     | kpy41_acc5_sermayede_dogrudan    | 1        | shareholder      | HACI ÖMER SABANCI HOLDİNG A.Ş.
2413     | kpy41_acc5_sermayede_dogrudan    | 1        | ratioInCapital   | 40,75
2413     | kpy41_acc5_sermayede_dogrudan    | 1        | votingRightRatio | 40,75
2413     | kpy41_acc5_sermayede_dogrudan    | 2        | shareholder      | DİĞER
2413     | kpy41_acc7_bagli_ortakliklar     | 1        | companyTitle     | AKBANK AG
2413     | kpy41_acc7_bagli_ortakliklar     | 1        | ratioOfCapitalShareOfCompany | 100
```

Portal bu satırları şuna çevirir: `kpy41_acc2_sektor = "BANKALAR"`, `kpy41_acc5_sermayede_dogrudan = [{shareholder, ratioInCapital, votingRightRatio}, {shareholder: "DİĞER"}]`. Bu şekil kazıyıcının bugün yazdığı ile aynıdır.

### Hangi alanlar gerekli

Öncelik 1 — **ortaklık ağı bunlarla kuruluyor**, eksik olursa graf boş kalır:

| ALAN_KODU | ALT_ALAN'lar |
|---|---|
| `kpy41_acc5_sermayede_dogrudan` | `shareholder`, `shareInCapital`, `ratioInCapital`, `votingRightRatio` |
| `kpy41_acc5_son_durum_sermayeye` | `shareholder`, `shareInCapital`, `ratioInCapital` |
| `kpy41_acc7_bagli_ortakliklar` | `companyTitle`, `capitalShareOfCompany`, `ratioOfCapitalShareOfCompany`, `relationWithTheCompany` |
| `kpy41_acc2_sektor` | (düz) |

Öncelik 2 — şirket detay ekranı ve MCP profili: `kpy41_acc5_odenmis_sermaye`, `kpy41_acc5_kayitli_sermaye_tavani`, `kpy41_acc5_fiili_dolasimdaki_pay`, `kpy41_acc5_ortaklik_yapisi`, `kpy41_acc6_yonetim_kurulu_uyeleri` (`nameSurname`, `title`), `kpy41_acc2_faaliyet_konu`, `kpy41_acc3_sermaye_arac_pazar`, `kpy41_acc3_endeksler`, `kpy41_acc4_vergi_no`, `kpy41_acc1_merkez_adresi`, `kpy41_acc1_int_addres`, `kpy41_acc1_yatirimci_iliskileri`.

Öncelik 3 — kazıyıcının getirdiği diğer ~35 alan. Rapora eklenirse otomatik taşınır, kod değişikliği gerekmez.

Kişisel veri notu: `kpy41_acc6_yonetim_kurulu_uyeleri` içindeki `tcknYknVkn` (TCKN) rapora **eklenmemeli**. Portal kullanmıyor.

### Uzun format mümkün değilse

DB tabloları alan bazında ayrıysa, liste alanları için ayrı raporlar da olur: şirket başına tek satırlı "genel bilgiler" raporu + "ortaklar", "bağlı ortaklıklar", "yönetim kurulu" raporları (her biri satır = bir kayıt). Bu durumda portal tarafında her rapor için küçük bir kolon eşleme tablosu yazılır. Tek rapor daha az bakım ister, bu yüzden ilk tercih uzun format.

## MSTR REST akışı

Tüm çağrılar `MSTR_BASE_URL` altında (`https://<sunucu>/MicroStrategyLibrary/api`).

1. **Login** — `POST /auth/login` gövde `{ "username", "password", "loginMode" }` (1 = standart, 16 = LDAP). Cevap `204`, token `X-MSTR-AuthToken` başlığında. Cevaptaki `Set-Cookie` (oturum çerezi) sonraki isteklerde geri gönderilir; MSTR token'ı çerezle birlikte doğrular.
2. **Rapor örneği** — `POST /v2/reports/{MSTR_REPORT_ID}/instances?offset=0&limit=5000`, başlıklar `X-MSTR-AuthToken`, `X-MSTR-ProjectID`. Cevapta `instanceId`, `definition.grid` (kolonlar) ve ilk sayfa verisi gelir. `status` hâlâ çalışıyor gösteriyorsa kısa aralıklarla tekrar sorulur.
3. **Sayfalama** — `GET /v2/reports/{id}/instances/{instanceId}?offset=5000&limit=5000` … `paging.total`'a ulaşana kadar.
4. **Logout** — `POST /auth/logout`. Hata olsa da `finally` içinde çağrılır; açık kalan oturumlar MSTR lisans/oturum limitini doldurur.

Tek şirket yenileme (Şirket Detayı'ndaki buton) için aynı rapor, `KAP_KODU`'na **view filter** ile çalıştırılır. Bu işe yaramazsa o buton kazıyıcıyla devam eder.

## Portal tarafı (kodlanacak)

- `backend/src/services/mstr-source.ts`: login/instance/sayfalama/logout, satırları `{kapKodu → {item_key → value}}` şekline çeviren saf bir fonksiyon (birim testli).
- Env: `KAP_DATA_SOURCE=scraper|mstr` (varsayılan `scraper`), `MSTR_BASE_URL`, `MSTR_USERNAME`, `MSTR_PASSWORD`, `MSTR_LOGIN_MODE`, `MSTR_PROJECT_ID`, `MSTR_REPORT_ID`.
- Veri İşleme ekranı: `mstr` seçiliyken "Toplu senkron" butonu. İlerleme mevcut SSE kanalından yayınlanır (sayfa X/Y, yazılan şirket sayısı).
- Eşleşme: rapordaki `KAP_KODU` → `companies.oid`. Portalda olmayan kodlar loglanır, otomatik şirket açılmaz (bugünkü `companies:refresh` kuralıyla aynı). Raporda hiç satırı olmayan şirketler `no_data` olur.
- Bir şirketin verisi yazılırken o şirketin eski `shareholders` kayıtları değiştirilir (bugünkü davranış). Rapor yarıda kesilirse o ana kadar yazılanlar kalır, kalan şirketler dokunulmadan eski verisini korur.

## Açık sorular (DB/MSTR ekibine)

1. **Şirket kimliği:** Tablolarda hangi kimlik var? Tercih sırası: KAP kodu (`2413`) → MKK üye oid'i (32 haneli hex; gerekirse portal da saklamaya başlar) → vergi no → borsa kodu. Şirket adıyla eşleştirme yapılmamalı; yazım farkları yüzünden güvenilmez.
2. Tablolardaki alan kodları KAP'ın `kpy41_...` kodlarıyla aynı mı? Değilse bir eşleme listesi gerekir.
3. Liste alanları (ortaklar vb.) DB'de satır satır mı, yoksa JSON metni olarak mı tutuluyor? JSON ise `ALT_ALAN` boş, `DEGER` = JSON dizisi de kabul edilebilir; portal ikisini de okuyabilir.
4. Veri ne sıklıkla güncelleniyor (günlük/anlık)? Portaldaki senkron sıklığı buna göre ayarlanır.
5. Servis hesabı: login modu (standart/LDAP), proje ID, rapor ID, sunucu adresi. Portal container'ı MSTR sunucusuna ağdan erişebiliyor mu?
6. Rapor satır sayısı tahmini (~1.500 şirket × ~50 alan × liste satırları → yüz binler olabilir). MSTR tarafında satır limiti (`Maximum rows`) var mı?
