const fs = require("fs");

let content = fs.readFileSync("js/components/eGazeteMode.js", "utf8");

// 1. Add imports
if (!content.includes("import { PageFlip }")) {
  content = "import { PageFlip } from 'page-flip';\nimport html2pdf from 'html2pdf.js';\n" + content;
}

// 2. Change pageShell to include data-density
content = content.replace(
  /pageShell\(inner, index, side = "left", extra = ""\) \{([\s\S]*?)<\/article>\s*`;\s*\}/m,
  `pageShell(inner, index, side = "left", extra = "") {
    const profile = this.getProfile() || {};
    const density = index === 0 || index === this.pages.length - 1 ? "hard" : "soft";
    return \`
      <article class="egazete-page \${extra}" data-density="\${density}">
        <div class="egazete-page-texture"></div>
        <div class="egazete-page-head">
          <span class="egazete-page-head-date">\${escapeHtml(formatTurkishDate())}</span>
          <strong class="egazete-page-head-title">Smart Newspaper</strong>
          <span class="egazete-page-head-num">\${egazeteLang() === "en" ? "Page" : "Sayfa"} \${index + 1}</span>
        </div>
        <div class="egazete-page-content">\${inner}</div>
        <footer class="egazete-page-foot">
          <span>\${escapeHtml(this.watermarkText(profile))}</span>
          <span class="egazete-page-foot-num">\${index + 1}</span>
        </footer>
      </article>
    \`;
  }`
);

// 3. Rewrite printPdf
content = content.replace(
  /printPdf\(\) \{([\s\S]*?)\n\}\s*\n?$/m,
  `async printPdf() {
    this.pages = this.pages.length ? this.pages : this.buildPages();
    const htmlString = this.buildPdfHtml();
    
    const container = document.createElement("div");
    container.innerHTML = htmlString;
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    document.body.appendChild(container);
    
    const opt = {
      margin:       0,
      filename:     \`SmartNewspaper_\${formatTurkishDate().replace(/ /g,"_")}.pdf\`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    if (typeof window.showToast === "function") window.showToast("PDF hazırlanıyor, lütfen bekleyin...", "info");
    
    try {
      await html2pdf().set(opt).from(container).save();
      if (typeof window.showToast === "function") window.showToast("PDF başarıyla indirildi.", "success");
    } catch (e) {
      console.error(e);
      if (typeof window.showToast === "function") window.showToast("PDF oluşturulurken hata oluştu.", "error");
    } finally {
      document.body.removeChild(container);
    }
  }
}`
);

// 4. Update goToPage
content = content.replace(
  /goToPage\(pageIndex\) \{([\s\S]*?)\}/m,
  `goToPage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.pages.length) return;
    if (this.pageFlip) this.pageFlip.flip(pageIndex);
  }`
);

// 5. Update open to use PageFlip
content = content.replace(
  /this\.pages = this\.buildPages\(\);\s*if \(\!this\.pages\.length\) \{([\s\S]*?)requestAnimationFrame\(\(\) => this\.root\.querySelector\("\.egazete-shell"\)\?\.focus\(\)\);\s*\}/m,
  `this.pages = this.buildPages();
    if (!this.pages.length) {
      this.root.hidden = false;
      document.body.classList.add("modal-open", "egazete-open");
      this.isOpen = true;
      document.addEventListener("keydown", this.boundKeydown);
      const reader = this.reader || this.root.querySelector("#egazete-book");
      if (reader) reader.innerHTML = \`<div class="egd-empty-state"><p>Haber yok</p></div>\`;
      return;
    }
    this.currentIndex = 0;
    this.zoomLevel = 1;
    this.applyZoom();
    this.renderPrintSource();
    this.buildToc();

    const reader = this.root.querySelector("#egazete-book");
    reader.innerHTML = this.pages.map((p, i) => this.renderPage(p, i, "single")).join("");

    if (this.pageFlip) {
      this.pageFlip.destroy();
    }
    
    setTimeout(() => {
      this.pageFlip = new PageFlip(reader, {
        width: 600,
        height: 850,
        size: "stretch",
        minWidth: 400,
        maxWidth: 1000,
        minHeight: 500,
        maxHeight: 1400,
        maxShadowOpacity: 0.5,
        showCover: true,
        mobileScrollSupport: false
      });
      
      this.pageFlip.loadFromHTML(reader.querySelectorAll(".egazete-page"));
      
      this.pageFlip.on("flip", (e) => {
        this.currentIndex = e.data;
        this.updateControls();
      });
      
      this.updateControls();
    }, 50);

    this.setTheme(this.currentTheme || "cream");
    this.root.hidden = false;
    document.body.classList.add("modal-open", "egazete-open");
    this.isOpen = true;
    document.addEventListener("keydown", this.boundKeydown);
    requestAnimationFrame(() => this.root.querySelector(".egazete-shell")?.focus());
  }`
);

// 6. Update next and prev
content = content.replace(
  /next\(\) \{\s*if \(this\.isFlipping\) return;\s*const step = this\.spreadSize\(\);\s*const maxIndex = Math\.max\(0, this\.pages\.length - step\);\s*if \(this\.currentIndex >= maxIndex\) return;\s*this\.currentIndex = Math\.min\(maxIndex, this\.currentIndex \+ step\);\s*this\.flipPage\("next"\);\s*\}/m,
  `next() {\n    if (this.pageFlip) this.pageFlip.flipNext();\n  }`
);

content = content.replace(
  /prev\(\) \{\s*if \(this\.isFlipping\) return;\s*const step = this\.spreadSize\(\);\s*if \(this\.currentIndex === 0\) return;\s*this\.currentIndex = Math\.max\(0, this\.currentIndex - step\);\s*this\.flipPage\("prev"\);\s*\}/m,
  `prev() {\n    if (this.pageFlip) this.pageFlip.flipPrev();\n  }`
);

// 7. Update close
content = content.replace(
  /close\(\) \{([\s\S]*?)document\.removeEventListener\("keydown", this\.boundKeydown\);\s*\}/m,
  `close() {
    if (!this.root) return;
    this.root.hidden = true;
    document.body.classList.remove("egazete-open", "egazete-printing");
    if (!document.querySelector(".reader-open")) document.body.classList.remove("modal-open");
    this.isOpen = false;
    this.isFullscreen = false;
    const shell = this.root.querySelector(".egazete-shell");
    if (shell) shell.classList.remove("is-fullscreen");
    document.removeEventListener("keydown", this.boundKeydown);
    if (this.pageFlip) {
      this.pageFlip.destroy();
      this.pageFlip = null;
    }
  }`
);

fs.writeFileSync("js/components/eGazeteMode.js", content);
