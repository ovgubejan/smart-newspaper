const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

const replacement = `
  if (req.method === "POST" && url.pathname === "/api/export-pdf") {
    try {
      let bodyData = "";
      req.on("data", chunk => { bodyData += chunk.toString(); });
      await new Promise((resolve, reject) => {
        req.on("end", resolve);
        req.on("error", reject);
      });
      const body = JSON.parse(bodyData);

      if (!body.html) return json(res, 400, { error: "HTML content required" });

      const browser = await require("playwright").chromium.launch({ headless: true });
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
      console.error("PDF export failed:", err);
      return json(res, 500, { error: "PDF export failed: " + err.message });
    }
  }

  return json(res, 404, { error: "API bulunamadı." });
}`;

// Use \r?\n to handle both LF and CRLF
const targetRegex = /  return json\(res, 404, \{ error: "API bulunamadı\." \}\);\r?\n\}/g;

if (targetRegex.test(content)) {
    content = content.replace(targetRegex, replacement);
    fs.writeFileSync('server.js', content, 'utf8');
    console.log('Endpoint patched');
} else {
    console.error('Target regex not found!');
}
