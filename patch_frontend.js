const fs = require('fs');

// Patch eGazeteMode.js for printPdf
let jsContent = fs.readFileSync('js/components/eGazeteMode.js', 'utf8');

const printPdfTarget = `  async printPdf() {
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
  }`;

// Note: I will use regex to find and replace the async printPdf() function to avoid character encoding mismatches.
const printPdfRegex = /async printPdf\(\) \{[\s\S]*?finally \{\s*document\.body\.removeChild\(container\);\s*\}\s*\}/;

const printPdfReplacement = `  async printPdf() {
    this.pages = this.pages.length ? this.pages : this.buildPages();
    const htmlString = this.buildPdfHtml();
    
    if (typeof window.showToast === "function") window.showToast("PDF sunucuda hazırlanıyor, lütfen bekleyin...", "info");
    
    try {
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: htmlString })
      });
      
      if (!response.ok) throw new Error("Sunucu PDF oluşturamadı");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = \`SmartNewspaper_\${formatTurkishDate().replace(/ /g,"_")}.pdf\`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
      if (typeof window.showToast === "function") window.showToast("PDF başarıyla indirildi.", "success");
    } catch (e) {
      console.error("PDF Export Error:", e);
      if (typeof window.showToast === "function") window.showToast("PDF oluşturulurken hata oluştu.", "error");
    }
  }`;

if (printPdfRegex.test(jsContent)) {
    jsContent = jsContent.replace(printPdfRegex, printPdfReplacement);
} else {
    console.error("Could not find printPdf function with regex!");
}

fs.writeFileSync('js/components/eGazeteMode.js', jsContent, 'utf8');

// Patch egazete.css for pagination
let cssContent = fs.readFileSync('css/egazete.css', 'utf8');

const cssTarget = `.egazete-editorial-columns {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}`;

const cssReplacement = `.egazete-editorial-columns {
  column-count: 2;
  column-gap: 24px;
  display: block;
}

.egazete-editorial-block {
  break-inside: avoid;
  margin-bottom: 24px;
}

/* Kayma engelleyici sabit yükseklik */
.egazete-inner-page.egazete-editorial-page {
  height: 297mm;
  width: 210mm;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

@media print {
  body { margin: 0; padding: 0; }
  .egazete-page {
    width: 210mm;
    height: 297mm;
    page-break-after: always;
    page-break-inside: avoid;
    box-shadow: none !important;
  }
}`;

if (cssContent.includes('.egazete-editorial-columns {')) {
    // If exact match not found, we append to the end.
    if (cssContent.includes(cssTarget)) {
        cssContent = cssContent.replace(cssTarget, cssReplacement);
    } else {
        cssContent += "\n" + cssReplacement;
    }
} else {
    cssContent += "\n" + cssReplacement;
}

fs.writeFileSync('css/egazete.css', cssContent, 'utf8');
console.log('Frontend patched successfully');
