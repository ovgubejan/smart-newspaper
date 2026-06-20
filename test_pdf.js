const { chromium } = require('playwright');
const fs = require('fs');

async function testPdf() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: red; color: white; font-size: 50px; }
    .page { width: 210mm; height: 297mm; background: blue; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="page">HELLO WORLD! THIS IS A TEST PDF</div>
</body>
</html>`;
  
  await page.setContent(html, { waitUntil: 'networkidle' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
  fs.writeFileSync('test_pdf.pdf', pdfBuffer);
  await browser.close();
  console.log("Done");
}

testPdf().catch(console.error);
