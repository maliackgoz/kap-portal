// KAP'a giden istekler bazı ortamlarda internete ancak bir kurumsal proxy
// üzerinden çıkabiliyor. Node'un yerleşik fetch()'i (undici tabanlı)
// HTTP_PROXY/HTTPS_PROXY ortam değişkenlerini kendiliğinden OKUMUYOR — bu,
// httpx kullanan rating-service (Python) tarafındaki davranıştan farklı;
// orada trust_env varsayılan olarak açık olduğu için ek koda gerek yok.
// Bu modül, sadece KAP'a giden (dışa açık, internet üzerinden) istekler
// için proxy'yi açıkça bağlıyor — rating-service'e (127.0.0.1:8064) veya
// portal'ın kendi API'sine (127.0.0.1:8063) giden İÇ istekler etkilenmesin
// diye global bir dispatcher DEĞİŞTİRİLMİYOR, sadece bu iki dosyanın
// kullandığı fetch çağrılarına ayrıca dispatcher veriliyor.

import { ProxyAgent, type Dispatcher } from 'undici';

const proxyUrl = (
  process.env.HTTPS_PROXY
  || process.env.https_proxy
  || process.env.HTTP_PROXY
  || process.env.http_proxy
  || ''
).trim();

let dispatcher: Dispatcher | undefined;

if (proxyUrl) {
  dispatcher = new ProxyAgent(proxyUrl);
  const redacted = proxyUrl.replace(/\/\/[^@]*@/, '//<redacted>@');
  console.log(`KAP istekleri proxy üzerinden gidecek: ${redacted}`);
}

// fetch()'in ikinci parametresine ekleyin: { ...KAP_HEADERS, ...kapProxyInit() }
export function kapProxyInit(): { dispatcher?: Dispatcher } {
  return dispatcher ? { dispatcher } : {};
}
