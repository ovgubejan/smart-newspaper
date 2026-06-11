/**
 * PersonalizedCarousel — premium, drag/swipe enabled carousel for the
 * "Sana Özel / Sana En Uygun Haberler" page.
 *
 * Pure UI module: receives already-ranked personalized articles and delegates
 * actions back to app.js via onAction.
 */
import { escapeHtml } from "../utils/textUtils.js";

const BG_GRADIENTS = [
  "linear-gradient(135deg,#1c1917,#7c2d12,#b45309)",
  "linear-gradient(135deg,#111827,#1d4ed8,#0891b2)",
  "linear-gradient(135deg,#1e1b4b,#6d28d9,#db2777)",
  "linear-gradient(135deg,#052e2b,#0f766e,#84cc16)",
  "linear-gradient(135deg,#172554,#1e40af,#9333ea)",
  "linear-gradient(135deg,#3b0764,#86198f,#be123c)"
];

function decodeEntities(value = "") {
  const textarea = document.createElement("textarea");
  let decoded = String(value || "");
  for (let i = 0; i < 3; i += 1) {
    textarea.innerHTML = decoded;
    const next = textarea.value;
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function safeSummary(article) {
  const raw = decodeEntities(article.aiSummary || article.summary || article.description || article.fullText || "")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "Bu haber için kısa özet bulunamadı; detay sayfasından gelişmenin tamamını inceleyebilirsin.";
  return raw.length > 260 ? `${raw.slice(0, 260).replace(/\s+\S*$/, "")}…` : raw;
}

function freshnessBadge(article) {
  const title = String(article.title || "").toLowerCase();
  const tags = Array.isArray(article.tags) ? article.tags.join(" ").toLowerCase() : "";
  const joined = `${title} ${tags}`;

  if (article.breaking || joined.includes("son dakika") || joined.includes("breaking") || joined.includes("flaş") || joined.includes("flash")) {
    return { text: "SON DAKİKA", cls: "pc-badge-breaking" };
  }
  if (article.critical || article.urgent || joined.includes("kritik") || joined.includes("urgent") || joined.includes("alarm")) {
    return { text: "KRİTİK", cls: "pc-badge-critical" };
  }

  const published = new Date(article.publishedAt || article.date || 0).getTime();
  if (Number.isFinite(published) && published) {
    const ageHours = (Date.now() - published) / 36e5;
    if (ageHours <= 2) return { text: "YENİ", cls: "pc-badge-new" };
    if (ageHours <= 24) return { text: "SON 24 SAAT", cls: "pc-badge-recent" };
  }

  return { text: "SANA ÖZEL", cls: "pc-badge-personal" };
}

function buildCard(article, index) {
  const score = Math.round(Number(article._personalizedScore || article.interestScore || article.relevance || 0));
  const badge = freshnessBadge(article);
  const category = article.category || "Haber";
  const subcategory = article.subcategory || "Kişisel Seçki";
  const reason = article._personalizedReason || "Bu haber ilgi alanların ve güncellik sinyallerine göre önerildi.";
  const sourceUrl = article.sourceUrl || article.url || "";
  const hasImage = Boolean(article.imageUrl);
  const bg = hasImage
    ? `background-image:url('${escapeHtml(article.imageUrl)}')`
    : BG_GRADIENTS[index % BG_GRADIENTS.length];
  const dateLabel = article.date || (article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })
    : "Tarih yok");

  return `
    <article class="pc-card" data-id="${escapeHtml(String(article.id))}" data-pc-idx="${index}" role="tabpanel" tabindex="-1" aria-label="${escapeHtml(article.title || 'Kişisel haber')}">
      <div class="pc-card-paper"></div>
      <div class="pc-card-content">
        <div class="pc-card-main">
          <div class="pc-topline">
            <span class="pc-badge ${badge.cls}">${escapeHtml(badge.text)}</span>
            <span class="pc-score">%${escapeHtml(String(score))} sana uygun</span>
          </div>
          <div class="pc-meta">
            <span>${escapeHtml(article.source || "Kaynak yok")}</span>
            <span>·</span>
            <span>${escapeHtml(dateLabel)}</span>
          </div>
          <h2 class="pc-title">
            <button type="button" class="pc-title-btn" data-action="detail" data-id="${escapeHtml(String(article.id))}">${escapeHtml(article.title || "Başlıksız haber")}</button>
          </h2>
          <div class="pc-tags">
            <span style="--tag-color:${escapeHtml(article._catColor || '#a43f2f')}">${escapeHtml(category)}</span>
            <span>${escapeHtml(subcategory)}</span>
          </div>
          <p class="pc-reason"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ${escapeHtml(reason)}</p>
          <p class="pc-summary">${escapeHtml(safeSummary(article))}</p>
          <div class="pc-actions">
            <button type="button" class="pc-primary" data-action="detail" data-id="${escapeHtml(String(article.id))}"><i class="fa-solid fa-book-open" aria-hidden="true"></i> Detay</button>
            <button type="button" data-action="bookmark" data-id="${escapeHtml(String(article.id))}"><i class="${article.bookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark" aria-hidden="true"></i> ${article.bookmarked ? 'Kaydedildi' : 'Kaydet'}</button>
            <button type="button" data-action="similar" data-id="${escapeHtml(String(article.id))}"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> Benzer</button>
            ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Kaynağa Git</a>` : ""}
          </div>
        </div>
        <div class="pc-visual ${hasImage ? 'has-image' : 'has-gradient'}" style="${hasImage ? bg : `background:${bg}`}">
          <div class="pc-visual-grid" aria-hidden="true"></div>
          <span class="pc-visual-label">Kişisel Gazete</span>
        </div>
      </div>
    </article>`;
}

export class PersonalizedCarousel {
  constructor({ stage, dots, counter, prev, next, progressFill, onAction }) {
    this.stage = stage;
    this.dots = dots;
    this.counter = counter;
    this.prev = prev;
    this.next = next;
    this.fill = progressFill;
    this.onAction = onAction || (() => {});

    this.articles = [];
    this.active = 0;
    this.total = 0;
    this._dragX = 0;
    this._delta = 0;
    this._dragging = false;
    this._wheelLock = false;
    this._bindStaticEvents();
  }

  init(articles = []) {
    this.articles = articles.filter((a) => a && a.title).slice(0, 12);
    this.total = this.articles.length;
    this.active = 0;
    this._render();
  }

  refresh(articles = []) {
    this.articles = articles.filter((a) => a && a.title).slice(0, 12);
    this.total = this.articles.length;
    if (this.active >= this.total) this.active = 0;
    this._render();
  }

  destroy() {
    this._unbindDrag();
  }

  currentIds() {
    return this.articles.map((article) => String(article.id));
  }

  _render() {
    if (!this.stage) return;
    if (!this.total) {
      this.stage.innerHTML = `
        <div class="pc-empty">
          <i class="fa-solid fa-newspaper" aria-hidden="true"></i>
          <strong>Kişisel seçki hazırlanıyor</strong>
          <span>Haber okudukça ve ilgi alanların netleştikçe burası dolacak.</span>
        </div>`;
      this._renderDots();
      this._updateCounter();
      this._updateArrowState();
      this._updateProgress();
      return;
    }

    this.stage.innerHTML = this.articles.map((article, index) => buildCard(article, index)).join("");
    this._cards = [...this.stage.querySelectorAll(".pc-card")];
    this._applyPositions(true);
    this._renderDots();
    this._updateCounter();
    this._updateArrowState();
    this._updateProgress();
    this._bindDrag();
  }

  _applyPositions(instant = false) {
    const ai = this.active;
    this._cards?.forEach((card, index) => {
      card.classList.remove("pc-active", "pc-prev1", "pc-prev2", "pc-next1", "pc-next2");
      if (instant) card.style.transition = "none";
      const offset = index - ai;
      if (offset === 0) {
        card.classList.add("pc-active");
        card.tabIndex = 0;
        card.setAttribute("aria-hidden", "false");
      } else if (offset === -1) {
        card.classList.add("pc-prev1");
        card.tabIndex = -1;
        card.setAttribute("aria-hidden", "true");
      } else if (offset === 1) {
        card.classList.add("pc-next1");
        card.tabIndex = -1;
        card.setAttribute("aria-hidden", "true");
      } else if (offset < -1) {
        card.classList.add("pc-prev2");
        card.tabIndex = -1;
        card.setAttribute("aria-hidden", "true");
      } else {
        card.classList.add("pc-next2");
        card.tabIndex = -1;
        card.setAttribute("aria-hidden", "true");
      }
    });
    if (instant) requestAnimationFrame(() => this._cards?.forEach((card) => { card.style.transition = ""; }));
  }

  _renderDots() {
    if (!this.dots) return;
    this.dots.innerHTML = this.articles
      .map((_, index) => `<button type="button" class="pc-dot${index === this.active ? ' pc-dot-on' : ''}" data-pc-dot="${index}" role="tab" aria-selected="${index === this.active}" aria-label="${index + 1}. kişisel habere geç"></button>`)
      .join("");
  }

  _updateCounter() {
    if (!this.counter) return;
    this.counter.textContent = this.total ? `${String(this.active + 1).padStart(2, "0")} / ${String(this.total).padStart(2, "0")}` : "00 / 00";
  }

  _updateArrowState() {
    if (this.prev) this.prev.disabled = this.active <= 0;
    if (this.next) this.next.disabled = this.active >= this.total - 1;
  }

  _updateProgress() {
    if (!this.fill) return;
    const progress = this.total <= 1 ? 100 : ((this.active + 1) / this.total) * 100;
    this.fill.style.width = `${progress}%`;
  }

  _go(index, userInitiated = false) {
    if (!this.total) return;
    const next = Math.max(0, Math.min(index, this.total - 1));
    if (next === this.active && userInitiated) return;
    this.active = next;
    this._applyPositions();
    this._renderDots();
    this._updateCounter();
    this._updateArrowState();
    this._updateProgress();
  }

  _bindStaticEvents() {
    this.prev?.addEventListener("click", () => this._go(this.active - 1, true));
    this.next?.addEventListener("click", () => this._go(this.active + 1, true));

    this.dots?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-pc-dot]");
      if (btn) this._go(Number(btn.dataset.pcDot), true);
    });

    this.stage?.addEventListener("click", async (event) => {
      if (this._dragging) return;
      const item = event.target.closest("button[data-action]");
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      await this.onAction(item.dataset.action, item.dataset.id);
    });

    this.stage?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this._go(this.active - 1, true);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        this._go(this.active + 1, true);
      }
    });

    this.stage?.addEventListener("wheel", (event) => {
      if (this._wheelLock || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 24) return;
      event.preventDefault();
      this._wheelLock = true;
      this._go(event.deltaX > 0 ? this.active + 1 : this.active - 1, true);
      setTimeout(() => { this._wheelLock = false; }, 360);
    }, { passive: false });
  }

  _bindDrag() {
    if (this._dragBound || !this.stage) return;
    this._dragBound = true;

    this._onPointerDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const interactive = event.target.closest("button, a, input, select, textarea");
      if (interactive) return;
      this._dragX = event.clientX;
      this._delta = 0;
      this._dragging = false;
      this.stage.setPointerCapture?.(event.pointerId);
      this.stage.classList.add("is-dragging");
    };

    this._onPointerMove = (event) => {
      if (!this.stage.classList.contains("is-dragging")) return;
      this._delta = event.clientX - this._dragX;
      if (Math.abs(this._delta) > 7) this._dragging = true;
    };

    this._onPointerUp = (event) => {
      if (!this.stage.classList.contains("is-dragging")) return;
      this.stage.releasePointerCapture?.(event.pointerId);
      this.stage.classList.remove("is-dragging");
      if (Math.abs(this._delta) > 54) this._go(this._delta < 0 ? this.active + 1 : this.active - 1, true);
      setTimeout(() => { this._dragging = false; }, 90);
      this._delta = 0;
    };

    this.stage.addEventListener("pointerdown", this._onPointerDown);
    this.stage.addEventListener("pointermove", this._onPointerMove);
    this.stage.addEventListener("pointerup", this._onPointerUp);
    this.stage.addEventListener("pointercancel", this._onPointerUp);
  }

  _unbindDrag() {
    if (!this.stage) return;
    this.stage.removeEventListener("pointerdown", this._onPointerDown);
    this.stage.removeEventListener("pointermove", this._onPointerMove);
    this.stage.removeEventListener("pointerup", this._onPointerUp);
    this.stage.removeEventListener("pointercancel", this._onPointerUp);
    this._dragBound = false;
  }
}
