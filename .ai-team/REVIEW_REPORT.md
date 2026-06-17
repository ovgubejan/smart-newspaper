# REVIEW REPORT

## Genel Durum

İlk mimari/stabilite reviewu yapıldı. Uygulama build, test, HTTP ve browser smoke kontrollerinden geçti.
Agent-Backend review: Haber alanı transport normalizasyonu ve cache büyüme limitleri eklendikten sonra build/test/server/HTTP/browser kontrolleri tekrar geçti.
Agent-Backend review: `/api/feed` başarı ve fallback response shape'i frontend empty state akışını bozmayacak şekilde doğrulandı.
Agent-Backend review: Port çakışması ve log okunabilirliği regression reviewu tamamlandı; ikinci server denemesi dolu portu, owner PID'yi ve çözüm aksiyonunu logluyor.

## Performans Sorunları

Detaylı profil henüz yapılmadı. Büyük haber listelerinde render maliyeti ve RSS fetch/cache davranışı sonraki turda incelenmeli.
Agent-Backend review: RSS/API exact duplicate filtreleme erken aşamaya alındı; semantic dedupe öncesi aday sayısını azaltır.
Agent-Backend review: `SOURCE_FETCH_CACHE` daha önce limitsiz büyüyebiliyordu; 80 entry FIFO limit eklendi. `STATIC_FILE_CACHE` için 160 entry ve 1.5 MB/item limit eklendi.
Agent-Backend review: `/api/health` cache age değerleri negatif olmayacak şekilde clamp edildi; user source/static cache için count/max/oldestAge/TTL görünürlüğü eklendi.

## UI/UX Sorunları

Agent-Frontend review (tur 2): 3 bug tespit ve düzeltildi:
1. `renderArticlesPage` içinde `isFirst` değişkeni kullanılmadan önce tanımlanıyordu (temporal dead zone). Bu "Cannot access before initialization" console error'a neden oluyordu.
2. Empty state DOM selector yanlıştı (`.egazete-reader` yerine `#egazete-book` olmalıydı).
3. Empty state "Geri Dön" butonu yanlış selector kullanıyordu.
CSS iyileştirmeleri: sayfa içerik scroll, makale body genişletme, kapak hero/article img max-height artırma.

## Backend Sorunları

Operasyonel gözlem eksikti; `/api/health` endpoint'i eklendi. RSS/API retry/fallback davranışı ayrıca incelenmeli.
Agent-Backend review: `fetchJson` ve `fetchText` doğrudan `fetch` kullanıyordu; merkezi timeout/retry helper ile güçlendirildi. Call site imzaları korundu.
Agent-Backend review: RSS/API/DB birleşiminde exact dedupe sadece raw `sourceUrl` eşitliğine dayanıyordu; canonical URL ve title-source key ile güçlendirildi.
Agent-Backend review: `/api/feed`, `/api/search` ve `/api/articles/:id` response'larında title/description/image/date/source/url/category alanları güvenli normalize ediliyor. Bozuk image/source URL değerleri boş string fallback'e çekiliyor.
Agent-Backend review: `readDb()` veya feed hazırlama hatalarında `/api/feed` artık genel `{ error }` response'u yerine `success:false`, `data:{articles:[]}`, `articles:[]`, `count:0` döndürüyor.
Agent-Backend review: Startup/server/feed/AI hata logları merkezi logger formatına çekildi. `LOG_LEVEL` ile `silent/error/warn/info/debug` seviyeleri destekleniyor; varsayılan runtime log seviyesi `info`, test ortamı `warn`.
Agent-Backend review: `EADDRINUSE` durumunda ikinci server başlatma karmaşası azaltıldı; loglar `port`, mümkünse `ownerPid` ve `stop-existing-node-or-set-PORT` aksiyonunu gösteriyor.

## Build/Test Sorunları

`npm run build` ve `npm test` başarılı.
Son tur: `npm run build` başarılı; `npm test` 69/69 geçti; `/api/health`, `/api/feed`, `/api/articles/:id` ve Playwright smoke başarılı.
Son tur: `npm run build` başarılı; `npm test` 69/69 geçti; `/api/feed`, `/api/health`, `/` ve Playwright smoke başarılı.
Son regression turu: `npm run build` başarılı; `npm test` 69/69 geçti; `/api/feed`, `/api/health`, `/`, port conflict smoke ve Playwright smoke başarılı.

## Güvenlik Uyarıları

`.env` okunmadı/loglanmadı. `db/data.json` yerel kullanıcı/test verisi içerebildiği için commit/push öncesi dikkatle ele alınmalı.

## Story Clustering (Agent-Fullstack)

Agent-Fullstack review: Story Clustering sistemi eklendi. Backend `dedupeFeedArticles` artık haberleri silmek yerine aynı haberleri cluster'layarak tek kartta gösteriyor. Her cluster: `clusterId`, `sourceCount`, `sources[]`, `clusterArticles[]`, `comparison{}` alanlarını taşıyor. Frontend kaynak chip/favicon/badge strip, "Kaynakları Karşılaştır" modalı ve E-Gazete cluster desteği eklendi. CSS light/dark/mobile responsive stilleri yazıldı. API backward compatibility korundu (`articles[]` shape değişmedi, yeni alanlar opsiyonel). `/api/health` cluster istatistikleri ekli. Build/test/server/browser smoke kontrollerinden geçti.

## Haber Paylaşım & Bildirim Sistemi (Agent-Fullstack)

Agent-Fullstack review: Haber Paylaşım Sistemi eklendi. Backend'de 7 yeni/genişletilmiş endpoint: article share (snapshot ile), user search, notifications (CRUD), shares inbox/sent. Rate limit 10/dk, memory limit 500 share + 1000 notif. Frontend'de share modal (WhatsApp wa.me, Instagram clipboard, link copy, Web Share API, kullanıcıya gönder), notification center (bell, badge, dropdown panel), haber kartlarında "Paylaş" butonu. E-Gazete'de paylaş/WhatsApp/link copy butonları. CSS light/dark/mobile responsive. Sosyal medya hesabı bağlanmadı, token/cookie/session istenmedi, tüm paylaşımlar kullanıcı başlatmalı. Build/test/server/browser smoke kontrollerinden geçti.
Agent-Fullstack regression: Paylaşım sistemi bug fix edildi. Kartlarda görünür hızlı paylaş ikonu eklendi. Modal gönderimi `articleId`, `clusterId`, `receiverUserId`, `message`, `articleSnapshot` payload'u gönderiyor. Drag/drop legacy `/api/share` yerine `/api/articles/:id/share` kullanıyor ve `dataTransfer` JSON payload taşıyor. Backend cache/feed/demo haberleri buluyor, snapshot fallback kabul ediyor, success response içinde `notification` döndürüyor. Notification tipi `article_share`. E-Gazete paylaş butonu module boundary ve ID fallback problemi giderildi.

## Feed Cache/Scheduler (Agent-Fullstack)

Agent-Fullstack review: Feed Cache/Scheduler sistemi eklendi. `/api/feed` stale-while-revalidate mantığıyla çalışıyor: cache doluysa anında dön, eskiyse arka planda refresh tetikle. 13 saatte bir `backgroundRefreshFeed()` RSS/API fetch + dedupe + cluster yapıyor. 2 günden eski haberler otomatik temizleniyor. `/api/health` feedScheduler bölümü eklendi. Concurrent refresh koruması, graceful shutdown, ENV config. Build/test/server/health kontrollerinden geçti. 129 haber cache'de, refresh success.

Agent-Backend/Test review (2026-06-13): İlk açılış regression'ı düzeltildi. Önceki davranış cache boşken `/api/feed` içinde canlı RSS/API refresh bekleyebiliyor veya devam eden refresh'i bekletiyordu. Yeni davranış local database/demo cache'i hemen seed ediyor, response'u hızlı dönüyor ve canlı refresh'i arka plana bırakıyor. Manual refresh `POST /api/feed/refresh` ile ayrıldı. Scheduler default 23 saat olarak düzeltildi. Feed payload'ı liste ekranı için kompaktlandı ve anonim kullanıcı hızlı yolu eklendi. Test: build başarılı, 69/69 test, restart sonrası `/api/feed` 161 ms / 9 haber, full cache sonrası `/api/feed` 65 ms / 60 haber, browser smoke 0 console error / 0 failed request.

## HTML Entity Decode & Dil Seçimi (Agent-Fullstack)

Agent-Fullstack review: HTML entity decode ve TR/EN dil seçimi sistemi tamamlandı. Backend `decodeHtml` hex entity ve 40+ named entity desteği. Frontend `decodeHtmlEntities` tüm metin alanlarına uygulandı. TR/EN dil toggle, `localStorage` persist, sayfa yenilemeden re-render. E-Gazete tüm metinler dil-aware. Gemini background çeviri sistemi (API key yoksa graceful fallback). XSS güvenliği korundu. Build/test/server/API smoke OK. 0 entity kalan.

## Düzeltilenler

- Yanlış `.ai-team` dosyası yerine klasör tabanlı koordinasyon yapısı korundu.
- Lock dosyaları için ignore kuralı ve `.ai-team/locks/.gitkeep` yapısı sağlandı.
- Backend sağlık kontrol endpoint'i eklendi.
- Backend outbound fetch istekleri için varsayılan 12000ms timeout ve 1 retry eklendi.
- RSS/API/provider cache TTL bilgisi health endpoint'inde görünür hale getirildi.
- RSS/API/DB exact duplicate temizliği canonical URL ve title-source key ile güçlendirildi.
- Haber transport alanları için merkezi fallback normalizer eklendi.
- User source ve static file cache büyümesi limitlendi; limitler `/api/health` içinde görünür hale getirildi.
- `/api/feed` fallback response sözleşmesi frontend empty state ile uyumlu boş array shape'ine sabitlendi.
- `/api/health` cache age/TTL görünürlüğü user source ve static cache için genişletildi.
- Port conflict logları owner PID ve çözüm aksiyonu içerecek şekilde iyileştirildi.
- Backend logları merkezi logger helper'ları üzerinden okunabilir scope/message/meta formatına çekildi.
- Paylaşım sistemi modal, drag/drop, share API, notification ve E-Gazete akışında düzeltildi.
