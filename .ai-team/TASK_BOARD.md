# TASK BOARD

## P0 - Sistemi Bozmadan Stabil Hale Getir
- [x] Repo yapısını tara
- [x] package.json dosyasını incele
- [x] Çalıştırma komutlarını bul
- [x] npm install gerekiyorsa çalıştır
- [x] npm run build kontrol et
- [x] npm test varsa çalıştır
- [x] server çalışıyor mu kontrol et
- [x] localhost sayfası açılıyor mu kontrol et
- [x] browser console hatalarını kontrol et
- [x] network hatalarını kontrol et

## P1 - Backend / Veri Akışı / Cache
- [x] RSS/API kaynaklarını incele
- [x] Timeout/retry/fallback mantığını kontrol et
- [x] Aynı haber tekrarlarını engelle
- [x] Cache TTL ve cache limitlerini düzenle
- [x] Bellek sızıntısı ihtimallerini kontrol et
- [x] Port çakışması kontrolünü sağlamlaştır
- [x] Logları daha anlaşılır hale getir
- [x] Veri yoksa düzgün boş response döndür
- [x] Haber başlığı/görsel/açıklama/tarih/kaynak normalizasyonunu sağlamlaştır

## P2 - Frontend / UI / UX
- [x] Mevcut dashboard yapısını bozmadan incele
- [x] Büyük haber listelerinde render optimizasyonu yap
- [x] Lazy loading / chunked rendering uygula
- [x] Scroll, resize, input eventlerini debounce/throttle yap
- [x] Skeleton loading geliştir
- [x] Error state geliştir
- [x] Empty state geliştir
- [x] Mobil/desktop responsive kontrol et
- [x] Gereksiz CSS/JS yüklerini azalt
- [x] Browser console hatalarını temizle

## P3 - E-Gazete Okuma Modu
- [x] Mevcut veri çekme mantığını bozmadan okuma modu ekle
- [x] “E-Gazetemi Oku” butonu ekle
- [x] Tam ekran okuma deneyimi oluştur
- [x] Desktopta iki sayfalı gazete/dergi görünümü ekle
- [x] Mobilde tek sayfalı akıcı okuma oluştur
- [x] Sayfa çevirme animasyonu ekle
- [x] Gazete dokusu, gölge, kenar kıvrımı ve gerçek okuma hissi ver
- [x] Haber görseli yoksa kaliteli placeholder göster
- [x] Okuma modundan çıkış butonu ekle

## P4 - Build / Test / Kod Kalitesi
- [ ] Kullanılmayan kodları temizle
- [ ] Gereksiz tekrarları azalt
- [ ] Fonksiyonları küçük ve okunabilir hale getir
- [ ] JS/CSS build çıktısını küçült
- [x] Testleri çalıştır
- [x] Son kontrol raporu hazırla

## P5 - Story Clustering / Haber Gruplama
- [x] Backend: `dedupeFeedArticles` cluster mantığına çevrildi
- [x] Backend: `pickClusterRepresentative` — en kaliteli haber seçimi
- [x] Backend: `buildSourceEntry` — kaynak bilgisi obje yapısı
- [x] Backend: `compareClusterSources` — kaynak karşılaştırma
- [x] Backend: `/api/health` cluster istatistikleri
- [x] Frontend: `renderSourceClusterStrip` — kaynak chip/favicon/badge
- [x] Frontend: `openSourceComparisonModal` — karşılaştırma modalı
- [x] Frontend: "Kaynakları Karşılaştır" butonu
- [x] Frontend: Click delegation entegrasyonu
- [x] CSS: Source chip, badge, modal stilleri (light/dark/mobile)
- [x] E-Gazete: Cluster kaynak bilgisi desteği (cover + article pages)
- [x] Build başarılı, 69/69 test geçti
- [x] Server/API/browser smoke test başarılı

## P6 - Haber Paylaşım Sistemi & Bildirimler
- [x] Backend: `/api/articles/:id/share` — article snapshot, rate limit, notification oluşturma
- [x] Backend: `/api/users/search?q=` — kullanıcı arama
- [x] Backend: `/api/notifications` — bildirim listesi + unread count
- [x] Backend: `/api/notifications/:id/read` — tekil okundu
- [x] Backend: `/api/notifications/read-all` — toplu okundu
- [x] Backend: `/api/shares/inbox` ve `/api/shares/sent` — paylaşım kutuları
- [x] Backend: Rate limit (10 share/dakika), memory limit (500 share, 1000 notif)
- [x] Frontend: Share modal (WhatsApp, Instagram link copy, link copy, Web Share API, kullanıcıya gönder)
- [x] Frontend: Kullanıcı arama, seçim, mesaj ekleme, gönderme
- [x] Frontend: Notification bell + badge + dropdown panel
- [x] Frontend: Bildirim listesi, okundu yapma, tümünü okundu, haberi aç
- [x] Frontend: Haber kartlarına "Paylaş" butonu
- [x] Frontend: Toast entegrasyonu (gönderildi, kopyalandı, hata)
- [x] E-Gazete: Paylaş, WhatsApp, link kopyala butonları
- [x] CSS: Share modal, notification center, e-gazete share stilleri (light/dark/mobile)
- [x] Build başarılı, 69/69 test geçti
- [x] Server/API/browser smoke test başarılı

## P7 - Feed Cache / Scheduler / Stale-While-Revalidate
- [x] Backend: `_feedCacheStore` — hazır feed cache (stale-while-revalidate)
- [x] Backend: `backgroundRefreshFeed()` — arka planda RSS/API fetch + cluster + cache yaz
- [x] Backend: `cleanupOldArticles()` — 2 günden eski haberleri temizle
- [x] Backend: `startFeedScheduler()` / `stopFeedScheduler()` — 23h refresh, cleanup interval
- [x] Backend: `/api/feed` stale-while-revalidate mantığı (local cache/database varsa hemen dön, eskiyse arka planda refresh)
- [x] Backend: `/api/feed/refresh` manual fresh fetch endpoint'i
- [x] Backend: Feed response payload compaction ve anonim kullanıcı hızlı yolu
- [x] Backend: `/api/health` feedScheduler bilgileri (interval, retention, cached count, refresh status, next refresh)
- [x] Backend: ENV config — `NEWS_REFRESH_INTERVAL_HOURS` varsayılan 23, `NEWS_REFRESH_INTERVAL_MS`, `NEWS_RETENTION_DAYS`, `NEWS_FEED_RESPONSE_LIMIT`
- [x] Backend: Graceful shutdown (SIGINT/SIGTERM interval cleanup)
- [x] Backend: Concurrent refresh protection (`refreshing` flag)
- [x] Frontend: Stale warning toast (feed.warning gösterimi)
- [x] Build başarılı, 69/69 test geçti
- [x] Server/API/health smoke test başarılı (129 cached articles, feedScheduler active)

## P8 - HTML Entity Decode & Dil Seçimi (TR/EN)
- [x] Backend: `decodeHtml` hex entity (`&#x27;`) ve named entity (`&rsquo;`, `&nbsp;`, `&apos;` vb.) desteği
- [x] Backend: Duplicate `decodeHtml` fonksiyonu kaldırıldı (line 3886)
- [x] Backend: Kategori çeviri map'leri (`CATEGORY_TR_TO_EN`, `SUBCATEGORY_TR_TO_EN`)
- [x] Backend: `translateCategoryToEn/translateSubcategoryToEn` helper'ları
- [x] Backend: `normalizeArticleTransportFields` → `categoryEn`, `subcategoryEn`, `translations`, `originalLanguage`
- [x] Backend: Gemini çeviri sistemi (`translateArticleFields`, `translateArticleBatch`, `_translationCache`)
- [x] Backend: `backgroundRefreshFeed` çeviri entegrasyonu (API key yoksa graceful fallback)
- [x] Backend: `/api/health` translationStatus ve translationCacheSize
- [x] Backend: `/api/admin/categories` → `categoryTranslations`, `subcategoryTranslations`
- [x] Frontend: `decodeHtmlEntities` tüm metin alanlarına uygulandı (`toUiArticle`)
- [x] Frontend: `currentLang()`, `localizedCategory()`, `articleDisplayTitle/Summary/Content` helper'ları
- [x] Frontend: `renderArticleCardHtml` — dil-aware kategori, başlık, özet, buton metinleri
- [x] Frontend: Kaynak karşılaştırma modalı — dil-aware başlık, etiketler, linkler
- [x] Frontend: Share modal — dil-aware tüm metinler
- [x] Frontend: Dil toggle UI (Türkçe / English butonları, settings paneli)
- [x] Frontend: `localStorage.smartNewspaper.locale` persistence
- [x] Frontend: `switchLanguage()` — sayfa yenilemeden haber kartları ve modallar güncellenir
- [x] E-Gazete: `egazeteLang()`, `egazeteCat()`, `egazeteTitle()`, `egazeteSummary()` helper'ları
- [x] E-Gazete: Kapak, özet, makale, kaynak strip, paylaş butonları — tüm metinler dil-aware
- [x] E-Gazete: Toolbar, TOC, empty state — dil-aware
- [x] E-Gazete: Tarih formatı locale-aware (`en-US` / `tr-TR`)
- [x] CSS: Dil toggle buton stilleri (light/dark mode)
- [x] HTML: Dil toggle butonları `index.html`'e eklendi
- [x] Build başarılı, 69/69 test geçti
- [x] Server/API/health smoke başarılı, 0 entity kalan

## Devam Eden İşler

- (Tümü tamamlandı)

## Tamamlanan İşler

- 2026-06-11 16:53 - `.ai-team` klasör yapısı ve prompt dosyaları doğrulandı.
- 2026-06-11 16:53 - `npm test` scripti korundu ve test pipeline doğrulandı.
- 2026-06-11 16:53 - `/api/health` endpoint'i eklendi.
- 2026-06-11 16:53 - Build, test, server, HTTP ve browser smoke kontrolleri tamamlandı.
- 2026-06-11 17:01 - Backend outbound fetch akışı merkezi timeout/retry helper ile güçlendirildi.
- 2026-06-11 17:05 - RSS/API/DB birleşiminde stabil URL/title-source dedupe ve cache TTL görünürlüğü eklendi.
- 2026-06-11 17:15 - Agent-Frontend: E-Gazete TOC iyileştirmesi, placeholder, skeleton, empty/error state, responsive iyileştirmeler. P2 ve P3 büyük oranda tamamlandı.
- 2026-06-11 17:20 - Agent-Backend: Haber transport alanları normalize edildi; source/static cache bellek büyümesi limitlendi.
- 2026-06-11 17:28 - Agent-Backend: `/api/feed` başarı/boş/hata response sözleşmesi frontend empty state uyumuyla güçlendirildi; `/api/health` cache age/TTL görünürlüğü iyileştirildi.
- 2026-06-11 17:35 - Agent-Frontend: 3 bug düzeltildi (isFirst TDZ, empty state selector, geri dön butonu). CSS okunabilirlik iyileştirmeleri. Browser console hataları temizlendi. P2 tamamlandı.
- 2026-06-11 18:05 - Agent-Fullstack: Story Clustering sistemi tamamlandı. Backend cluster mantığı, frontend kaynak chip/badge/karşılaştırma modalı, E-Gazete cluster desteği, CSS stilleri (light/dark/mobile). Build/test/server/browser smoke OK.
- 2026-06-11 18:20 - Agent-Fullstack: Haber Paylaşım Sistemi tamamlandı. Share modal (WhatsApp/Instagram/link/kullanıcıya gönder), notification center (bell/badge/panel), 7 yeni API endpoint, E-Gazete paylaş butonları, rate limit, memory limit. Build/test/server/browser smoke OK.
- 2026-06-11 18:30 - Agent-Fullstack: Feed Cache/Scheduler sistemi tamamlandı. Stale-while-revalidate, background refresh, 2d cleanup, feedScheduler health info. Build/test/server/health OK. 129 haber cached, refresh success.
- 2026-06-13 22:03 - Agent-Backend/Test: İlk açılış feed bug'ı düzeltildi. `/api/feed` local cache/database'i canlı RSS beklemeden dönüyor; manual refresh `/api/feed/refresh`; scheduler varsayılan 23h; browser smoke OK.
- 2026-06-11 21:36 - Agent-Backend: Port çakışması logları owner PID/aksiyon önerisiyle doğrulandı; backend logları merkezi logger formatına çekildi. Build/test/API/browser smoke OK.
- 2026-06-11 21:41 - Agent-Fullstack: Haber paylaşım sistemi regression fix tamamlandı. Görünür paylaş ikonu, modal payload, drag/drop, share API notification response ve E-Gazete paylaş modal akışı doğrulandı.
- 2026-06-11 22:55 - Agent-Fullstack: HTML Entity Decode & Dil Seçimi (TR/EN) tamamlandı. decodeHtml hex+named entity desteği, Gemini çeviri sistemi (fallback-safe), TR/EN dil toggle, kategori çevirileri, E-Gazete/dashboard/modal dil desteği. Build/test/server/API smoke OK. 0 entity kalan.

## Bloke Olan İşler

Henüz yok.
