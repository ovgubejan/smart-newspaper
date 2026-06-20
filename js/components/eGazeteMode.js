function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function clampText(value = "", max = 170) {
  const clean = stripHtml(value);
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "...";
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long"
  }).format(date);
}

function formatDateShort(date = new Date()) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function issueNumber(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date - start) / 86400000);
  return String(date.getFullYear()).slice(2) + String(day).padStart(3, "0");
}

function getWeatherLabel() {
  try {
    const raw = localStorage.getItem("smart_newspaper_weather");
    if (!raw) return { text: "Parçalı bulutlu", temp: "22°C", icon: "fa-cloud-sun" };
    const weather = JSON.parse(raw);
    const temp = weather.temp != null ? `${weather.temp}°C` : "22°C";
    const labels = {
      Clear: "Açık", Clouds: "Bulutlu", Rain: "Yağışlı", Snow: "Karlı",
      Thunderstorm: "Fırtınalı", Mist: "Sisli", Fog: "Sisli", Haze: "Puslu"
    };
    const icons = {
      Clear: "fa-sun", Clouds: "fa-cloud", Rain: "fa-cloud-rain", Snow: "fa-snowflake",
      Thunderstorm: "fa-bolt", Mist: "fa-smog", Fog: "fa-smog", Haze: "fa-smog"
    };
    return {
      text: labels[weather.main] || "Parçalı bulutlu",
      temp,
      icon: icons[weather.main] || "fa-cloud-sun"
    };
  } catch {
    return { text: "Parçalı bulutlu", temp: "22°C", icon: "fa-cloud-sun" };
  }
}

function articleImage(article, index = 0) {
  const fromArticle = article?.imageUrl || article?.image || article?.urlToImage || "";
  if (fromArticle) return fromArticle;
  const fallback = [
    "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1551836022-4c4c79ecde51?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1569163139394-de4e4f3e2b6c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1518893883800-45cd0954574b?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=1200&q=80"
  ];
  return fallback[index % fallback.length];
}

const SAMPLE_NEWS = [
  {
    category: "Spor",
    title: "Ligde kritik hafta: Puan farkları kapanıyor",
    summary: "Takımlar arasındaki puan farkı son haftalarda iyice azaldı. Deplasman galibiyetleri sıralamayı alt üst etti.",
    meta: "Sayfa 14",
    readTime: "5 dk okuma"
  },
  {
    category: "Gündem",
    title: "Yeni düzenleme mecliste kabul edildi",
    summary: "Kamu hizmetlerinde sadeleşme sağlayacak düzenleme için uygulama takvimi ve geçiş adımları duyuruldu.",
    meta: "Sayfa 3",
    readTime: "4 dk okuma"
  },
  {
    category: "Teknoloji",
    title: "Yapay zeka destekli asistanlar yaygınlaşıyor",
    summary: "Dijital asistanlar, günlük iş akışlarını optimize ederek verimliliği artırmaya devam ediyor.",
    meta: "Sayfa 10",
    readTime: "5 dk okuma"
  },
  {
    category: "Ekonomi",
    title: "Piyasalar güne yükselişle başladı",
    summary: "Küresel veri akışı ve iç talep beklentileri olumlu bir tablo çiziyor.",
    meta: "Sayfa 6",
    readTime: "3 dk okuma"
  },
  {
    category: "Yaşam",
    title: "Bahar festivali renkli görüntülere sahne oldu",
    summary: "Binlerce kişi etkinlikte buluştu. Açık hava programları yoğun ilgi gördü.",
    meta: "Sayfa 8",
    readTime: "4 dk okuma"
  },
  {
    category: "Sağlık",
    title: "Uzmanlardan grip uyarısı",
    summary: "Bağışıklık sistemini güçlendirmek ve mevsimsel hastalıklara karşı önlem almak önem taşıyor.",
    meta: "Sayfa 12",
    readTime: "3 dk okuma"
  },
  {
    category: "Dünya",
    title: "Küresel ısınmanın etkileri artıyor",
    summary: "Uzmanlar acil önlem çağrısında bulundu. İklim değişikliğinin somut etkileri her geçen gün daha belirgin.",
    meta: "Sayfa 11",
    readTime: "5 dk okuma"
  },
  {
    category: "Uzay",
    title: "Uzayda yeni bir dönem: Ay görevleri hız kazanıyor",
    summary: "Uzay ajansları, Ay'a yönelik yeni görevler için çalışmalarını sürdürüyor.",
    meta: "Sayfa 9",
    readTime: "5 dk okuma"
  },
  {
    category: "Sosyal Medya",
    title: "Sosyal medya algoritmaları değişiyor",
    summary: "Platformlar, kullanıcı deneyimini iyileştirmek için algoritmalarını güncelliyor.",
    meta: "Sayfa 10",
    readTime: "4 dk okuma"
  },
  {
    category: "Otomotiv",
    title: "Elektrikli araçlara olan talep artıyor",
    summary: "Elektrikli araç satışları geçtiğimiz yıla göre belirgin bir artış gösterdi.",
    meta: "Sayfa 9",
    readTime: "4 dk okuma"
  },
  {
    category: "Teknoloji",
    title: "Yeni nesil akıllı telefonlar tanıtıldı",
    summary: "Teknoloji devleri, yılın en yeni akıllı telefon modellerini tanıttı.",
    meta: "Sayfa 11",
    readTime: "6 dk okuma"
  },
  {
    category: "Teknoloji",
    title: "5G teknolojisi artık daha yaygın",
    summary: "5G altyapısının yaygınlaşmasıyla birlikte internet hızları rekor seviyelere ulaştı.",
    meta: "Sayfa 10",
    readTime: "5 dk okuma"
  },
  {
    category: "Çevre",
    title: "Bilim insanlarından iklim değişikliği uyarısı",
    summary: "Raporlar, küresel ısınmanın etkilerinin her geçen gün arttığını gösteriyor.",
    meta: "Sayfa 11",
    readTime: "6 dk okuma"
  },
  {
    category: "Festival",
    title: "Uluslararası film festivali başladı",
    summary: "Festival bu yıl birçok ülkeden yapımları ağırlıyor ve geniş katılım bekleniyor.",
    meta: "Sayfa 16",
    readTime: "6 dk okuma"
  },
  {
    category: "Müzik",
    title: "Yeni albüm müzikseverlerle buluştu",
    summary: "Uzun süredir beklenen albüm, dinleyicilerden olumlu tepkiler aldı.",
    meta: "Sayfa 17",
    readTime: "4 dk okuma"
  },
  {
    category: "Tiyatro",
    title: "Tiyatro oyunu büyük beğeni topladı",
    summary: "Yeni sezon oyunu izleyicilerden tam not aldı. Biletler kısa sürede tükendi.",
    meta: "Sayfa 16",
    readTime: "5 dk okuma"
  },
  {
    category: "Müze",
    title: "Müze haftası etkinlikleri devam ediyor",
    summary: "Birçok şehirde müzeler ücretsiz ziyaret edilebiliyor. Özel sergiler ilgi çekiyor.",
    meta: "Sayfa 17",
    readTime: "4 dk okuma"
  },
  {
    category: "Kitap",
    title: "Kitap fuarı kitapseverleri ağırlıyor",
    summary: "Fuar, imza günleri ve söyleşilerle dolu dolu bir program sunuyor.",
    meta: "Sayfa 18",
    readTime: "5 dk okuma"
  },
  {
    category: "Gezi",
    title: "Tarihi kentte bahar güzelliği",
    summary: "Tarihi dokusu ve doğal güzellikleriyle ziyaretçilerini bekliyor.",
    meta: "Sayfa 18",
    readTime: "4 dk okuma"
  }
];

const AUTHOR_DATA = [
  { name: "Gündemdeki Ekonomi", desc: "Piyasa analizi", count: 2 },
  { name: "Dijital Dünyadan", desc: "Teknoloji yazıları", count: 7 },
  { name: "Şehir Notları", desc: "Kent yaşamı", count: 11 },
  { name: "Sanatın İzinde", desc: "Kültür-sanat", count: 19 }
];

function buildNewsData(articles = []) {
  return SAMPLE_NEWS.map((item, index) => {
    const article = articles.length ? articles[index % articles.length] : {};
    const id = article.id || `egazete-placeholder-${index}`;
    return {
      ...item,
      id,
      articleId: id,
      clusterId: article.clusterId || article.cluster_id || article.clusterKey || "",
      url: article.url || article.link || article.sourceUrl || article.originalUrl || "",
      image: articleImage(article, index)
    };
  });
}

function readingTime(news) {
  const words = news.reduce((sum, item) => sum + `${item.title} ${item.summary}`.split(/\s+/).length, 0);
  return Math.max(6, Math.round(words / 110));
}

function iconForCategory(category = "") {
  const key = category.toLocaleLowerCase("tr-TR");
  if (key.includes("teknoloji")) return "fa-microchip";
  if (key.includes("bilim")) return "fa-atom";
  if (key.includes("kültür")) return "fa-masks-theater";
  if (key.includes("ekonomi")) return "fa-chart-line";
  if (key.includes("sağlık")) return "fa-heart-pulse";
  if (key.includes("çevre")) return "fa-seedling";
  if (key.includes("dünya")) return "fa-globe";
  if (key.includes("eğitim")) return "fa-graduation-cap";
  if (key.includes("uzay")) return "fa-rocket";
  if (key.includes("sosyal")) return "fa-infinity";
  if (key.includes("otomotiv")) return "fa-car";
  if (key.includes("spor")) return "fa-futbol";
  if (key.includes("festival")) return "fa-film";
  if (key.includes("müzik")) return "fa-music";
  if (key.includes("tiyatro")) return "fa-masks-theater";
  if (key.includes("müze")) return "fa-landmark";
  if (key.includes("kitap")) return "fa-book";
  if (key.includes("gezi")) return "fa-mountain-sun";
  return "fa-newspaper";
}

function uniqueCategories(news) {
  return ["Anasayfa", ...new Set(news.map((item) => item.category))].slice(0, 9);
}

export class EGazeteMode {
  constructor(options = {}) {
    this.getArticles = options.getArticles || (() => []);
    this.getProfile = options.getProfile || (() => ({}));
    this.onArticleAction = options.onArticleAction || (() => {});
    this.container = null;
    this.news = [];
    this._delegatedContainer = null;
    this._articleClickHandler = null;
    this._articleKeyHandler = null;
  }

  open() {
    if (typeof window.showPage === "function") window.showPage("egazete");
    const target = document.getElementById("egazete-dashboard-section") || this.container;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  close() {
    if (typeof window.showPage === "function") window.showPage("feed");
  }

  renderDashboard(container) {
    if (!container) return;
    this.container = container;
    const sourceArticles = Array.isArray(this.getArticles()) ? this.getArticles() : [];
    this.news = buildNewsData(sourceArticles);

    const activeCategories = uniqueCategories(this.news);
    const weather = getWeatherLabel();

    const hero = this.news[0];
    const sideCards = this.news.slice(1, 3);
    const highlights = this.news.slice(3, 7);

    const sciTech = this.news.filter(n =>
      ["Uzay", "Sosyal Medya", "Otomotiv", "Teknoloji", "Çevre"].includes(n.category)
    ).slice(0, 6);

    const culture = this.news.filter(n =>
      ["Festival", "Müzik", "Tiyatro", "Müze", "Kitap", "Gezi"].includes(n.category)
    ).slice(0, 7);

    container.innerHTML = `
      <div class="eg" aria-label="E-Gazete">
        ${this._renderHeader(weather, activeCategories)}
        <div class="eg-body">
          ${this._renderLeftPanel(hero, sideCards, highlights)}
          ${this._renderMiddlePanel(sciTech)}
          ${this._renderRightPanel(culture)}
        </div>
      </div>
    `;

    this.bindArticleDelegation(container);
    container.querySelector("#eg-pdf-btn")?.addEventListener("click", () => this.printPdf());
  }

  articleAttrs(item) {
    const id = escapeHtml(String(item?.articleId || item?.id || ""));
    const clusterId = item?.clusterId ? ` data-cluster-id="${escapeHtml(String(item.clusterId))}"` : "";
    const url = item?.url ? ` data-url="${escapeHtml(String(item.url))}"` : "";
    const title = escapeHtml(stripHtml(item?.title || "Haber"));
    return `data-eg-article-card data-eid="${id}" data-article-id="${id}"${clusterId}${url} role="button" tabindex="0" aria-label="Haberi aç: ${title}"`;
  }

  bindArticleDelegation(container) {
    if (!container) return;

    if (this._delegatedContainer && this._delegatedContainer !== container) {
      this._delegatedContainer.removeEventListener("click", this._articleClickHandler);
      this._delegatedContainer.removeEventListener("keydown", this._articleKeyHandler);
      this._delegatedContainer = null;
    }

    if (this._delegatedContainer === container) return;

    this._articleClickHandler = (event) => {
      const card = this.getArticleCardFromEvent(event);
      if (!card) return;
      event.preventDefault();
      this.openEGazeteArticle(card.dataset.articleId || card.dataset.eid);
    };

    this._articleKeyHandler = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = this.getArticleCardFromEvent(event);
      if (!card) return;
      event.preventDefault();
      this.openEGazeteArticle(card.dataset.articleId || card.dataset.eid);
    };

    container.addEventListener("click", this._articleClickHandler);
    container.addEventListener("keydown", this._articleKeyHandler);
    this._delegatedContainer = container;
  }

  getArticleCardFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (target.closest("button, a, input, select, textarea, [data-eg-interactive]")) return null;
    const card = target.closest("[data-eg-article-card]");
    if (!card || !this.container?.contains(card)) return null;
    return card;
  }

  _renderHeader(weather, categories) {
    return `
      <header class="eg-header">
        <div class="eg-header-top">
          <div class="eg-brand">
            <button type="button" class="eg-menu-btn" data-eg-interactive aria-label="Menü">
              <i class="fa-solid fa-bars"></i>
            </button>
            <div class="eg-brand-text">
              <h1>e-Gazete</h1>
              <span>Güncel &middot; Tarafsız &middot; Güvenilir</span>
            </div>
          </div>
          <div class="eg-header-meta">
            <div class="eg-meta-chip eg-meta-weather">
              <i class="fa-solid ${weather.icon}"></i>
              <span>${escapeHtml(weather.temp)}</span>
            </div>
            <div class="eg-meta-chip eg-meta-date">
              <i class="fa-regular fa-calendar"></i>
              <span>${escapeHtml(formatDateShort())}</span>
            </div>
            <div class="eg-meta-chip">
              <span>Sayı: ${issueNumber()}</span>
            </div>
          </div>
          <div class="eg-header-actions">
            <button type="button" class="eg-icon-btn" data-eg-interactive aria-label="Arama">
              <i class="fa-solid fa-magnifying-glass"></i>
            </button>
            <button type="button" class="eg-icon-btn" data-eg-interactive aria-label="Yer imi">
              <i class="fa-regular fa-bookmark"></i>
            </button>
          </div>
        </div>
        <nav class="eg-tabs" aria-label="Kategoriler">
          ${categories.map((c, i) => `
            <button type="button" class="eg-tab${i === 0 ? " is-active" : ""}" data-eg-interactive>${escapeHtml(c)}</button>
          `).join("")}
        </nav>
      </header>
    `;
  }

  _renderLeftPanel(hero, sideCards, highlights) {
    return `
      <section class="eg-panel eg-panel-left" aria-label="Ana sayfa">
        <div class="eg-hero-grid">
          <article class="eg-hero" ${this.articleAttrs(hero)}>
            <img src="${escapeHtml(hero.image)}" alt="" loading="lazy">
            <div class="eg-hero-overlay">
              <span class="eg-cat-badge eg-cat-badge--hero">${escapeHtml(hero.category)}</span>
              <h2>${escapeHtml(hero.title)}</h2>
              <p>${escapeHtml(hero.summary)}</p>
              <div class="eg-hero-foot">
                <small>${escapeHtml(hero.meta)}</small>
                <div class="eg-hero-nav" data-eg-interactive>
                  <button type="button" aria-label="Önceki"><i class="fa-solid fa-chevron-left"></i></button>
                  <button type="button" aria-label="Sonraki"><i class="fa-solid fa-chevron-right"></i></button>
                </div>
              </div>
            </div>
          </article>
          <div class="eg-side-stack">
            ${sideCards.map((item, i) => `
              <article class="eg-side-card" ${this.articleAttrs(item)}>
                <span class="eg-cat-badge">${escapeHtml(item.category)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(clampText(item.summary, 80))}</p>
                <small>${escapeHtml(item.meta)}</small>
              </article>
            `).join("")}
          </div>
        </div>

        <section class="eg-highlights" aria-label="Günün Öne Çıkanları">
          <div class="eg-section-head">
            <h3><i class="fa-solid fa-fire"></i> Günün Öne Çıkanları</h3>
            <button type="button" class="eg-link-btn" data-eg-interactive>Tümünü Gör <i class="fa-solid fa-arrow-right"></i></button>
          </div>
          <div class="eg-highlight-grid">
            ${highlights.map((item, i) => `
              <article class="eg-highlight-card" ${this.articleAttrs(item)}>
                <img src="${escapeHtml(item.image)}" alt="" loading="lazy">
                <div class="eg-highlight-body">
                  <span class="eg-cat-badge eg-cat-badge--small">${escapeHtml(item.category)}</span>
                  <h4>${escapeHtml(item.title)}</h4>
                  <p>${escapeHtml(clampText(item.summary, 60))}</p>
                  <small>${escapeHtml(item.meta)}</small>
                </div>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="eg-authors" aria-label="Yazarlar">
          <div class="eg-section-head">
            <h3 class="eg-authors-title">YAZARLAR</h3>
            <button type="button" class="eg-link-btn" data-eg-interactive>Tüm Yazarlar <i class="fa-solid fa-arrow-right"></i></button>
          </div>
          <div class="eg-author-grid">
            ${AUTHOR_DATA.map((author, i) => `
              <article class="eg-author-card">
                <div class="eg-author-avatar">${i + 1}</div>
                <div class="eg-author-info">
                  <strong>${escapeHtml(author.name)}</strong>
                  <span>${escapeHtml(author.desc)}</span>
                </div>
                <div class="eg-author-count">
                  <i class="fa-regular fa-comment"></i> ${author.count}
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      </section>
    `;
  }

  _renderMiddlePanel(articles) {
    return `
      <section class="eg-panel eg-panel-mid" aria-label="Bilim ve Teknoloji">
        <div class="eg-panel-head">
          <div class="eg-panel-head-icon"><i class="fa-solid fa-atom"></i></div>
          <h2>Bilim ve Teknoloji</h2>
        </div>
        <div class="eg-news-grid">
          ${articles.map((item, i) => `
            <article class="eg-news-card" ${this.articleAttrs(item)}>
              <div class="eg-news-img">
                <img src="${escapeHtml(item.image)}" alt="" loading="lazy">
                <span class="eg-cat-badge eg-cat-badge--overlay">${escapeHtml(item.category)}</span>
              </div>
              <div class="eg-news-body">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(clampText(item.summary, 100))}</p>
                <div class="eg-news-meta">
                  <small>${escapeHtml(item.meta)} &middot; ${escapeHtml(item.readTime)}</small>
                  <button type="button" class="eg-save-btn" data-eg-interactive aria-label="Kaydet"><i class="fa-regular fa-bookmark"></i></button>
                </div>
              </div>
            </article>
          `).join("")}
        </div>
        <button type="button" class="eg-more-btn" data-eg-interactive>
          Daha Fazlası <i class="fa-solid fa-arrow-right"></i>
        </button>
      </section>
    `;
  }

  _renderRightPanel(articles) {
    const mainCards = articles.slice(0, 6);
    const featured = articles[articles.length - 1] || articles[0];

    return `
      <section class="eg-panel eg-panel-right" aria-label="Kültür & Sanat">
        <div class="eg-panel-head eg-panel-head--culture">
          <div class="eg-panel-head-icon"><i class="fa-solid fa-masks-theater"></i></div>
          <h2>Kültür & Sanat</h2>
        </div>
        <div class="eg-culture-grid">
          ${mainCards.map((item, i) => `
            <article class="eg-culture-card" ${this.articleAttrs(item)}>
              <div class="eg-culture-img">
                <img src="${escapeHtml(item.image)}" alt="" loading="lazy">
                <span class="eg-cat-badge eg-cat-badge--culture">${escapeHtml(item.category)}</span>
              </div>
              <div class="eg-culture-body">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(clampText(item.summary, 70))}</p>
                <small>${escapeHtml(item.meta)} &middot; ${escapeHtml(item.readTime)}</small>
              </div>
            </article>
          `).join("")}
        </div>
        <div class="eg-featured-banner" ${this.articleAttrs(featured)}>
          <div class="eg-featured-quote"><i class="fa-solid fa-quote-right"></i></div>
          <div class="eg-featured-content">
            <span class="eg-featured-label">Haftanın Dosyası</span>
            <h3>${escapeHtml(featured.title)}</h3>
            <p>${escapeHtml(clampText(featured.summary, 120))}</p>
            <small>${escapeHtml(featured.meta)} &middot; ${escapeHtml(featured.readTime)}</small>
          </div>
        </div>
      </section>
    `;
  }

  handleArticleOpen(id) {
    const articleId = String(id || "").trim();
    if (!articleId) {
      console.warn("e-Gazete article id bulunamadı.");
      return;
    }

    const article = Array.isArray(this.getArticles())
      ? this.getArticles().find(item => String(item.id) === articleId)
      : null;
    if (article) {
      this.onArticleAction("detail", article.id);
      return;
    }
    console.warn("e-Gazete article bulunamadı:", articleId);
    if (typeof window.showToast === "function") {
      window.showToast("Bu e-gazete kartı yalnızca yerleşim önizlemesi için hazırlandı.", "info");
    }
  }

  openEGazeteArticle(id) {
    this.handleArticleOpen(id);
  }

  legacyPrintPdf() {
    const selected = this.news?.length ? this.news : buildNewsData(this.getArticles());
    const html = `
      <!doctype html>
      <html lang="tr">
      <head>
        <meta charset="utf-8">
        <title>e-Gazete Seçkisi</title>
        <style>
          body { font-family: Georgia, "Times New Roman", serif; color: #111827; margin: 32px; }
          h1 { font-size: 34px; margin: 0 0 6px; }
          .meta { color: #64748b; border-bottom: 2px solid #312e81; padding-bottom: 12px; margin-bottom: 20px; }
          article { break-inside: avoid; border-bottom: 1px solid #e5e7eb; padding: 16px 0; }
          h2 { font-size: 22px; margin: 5px 0; }
          span { color: #4f46e5; font-weight: 700; font-family: Arial, sans-serif; font-size: 12px; text-transform: uppercase; }
          p { font-size: 14px; line-height: 1.55; }
          small { color: #6b7280; font-family: Arial, sans-serif; }
        </style>
      </head>
      <body>
        <h1>e-Gazete</h1>
        <div class="meta">${escapeHtml(formatDate())} &middot; Sayı ${issueNumber()}</div>
        ${selected.map(item => `
          <article>
            <span>${escapeHtml(item.category)}</span>
            <h2>${escapeHtml(item.title)}</h2>
            <p>${escapeHtml(item.summary)}</p>
            <small>${escapeHtml(item.meta)}</small>
          </article>
        `).join("")}
      </body>
      </html>
    `;
    this.downloadPdfFromServer(html).catch(() => {
      const printWindow = window.open("", "_blank", "noopener");
      if (!printWindow) return;
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    });
  }

  async downloadPdfFromServer(html) {
    const authToken = localStorage.getItem("newspaperAuthToken") || "";
    const response = await fetch("/api/export/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify({ html, layout: "egazete" })
    });
    if (!response.ok) throw new Error(`PDF sunucu hatası: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `e-gazete-${issueNumber()}.pdf`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 500);
  }

  printPdf() {
    const params = new URLSearchParams({
      mode: "inline",
      personalized: "true",
      includeUserSources: "true",
      layout: "egazete",
      language: "tr"
    });
    if (typeof window.showToast === "function") {
      window.showToast("PDF hazırlanıyor, yeni sekmede açılacak...", "info");
    }
    window.open(`/api/export/pdf?${params.toString()}`, "_blank", "noopener,noreferrer");
  }
}
