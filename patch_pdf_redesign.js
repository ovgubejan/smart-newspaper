const fs = require('fs');

let content = fs.readFileSync('js/components/eGazeteMode.js', 'utf8');

const regex = /\/\/\s*===================\s*PDF\s*===================\s*[\s\S]*?(?=async printPdf\(\) \{)/;

const replacement = `// =================== PDF ===================
  buildPdfHtml() {
    const profile = this.getProfile() || {};
    const paperName = profile.paperName || "Smart Newspaper";
    const name = profile.name || "Okuyucu";
    const todayStr = formatTurkishDate();

    // Flatten all articles
    const allArticles = [];
    this.pages.forEach(p => {
      if (p.article) allArticles.push(p.article);
      if (p.articles) allArticles.push(...p.articles);
    });
    // Remove duplicates by ID or title
    const uniqueArticles = [];
    const seen = new Set();
    allArticles.forEach(a => {
      const key = a.id || a.title;
      if (key && !seen.has(key)) {
        seen.add(key);
        uniqueArticles.push(a);
      }
    });

    // We will create a continuous document and let CSS handle page breaks
    const headerHtml = \`
      <div class="pdf-doc-header">
        <h1 class="pdf-brand">\${escapeHtml(paperName.toUpperCase())}</h1>
        <div class="pdf-meta-bar">
          <span>\${escapeHtml(todayStr)}</span>
          <span>AI Destekli Kişisel Baskı</span>
          <span>Sayın \${escapeHtml(name)}</span>
        </div>
      </div>
    \`;

    const articlesHtml = uniqueArticles.map((article, i) => {
      const isLead = i === 0;
      const imgUrl = article.imageUrl || article.image || article.urlToImage || "";
      const imgHtml = imgUrl ? \`<img class="pdf-article-img" src="\${escapeHtml(imgUrl)}" alt="">\` : "";
      
      return \`
        <div class="pdf-article \${isLead ? 'pdf-lead-article' : ''}">
          <div class="pdf-article-meta">
            <span class="pdf-cat">\${escapeHtml(article.category || "Gündem")}</span>
            <span class="pdf-src">\${escapeHtml(article.source || "")}</span>
            <span class="pdf-date">\${escapeHtml(this.articleDate(article))}</span>
          </div>
          <h2 class="pdf-headline">\${escapeHtml(article.title || "")}</h2>
          \${isLead && imgHtml ? \`<div class="pdf-lead-img-wrap">\${imgHtml}</div>\` : ''}
          <div class="pdf-article-body">
             \${!isLead && imgHtml ? \`<div class="pdf-inline-img-wrap">\${imgHtml}</div>\` : ''}
             \${escapeHtml(article.fullText || article.content || article.summary || article.description || "").replace(/\\n/g, '<br><br>')}
          </div>
        </div>
      \`;
    }).join("");

    return \`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>\${escapeHtml(paperName)} — \${todayStr}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: Georgia, "Times New Roman", serif; 
      background: #fff; 
      color: #111;
      padding: 0;
      margin: 0;
    }
    
    .pdf-container {
      max-width: 210mm;
      margin: 0 auto;
      padding: 15mm;
    }

    .pdf-doc-header {
      text-align: center;
      margin-bottom: 10mm;
      border-bottom: 2px solid #111;
      padding-bottom: 5mm;
    }

    .pdf-brand {
      font-family: "Playfair Display", Georgia, serif;
      font-size: 36pt;
      font-weight: 900;
      color: #0b1e40;
      margin-bottom: 3mm;
    }

    .pdf-meta-bar {
      display: flex;
      justify-content: space-between;
      font-family: Inter, sans-serif;
      font-size: 9pt;
      font-weight: 700;
      border-top: 1px solid #111;
      padding-top: 2mm;
    }

    .pdf-article {
      margin-bottom: 15mm;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .pdf-article-meta {
      display: flex;
      gap: 10px;
      font-family: Inter, sans-serif;
      font-size: 8pt;
      font-weight: 800;
      text-transform: uppercase;
      margin-bottom: 3mm;
      color: #555;
    }

    .pdf-cat { color: #8B1A1A; }

    .pdf-headline {
      font-family: "Playfair Display", Georgia, serif;
      font-size: 20pt;
      font-weight: 900;
      line-height: 1.15;
      margin-bottom: 4mm;
      color: #111;
    }

    .pdf-lead-article .pdf-headline {
      font-size: 28pt;
    }

    .pdf-lead-img-wrap {
      width: 100%;
      height: auto;
      margin-bottom: 5mm;
    }

    .pdf-inline-img-wrap {
      float: right;
      width: 60mm;
      margin: 0 0 4mm 5mm;
    }

    .pdf-article-img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: cover;
    }

    .pdf-article-body {
      font-size: 10pt;
      line-height: 1.6;
      text-align: justify;
      column-count: 2;
      column-gap: 8mm;
    }

    .pdf-lead-article .pdf-article-body {
      column-count: 2;
    }

    /* Print styles */
    @media print {
      @page { size: A4 portrait; margin: 15mm; }
      body { background: #fff !important; }
      .pdf-container { padding: 0; max-width: none; }
      .pdf-article { page-break-inside: avoid; break-inside: avoid; margin-bottom: 10mm; }
      /* Ensure images don't break across pages */
      img { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="pdf-container">
    \${headerHtml}
    \${articlesHtml}
  </div>
</body>
</html>\`;
  }

  `;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('js/components/eGazeteMode.js', content, 'utf8');
    console.log('PDF logic fully replaced');
} else {
    console.error('Could not find PDF section in eGazeteMode.js!');
}
