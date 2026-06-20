const fs = require('fs');

let content = fs.readFileSync('js/components/eGazeteMode.js', 'utf8');

const applyZoomReplacement2 = `applyZoom() {
    if (this.bookContainer) {
      let scale = this.zoomLevel;
      if (scale === 1) {
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

content = content.replace(/applyZoom\(\)\s*\{[\s\S]*?transformOrigin = "top center";\s*\}\s*\}/, applyZoomReplacement2);

fs.writeFileSync('js/components/eGazeteMode.js', content, 'utf8');
console.log('eGazeteMode.js scale patched');
