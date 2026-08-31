# Güvenlik

Bu portal şirket içi kullanım için tasarlanmıştır. İnternete doğrudan açmak yerine
kurumsal VPN, güvenlik duvarı veya TLS sonlandıran bir reverse proxy arkasında
çalıştırın.

## Üretim kuralları

- `.env` dosyasını repoya eklemeyin.
- `ADMIN_PASS` ve `JWT_SECRET` için benzersiz, rastgele değerler kullanın.
- Onyx farklı bir sunucudaysa `MCP_ALLOWED_HOSTS` içine yalnızca gerekli host/IP
  değerlerini ekleyin.
- MCP ağı güvenilir değilse `MCP_API_KEY` tanımlayın ve aynı anahtarı Onyx
  bağlantısına Bearer token veya `X-API-Key` olarak ekleyin.
- Rating servisinin `8064` portu ağdan erişilebiliyorsa `RATING_MCP_API_KEY`
  tanımlayın. Portal bu anahtarı rating proxy isteklerinde otomatik kullanır.
- `8060`, `8063` ve `8064` portlarını yalnızca gerekli ağlardan erişilebilir yapın.
- Docker volume yedeklerini düzenli alın.

Bir güvenlik açığı tespit edildiğinde herkese açık issue açmadan önce depo sahibiyle
özel kanaldan iletişime geçin.

## Bağımlılık denetimi notu

`react-router-dom` 7.18.1 için npm denetiminde görünen
`GHSA-qwww-vcr4-c8h2` kaydı yalnızca deneysel RSC API'lerini etkiler. Portal,
`BrowserRouter` kullanan istemci tarafı bir SPA'dır; RSC API'si veya server action
kullanmaz. Daha eski sürümlerde istemci yönlendirmesini de etkileyen ek açıklar
bulunduğu için paket 7.18.1'de tutulmuştur. React Router 8'e geçiş, uygulamanın
Node.js çalışma zamanı gereksinimi ve `react-router-dom` uyumluluğu birlikte
doğrulandıktan sonra yapılmalıdır.
