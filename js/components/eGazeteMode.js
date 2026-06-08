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

export class EGazeteMode {
  constructor(options = {}) {
    this.getArticles = options.getArticles || (() => []);
    this.getProfile = options.getProfile || (() => ({}));
    this.onArticleAction = options.onArticleAction || (() => {});
    this.root = null;
    this.reader = null;
    this.printSource = null;
    this.pages = [];
    this.currentIndex = 0;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.isOpen = false;
    this.boundKeydown = (event) => this.handleKeydown(event);
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
          <div>
            <p class="egazete-kicker">AI destekli kişisel okuma modu</p>
            <h2 id="egazete-title">Kişisel E-Gazete</h2>
          </div>
          <div class="egazete-toolbar-actions">
            <button type="button" class="egazete-tool-btn" id="egazete-pdf-btn"><i class="fa-solid fa-download"></i> PDF Olarak İndir</button>
            <button type="button" class="egazete-tool-btn is-ghost" data-egazete-close aria-label="E-Gazete modunu kapat"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </header>
        <div class="egazete-reader-wrap">
          <button type="button" class="egazete-nav egazete-prev" id="egazete-prev" aria-label="Önceki sayfa"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="egazete-book" id="egazete-book" aria-live="polite"></div>
          <button type="button" class="egazete-nav egazete-next" id="egazete-next" aria-label="Sonraki sayfa"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <footer class="egazete-footer">
          <span id="egazete-counter">1 / 1</span>
          <div class="egazete-progress"><span id="egazete-progress-fill"></span></div>
          <span>Swipe, ok tuşları veya butonlarla sayfa değiştir</span>
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

    wrapper.addEventListener("click", (event) => {
      if (event.target.closest("[data-egazete-close]")) this.close();
      if (event.target.closest("#egazete-pdf-btn")) this.printPdf();
      const detail = event.target.closest("[data-egazete-detail]");
      if (detail) this.onArticleAction("detail", detail.dataset.egazeteDetail);
      const source = event.target.closest("[data-egazete-source]");
      if (source) window.open(source.dataset.egazeteSource, "_blank", "noopener,noreferrer");
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

  open() {
    this.ensureDom();
    this.pages = this.buildPages();
    this.currentIndex = 0;
    this.renderPrintSource();
    this.updateView();
    this.root.hidden = false;
    document.body.classList.add("modal-open", "egazete-open");
    this.isOpen = true;
    document.addEventListener("keydown", this.boundKeydown);
    requestAnimationFrame(() => this.root.querySelector("#egazete-pdf-btn")?.focus());
  }

  close() {
    if (!this.root) return;
    this.root.hidden = true;
    document.body.classList.remove("egazete-open", "egazete-printing");
    if (!document.querySelector(".reader-open")) document.body.classList.remove("modal-open");
    this.isOpen = false;
    document.removeEventListener("keydown", this.boundKeydown);
  }

  handleKeydown(event) {
    if (!this.isOpen) return;
    if (event.key === "Escape") this.close();
    if (event.key === "ArrowRight") this.next();
    if (event.key === "ArrowLeft") this.prev();
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
    return window.matchMedia("(max-width: 820px)").matches ? 1 : 2;
  }

  next() {
    const step = this.spreadSize();
    this.currentIndex = Math.min(Math.max(0, this.pages.length - step), this.currentIndex + step);
    this.updateView("next");
  }

  prev() {
    const step = this.spreadSize();
    this.currentIndex = Math.max(0, this.currentIndex - step);
    this.updateView("prev");
  }

  updateView(direction = "") {
    const step = this.spreadSize();
    const visible = this.pages.slice(this.currentIndex, this.currentIndex + step);
    this.reader.classList.remove("turn-next", "turn-prev");
    if (direction) this.reader.classList.add(direction === "next" ? "turn-next" : "turn-prev");
    this.reader.innerHTML = visible.map((page, offset) => this.renderPage(page, this.currentIndex + offset)).join("");
    const lastIndex = Math.max(0, this.pages.length - step);
    this.prevBtn.disabled = this.currentIndex === 0;
    this.nextBtn.disabled = this.currentIndex >= lastIndex;
    const currentPage = Math.min(this.pages.length, this.currentIndex + 1);
    if (this.counter) this.counter.textContent = `${currentPage}-${Math.min(this.pages.length, this.currentIndex + step)} / ${this.pages.length}`;
    if (this.progressFill) this.progressFill.style.width = `${Math.min(100, ((this.currentIndex + step) / Math.max(1, this.pages.length)) * 100)}%`;
    window.setTimeout(() => this.reader.classList.remove("turn-next", "turn-prev"), 260);
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
    const fallbackArticles = articles.length ? articles : [{ title: "Bugünün kişisel gündemi hazırlanıyor", category: "Gündem", source: "SmartNewspaper", summary: "Henüz güçlü bir kişisel eşleşme yok. Haber okudukça ve ilgi alanlarını güncelledikçe bu gazete daha iyi kişiselleşir.", _personalizedReason: "Fallback kişisel akış olarak gösterildi." }];
    const main = fallbackArticles[0];
    const pages = [];
    pages.push({ type: "cover", profile, article: main, articles: fallbackArticles });
    pages.push({ type: "summary", profile, articles: fallbackArticles.slice(0, 6) });
    for (const group of chunk(fallbackArticles.slice(0, 12), 2)) {
      pages.push({ type: "articles", profile, articles: group });
    }
    pages.push({ type: "sources", profile, articles: fallbackArticles });
    return pages;
  }

  renderPage(page, index) {
    if (page.type === "cover") return this.renderCoverPage(page, index);
    if (page.type === "summary") return this.renderSummaryPage(page, index);
    if (page.type === "sources") return this.renderSourcesPage(page, index);
    return this.renderArticlesPage(page, index);
  }

  pageShell(inner, index, extra = "") {
    const profile = this.getProfile() || {};
    return `
      <article class="egazete-page ${extra}" data-page-index="${index + 1}">
        <div class="egazete-page-head">
          <span class="egazete-page-head-date">${escapeHtml(formatTurkishDate())}</span>
          <strong class="egazete-page-head-title">${escapeHtml(profile.paperName || "Kişisel E-Gazete")}</strong>
          <span class="egazete-page-head-num">Sayfa ${index + 1}</span>
        </div>
        <div class="egazete-page-content">${inner}</div>
        <footer class="egazete-page-foot">
          <span>${escapeHtml(this.watermarkText(profile))}</span>
          <span>${index + 1}</span>
        </footer>
      </article>
    `;
  }

  renderCoverPage(page, index) {
    const profile = page.profile || {};
    const article = page.article || {};
    const articles = (page.articles || []).slice(1, 5);
    const name = profile.name || "Okuyucu";
    const imgUrl = article.imageUrl || article.image || article.urlToImage || "";
    const img = imgUrl
      ? `<img class="egazete-cover-hero-img" src="${escapeHtml(imgUrl)}" alt="">`
      : `<div class="egazete-cover-hero-placeholder"><span>GÜNDEM</span></div>`;
    const category = article.category || "Gündem";
    const source = article.source || "Kişisel seçki";
    const date = escapeHtml(formatTurkishDate());

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
          <div class="egazete-cover-nameplate-rule"></div>
          <h1 class="egazete-cover-nameplate-title">${escapeHtml(profile.paperName || "Kişisel E-Gazete")}</h1>
          <div class="egazete-cover-nameplate-rule"></div>
          <div class="egazete-cover-nameplate-meta">
            <span>${date}</span>
            <span>&#9670;</span>
            <span>Sayın ${escapeHtml(name)} için hazırlandı</span>
            <span>&#9670;</span>
            <span>AI Destekli Kişisel Baskı</span>
          </div>
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
            <div class="egazete-cover-sidebar-title">Bu Sayıda</div>
            ${sideItems}
          </aside>` : ""}
        </div>

      </div>
    `, index, "is-cover");
  }

  renderSummaryPage(page, index) {
    const articles = page.articles || [];
    return this.pageShell(`
      <div class="egazete-inner-page">
        <div class="egazete-section-header">
          <span class="egazete-section-label">Editörün Seçimi</span>
          <h2 class="egazete-section-title">Bugün Öne Çıkan Başlıklar</h2>
          <div class="egazete-section-rule"></div>
        </div>
        <div class="egazete-summary-grid">
          ${articles.map((article, idx) => `
            <div class="egazete-summary-card">
              <div class="egazete-summary-card-num">${String(idx + 1).padStart(2, "0")}</div>
              <div class="egazete-summary-card-cat">${escapeHtml(article.category || "Gündem")} &bull; ${escapeHtml(article.source || "")}</div>
              <h3 class="egazete-summary-card-headline">${escapeHtml(article.title || "Başlıksız haber")}</h3>
              <p class="egazete-summary-card-reason">${escapeHtml(article._personalizedReason || "Kişisel ilgi sinyallerine göre seçildi.")}</p>
            </div>
          `).join("")}
        </div>
      </div>
    `, index);
  }

  renderArticlesPage(page, index) {
    const articles = page.articles || [];
    return this.pageShell(`
      <div class="egazete-inner-page">
        ${articles.map((article, idx) => {
          const imgUrl = article.imageUrl || article.image || article.urlToImage || "";
          const imgHtml = imgUrl
            ? `<img class="egazete-article-img" src="${escapeHtml(imgUrl)}" alt="">`
            : "";
          const summary = escapeHtml(this.articleSummary(article));
          const isFirst = idx === 0;
          return `
          <div class="egazete-article-block ${isFirst ? "is-lead" : "is-secondary"}">
            <div class="egazete-article-meta">
              <span class="egazete-article-cat">${escapeHtml(article.category || "Gündem")}</span>
              <span class="egazete-article-source">${escapeHtml(article.source || "")}</span>
              <span class="egazete-article-date">${escapeHtml(this.articleDate(article))}</span>
            </div>
            <h2 class="egazete-article-headline">${escapeHtml(article.title || "Başlıksız haber")}</h2>
            <div class="egazete-article-divider"></div>
            ${imgHtml ? `<div class="egazete-article-img-wrap">${imgHtml}</div>` : ""}
            <div class="egazete-article-body">
              <p>${summary}</p>
            </div>
          </div>
          ${idx < articles.length - 1 ? `<div class="egazete-article-separator"></div>` : ""}
          `;
        }).join("")}
      </div>
    `, index);
  }

  renderSourcesPage(page, index) {
    const articles = page.articles || [];
    const sources = [...new Set(articles.map((article) => article.source).filter(Boolean))];
    const profile = this.getProfile() || {};
    return this.pageShell(`
      <div class="egazete-inner-page egazete-sources-page">
        <div class="egazete-section-header">
          <span class="egazete-section-label">Kaynaklar</span>
          <h2 class="egazete-section-title">Bu Baskıda Kullanılan Kaynaklar</h2>
          <div class="egazete-section-rule"></div>
        </div>
        <div class="egazete-sources-grid">
          ${sources.map((src, i) => `
            <div class="egazete-source-item">
              <span class="egazete-source-num">${String(i + 1).padStart(2, "0")}</span>
              <span class="egazete-source-name">${escapeHtml(src)}</span>
            </div>
          `).join("")}
        </div>
        <div class="egazete-sources-note">
          <h3>Okuma Notu</h3>
          <p>AI özetleri kaynak haberin başlığı, açıklaması ve mevcut içerik alanları üzerinden hazırlanır. Kaynakta olmayan bilgi gerçek gibi sunulmaz; veri eksik olduğunda güvenli fallback özet kullanılır.</p>
          <p>Bu gazete <strong>${escapeHtml(profile.name || "okuyucu")}</strong> için yapay zeka tarafından özel olarak derlenmiştir.</p>
        </div>
        <div class="egazete-sources-footer-bar">
          <span>${escapeHtml(profile.paperName || "Kişisel E-Gazete")}</span>
          <span>${escapeHtml(formatTurkishDate())}</span>
          <span>AI Destekli Kişisel Baskı</span>
        </div>
      </div>
    `, index);
  }

  watermarkText(profile = {}) {
    const name = profile.name || "okuyucu";
    return `Bu gazete ${name} için yapay zeka tarafından özel olarak derlenmiştir.`;
  }

  renderPrintSource() {
    if (!this.printSource) return;
    this.printSource.innerHTML = this.pages.map((page, index) => this.renderPage(page, index)).join("");
  }

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
      const filler = " Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse aliquet dapibus tempor. Donec non congue mauris. Curabitur elementum, velit id elementum porta, dui tortor euismod diam, eu pulvinar nulla eros sed enim. Morbi dignissim, erat ut ultrices lobortis, purus lorem molestie metus, interdum volutpat orci nulla velit pellente eget massa.";
      while(res.length < min) res += filler;
      return res;
    };

    return `
<div class="page custom-cover">
  <div class="custom-header">
    <div class="header-kicker-wrap">
      <div class="kicker-line"></div>
      <div class="kicker-box">${escapeHtml(mainArt.category || "SPORTS NEWS")}</div>
      <div class="kicker-line"></div>
    </div>
    <h1 class="header-title">${escapeHtml(paperName.toUpperCase())}</h1>
    <div class="header-meta">
      <div class="meta-item left">${escapeHtml(todayStr)}</div>
      <div class="meta-item center">www.KisiselBulten.com</div>
      <div class="meta-item right">Sayın ${escapeHtml(name)} | Bölüm 1</div>
    </div>
  </div>

  <div class="custom-body">
    <div class="top-section">
      <div class="top-left">
        <h2 class="main-headline">${escapeHtml(mainArt.title || "Phasellus Ultricies Pretium Justo Dignissim Maximus Sed Auctor Porta")}</h2>
        <div class="byline">Yazar: AI Editör</div>
        <div class="text-2-col">
          ${escapeHtml(fillText(mainArt.content || mainArt.summary, 1300))}
        </div>
      </div>
      <div class="top-right">
        <div class="top-right-wrap">
          ${imgHtml1}
          <div class="red-box-overlap">
            Curabitur vitae nunc sed velit dignissim. Morbi enim nunc faucibus a. Sed elementum tempus egestas sed sed risus pretium quam.
          </div>
        </div>
      </div>
    </div>

    <div class="bottom-section">
      <div class="bottom-left">
        <h2 class="sub-headline">${escapeHtml(sideArt1.title || "Nam Maximus Ut Elit Id Condimentum Duis Lobortis Varius Ex Quis Porttitor Donec")}</h2>
        <div class="byline">Yazar: AI Yazar</div>
        <div class="text-2-col">
          ${escapeHtml(fillText(sideArt1.content || sideArt1.summary, 1200))}
        </div>
      </div>
      <div class="bottom-right">
        <div class="blue-box">
          <h3>${escapeHtml(sideArt2.title || "Tempus Iaculis Urna")}</h3>
          <p>${escapeHtml(stripHtml(sideArt2.summary || "Volutpat lacus laoreet non curabitur gravida. Interdum velit laoreet id donec ultrices. Orci a scelerisque purus semper eget duis at."))}</p>
        </div>
        ${imgHtml2}
        <div class="red-box-bottom">
          Facilisis magna etiam tempor orci eu lobortis elementum nibh.
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

  <div class="summary-grid">
    ${cards}
  </div>

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
    <div class="article-text">
      <p>${escapeHtml(this.articleSummary(article))}</p>
    </div>
  </div>`;
      if (i < articles.length - 1) {
        blocks += `\n  <div class="article-divider"></div>\n`;
      }
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

  <div class="sources-grid">
    ${sourceItems}
  </div>

  <div class="sources-note">
    <h3>Okuma Notu</h3>
    <p>AI özetleri kaynak haberin başlığı, açıklaması ve mevcut içerik alanları üzerinden hazırlanır. Kaynakta olmayan bilgi gerçek gibi sunulmaz; veri eksik olduğunda güvenli fallback özet kullanılır.</p>
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
    const paperName = profile.paperName || "Kişisel E-Gazete";
    const name = profile.name || "Okuyucu";
    const todayStr = formatTurkishDate();

    // Her sayfayı HTML'e çevir
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

/* ── Üst toolbar (ekranda görünür, print'te gizlenir) ── */
.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: #12192a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 24px;
  box-shadow: 0 2px 16px rgba(0,0,0,0.5);
}
.topbar-title { font-family: Inter, sans-serif; font-size: 14pt; font-weight: 800; color: #fff; letter-spacing: 0.03em; }
.topbar-actions { display: flex; gap: 10px; }
.btn-primary {
  background: #8B1A1A; color: #fff; border: none;
  padding: 9px 20px; border-radius: 7px;
  font-family: Inter, sans-serif; font-size: 11pt; font-weight: 800;
  cursor: pointer;
}
.btn-primary:hover { background: #a82020; }
.btn-secondary {
  background: transparent; color: #fff;
  border: 1.5px solid rgba(255,255,255,0.25);
  padding: 9px 16px; border-radius: 7px;
  font-family: Inter, sans-serif; font-size: 11pt; font-weight: 700;
  cursor: pointer;
}
.btn-secondary:hover { background: rgba(255,255,255,0.08); }

/* ── A4 Sayfa ── */
.page {
  width: 210mm;
  height: 297mm;
  background: #fff;
  margin: 10mm auto;
  padding: 12mm 15mm 10mm;
  box-shadow: 0 6px 32px rgba(0,0,0,0.4);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: #111;
}

/* ── Sayfa üst çubuk ── */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 2.5mm;
  margin-bottom: 4mm;
  border-bottom: 0.55mm solid #111;
  font-family: Inter, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #555;
  flex-shrink: 0;
}
.page-header strong { font-size: 9pt; font-weight: 900; color: #111; letter-spacing: 0.1em; }

/* ── Sayfa alt çubuk ── */
.page-footer {
  position: absolute;
  left: 15mm; right: 15mm; bottom: 7mm;
  display: flex; justify-content: space-between;
  padding-top: 2mm;
  border-top: 0.3mm solid #bbb;
  font-family: Inter, sans-serif;
  font-size: 6.5pt; color: #888;
}

/* ── İçerik alanı ── */
.page-body { flex: 1; overflow: hidden; }

/* ================================================================
   KAPAK SAYFASI (YENİ TASARIM)
   ================================================================ */
.custom-cover {
  padding: 8mm 12mm 10mm !important;
  display: flex;
  flex-direction: column;
}
.custom-header { margin-bottom: 5mm; flex-shrink: 0; }
.header-kicker-wrap {
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 2mm;
}
.kicker-line {
  flex: 1; height: 1.5mm;
  border-top: 0.4mm solid #111; border-bottom: 0.2mm solid #111;
  margin: 0 4mm;
}
.kicker-box {
  background: #cc1011; color: #fff;
  font-family: Inter, sans-serif; font-size: 10pt; font-weight: 800;
  padding: 1.5mm 4mm; text-transform: uppercase;
}
.header-title {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 38pt; font-weight: 900; color: #0b1e40;
  text-align: center; line-height: 1; margin-bottom: 2.5mm;
  text-transform: uppercase; letter-spacing: -0.02em;
}
.header-meta {
  display: flex; justify-content: space-between;
  border-top: 1mm double #111; border-bottom: 1mm double #111;
  padding: 1.5mm 0; margin-bottom: 4mm;
  font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 600;
  color: #333;
}
.meta-item { flex: 1; }
.meta-item.center { text-align: center; }
.meta-item.right { text-align: right; }

.custom-body {
  display: flex; flex-direction: column; gap: 4mm; flex: 1; overflow: hidden;
}
.top-section {
  display: flex; gap: 4mm; border-bottom: 0.4mm solid #111;
  padding-bottom: 4mm; flex-shrink: 0;
}
.top-left { flex: 5.5; }
.top-right { flex: 4.5; }

.main-headline {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 21pt; font-weight: 900; color: #0b1e40;
  line-height: 1.15; margin-bottom: 2.5mm;
}
.byline {
  font-family: Georgia, serif; font-size: 7.5pt; font-style: italic;
  margin-bottom: 2.5mm; color: #555;
}
.text-2-col {
  column-count: 2; column-gap: 4mm;
  font-family: Georgia, serif; font-size: 8pt; line-height: 1.45;
  text-align: justify; color: #111;
}

.top-right-wrap { position: relative; height: 100%; min-height: 60mm; }
.top-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.red-box-overlap {
  position: absolute; bottom: 0; left: 0; width: 68%;
  background: #cc1011; color: #fff; padding: 2.5mm;
  font-family: Georgia, serif; font-style: italic; font-size: 7.5pt;
  line-height: 1.35; box-sizing: border-box;
}

.bottom-section { display: flex; gap: 4mm; flex: 1; overflow: hidden; }
.bottom-left { flex: 6.5; }
.bottom-right { flex: 3.5; display: flex; flex-direction: column; gap: 2.5mm; }

.sub-headline {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 17pt; font-weight: 900; color: #0b1e40;
  line-height: 1.2; margin-bottom: 2.5mm;
}
.blue-box {
  background: #0b1e40; color: #fff; padding: 3mm; box-sizing: border-box;
}
.blue-box h3 {
  font-family: "Playfair Display", Georgia, serif; font-size: 11pt;
  margin-bottom: 1.5mm; line-height: 1.1;
}
.blue-box p {
  font-family: Georgia, serif; font-size: 7pt; line-height: 1.4;
  text-align: justify; color: #e2e8f0;
}
.bottom-img { width: 100%; height: 35mm; object-fit: cover; display: block; flex-shrink: 0; }
.red-box-bottom {
  background: #cc1011; color: #fff; padding: 2.5mm;
  font-family: Georgia, serif; font-style: italic; font-size: 7.5pt;
  line-height: 1.35; flex-shrink: 0;
}

/* ================================================================
   ÖZET SAYFASI
   ================================================================ */
.section-head { margin-bottom: 5mm; flex-shrink: 0; }
.section-eyebrow {
  display: block;
  font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 900;
  text-transform: uppercase; letter-spacing: 0.13em;
  color: #8B1A1A; margin-bottom: 1.5mm;
}
.section-title {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 24pt; font-weight: 900;
  color: #111; line-height: 1.08; margin-bottom: 2.5mm;
}
.section-rule { border: none; border-top: 0.65mm solid #111; }

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4.5mm 7mm;
  margin-top: 5mm;
  overflow: hidden;
}
.summary-card {
  border-left: 1mm solid #8B1A1A;
  padding-left: 3.5mm; padding-bottom: 3mm;
  overflow: hidden;
}
.card-num {
  font-family: Inter, sans-serif; font-size: 20pt; font-weight: 900;
  color: #ebebeb; line-height: 1; margin-bottom: 1mm;
}
.card-cat {
  font-family: Inter, sans-serif; font-size: 6.5pt; font-weight: 900;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: #8B1A1A; margin-bottom: 1.5mm;
}
.card-title {
  font-family: Georgia, serif; font-size: 9.5pt; font-weight: 700;
  line-height: 1.38; color: #111; margin-bottom: 1.5mm;
}
.card-reason {
  font-family: Inter, sans-serif; font-size: 7.5pt;
  color: #666; line-height: 1.45;
}

/* ================================================================
   HABERLEŞTİRME SAYFASI
   ================================================================ */
.article-block { overflow: hidden; }
.article-lead { padding-bottom: 4mm; }
.article-secondary { }

.article-divider { border: none; border-top: 0.35mm solid #ccc; margin: 3mm 0; }

.article-meta {
  display: flex; gap: 5pt; margin-bottom: 2.5mm;
  font-family: Inter, sans-serif; font-size: 7pt; font-weight: 900;
  text-transform: uppercase; letter-spacing: 0.08em;
  flex-shrink: 0;
}
.meta-cat { color: #8B1A1A; }
.meta-src { color: #555; }
.meta-src::before { content: "·"; margin-right: 5pt; }
.meta-date { color: #999; margin-left: auto; }

.article-headline {
  font-family: "Playfair Display", Georgia, serif;
  font-weight: 900; line-height: 1.1; color: #111; margin-bottom: 2mm;
}
.article-lead .article-headline { font-size: 22pt; }
.article-secondary .article-headline { font-size: 16pt; }

.article-rule { border: none; border-top: 0.55mm solid #111; margin: 2mm 0 3mm; }

.article-img-wrap {
  float: right;
  width: 56mm; height: 40mm;
  margin: 0 0 3mm 5mm;
  overflow: hidden; background: #e0e0e0;
  flex-shrink: 0;
}
.article-img { width: 100%; height: 100%; object-fit: cover; display: block; }

.article-text {
  font-size: 9.5pt; line-height: 1.72;
  color: #222; text-align: justify;
}
.article-text::after { content: ""; display: table; clear: both; }

/* ================================================================
   KAYNAKLAR SAYFASI
   ================================================================ */
.sources-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 3mm; margin: 5mm 0 7mm;
  overflow: hidden;
}
.source-item {
  display: flex; gap: 2.5mm; align-items: baseline;
  border-bottom: 0.2mm solid #ebebeb; padding-bottom: 2mm;
}
.source-num {
  font-family: Inter, sans-serif; font-size: 8pt; font-weight: 900;
  color: #8B1A1A; flex-shrink: 0;
}
.source-name { font-family: Georgia, serif; font-size: 9pt; font-weight: 700; color: #111; }

.sources-note {
  border-top: 0.45mm solid #111; padding-top: 4mm; max-width: 120mm;
}
.sources-note h3 {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 14pt; margin-bottom: 2.5mm; color: #111;
}
.sources-note p { font-size: 8.5pt; color: #444; line-height: 1.65; margin-bottom: 2mm; }

.sources-bar {
  position: absolute; left: 15mm; right: 15mm; bottom: 18mm;
  display: flex; justify-content: space-between;
  padding: 2mm 0;
  border-top: 0.55mm solid #111; border-bottom: 0.55mm solid #111;
  font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.07em; color: #444;
}

/* ================================================================
   PRINT MEDYA
   ================================================================ */
@media print {
  *, *::before, *::after {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; padding-top: 0 !important; }
  .topbar { display: none !important; }
  .page {
    margin: 0 auto !important;
    box-shadow: none !important;
    page-break-after: always !important;
    break-after: page !important;
  }
}
  </style>
</head>
<body>
  <div class="topbar">
    <span class="topbar-title">📰 ${escapeHtml(paperName)}</span>
    <div class="topbar-actions">
      <button class="btn-secondary" onclick="window.close()">✕ Kapat</button>
      <button class="btn-primary" onclick="window.print()">⬇ PDF Olarak Kaydet</button>
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
