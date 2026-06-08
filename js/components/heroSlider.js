/**
 * HeroSlider — featured news carousel with drag/swipe, 3D depth, priority scoring.
 * Pure module: no DOM globals, no app state. Communicates via onAction callback.
 */
import { escapeHtml } from "../utils/textUtils.js";

/* ─── Priority scoring ──────────────────────────────────────────────── */
const BREAKING_KW = ["son dakika", "breaking", "acil", "flash", "flaş", "urgent"];
const CRITICAL_KW = ["kritik", "önemli", "critical", "uyarı", "alarm"];

function scoreArticle(article) {
  let s = 0;
  const t = (article.title || "").toLowerCase();
  const tags = Array.isArray(article.tags) ? article.tags.join(" ").toLowerCase() : "";

  if (article.breaking || BREAKING_KW.some((k) => t.includes(k) || tags.includes(k))) s += 100;
  if (article.critical || article.urgent || CRITICAL_KW.some((k) => tags.includes(k))) s += 80;

  const age = (Date.now() - new Date(article.publishedAt || article.date || 0)) / 3.6e6;
  if (age <= 2) s += 50;
  else if (age <= 24) s += 30;
  else if (age <= 72) s += 10;

  s += Math.min(20, (article.trendScore || 0) / 5);
  s += Math.min(20, (article.relevance || 0) / 5);
  s += Math.min(10, article.importance || 0);
  return s;
}

function getBadge(article) {
  const t = (article.title || "").toLowerCase();
  if (article.breaking || BREAKING_KW.some((k) => t.includes(k))) return { text: "SON DAKİKA", cls: "hsb-breaking" };
  if (article.critical || article.urgent) return { text: "KRİTİK", cls: "hsb-critical" };
  const age = (Date.now() - new Date(article.publishedAt || article.date || 0)) / 3.6e6;
  if (age <= 2) return { text: "YENİ", cls: "hsb-new" };
  if (age <= 24) return { text: "SON 24 SAAT", cls: "hsb-recent" };
  if ((article.trendScore || 0) >= 50) return { text: "TREND", cls: "hsb-trend" };
  return { text: "GÜNDEM", cls: "hsb-default" };
}

function selectArticles(articles, max = 12) {
  const scored = articles
    .filter((a) => a && a.title)
    .map((a) => ({ ...a, _hs: scoreArticle(a) }))
    .sort((a, b) => b._hs - a._hs);

  const seen = new Set();
  const out = [];
  for (const a of scored) {
    const key = (a.title || "").toLowerCase().trim().slice(0, 48);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

/* ─── Card HTML ─────────────────────────────────────────────────────── */
const BG_GRADIENTS = [
  "linear-gradient(145deg,#0f2027,#203a43,#2c5364)",
  "linear-gradient(145deg,#1a1a2e,#16213e,#0f3460)",
  "linear-gradient(145deg,#2d1b69,#1a0a3e,#4a1d96)",
  "linear-gradient(145deg,#134e4a,#0f3a38,#065f46)",
  "linear-gradient(145deg,#1e1b4b,#312e81,#1e3a8a)",
  "linear-gradient(145deg,#3b0764,#4c1d95,#6b21a8)",
];

function buildCard(article, idx) {
  const badge = getBadge(article);
  const bg = article.imageUrl
    ? `background-image:url('${escapeHtml(article.imageUrl)}');background-size:cover;background-position:center`
    : BG_GRADIENTS[idx % BG_GRADIENTS.length];
  const isImg = Boolean(article.imageUrl);

  const summary = (article.summary || article.description || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const catColor = article._catColor || "rgba(255,255,255,0.18)";
  const ageMs = Date.now() - new Date(article.publishedAt || article.date || 0);
  const ageH = ageMs / 3.6e6;
  const freshLabel = ageH <= 0.5 ? "Az önce" : ageH <= 2 ? `${Math.round(ageH * 60)} dk önce` : ageH <= 24 ? `${Math.round(ageH)} saat önce` : "";

  return `
<article class="hs-card" data-id="${escapeHtml(String(article.id))}" data-hs-idx="${idx}"
  role="tabpanel" aria-label="${escapeHtml(article.title)}" tabindex="-1">
  <div class="hs-card-bg ${isImg ? "hs-card-bg--img" : ""}" style="${isImg ? `background-image:url('${escapeHtml(article.imageUrl)}')` : bg}"></div>
  <div class="hs-card-overlay"></div>
  <div class="hs-card-body">
    <div class="hs-card-top">
      <span class="hs-badge ${badge.cls}">${badge.text}</span>
      <span class="hs-cat" style="background:${escapeHtml(catColor)}">${escapeHtml(article.category || "Haber")}</span>
      ${freshLabel ? `<span class="hs-fresh"><i class="fa-solid fa-circle-dot hs-fresh-dot"></i>${escapeHtml(freshLabel)}</span>` : ""}
    </div>
    <div class="hs-card-main">
      <div class="hs-card-meta">
        ${article.source ? `<span>${escapeHtml(article.source)}</span><span class="hs-dot">·</span>` : ""}
        <span>${escapeHtml(article.date || "")}</span>
      </div>
      <h2 class="hs-card-title">
        <button class="hs-title-btn title-link" data-action="detail" data-id="${escapeHtml(String(article.id))}">${escapeHtml(article.title)}</button>
      </h2>
      ${summary ? `<p class="hs-card-summary">${escapeHtml(summary)}</p>` : ""}
    </div>
    <div class="hs-card-actions">
      <button class="hs-btn-icon" data-action="bookmark" data-id="${escapeHtml(String(article.id))}" aria-label="Kaydet">
        <i class="${article.bookmarked ? "fa-solid" : "fa-regular"} fa-bookmark" aria-hidden="true"></i>
      </button>
      <button class="hs-btn-icon" data-action="similar" data-id="${escapeHtml(String(article.id))}" aria-label="Benzer haberler">
        <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
      </button>
      <button class="hs-btn-icon" data-action="newspaper" data-id="${escapeHtml(String(article.id))}" aria-label="Gazeteye ekle">
        <i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</article>`;
}

/* ─── HeroSlider class ──────────────────────────────────────────────── */
export class HeroSlider {
  /**
   * @param {Object} opts
   * @param {Element} opts.stage   — card container (.hs-stage)
   * @param {Element} opts.dots    — dots wrapper
   * @param {Element} opts.counter — "01 / 08" text element
   * @param {Element} opts.prev    — prev arrow button
   * @param {Element} opts.next    — next arrow button
   * @param {Element} opts.progressFill — animated fill bar
   * @param {Function} opts.onAction — (action, id) => Promise
   */
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
    this._timer = null;
    this._delay = 6000;
    this._paused = false;
    this._dragging = false;
    this._dragX = 0;
    this._delta = 0;

    this._bindStaticEvents();
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  init(articles) {
    this.articles = selectArticles(articles);
    this.total = this.articles.length;
    this.active = 0;
    this._render();
    this._startAutoplay();
  }

  refresh(articles) {
    const wasEmpty = !this.total;
    this.articles = selectArticles(articles);
    this.total = this.articles.length;
    if (this.active >= this.total) this.active = 0;
    this._render();
    if (wasEmpty) this._startAutoplay();
  }

  destroy() {
    this._stopAutoplay();
    this._unbindDrag();
  }

  /* ── Rendering ───────────────────────────────────────────────────── */
  _render() {
    if (!this.stage) return;
    if (!this.total) {
      this.stage.innerHTML = `<div class="hs-empty"><i class="fa-solid fa-newspaper"></i><span>Haberler yükleniyor…</span></div>`;
      return;
    }
    this.stage.innerHTML = this.articles.map((a, i) => buildCard(a, i)).join("");
    this._cards = [...this.stage.querySelectorAll(".hs-card")];
    this._applyPositions(true);
    this._renderDots();
    this._updateCounter();
    this._updateArrowState();
    this._bindDrag();
  }

  _applyPositions(instant = false) {
    const ai = this.active;
    this._cards.forEach((card, i) => {
      card.classList.remove("hs-active", "hs-prev1", "hs-prev2", "hs-next1", "hs-next2");
      if (instant) card.style.transition = "none";
      const off = i - ai;
      if (off === 0) { card.classList.add("hs-active"); card.tabIndex = 0; card.setAttribute("aria-hidden", "false"); }
      else if (off === -1) { card.classList.add("hs-prev1"); card.tabIndex = -1; card.setAttribute("aria-hidden", "true"); }
      else if (off === 1) { card.classList.add("hs-next1"); card.tabIndex = -1; card.setAttribute("aria-hidden", "true"); }
      else if (off < -1) { card.classList.add("hs-prev2"); card.tabIndex = -1; card.setAttribute("aria-hidden", "true"); }
      else { card.classList.add("hs-next2"); card.tabIndex = -1; card.setAttribute("aria-hidden", "true"); }
    });
    if (instant) requestAnimationFrame(() => this._cards.forEach((c) => (c.style.transition = "")));
  }

  _renderDots() {
    if (!this.dots) return;
    this.dots.innerHTML = this.articles
      .map((_, i) => `<button class="hs-dot${i === this.active ? " hs-dot-on" : ""}" data-hs-dot="${i}" role="tab" aria-selected="${i === this.active}" aria-label="${i + 1}. habere geç"></button>`)
      .join("");
  }

  _updateCounter() {
    if (this.counter) this.counter.textContent = `${String(this.active + 1).padStart(2, "0")} / ${String(this.total).padStart(2, "0")}`;
  }

  _updateArrowState() {
    if (this.prev) this.prev.disabled = this.active === 0;
    if (this.next) this.next.disabled = this.active === this.total - 1;
  }

  /* ── Navigation ──────────────────────────────────────────────────── */
  _go(idx, userInitiated = false) {
    if (idx < 0 || idx >= this.total) return;
    this.active = idx;
    this._applyPositions();
    this._renderDots();
    this._updateCounter();
    this._updateArrowState();
    if (userInitiated) { this._stopAutoplay(); this._startAutoplay(); }
    else this._animateFill();
  }

  /* ── Autoplay ────────────────────────────────────────────────────── */
  _startAutoplay() {
    this._stopAutoplay();
    if (this.total <= 1) return;
    this._animateFill();
    this._timer = setInterval(() => {
      if (!this._paused) this._go((this.active + 1) % this.total);
    }, this._delay);
  }

  _stopAutoplay() {
    clearInterval(this._timer);
    this._timer = null;
    if (this.fill) { this.fill.style.animation = "none"; }
  }

  _animateFill() {
    if (!this.fill || this._paused) return;
    this.fill.style.animation = "none";
    void this.fill.offsetHeight;
    this.fill.style.animation = `hsFillProgress ${this._delay}ms linear forwards`;
  }

  _pause() { this._paused = true; if (this.fill) this.fill.style.animationPlayState = "paused"; }
  _resume() { this._paused = false; this._animateFill(); }

  /* ── Event binding ───────────────────────────────────────────────── */
  _bindStaticEvents() {
    /* Arrow buttons */
    this.prev?.addEventListener("click", () => this._go(this.active - 1, true));
    this.next?.addEventListener("click", () => this._go(this.active + 1, true));

    /* Dots */
    this.dots?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hs-dot]");
      if (btn) this._go(Number(btn.dataset.hsDot), true);
    });

    /* Pause on hover / focus */
    this.stage?.addEventListener("mouseenter", () => this._pause());
    this.stage?.addEventListener("mouseleave", () => this._resume());
    this.stage?.addEventListener("focusin", () => this._pause());
    this.stage?.addEventListener("focusout", () => this._resume());

    /* Card click → action (only if not dragging) */
    this.stage?.addEventListener("click", async (e) => {
      if (this._dragging) return;
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      e.stopPropagation();
      await this.onAction(btn.dataset.action, btn.dataset.id);
    });

    /* Keyboard nav on active card */
    this.stage?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") this._go(this.active - 1, true);
      if (e.key === "ArrowRight") this._go(this.active + 1, true);
    });
  }

  _bindDrag() {
    if (this._dragBound) return;
    this._dragBound = true;

    this._onMD = (e) => {
      if (e.button !== 0) return;
      this._dragX = e.clientX; this._delta = 0; this._dragging = false;
      this._pause();
      window.addEventListener("mousemove", this._onMM = (ev) => {
        this._delta = ev.clientX - this._dragX;
        if (Math.abs(this._delta) > 6) this._dragging = true;
      });
      window.addEventListener("mouseup", this._onMU = () => {
        window.removeEventListener("mousemove", this._onMM);
        window.removeEventListener("mouseup", this._onMU);
        if (Math.abs(this._delta) > 55) this._go(this._delta < 0 ? this.active + 1 : this.active - 1, true);
        else this._resume();
        setTimeout(() => { this._dragging = false; }, 80);
        this._delta = 0;
      }, { once: true });
    };

    this._onTS = (e) => {
      this._dragX = e.touches[0].clientX; this._delta = 0;
      this._pause();
      const onTM = (ev) => { this._delta = ev.touches[0].clientX - this._dragX; };
      const onTE = () => {
        this.stage.removeEventListener("touchmove", onTM);
        if (Math.abs(this._delta) > 48) this._go(this._delta < 0 ? this.active + 1 : this.active - 1, true);
        else this._resume();
        this._delta = 0;
      };
      this.stage.addEventListener("touchmove", onTM, { passive: true });
      this.stage.addEventListener("touchend", onTE, { once: true });
    };

    this.stage.addEventListener("mousedown", this._onMD);
    this.stage.addEventListener("touchstart", this._onTS, { passive: true });
  }

  _unbindDrag() {
    if (this._onMD) this.stage?.removeEventListener("mousedown", this._onMD);
    if (this._onTS) this.stage?.removeEventListener("touchstart", this._onTS);
  }
}
