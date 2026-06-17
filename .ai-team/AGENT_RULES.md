# AI TEAM ANA KURALLARI

Bu repo içinde birden fazla AI ajanı aynı anda çalışabilir.

Amaç:
- Sistemi gerçek developer ekibi gibi geliştirmek.
- Performansı artırmak.
- UI/UX kalitesini yükseltmek.
- Backend veri akışını sağlamlaştırmak.
- Cache, build, test ve hata dayanıklılığını iyileştirmek.
- Mevcut çalışan sistemi bozmadan geliştirme yapmak.

## Genel Kurallar

1. Kullanıcıdan sürekli onay isteme.
2. Küçük/orta seviye geliştirmeleri doğrudan uygula.
3. Kod yazmadan önce mevcut yapıyı oku ve anla.
4. Aynı anda aynı dosyada başka ajan çalışıyorsa o dosyaya dokunma.
5. Büyük silme/refactor işlemlerinden kaçın.
6. API key, secret, env dosyası, production deploy, veritabanı silme, ücretli servis açma gibi işlemleri kullanıcı onayı olmadan yapma.
7. Her değişiklikten sonra test/build/server/browser kontrolü yap.
8. Yaptığın her işi .ai-team dosyalarına yaz.
9. Başka ajanın yaptığı değişikliği ezme.
10. Çakışma görürsen önce analiz et, sonra küçük patch uygula.

## Başlamadan Önce Oku

Her ajan işe başlamadan önce şu dosyaları okumalı:
- .ai-team/AGENT_RULES.md
- .ai-team/TASK_BOARD.md
- .ai-team/AGENT_LOG.md
- .ai-team/HANDOFF.md
- .ai-team/REVIEW_REPORT.md

## Dosya Kilitleme

Bir dosyada çalışmadan önce `.ai-team/locks` içine lock dosyası oluştur.

Örnek:
.ai-team/locks/frontend.lock

İçerik:
Agent: Agent-Frontend
Working on:
- css/style.css
- js/app.js
Started: YYYY-MM-DD HH:mm

İş bitince lock dosyasını güncelle veya kaldır.

## Otomatik Çalışma Modu

- Sadece öneri verme, uygulanabilir işleri doğrudan yap.
- Analiz et.
- Kodla.
- Test et.
- Hata varsa düzelt.
- Raporla.
- Bir işi yarım bırakma.

## Sadece Şu Durumlarda Dur

- API key / secret silme veya değiştirme
- Production deploy
- Veritabanını tamamen silme
- Ücretli servis açma
- Güvenlik riski yaratabilecek işlem
- Büyük yıkıcı refactor

Bunların dışında güvenli geliştirmeleri uygula.
