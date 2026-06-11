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

function clampText(value = "", max = 420) {
  const clean = stripHtml(value);
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function formatTurkishDate(date = new Date()) {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatTurkishDateFull(date = new Date()) {
  return new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function getReadingTime(articles) {
  let totalWords = 0;
  for (const a of articles) {
    const text = a.aiSummary || a.summary || a.description || a.fullText || a.content || a.title || "";
    totalWords += stripHtml(text).split(/\s+/).length;
  }
  return Math.max(5, Math.round(totalWords / 200));
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "İyi Geceler";
  if (h < 12) return "Günaydın";
  if (h < 18) return "İyi Günler";
  return "İyi Akşamlar";
}

const CATEGORY_COLORS = {
  "Gündem": "#c0392b", "Ekonomi": "#2980b9", "Teknoloji": "#8e44ad",
  "Spor": "#27ae60", "Dünya": "#d35400", "Sağlık": "#16a085",
  "Bilim": "#2c3e50", "Kültür": "#f39c12", "Magazin": "#e74c3c",
  "Eğitim": "#1abc9c", "Çevre": "#27ae60", "Siyaset": "#c0392b"
};

function catColor(cat) {
  return CATEGORY_COLORS[cat] || "#64748b";
}

export class EGazeteMode {
  constructor(options = {}) {
    this.getArticles = options.getArticles || (() => []);
    this.getProfile = options.getProfile || (() => ({}));
    this.getSimilarArticles = options.getSimilarArticles || (() => []);
    this.onArticleAction = options.onArticleAction || (() => {});
    this.root = null;
    this.reader = null;
    this.printSource = null;
    this.pages = [];
    this.currentIndex = 0;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.isOpen = false;
    this.isFlipping = false;
    this.zoomLevel = 1;
    this.isFullscreen = false;
    this.viewMode = "auto";
    this.boundKeydown = (event) => this.handleKeydown(event);
    this.currentTheme = "cream";
  }

  ensureDom() {
    if (this.root) return;
    const wrapper = document.createElement("section");
    wrapper.id = "egazete-modal";
    wrapper.className = "egazete-modal";
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "true");
    wrapper.setAttribute("aria-labelledby", "egazete-title");
    wrapper.hidden = true;
    wrapper.innerHTML = `
      <div class="egazete-backdrop" data-egazete-close></div>
      <div class="egazete-shell" role="document">
        <header class="egazete-toolbar">
          <div class="egazete-toolbar-brand">
            <p class="egazete-kicker">AI Destekli Kişisel Baskı</p>
            <h2 id="egazete-title">Kişisel E-Gazete</h2>
          </div>
          <div class="egazete-toolbar-actions">
            <div class="egazete-theme-switcher" id="egazete-theme-switcher">
              <button type="button" class="egazete-theme-btn active" data-theme="cream" title="Krem"><span style="background:#faf8f1;border:2px solid #d4c9b0"></span></button>
              <button type="button" class="egazete-theme-btn" data-theme="white" title="Beyaz"><span style="background:#ffffff;border:2px solid #e2e8f0"></span></button>
              <button type="button" class="egazete-theme-btn" data-theme="dark" title="Gece"><span style="background:#1a1a2e;border:2px solid #334155"></span></button>
              <button type="button" class="egazete-theme-btn" data-theme="sepia" title="Sepya"><span style="background:#f5e6c8;border:2px solid #c9a96e"></span></button>
            </div>
            <div class="egazete-ctrl-group">
              <button type="button" class="egazete-tool-btn" id="egazete-zoom-out" title="Küçült"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
              <button type="button" class="egazete-tool-btn" id="egazete-zoom-in" title="Büyüt"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
              <button type="button" class="egazete-tool-btn" id="egazete-view-toggle" title="Görünüm"><i class="fa-solid fa-columns"></i></button>
              <button type="button" class="egazete-tool-btn" id="egazete-fullscreen" title="Tam Ekran"><i class="fa-solid fa-expand"></i></button>
            </div>
            <button type="button" class="egazete-tool-btn" id="egazete-toc-toggle" title="İçindekiler"><i class="fa-solid fa-list-ol"></i></button>
            <button type="button" class="egazete-tool-btn" id="egazete-pdf-btn"><i class="fa-solid fa-download"></i> PDF</button>
            <button type="button" class="egazete-tool-btn is-ghost" data-egazete-close aria-label="Kapat"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </header>
        <div class="egazete-body-wrap">
          <aside class="egazete-toc-panel" id="egazete-toc-panel" hidden>
            <div class="egazete-toc-head">
              <h3><i class="fa-solid fa-list-ol"></i> İçindekiler</h3>
              <button type="button" id="egazete-toc-close" aria-label="İçindekileri kapat"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <ul class="egazete-toc-list" id="egazete-toc-list"></ul>
          </aside>
          <div class="egazete-reader-wrap">
            <button type="button" class="egazete-nav egazete-prev" id="egazete-prev" aria-label="Önceki sayfa"><i class="fa-solid fa-chevron-left"></i></button>
            <div class="egazete-book-container">
              <div class="egazete-book" id="egazete-book" aria-live="polite"></div>
              <div class="egazete-spine"></div>
            </div>
            <button type="button" class="egazete-nav egazete-next" id="egazete-next" aria-label="Sonraki sayfa"><i class="fa-solid fa-chevron-right"></i></button>
          </div>
        </div>
        <footer class="egazete-footer">
          <div class="egazete-reading-progress" id="egazete-reading-progress">
            <span class="egazete-rp-label" id="egazete-rp-label">Sayfa 1</span>
            <div class="egazete-rp-bar"><span class="egazete-rp-fill" id="egazete-rp-fill"></span></div>
            <span class="egazete-rp-pct" id="egazete-rp-pct">0%</span>
          </div>
          <span id="egazete-counter">1 / 1</span>
          <div class="egazete-progress"><span id="egazete-progress-fill"></span></div>
          <span class="egazete-hint">Swipe, ok tuşları veya butonlarla sayfa değiştir</span>
        </footer>
      </div>
      <div id="egazete-print-source" class="egazete-print-source" aria-hidden="true"></div>
    `;
    document.body.appendChild(wrapper);
    this.root = wrapper;
    this.reader = wrapper.querySelector("#egazete-book");
    this.printSource = wrapper.querySelector("#egazete-print-source");
    this.counter = wrapper.querySelector("#egazete-counter");
    this.progressFill = wrapper.querySelector("#egazete-progress-fill");
    this.prevBtn = wrapper.querySelector("#egazete-prev");
    this.nextBtn = wrapper.querySelector("#egazete-next");
    this.tocPanel = wrapper.querySelector("#egazete-toc-panel");
    this.tocList = wrapper.querySelector("#egazete-toc-list");
    this.rpLabel = wrapper.querySelector("#egazete-rp-label");
    this.rpFill = wrapper.querySelector("#egazete-rp-fill");
    this.rpPct = wrapper.querySelector("#egazete-rp-pct");
    this.bookContainer = wrapper.querySelector(".egazete-book-container");
    this.spine = wrapper.querySelector(".egazete-spine");

    wrapper.addEventListener("click", (event) => {
      if (event.target.closest("[data-egazete-close]")) this.close();
      if (event.target.closest("#egazete-pdf-btn")) this.printPdf();
      if (event.target.closest("#egazete-zoom-in")) this.zoomIn();
      if (event.target.closest("#egazete-zoom-out")) this.zoomOut();
      if (event.target.closest("#egazete-fullscreen")) this.toggleFullscreen();
      if (event.target.closest("#egazete-view-toggle")) this.toggleViewMode();
      const detail = event.target.closest("[data-egazete-detail]");
      if (detail) this.onArticleAction("detail", detail.dataset.egazeteDetail);
      const source = event.target.closest("[data-egazete-source]");
      if (source) {
        event.preventDefault();
        this.onArticleAction("detail", source.dataset.egazeteSourceId || source.dataset.egazeteSource);
      }
      const themeBtn = event.target.closest("[data-theme]");
      if (themeBtn) this.setTheme(themeBtn.dataset.theme);
      if (event.target.closest("#egazete-toc-toggle")) this.toggleToc();
      if (event.target.closest("#egazete-toc-close")) this.toggleToc(false);
      const tocItem = event.target.closest("[data-toc-page]");
      if (tocItem) { this.goToPage(parseInt(tocItem.dataset.tocPage, 10)); this.toggleToc(false); }
    });
    this.prevBtn.addEventListener("click", () => this.prev());
    this.nextBtn.addEventListener("click", () => this.next());
    this.reader.addEventListener("touchstart", (event) => this.onTouchStart(event), { passive: true });
    this.reader.addEventListener("touchend", (event) => this.onTouchEnd(event), { passive: true });
    this.reader.addEventListener("pointerdown", (event) => {
      this.touchStartX = event.clientX;
      this.touchStartY = event.clientY;
    });
    this.reader.addEventListener("pointerup", (event) => {
      const dx = event.clientX - this.touchStartX;
      const dy = event.clientY - this.touchStartY;
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? this.next() : this.prev();
    });
  }

  // --- Zoom ---
  zoomIn() {
    this.zoomLevel = Math.min(1.5, this.zoomLevel + 0.1);
    this.applyZoom();
  }
  zoomOut() {
    this.zoomLevel = Math.max(0.6, this.zoomLevel - 0.1);
    this.applyZoom();
  }
  applyZoom() {
    if (this.bookContainer) {
      this.bookContainer.style.transform = `scale(${this.zoomLevel})`;
    }
  }

  // --- Fullscreen ---
  toggleFullscreen() {
    const shell = this.root?.querySelector(".egazete-shell");
    if (!shell) return;
    this.isFullscreen = !this.isFullscreen;
    shell.classList.toggle("is-fullscreen", this.isFullscreen);
    const icon = this.root.querySelector("#egazete-fullscreen i");
    if (icon) icon.className = this.isFullscreen ? "fa-solid fa-compress" : "fa-solid fa-expand";
  }

  // --- View Mode ---
  toggleViewMode() {
    if (this.viewMode === "auto") this.viewMode = "single";
    else if (this.viewMode === "single") this.viewMode = "double";
    else this.viewMode = "auto";
    this.updateView();
    const icon = this.root?.querySelector("#egazete-view-toggle i");
    if (icon) {
      if (this.viewMode === "single") icon.className = "fa-solid fa-file";
      else if (this.viewMode === "double") icon.className = "fa-solid fa-book-open";
      else icon.className = "fa-solid fa-columns";
    }
  }

  setTheme(theme) {
    this.currentTheme = theme;
    const shell = this.root?.querySelector(".egazete-shell");
    if (shell) {
      shell.dataset.theme = theme;
      shell.className = shell.className.replace(/egazete-theme-\w+/g, "").trim() + ` egazete-theme-${theme}`;
    }
    this.root?.querySelectorAll(".egazete-theme-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.theme === theme);
    });
  }

  toggleToc(force) {
    if (!this.tocPanel) return;
    const show = force !== undefined ? force : this.tocPanel.hidden;
    this.tocPanel.hidden = !show;
  }

  goToPage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.pages.length) return;
    const dir = pageIndex > this.currentIndex ? "next" : "prev";
    this.currentIndex = pageIndex;
    this.updateView(dir);
  }

  buildToc() {
    if (!this.tocList) return;
    const TYPE_LABELS = { cover: "Kapak / Manşet", summary: "Bugün Öne Çıkanlar", articles: "Haberler", sources: "Kaynaklar & Notlar" };
    const TYPE_ICONS = { cover: "fa-newspaper", summary: "fa-star", articles: "fa-file-lines", sources: "fa-link" };
    this.tocList.innerHTML = this.pages.map((page, i) => {
      let label = TYPE_LABELS[page.type] || "Sayfa";
      const icon = TYPE_ICONS[page.type] || "fa-file";
      if (page.type === "articles" && page.articles?.length) {
        const cats = [...new Set(page.articles.map(a => a.category || "Gündem"))];
        label = cats.join(" / ");
      }
      return `<li><button type="button" class="egazete-toc-item${i === this.currentIndex ? " active" : ""}" data-toc-page="${i}">
        <span class="egazete-toc-num">${i + 1}</span>
        <i class="fa-solid ${icon} egazete-toc-icon"></i>
        <span class="egazete-toc-label">${escapeHtml(label)}</span>
      </button></li>`;
    }).join("");
  }

  updateReadingProgress() {
    const total = this.pages.length;
    const current = this.currentIndex + 1;
    const pct = Math.round((current / Math.max(1, total)) * 100);
    if (this.rpLabel) this.rpLabel.textContent = `Sayfa ${current} / ${total}`;
    if (this.rpFill) this.rpFill.style.width = `${pct}%`;
    if (this.rpPct) this.rpPct.textContent = `${pct}%`;
  }

  open() {
    this.ensureDom();
    this.pages = this.buildPages();
    this.currentIndex = 0;
    this.zoomLevel = 1;
    this.applyZoom();
    this.renderPrintSource();
    this.buildToc();
    this.updateView();
    this.setTheme(this.currentTheme || "cream");
    this.root.hidden = false;
    document.body.classList.add("modal-open", "egazete-open");
    this.isOpen = true;
    document.addEventListener("keydown", this.boundKeydown);
    requestAnimationFrame(() => this.root.querySelector(".egazete-shell")?.focus());
  }

  close() {
    if (!this.root) return;
    this.root.hidden = true;
    document.body.classList.remove("egazete-open", "egazete-printing");
    if (!document.querySelector(".reader-open")) document.body.classList.remove("modal-open");
    this.isOpen = false;
    this.isFullscreen = false;
    const shell = this.root.querySelector(".egazete-shell");
    if (shell) shell.classList.remove("is-fullscreen");
    document.removeEventListener("keydown", this.boundKeydown);
  }

  handleKeydown(event) {
    if (!this.isOpen) return;
    if (event.key === "Escape") this.close();
    if (event.key === "ArrowRight") this.next();
    if (event.key === "ArrowLeft") this.prev();
    if (event.key === "+" || event.key === "=") this.zoomIn();
    if (event.key === "-") this.zoomOut();
    if (event.key === "f" || event.key === "F") this.toggleFullscreen();
  }

  onTouchStart(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  }

  onTouchEnd(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? this.next() : this.prev();
  }

  spreadSize() {
    if (this.viewMode === "single") return 1;
    if (this.viewMode === "double") return 2;
    return window.matchMedia("(max-width: 900px)").matches ? 1 : 2;
  }

  next() {
    if (this.isFlipping) return;
    const step = this.spreadSize();
    const maxIndex = Math.max(0, this.pages.length - step);
    if (this.currentIndex >= maxIndex) return;
    this.currentIndex = Math.min(maxIndex, this.currentIndex + step);
    this.flipPage("next");
  }

  prev() {
    if (this.isFlipping) return;
    const step = this.spreadSize();
    if (this.currentIndex === 0) return;
    this.currentIndex = Math.max(0, this.currentIndex - step);
    this.flipPage("prev");
  }

  flipPage(direction) {
    this.isFlipping = true;
    const book = this.reader;
    if (!book) { this.isFlipping = false; return; }

    book.classList.add("flip-active", direction === "next" ? "flip-next" : "flip-prev");

    const flipOverlay = document.createElement("div");
    flipOverlay.className = `egazete-flip-overlay flip-${direction}`;
    book.appendChild(flipOverlay);

    requestAnimationFrame(() => {
      flipOverlay.classList.add("flipping");
    });

    setTimeout(() => {
      flipOverlay.remove();
      book.classList.remove("flip-active", "flip-next", "flip-prev");
      this.renderPages();
      this.updateControls();
      this.isFlipping = false;
    }, 500);
  }

  renderPages() {
    const step = this.spreadSize();
    const visible = this.pages.slice(this.currentIndex, this.currentIndex + step);
    const isSingle = step === 1;

    this.reader.innerHTML = visible.map((page, offset) => {
      const pageIndex = this.currentIndex + offset;
      const side = isSingle ? "single" : (offset === 0 ? "left" : "right");
      return this.renderPage(page, pageIndex, side);
    }).join("");

    if (this.spine) {
      this.spine.style.display = isSingle ? "none" : "";
    }
  }

  updateControls() {
    const step = this.spreadSize();
    const lastIndex = Math.max(0, this.pages.length - step);
    if (this.prevBtn) this.prevBtn.disabled = this.currentIndex === 0;
    if (this.nextBtn) this.nextBtn.disabled = this.currentIndex >= lastIndex;
    const currentPage = Math.min(this.pages.length, this.currentIndex + 1);
    if (this.counter) this.counter.textContent = `${currentPage}-${Math.min(this.pages.length, this.currentIndex + step)} / ${this.pages.length}`;
    if (this.progressFill) this.progressFill.style.width = `${Math.min(100, ((this.currentIndex + step) / Math.max(1, this.pages.length)) * 100)}%`;
    this.updateReadingProgress();
    this.buildToc();
  }

  updateView(direction = "") {
    if (direction && !this.isFlipping) {
      this.flipPage(direction);
    } else {
      this.renderPages();
      this.updateControls();
    }
  }

  articleSummary(article) {
    return clampText(article.aiSummary || article.summary || article.description || article.fullText || article.content || article.title || "", 520);
  }

  articleDate(article) {
    if (article.date) return article.date;
    if (article.publishedAt) return formatTurkishDate(new Date(article.publishedAt));
    return formatTurkishDate();
  }

  buildPages() {
    const profile = this.getProfile() || {};
    const articles = this.getArticles().slice(0, 18);
    const fallbackArticles = articles.length ? articles : [{
      title: "Bugünün kişisel gündemi hazırlanıyor",
      category: "Gündem", source: "SmartNewspaper",
      summary: "Henüz güçlü bir kişisel eşleşme yok. Haber okudukça ve ilgi alanlarını güncelledikçe bu gazete daha iyi kişiselleşir.",
      _personalizedReason: "Fallback kişisel akış olarak gösterildi."
    }];
    const main = fallbackArticles[0];
    const pages = [];
    pages.push({ type: "cover", profile, article: main, articles: fallbackArticles });
    pages.push({ type: "summary", profile, articles: fallbackArticles.slice(0, 6) });

    const categories = [...new Set(fallbackArticles.map(a => a.category || "Gündem"))];
    const grouped = {};
    for (const a of fallbackArticles) {
      const cat = a.category || "Gündem";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(a);
    }

    for (const cat of categories) {
      const catArticles = grouped[cat] || [];
      for (const group of chunk(catArticles, 2)) {
        pages.push({ type: "articles", profile, articles: group, category: cat });
      }
    }

    pages.push({ type: "sources", profile, articles: fallbackArticles });
    return pages;
  }

  renderPage(page, index, side = "left") {
    if (page.type === "cover") return this.renderCoverPage(page, index, side);
    if (page.type === "summary") return this.renderSummaryPage(page, index, side);
    if (page.type === "sources") return this.renderSourcesPage(page, index, side);
    return this.renderArticlesPage(page, index, side);
  }

  pageShell(inner, index, side = "left", extra = "") {
    const profile = this.getProfile() || {};
    const sideClass = side === "single" ? "is-single" : (side === "left" ? "is-left" : "is-right");
    return `
      <article class="egazete-page ${sideClass} ${extra}" data-page-index="${index + 1}">
        <div class="egazete-page-texture"></div>
        <div class="egazete-page-curl"></div>
        <div class="egazete-page-head">
          <span class="egazete-page-head-date">${escapeHtml(formatTurkishDate())}</span>
          <strong class="egazete-page-head-title">Smart Newspaper</strong>
          <span class="egazete-page-head-num">Sayfa ${index + 1}</span>
        </div>
        <div class="egazete-page-content">${inner}</div>
        <footer class="egazete-page-foot">
          <span>${escapeHtml(this.watermarkText(profile))}</span>
          <span class="egazete-page-foot-num">${index + 1}</span>
        </footer>
      </article>
    `;
  }

  renderCoverPage(page, index, side) {
    const profile = page.profile || {};
    const article = page.article || {};
    const articles = (page.articles || []).slice(1, 5);
    const name = profile.name || "Okuyucu";
    const imgUrl = article.imageUrl || article.image || article.urlToImage || "";
    const img = imgUrl
      ? `<img class="egazete-cover-hero-img" src="${escapeHtml(imgUrl)}" alt="" loading="lazy">`
      : `<div class="egazete-cover-hero-placeholder"><i class="fa-solid fa-newspaper"></i><span>GÜNDEM</span></div>`;
    const category = article.category || "Gündem";
    const source = article.source || "Kişisel seçki";
    const date = escapeHtml(formatTurkishDate());

    let weatherHtml = "";
    try {
      const raw = localStorage.getItem("smart_newspaper_weather");
      if (raw) {
        const w = JSON.parse(raw);
        const icons = { Clear: "fa-sun", Clouds: "fa-cloud", Rain: "fa-cloud-rain", Snow: "fa-snowflake", Thunderstorm: "fa-cloud-bolt", Mist: "fa-smog" };
        weatherHtml = `<div class="egazete-cover-weather"><i class="fa-solid ${icons[w.main] || "fa-cloud-sun"}"></i> ${escapeHtml(w.city || "İstanbul")} · ${w.temp || 0}°C</div>`;
      }
    } catch {}

    const sideItems = articles.map((a, i) => `
      <div class="egazete-cover-side-item">
        <span class="egazete-cover-side-num">${String(i + 2).padStart(2, "0")}</span>
        <div>
          <div class="egazete-cover-side-cat">${escapeHtml(a.category || "Gündem")}</div>
          <div class="egazete-cover-side-headline">${escapeHtml(a.title || "")}</div>
        </div>
      </div>
    `).join("");

    return this.pageShell(`
      <div class="egazete-cover-wrap">
        <div class="egazete-cover-nameplate">
          <div class="egazete-cover-nameplate-rule egazete-cover-nameplate-rule--double"></div>
          <h1 class="egazete-cover-nameplate-title">${escapeHtml(profile.paperName || "Smart Newspaper")}</h1>
          <div class="egazete-cover-nameplate-rule"></div>
          <div class="egazete-cover-nameplate-meta">
            <span>${date}</span>
            <span class="egazete-cover-diamond">&#9670;</span>
            <span>Sayın ${escapeHtml(name)} için hazırlandı</span>
            <span class="egazete-cover-diamond">&#9670;</span>
            <span>AI Destekli Kişisel Baskı</span>
          </div>
          ${weatherHtml}
          <div class="egazete-cover-nameplate-rule egazete-cover-nameplate-rule--thick"></div>
        </div>

        <div class="egazete-cover-body">
          <div class="egazete-cover-main">
            <div class="egazete-cover-main-cat">${escapeHtml(category)} &mdash; ${escapeHtml(source)}</div>
            <h2 class="egazete-cover-main-headline">${escapeHtml(article.title || "Bugünün kişisel gündemi")}</h2>
            <div class="egazete-cover-hero">${img}</div>
            <p class="egazete-cover-main-body">${escapeHtml(this.articleSummary(article))}</p>
          </div>
          ${sideItems.length ? `
          <aside class="egazete-cover-sidebar">
            <div class="egazete-cover-sidebar-title"><i class="fa-solid fa-list"></i> Bu Sayıda</div>
            ${sideItems}
          </aside>` : ""}
        </div>
      </div>
    `, index, side, "is-cover");
  }

  renderSummaryPage(page, index, side) {
    const articles = page.articles || [];
    return this.pageShell(`
      <div class="egazete-inner-page">
        <div class="egazete-section-header">
          <span class="egazete-section-label"><i class="fa-solid fa-star"></i> Editörün Seçimi</span>
          <h2 class="egazete-section-title">Bugün Öne Çıkan Başlıklar</h2>
          <div class="egazete-section-rule"></div>
        </div>
        <div class="egazete-summary-grid">
          ${articles.map((article, idx) => {
            const similars = this.getSimilarArticles(article);
            const multiSourceHtml = similars.length >= 2 ? `
              <div class="egazete-multi-source-badge">
                <i class="fa-solid fa-layer-group"></i> ${similars.length + 1} kaynakta doğrulandı
              </div>` : "";
            return `
            <div class="egazete-summary-card">
              <div class="egazete-summary-card-num">${String(idx + 1).padStart(2, "0")}</div>
              <div class="egazete-summary-card-content">
                <div class="egazete-summary-card-cat">${escapeHtml(article.category || "Gündem")} &bull; ${escapeHtml(article.source || "")}</div>
                <h3 class="egazete-summary-card-headline">${escapeHtml(article.title || "Başlıksız haber")}</h3>
                <p class="egazete-summary-card-reason">${escapeHtml(article._personalizedReason || "Kişisel ilgi sinyallerine göre seçildi.")}</p>
                ${multiSourceHtml}
              </div>
            </div>
          `}).join("")}
        </div>
      </div>
    `, index, side);
  }

  renderArticlesPage(page, index, side) {
    const articles = page.articles || [];
    const cat = page.category || (articles[0]?.category || "Haberler");
    return this.pageShell(`
      <div class="egazete-inner-page">
        <div class="egazete-section-header egazete-section-header--compact">
          <span class="egazete-section-label" style="--cat-clr:${catColor(cat)}">${escapeHtml(cat)}</span>
          <div class="egazete-section-rule"></div>
        </div>
        ${articles.map((article, idx) => {
          const imgUrl = article.imageUrl || article.image || article.urlToImage || "";
          const imgHtml = imgUrl
            ? `<img class="egazete-article-img" src="${escapeHtml(imgUrl)}" alt="" loading="lazy">`
            : "";
          const summary = escapeHtml(this.articleSummary(article));
          const isFirst = idx === 0;
          const similars = this.getSimilarArticles(article);
          const sourceStripHtml = similars.length >= 1 ? `
            <div class="egazete-source-strip">
              <span class="egazete-source-strip-label"><i class="fa-solid fa-layer-group"></i> ${similars.length + 1} kaynakta geçti</span>
              <div class="egazete-source-strip-logos">
                ${similars.slice(0, 4).map(s => {
                  const sa = s.article || s;
                  return `<button type="button" class="egazete-source-chip" data-egazete-source-id="${escapeHtml(String(sa.id || ""))}" data-egazete-source="${escapeHtml(sa.sourceUrl || sa.url || "")}" title="${escapeHtml(sa.source || sa.sourceName || "")}">
                    <i class="fa-solid fa-newspaper"></i> ${escapeHtml((sa.source || sa.sourceName || "Kaynak").slice(0, 15))}
                  </button>`;
                }).join("")}
              </div>
            </div>` : "";

          return `
          <div class="egazete-article-block ${isFirst ? "is-lead" : "is-secondary"}">
            <div class="egazete-article-meta">
              <span class="egazete-article-cat" style="color:${catColor(article.category || "Gündem")}">${escapeHtml(article.category || "Gündem")}</span>
              <span class="egazete-article-source">${escapeHtml(article.source || "")}</span>
              <span class="egazete-article-date">${escapeHtml(this.articleDate(article))}</span>
            </div>
            <h2 class="egazete-article-headline">${escapeHtml(article.title || "Başlıksız haber")}</h2>
            <div class="egazete-article-divider"></div>
            ${imgHtml ? `<div class="egazete-article-img-wrap">${imgHtml}</div>` : ""}
            <div class="egazete-article-body">
              <p>${summary}</p>
            </div>
            ${article._personalizedReason ? `<div class="egazete-personalized-note"><i class="fa-solid fa-sparkles"></i> ${escapeHtml(article._personalizedReason)}</div>` : ""}
            ${sourceStripHtml}
          </div>
          ${idx < articles.length - 1 ? `<div class="egazete-article-separator"></div>` : ""}
          `;
        }).join("")}
      </div>
    `, index, side);
  }

  renderSourcesPage(page, index, side) {
    const articles = page.articles || [];
    const sources = [...new Set(articles.map((article) => article.source).filter(Boolean))];
    const profile = this.getProfile() || {};
    const categories = [...new Set(articles.map(a => a.category || "Gündem"))];
    return this.pageShell(`
      <div class="egazete-inner-page egazete-sources-page">
        <div class="egazete-section-header">
          <span class="egazete-section-label"><i class="fa-solid fa-link"></i> Kaynaklar</span>
          <h2 class="egazete-section-title">Bu Baskıda Kullanılan Kaynaklar</h2>
          <div class="egazete-section-rule"></div>
        </div>
        <div class="egazete-sources-grid">
          ${sources.map((src, i) => `
            <div class="egazete-source-item">
              <span class="egazete-source-num">${String(i + 1).padStart(2, "0")}</span>
              <i class="fa-solid fa-newspaper egazete-source-icon"></i>
              <span class="egazete-source-name">${escapeHtml(src)}</span>
            </div>
          `).join("")}
        </div>
        <div class="egazete-personalization-summary">
          <h3><i class="fa-solid fa-sparkles"></i> Kişiselleştirme Notu</h3>
          <p>Bu gazete <strong>${escapeHtml(profile.name || "okuyucu")}</strong> için yapay zeka tarafından özel olarak derlenmiştir.</p>
          <p>İlgi alanlarınıza göre düzenlendi: ${categories.map(c => `<span class="egazete-inline-chip">${escapeHtml(c)}</span>`).join(" ")}</p>
        </div>
        <div class="egazete-sources-note">
          <h3>Okuma Notu</h3>
          <p>AI özetleri kaynak haberin başlığı, açıklaması ve mevcut içerik alanları üzerinden hazırlanır. Kaynakta olmayan bilgi gerçek gibi sunulmaz; veri eksik olduğunda güvenli fallback özet kullanılır.</p>
        </div>
        <div class="egazete-sources-footer-bar">
          <span>${escapeHtml(profile.paperName || "Smart Newspaper")}</span>
          <span>${escapeHtml(formatTurkishDate())}</span>
          <span>AI Destekli Kişisel Baskı</span>
        </div>
      </div>
    `, index, side);
  }

  // =================== DASHBOARD ===================
  renderDashboard(container) {
    const articles = this.getArticles().slice(0, 18);
    const profile = this.getProfile() || {};
    const name = profile.name || "Okuyucu";
    const totalArticles = articles.length;
    this.pages = this.buildPages();
    const totalPages = this.pages.length;
    const readTime = getReadingTime(articles);
    const categories = [...new Set(articles.map(a => a.category || "Gündem").filter(Boolean))].slice(0, 8);
    const mainArticle = articles[0];
    const greeting = getGreeting();

    let weatherHtml = "";
    try {
      const raw = localStorage.getItem("smart_newspaper_weather");
      if (raw) {
        const w = JSON.parse(raw);
        const icons = { Clear: "fa-sun", Clouds: "fa-cloud", Rain: "fa-cloud-rain", Snow: "fa-snowflake", Thunderstorm: "fa-cloud-bolt", Mist: "fa-smog", Fog: "fa-smog", Haze: "fa-smog" };
        const labels = { Clear: "Güneşli", Clouds: "Bulutlu", Rain: "Yağmurlu", Snow: "Karlı", Thunderstorm: "Fırtınalı", Mist: "Sisli" };
        const minMax = (w.tempMin != null && w.tempMax != null) ? ` · ${w.tempMin}° / ${w.tempMax}°` : "";
        weatherHtml = `
          <div class="egd-weather-card">
            <div class="egd-weather-icon"><i class="fa-solid ${icons[w.main] || "fa-cloud-sun"}"></i></div>
            <div class="egd-weather-info">
              <span class="egd-weather-city">${escapeHtml(w.city || "İstanbul")}</span>
              <span class="egd-weather-temp">${w.temp || 0}°C · ${escapeHtml(labels[w.main] || w.main || "")}</span>
              <span class="egd-weather-detail">${minMax}</span>
            </div>
          </div>`;
      }
    } catch {}

    const aiPicks = articles.filter(a => a._personalizedReason || a.interestScore >= 70).slice(0, 4);
    const multiSourceArticles = articles.filter(a => {
      const sims = this.getSimilarArticles(a);
      return sims.length >= 2;
    }).slice(0, 3);

    const heroImg = mainArticle?.imageUrl || mainArticle?.image || mainArticle?.urlToImage || "";

    container.innerHTML = `
      <div class="egd-dashboard">
        <!-- Cover Card -->
        <div class="egd-cover-card">
          <div class="egd-cover-bg" ${heroImg ? `style="background-image:url('${escapeHtml(heroImg)}')"` : ""}></div>
          <div class="egd-cover-overlay"></div>
          <div class="egd-cover-content">
            <div class="egd-cover-badge">AI Destekli Kişisel Baskı</div>
            <h1 class="egd-cover-newspaper-title">${escapeHtml(profile.paperName || "Smart Newspaper")}</h1>
            <div class="egd-cover-date">${escapeHtml(formatTurkishDateFull())}</div>
            <div class="egd-cover-for">Sayın <strong>${escapeHtml(name)}</strong> için hazırlandı</div>
            ${weatherHtml}
          </div>
        </div>

        <!-- Stats Bar -->
        <div class="egd-stats-bar">
          <div class="egd-stat-item">
            <i class="fa-solid fa-newspaper"></i>
            <div><strong>${totalArticles}</strong><span>Haber</span></div>
          </div>
          <div class="egd-stat-item">
            <i class="fa-solid fa-file-lines"></i>
            <div><strong>${totalPages}</strong><span>Sayfa</span></div>
          </div>
          <div class="egd-stat-item">
            <i class="fa-solid fa-clock"></i>
            <div><strong>~${readTime} dk</strong><span>Okuma</span></div>
          </div>
          <div class="egd-stat-item">
            <i class="fa-solid fa-layer-group"></i>
            <div><strong>${categories.length}</strong><span>Kategori</span></div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="egd-actions-row">
          <button type="button" class="egd-primary-btn" id="egd-open-reader">
            <i class="fa-solid fa-book-open"></i> Gazeteyi Aç
          </button>
          <button type="button" class="egd-secondary-btn" id="egd-download-pdf">
            <i class="fa-solid fa-download"></i> PDF Olarak İndir
          </button>
        </div>

        <!-- Categories -->
        <div class="egd-categories">
          ${categories.map(c => `<span class="egd-cat-chip" style="--cat-clr:${catColor(c)}">${escapeHtml(c)}</span>`).join("")}
        </div>

        <!-- Headline Card -->
        ${mainArticle ? `
        <div class="egd-headline-card">
          <div class="egd-headline-kicker"><i class="fa-solid fa-bolt"></i> Bugünün Manşeti</div>
          ${heroImg ? `<div class="egd-headline-img"><img src="${escapeHtml(heroImg)}" alt="" loading="lazy"></div>` : ""}
          <h2 class="egd-headline-title">${escapeHtml(mainArticle.title || "")}</h2>
          <p class="egd-headline-summary">${escapeHtml(clampText(mainArticle.summary || mainArticle.description || "", 250))}</p>
          <div class="egd-headline-meta">
            <span><i class="fa-solid fa-newspaper"></i> ${escapeHtml(mainArticle.source || "")}</span>
            <span style="color:${catColor(mainArticle.category || "Gündem")}">${escapeHtml(mainArticle.category || "Gündem")}</span>
          </div>
        </div>` : ""}

        <!-- AI Picks -->
        ${aiPicks.length ? `
        <div class="egd-section">
          <h3 class="egd-section-title"><i class="fa-solid fa-sparkles"></i> AI'ın Seçtiği Öne Çıkan Haberler</h3>
          <div class="egd-picks-grid">
            ${aiPicks.map(a => `
              <div class="egd-pick-card" data-action="detail" data-id="${escapeHtml(String(a.id || ""))}">
                <span class="egd-pick-cat" style="--cat-clr:${catColor(a.category || "Gündem")}">${escapeHtml(a.category || "Gündem")}</span>
                <h4>${escapeHtml(a.title || "")}</h4>
                <div class="egd-pick-footer">
                  <span>${escapeHtml(a.source || "")}</span>
                  ${a._personalizedReason ? `<span class="egd-pick-reason"><i class="fa-solid fa-sparkles"></i> ${escapeHtml(clampText(a._personalizedReason, 60))}</span>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </div>` : ""}

        <!-- Multi Source Verified -->
        ${multiSourceArticles.length ? `
        <div class="egd-section">
          <h3 class="egd-section-title"><i class="fa-solid fa-shield-check"></i> En Çok Kaynakta Doğrulanan Haberler</h3>
          <div class="egd-verified-list">
            ${multiSourceArticles.map(a => {
              const sims = this.getSimilarArticles(a);
              const srcNames = sims.slice(0, 4).map(s => (s.article || s).source || (s.article || s).sourceName || "").filter(Boolean);
              return `<div class="egd-verified-item" data-action="detail" data-id="${escapeHtml(String(a.id || ""))}">
                <div class="egd-verified-count"><strong>${sims.length + 1}</strong><span>kaynak</span></div>
                <div class="egd-verified-content">
                  <strong>${escapeHtml(a.title || "")}</strong>
                  <div class="egd-verified-sources">${srcNames.map(s => `<span>${escapeHtml(s)}</span>`).join("")}</div>
                </div>
              </div>`;
            }).join("")}
          </div>
        </div>` : ""}

        <!-- Table of Contents -->
        <div class="egd-section">
          <h3 class="egd-section-title"><i class="fa-solid fa-list-ol"></i> İçindekiler</h3>
          <div class="egd-toc-list">
            ${this.pages.map((p, i) => {
              const TYPE_LABELS = { cover: "Kapak / Manşet", summary: "Bugün Öne Çıkanlar", sources: "Kaynaklar & Notlar" };
              const TYPE_ICONS = { cover: "fa-newspaper", summary: "fa-star", articles: "fa-file-lines", sources: "fa-link" };
              const label = TYPE_LABELS[p.type] || ((p.articles || []).map(a => a.category || "").filter(Boolean)[0] || "Haberler");
              const icon = TYPE_ICONS[p.type] || "fa-file-lines";
              return `<div class="egd-toc-item" data-toc-go="${i}">
                <span class="egd-toc-page"><i class="fa-solid ${icon}"></i> Sayfa ${i + 1}</span>
                <span>${escapeHtml(label)}</span>
              </div>`;
            }).join("")}
          </div>
        </div>
      </div>
    `;

    container.querySelector("#egd-open-reader")?.addEventListener("click", () => this.open());
    container.querySelector("#egd-download-pdf")?.addEventListener("click", () => {
      this.open();
      setTimeout(() => this.printPdf(), 500);
    });
    container.querySelectorAll("[data-action='detail']").forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => this.onArticleAction("detail", el.dataset.id));
    });
    container.querySelectorAll("[data-toc-go]").forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.tocGo, 10);
        this.open();
        setTimeout(() => this.goToPage(idx), 100);
      });
    });
  }

  watermarkText(profile = {}) {
    const name = profile.name || "okuyucu";
    return `Bu gazete ${name} için yapay zeka tarafından özel olarak derlenmiştir.`;
  }

  renderPrintSource() {
    if (!this.printSource) return;
    this.printSource.innerHTML = this.pages.map((page, index) => this.renderPage(page, index, "single")).join("");
  }

  // =================== PDF ===================
  _pdfCoverPage(page, idx, paperName, name, todayStr) {
    const mainArt = page.article || {};
    const sideArt1 = (page.articles && page.articles[1]) ? page.articles[1] : {};
    const sideArt2 = (page.articles && page.articles[2]) ? page.articles[2] : {};

    const img1 = mainArt.imageUrl || mainArt.image || mainArt.urlToImage || "";
    const img2 = sideArt2.imageUrl || sideArt2.image || sideArt2.urlToImage || "";

    const imgHtml1 = img1
      ? `<img class="top-img" src="${escapeHtml(img1)}" alt="">`
      : `<div class="top-img" style="background:#cc1011;display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:bold;">GÖRSEL</div>`;
    const imgHtml2 = img2
      ? `<img class="bottom-img" src="${escapeHtml(img2)}" alt="">`
      : `<div class="bottom-img" style="background:#0b1e40;display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:bold;">GÖRSEL</div>`;

    const fillText = (text, min) => {
      let res = stripHtml(text || "Haber metni hazırlanıyor...");
      const filler = " Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse aliquet dapibus tempor. Donec non congue mauris. Curabitur elementum, velit id elementum porta, dui tortor euismod diam, eu pulvinar nulla eros sed enim.";
      while(res.length < min) res += filler;
      return res;
    };

    return `
<div class="page custom-cover">
  <div class="custom-header">
    <div class="header-kicker-wrap">
      <div class="kicker-line"></div>
      <div class="kicker-box">${escapeHtml(mainArt.category || "GÜNDEM")}</div>
      <div class="kicker-line"></div>
    </div>
    <h1 class="header-title">${escapeHtml(paperName.toUpperCase())}</h1>
    <div class="header-meta">
      <div class="meta-item left">${escapeHtml(todayStr)}</div>
      <div class="meta-item center">AI Destekli Kişisel Baskı</div>
      <div class="meta-item right">Sayın ${escapeHtml(name)} | Bölüm 1</div>
    </div>
  </div>
  <div class="custom-body">
    <div class="top-section">
      <div class="top-left">
        <h2 class="main-headline">${escapeHtml(mainArt.title || "Bugünün Kişisel Gündemi")}</h2>
        <div class="byline">Yazar: AI Editör</div>
        <div class="text-2-col">${escapeHtml(fillText(mainArt.content || mainArt.summary, 1300))}</div>
      </div>
      <div class="top-right">
        <div class="top-right-wrap">
          ${imgHtml1}
          <div class="red-box-overlap">
            ${escapeHtml(clampText(mainArt.summary || mainArt.description || "", 150))}
          </div>
        </div>
      </div>
    </div>
    <div class="bottom-section">
      <div class="bottom-left">
        <h2 class="sub-headline">${escapeHtml(sideArt1.title || "")}</h2>
        <div class="byline">Yazar: AI Yazar</div>
        <div class="text-2-col">${escapeHtml(fillText(sideArt1.content || sideArt1.summary, 1200))}</div>
      </div>
      <div class="bottom-right">
        <div class="blue-box">
          <h3>${escapeHtml(sideArt2.title || "")}</h3>
          <p>${escapeHtml(stripHtml(sideArt2.summary || ""))}</p>
        </div>
        ${imgHtml2}
        <div class="red-box-bottom">
          ${escapeHtml(clampText(sideArt2.description || sideArt2.summary || "", 100))}
        </div>
      </div>
    </div>
  </div>
</div>`;
  }

  _pdfSummaryPage(page, idx, paperName, todayStr) {
    const profile = this.getProfile() || {};
    const name = profile.name || "Okuyucu";
    const articles = page.articles || [];
    let cards = "";
    articles.forEach((article, i) => {
      cards += `
    <div class="summary-card">
      <div class="card-num">${String(i + 1).padStart(2, "0")}</div>
      <div class="card-cat">${escapeHtml(article.category || "Gündem")} · ${escapeHtml(article.source || "")}</div>
      <h3 class="card-title">${escapeHtml(article.title || "")}</h3>
      <p class="card-reason">${escapeHtml(article._personalizedReason || "")}</p>
    </div>`;
    });

    return `
<div class="page">
  <header class="page-header">
    <span>${escapeHtml(todayStr)}</span>
    <strong>${escapeHtml(paperName)}</strong>
    <span>Sayfa ${idx + 1}</span>
  </header>
  <div class="section-head">
    <span class="section-eyebrow">Editörün Seçimi</span>
    <h2 class="section-title">Bugün Öne Çıkan Başlıklar</h2>
    <div class="section-rule"></div>
  </div>
  <div class="summary-grid">${cards}</div>
  <footer class="page-footer">
    <span>Bu gazete ${escapeHtml(name)} için yapay zeka tarafından özel olarak derlenmiştir.</span>
    <span>${idx + 1}</span>
  </footer>
</div>`;
  }

  _pdfArticlesPage(page, idx, paperName, todayStr) {
    const profile = this.getProfile() || {};
    const name = profile.name || "Okuyucu";
    const articles = page.articles || [];
    let blocks = "";

    articles.forEach((article, i) => {
      const isLead = i === 0;
      const blockClass = isLead ? "article-lead" : "article-secondary";
      const imgUrl = article.imageUrl || article.image || article.urlToImage || "";
      const imgHtml = imgUrl
        ? `<div class="article-img-wrap"><img class="article-img" src="${escapeHtml(imgUrl)}" alt=""></div>`
        : "";

      blocks += `
  <div class="article-block ${blockClass}">
    <div class="article-meta">
      <span class="meta-cat">${escapeHtml(article.category || "Gündem")}</span>
      <span class="meta-src">${escapeHtml(article.source || "")}</span>
      <span class="meta-date">${escapeHtml(this.articleDate(article))}</span>
    </div>
    <h2 class="article-headline">${escapeHtml(article.title || "")}</h2>
    <div class="article-rule"></div>
    ${imgHtml}
    <div class="article-text"><p>${escapeHtml(this.articleSummary(article))}</p></div>
  </div>`;
      if (i < articles.length - 1) blocks += `\n  <div class="article-divider"></div>\n`;
    });

    return `
<div class="page">
  <header class="page-header">
    <span>${escapeHtml(todayStr)}</span>
    <strong>${escapeHtml(paperName)}</strong>
    <span>Sayfa ${idx + 1}</span>
  </header>
  ${blocks}
  <footer class="page-footer">
    <span>Bu gazete ${escapeHtml(name)} için yapay zeka tarafından özel olarak derlenmiştir.</span>
    <span>${idx + 1}</span>
  </footer>
</div>`;
  }

  _pdfSourcesPage(page, idx, paperName, todayStr) {
    const profile = this.getProfile() || {};
    const name = profile.name || "Okuyucu";
    const articles = page.articles || [];
    const sources = [...new Set(articles.map((a) => a.source).filter(Boolean))];

    let sourceItems = "";
    sources.forEach((src, i) => {
      sourceItems += `
    <div class="source-item">
      <span class="source-num">${String(i + 1).padStart(2, "0")}</span>
      <span class="source-name">${escapeHtml(src)}</span>
    </div>`;
    });

    return `
<div class="page">
  <header class="page-header">
    <span>${escapeHtml(todayStr)}</span>
    <strong>${escapeHtml(paperName)}</strong>
    <span>Sayfa ${idx + 1}</span>
  </header>
  <div class="section-head">
    <span class="section-eyebrow">Kaynaklar</span>
    <h2 class="section-title">Bu Baskıda Kullanılan Kaynaklar</h2>
    <div class="section-rule"></div>
  </div>
  <div class="sources-grid">${sourceItems}</div>
  <div class="sources-note">
    <h3>Okuma Notu</h3>
    <p>AI özetleri kaynak haberin başlığı, açıklaması ve mevcut içerik alanları üzerinden hazırlanır.</p>
    <p>Bu gazete <strong>${escapeHtml(name)}</strong> için yapay zeka tarafından özel olarak derlenmiştir.</p>
  </div>
  <div class="sources-bar">
    <span>${escapeHtml(paperName)}</span>
    <span>${escapeHtml(todayStr)}</span>
    <span>AI Destekli Kişisel Baskı</span>
  </div>
  <footer class="page-footer">
    <span>Bu gazete ${escapeHtml(name)} için yapay zeka tarafından özel olarak derlenmiştir.</span>
    <span>${idx + 1}</span>
  </footer>
</div>`;
  }

  buildPdfHtml() {
    const profile = this.getProfile() || {};
    const paperName = profile.paperName || "Smart Newspaper";
    const name = profile.name || "Okuyucu";
    const todayStr = formatTurkishDate();

    const pagesHtml = this.pages.map((page, idx) => {
      if (page.type === "cover")   return this._pdfCoverPage(page, idx, paperName, name, todayStr);
      if (page.type === "summary") return this._pdfSummaryPage(page, idx, paperName, todayStr);
      if (page.type === "sources") return this._pdfSourcesPage(page, idx, paperName, todayStr);
      return this._pdfArticlesPage(page, idx, paperName, todayStr);
    }).join("\n");

    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(paperName)} — ${todayStr}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #3a3a3a; }
body { font-family: Georgia, "Times New Roman", serif; background: #3a3a3a; padding-top: 60px; }
.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: #12192a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 24px;
  box-shadow: 0 2px 16px rgba(0,0,0,0.5);
}
.topbar-title { font-family: Inter, sans-serif; font-size: 14pt; font-weight: 800; color: #fff; }
.topbar-actions { display: flex; gap: 10px; }
.btn-primary {
  background: #8B1A1A; color: #fff; border: none;
  padding: 9px 20px; border-radius: 7px;
  font-family: Inter, sans-serif; font-size: 11pt; font-weight: 800; cursor: pointer;
}
.btn-primary:hover { background: #a82020; }
.btn-secondary {
  background: transparent; color: #fff;
  border: 1.5px solid rgba(255,255,255,0.25);
  padding: 9px 16px; border-radius: 7px;
  font-family: Inter, sans-serif; font-size: 11pt; font-weight: 700; cursor: pointer;
}
.btn-secondary:hover { background: rgba(255,255,255,0.08); }
.page {
  width: 210mm; height: 297mm; background: #fff;
  margin: 10mm auto; padding: 12mm 15mm 10mm;
  box-shadow: 0 6px 32px rgba(0,0,0,0.4);
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; color: #111;
}
.page-header {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 2.5mm; margin-bottom: 4mm;
  border-bottom: 0.55mm solid #111;
  font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.07em; color: #555; flex-shrink: 0;
}
.page-header strong { font-size: 9pt; font-weight: 900; color: #111; letter-spacing: 0.1em; }
.page-footer {
  position: absolute; left: 15mm; right: 15mm; bottom: 7mm;
  display: flex; justify-content: space-between;
  padding-top: 2mm; border-top: 0.3mm solid #bbb;
  font-family: Inter, sans-serif; font-size: 6.5pt; color: #888;
}
.page-body { flex: 1; overflow: hidden; }
.custom-cover { padding: 8mm 12mm 10mm !important; display: flex; flex-direction: column; }
.custom-header { margin-bottom: 5mm; flex-shrink: 0; }
.header-kicker-wrap { display: flex; align-items: center; justify-content: center; margin-bottom: 2mm; }
.kicker-line { flex: 1; height: 1.5mm; border-top: 0.4mm solid #111; border-bottom: 0.2mm solid #111; margin: 0 4mm; }
.kicker-box { background: #cc1011; color: #fff; font-family: Inter, sans-serif; font-size: 10pt; font-weight: 800; padding: 1.5mm 4mm; text-transform: uppercase; }
.header-title { font-family: "Playfair Display", Georgia, serif; font-size: 38pt; font-weight: 900; color: #0b1e40; text-align: center; line-height: 1; margin-bottom: 2.5mm; text-transform: uppercase; }
.header-meta { display: flex; justify-content: space-between; border-top: 1mm double #111; border-bottom: 1mm double #111; padding: 1.5mm 0; margin-bottom: 4mm; font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 600; color: #333; }
.meta-item { flex: 1; } .meta-item.center { text-align: center; } .meta-item.right { text-align: right; }
.custom-body { display: flex; flex-direction: column; gap: 4mm; flex: 1; overflow: hidden; }
.top-section { display: flex; gap: 4mm; border-bottom: 0.4mm solid #111; padding-bottom: 4mm; flex-shrink: 0; }
.top-left { flex: 5.5; } .top-right { flex: 4.5; }
.main-headline { font-family: "Playfair Display", Georgia, serif; font-size: 21pt; font-weight: 900; color: #0b1e40; line-height: 1.15; margin-bottom: 2.5mm; }
.byline { font-family: Georgia, serif; font-size: 7.5pt; font-style: italic; margin-bottom: 2.5mm; color: #555; }
.text-2-col { column-count: 2; column-gap: 4mm; font-family: Georgia, serif; font-size: 8pt; line-height: 1.45; text-align: justify; color: #111; }
.top-right-wrap { position: relative; height: 100%; min-height: 60mm; }
.top-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.red-box-overlap { position: absolute; bottom: 0; left: 0; width: 68%; background: #cc1011; color: #fff; padding: 2.5mm; font-family: Georgia, serif; font-style: italic; font-size: 7.5pt; line-height: 1.35; }
.bottom-section { display: flex; gap: 4mm; flex: 1; overflow: hidden; }
.bottom-left { flex: 6.5; } .bottom-right { flex: 3.5; display: flex; flex-direction: column; gap: 2.5mm; }
.sub-headline { font-family: "Playfair Display", Georgia, serif; font-size: 17pt; font-weight: 900; color: #0b1e40; line-height: 1.2; margin-bottom: 2.5mm; }
.blue-box { background: #0b1e40; color: #fff; padding: 3mm; }
.blue-box h3 { font-family: "Playfair Display", Georgia, serif; font-size: 11pt; margin-bottom: 1.5mm; line-height: 1.1; }
.blue-box p { font-family: Georgia, serif; font-size: 7pt; line-height: 1.4; text-align: justify; color: #e2e8f0; }
.bottom-img { width: 100%; height: 35mm; object-fit: cover; display: block; flex-shrink: 0; }
.red-box-bottom { background: #cc1011; color: #fff; padding: 2.5mm; font-family: Georgia, serif; font-style: italic; font-size: 7.5pt; line-height: 1.35; flex-shrink: 0; }
.section-head { margin-bottom: 5mm; flex-shrink: 0; }
.section-eyebrow { display: block; font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.13em; color: #8B1A1A; margin-bottom: 1.5mm; }
.section-title { font-family: "Playfair Display", Georgia, serif; font-size: 24pt; font-weight: 900; color: #111; line-height: 1.08; margin-bottom: 2.5mm; }
.section-rule { border: none; border-top: 0.65mm solid #111; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4.5mm 7mm; margin-top: 5mm; overflow: hidden; }
.summary-card { border-left: 1mm solid #8B1A1A; padding-left: 3.5mm; padding-bottom: 3mm; overflow: hidden; }
.card-num { font-family: Inter, sans-serif; font-size: 20pt; font-weight: 900; color: #ebebeb; line-height: 1; margin-bottom: 1mm; }
.card-cat { font-family: Inter, sans-serif; font-size: 6.5pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: #8B1A1A; margin-bottom: 1.5mm; }
.card-title { font-family: Georgia, serif; font-size: 9.5pt; font-weight: 700; line-height: 1.38; color: #111; margin-bottom: 1.5mm; }
.card-reason { font-family: Inter, sans-serif; font-size: 7.5pt; color: #666; line-height: 1.45; }
.article-block { overflow: hidden; } .article-lead { padding-bottom: 4mm; }
.article-divider { border: none; border-top: 0.35mm solid #ccc; margin: 3mm 0; }
.article-meta { display: flex; gap: 5pt; margin-bottom: 2.5mm; font-family: Inter, sans-serif; font-size: 7pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; flex-shrink: 0; }
.meta-cat { color: #8B1A1A; } .meta-src { color: #555; } .meta-src::before { content: "·"; margin-right: 5pt; } .meta-date { color: #999; margin-left: auto; }
.article-headline { font-family: "Playfair Display", Georgia, serif; font-weight: 900; line-height: 1.1; color: #111; margin-bottom: 2mm; }
.article-lead .article-headline { font-size: 22pt; } .article-secondary .article-headline { font-size: 16pt; }
.article-rule { border: none; border-top: 0.55mm solid #111; margin: 2mm 0 3mm; }
.article-img-wrap { float: right; width: 56mm; height: 40mm; margin: 0 0 3mm 5mm; overflow: hidden; background: #e0e0e0; flex-shrink: 0; }
.article-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.article-text { font-size: 9.5pt; line-height: 1.72; color: #222; text-align: justify; }
.article-text::after { content: ""; display: table; clear: both; }
.sources-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 5mm 0 7mm; overflow: hidden; }
.source-item { display: flex; gap: 2.5mm; align-items: baseline; border-bottom: 0.2mm solid #ebebeb; padding-bottom: 2mm; }
.source-num { font-family: Inter, sans-serif; font-size: 8pt; font-weight: 900; color: #8B1A1A; flex-shrink: 0; }
.source-name { font-family: Georgia, serif; font-size: 9pt; font-weight: 700; color: #111; }
.sources-note { border-top: 0.45mm solid #111; padding-top: 4mm; max-width: 120mm; }
.sources-note h3 { font-family: "Playfair Display", Georgia, serif; font-size: 14pt; margin-bottom: 2.5mm; color: #111; }
.sources-note p { font-size: 8.5pt; color: #444; line-height: 1.65; margin-bottom: 2mm; }
.sources-bar { position: absolute; left: 15mm; right: 15mm; bottom: 18mm; display: flex; justify-content: space-between; padding: 2mm 0; border-top: 0.55mm solid #111; border-bottom: 0.55mm solid #111; font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; color: #444; }
@media print {
  *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; padding-top: 0 !important; }
  .topbar { display: none !important; }
  .page { margin: 0 auto !important; box-shadow: none !important; page-break-after: always !important; break-after: page !important; }
}
  </style>
</head>
<body>
  <div class="topbar">
    <span class="topbar-title">${escapeHtml(paperName)}</span>
    <div class="topbar-actions">
      <button class="btn-secondary" onclick="window.close()">Kapat</button>
      <button class="btn-primary" onclick="window.print()">PDF Olarak Kaydet</button>
    </div>
  </div>
  ${pagesHtml}
</body>
</html>`;
  }

  printPdf() {
    this.pages = this.pages.length ? this.pages : this.buildPages();
    const html = this.buildPdfHtml();
    const win = window.open("", "_blank", "width=960,height=800,scrollbars=yes");
    if (!win) {
      alert("Açılır pencere engellendi. Lütfen bu site için açılır pencerelere izin verin ve tekrar deneyin.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}
