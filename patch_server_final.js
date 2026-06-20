const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// 1. Add requires
if (!content.includes('const cheerio = require("cheerio");')) {
    content = content.replace(
        'const childProcess = require("child_process");',
        'const childProcess = require("child_process");\nconst cheerio = require("cheerio");\nconst { chromium } = require("playwright");'
    );
}

// 2. Modify fetchArticleFullText
const fetchFunctionTarget = `  try {
    const html = await fetchText(article.sourceUrl, {
      headers: {
        "User-Agent": "KisiselGazetem/1.0 Article Reader",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6"
      }
    });
    const fullText = extractArticleTextFromHtmlRich(html) || extractArticleTextFromHtml(html);
    if (fullText.length > existing.length + 120 || fullText.length > Math.max(900, String(article.summary || "").length + 350)) {`;

const fetchFunctionReplacement = `  try {
    const html = await fetchText(article.sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6"
      }
    });
    
    const $ = cheerio.load(html);
    let fullText = "";
    let image = article.imageUrl || article.image || "";

    const urlLower = article.sourceUrl.toLowerCase();
    if (urlLower.includes("cnnturk.com")) {
      fullText = $(".detail-content p, .news-content p").map((i, el) => $(el).text().trim()).get().join("\\n\\n");
      if (!image) image = $("meta[property='og:image']").attr("content") || "";
    } else if (urlLower.includes("sozcu.com.tr")) {
      fullText = $(".article-body p, .news-detail-text p").map((i, el) => $(el).text().trim()).get().join("\\n\\n");
      if (!image) image = $("meta[property='og:image']").attr("content") || "";
    } else if (urlLower.includes("france24.com")) {
      fullText = $(".t-content__body p").map((i, el) => $(el).text().trim()).get().join("\\n\\n");
    } else {
      fullText = extractArticleTextFromHtmlRich(html) || extractArticleTextFromHtml(html);
    }

    if (image && !article.imageUrl) article.imageUrl = image;

    if (fullText.length > existing.length + 120 || fullText.length > Math.max(900, String(article.summary || "").length + 350)) {`;

content = content.replace(fetchFunctionTarget, fetchFunctionReplacement);

// 3. Add API Endpoint
const apiTarget = `      return json(res, 200, { dailyData, topArticles });
    }

    return json(res, 404, { error: "Admin API bulunamadı." });
  }

  return json(res, 404, { error: "API bulunamadı." });
}`;

const apiReplacement = `      return json(res, 200, { dailyData, topArticles });
    }

    return json(res, 404, { error: "Admin API bulunamadı." });
  }

  if (req.method === "POST" && url.pathname === "/api/export-pdf") {
    try {
      const body = await readBody(req);
      if (!body.html) return json(res, 400, { error: "HTML content required" });

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent(body.html, { waitUntil: "networkidle" });
      
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        displayHeaderFooter: false
      });
      
      await browser.close();
      
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\\"smart_newspaper.pdf\\"",
        "Content-Length": pdfBuffer.length
      });
      return res.end(pdfBuffer);
    } catch (err) {
      logError("pdf", "PDF export failed", err.message);
      return json(res, 500, { error: "PDF export failed: " + err.message });
    }
  }

  return json(res, 404, { error: "API bulunamadı." });
}`;

content = content.replace(apiTarget, apiReplacement);

fs.writeFileSync('server.js', content, 'utf8');
console.log('server.js patched successfully');
