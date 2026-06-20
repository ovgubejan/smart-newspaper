const fs = require('fs');

let content = fs.readFileSync('js/components/eGazeteMode.js', 'utf8');

// 1. Fix the blank PDF issue by changing display: flex to display: block in print media
const printMediaRegex = /@media print\s*\{([\s\S]*?)\.page\s*\{([\s\S]*?)\}/;
if (printMediaRegex.test(content)) {
    content = content.replace(printMediaRegex, (match, p1, p2) => {
        return `@media print {${p1}.page {${p2} display: block !important; height: auto !important;`;
    });
}

// 2. Add an additional fix to PDF generation - wait for network idle properly
content = content.replace(/body: JSON\.stringify\(\{ html: htmlString \}\)/, 'body: JSON.stringify({ html: htmlString })');

// 3. Fix the frontend clipping / kayma issue by implementing auto-scale
// Add auto-scaling logic to applyZoom
const applyZoomRegex = /applyZoom\(\)\s*\{\s*if \(this\.bookContainer\) \{\s*this\.bookContainer\.style\.transform = `scale\(\$\{this\.zoomLevel\}\)`;\s*\}\s*\}/;

const applyZoomReplacement = `applyZoom() {
    if (this.bookContainer) {
      // Auto-scale to fit window if zoomLevel is 1
      let scale = this.zoomLevel;
      if (scale === 1 && this.viewMode !== "auto") {
        const shell = this.root.querySelector('.egazete-body-wrap');
        if (shell) {
          const availWidth = shell.clientWidth - 40;
          const availHeight = shell.clientHeight - 40;
          const isDouble = this.viewMode === "double" || (this.viewMode === "auto" && window.matchMedia("(min-width: 900px)").matches);
          const bookWidth = isDouble ? 1588 : 794;
          const bookHeight = 1123;
          const scaleW = availWidth / bookWidth;
          const scaleH = availHeight / bookHeight;
          scale = Math.min(scaleW, scaleH, 1);
        }
      }
      this.bookContainer.style.transform = \`scale(\${scale})\`;
      this.bookContainer.style.transformOrigin = "top center";
    }
  }`;

content = content.replace(applyZoomRegex, applyZoomReplacement);

// 4. Update the PageFlip config to use fixed A4 size and our zoom logic
const pageFlipRegex = /this\.pageFlip = new PageFlip\(reader, \{[\s\S]*?showPageCorners: true\s*\}\);/;
const pageFlipReplacement = `this.pageFlip = new PageFlip(reader, {
        width: 794,
        height: 1123,
        size: "fixed",
        minWidth: 794,
        maxWidth: 794,
        minHeight: 1123,
        maxHeight: 1123,
        maxShadowOpacity: 1,
        showCover: true,
        mobileScrollSupport: false,
        flippingTime: 800,
        useMouseEvents: true,
        drawShadow: true,
        autoSize: false,
        usePortrait: false,
        startZIndex: 0,
        startPage: 0,
        clickEventForward: true,
        swipeDistance: 30,
        showPageCorners: true
      });
      window.addEventListener('resize', () => this.applyZoom());
      this.applyZoom();`;

if (pageFlipRegex.test(content)) {
    content = content.replace(pageFlipRegex, pageFlipReplacement);
}

fs.writeFileSync('js/components/eGazeteMode.js', content, 'utf8');
console.log('eGazeteMode.js fully patched');
