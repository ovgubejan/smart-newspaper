const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

async function build() {
  const distDir = path.join(__dirname, "dist");
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

  const jsResult = await esbuild.build({
    entryPoints: ["js/app.js"],
    bundle: true,
    minify: true,
    sourcemap: true,
    format: "esm",
    outfile: "dist/app.min.js",
    target: ["es2020"],
    logLevel: "info"
  });

  const cssFiles = ["css/style.css", "css/dashboard.css", "css/egazete.css", "css/chatbot.css"];
  const cssContents = cssFiles.map(f => fs.readFileSync(f, "utf8")).join("\n");
  const tmpCss = path.join(__dirname, "css", "_combined.css");
  fs.writeFileSync(tmpCss, cssContents);

  await esbuild.build({
    entryPoints: [tmpCss],
    bundle: true,
    minify: true,
    outfile: "dist/style.min.css",
    logLevel: "info"
  });

  fs.unlinkSync(tmpCss);

  const mockData = fs.readFileSync("js/mock-data.js", "utf8");
  const mockResult = await esbuild.transform(mockData, { minify: true });
  fs.writeFileSync("dist/mock-data.min.js", mockResult.code);

  const origJs = fs.statSync("js/app.js").size;
  const minJs = fs.statSync("dist/app.min.js").size;
  const origCss = cssFiles.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  const minCss = fs.statSync("dist/style.min.css").size;

  console.log(`\nJS:  ${(origJs/1024).toFixed(0)}KB -> ${(minJs/1024).toFixed(0)}KB (${(100-minJs/origJs*100).toFixed(0)}% reduction)`);
  console.log(`CSS: ${(origCss/1024).toFixed(0)}KB -> ${(minCss/1024).toFixed(0)}KB (${(100-minCss/origCss*100).toFixed(0)}% reduction)`);
}

build().catch(e => { console.error(e); process.exit(1); });
