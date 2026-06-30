# KAP Graph DB Tasarimi

## Node (Dugum) Tipleri

### 1. Company
KAP'ta kayitli sirket. companies tablosundaki her kayit bir Company node'u.

```
{
  id: number,           // DB id
  name: string,         // "BIM BIRLESIK MAGAZALAR A.S."
  normalized_name: str, // "BIM BIRLESIK MAGAZALAR" (eslestirme icin)
  oid: string,          // KAP member OID
  code: string | null,  // BIMAS, AKBNK (varsa)
  sermaye: string,      // Odenmis sermaye
  kayitli_sermaye: str,  // Kayitli sermaye tavani
  status: string        // done, error, pending...
}
```

### 2. Shareholder (Tuzel Kisi)
KAP'ta sirket olarak kayitli OLMAYAN ama ortaklik tablosunda gecen tuzel kisiler.
Ornek: "AKFEN INTERNATIONAL HOLDING B.V.", "MERKEZ BEREKET GIDA SANAYI VE TICARET ANONIM SIRKETI"

```
{
  name: string,
  normalized_name: string,
  type: "tuzel"
}
```

### 3. Person (Gercek Kisi)
Dolayli pay sahipleri tablosunda gecen gercek kisiler.
Ornek: "SELIM AKIN", "HAMDI AKIN"

```
{
  name: string,
  type: "gercek"
}
```

## Edge (Kenar) Tipleri

### OWNS_DIRECTLY
Kaynak: kpy41_acc5_sermayede_dogrudan
%5 veya daha fazla paya sahip dogrudan ortaklar.

```
(Ortak) --OWNS_DIRECTLY--> (Sirket)
{
  pay_tl: string,         // "92.450.000"
  oran_pct: string,       // "15,41"
  oy_hakki_pct: string,   // "15,41"
}
```

### OWNS_INDIRECTLY
Kaynak: kpy41_acc5_son_durum_sermayeye
Dolayli yoldan pay sahibi olan gercek ve tuzel kisiler.

```
(Ortak) --OWNS_INDIRECTLY--> (Sirket)
{
  pay_tl: string,
  oran_pct: string,
}
```

### HAS_SUBSIDIARY (Bagli Ortaklik)
Kaynak: kpy41_acc7_bagli_ortakliklar
Sirketin sahip oldugu diger sirketler (ters yon).

```
(Ana Sirket) --HAS_SUBSIDIARY--> (Bagli Sirket)
{
  pay_tl: string,
  oran_pct: string,
  faaliyet_konusu: string,
}
```

## Eslestirme Stratejisi

Ortaklik tablosundaki isimler ile companies tablosundaki isimler farkli yaziliyor.
Ornek:
- Ortaklik: "HACI OMER SABANCI HOLDING ANONIM SIRKETI"
- Companies: "HACI OMER SABANCI HOLDING A.S."

### Normalize Fonksiyonu
1. Buyuk harfe cevir (toUpperCase + Turkce karakterler)
2. Su ekleri kaldir: "A.Ş.", "A.S.", "ANONİM ŞİRKETİ", "TİCARET", "SANAYİ", "VE", "LTD.", "ŞTİ."
3. Birden fazla boslugu tek bosluga dusur
4. Bas ve sondaki bosluklari kaldir

### Eslestirme Sirasi
1. Normalize edilmis isimle companies tablosunda tam eslesme ara
2. Eslesmezse → Levenshtein distance ile en yakin 3 aday bul, benzerlik > %85 ise esle
3. Hala eslesmezse → Yeni Shareholder veya Person node olustur

### Gercek / Tuzel Ayrimi
- Isimde "A.Ş.", "A.S.", "HOLDİNG", "ŞİRKET", "LTD", "B.V.", "INC", "CORP", "GMBH" geciyorsa → tuzel
- Aksi halde → gercek kisi (2-3 kelimelik isimler genelde gercek kisi)

## Atlanacak Satirlar
- "DİĞER" → Node yapilmaz. Kim oldugu bilinmiyor (halka acik + %5 alti ortaklar).
- "TOPLAM" → Node yapilmaz. Kontrol satiri.
- "Bilgi Mevcut Değil" → Atla.

## Veri Kaynaklari (shareholders tablosundaki item_key'ler)

| item_key | Aciklama | Edge Tipi |
|----------|----------|-----------|
| kpy41_acc5_sermayede_dogrudan | %5+ dogrudan pay sahipleri | OWNS_DIRECTLY |
| kpy41_acc5_son_durum_sermayeye | Dolayli pay sahipleri | OWNS_INDIRECTLY |
| kpy41_acc5_ortaklik_yapisi | Ortaklik yapisi (bazi sirketlerde) | OWNS_DIRECTLY |
| kpy41_acc7_bagli_ortakliklar | Bagli ortakliklar | HAS_SUBSIDIARY |

## Ornek Graph

```
Sabanci Holding ──OWNS_DIRECTLY(%40.75)──→ Akbank
Sabanci Holding ──OWNS_DIRECTLY(%51)────→ Cimsa
Cimsa ──────────OWNS_DIRECTLY(%51)────→ Afyon Cimento
Sabanci Holding ──OWNS_INDIRECTLY(%25.2)─→ Afyon Cimento
Sakip Sabanci Holding ──OWNS_INDIRECTLY(%5.66)──→ Akbank

Akfen Holding ──OWNS_DIRECTLY(%56.45)──→ Akfen Yenilenebilir
Akfen International B.V. ──OWNS_DIRECTLY(%15.12)──→ Akfen Yenilenebilir
Selim Akin [Person] ──OWNS_INDIRECTLY(%26.48)──→ Akfen Yenilenebilir

Akfen Gayrimenkul Portfoy ──ortaklik_yapisi(%100)──→ Akfen Holding
```

## Portal Entegrasyonu

Graph gorunumu portal'in 3. tab'i olacak.
- Frontend: D3.js veya vis.js ile interaktif graph
- Backend: /api/graph/nodes ve /api/graph/edges endpoint'leri
- Filtreleme: Sirket adina gore, holding bazli, sektor bazli
- Tiklanabilir node'lar → Sirket Detay sayfasina yonlendirme

## Bilinen Limitasyonlar

1. "DIGER" kismi graph'ta temsil edilemez — kime ait oldugu bilinmiyor
2. Bazi sirketlerde ortaklik verisi yok (no_data, 62 sirket)
3. Isim eslestirme %100 dogru olmayabilir — fuzzy match hatalari olabilir
4. Yabanci sirketler (B.V., INC gibi) KAP'ta kayitli degil, sadece Shareholder node olarak temsil edilir
5. Veriler KAP'in son guncelleme tarihine bagli, gunluk degisebilir

## Sonraki Adimlar

1. SQLite'tan graph verisini cikaran script yaz (normalize + eslestir + node/edge olustur)
2. Frontend'de D3.js/vis.js ile gorsel graph
3. Test kullanicilarina goster, geri bildirim al
4. Eslestirme hatalarini manuel duzeltme arayuzu (gerekirse)
