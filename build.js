const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

function localFilePlugin() {
  return {
    name: "local-file-resolver",
    setup(build) {
      build.onResolve({ filter: /^[^./]|^@/ }, (args) => {
        const parts = args.path.split("/");
        const packageName = args.path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
        const subPath = args.path.startsWith("@") ? parts.slice(2).join("/") : parts.slice(1).join("/");
        const packageDir = path.join(__dirname, "node_modules", packageName);
        const packageJsonPath = path.join(packageDir, "package.json");
        if (!fs.existsSync(packageJsonPath)) return null;
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        const browserField = typeof manifest.browser === "string" ? manifest.browser : "";
        const entry = subPath || browserField || manifest.module || manifest.main || "index.js";
        const candidate = path.join(packageDir, entry);
        const paths = path.extname(candidate)
          ? [candidate]
          : [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.cjs`, path.join(candidate, "index.js")];
        const resolved = paths.find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
        return resolved ? { path: resolved } : null;
      });

      build.onResolve({ filter: /^\./ }, (args) => {
        const baseDir = args.resolveDir || __dirname;
        const candidate = path.resolve(baseDir, args.path);
        const paths = path.extname(candidate)
          ? [candidate]
          : [candidate, `${candidate}.js`, `${candidate}.css`];
        const resolved = paths.find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
        if (!resolved) return null;
        return { path: resolved };
      });

      build.onLoad({ filter: /\.(mjs|cjs|js|css)$/ }, (args) => ({
        contents: fs.readFileSync(args.path, "utf8"),
        loader: path.extname(args.path) === ".css" ? "css" : "js"
      }));
    }
  };
}

async function build() {
  const distDir = path.join(__dirname, "dist");
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

  const appEntry = path.join(__dirname, "js", "app.js");
  const jsResult = await esbuild.build({
    stdin: {
      contents: fs.readFileSync(appEntry, "utf8"),
      resolveDir: path.dirname(appEntry),
      sourcefile: appEntry,
      loader: "js"
    },
    bundle: true,
    minify: true,
    sourcemap: true,
    format: "esm",
    outfile: path.join(distDir, "app.min.js"),
    target: ["es2020"],
    logLevel: "info",
    plugins: [localFilePlugin()]
  });

  const cssFiles = ["css/style.css", "css/dashboard.css", "css/egazete.css", "css/chatbot.css"];
  const cssContents = cssFiles.map(f => fs.readFileSync(f, "utf8")).join("\n");
  const tmpCss = path.join(__dirname, "css", "_combined.css");
  fs.writeFileSync(tmpCss, cssContents);

  await esbuild.build({
    stdin: {
      contents: fs.readFileSync(tmpCss, "utf8"),
      resolveDir: path.dirname(tmpCss),
      sourcefile: tmpCss,
      loader: "css"
    },
    bundle: true,
    minify: true,
    outfile: path.join(distDir, "style.min.css"),
    logLevel: "info",
    plugins: [localFilePlugin()]
  });

  fs.unlinkSync(tmpCss);

  const mockData = fs.readFileSync("js/mock-data.js", "utf8");
  const mockResult = await esbuild.transform(mockData, { minify: true });
  fs.writeFileSync(path.join(distDir, "mock-data.min.js"), mockResult.code);

  const origJs = fs.statSync("js/app.js").size;
  const minJs = fs.statSync(path.join(distDir, "app.min.js")).size;
  const origCss = cssFiles.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  const minCss = fs.statSync(path.join(distDir, "style.min.css")).size;

  console.log(`\nJS:  ${(origJs/1024).toFixed(0)}KB -> ${(minJs/1024).toFixed(0)}KB (${(100-minJs/origJs*100).toFixed(0)}% reduction)`);
  console.log(`CSS: ${(origCss/1024).toFixed(0)}KB -> ${(minCss/1024).toFixed(0)}KB (${(100-minCss/origCss*100).toFixed(0)}% reduction)`);
}

build().catch(e => { console.error(e); process.exit(1); });
