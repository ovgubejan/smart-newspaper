# HANDOFF

## Diğer Ajana Devredilecekler

- Agent-Backend: ~~RSS/API fetch timeout, retry, fallback ve cache TTL davranışını ayrıntılı incele.~~ ✅ TAMAMLANDI.
- Agent-Frontend: ~~Büyük haber listelerinde render performansı, skeleton, empty state ve error state akışını incele.~~ ✅ TAMAMLANDI — Skeleton, empty state ve error state CSS/JS eklendi.
- Agent-Frontend: ~~Backend fetch timeout/retry değişikliği sonrası frontend hata state metinlerini kontrol et.~~ ✅ Empty state E-Gazete reader ve dashboard'da aktif.
- Agent-Backend: ~~E-Gazete açılışında `/api/feed` boş dönerse frontend gracefully skeleton/empty gösteriyor; backend tarafta veri yokken tutarlı boş array dönmesi sağlanmalı.~~ ✅ `/api/feed` mevcut shape'i ve boş array fallback davranışı korundu.
- Agent-Frontend: ~~Backend artık `description`, `image`, `date`, `source`, `sourceName`, `url`, `sourceUrl` alias alanlarını güvenli dolduruyor; E-Gazete ve dashboard placeholder/date görünümü son UI turunda ayrıca gözlemlenebilir.~~ ✅ Placeholder, date, image render Playwright testleri ile doğrulandı.
- Agent-Backend: ~~Frontend'in `/api/feed` boş array tutarlılığı beklentisi kontrol edilecek.~~ ✅ Başarı ve fallback shape'i `articles: []`, `data.articles: []`, `count` ile korunuyor.
- Agent-Frontend: ~~Browser console hatalarını temizle.~~ ✅ 2 adet "Cannot access before initialization" hatası (`isFirst` TDZ bug) düzeltildi. Empty state selector ve geri dön butonu da düzeltildi.
- Agent-Backend: ~~Port çakışması kontrolü ve backend log okunabilirliği iyileştirilecek.~~ ✅ Port conflict owner PID/aksiyon önerisiyle loglanıyor; backend hata/startup/feed logları merkezi logger formatına çekildi.
- Agent-Fullstack: ~~Haber paylaşım sistemi çalışmıyor; görünür paylaş ikonu, modal gönderimi, drag/drop, share API ve notification akışı düzeltilecek.~~ ✅ Kartlarda görünür hızlı paylaş ikonu var; modal ve drag/drop yeni share endpoint'ini kullanıyor; notification `article_share` olarak oluşuyor; E-Gazete paylaş butonu modal açıyor.

## Kontrol Edilecek Şüpheli Alanlar

- `db/data.json` yerel runtime/test verisi içeriyor ve çalışma alanında değişmiş durumda; commit/push öncesi ayrıca değerlendirilmeli.
- `.claude/settings.local.json` yerel araç izin geçmişi gibi duruyor; repo değişikliği olarak ele alınmamalı.

## Riskli Değişiklikler

Henüz yok.

## Story Clustering Sistemi (Tamamlandı: 2026-06-11 18:05)

- Backend: `dedupeFeedArticles` artık haberleri cluster'layarak grupluyor. Her cluster'dan en kaliteli haber seçiliyor (görsel + uzun açıklama). Cluster üyeleri `sources`, `clusterArticles`, `comparison` alanlarına yerleştiriliyor. `/api/health` cluster istatistikleri döndürüyor.
- Frontend: Haber kartlarında `renderSourceClusterStrip` ile kaynak favicon chip'leri, sayaç badge, "+N" overflow gösteriliyor. "Kaynakları Karşılaştır" butonu ve `openSourceComparisonModal` ile tam karşılaştırma paneli açılıyor.
- E-Gazete: Cover ve article sayfalarında cluster kaynak bilgisi (sourceCount, sources) gösteriliyor. Favicon ikonları ve kaynak linkleri aktif.
- CSS: Light/dark mode, mobil responsive stiller `css/style.css`'e eklendi.
- Not: Demo veri tek kaynaklı olduğu için cluster sayısı 0 görünüyor. Gerçek RSS verisi geldiğinde aynı haberler otomatik gruplanacak.

## Haber Paylaşım Sistemi (Tamamlandı: 2026-06-11 18:20)

- Backend: 7 yeni API endpoint — `/api/articles/:id/share` (snapshot+notif+rate limit), `/api/users/search`, `/api/notifications`, `/api/notifications/:id/read`, `/api/notifications/read-all`, `/api/shares/inbox`, `/api/shares/sent`. Memory limit: 500 share, 1000 notif. Rate limit: 10/dk.
- Frontend: Share modal (WhatsApp wa.me link, Instagram clipboard, link kopyala, Web Share API, kullanıcıya gönder + mesaj). Notification center (bell+badge+dropdown+empty state). Haber kartlarında "Paylaş" butonu.
- E-Gazete: Makale bloklarında Paylaş, WhatsApp, Link Kopyala butonları.
- Güvenlik: Sosyal medya hesabı bağlanmadı, otomatik mesaj yok, tüm paylaşımlar kullanıcı başlatmalı.

## Feed Cache/Scheduler Sistemi (Tamamlandı: 2026-06-11 18:30)

- `/api/feed` artık her istekte RSS/API fetch yapmıyor. Cache'den stale-while-revalidate mantığıyla hızlı dönüyor.
- 13 saatte bir arka planda `backgroundRefreshFeed()` çalışıyor (ENV: `NEWS_REFRESH_INTERVAL_HOURS`).
- 2 günden eski haberler otomatik temizleniyor (ENV: `NEWS_RETENTION_DAYS`).
- `/api/health` feedScheduler bölümü: interval, retention, cached count, refresh status/error, next refresh.
- Server restart'ta ilk refresh otomatik başlıyor. Concurrent refresh koruması var.
- SIGINT/SIGTERM graceful shutdown: interval'lar temizleniyor.

## HTML Entity Decode & Dil Seçimi (Tamamlandı: 2026-06-11 22:55)

- Backend: `decodeHtml` hex entity ve 40+ named entity desteği. Duplicate fonksiyon kaldırıldı.
- Backend: `normalizeArticleTransportFields` → `categoryEn`, `subcategoryEn`, `translations{}`, `originalLanguage`.
- Backend: Gemini çeviri sistemi — `translateArticleBatch()` background refresh'te. API key yoksa graceful fallback.
- Frontend: `decodeHtmlEntities()` tüm metin alanlarına uygulandı. Dil toggle ve `localStorage.smartNewspaper.locale`.
- E-Gazete: Tüm metinler dil-aware (`egazeteTitle`, `egazeteSummary`, `egazeteCat` helper'ları).

## Sonraki Önerilen Görev

- P4 kapsamında paylaşım sistemi ve feed refresh akışı için küçük otomatik smoke test eklenebilir; ardından kullanılmayan kodlar, gereksiz tekrarlar ve build çıktısı boyutu düşük riskli review ile incelenebilir.

## Agent-Backend/Test Notu - 2026-06-13 22:03

- `/api/feed` artık ilk açılışta canlı RSS/API fetch beklemiyor; local cache/database seed ile hızlı response dönüyor.
- `POST /api/feed/refresh` manual refresh endpoint'i eklendi. Frontend "Taze Haberleri Getir" butonu bu endpoint'i çağırıyor.
- Scheduler default 23 saat, retention 2 gün. Health üst seviye alanları güncellendi.
- Feed response liste ekranı için 60 haberle sınırlandı (`NEWS_FEED_RESPONSE_LIMIT`, 20-120 aralığında env ile ayarlanabilir). Cache içinde 129 haber tutulmaya devam ediyor.
- Frontend ajana: Public preview feed auth overlay arkasında da yüklendiği için login/onboarding görsel akışı mobilde tekrar gözlemlenebilir.
