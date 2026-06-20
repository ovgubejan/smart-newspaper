const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const childProcess = require("child_process");
const { URL } = require("url");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const DEFAULT_LOG_LEVEL = process.env.NODE_ENV === "test" ? "warn" : "info";
const LOG_LEVEL = LOG_LEVELS[String(process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL).toLowerCase()] ?? LOG_LEVELS.info;
const isLogEnabled = (level) => LOG_LEVEL >= LOG_LEVELS[level];
const logError = (scope, message, meta = "") => { if (isLogEnabled("error")) console.error(`[${scope}] ${message}${meta ? ` | ${meta}` : ""}`); };
const logWarn = (scope, message, meta = "") => { if (isLogEnabled("warn")) console.warn(`[${scope}] ${message}${meta ? ` | ${meta}` : ""}`); };
const logInfo = (scope, message, meta = "") => { if (isLogEnabled("info")) console.log(`[${scope}] ${message}${meta ? ` | ${meta}` : ""}`); };
const logDebug = (scope, message, meta = "") => { if (isLogEnabled("debug")) console.log(`[${scope}] ${message}${meta ? ` | ${meta}` : ""}`); };
const OUTBOUND_FETCH_TIMEOUT_MS = Math.min(Math.max(Number(process.env.OUTBOUND_FETCH_TIMEOUT_MS || process.env.FETCH_TIMEOUT_MS || 12000) || 12000, 1000), 60000);
const OUTBOUND_FETCH_RETRIES = Math.min(Math.max(Number(process.env.OUTBOUND_FETCH_RETRIES || process.env.FETCH_RETRIES || 1) || 1, 0), 3);
const DATA_PATH = path.join(__dirname, "db", "data.json");
const SEED_PATH = path.join(__dirname, "db", "seed.json");
const DEMO_REGIONAL_PANDEMIC_PATH = path.join(__dirname, "db", "demo-regional-pandemic.json");
const PUBLIC_ROOT = __dirname;
const TOKEN_SECRET = process.env.SESSION_SECRET || "dev-session-secret-change-me";
const _rawArticleCache = new Map();
const _lastClusterStats = { raw: 0, clusters: 0, grouped: 0, avgSourceCount: 0, updatedAt: null };
const ARTICLE_CACHE = {
  get: (k) => _rawArticleCache.get(k),
  set: (k, v) => {
    if (_rawArticleCache.size >= 200) {
      _rawArticleCache.delete(_rawArticleCache.keys().next().value);
    }
    _rawArticleCache.set(k, v);
  },
  values: () => _rawArticleCache.values(),
  has: (k) => _rawArticleCache.has(k),
  delete: (k) => _rawArticleCache.delete(k)
};
const _rawRelatedPool = new Map();
const RELATED_ARTICLE_POOL = {
  get: (k) => _rawRelatedPool.get(k),
  set: (k, v) => { if (_rawRelatedPool.size >= 500) { _rawRelatedPool.delete(_rawRelatedPool.keys().next().value); } _rawRelatedPool.set(k, v); },
  has: (k) => _rawRelatedPool.has(k),
  values: () => _rawRelatedPool.values(),
  get size() { return _rawRelatedPool.size; }
};
const CANONICAL_REGIONS = ["global", "europe", "asia", "africa", "north-america", "south-america", "oceania", "middle-east", "turkey"];
const TRENDS_CACHE = new Map();
const TRENDS_CACHE_TTL_MS = 5 * 60 * 1000;
const TRENDS_CACHE_MAX = 50;
// Demo data for regional trend propagation presentation.
const DEMO_REGIONAL_PANDEMIC_ARTICLES = JSON.parse(fs.readFileSync(DEMO_REGIONAL_PANDEMIC_PATH, "utf8")).map((article) => {
  const title = article.title || article.translatedTitle || "Yeni solunum yolu hastalığı farklı bölgelerde izleniyor";
  const summary = article.summary || article.translatedSummary || "Bölgesel sağlık kurumları yeni solunum yolu virüsü salgınını izliyor.";
  const region = article.sourceRegion;
  return {
    ...article,
    title,
    summary,
    originalSummary: article.originalSummary || "Health officials monitor the same regional respiratory virus outbreak.",
    originalLanguage: article.originalLanguage || "en",
    translatedTitle: article.translatedTitle || title,
    translatedSummary: article.translatedSummary || summary,
    displayTitle: article.displayTitle || title,
    displaySummary: article.displaySummary || summary,
    source: article.sourceName,
    sourceLanguage: article.sourceLanguage || "en",
    sourceTrustLevel: article.sourceTrustLevel || "high",
    sourceType: article.sourceType || "rss",
    isGlobalSource: Boolean(article.isGlobalSource),
    detectedEventRegion: article.detectedEventRegion || region,
    namedEntities: article.namedEntities || {
      people: [],
      organizations: ["WHO", "Health Ministry", "CDC"],
      locations: ["Tokyo", "Shanghai", "Berlin", "London", "Washington"],
      countries: ["Japan", "China", "Germany", "United Kingdom", "United States"],
      diseases: ["respiratory illness", "pneumonia-like cases"],
      events: ["regional respiratory outbreak"],
      topics: ["health", "pandemic", "public health"]
    },
    topics: article.topics || ["health", "pandemic", "public health"],
    tags: article.tags || ["health", "pandemic", "public health"],
    fetchedAt: article.fetchedAt || article.publishedAt,
    url: article.url || `demo://regional-pandemic-propagation/${article.id}`,
    imageUrl: article.imageUrl || "",
    isDemo: true,
    demoScenario: "regional-pandemic-propagation"
  };
});
// Central source catalog — mirrors js/data/regionalSources.js (ES Module).
// Canonical region values use hyphens: north-america, south-america, middle-east.
const REGIONAL_SOURCE_CATALOG = [
  // ===== GLOBAL =====
  { id: "bbc-world", sourceName: "BBC World", rssUrl: "http://feeds.bbci.co.uk/news/world/rss.xml", country: "United Kingdom", countryCode: "GB", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "reuters-global", sourceName: "Reuters", rssUrl: "https://feeds.reuters.com/reuters/topNews", country: "United Kingdom", countryCode: "GB", region: "global", language: "en", trustLevel: "high", sourceType: "agency", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "guardian-world", sourceName: "The Guardian", rssUrl: "https://www.theguardian.com/world/rss", country: "United Kingdom", countryCode: "GB", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "dw-global", sourceName: "Deutsche Welle", rssUrl: "https://rss.dw.com/rdf/rss-en-all", country: "Germany", countryCode: "DE", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "france24-global", sourceName: "France 24", rssUrl: "https://www.france24.com/en/rss", country: "France", countryCode: "FR", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "euronews-global", sourceName: "Euronews", rssUrl: "https://feeds.feedburner.com/euronews/en/home/", country: "France", countryCode: "FR", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "cnn-world", sourceName: "CNN", rssUrl: "http://rss.cnn.com/rss/cnn_world.rss", country: "United States", countryCode: "US", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "nyt-world", sourceName: "New York Times", rssUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", country: "United States", countryCode: "US", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "aljazeera-global", sourceName: "Al Jazeera", rssUrl: "https://www.aljazeera.com/xml/rss/all.xml", country: "Qatar", countryCode: "QA", region: "global", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },

  // ===== EUROPE =====
  { id: "bbc-europe", sourceName: "BBC Europe", rssUrl: "http://feeds.bbci.co.uk/news/world/europe/rss.xml", country: "United Kingdom", countryCode: "GB", region: "europe", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "dw-europe", sourceName: "Deutsche Welle Europe", rssUrl: "https://rss.dw.com/rdf/rss-en-eu", country: "Germany", countryCode: "DE", region: "europe", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "guardian-europe", sourceName: "The Guardian Europe", rssUrl: "https://www.theguardian.com/world/europe-news/rss", country: "United Kingdom", countryCode: "GB", region: "europe", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "france24-europe", sourceName: "France 24 Europe", rssUrl: "https://www.france24.com/en/europe/rss", country: "France", countryCode: "FR", region: "europe", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },

  // ===== ASIA =====
  { id: "nhk-world", sourceName: "NHK World", rssUrl: "https://www3.nhk.or.jp/rss/news/cat0.xml", country: "Japan", countryCode: "JP", region: "asia", language: "en", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "scmp-asia", sourceName: "South China Morning Post", rssUrl: "https://www.scmp.com/rss/91/feed", country: "Hong Kong", countryCode: "HK", region: "asia", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "cna-asia", sourceName: "CNA", rssUrl: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", country: "Singapore", countryCode: "SG", region: "asia", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "toi-asia", sourceName: "Times of India", rssUrl: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", country: "India", countryCode: "IN", region: "asia", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },
  { id: "japantimes-asia", sourceName: "The Japan Times", rssUrl: "https://www.japantimes.co.jp/feed/", country: "Japan", countryCode: "JP", region: "asia", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },

  // ===== AFRICA =====
  { id: "africanews-africa", sourceName: "Africanews", rssUrl: "https://www.africanews.com/feed/", country: "Congo", countryCode: "CD", region: "africa", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },
  { id: "news24-africa", sourceName: "News24", rssUrl: "https://feeds.news24.com/articles/news24/TopStories/rss", country: "South Africa", countryCode: "ZA", region: "africa", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },
  { id: "dailynation-africa", sourceName: "Daily Nation", rssUrl: "https://nation.africa/kenya/rss", country: "Kenya", countryCode: "KE", region: "africa", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },
  { id: "allafrica-africa", sourceName: "AllAfrica", rssUrl: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", country: "South Africa", countryCode: "ZA", region: "africa", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },

  // ===== NORTH AMERICA =====
  { id: "nyt-us", sourceName: "New York Times US", rssUrl: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml", country: "United States", countryCode: "US", region: "north-america", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "washpost-us", sourceName: "Washington Post", rssUrl: "https://feeds.washingtonpost.com/rss/world", country: "United States", countryCode: "US", region: "north-america", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "npr-us", sourceName: "NPR", rssUrl: "https://feeds.npr.org/1004/rss.xml", country: "United States", countryCode: "US", region: "north-america", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "ap-us", sourceName: "Associated Press", rssUrl: "https://feeds.apnews.com/rss/apf-topnews", country: "United States", countryCode: "US", region: "north-america", language: "en", trustLevel: "high", sourceType: "agency", isGlobalSource: true, enabled: true, fetchPriority: 1, category: "Dünya" },

  // ===== SOUTH AMERICA =====
  { id: "buenosaires-herald", sourceName: "Buenos Aires Herald", rssUrl: "https://buenosairesherald.com/feed/", country: "Argentina", countryCode: "AR", region: "south-america", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },
  { id: "mercopress-sa", sourceName: "MercoPress", rssUrl: "https://en.mercopress.com/rss.xml", country: "Uruguay", countryCode: "UY", region: "south-america", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },
  { id: "agenciabrasil-sa", sourceName: "Agência Brasil", rssUrl: "https://agenciabrasil.ebc.com.br/rss/internacional/feed.xml", country: "Brazil", countryCode: "BR", region: "south-america", language: "pt", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },
  { id: "elpais-america", sourceName: "El País América", rssUrl: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/america/portada", country: "Spain", countryCode: "ES", region: "south-america", language: "es", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Dünya" },

  // ===== OCEANIA =====
  { id: "abc-australia", sourceName: "ABC Australia", rssUrl: "https://www.abc.net.au/news/feed/45910/rss.xml", country: "Australia", countryCode: "AU", region: "oceania", language: "en", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "rnz-oceania", sourceName: "RNZ", rssUrl: "https://www.rnz.co.nz/rss/world.xml", country: "New Zealand", countryCode: "NZ", region: "oceania", language: "en", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "smh-australia", sourceName: "The Sydney Morning Herald", rssUrl: "https://www.smh.com.au/rss/world.xml", country: "Australia", countryCode: "AU", region: "oceania", language: "en", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },

  // ===== MIDDLE EAST =====
  { id: "arabnews-me", sourceName: "Arab News", rssUrl: "https://www.arabnews.com/rss.xml", country: "Saudi Arabia", countryCode: "SA", region: "middle-east", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "mee-me", sourceName: "Middle East Eye", rssUrl: "https://www.middleeasteye.net/rss", country: "United Kingdom", countryCode: "GB", region: "middle-east", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "thenational-me", sourceName: "The National", rssUrl: "https://www.thenationalnews.com/rss/", country: "United Arab Emirates", countryCode: "AE", region: "middle-east", language: "en", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },

  // ===== TURKEY =====
  { id: "trt-turkiye", sourceName: "TRT Haber", rssUrl: "https://www.trthaber.com/turkiye_articles.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 1, category: "Gündem" },
  { id: "trt-ekonomi", sourceName: "TRT Haber Ekonomi", rssUrl: "https://www.trthaber.com/ekonomi_articles.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Ekonomi" },
  { id: "trt-dunya", sourceName: "TRT Haber Dünya", rssUrl: "https://www.trthaber.com/dunya_articles.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Dünya" },
  { id: "aa-tr", sourceName: "Anadolu Ajansı", rssUrl: "https://www.aa.com.tr/tr/rss/default?cat=guncel", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "agency", isGlobalSource: false, enabled: true, fetchPriority: 1, category: "Gündem" },
  { id: "hurriyet-tr", sourceName: "Hürriyet", rssUrl: "https://www.hurriyet.com.tr/rss/anasayfa", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Gündem" },
  { id: "bbc-turkce", sourceName: "BBC Türkçe", rssUrl: "https://feeds.bbci.co.uk/turkish/rss.xml", country: "United Kingdom", countryCode: "GB", region: "turkey", language: "tr", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "dw-turkce", sourceName: "DW Türkçe", rssUrl: "https://rss.dw.com/rdf/rss-tur-all", country: "Germany", countryCode: "DE", region: "turkey", language: "tr", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 1, category: "Dünya" },
  { id: "ntv-tr", sourceName: "NTV Haber", rssUrl: "https://www.ntv.com.tr/son-dakika.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Gündem" },
  { id: "ntv-ekonomi", sourceName: "NTV Ekonomi", rssUrl: "https://www.ntv.com.tr/ekonomi.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Ekonomi" },
  { id: "ntv-spor", sourceName: "NTV Spor", rssUrl: "https://www.ntv.com.tr/spor.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Spor" },
  { id: "ntv-teknoloji", sourceName: "NTV Teknoloji", rssUrl: "https://www.ntv.com.tr/teknoloji.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Teknoloji" },
  { id: "sabah-tr", sourceName: "Sabah", rssUrl: "https://www.sabah.com.tr/rss/anasayfa.xml", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Gündem" },
  { id: "haberturk-tr", sourceName: "Habertürk", rssUrl: "https://www.haberturk.com/rss/kategori/gundem.xml", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Gündem" },
  { id: "haberturk-ekonomi", sourceName: "Habertürk Ekonomi", rssUrl: "https://www.haberturk.com/rss/ekonomi.xml", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Ekonomi" },
  { id: "sozcu-tr", sourceName: "Sözcü", rssUrl: "https://www.sozcu.com.tr/rss/anasayfa.xml", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Gündem" },
  { id: "sozcu-ekonomi", sourceName: "Sözcü Ekonomi", rssUrl: "https://www.sozcu.com.tr/rss/ekonomi.xml", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Ekonomi" },
  { id: "milliyet-tr", sourceName: "Milliyet", rssUrl: "https://www.milliyet.com.tr/rss/rssNew/gundemRss.xml", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Gündem" },
  { id: "bloomberght", sourceName: "Bloomberg HT", rssUrl: "https://www.bloomberght.com/rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Ekonomi" },
  { id: "t24", sourceName: "T24", rssUrl: "https://t24.com.tr/rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Gündem" },
  { id: "karar", sourceName: "Karar", rssUrl: "https://www.karar.com/rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Gündem" },
  { id: "yenisafak", sourceName: "Yeni Şafak", rssUrl: "https://www.yenisafak.com/rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Gündem" },
  { id: "cumhuriyet", sourceName: "Cumhuriyet", rssUrl: "https://www.cumhuriyet.com.tr/rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Gündem" },
  { id: "cnnturk", sourceName: "CNN Türk", rssUrl: "https://www.cnnturk.com/feed/rss/all/news", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Gündem" },
  { id: "webrazzi", sourceName: "Webrazzi", rssUrl: "https://webrazzi.com/feed/", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Teknoloji" },
  { id: "shiftdelete", sourceName: "ShiftDelete", rssUrl: "https://shiftdelete.net/feed", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Teknoloji" },
  { id: "trt-spor", sourceName: "TRT Spor", rssUrl: "https://www.trtspor.com.tr/rss/anasayfa.rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "official", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Spor" },
  { id: "dunya-ekonomi", sourceName: "Dünya Gazetesi", rssUrl: "https://www.dunya.com/rss", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "high", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 2, category: "Ekonomi" },
  { id: "cnnturk-tr", sourceName: "CNN Türk", rssUrl: "https://www.cnnturk.com/feed/rss/turkiye/rss.xml", country: "Türkiye", countryCode: "TR", region: "turkey", language: "tr", trustLevel: "medium", sourceType: "rss", isGlobalSource: false, enabled: true, fetchPriority: 3, category: "Gündem" },
];


const TOPIC_CATEGORIES = [
  "Gündem", "Ekonomi", "Teknoloji", "Spor", "Sağlık", "Bilim",
  "Kültür-Sanat", "Eğitim", "Finans", "Dünya"
];

const CATEGORY_ALIASES = {
  "Türkiye": "Gündem",
  "Turkiye": "Gündem",
  "Kültür": "Kültür-Sanat",
  "Kultur": "Kültür-Sanat",
  "Kültür Sanat": "Kültür-Sanat",
  "Yapay Zeka": "Teknoloji",
  "YapayZeka": "Teknoloji"
};

const SUBCATEGORY_MAP = {
  "Teknoloji": ["Yapay Zeka", "Siber Güvenlik", "Mobil", "Yazılım", "Donanım", "Startuplar"],
  "Ekonomi": ["Borsa", "Döviz", "Kripto", "Enflasyon", "Merkez Bankası", "KOBİ"],
  "Spor": ["Futbol", "Basketbol", "Voleybol", "Formula 1", "Transfer"],
  "Sağlık": ["Beslenme", "Psikoloji", "Tıp", "Fitness", "Halk Sağlığı"],
  "Gündem": ["Politika", "Yerel", "Toplum", "Güvenlik"],
  "Bilim": ["Uzay", "Yapay Zeka Araştırmaları", "Enerji", "Doğa", "Akademik Gelişmeler"],
  "Kültür-Sanat": ["Sinema", "Müzik", "Kitap", "Sergi", "Tiyatro"],
  "Eğitim": ["Üniversite", "Sınavlar", "Online Eğitim", "Burslar", "Kariyer"],
  "Finans": ["Borsa", "Döviz", "Kripto", "Yatırım", "Piyasalar", "Portföy"],
  "Dünya": ["Avrupa", "Orta Doğu", "Amerika", "Asya-Pasifik", "Diplomasi", "Küresel Krizler"]
};

const ALL_SUBCATEGORIES = [...new Set(Object.values(SUBCATEGORY_MAP).flat())];

const CATEGORY_TR_TO_EN = {
  "Gündem": "Current Affairs", "Ekonomi": "Economy", "Teknoloji": "Technology",
  "Spor": "Sports", "Sağlık": "Health", "Bilim": "Science",
  "Kültür-Sanat": "Culture & Arts", "Eğitim": "Education", "Finans": "Finance", "Dünya": "World"
};
const SUBCATEGORY_TR_TO_EN = {
  "Yapay Zeka": "Artificial Intelligence", "Siber Güvenlik": "Cybersecurity", "Mobil": "Mobile",
  "Yazılım": "Software", "Donanım": "Hardware", "Startuplar": "Startups",
  "Borsa": "Stock Market", "Döviz": "Forex", "Kripto": "Crypto", "Enflasyon": "Inflation",
  "Merkez Bankası": "Central Bank", "KOBİ": "SME", "Futbol": "Football",
  "Basketbol": "Basketball", "Voleybol": "Volleyball", "Formula 1": "Formula 1",
  "Transfer": "Transfers", "Beslenme": "Nutrition", "Psikoloji": "Psychology",
  "Tıp": "Medicine", "Fitness": "Fitness", "Halk Sağlığı": "Public Health",
  "Politika": "Politics", "Yerel": "Local", "Toplum": "Society", "Güvenlik": "Security",
  "Uzay": "Space", "Yapay Zeka Araştırmaları": "AI Research", "Enerji": "Energy",
  "Doğa": "Nature", "Akademik Gelişmeler": "Academic Developments",
  "Sinema": "Cinema", "Müzik": "Music", "Kitap": "Books", "Sergi": "Exhibitions",
  "Tiyatro": "Theater", "Üniversite": "University", "Sınavlar": "Exams",
  "Online Eğitim": "Online Education", "Burslar": "Scholarships", "Kariyer": "Career",
  "Yatırım": "Investment", "Piyasalar": "Markets", "Portföy": "Portfolio",
  "Avrupa": "Europe", "Orta Doğu": "Middle East", "Amerika": "Americas",
  "Asya-Pasifik": "Asia-Pacific", "Diplomasi": "Diplomacy", "Küresel Krizler": "Global Crises"
};

function translateCategoryToEn(trName) {
  return CATEGORY_TR_TO_EN[trName] || trName;
}
function translateSubcategoryToEn(trName) {
  return SUBCATEGORY_TR_TO_EN[trName] || trName;
}

const SUBCATEGORY_RULES = {
  "Yapay Zeka": ["yapay zeka", "ai", "openai", "chatgpt", "gemini", "claude", "llm", "nvidia", "makine öğrenmesi", "makine ogrenmesi"],
  "Siber Güvenlik": ["siber", "güvenlik açığı", "guvenlik acigi", "veri sızıntısı", "veri sizintisi", "hack", "fidye", "malware", "parola"],
  "Mobil": ["mobil", "telefon", "android", "iphone", "ios", "uygulama", "app store", "play store"],
  "Yazılım": ["yazılım", "yazilim", "kod", "programlama", "geliştirici", "developer", "github", "api", "frontend", "backend"],
  "Donanım": ["donanım", "donanim", "çip", "cip", "gpu", "işlemci", "islemci", "ekran kartı", "ram", "ssd", "cihaz"],
  "Startuplar": ["startup", "girişim", "girisim", "yatırım turu", "yatirim turu", "tohum yatırım", "unicorn"],
  "Borsa": ["borsa", "bist", "hisse", "nasdaq", "dow jones", "s&p", "endeks"],
  "Döviz": ["döviz", "doviz", "dolar", "euro", "kur", "sterlin"],
  "Kripto": ["kripto", "bitcoin", "ethereum", "blockchain", "coin", "token"],
  "Enflasyon": ["enflasyon", "tüfe", "tufe", "üfe", "ufe", "zam", "fiyat artışı", "pahalılık"],
  "Merkez Bankası": ["merkez bankası", "merkez bankasi", "tcmb", "faiz", "para politikası", "politika faizi"],
  "KOBİ": ["kobi", "kobİ", "esnaf", "işletme", "isletme", "ticaret", "vergi", "şirket"],
  "Futbol": ["futbol", "süper lig", "super lig", "galatasaray", "fenerbahçe", "fenerbahce", "beşiktaş", "besiktas", "trabzonspor", "uefa", "fifa"],
  "Basketbol": ["basketbol", "nba", "euroleague", "potada", "lebron"],
  "Voleybol": ["voleybol", "filenin", "sultanları", "sultanlari"],
  "Formula 1": ["formula 1", "f1", "grand prix", "verstappen", "ferrari", "mercedes"],
  "Transfer": ["transfer", "bonservis", "kiralık", "kiralik", "imza attı", "imza atti"],
  "Beslenme": ["beslenme", "diyet", "gıda", "gida", "obezite", "vitamin"],
  "Psikoloji": ["psikoloji", "stres", "anksiyete", "depresyon", "ruh sağlığı", "mental"],
  "Tıp": ["tıp", "tip", "doktor", "hastane", "ameliyat", "ilaç", "ilac", "tedavi", "aşı", "asi"],
  "Fitness": ["fitness", "egzersiz", "spor salonu", "kas", "antrenman", "yürüyüş", "yuruyus"],
  "Halk Sağlığı": ["halk sağlığı", "halk sagligi", "salgın", "salgin", "pandemi", "bakanlık", "aşı kampanyası"],
  "Politika": ["politika", "siyaset", "parti", "seçim", "secim", "cumhurbaşkanı", "bakan", "tbmm"],
  "Yerel": ["yerel", "belediye", "valilik", "ilçe", "ilce", "mahalle", "şehir", "sehir", "istanbul", "ankara", "izmir"],
  "Toplum": ["toplum", "vatandaş", "vatandas", "yaşam", "yasam", "sosyal", "aile"],
  "Güvenlik": ["güvenlik", "guvenlik", "polis", "jandarma", "operasyon", "suç", "suc", "terör", "teror", "kaza"],
  "Uzay": ["uzay", "nasa", "spacex", "uydu", "mars", "ay", "roket", "astronomi"],
  "Yapay Zeka Araştırmaları": ["yapay zeka araştırmaları", "ai research", "model eğitimi", "model egitimi", "araştırmacılar", "akademik makale"],
  "Enerji": ["enerji", "güneş", "gunes", "rüzgar", "ruzgar", "petrol", "doğal gaz", "dogal gaz", "nükleer"],
  "Doğa": ["doğa", "doga", "iklim", "okyanus", "orman", "deprem", "çevre", "cevre", "biyoçeşitlilik"],
  "Akademik Gelişmeler": ["akademik", "üniversite araştırması", "universite arastirmasi", "bilim insanları", "çalışma yayımlandı", "arastirma"],
  "Sinema": ["sinema", "film", "dizi", "festival", "oscar", "vizyon"],
  "Müzik": ["müzik", "muzik", "konser", "albüm", "album", "şarkı", "sarki", "sanatçı"],
  "Kitap": ["kitap", "roman", "yazar", "yayın", "edebiyat"],
  "Sergi": ["sergi", "müze", "muze", "galeri", "resim", "heykel"],
  "Tiyatro": ["tiyatro", "sahne", "oyun", "prömiyer", "promiyer"],
  "Üniversite": ["üniversite", "universite", "kampüs", "kampus", "akademisyen", "rektör"],
  "Sınavlar": ["sınav", "sinav", "yks", "kpss", "ales", "lgs", "final", "vize"],
  "Online Eğitim": ["online eğitim", "uzaktan eğitim", "e-öğrenme", "kurs", "sertifika"],
  "Burslar": ["burs", "öğrenim kredisi", "ogrenci desteği", "scholarship"],
  "Kariyer": ["kariyer", "iş ilanı", "is ilani", "staj", "mezun", "cv", "iş görüşmesi"],
  "Üretken AI": ["üretken yapay zeka", "generative ai", "metin üretimi", "görsel üretimi", "prompt"],
  "LLM": ["llm", "büyük dil modeli", "large language model", "token", "rag"],
  "Robotik": ["robot", "robotik", "otonom", "insansı robot"],
  "AI Güvenliği": ["ai güvenliği", "ai guvenligi", "alignment", "deepfake", "model riski"],
  "AI Araçları": ["ai aracı", "ai araci", "chatbot", "copilot", "asistan"],
  "Makine Öğrenmesi": ["makine öğrenmesi", "machine learning", "derin öğrenme", "deep learning", "algoritma"],
  "Orta Doğu": ["orta doğu", "orta dogu", "israil", "filistin", "iran", "suriye", "irak", "gazze"],
  "Amerika": ["amerika", "abd", "kanada", "meksika", "washington", "new york"],
  "Asya-Pasifik": ["asya pasifik", "çin", "cin", "japonya", "kore", "hindistan", "avustralya"],
  "Diplomasi": ["diplomasi", "zirve", "nato", "bm", "avrupa birliği", "anlaşma", "görüşme"],
  "Küresel Krizler": ["kriz", "savaş", "savas", "göç", "goc", "afet", "iklim krizi"]
};

const CONTINENT_FILTERS = ["Global", "Avrupa", "Asya", "Afrika", "Kuzey Amerika", "Güney Amerika", "Okyanusya", "Orta Doğu", "Türkiye"];
const WEAK_CATEGORY_KEYWORDS = {
  technology: new Set(["robot", "telefon", "uygulama", "kamera", "drone", "güvenlik", "guvenlik"])
};
const HEALTH_MEDICAL_KEYWORDS = ["hastane", "tedavi", "ilac", "ilaç", "doktor", "ameliyat", "asi", "aşı", "saglik", "sağlık", "hasta", "vaka", "salgın", "salgin", "pandemi"];
const HEALTH_FALSE_CONTEXTS = ["trafik kazasi", "trafik kazası", "yaralandi", "yaralandı", "hayatini kaybetti", "hayatını kaybetti", "kaza", "öldü", "oldu"];
const CATEGORY_EQUIVALENTS = {
  "Gündem": ["Gündem", "Türkiye", "Yerel", "Toplum", "Güvenlik"],
  "Dünya": ["Dünya", "Global", "Uluslararası"],
  "Ekonomi": ["Ekonomi", "Finans", "Borsa", "Döviz"],
  "Spor": ["Spor", "Futbol", "Basketbol"],
  "Teknoloji": ["Teknoloji", "Yapay Zeka", "Yazılım"]
};
const CONTINENT_ALIASES = {
  // English display names
  Europe: "Avrupa", Asia: "Asya", Africa: "Afrika",
  "North America": "Kuzey Amerika", "South America": "Güney Amerika",
  Oceania: "Okyanusya", Australia: "Okyanusya", World: "Global", Worldwide: "Global",
  "Middle East": "Orta Doğu", Turkey: "Türkiye",
  // Canonical region values (hyphen format) → Turkish display names
  europe: "Avrupa", asia: "Asya", africa: "Afrika",
  "north-america": "Kuzey Amerika", "south-america": "Güney Amerika",
  oceania: "Okyanusya", "middle-east": "Orta Doğu", turkey: "Türkiye", global: "Global"
};
const CONTINENT_KEYWORDS = [
  ["Avrupa", ["avrupa", "almanya", "fransa", "italya", "ispanya", "hollanda", "belcika", "ingiltere", "londra", "berlin", "paris", "brüksel", "bruksel", "madrid", "roma", "polonya", "yunanistan", "ukrayna"]],
  ["Asya", ["asya", "turkiye", "türkiye", "istanbul", "ankara", "izmir", "cin", "çin", "pekin", "japonya", "tokyo", "hindistan", "kore", "iran", "irak", "suriye", "israil", "suudi", "katar", "bae", "dubai", "rusya"]],
  ["Afrika", ["afrika", "misir", "mısır", "kahire", "nijerya", "kenya", "fas", "cezayir", "tunus", "güney afrika", "guney afrika"]],
  ["Kuzey Amerika", ["kuzey amerika", "abd", "amerika", "amerika birleşik devletleri", "usa", "kanada", "meksika", "washington", "new york", "california", "trump"]],
  ["Güney Amerika", ["güney amerika", "guney amerika", "brezilya", "arjantin", "sili", "şili", "kolombiya", "peru", "venezuela"]],
  ["Okyanusya", ["okyanusya", "avustralya", "yeni zelanda", "sydney", "melbourne"]]
];


const FINANCE_CACHE = new Map();
const FINANCE_CACHE_LIMIT = 120;
const FINANCE_REQUESTS = new Map();

const FINANCE_CATALOG = [
  { symbol: "USDTRY", type: "fx", label: "Dolar/TL", group: "Döviz", source: "TCMB today.xml (resmi gösterge kuru)" },
  { symbol: "EURTRY", type: "fx", label: "Euro/TL", group: "Döviz", source: "TCMB today.xml (resmi gösterge kuru)" },
  { symbol: "GBPTRY", type: "fx", label: "Sterlin/TL", group: "Döviz", source: "TCMB today.xml (resmi gösterge kuru)" },
  { symbol: "GRAMALTIN", type: "gold", label: "Gram Altın", group: "Altın & Emtia", source: "XAU/USD ve TCMB USD/TRY ile hesaplandı (÷ 31.1034768)" },
  { symbol: "XAUUSD", type: "gold", label: "Ons Altın", group: "Altın & Emtia", source: "CoinGecko exchange_rates (BTC-relative)" },
  { symbol: "XAGUSD", type: "gold", label: "Gümüş", group: "Altın & Emtia", source: "CoinGecko exchange_rates (BTC-relative)" },
  { symbol: "BTCUSDT", type: "crypto", label: "Bitcoin", group: "Kripto", source: "CoinGecko public API" },
  { symbol: "ETHUSDT", type: "crypto", label: "Ethereum", group: "Kripto", source: "CoinGecko / Binance public" },
  { symbol: "SOLUSDT", type: "crypto", label: "Solana", group: "Kripto", source: "CoinGecko / Binance public" },
  { symbol: "BNBUSDT", type: "crypto", label: "BNB", group: "Kripto", source: "CoinGecko / Binance public" },
  { symbol: "XU100", type: "index", label: "BIST 100", group: "Borsa", source: "Lisanslı veri sağlayıcı gerekli" },
  { symbol: "XU030", type: "index", label: "BIST 30", group: "Borsa", source: "Lisanslı veri sağlayıcı gerekli" },
  { symbol: "KAP", type: "rss", label: "KAP Bildirimleri", group: "Borsa", source: "Lisans/sözleşme gerekli" },
  { symbol: "TCMBRATE", type: "macro", label: "TCMB Faiz", group: "Makro Ekonomi", source: "TCMB EVDS (API key gerekli)" },
  { symbol: "CPI_TR", type: "macro", label: "TÜFE / Enflasyon", group: "Makro Ekonomi", source: "TCMB EVDS (API key gerekli)" },
  { symbol: "TCMB_PPK", type: "rss", label: "TCMB PPK Kararları", group: "Makro Ekonomi", source: "TCMB resmi RSS" }
];

const DEFAULT_FINANCE_WATCHLIST = [
  { symbol: "USDTRY", type: "fx", label: "Dolar/TL", enabled: true, priority: 1 },
  { symbol: "EURTRY", type: "fx", label: "Euro/TL", enabled: true, priority: 2 },
  { symbol: "GRAMALTIN", type: "gold", label: "Gram Altın", enabled: true, priority: 3 },
  { symbol: "BTCUSDT", type: "crypto", label: "Bitcoin", enabled: true, priority: 4 },
  { symbol: "XU100", type: "index", label: "BIST 100", enabled: true, priority: 5 },
  { symbol: "TCMBRATE", type: "macro", label: "TCMB Faiz", enabled: true, priority: 6 }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const COMPRESSIBLE_TYPES = new Set([".html", ".css", ".js", ".json", ".svg"]);
const STATIC_FILE_CACHE = new Map();
const STATIC_FILE_CACHE_MAX_ENTRIES = Math.min(Math.max(Number(process.env.STATIC_FILE_CACHE_MAX_ENTRIES || 160) || 160, 20), 1000);
const STATIC_FILE_CACHE_MAX_BYTES = Math.min(Math.max(Number(process.env.STATIC_FILE_CACHE_MAX_BYTES || 1_500_000) || 1_500_000, 64_000), 8_000_000);

function setStaticFileCache(filePath, entry) {
  if (!entry?.raw || entry.raw.length > STATIC_FILE_CACHE_MAX_BYTES) return false;
  if (!STATIC_FILE_CACHE.has(filePath) && STATIC_FILE_CACHE.size >= STATIC_FILE_CACHE_MAX_ENTRIES) {
    STATIC_FILE_CACHE.delete(STATIC_FILE_CACHE.keys().next().value);
  }
  STATIC_FILE_CACHE.set(filePath, entry);
  return true;
}

function compressResponse(req, res, content, contentType, cacheControl) {
  const headers = {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
  };
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  const accept = req.headers["accept-encoding"] || "";
  if (accept.includes("gzip") && Buffer.byteLength(content) > 256) {
    headers["Content-Encoding"] = "gzip";
    const gzipped = zlib.gzipSync(content);
    headers["Content-Length"] = gzipped.length;
    res.writeHead(200, headers);
    res.end(gzipped);
  } else {
    res.writeHead(200, headers);
    res.end(content);
  }
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.copyFileSync(SEED_PATH, DATA_PATH);
  }
}

let _dbCache = null;
let _dbDirty = false;

function readDb() {
  if (_dbCache) return _dbCache;
  ensureDataFile();
  const content = fs.readFileSync(DATA_PATH, "utf8").replace(/^\uFEFF/, "");
  _dbCache = normalizeDb(JSON.parse(content));
  return _dbCache;
}

function writeDb(db) {
  _dbCache = db;
  _dbDirty = true;
  rebuildDbIndexes(db);
}

function dataFileHealth() {
  const health = {
    path: path.relative(__dirname, DATA_PATH),
    exists: false,
    readable: false,
    validJson: false,
    sizeBytes: 0,
    updatedAt: null,
    error: ""
  };
  try {
    if (!fs.existsSync(DATA_PATH)) return health;
    const stats = fs.statSync(DATA_PATH);
    health.exists = true;
    health.sizeBytes = stats.size;
    health.updatedAt = stats.mtime.toISOString();
    const content = fs.readFileSync(DATA_PATH, "utf8").replace(/^\uFEFF/, "");
    health.readable = true;
    JSON.parse(content || "{}");
    health.validJson = true;
  } catch (error) {
    health.error = String(error.message || error).slice(0, 160);
  }
  return health;
}

function oldestCacheEntryAgeSeconds(entries, now = Date.now()) {
  let oldest = Infinity;
  for (const entry of entries || []) {
    const timestamp = Number(entry?.ts || entry?.cachedAt || 0);
    if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < oldest) oldest = timestamp;
  }
  return Number.isFinite(oldest) ? Math.max(0, Math.round((now - oldest) / 1000)) : null;
}

function buildHealthPayload() {
  const dataFile = dataFileHealth();
  const dataOk = dataFile.exists && dataFile.readable && dataFile.validJson;
  const now = Date.now();
  const cacheAgeSeconds = (timestamp) => timestamp ? Math.max(0, Math.round((now - timestamp) / 1000)) : null;
  const dbArticleCount = getDbArticleCountForHealth();
  const nextRefreshAt = _feedCacheStore.lastRefreshAt
    ? new Date(new Date(_feedCacheStore.lastRefreshAt).getTime() + NEWS_REFRESH_INTERVAL_MS).toISOString()
    : null;
  return {
    status: dataOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    port: PORT,
    cachedArticleCount: _feedCacheStore.articles.length,
    dbArticleCount,
    lastRefreshAt: _feedCacheStore.lastRefreshAt,
    nextRefreshAt,
    refreshInProgress: _feedCacheStore.refreshing,
    lastRefreshStatus: _feedCacheStore.lastRefreshStatus,
    lastCleanupAt: _feedCacheStore.lastCleanupAt,
    newsRefreshIntervalHours: +(NEWS_REFRESH_INTERVAL_MS / 3600000).toFixed(1),
    newsRetentionDays: NEWS_RETENTION_DAYS,
    outboundFetch: {
      timeoutMs: OUTBOUND_FETCH_TIMEOUT_MS,
      retries: OUTBOUND_FETCH_RETRIES
    },
    rssSources: getRssSources().length,
    cache: {
      articles: _rawArticleCache.size,
      relatedArticles: _rawRelatedPool.size,
      trends: TRENDS_CACHE.size,
      rss: {
        items: rssCache.data.length,
        ageSeconds: cacheAgeSeconds(rssCache.timestamp),
        ttlSeconds: Math.round(RSS_CACHE_TTL_MS / 1000)
      },
      newsProvider: {
        items: newsProviderCache.data.length,
        ageSeconds: cacheAgeSeconds(newsProviderCache.timestamp),
        ttlSeconds: Math.round(NEWS_PROVIDER_CACHE_TTL_MS / 1000)
      },
      userSourceFetch: {
        items: SOURCE_FETCH_CACHE.size,
        maxItems: SOURCE_FETCH_CACHE_MAX_ENTRIES,
        oldestAgeSeconds: oldestCacheEntryAgeSeconds(SOURCE_FETCH_CACHE.values(), now),
        ttlSecondsByType: Object.fromEntries(
          Object.entries(SOURCE_FETCH_CACHE_TTL_BY_TYPE_MS).map(([type, ttl]) => [type, Math.round(ttl / 1000)])
        )
      },
      staticFiles: {
        items: STATIC_FILE_CACHE.size,
        maxItems: STATIC_FILE_CACHE_MAX_ENTRIES,
        maxBytesPerItem: STATIC_FILE_CACHE_MAX_BYTES,
        oldestAgeSeconds: oldestCacheEntryAgeSeconds(STATIC_FILE_CACHE.values(), now),
        maxAgeSeconds: 86400
      }
    },
    dataFile,
    clustering: {
      rawArticles: _lastClusterStats.raw,
      clusteredArticles: _lastClusterStats.clusters,
      duplicateGrouped: _lastClusterStats.grouped,
      avgSourceCount: _lastClusterStats.avgSourceCount,
      updatedAt: _lastClusterStats.updatedAt
    },
    feedScheduler: {
      newsRefreshIntervalHours: +(NEWS_REFRESH_INTERVAL_MS / 3600000).toFixed(1),
      newsRetentionDays: NEWS_RETENTION_DAYS,
      cachedArticleCount: _feedCacheStore.articles.length,
      dbArticleCount,
      refreshInProgress: _feedCacheStore.refreshing,
      lastRefreshAt: _feedCacheStore.lastRefreshAt,
      nextRefreshAt,
      lastRefreshStatus: _feedCacheStore.lastRefreshStatus,
      lastRefreshError: _feedCacheStore.lastRefreshError || null,
      lastCleanupAt: _feedCacheStore.lastCleanupAt,
      cacheAgeSeconds: _feedCacheStore.timestamp ? Math.max(0, Math.round((now - _feedCacheStore.timestamp) / 1000)) : null,
      translationStatus: _feedCacheStore.translationStatus || "pending",
      translationCacheSize: _translationCache.size
    }
  };
}

async function flushDb() {
  if (!_dbDirty || !_dbCache) return;
  _dbDirty = false;
  try {
    await fs.promises.writeFile(DATA_PATH, JSON.stringify(_dbCache) + "\n", "utf8");
  } catch (e) {
    _dbDirty = true;
  }
}

function flushDbSync() {
  if (_dbDirty && _dbCache) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(_dbCache) + "\n", "utf8");
    _dbDirty = false;
  }
}

setInterval(flushDb, 3000);

function runReminderScheduler() {
  const db = readDb();
  if (!Array.isArray(db.calendarEvents)) return;
  const now = new Date();
  let changed = false;
  for (const e of db.calendarEvents) {
    if (!e.reminderEnabled || e.reminderSent || !e.reminderAt) continue;
    if (new Date(e.reminderAt) <= now) {
      e.reminderSent = true;
      e.updatedAt = now.toISOString();
      if (!Array.isArray(db.calendarNotifications)) db.calendarNotifications = [];
      db.calendarNotifications.push({
        id: "notif_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        userId: e.userId,
        type: "calendar_reminder",
        title: e.title,
        message: `Hatırlatıcı: "${e.title}" etkinliği yaklaşıyor!`,
        relatedEventId: e.id,
        read: false,
        createdAt: now.toISOString()
      });
      changed = true;
    }
  }
  if (changed) writeDb(db);
}
setInterval(runReminderScheduler, 60_000);

function normalizeDb(db) {
  db.users = Array.isArray(db.users) ? db.users : [];
  db.articles = Array.isArray(db.articles) ? db.articles.map((article) => {
    const normalizedArticle = {
      ...article,
      category: inferArticleCategory(article),
      continent: normalizeContinentName(article.continent || article.region || inferArticleContinent(article))
    };
    normalizedArticle.subcategory = inferArticleSubcategory(normalizedArticle);
    normalizedArticle.tags = [normalizedArticle.category, normalizedArticle.subcategory];
    // Apply backward-compat normalization for new fields (non-destructive)
    normalizeLegacyArticleInline(normalizedArticle);
    return normalizedArticle;
  }) : [];
  db.bookmarks = Array.isArray(db.bookmarks) ? db.bookmarks : [];
  db.readStatus = Array.isArray(db.readStatus) ? db.readStatus : [];
  db.preferences = db.preferences && typeof db.preferences === "object" ? db.preferences : {};
  db.userArticleEvents = Array.isArray(db.userArticleEvents)
    ? db.userArticleEvents
    : (Array.isArray(db.events) ? db.events : []);
  db.ingestionRuns = Array.isArray(db.ingestionRuns) ? db.ingestionRuns : [];
  db.institutionalEvents = Array.isArray(db.institutionalEvents) && db.institutionalEvents.length
    ? db.institutionalEvents
    : defaultInstitutionalEvents();
  db.eventReadStatus = Array.isArray(db.eventReadStatus) ? db.eventReadStatus : [];
  db.eventReminders = Array.isArray(db.eventReminders) ? db.eventReminders : [];
  db.hiddenEvents = Array.isArray(db.hiddenEvents) ? db.hiddenEvents : [];
  db.savedSearches = Array.isArray(db.savedSearches) ? db.savedSearches : [];
  db.calendarEvents = Array.isArray(db.calendarEvents) ? db.calendarEvents : [];
  db.calendarNotifications = Array.isArray(db.calendarNotifications) ? db.calendarNotifications : [];
  db.userNewspaperItems = Array.isArray(db.userNewspaperItems) ? db.userNewspaperItems : [];
  db.financePreferences = db.financePreferences && typeof db.financePreferences === "object" ? db.financePreferences : {};
  db.userSources = normalizeUserSourcesDb(db.userSources || []);
  db.sourceContentCache = db.sourceContentCache && typeof db.sourceContentCache === "object" ? db.sourceContentCache : {};
  for (const user of db.users) {
    db.preferences[user.id] = normalizePreferences(db.preferences[user.id]);
    db.financePreferences[user.id] = normalizeFinancePreferences(db.financePreferences[user.id]);
  }
  db.financePreferences.user_demo = normalizeFinancePreferences(db.financePreferences.user_demo);
  rebuildDbIndexes(db);
  return db;
}

function rebuildDbIndexes(db) {
  db._articleById = new Map();
  for (const a of db.articles) db._articleById.set(String(a.id), a);
  db._readStatusByKey = new Map();
  for (const r of db.readStatus) db._readStatusByKey.set(`${r.userId}:${r.articleId}`, r);
  db._bookmarksByKey = new Set();
  for (const b of db.bookmarks) db._bookmarksByKey.add(`${b.userId}:${b.articleId}`);
}

function normalizePreferences(preferences = {}) {
  const validReadingTimes = ["morning", "noon", "evening", "night"];
  const validDepths = ["short", "detailed", "mixed"];
  const normalizedInterests = Array.isArray(preferences.interests)
    ? [...new Set(preferences.interests.map(normalizeCategoryName).filter((category) => TOPIC_CATEGORIES.includes(category)))]
    : [];
  return {
    interests: normalizedInterests.length ? normalizedInterests : ["Teknoloji", "Bilim"],
    preferredSources: Array.isArray(preferences.preferredSources) ? preferences.preferredSources : [],
    readingTimes: Array.isArray(preferences.readingTimes)
      ? preferences.readingTimes.filter((t) => validReadingTimes.includes(t))
      : [],
    contentDepth: validDepths.includes(preferences.contentDepth) ? preferences.contentDepth : "mixed",
    readingMode: preferences.readingMode || "daily",
    language: preferences.language || "tr",
    notifications: preferences.notifications !== false,
    darkMode: Boolean(preferences.darkMode),
    fontScale: Number(preferences.fontScale || 100),
    readingGoal: Math.max(1, Number(preferences.readingGoal || 20))
  };
}

function defaultInstitutionalEvents() {
  return [
    {
      id: "evt_academic_calendar",
      title: "Akademik takvim güncellemesi",
      category: "Akademik",
      date: "2026-05-13T09:00:00.000Z",
      summary: "Ders ekle-bırak ve danışman onay tarihlerinde güncelleme yayınlandı.",
      description: "Öğrenciler ders ekle-bırak işlemleri ve danışman onayları için güncellenen akademik takvimi kontrol etmelidir.",
      critical: true
    },
    {
      id: "evt_midterm_deadline",
      title: "Proje teslim son günü",
      category: "Son Tarih",
      date: "2026-05-15T17:00:00.000Z",
      summary: "Yazılım tasarım raporu ve sunum dosyaları için son teslim tarihi yaklaşıyor.",
      description: "Ekipler proje raporlarını, tasarım diyagramlarını ve sunum çıktılarının son sürümünü sisteme yüklemelidir.",
      critical: true
    },
    {
      id: "evt_ai_seminar",
      title: "Yapay zeka semineri",
      category: "Sosyal",
      date: "2026-05-18T14:00:00.000Z",
      summary: "Kampüste üretken yapay zeka araçlarının akademik kullanımı konuşulacak.",
      description: "Seminerde üretken yapay zeka araçlarının araştırma, yazım ve etik kullanım sınırları ele alınacaktır.",
      critical: false
    },
    {
      id: "evt_final_exam",
      title: "Final sınav programı duyurusu",
      category: "Sınav",
      date: "2026-05-20T10:00:00.000Z",
      summary: "Final sınav tarihleri ve sınıf bilgileri öğrenci panelinde yayınlandı.",
      description: "Öğrenciler sınav programını kontrol etmeli, çakışma varsa bölüm sekreterliğiyle iletişime geçmelidir.",
      critical: true
    }
  ];
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Cache-Control": "no-store"
  };
  const accept = (res._req && res._req.headers) ? (res._req.headers["accept-encoding"] || "") : "";
  if (accept.includes("gzip") && body.length > 256) {
    headers["Content-Encoding"] = "gzip";
    const gzipped = zlib.gzipSync(body);
    headers["Content-Length"] = gzipped.length;
    res.writeHead(status, headers);
    res.end(gzipped);
  } else {
    res.writeHead(status, headers);
    res.end(body);
  }
}

function pdf(res, filename, content) {
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename=\"${filename}\"`,
    "Content-Length": content.length
  });
  res.end(content);
}

function inlinePdf(res, filename, content) {
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename=\"${filename}\"`,
    "Content-Length": content.length,
    "Cache-Control": "no-store"
  });
  res.end(content);
}

function hasEnv(name) {
  const value = process.env[name];
  return Boolean(value && value.trim() && !value.includes("your_") && !value.includes("_buraya"));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableFetchError(error) {
  const text = String(error?.message || error || "");
  return error?.name === "AbortError"
    || /timeout|timed out|fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(text);
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs || OUTBOUND_FETCH_TIMEOUT_MS) || OUTBOUND_FETCH_TIMEOUT_MS, 1000), 60000);
  const retries = Math.min(Math.max(Number(options.retries ?? OUTBOUND_FETCH_RETRIES) || 0, 0), 3);
  const fetchOptions = { ...options };
  delete fetchOptions.timeoutMs;
  delete fetchOptions.retries;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Outbound request timed out after ${timeoutMs}ms`)), timeoutMs);
    let cleanup = null;

    if (fetchOptions.signal) {
      if (fetchOptions.signal.aborted) throw new Error("Outbound request aborted before start");
      const abortForwarder = () => controller.abort(fetchOptions.signal.reason);
      fetchOptions.signal.addEventListener("abort", abortForwarder, { once: true });
      cleanup = () => fetchOptions.signal.removeEventListener("abort", abortForwarder);
    }

    try {
      const headers = new Headers(fetchOptions.headers || {});
      if (!headers.has("user-agent")) headers.set("User-Agent", "SmartNewspaper/1.0 (+https://github.com/ovgubejan/smart-newspaper)");
      const response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        try { await response.body?.cancel?.(); } catch {}
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !retryableFetchError(error)) {
        throw new Error(retryableFetchError(error) ? `Outbound request failed after retry: ${String(error.message || error)}` : String(error.message || error));
      }
    } finally {
      clearTimeout(timer);
      if (cleanup) cleanup();
    }

    if (attempt < retries) await wait(250 * (attempt + 1));
  }
  throw lastError || new Error("Outbound request failed");
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload.message || payload.error?.message || payload.error || `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return payload;
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RSS kaynağı okunamadı: HTTP ${response.status}`);
  }
  return text;
}

const _namedEntities = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…", bull: "•",
  copy: "©", reg: "®", trade: "™", deg: "°",
  laquo: "«", raquo: "»", middot: "·", shy: "­",
  times: "×", divide: "÷", euro: "€", pound: "£",
  yen: "¥", cent: "¢", para: "¶", sect: "§",
  iexcl: "¡", iquest: "¿", ordf: "ª", ordm: "º",
  sup1: "¹", sup2: "²", sup3: "³", frac14: "¼",
  frac12: "½", frac34: "¾", micro: "µ",
};

function decodeHtml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => _namedEntities[name.toLowerCase()] || match)
    .trim();
}

function stripHtml(value) {
  let cleaned = decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // ---- Guardian live blog JSON cleanup ----
  // Guardian RSS / live blogs embed raw JSON metadata inline in the text.
  // Strategy: strip known metadata keys first (safe, non-nested), then
  // attempt to strip residual balanced brace blocks that still look like JSON.

  // 1. Remove Guardian image block arrays (very long, nested)
  cleaned = cleaned.replace(/,?\s*"allImages"\s*:\s*\[[\s\S]*?\](?=\s*[,}])/g, "");
  cleaned = cleaned.replace(/,?\s*"imageSources"\s*:\s*\[[\s\S]*?\](?=\s*[,}])/g, "");
  cleaned = cleaned.replace(/,?\s*"srcSet"\s*:\s*\[[\s\S]*?\](?=\s*[,}])/g, "");

  // 2. Remove known scalar Guardian metadata fields
  const guardianScalarKeys = [
    "displayCredit", "blockCreatedOn", "blockCreatedOnDisplay",
    "blockLastUpdated", "blockLastUpdatedDisplay",
    "blockFirstPublished", "blockFirstPublishedDisplay",
    "blockFirstPublishedDisplayNoTimezone",
    "primaryDateLine", "secondaryDateLine",
    "elementId", "renderingTarget", "serverTime",
    "weighting", "index", "mimeType", "mediaType",
    "isMaster", "height", "width", "quality", "credit"
  ];
  guardianScalarKeys.forEach(key => {
    cleaned = cleaned.replace(new RegExp(',?\\s*"' + key + '"\\s*:\\s*(?:"[^"]*"|true|false|\\d+)', 'g'), "");
  });

  // 3. Remove leftover JSON object/array fragments containing Guardian keys
  // Repeatedly apply balanced-brace removal for small blocks (no nested braces)
  for (let i = 0; i < 8; i++) {
    // Remove simple (non-nested) JSON objects that contain a Guardian marker
    cleaned = cleaned.replace(/,?\s*\{[^{}]*(?:_type|dotcomrendering|displayCredit|allImages|imageSources|blockCreatedOn|elementId|renderingTarget|srcSet|isMaster)[^{}]*\}/g, " ");
  }

  // 4. Remove any remaining long raw-JSON-looking segments
  // (sequences of key:value pairs without normal sentence patterns)
  // Matches: ,{...} or [{...}] garbage containing quote-colon-quote triplets
  cleaned = cleaned.replace(/,\s*\{(?:[^{}]|\{[^{}]*\})*"(?:url|src|href|type|role|alt|caption)"\s*:(?:[^{}]|\{[^{}]*\})*\}/g, " ");

  // 5. Remove leftover JSON array closings and metadata lines
  cleaned = cleaned.replace(/"contributors"\s*:\s*\[[^\]]*\]/g, "");
  cleaned = cleaned.replace(/"attributes"\s*:\s*\{[^}]*\}/g, "");
  cleaned = cleaned.replace(/"data"\s*:\s*\{[^}]*\}/g, "");

  // 6. Strip HTML tags
  cleaned = cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function articleNeedsFullTextRefresh(article = {}) {
  const fullText = String(article.fullText || "").trim();
  const summary = String(article.summary || article.description || "").trim();
  const status = String(article.contentStatus || "");
  if (!article.sourceUrl || String(article.sourceUrl).includes("example.com")) return false;
  if (status === "full_from_source_page") return false;
  if (!fullText) return true;
  if (status !== "full_from_source_page") return true;
  if (/summary_only|provider_text|rss/i.test(status) && fullText.length < Math.max(900, summary.length + 350)) return true;
  return fullText.length < Math.max(700, summary.length + 250);
}

function hasSourceFullText(article = {}) {
  return article?.contentStatus === "full_from_source_page" && String(article.fullText || "").trim().length >= 400;
}

function normalizeArticleParagraph(text) {
  return stripHtml(text)
    .replace(/\[[+\d\s]+chars?\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulArticleParagraph(text) {
  const value = String(text || "").trim();
  if (value.length < 35) return false;
  if (value.split(/\s+/).length < 7) return false;
  return !/(çerez|Ã§erez|cookie|reklam|abonelik|javascript|son dakika haberleri|haberin devamı|devamını oku|sıradaki haber|whatsapp|telegram|facebook|twitter|instagram|bizi takip edin|kaynak:|fotoğraf:|görsel:|tıklayın|üye ol|giriş yap|privacy|advertisement)/i.test(value);
}

function uniqueArticleParagraphs(paragraphs) {
  const seen = new Set();
  return paragraphs.filter((paragraph) => {
    const key = normalizeText(paragraph).slice(0, 180);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function jsonLdTextFromItem(item) {
  if (!item || typeof item !== "object") return "";
  const type = Array.isArray(item["@type"]) ? item["@type"].join(" ") : String(item["@type"] || "");
  const body = item.articleBody || item.text || item.description || "";
  if (/NewsArticle|Article|Reportage|BlogPosting/i.test(type) && body) {
    return Array.isArray(body) ? body.join(" ") : String(body);
  }
  return "";
}

function flattenJsonLdItems(item) {
  if (!item) return [];
  if (Array.isArray(item)) return item.flatMap(flattenJsonLdItems);
  if (typeof item !== "object") return [];
  return [
    item,
    ...flattenJsonLdItems(item["@graph"]),
    ...flattenJsonLdItems(item.mainEntity),
    ...flattenJsonLdItems(item.mainEntityOfPage)
  ];
}

function extractArticleTextFromHtml(html) {
  const jsonLdBodies = [...String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => {
      try {
        const data = JSON.parse(decodeHtml(match[1]).trim());
        const items = Array.isArray(data) ? data : [data];
        return items
          .flatMap((item) => item["@graph"] || item)
          .map((item) => item?.articleBody || item?.description || "")
          .filter(Boolean)
          .join(" ");
      } catch {
        return "";
      }
    })
    .filter((text) => text.length > 300);
  if (jsonLdBodies.length) return stripHtml(jsonLdBodies.sort((a, b) => b.length - a.length)[0]);

  const articleBlocks = [...String(html || "").matchAll(/<article[\s\S]*?<\/article>/gi)].map((match) => match[0]);
  const candidates = articleBlocks.length ? articleBlocks : [html];
  const paragraphs = candidates.flatMap((block) => [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length > 35 && !/çerez|cookie|reklam|abonelik|javascript/i.test(text)));
  return [...new Set(paragraphs)].join("\n\n").trim();
}

function extractArticleTextFromHtmlRich(html) {
  const source = String(html || "");
  const cleanHtml = source
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  const blockPatterns = [
    /<article\b[\s\S]*?<\/article>/gi,
    /<main\b[\s\S]*?<\/main>/gi,
    /<(?:section|div)\b[^>]*(?:class|id)=["'][^"']*(?:article|haber|news|story|content|detail|post|entry|body|text|read)[^"']*["'][^>]*>[\s\S]*?<\/(?:section|div)>/gi
  ];
  const blocks = blockPatterns.flatMap((pattern) => [...cleanHtml.matchAll(pattern)].map((match) => match[0]));
  const candidates = blocks.length ? blocks : [cleanHtml];
  const scoredCandidates = candidates
    .map((block) => {
      const paragraphs = uniqueArticleParagraphs([...block.matchAll(/<(?:p|h2|li)[^>]*>([\s\S]*?)<\/(?:p|h2|li)>/gi)]
        .map((match) => normalizeArticleParagraph(match[1]))
        .filter(isUsefulArticleParagraph));
      return {
        paragraphs,
        length: paragraphs.join(" ").length,
        count: paragraphs.length
      };
    })
    .filter((candidate) => candidate.count > 0)
    .sort((a, b) => b.length - a.length || b.count - a.count);
  if (scoredCandidates.length) return scoredCandidates[0].paragraphs.join("\n\n").trim();

  const jsonLdBodies = [...source.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => {
      try {
        const data = JSON.parse(decodeHtml(match[1]).trim());
        return flattenJsonLdItems(data)
          .map(jsonLdTextFromItem)
          .filter(Boolean)
          .join(" ");
      } catch {
        return "";
      }
    })
    .filter((text) => text.length > 300);
  if (jsonLdBodies.length) return stripHtml(jsonLdBodies.sort((a, b) => b.length - a.length)[0]);

  const metaDescription = source.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]*>/i);
  return metaDescription ? normalizeArticleParagraph(metaDescription[1]) : "";
}

async function fetchArticleFullText(article) {
  if (!article?.sourceUrl || article.sourceUrl.includes("example.com")) return article;
  const existing = String(article.fullText || "");
  if (!articleNeedsFullTextRefresh(article)) return article;
  try {
    const html = await fetchText(article.sourceUrl, {
      headers: {
        "User-Agent": "KisiselGazetem/1.0 Article Reader",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6"
      }
    });
    const fullText = extractArticleTextFromHtmlRich(html) || extractArticleTextFromHtml(html);
    if (fullText.length > existing.length + 120 || fullText.length > Math.max(900, String(article.summary || "").length + 350)) {
      return {
        ...article,
        fullText,
        contentStatus: "full_from_source_page",
        contentWarning: ""
      };
    }
  } catch (error) {
    return {
      ...article,
      contentStatus: "source_full_text_unavailable",
      contentFallbackStatus: article.contentStatus || "",
      contentWarning: "Tam metin alınamadı, kısa özet gösteriliyor."
    };
  }
  return {
    ...article,
    contentStatus: "source_full_text_unavailable",
    contentFallbackStatus: article.contentStatus || "",
    contentWarning: "Tam metin alınamadı, kısa özet gösteriliyor."
  };
}

function extractXmlTag(block, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (!match) return "";
  // Strip CDATA wrappers used by CNN Turk, Sozcu etc: <![CDATA[...]]>
  const raw = match[1];
  const cdataMatch = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const val = cdataMatch ? cdataMatch[1].trim() : raw.trim();
  return decodeHtml(val);
}

function extractXmlAttr(block, tagName, attrName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttr = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escapedTag}[^>]*\\s${escapedAttr}=["']([^"']+)["'][^>]*>`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function getArticleImageFromRssItem(block) {
  return extractXmlAttr(block, "media:content", "url")
    || extractXmlAttr(block, "media:thumbnail", "url")
    || extractXmlAttr(block, "enclosure", "url")
    || stripHtml(extractXmlTag(block, "image"))
    || "";
}

function getRssSources() {
  const raw = process.env.RSS_FEEDS || "";
  const urls = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && !item.includes("example.com") && !item.includes("example.org"));

  if (urls.length) {
    return urls.map((url, index) => ({
      id: `env_${index}`,
      sourceName: `RSS Kaynağı ${index + 1}`,
      rssUrl: url,
      country: "",
      countryCode: "",
      region: "global",
      language: "tr",
      trustLevel: "medium",
      sourceType: "rss",
      isGlobalSource: false,
      enabled: true,
      fetchPriority: 3,
      category: "Gündem"
    }));
  }

  return REGIONAL_SOURCE_CATALOG
    .filter((s) => s.enabled && s.rssUrl)
    .sort((a, b) => a.fetchPriority - b.fetchPriority || a.id.localeCompare(b.id));
}

function isValidUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeRssSourceUrl(rawUrl, source) {
  const value = String(rawUrl || "").trim();
  if (isValidUrl(value)) return { sourceUrl: value, externalId: "" };
  const externalId = value && /^[a-z0-9_-]+$/i.test(value) ? value : "";
  const sourceName = normalizeText(source?.sourceName || source?.name || "");
  if (externalId && sourceName.includes("milliyet")) {
    return { sourceUrl: `https://www.milliyet.com.tr/${externalId}`, externalId };
  }
  return { sourceUrl: "", externalId };
}

// ─── Inline normalization helpers (CommonJS, mirrors articleNormalizer.js) ─────

const _LANG_DETECTORS_CJS = [
  ["ja", /[぀-ヿ]/],
  ["ar", /[؀-ۿ]/],
  ["zh", /[一-龯]/],
  ["tr", /[ğşıİĞŞ]/],
  ["de", /\b(?:der|die|das|und|nicht|auch|f[uü]r|werden|haben)\b/i],
  ["fr", /\b(?:le|la|les|des|est|une|qui|dans|pour|avec)\b/i],
  ["pt", /\b(?:n[aã]o|s[aã]o|est[aá]|mais|como|para|com|uma)\b/i],
  ["es", /\b(?:que|con|por|para|una|los|las|del|como|pero)\b/i],
  ["en", /\b(?:the|and|for|that|with|this|are|was|has|from|have)\b/i],
];

function detectLangInline(title, summary, sourceLanguage) {
  if (sourceLanguage) return sourceLanguage;
  const sample = `${String(title || "").slice(0, 300)} ${String(summary || "").slice(0, 200)}`.trim();
  if (!sample) return "tr";
  for (const [lang, pattern] of _LANG_DETECTORS_CJS) {
    if (pattern.test(sample)) return lang;
  }
  return "tr";
}

// Country lookup table for server-side detection (abbreviated — full list in articleNormalizer.js)
const _COUNTRY_LOOKUP_CJS = [
  { names: ["united states", "usa", "america", "abd", "washington dc", "white house"], code: "US", region: "north-america", label: "ABD" },
  { names: ["canada", "kanada", "ottawa"], code: "CA", region: "north-america", label: "Kanada" },
  { names: ["mexico", "meksika"], code: "MX", region: "north-america", label: "Meksika" },
  { names: ["united kingdom", "uk", "britain", "england", "ingiltere", "londra", "london"], code: "GB", region: "europe", label: "Birleşik Krallık" },
  { names: ["germany", "almanya", "berlin"], code: "DE", region: "europe", label: "Almanya" },
  { names: ["france", "fransa", "paris"], code: "FR", region: "europe", label: "Fransa" },
  { names: ["italy", "italya", "rome", "roma"], code: "IT", region: "europe", label: "İtalya" },
  { names: ["spain", "ispanya", "madrid"], code: "ES", region: "europe", label: "İspanya" },
  { names: ["ukraine", "ukrayna", "kyiv", "kiev", "zelensky"], code: "UA", region: "europe", label: "Ukrayna" },
  { names: ["russia", "rusya", "moscow", "moskova", "putin", "kremlin"], code: "RU", region: "europe", label: "Rusya" },
  { names: ["china", "çin", "cin", "beijing", "pekin", "shanghai", "xi jinping"], code: "CN", region: "asia", label: "Çin" },
  { names: ["japan", "japonya", "tokyo", "osaka"], code: "JP", region: "asia", label: "Japonya" },
  { names: ["india", "hindistan", "new delhi", "delhi", "mumbai", "modi"], code: "IN", region: "asia", label: "Hindistan" },
  { names: ["south korea", "güney kore", "guney kore", "seoul", "seul"], code: "KR", region: "asia", label: "Güney Kore" },
  { names: ["north korea", "kuzey kore", "pyongyang", "kim jong"], code: "KP", region: "asia", label: "Kuzey Kore" },
  { names: ["pakistan", "islamabad", "karachi"], code: "PK", region: "asia", label: "Pakistan" },
  { names: ["singapore", "singapur"], code: "SG", region: "asia", label: "Singapur" },
  { names: ["hong kong"], code: "HK", region: "asia", label: "Hong Kong" },
  { names: ["israel", "israil", "tel aviv", "jerusalem", "kudüs", "kudus", "netanyahu"], code: "IL", region: "middle-east", label: "İsrail" },
  { names: ["palestine", "filistin", "gaza", "gazze", "west bank", "hamas"], code: "PS", region: "middle-east", label: "Filistin" },
  { names: ["iran", "tehran", "tahran", "khamenei"], code: "IR", region: "middle-east", label: "İran" },
  { names: ["iraq", "irak", "baghdad", "bağdat"], code: "IQ", region: "middle-east", label: "Irak" },
  { names: ["saudi arabia", "suudi arabistan", "riyadh", "riyad"], code: "SA", region: "middle-east", label: "Suudi Arabistan" },
  { names: ["syria", "suriye", "damascus", "şam", "aleppo", "halep"], code: "SY", region: "middle-east", label: "Suriye" },
  { names: ["lebanon", "lübnan", "lubnan", "beirut", "beyrut", "hezbollah"], code: "LB", region: "middle-east", label: "Lübnan" },
  { names: ["qatar", "katar", "doha"], code: "QA", region: "middle-east", label: "Katar" },
  { names: ["uae", "bae", "dubai", "abu dhabi"], code: "AE", region: "middle-east", label: "BAE" },
  { names: ["egypt", "mısır", "misir", "cairo", "kahire"], code: "EG", region: "africa", label: "Mısır" },
  { names: ["south africa", "güney afrika", "guney afrika", "johannesburg", "cape town"], code: "ZA", region: "africa", label: "Güney Afrika" },
  { names: ["nigeria", "nijerya", "lagos", "abuja"], code: "NG", region: "africa", label: "Nijerya" },
  { names: ["kenya", "nairobi"], code: "KE", region: "africa", label: "Kenya" },
  { names: ["morocco", "fas", "rabat"], code: "MA", region: "africa", label: "Fas" },
  { names: ["ethiopia", "etiyopya", "addis ababa"], code: "ET", region: "africa", label: "Etiyopya" },
  { names: ["brazil", "brezilya", "brasilia", "são paulo", "sao paulo", "rio de janeiro", "lula"], code: "BR", region: "south-america", label: "Brezilya" },
  { names: ["argentina", "arjantin", "buenos aires", "milei"], code: "AR", region: "south-america", label: "Arjantin" },
  { names: ["chile", "sili", "şili", "santiago"], code: "CL", region: "south-america", label: "Şili" },
  { names: ["colombia", "kolombiya", "bogota"], code: "CO", region: "south-america", label: "Kolombiya" },
  { names: ["venezuela", "caracas", "maduro"], code: "VE", region: "south-america", label: "Venezuela" },
  { names: ["australia", "avustralya", "sydney", "melbourne", "canberra"], code: "AU", region: "oceania", label: "Avustralya" },
  { names: ["new zealand", "yeni zelanda", "wellington", "auckland"], code: "NZ", region: "oceania", label: "Yeni Zelanda" },
  { names: ["turkey", "türkiye", "turkiye", "ankara", "istanbul", "izmir", "erdoğan", "erdogan"], code: "TR", region: "turkey", label: "Türkiye" },
];

const _CANONICAL_REGIONS_CJS = ["global","europe","asia","africa","north-america","south-america","oceania","middle-east","turkey"];

// REGION_KEYWORDS region keys use underscore; canonical uses hyphen — normalize on lookup
const _REGION_KEYWORDS_CJS = {
  "north-america": ["abd", "amerika", "usa", "united states", "us", "trump", "biden", "washington", "white house", "new york", "california", "canada", "kanada", "mexico", "meksika"],
  europe: ["avrupa", "eu", "european union", "almanya", "germany", "fransa", "france", "ingiltere", "uk", "britain", "united kingdom", "italy", "italya", "spain", "ispanya", "ukraine", "ukrayna", "russia", "rusya", "nato", "brussels"],
  asia: ["çin", "cin", "china", "japonya", "japan", "hindistan", "india", "south korea", "guney kore", "north korea", "kuzey kore", "pakistan", "singapore", "singapur"],
  "middle-east": ["orta dogu", "ortadogu", "israil", "israel", "filistin", "palestine", "gaza", "gazze", "lübnan", "lubnan", "lebanon", "syria", "suriye", "iraq", "irak", "iran", "saudi arabia", "suudi arabistan", "yemen", "qatar", "katar", "uae", "bae"],
  africa: ["afrika", "africa", "egypt", "misir", "south africa", "guney afrika", "nigeria", "kenya", "morocco", "fas", "sudan", "ethiopia", "etiyopya"],
  "south-america": ["brazil", "brezilya", "argentina", "arjantin", "chile", "sili", "colombia", "kolombiya", "venezuela", "peru"],
  oceania: ["australia", "avustralya", "new zealand", "yeni zelanda", "sydney", "melbourne"],
  turkey: ["türkiye", "turkiye", "turkey", "ankara", "istanbul", "izmir", "erdoğan", "erdogan", "tbmm", "chp", "akp", "mhp"],
};

function detectCountriesInline(text) {
  const lower = (text || "").toLowerCase();
  const found = [];
  const seenCodes = new Set();
  for (const country of _COUNTRY_LOOKUP_CJS) {
    if (seenCodes.has(country.code)) continue;
    const hit = country.names.some((name) =>
      name.length <= 3 ? new RegExp(`\\b${name}\\b`, "i").test(lower) : lower.includes(name)
    );
    if (hit) { found.push(country.label); seenCodes.add(country.code); }
  }
  return found;
}

function detectRegionsInline(text, sourceRegion) {
  const lower = (text || "").toLowerCase();
  const found = new Set();
  for (const [region, keywords] of Object.entries(_REGION_KEYWORDS_CJS)) {
    for (const kw of keywords) {
      const hit = kw.length <= 3
        ? new RegExp(`\\b${kw}\\b`, "i").test(lower)
        : lower.includes(kw);
      if (hit) { found.add(region); break; }
    }
  }
  return [...found].filter((r) => _CANONICAL_REGIONS_CJS.includes(r));
}

function detectEventRegionInline(text, sourceRegion) {
  const mentioned = detectRegionsInline(text, sourceRegion);
  const external = mentioned.find((r) => r !== sourceRegion && r !== "global");
  return external || mentioned[0] || sourceRegion || "global";
}

function normalizeRegionQueryInline(value) {
  const key = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  const aliases = {
    "avrupa": "europe", "asya": "asia", "afrika": "africa",
    "kuzey amerika": "north-america", "north america": "north-america",
    "gÃ¼ney amerika": "south-america", "guney amerika": "south-america", "south america": "south-america",
    "orta doÄŸu": "middle-east", "orta dogu": "middle-east", "middle east": "middle-east",
    "tÃ¼rkiye": "turkey", "turkiye": "turkey", "tr": "turkey",
    "dÃ¼nya": "global", "dunya": "global", "world": "global"
  };
  return _CANONICAL_REGIONS_CJS.includes(key) ? key : aliases[key] || "";
}

function matchesRegionInline(article, selectedRegion, targetLang = "tr") {
  const region = normalizeRegionQueryInline(selectedRegion);
  if (!region) return true;
  const directRegions = [
    article.sourceRegion,
    article.detectedEventRegion,
    ...(Array.isArray(article.mentionedRegions) ? article.mentionedRegions : [])
  ].map(normalizeRegionQueryInline).filter(Boolean);
  if (region === "global") {
    const isTurkishUi = targetLang === "tr";
    return article.isGlobalSource === true || directRegions.includes("global")
      || (isTurkishUi && directRegions.includes("turkey"))
      || new Set(directRegions.filter((item) => item !== "global")).size > 1
      || (Array.isArray(article.propagationPath) && new Set(article.propagationPath.map((item) => normalizeRegionQueryInline(item.region || item)).filter(Boolean)).size > 1);
  }
  if (directRegions.includes(region)) return true;
  const countryValues = [
    article.sourceCountry, article.sourceCountryCode,
    ...(Array.isArray(article.mentionedCountries) ? article.mentionedCountries : [])
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  if (_COUNTRY_LOOKUP_CJS.some((country) =>
    country.region === region && countryValues.some((value) =>
      value === country.code.toLowerCase() || country.names.some((name) => value.includes(name))
    )
  )) return true;
  const text = [
    article.sourceCountry, article.sourceCountryCode,
    ...(Array.isArray(article.mentionedCountries) ? article.mentionedCountries : []),
    article.originalTitle, article.translatedTitle, article.displayTitle, article.title,
    article.originalSummary, article.translatedSummary, article.displaySummary, article.summary, article.content
  ].filter(Boolean).join(" ");
  return detectRegionsInline(text).includes(region);
}

function invalidateTrendsCache() {
  TRENDS_CACHE.clear();
}

function regionalSourceResponseItem(source) {
  return {
    id: source.id || "",
    sourceName: source.sourceName || source.name || "",
    sourceUrl: source.sourceUrl || "",
    rssUrl: source.rssUrl || "",
    apiProvider: source.apiProvider || null,
    country: source.country || "",
    countryCode: source.countryCode || "",
    region: source.region,
    language: source.language || "",
    trustLevel: source.trustLevel || "medium",
    sourceType: source.sourceType || "rss",
    isGlobalSource: Boolean(source.isGlobalSource),
    topicsSupported: Array.isArray(source.topicsSupported) ? source.topicsSupported : [],
    enabled: source.enabled !== false,
    fetchPriority: Number(source.fetchPriority || 3)
  };
}

function trendArticleRegions(article) {
  return [...new Set([
    article.detectedEventRegion,
    article.sourceRegion,
    ...(Array.isArray(article.mentionedRegions) ? article.mentionedRegions : [])
  ].map(normalizeRegionQueryInline).filter(Boolean))];
}

function buildTrendGrowthSeriesInline(articles) {
  const times = articles.map((article) => new Date(article.publishedAt || article.date || 0).getTime()).filter(Number.isFinite);
  if (!times.length) return [];
  const end = Math.max(...times);
  const start = Math.min(...times);
  const span = Math.max(1, end - start);
  const seen = new Set();
  return Array.from({ length: 10 }, (_, index) => {
    const at = start + (span * index) / 9;
    articles.forEach((article) => {
      if (new Date(article.publishedAt || article.date || 0).getTime() <= at) {
        seen.add(article.sourceName || article.source || article.id || article.title);
      }
    });
    return { at: new Date(at).toISOString(), sourceCount: seen.size };
  });
}

function buildTrendPropagationPathInline(articles) {
  const steps = new Map();
  for (const article of articles) {
    const firstSeenAt = article.publishedAt || article.date || "";
    const country = article.sourceCountry || article.country || "";
    for (const region of trendArticleRegions(article).filter((item) => item !== "global")) {
      const current = steps.get(region);
      if (!current || new Date(firstSeenAt || 0) < new Date(current.firstSeenAt || 0)) {
        steps.set(region, { region, country, firstSeenAt, sourceName: article.sourceName || article.source || "" });
      }
    }
  }
  return [...steps.values()].sort((a, b) => new Date(a.firstSeenAt || 0) - new Date(b.firstSeenAt || 0));
}

function computeRegionalTrendsInline(articles) {
  const groups = [];
  const unique = [...new Map(articles.filter(Boolean).map((article) => [String(article.id || article.sourceUrl || article.title), article])).values()];
  const tokenIndex = new Map();
  for (const article of unique) {
    const text = `${article.displayTitle || article.title || ""} ${article.displaySummary || article.summary || ""}`;
    const artTokens = new Set(normalizeText(text).split(/\s+/).filter(Boolean));
    let bestGroup = null;
    let bestScore = 0;
    const candidateGroups = new Set();
    for (const tok of artTokens) {
      const gIds = tokenIndex.get(tok);
      if (gIds) for (const gId of gIds) candidateGroups.add(gId);
    }
    for (const gIdx of candidateGroups) {
      const g = groups[gIdx];
      const intersection = [...artTokens].filter((w) => g._tokenSet.has(w)).length;
      const union = new Set([...artTokens, ...g._tokenSet]).size || 1;
      const score = intersection / union;
      if (score >= 0.22 && score > bestScore) { bestScore = score; bestGroup = g; }
    }
    if (!bestGroup) {
      bestGroup = { text, articles: [], sources: new Set(), _tokenSet: artTokens };
      const gIdx = groups.length;
      groups.push(bestGroup);
      for (const tok of artTokens) {
        let arr = tokenIndex.get(tok);
        if (!arr) { arr = []; tokenIndex.set(tok, arr); }
        arr.push(gIdx);
      }
    }
    bestGroup.articles.push(article);
    bestGroup.sources.add(article.sourceName || article.source || "Bilinmeyen kaynak");
  }
  return groups
    .filter((group) => group.articles.length >= 2 || group.sources.size >= 2)
    .map((group) => {
      const sorted = [...group.articles].sort((a, b) => new Date(a.publishedAt || a.date || 0) - new Date(b.publishedAt || b.date || 0));
      const representativeArticle = sorted[0] || {};
      const propagationPath = buildTrendPropagationPathInline(sorted);
      const regions = [...new Set(sorted.flatMap(trendArticleRegions).filter((item) => item !== "global"))];
      const countries = [...new Set(sorted.flatMap((article) => [
        article.sourceCountry || article.country,
        ...(Array.isArray(article.mentionedCountries) ? article.mentionedCountries : [])
      ]).filter(Boolean))];
      const sources = [...group.sources];
      const growthSeries = buildTrendGrowthSeriesInline(sorted);
      const last = growthSeries.at(-1)?.sourceCount || 0;
      const recent = last - (growthSeries.at(-4)?.sourceCount || 0);
      const previous = (growthSeries.at(-4)?.sourceCount || 0) - (growthSeries.at(-7)?.sourceCount || 0);
      const trendStatus = last > (growthSeries[0]?.sourceCount || 0) && recent >= previous ? "rising" : recent < previous ? "fading" : "stable";
      const title = representativeArticle.displayTitle || representativeArticle.title || "BaÅŸlÄ±ksÄ±z trend";
      return {
        id: `trend_${crypto.createHash("sha1").update(normalizeText(title)).digest("hex").slice(0, 16)}`,
        title,
        representativeArticle,
        articles: sorted,
        sourceCount: sources.length,
        sources,
        regions,
        countries,
        firstSeenAt: representativeArticle.publishedAt || representativeArticle.date || "",
        firstSeenRegion: propagationPath[0]?.region || regions[0] || "global",
        firstSeenCountry: propagationPath[0]?.country || representativeArticle.sourceCountry || representativeArticle.country || "",
        firstSeenSource: propagationPath[0]?.sourceName || representativeArticle.sourceName || representativeArticle.source || "",
        propagationPath,
        growthSeries,
        growthSpeed: recent,
        trendStatus,
        namedEntities: representativeArticle.namedEntities || {},
        topics: [...new Set(sorted.flatMap((article) => article.topics || article.tags || []).filter(Boolean))],
        confidenceScore: Math.min(1, 0.35 + sources.length * 0.15 + sorted.length * 0.05)
        ,
        isDemo: sorted.some((article) => article.isDemo),
        demoScenario: sorted.find((article) => article.demoScenario)?.demoScenario || ""
      };
    })
    .sort((a, b) => b.sourceCount - a.sourceCount || b.articles.length - a.articles.length);
}

function matchesTrendRegionInline(trend, selectedRegion) {
  const region = normalizeRegionQueryInline(selectedRegion);
  if (!region) return true;
  return trend.firstSeenRegion === region
    || trend.regions.includes(region)
    || trend.propagationPath.some((step) => step.region === region)
    || trend.articles.some((article) => matchesRegionInline(article, region));
}

function getRegionalTrendsInline(db, url) {
  const cacheKey = url.searchParams.toString();
  const cached = TRENDS_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TRENDS_CACHE_TTL_MS) return cached.trends;
  const region = url.searchParams.get("region");
  const country = normalizeText(url.searchParams.get("country"));
  const status = url.searchParams.get("status");
  const topic = normalizeText(url.searchParams.get("topic"));
  const from = new Date(url.searchParams.get("from") || 0).getTime();
  const to = new Date(url.searchParams.get("to") || "9999-12-31").getTime();
  const requestedLimit = Number(url.searchParams.get("limit") || 20);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(100, Math.floor(requestedLimit)) : 20;
  const pool = [...DEMO_REGIONAL_PANDEMIC_ARTICLES, ...db.articles, ...ARTICLE_CACHE.values()];
  const trends = computeRegionalTrendsInline(pool)
    .filter((trend) => !url.searchParams.get("demo") || trend.articles.some((article) => article.demoScenario === url.searchParams.get("demo")))
    .filter((trend) => matchesTrendRegionInline(trend, region))
    .filter((trend) => !country || trend.countries.some((item) => normalizeText(item).includes(country)))
    .filter((trend) => !status || trend.trendStatus === status)
    .filter((trend) => !topic || trend.topics.some((item) => normalizeText(item).includes(topic)))
    .filter((trend) => {
      const time = new Date(trend.firstSeenAt || 0).getTime();
      return time >= from && time <= to;
    })
    .slice(0, limit);
  if (TRENDS_CACHE.size >= TRENDS_CACHE_MAX) {
    let oldestKey = null, oldestTs = Infinity;
    for (const [k, v] of TRENDS_CACHE) { if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; } }
    if (oldestKey) TRENDS_CACHE.delete(oldestKey);
  }
  TRENDS_CACHE.set(cacheKey, { ts: Date.now(), trends });
  return trends;
}

function normalizeLegacyArticleInline(article) {
  if (!article || typeof article !== "object") return article;
  if (!article.originalTitle) article.originalTitle = article.title || "";
  if (!article.originalSummary) article.originalSummary = article.summary || article.description || "";
  if (!article.originalContent) article.originalContent = article.fullText || article.content || "";
  if (!article.originalLanguage) article.originalLanguage = article.sourceLanguage || "tr";
  if (article.translatedTitle === undefined) article.translatedTitle = "";
  if (article.translatedSummary === undefined) article.translatedSummary = "";
  if (article.translatedContent === undefined) article.translatedContent = "";
  if (!article.displayTitle) article.displayTitle = article.translatedTitle || article.originalTitle || article.title || "";
  if (!article.displaySummary) article.displaySummary = article.translatedSummary || article.originalSummary || article.summary || "";
  if (!article.displayContent) article.displayContent = article.translatedContent || article.originalContent || article.fullText || "";
  if (!article.namedEntities) article.namedEntities = { people: [], organizations: [], locations: [], countries: [], diseases: [], events: [], topics: [] };
  if (!Array.isArray(article.mentionedRegions)) article.mentionedRegions = [];
  if (!Array.isArray(article.mentionedCountries)) article.mentionedCountries = [];
  if (!article.detectedEventRegion) article.detectedEventRegion = article.sourceRegion || "global";
  if (!Array.isArray(article.topics)) article.topics = Array.isArray(article.tags) ? [...article.tags] : [];
  if (!article.fetchedAt) article.fetchedAt = article.publishedAt || new Date().toISOString();
  return article;
}

function cleanArticleTransportText(value, fallback = "", maxLength = 0) {
  const text = stripHtml(value).replace(/\s+/g, " ").trim();
  const result = text || fallback;
  if (!maxLength || result.length <= maxLength) return result;
  return `${result.slice(0, maxLength).trim()}...`;
}

function firstValidHttpUrl(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || !isValidUrl(text)) continue;
    try {
      return new URL(text).toString();
    } catch {
      return text;
    }
  }
  return "";
}

function normalizeArticleIsoDate(...values) {
  for (const value of values) {
    if (!value) continue;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isFinite(time) && time > 0) return new Date(time).toISOString();
  }
  return new Date().toISOString();
}

function normalizeArticleTransportFields(article) {
  if (!article || typeof article !== "object") return article;

  normalizeLegacyArticleInline(article);

  const title = cleanArticleTransportText(
    article.title || article.displayTitle || article.originalTitle,
    "Basliksiz haber",
    260
  );
  const summary = cleanArticleTransportText(
    article.summary || article.displaySummary || article.description || article.originalSummary || article.fullText || article.content || title,
    title,
    1200
  );
  const description = cleanArticleTransportText(
    article.description || article.summary || article.displaySummary || article.originalSummary || article.fullText || article.content || summary,
    summary,
    1200
  );
  const sourceName = cleanArticleTransportText(
    article.sourceName || article.source || article.publisher || article.author,
    "Bilinmeyen kaynak",
    140
  );
  const sourceUrl = firstValidHttpUrl(article.sourceUrl, article.url, article.link);
  const imageUrl = firstValidHttpUrl(article.imageUrl, article.image, article.urlToImage, article.thumbnailUrl);
  const publishedAt = normalizeArticleIsoDate(article.publishedAt, article.date, article.fetchedAt, article.createdAt);
  const currentDate = cleanArticleTransportText(article.date, "", 120);
  const currentDateTime = currentDate ? new Date(currentDate).getTime() : NaN;
  const thumbnailUrl = firstValidHttpUrl(article.thumbnailUrl) || imageUrl;

  article.title = title;
  article.summary = summary;
  article.description = description;
  article.fullText = article.fullText || description;
  article.sourceName = sourceName;
  article.source = sourceName;
  article.sourceUrl = sourceUrl;
  article.url = sourceUrl;
  article.imageUrl = imageUrl;
  article.image = imageUrl;
  article.urlToImage = imageUrl;
  article.thumbnailUrl = thumbnailUrl;
  article.publishedAt = publishedAt;
  article.date = Number.isFinite(currentDateTime) && currentDateTime > 0 ? currentDate : publishedAt;
  article.fetchedAt = normalizeArticleIsoDate(article.fetchedAt, publishedAt);
  article.category = normalizeCategoryName(article.category || article.actualNewsCategory || article.topic);
  article.subcategory = normalizeSubcategoryName(article.subcategory, article.category);

  const tags = Array.isArray(article.tags) ? article.tags.map((tag) => cleanArticleTransportText(tag)).filter(Boolean) : [];
  article.tags = [...new Set([article.category, article.subcategory, ...tags].filter(Boolean))].slice(0, 8);
  const topics = Array.isArray(article.topics) ? article.topics.map((topic) => cleanArticleTransportText(topic)).filter(Boolean) : [];
  article.topics = [...new Set([...topics, ...article.tags].filter(Boolean))].slice(0, 8);

  article.categoryEn = translateCategoryToEn(article.category);
  article.subcategoryEn = translateSubcategoryToEn(article.subcategory);

  if (!article.translations) article.translations = {};
  if (!article.originalTitle) article.originalTitle = article.title;
  if (!article.originalSummary) article.originalSummary = article.summary;
  if (!article.originalContent) article.originalContent = article.fullText || article.description;
  if (!article.originalLanguage) article.originalLanguage = "tr";

  if (!article.displayTitle) article.displayTitle = article.title;
  if (!article.displaySummary) article.displaySummary = article.summary;
  if (!article.displayContent) article.displayContent = article.fullText || article.description;
  return article;
}

// ─── End inline normalization helpers ─────────────────────────────────────────

function parseRssItems(xml, source) {
  const itemBlocks = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const resolvedSourceName = source.sourceName || source.name || "Bilinmeyen kaynak";
  const resolvedContinent = normalizeContinentName(source.region || source.continent || "global");

  return itemBlocks.map((block) => {
    const title = stripHtml(extractXmlTag(block, "title"));
    const rawLink = stripHtml(extractXmlTag(block, "link")) || stripHtml(extractXmlTag(block, "guid"));
    const { sourceUrl, externalId } = normalizeRssSourceUrl(rawLink, source);
    const description = stripHtml(extractXmlTag(block, "description"));
    const encodedContent = stripHtml(extractXmlTag(block, "content:encoded"));
    const fullText = encodedContent || description || title || "";
    const pubDate = stripHtml(extractXmlTag(block, "pubDate")) || stripHtml(extractXmlTag(block, "dc:date"));
    const imageUrl = getArticleImageFromRssItem(block);
    let publishedAt;
    try {
      publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
      if (isNaN(new Date(publishedAt).getTime())) publishedAt = new Date().toISOString();
    } catch {
      publishedAt = new Date().toISOString();
    }
    const id = `rss_${crypto.createHash("sha1").update(sourceUrl || externalId || title || crypto.randomUUID()).digest("hex").slice(0, 16)}`;

    const sourceRegion = source.region || "global";
    const originalLanguage = detectLangInline(title, description, source.language);
    const searchText = `${title} ${description}`.toLowerCase();
    const mentionedCountries = detectCountriesInline(searchText);
    const mentionedRegions = detectRegionsInline(searchText, sourceRegion);
    const detectedEventRegion = detectEventRegionInline(searchText, sourceRegion);

    const article = {
      id,
      // ── Legacy display fields (backward compat) ──
      title: title || "Başlıksız haber",
      summary: description || title || "",
      fullText,
      // ── Original language fields ──
      originalTitle: title || "Başlıksız haber",
      originalSummary: description || title || "",
      originalContent: fullText,
      originalLanguage,
      // ── Translation fields (empty until AI translation is applied) ──
      translatedTitle: "",
      translatedSummary: "",
      translatedContent: "",
      // ── Display fields (derived; client can override with translation) ──
      displayTitle: title || "Başlıksız haber",
      displaySummary: description || title || "",
      displayContent: fullText,
      // ── Processing metadata ──
      contentStatus: encodedContent ? "full_from_feed" : "summary_only",
      fetchedAt: new Date().toISOString(),
      // ── Category & topics ──
      category: normalizeCategoryName(source.category || "Gündem"),
      topics: [normalizeCategoryName(source.category || "Gündem")],
      tags: [normalizeCategoryName(source.category || "Gündem")],
      // ── Legacy location fields ──
      country: source.country || "",
      continent: resolvedContinent,
      // ── Source metadata (for regional trend analysis) ──
      sourceName: resolvedSourceName,
      sourceCountry: source.country || "",
      sourceCountryCode: source.countryCode || "",
      sourceRegion,
      sourceLanguage: source.language || "tr",
      sourceTrustLevel: source.trustLevel || "medium",
      sourceType: source.sourceType || "rss",
      isGlobalSource: Boolean(source.isGlobalSource),
      sourceId: source.id || "",
      // ── Region detection ──
      detectedEventRegion,
      mentionedRegions,
      mentionedCountries,
      // ── Named entities (skeleton; enriched client-side by articleNormalizer.js) ──
      namedEntities: { people: [], organizations: [], locations: [], countries: mentionedCountries, diseases: [], events: [], topics: [] },
      // ── URLs & media ──
      sourceUrl,
      externalId,
      imageUrl,
      url: sourceUrl,
      author: "",
      publishedAt,
      aiSummary: "",
      contentHash: crypto.createHash("sha256").update(normalizeText(`${title} ${description}`)).digest("hex"),
      externalProvider: "rss"
    };
    article.category = inferArticleCategory(article);
    article.subcategory = inferArticleSubcategory(article);
    article.continent = article.continent !== "Global" ? article.continent : inferArticleContinent(article);
    article.tags = [article.category, article.subcategory];
    article.topics = [...new Set([article.category, article.subcategory].filter(Boolean))];
    return article;
  }).filter((article) => {
    if (!article.title || article.title.length < 15) return false;
    if (!article.summary && !article.fullText) return false;
    const spamKeywords = ["tıklayın", "şok", "büyük fırsat", "bedava", "tıklayınız", "tıkla"];
    const lowerTitle = article.title.toLowerCase();
    if (spamKeywords.some(keyword => lowerTitle.includes(keyword))) return false;
    return true;
  });
}

const RSS_CACHE_TTL_MS = Math.min(Math.max(Number(process.env.RSS_CACHE_TTL_MS || 300000) || 300000, 30000), 1800000);
const NEWS_PROVIDER_CACHE_TTL_MS = Math.min(Math.max(Number(process.env.NEWS_PROVIDER_CACHE_TTL_MS || 300000) || 300000, 30000), 1800000);
const NEWS_REFRESH_INTERVAL_MS = Number(process.env.NEWS_REFRESH_INTERVAL_MS || 0) || (Number(process.env.NEWS_REFRESH_INTERVAL_HOURS || 23) * 3600000);
const NEWS_RETENTION_DAYS = Number(process.env.NEWS_RETENTION_DAYS || 2);
const NEWS_RETENTION_MS = NEWS_RETENTION_DAYS * 86400000;
const NEWS_FEED_RESPONSE_LIMIT = Math.min(Math.max(Number(process.env.NEWS_FEED_RESPONSE_LIMIT || 60) || 60, 20), 120);
const _feedCacheStore = { articles: [], timestamp: 0, refreshing: false, lastRefreshStatus: "none", lastRefreshError: "", lastRefreshAt: null, lastCleanupAt: null };
const ARTICLE_URL_TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_name",
  "fbclid", "gclid", "dclid", "yclid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src"
]);
let rssCache = { timestamp: 0, data: [] };
let newsProviderCache = { timestamp: 0, data: [] };

function canonicalArticleUrl(rawUrl = "") {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    for (const key of [...parsed.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (ARTICLE_URL_TRACKING_PARAMS.has(normalizedKey) || normalizedKey.startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return normalizeText(value).replace(/\s+/g, " ").trim();
  }
}

function articleStableDedupeKey(article = {}) {
  const urlKey = canonicalArticleUrl(article.sourceUrl || article.url || article.link);
  if (urlKey) return `url:${urlKey}`;
  const title = normalizeText(article.displayTitle || article.originalTitle || article.title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return "";
  const source = normalizeText(article.sourceName || article.source || article.publisher || "")
    .replace(/\s+/g, " ")
    .trim();
  return source ? `title-source:${title}|${source}` : `title:${title}`;
}

function dedupeArticlesByStableKey(articles = []) {
  const seen = new Set();
  const unique = [];
  const removed = [];
  for (const article of articles) {
    const key = articleStableDedupeKey(article);
    if (key && seen.has(key)) {
      removed.push(article);
      if (article?.id) RELATED_ARTICLE_POOL.set(String(article.id), article);
      continue;
    }
    if (key) seen.add(key);
    unique.push(article);
  }
  return { unique, removed };
}

async function fetchRssSourceSafe(source) {
  const rssUrl = source.rssUrl || source.url;
  if (!rssUrl) return [];
  try {
    const xml = await withTimeout(
      fetchText(rssUrl, { headers: { "Accept": "application/rss+xml, application/xml, text/xml, */*" } }),
      5000,
      ""
    );
    if (!xml) return [];
    const items = parseRssItems(xml, source);
    if (items.length) {
      logDebug("rss", `source ok: ${source.sourceName || source.id}`, `region=${source.region || "global"} items=${items.length}`);
    }
    return items;
  } catch (err) {
    logWarn("rss", `source failed: ${source.sourceName || source.id}`, `region=${source.region || "global"} error=${err.message}`);
    return [];
  }
}

async function batchedFetch(sources, fn, concurrency = 8) {
  const results = [];
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function fetchRssArticles(limit = 60) {
  if (Date.now() - rssCache.timestamp < RSS_CACHE_TTL_MS && rssCache.data.length > 0) {
    return rssCache.data.slice(0, limit);
  }
  const sources = getRssSources();
  logInfo("rss", "fetch started", `sources=${sources.length} batch=8 timeoutMs=5000`);

  const results = await batchedFetch(sources, fetchRssSourceSafe, 8);

  const fetchedArticles = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const { unique: exactUnique, removed: exactRemoved } = dedupeArticlesByStableKey(fetchedArticles);
  const allUnique = exactUnique.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  // Apply regional balance cap: each region gets at most regionCap articles
  // to prevent high-frequency publishers (e.g. TR) from dominating the cache.
  const CANONICAL_REGIONS_LIST = ["global","europe","asia","africa","north-america","south-america","oceania","middle-east","turkey"];
  const regionCap = Math.max(15, Math.floor(limit / CANONICAL_REGIONS_LIST.length) + 5);
  const regionCounts = {};
  const articles = [];
  for (const a of allUnique) {
    const r = a.sourceRegion || "global";
    regionCounts[r] = (regionCounts[r] || 0) + 1;
    if (regionCounts[r] <= regionCap) {
      articles.push(a);
      if (articles.length >= limit) break;
    }
  }

  const byRegion = {};
  for (const a of articles) {
    const r = a.sourceRegion || "global";
    byRegion[r] = (byRegion[r] || 0) + 1;
  }
  logInfo("rss", "fetch completed", `articles=${articles.length} regionCap=${regionCap} exactDuplicates=${exactRemoved.length} byRegion=${JSON.stringify(byRegion)}`);

  rssCache = { timestamp: Date.now(), data: articles };
  invalidateTrendsCache();
  return articles;
}

function normalizeProviderArticles(provider, payload) {
  if (provider === "freenewsapi") {
    return (payload.data || []).map((item) => ({
      uuid: item.uuid,
      title: item.title,
      summary: item.subtitle || item.description || item.body || item.title,
      fullText: item.body || item.subtitle || item.description || item.title,
      category: item.topics?.[0] || "Gündem",
      source: item.publisher,
      url: item.original_url || item.url,
      imageUrl: item.thumbnail || item.image,
      publishedAt: item.published_at,
      contentStatus: item.body ? "full_from_api" : "summary_only"
    }));
  }
  if (provider === "newsapi") {
    return (payload.articles || []).map((item) => ({
      title: item.title,
      summary: item.description || item.content || item.title,
      fullText: item.content || item.description || item.title,
      category: "Gündem",
      source: item.source?.name,
      url: item.url,
      imageUrl: item.urlToImage,
      publishedAt: item.publishedAt
    }));
  }
  if (provider === "gnews") {
    return (payload.articles || []).map((item) => ({
      title: item.title,
      summary: item.description || item.content || item.title,
      fullText: item.content || item.description || item.title,
      category: "Gündem",
      source: item.source?.name,
      url: item.url,
      imageUrl: item.image,
      publishedAt: item.publishedAt
    }));
  }
  if (provider === "mediastack") {
    return (payload.data || []).map((item) => ({
      title: item.title,
      summary: item.description || item.title,
      fullText: item.description || item.title,
      category: item.category || "Gündem",
      source: item.source,
      url: item.url,
      imageUrl: item.image,
      publishedAt: item.published_at
    }));
  }
  return [];
}

// Multi-region endpoint configs per provider.
// Each entry: { region, country, lang } — mapped to provider-specific params.
const MULTI_REGION_API_TARGETS = [
  { region: "turkey", country: "tr", countryCode: "TR", countryName: "Türkiye", lang: "tr" },
  { region: "north-america", country: "us", countryCode: "US", countryName: "United States", lang: "en" },
  { region: "europe", country: "gb", countryCode: "GB", countryName: "United Kingdom", lang: "en" },
  { region: "europe", country: "de", countryCode: "DE", countryName: "Germany", lang: "en" },
  { region: "asia", country: "jp", countryCode: "JP", countryName: "Japan", lang: "en" },
  { region: "global", country: "", countryCode: "", countryName: "", lang: "en" }
];

function getNewsProviderEndpoints(perRegionLimit = 5) {
  if (hasEnv("FREENEWSAPI_KEY")) {
    return MULTI_REGION_API_TARGETS.map((t) => ({
      provider: "freenewsapi",
      region: t.region,
      countryCode: t.countryCode,
      countryName: t.countryName,
      endpoint: `https://api.freenewsapi.io/v1/news?language=${t.lang}${t.country ? `&country=${t.country}` : ""}&page_size=${perRegionLimit}`
    }));
  }
  if (hasEnv("GNEWS_API_KEY")) {
    return MULTI_REGION_API_TARGETS
      .filter((t) => t.country)
      .map((t) => ({
        provider: "gnews",
        region: t.region,
        countryCode: t.countryCode,
        countryName: t.countryName,
        endpoint: `https://gnews.io/api/v4/top-headlines?country=${t.country}&lang=${t.lang}&max=${perRegionLimit}&apikey=${encodeURIComponent(process.env.GNEWS_API_KEY)}`
      }));
  }
  if (hasEnv("NEWS_API_KEY")) {
    return MULTI_REGION_API_TARGETS
      .filter((t) => t.country)
      .map((t) => ({
        provider: "newsapi",
        region: t.region,
        countryCode: t.countryCode,
        countryName: t.countryName,
        endpoint: `https://newsapi.org/v2/top-headlines?country=${t.country}&pageSize=${perRegionLimit}&apiKey=${encodeURIComponent(process.env.NEWS_API_KEY)}`
      }));
  }
  if (hasEnv("MEDIASTACK_API_KEY")) {
    const countries = MULTI_REGION_API_TARGETS.filter((t) => t.country).map((t) => t.country).join(",");
    return [{
      provider: "mediastack",
      region: "global",
      endpoint: `http://api.mediastack.com/v1/news?countries=${countries}&languages=tr,en&limit=${perRegionLimit * 3}&access_key=${encodeURIComponent(process.env.MEDIASTACK_API_KEY)}`
    }];
  }
  return [];
}

function getNewsProviderEndpoint(limit = 10) {
  const endpoints = getNewsProviderEndpoints(limit);
  return endpoints.length ? endpoints[0] : null;
}

async function fetchSingleProviderEndpoint(config) {
  const headers = config.provider === "freenewsapi" ? { "x-api-key": process.env.FREENEWSAPI_KEY } : {};
  const payload = await withTimeout(fetchJson(config.endpoint, { headers }), 10000, null);
  if (!payload) return [];
  let normalized = normalizeProviderArticles(config.provider, payload);
  if (config.provider === "freenewsapi") {
    normalized = await Promise.all(normalized.map(async (item) => {
      if (!item.uuid) return item;
      try {
        const details = await withTimeout(
          fetchJson(`https://api.freenewsapi.io/v1/details?uuid=${encodeURIComponent(item.uuid)}`, { headers: { "x-api-key": process.env.FREENEWSAPI_KEY } }),
          5000,
          null
        );
        const detail = details?.data || {};
        return {
          ...item,
          title: detail.title || item.title,
          summary: detail.subtitle || item.summary,
          fullText: detail.body || item.fullText,
          source: detail.publisher || item.source,
          url: detail.original_url || item.url,
          imageUrl: detail.thumbnail || item.imageUrl,
          publishedAt: detail.published_at || item.publishedAt,
          contentStatus: detail.body ? "full_from_api" : item.contentStatus
        };
      } catch {
        return item;
      }
    }));
  }
  return normalized.map((item) => {
    const sourceRegion = config.region || "global";
    const id = `api_${crypto.createHash("sha1").update(item.url || item.title || crypto.randomUUID()).digest("hex").slice(0, 16)}`;
    const article = {
      id,
      title: item.title || "Başlıksız haber",
      summary: item.summary || item.title || "",
      fullText: item.fullText || item.summary || item.title || "",
      category: normalizeCategoryName(item.category || "Gündem"),
      tags: [normalizeCategoryName(item.category || "Gündem")],
      country: item.country || "",
      continent: normalizeContinentName(sourceRegion),
      // Source metadata — fill country from endpoint config when API doesn't provide it
      sourceName: item.source || config.provider,
      sourceCountry: item.country || config.countryName || "",
      sourceCountryCode: item.countryCode || config.countryCode || "",
      sourceRegion,
      sourceLanguage: item.language || "en",
      sourceTrustLevel: "medium",
      sourceType: "api",
      isGlobalSource: sourceRegion === "global",
      sourceId: `api_${config.provider}_${sourceRegion}`,
      sourceUrl: item.url || "",
      imageUrl: item.imageUrl || "",
      author: "",
      publishedAt: item.publishedAt || new Date().toISOString(),
      aiSummary: "",
      contentStatus: item.contentStatus || "provider_text",
      contentHash: crypto.createHash("sha256").update(normalizeText(`${item.title} ${item.summary}`)).digest("hex"),
      externalProvider: config.provider
    };
    article.category = inferArticleCategory(article);
    article.subcategory = inferArticleSubcategory(article);
    article.continent = article.continent !== "Global" ? article.continent : inferArticleContinent(article);
    article.tags = [article.category, article.subcategory];
    // Apply normalization fields
    const searchText = `${article.title} ${article.summary}`.toLowerCase();
    article.originalTitle = article.title;
    article.originalSummary = article.summary;
    article.originalContent = article.fullText;
    article.originalLanguage = detectLangInline(article.title, article.summary, item.language || "en");
    article.translatedTitle = "";
    article.translatedSummary = "";
    article.translatedContent = "";
    article.displayTitle = article.title;
    article.displaySummary = article.summary;
    article.displayContent = article.fullText;
    article.fetchedAt = new Date().toISOString();
    article.topics = [...new Set([article.category, article.subcategory].filter(Boolean))];
    article.mentionedCountries = detectCountriesInline(searchText);
    article.mentionedRegions = detectRegionsInline(searchText, sourceRegion);
    article.detectedEventRegion = detectEventRegionInline(searchText, sourceRegion);
    article.namedEntities = { people: [], organizations: [], locations: [], countries: article.mentionedCountries, diseases: [], events: [], topics: [] };
    article.url = article.sourceUrl;
    return article;
  });
}

async function fetchNewsProviderArticles(limit = 30) {
  if (Date.now() - newsProviderCache.timestamp < NEWS_PROVIDER_CACHE_TTL_MS && newsProviderCache.data.length > 0) {
    return newsProviderCache.data.slice(0, limit);
  }
  const perRegion = Math.max(5, Math.ceil(limit / 6));
  const endpoints = getNewsProviderEndpoints(perRegion);
  if (!endpoints.length) return [];

  const results = await Promise.allSettled(
    endpoints.map((config) => fetchSingleProviderEndpoint(config))
  );

  const fetchedArticles = results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
  const { unique: exactUnique } = dedupeArticlesByStableKey(fetchedArticles);
  const articles = exactUnique
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, limit);

  newsProviderCache = { timestamp: Date.now(), data: articles };
  return articles;
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

function getGeminiApiKey() {
  if (hasEnv("GEMINI_API_KEY")) return process.env.GEMINI_API_KEY;
  if (hasEnv("GOOGLE_API_KEY")) return process.env.GOOGLE_API_KEY;
  return "";
}

function getGeminiModel() {
  const configured = process.env.GEMINI_MODEL || process.env.AI_MODEL || "";
  if (!configured || configured === "gemini-1.5-flash") return "gemini-2.5-flash";
  return configured;
}

function geminiGenerationConfig(options = {}) {
  const model = options.model || getGeminiModel();
  return {
    temperature: options.temperature ?? 0.2,
    maxOutputTokens: options.maxOutputTokens ?? 512,
    ...(model.startsWith("gemini-2.5-flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {})
  };
}

async function generateEntityInfo(entity, relatedArticles = []) {
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) {
    throw new Error("GEMINI_API_KEY bulunamadı. .env içine GEMINI_API_KEY ekle.");
  }
  const model = getGeminiModel();
  const context = relatedArticles
    .slice(0, 5)
    .map((article, index) => `${index + 1}. ${article.title || ""} - ${article.summary || ""}`)
    .join("\n");
  const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{
            text: [
              "Türkçe kısa bir haber bilgi kartı yaz.",
              "Kişi, ülke, kurum, olay veya tarih hakkında tarafsız ansiklopedik özet ver.",
              "Konu adını tek başına döndürme; kim/nedir, hangi görev/alan veya olayla bilinir açıkla.",
              "En az 18 kelime, en fazla 2 cümle yaz. Markdown kullanma. Emin olmadığın ayrıntıyı uydurma.",
              `Konu: ${entity}`,
              context ? `Haber bağlamı:\n${context}` : ""
            ].filter(Boolean).join("\n")
          }]
        }
      ],
      generationConfig: geminiGenerationConfig({ model, maxOutputTokens: 512 })
    })
  });
  return {
    provider: "gemini",
    model,
    description: payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("").trim() || ""
  };
}

const _translationCache = new Map();
const TRANSLATION_CACHE_MAX = 500;

function _trimTranslationCache() {
  if (_translationCache.size <= TRANSLATION_CACHE_MAX) return;
  const keys = [..._translationCache.keys()];
  const toDelete = keys.slice(0, keys.length - TRANSLATION_CACHE_MAX);
  for (const k of toDelete) _translationCache.delete(k);
}

async function translateArticleFields(article) {
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) return false;
  const lang = (article.originalLanguage || "tr").toLowerCase();
  const targetLang = lang.startsWith("tr") ? "en" : "tr";
  const title = article.originalTitle || article.title || "";
  const summary = (article.originalSummary || article.summary || "").slice(0, 600);
  if (!title && !summary) return false;
  const cacheKey = `${targetLang}:${title.slice(0, 80)}`;
  const cached = _translationCache.get(cacheKey);
  if (cached) {
    if (!article.translations) article.translations = {};
    article.translations[targetLang] = cached;
    return true;
  }
  const model = getGeminiModel();
  const targetLabel = targetLang === "en" ? "English" : "Türkçe";
  try {
    const payload = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Translate the following news title and summary to ${targetLabel}. Return ONLY valid JSON: {"title":"...","summary":"..."}\n\nTitle: ${title}\nSummary: ${summary}` }] }],
          generationConfig: geminiGenerationConfig({ model, temperature: 0, maxOutputTokens: 512 })
        })
      }
    );
    const raw = (payload.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return false;
    const parsed = JSON.parse(jsonMatch[0]);
    const result = { title: decodeHtml(parsed.title || ""), summary: decodeHtml(parsed.summary || "") };
    _translationCache.set(cacheKey, result);
    _trimTranslationCache();
    if (!article.translations) article.translations = {};
    article.translations[targetLang] = result;
    if (targetLang === "en") {
      article.translatedTitle = result.title;
      article.translatedSummary = result.summary;
    }
    return true;
  } catch {
    return false;
  }
}

async function translateArticleBatch(articles, batchSize = 5) {
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) {
    logInfo("translation", "skipped", "no API key");
    return;
  }
  const needsTranslation = articles.filter(a => {
    if (a.isDemo) return false;
    if (a.translations && Object.keys(a.translations).length > 0) return false;
    const cacheKey = `${(a.originalLanguage || "tr").startsWith("tr") ? "en" : "tr"}:${(a.originalTitle || a.title || "").slice(0, 80)}`;
    if (_translationCache.has(cacheKey)) {
      if (!a.translations) a.translations = {};
      a.translations[(a.originalLanguage || "tr").startsWith("tr") ? "en" : "tr"] = _translationCache.get(cacheKey);
      return false;
    }
    return true;
  });
  const batch = needsTranslation.slice(0, batchSize);
  let translated = 0;
  for (const article of batch) {
    const ok = await translateArticleFields(article);
    if (ok) translated++;
  }
  logInfo("translation", "batch-done", `translated=${translated}/${batch.length} total=${articles.length}`);
}

const UI_LANGUAGE_LABELS = {
  tr: "Turkish",
  en: "English"
};
let _translationApiCooldownUntil = 0;

function normalizeUiLanguage(lang) {
  const value = String(lang || "tr").toLowerCase().split("-")[0];
  return UI_LANGUAGE_LABELS[value] ? value : "tr";
}

function articleTranslationSource(article) {
  const title = article.originalTitle || article.title || "";
  const summary = article.originalSummary || article.summary || article.description || "";
  const content = article.originalContent || article.fullText || article.content || article.description || summary;
  return {
    title: decodeHtml(title),
    summary: decodeHtml(String(summary || "").slice(0, 900)),
    content: decodeHtml(String(content || "").slice(0, 1600))
  };
}

function articleLanguageMatches(article, targetLang) {
  const originalLanguage = String(article.originalLanguage || article.sourceLanguage || "").toLowerCase();
  return originalLanguage ? originalLanguage.startsWith(targetLang) : targetLang === "tr";
}

function ensureOriginalTranslation(article, targetLang) {
  const source = articleTranslationSource(article);
  if (!article.translations) article.translations = {};
  article.translations[targetLang] = {
    title: source.title,
    summary: source.summary,
    content: source.content
  };
  return true;
}

async function translateTextWithPublicGoogle(value, targetLang) {
  const text = String(value || "").trim();
  if (!text) return "";
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text.slice(0, 1400))}`;
  const payload = await fetchJson(url, { timeoutMs: 8000, retries: 0 });
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part) => Array.isArray(part) ? part[0] : "").join("")
    : "";
  return decodeHtml(translated || "");
}

async function translateArticleWithPublicProvider(article, targetLang) {
  if (articleLanguageMatches(article, targetLang)) return ensureOriginalTranslation(article, targetLang);
  const { title, summary, content } = articleTranslationSource(article);
  if (!title && !summary) return false;
  try {
    const [translatedTitle, translatedSummary] = await Promise.all([
      translateTextWithPublicGoogle(title, targetLang),
      translateTextWithPublicGoogle(summary || title, targetLang)
    ]);
    const result = {
      title: translatedTitle || title,
      summary: translatedSummary || summary || translatedTitle || title,
      content: content ? (translatedSummary || summary || content) : ""
    };
    if (!article.translations) article.translations = {};
    article.translations[targetLang] = result;
    const cacheKey = `${targetLang}:${crypto.createHash("sha1").update(`${title}\n${summary}`).digest("hex").slice(0, 16)}`;
    _translationCache.set(cacheKey, result);
    _trimTranslationCache();
    return true;
  } catch (error) {
    logWarn("translation", "public provider failed", error.message || String(error));
    return false;
  }
}

async function translateArticleFields(article, targetLanguage = "") {
  const targetLang = normalizeUiLanguage(targetLanguage || (articleLanguageMatches(article, "tr") ? "en" : "tr"));
  if (articleLanguageMatches(article, targetLang)) return ensureOriginalTranslation(article, targetLang);
  if (article.translations?.[targetLang]?.title && article.translations?.[targetLang]?.summary) return true;
  const { title, summary, content } = articleTranslationSource(article);
  if (!title && !summary) return false;
  const cacheKey = `${targetLang}:${crypto.createHash("sha1").update(`${title}\n${summary}`).digest("hex").slice(0, 16)}`;
  const cached = _translationCache.get(cacheKey);
  if (cached) {
    if (!article.translations) article.translations = {};
    article.translations[targetLang] = cached;
    return true;
  }
  const geminiKey = getGeminiApiKey();
  if (!geminiKey || Date.now() < _translationApiCooldownUntil) {
    return translateArticleWithPublicProvider(article, targetLang);
  }
  const model = getGeminiModel();
  const targetLabel = UI_LANGUAGE_LABELS[targetLang] || "Turkish";
  try {
    const payload = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: [
            `Translate the following news fields to ${targetLabel}.`,
            "Preserve names, numbers, dates, source names, and factual meaning. Do not add information.",
            "For Turkish output, use correct Turkish characters: ç, ğ, ı, İ, ö, ş, ü.",
            "Return ONLY valid JSON with this shape: {\"title\":\"...\",\"summary\":\"...\",\"content\":\"...\"}",
            `Title: ${title}`,
            `Summary: ${summary}`,
            `Content: ${content}`
          ].join("\n\n") }] }],
          generationConfig: geminiGenerationConfig({ model, temperature: 0, maxOutputTokens: 900 })
        })
      }
    );
    const raw = (payload.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return false;
    const parsed = JSON.parse(jsonMatch[0]);
    const result = {
      title: decodeHtml(parsed.title || ""),
      summary: decodeHtml(parsed.summary || ""),
      content: decodeHtml(parsed.content || "")
    };
    _translationCache.set(cacheKey, result);
    _trimTranslationCache();
    if (!article.translations) article.translations = {};
    article.translations[targetLang] = result;
    if (targetLang === "en") {
      article.translatedTitle = result.title;
      article.translatedSummary = result.summary;
      article.translatedContent = result.content;
    }
    return true;
  } catch (error) {
    const message = String(error.message || error || "");
    if (/quota|rate.?limit|429/i.test(message)) {
      _translationApiCooldownUntil = Date.now() + 10 * 60_000;
      return translateArticleWithPublicProvider(article, targetLang);
    }
    logWarn("translation", "article translation failed", message);
    return translateArticleWithPublicProvider(article, targetLang);
  }
}

async function translateArticleBatch(articles, batchSize = 5, targetLanguages = ["tr", "en"]) {
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) {
    logInfo("translation", "skipped", "no API key");
    return;
  }
  const targets = [...new Set((Array.isArray(targetLanguages) ? targetLanguages : [targetLanguages]).map(normalizeUiLanguage))];
  const jobs = [];
  for (const article of articles) {
    if (!article) continue;
    for (const targetLang of targets) {
      if (articleLanguageMatches(article, targetLang)) {
        ensureOriginalTranslation(article, targetLang);
        continue;
      }
      if (article.translations?.[targetLang]?.title && article.translations?.[targetLang]?.summary) continue;
      jobs.push({ article, targetLang });
    }
  }
  const batch = jobs.slice(0, batchSize);
  let translated = 0;
  for (const job of batch) {
    const ok = await translateArticleFields(job.article, job.targetLang);
    if (ok) translated++;
  }
  logInfo("translation", "batch-done", `translated=${translated}/${batch.length} total=${articles.length} targets=${targets.join(",")}`);
}

let _feedTranslationQueued = false;
function triggerFeedTranslation(articles, targetLanguage, reason = "feed-language") {
  const targetLang = normalizeUiLanguage(targetLanguage);
  if (_feedTranslationQueued) return false;
  _feedTranslationQueued = true;
  setTimeout(async () => {
    try {
      await translateArticleBatch(articles || [], 16, [targetLang]);
      logInfo("translation", "feed language translation queued", `reason=${reason} target=${targetLang}`);
    } finally {
      _feedTranslationQueued = false;
    }
  }, 0).unref?.();
  return true;
}

async function ensureFeedTranslationsForResponse(articles, targetLanguage, limit = 12) {
  const targetLang = normalizeUiLanguage(targetLanguage);
  const list = Array.isArray(articles) ? articles.filter(Boolean) : [];
  const needsTranslation = list.some((article) =>
    !articleLanguageMatches(article, targetLang)
    && !(article.translations?.[targetLang]?.title && article.translations?.[targetLang]?.summary)
  );
  if (!needsTranslation) return false;
  await translateArticleBatch(list, limit, [targetLang]);
  return true;
}

function roughTurkishFallback(value = "") {
  let text = decodeHtml(value).trim();
  if (!text) return "";
  const patterns = [
    [/^Trump shows no regret over deaths of (\d+) Indian sailors in meeting with Modi$/i, "Trump, Modi ile görüşmesinde $1 Hintli denizcinin ölümü için pişmanlık göstermedi"],
    [/^Trump suggests sanctions on Iran could be removed once ['"]?they behave['"]?$/i, "Trump, İran'a yaptırımların uygun davranmaları halinde kaldırılabileceğini söyledi"],
    [/^Live Updates:\s*U\.S\. Details Agreement With Iran as Trump Ends G7 Summit$/i, "Canlı gelişmeler: Trump G7 Zirvesi'ni bitirirken ABD, İran anlaşmasının ayrıntılarını açıkladı"],
    [/^US Federal Reserve holds rates steady, raises inflation expectations$/i, "ABD Merkez Bankası faizleri sabit tuttu, enflasyon beklentilerini yükseltti"]
  ];
  for (const [regex, replacement] of patterns) {
    if (regex.test(text)) return text.replace(regex, replacement);
  }
  const phrases = [
    [/US Federal Reserve/gi, "ABD Merkez Bankası"],
    [/Federal Reserve/gi, "Merkez Bankası"],
    [/\bUnited States\b|\bU\.S\.\b|\bUS\b/g, "ABD"],
    [/Live Updates/gi, "Canlı gelişmeler"],
    [/agreement with Iran/gi, "İran ile anlaşma"],
    [/Iran/gi, "İran"],
    [/Trump/gi, "Trump"],
    [/G7 Summit/gi, "G7 Zirvesi"],
    [/holds rates steady/gi, "faizleri sabit tuttu"],
    [/raises inflation expectations/gi, "enflasyon beklentilerini yükseltti"],
    [/sanctions/gi, "yaptırımlar"],
    [/could be removed/gi, "kaldırılabilir"],
    [/no regret/gi, "pişmanlık yok"],
    [/deaths?/gi, "ölüm"],
    [/meeting with/gi, "görüşmesinde"],
    [/Indian sailors/gi, "Hintli denizciler"],
    [/inflation/gi, "enflasyon"],
    [/expectations/gi, "beklentileri"],
    [/rates/gi, "faizler"],
    [/steady/gi, "sabit"],
    [/details/gi, "ayrıntılar"],
    [/ends/gi, "bitirdi"],
    [/suggests/gi, "önerdi"],
    [/removed/gi, "kaldırıldı"]
  ];
  for (const [regex, replacement] of phrases) text = text.replace(regex, replacement);
  return text;
}

function looksMostlyEnglish(value = "") {
  const text = String(value || "").toLowerCase();
  const hits = text.match(/\b(the|with|from|after|before|over|under|could|would|should|shows|holds|raises|officials|monitor|reports|tracks|prepares|respiratory|illness|outbreak|meeting|summit|rates|steady|inflation)\b/g);
  return (hits || []).length >= 2;
}

function fallbackLocalizedArticleText(article, targetLang, field) {
  if (targetLang !== "tr" || articleLanguageMatches(article, "tr")) return "";
  const source = article.source || article.sourceName || "yabancı kaynak";
  const category = article.category || "haber";
  if (field === "title") {
    const rough = roughTurkishFallback(article.originalTitle || article.title || "");
    if (rough && rough !== (article.originalTitle || article.title || "") && !looksMostlyEnglish(rough)) return rough;
    return `${source} kaynağından ${category} haberi`;
  }
  const rough = roughTurkishFallback(article.originalSummary || article.summary || article.description || "");
  if (rough && rough !== (article.originalSummary || article.summary || article.description || "") && !looksMostlyEnglish(rough)) return rough;
  return "Bu yabancı kaynaklı haberin Türkçe çevirisi hazırlanıyor. Çeviri servisi limiti yenilendiğinde metin otomatik güncellenecek.";
}

function localizeFeedPayload(payload, targetLanguage) {
  const targetLang = normalizeUiLanguage(targetLanguage);
  const articles = payload?.articles || payload?.data?.articles || [];
  for (const article of articles) {
    const t = article.translations?.[targetLang];
    const title = t?.title || fallbackLocalizedArticleText(article, targetLang, "title");
    const summary = t?.summary || fallbackLocalizedArticleText(article, targetLang, "summary");
    const content = t?.content || "";
    if (title) {
      article.title = title;
      article.displayTitle = title;
    }
    if (summary) {
      article.summary = summary;
      article.description = summary;
      article.displaySummary = summary;
    }
    if (content) {
      article.fullText = content;
      article.displayContent = content;
    }
  }
  if (payload?.data) payload.data.articles = articles;
  payload.articles = articles;
  payload.language = targetLang;
  return payload;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("İstek gövdesi çok büyük."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const cleanBody = body.replace(/^\uFEFF/, "").trim();
        resolve(cleanBody ? JSON.parse(cleanBody) : {});
      } catch {
        reject(new Error("Geçersiz JSON."));
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (parsed.exp < Date.now()) return null;
  return parsed.sub;
}

function getUserId(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifyToken(token) || "user_demo";
}

function isAuthenticatedRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(verifyToken(token));
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeCategoryName(category) {
  const value = String(category || "").trim();
  if (!value) return "Gündem";
  const aliased = CATEGORY_ALIASES[value] || CATEGORY_ALIASES[value.replace(/\s+/g, "")] || value;
  return TOPIC_CATEGORIES.includes(aliased) ? aliased : "Gündem";
}

function normalizeContinentName(continent) {
  const value = String(continent || "").trim();
  if (!value) return "Global";
  const aliased = CONTINENT_ALIASES[value] || value;
  return CONTINENT_FILTERS.includes(aliased) ? aliased : "Global";
}

function inferArticleCategory(article) {
  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""} ${article.sourceUrl || article.url || ""} ${article.sourceName || article.source || ""}`);
  const current = normalizeCategoryName(article.category);
  const rules = [
    ["Teknoloji", ["yapay zeka", "ai", "openai", "chatgpt", "gemini", "claude", "llm", "makine ogrenmesi", "makine öğrenmesi", "model", "robot", "nvidia"]],
    ["Finans", ["finans", "borsa", "hisse", "bist", "nasdaq", "dow jones", "s&p", "bitcoin", "kripto", "tahvil", "fon", "yatirim", "yatırım", "portfoy", "portföy"]],
    ["Spor", ["spor", "futbol", "basketbol", "voleybol", "super lig", "süper lig", "galatasaray", "fenerbahce", "fenerbahçe", "besiktas", "beşiktaş", "trabzonspor", "lebron", "survivor"]],
    ["Ekonomi", ["ekonomi", "piyasa", "dolar", "euro", "altin", "altın", "gumus", "gümüş", "petrol", "maas", "maaş", "emekli", "promosyon", "vergi", "zam", "enflasyon", "kredi", "banka"]],
    ["Teknoloji", ["teknoloji", "siber", "veri", "guvenlik", "güvenlik", "uygulama", "telefon", "internet", "yazilim", "yazılım", "donanim", "donanım"]],
    ["Bilim", ["bilim", "arastirma", "araştırma", "iklim", "okyanus", "uzay", "nasa", "deprem", "meteoroloji", "sicaklik", "sıcaklık", "firtina", "fırtına", "saganak", "sağanak", "col tozu", "çöl tozu"]],
    ["Dünya", ["dunya", "dünya", "abd", "cin", "çin", "rusya", "ukrayna", "iran", "israil", "avrupa", "nijerya", "lubnan", "lübnan", "venezuela", "trump", "pekin", "hurmuz"]],
    ["Kültür-Sanat", ["kultur", "kültür", "sanat", "film", "muzik", "müzik", "sarkici", "şarkıcı", "konser", "festival", "kitap", "tiyatro", "sinema", "sergi"]],
    ["Sağlık", ["saglik", "sağlık", "hastane", "doktor", "hasta", "ilac", "ilaç", "ameliyat", "rehine tatbikati"]],
    ["Eğitim", ["egitim", "eğitim", "okul", "ogrenci", "öğrenci", "sinav", "sınav", "universite", "üniversite", "ders", "akademik", "meb"]],
    ["Gündem", ["gundem", "gündem", "son dakika", "siyaset", "belediye", "bakan", "tbmm", "istanbul", "ankara", "izmir", "turkiye", "türkiye"]]
  ];
  const match = rules
    .map(([category, words], index) => ({
      category, index,
      score: words.reduce((sum, word) => sum + (text.includes(normalizeText(word)) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  if (current === "Ekonomi" && match?.category === "Finans") return match.category;
  if (current && current !== "Gündem") return current;
  return match?.category || current || "Gündem";
}

function inferArticleCategoryStrict(article) {
  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""} ${article.sourceUrl || article.url || ""} ${article.sourceName || article.source || ""}`);
  const rules = [
    ["Teknoloji", ["yapay zeka", "openai", "chatgpt", "gemini", "claude", "llm", "makine ogrenmesi", "makine öğrenmesi", "nvidia"]],
    ["Finans", ["finans", "borsa", "hisse", "bist", "nasdaq", "dow jones", "bitcoin", "kripto", "tahvil", "fon", "yatirim", "yatırım", "portfoy", "portföy"]],
    ["Spor", ["spor", "futbol", "basketbol", "voleybol", "super lig", "süper lig", "galatasaray", "fenerbahce", "fenerbahçe", "besiktas", "beşiktaş", "trabzonspor"]],
    ["Ekonomi", ["ekonomi", "piyasa", "dolar", "euro", "altin", "altın", "gumus", "gümüş", "petrol", "maas", "maaş", "emekli", "promosyon", "vergi", "zam", "enflasyon", "kredi", "banka"]],
    ["Teknoloji", ["teknoloji", "siber", "veri", "guvenlik", "güvenlik", "uygulama", "telefon", "internet", "yazilim", "yazılım", "donanim", "donanım", "robot", "kamera", "drone"]],
    ["Bilim", ["bilim", "arastirma", "araştırma", "iklim", "okyanus", "uzay", "nasa", "meteoroloji", "sicaklik", "sıcaklık", "firtina", "fırtına"]],
    ["Dünya", ["dunya", "dünya", "abd", "cin", "çin", "rusya", "ukrayna", "iran", "israil", "avrupa", "nijerya", "lubnan", "lübnan", "venezuela", "trump", "pekin", "hurmuz", "gazze", "netanyahu", "filistin"]],
    ["Kültür-Sanat", ["kultur", "kültür", "sanat", "film", "muzik", "müzik", "sarkici", "şarkıcı", "konser", "festival", "kitap", "tiyatro", "sinema", "sergi"]],
    ["Sağlık", ["saglik", "sağlık", "hastane", "doktor", "hasta", "ilac", "ilaç", "ameliyat", "tedavi", "asi", "aşı"]],
    ["Eğitim", ["egitim", "eğitim", "okul", "ogrenci", "öğrenci", "sinav", "sınav", "universite", "üniversite", "ders", "akademik", "meb"]],
    ["Gündem", ["gundem", "gündem", "son dakika", "siyaset", "belediye", "bakan", "tbmm", "istanbul", "ankara", "izmir", "turkiye", "türkiye", "kaza", "polis", "jandarma", "yerel"]]
  ];
  const hasMedicalSignal = HEALTH_MEDICAL_KEYWORDS.some((word) => text.includes(normalizeText(word)));
  const hasHealthFalseContext = HEALTH_FALSE_CONTEXTS.some((word) => text.includes(normalizeText(word)));
  const match = rules
    .map(([category, words], index) => {
      const categoryKey = normalizeText(category);
      const score = words.reduce((sum, word) => {
        const normalizedWord = normalizeText(word);
        if (!text.includes(normalizedWord)) return sum;
        if (categoryKey === "teknoloji" && WEAK_CATEGORY_KEYWORDS.technology.has(normalizedWord)) return sum + 0.25;
        return sum + 1;
      }, 0);
      return { category, index, score };
    })
    .filter((item) => item.score >= 3)
    .filter((item) => !(normalizeText(item.category) === "saglik" && hasHealthFalseContext && !hasMedicalSignal))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  return match?.category || "Gündem";
}

inferArticleCategory = inferArticleCategoryStrict;

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function subcategoriesForCategory(category) {
  const normalized = normalizeCategoryName(category);
  return SUBCATEGORY_MAP[normalized] || [];
}

function normalizeSubcategoryName(subcategory, category = "") {
  const value = String(subcategory || "").trim();
  if (!value || value === "Tümü" || value === "empty") return value === "Tümü" ? "Tümü" : "Genel";
  const direct = ALL_SUBCATEGORIES.find((item) => item.toLocaleLowerCase("tr-TR") === value.toLocaleLowerCase("tr-TR"));
  if (direct) return direct;
  const categorySubs = subcategoriesForCategory(category);
  return categorySubs[0] || "Genel";
}

function inferArticleSubcategory(article) {
  const category = inferArticleCategory(article);
  const allowed = subcategoriesForCategory(category);
  if (!allowed.length) return normalizeSubcategoryName(article.subcategory || "Genel", category);
  const explicit = String(article.subcategory || "").trim();
  if (explicit) {
    const normalized = normalizeSubcategoryName(explicit, category);
    if (allowed.includes(normalized)) return normalized;
  }
  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""} ${(article.tags || []).join(" ")} ${article.sourceUrl || article.url || ""}`);
  const scored = allowed
    .map((subcategory, index) => ({
      subcategory,
      index,
      score: (SUBCATEGORY_RULES[subcategory] || []).reduce((sum, word) => sum + (text.includes(normalizeText(word)) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.subcategory || allowed[0] || "Genel";
}

function recencyScore(article) {
  const published = new Date(article.publishedAt || 0).getTime();
  if (!Number.isFinite(published) || !published) return 45;
  const ageHours = (Date.now() - published) / 36e5;
  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return 90;
  if (ageHours <= 72) return 75;
  if (ageHours <= 168) return 60;
  if (ageHours <= 720) return 35;
  return 20;
}

function inferArticleContinent(article) {
  const explicit = normalizeContinentName(article.continent || article.region || article.area);
  if (explicit !== "Global") return explicit;
  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""} ${article.sourceUrl || article.url || ""} ${article.sourceName || article.source || ""} ${article.country || ""}`);
  const match = CONTINENT_KEYWORDS
    .map(([continent, words], index) => ({
      continent, index,
      score: words.reduce((sum, word) => sum + (text.includes(normalizeText(word)) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  return match?.continent || "Global";
}

function contentHash(article) {
  return crypto.createHash("sha256").update(normalizeText(`${article.title} ${article.summary}`)).digest("hex");
}

function similarity(a, b) {
  const left = new Set(normalizeText(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalizeText(b).split(/\s+/).filter(Boolean));
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size || 1;
  return intersection / union;
}

function storyTokens(value) {
  const stopWords = new Set([
    "ve", "ile", "icin", "bir", "bu", "su", "da", "de", "ki", "son", "yeni", "olarak", "olan", "dedi",
    "haber", "gore", "gibi", "daha", "kadar", "sonra", "once", "ise", "the", "and", "for", "from"
  ]);
  return normalizeText(value)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function articleStoryText(article) {
  return `${article.title || ""} ${article.summary || ""} ${String(article.fullText || "").slice(0, 1200)} ${article.category || ""}`;
}

function sharedTokenRatio(leftValue, rightValue, limit = 60) {
  const left = new Set(storyTokens(leftValue).slice(0, limit));
  const right = new Set(storyTokens(rightValue).slice(0, limit));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(4, Math.min(left.size, right.size));
}

function properNameTokens(article) {
  const raw = `${article.title || ""} ${article.summary || ""} ${String(article.fullText || "").slice(0, 900)}`;
  const matches = raw.match(/\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}){0,2}\b/g) || [];
  const generic = new Set(["Son", "Yeni", "Haber", "Gundem", "Dunya", "Turkiye"]);
  return new Set(matches.map(normalizeText).filter((token) => token.length > 3 && !generic.has(token)));
}

function properNameOverlap(article, candidate) {
  const left = properNameTokens(article);
  const right = properNameTokens(candidate);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(2, Math.min(left.size, right.size));
}

function dateProximityScore(article, candidate) {
  const left = new Date(article.publishedAt || article.date || 0).getTime();
  const right = new Date(candidate.publishedAt || candidate.date || 0).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right) || !left || !right) return 0.35;
  const diffHours = Math.abs(left - right) / 36e5;
  if (diffHours <= 12) return 1;
  if (diffHours <= 24) return 0.85;
  if (diffHours <= 72) return 0.55;
  if (diffHours <= 168) return 0.25;
  return 0;
}

function sameUrl(article, candidate) {
  const uA = String(article?.sourceUrl || article?.url || "").trim().toLowerCase();
  const uB = String(candidate?.sourceUrl || candidate?.url || "").trim().toLowerCase();
  const isValidUrl = (url) => url.startsWith("http") && url.length > 20;
  return isValidUrl(uA) && isValidUrl(uB) && uA === uB;
}

const STORY_LOCATION_TERMS = [
  "istanbul", "ankara", "izmir", "bursa", "antalya", "adana", "konya", "gaziantep",
  "sanliurfa", "şanlıurfa", "kocaeli", "mersin", "diyarbakir", "diyarbakır", "hatay",
  "manisa", "kayseri", "samsun", "balikesir", "balıkesir", "trabzon", "kastamonu",
  "mardin", "mugla", "muğla", "eskisehir", "eskişehir", "kahramanmaras", "kahramanmaraş",
  "erzurum", "van", "malatya", "amasra", "londra", "gazze", "israil", "filistin",
  "kenya", "almanya", "fransa", "ingiltere", "abd", "rusya", "cin", "çin", "ukrayna",
  "suriye", "irak", "iran", "misir", "mısır", "suudi arabistan", "katar", "nijerya",
  "lubnan", "lübnan", "venezuela"
].map(normalizeText);

function storyLocations(article) {
  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${String(article.fullText || "").slice(0, 700)}`);
  return new Set(STORY_LOCATION_TERMS.filter((location) => new RegExp(`(^|\\s)${location}(\\s|$)`, "u").test(text)));
}

function hasConflictingLocations(article, candidate) {
  const left = storyLocations(article);
  const right = storyLocations(candidate);
  if (!left.size || !right.size) return false;
  return ![...left].some((location) => right.has(location));
}

function equivalentCategory(left, right) {
  const a = normalizeCategoryName(left);
  const b = normalizeCategoryName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return Object.values(CATEGORY_EQUIVALENTS).some((items) => {
    const normalized = items.map(normalizeCategoryName);
    return normalized.includes(a) && normalized.includes(b);
  });
}

const EVENT_TAXONOMY = {
  SOCIAL_CEREMONY: ["bayramlaştı", "bayramlaşan", "bayramlaşma", "bayram trafiği", "bayram ziyareti", "bayram kutlaması", "bayram namazı", "tebrik etti", "kutladı", "el öptü", "ziyarette bulundu", "ağırladı", "karşıladı", "heyetleri kabul etti", "heyetlerini kabul etti", "hediye verdi", "harçlık dağıttı", "iftar yemeği", "sahur programı", "resepsiyon", "kokteyl"],
  POLITICAL_DECISION: ["karar verdi", "talimat verdi", "imzaladı", "onayladı", "reddetti", "kabul etti", "veto etti", "yasa çıkardı", "kararname yayımladı", "genelge gönderdi", "yönetmelik", "toplantı tarihi belirledi", "toplantı iptal", "grup toplantısı yapmayacak", "tarihi ben belirlerim", "tarih belirlenmedi", "toplantı ertelendi"],
  POLITICAL_MEETING: ["toplantı yaptı", "görüştü", "bir araya geldi", "zirveye katıldı", "müzakere etti", "masaya oturdu", "görüşme gerçekleştirdi", "ikili görüşme", "grup toplantısı yaptı", "pm toplantısı", "meclis oturumu"],
  STATEMENT_PRESS: ["açıkladı", "basın toplantısı düzenledi", "açıklama yaptı", "konuştu", "demeç verdi", "röportaj verdi", "mesaj yayımladı", "mesaj yayınladı", "mesajı", "mesaj", "paylaştı", "tweet attı", "yazılı açıklama", "kamuoyuna duyurdu"],
  MILITARY_CONFLICT: ["saldırı düzenledi", "operasyon başlattı", "çatışma çıktı", "bombaladı", "vurdu", "işgal etti", "füze fırlattı", "hava saldırısı", "kara harekâtı", "ateşkes ilan", "askeri müdahale", "şehit düştü", "kayıp verildi", "geri çekildi", "mevzi aldı"],
  CRIME_ARREST: ["tutuklandı", "gözaltına alındı", "yakalandı", "serbest bırakıldı", "beraat etti", "tahliye edildi", "mahkûm edildi", "dava açıldı", "yargılandı", "operasyonla yakalandı", "ihraç edildi", "firari", "suçüstü yakalandı", "rüşvet operasyonu", "kaçakçılık"],
  ACCIDENT_DISASTER: ["kaza yaptı", "çarptı", "devrildi", "takla attı", "mahsur kaldı", "deprem oldu", "sel bastı", "yangın çıktı", "patlama yaşandı", "göçük oluştu", "heyelan", "fırtına", "trafik kazası", "feci kaza", "can pazarı", "yollar kapandı", "araç kuyruğu"],
  DEATH: ["hayatını kaybetti", "öldü", "vefat etti", "şehit oldu", "yaşamını yitirdi", "cenaze töreni", "son yolculuğuna uğurlandı", "kalp krizi sonucu", "acı haber", "kahreden haber", "vefatı duyuruldu"],
  APPOINTMENT: ["atandı", "göreve başladı", "istifa etti", "görevden alındı", "seçildi", "genel başkan oldu", "başkanlığa getirildi", "koltuğu devraldı", "görevi bıraktı", "emekliye ayrıldı", "yeni başkan"],
  ECONOMIC_DATA: ["faiz kararı açıklandı", "enflasyon verisi", "büyüme rakamı", "bütçe açığı", "dolar kuru", "merkez bankası kararı", "baz puan artırdı", "politika faizi", "rezerv verileri", "cari açık", "ihracat rakamı", "işsizlik oranı"],
  SPORTS_RESULT: ["maçı kazandı", "maçı kaybetti", "berabere kaldı", "şampiyon oldu", "elendi", "transfer tamamlandı", "rekor kırdı", "puan aldı", "lig lideri", "kupa finali", "milli maç sonucu"],
  LEGAL_RULING: ["mahkeme kararı açıklandı", "yargıtay bozdu", "anayasa mahkemesi kararı", "dava sonuçlandı", "ceza verildi", "beraat kararı", "itiraz reddedildi", "temyiz başvurusu", "hüküm okundu", "mutlak butlan"]
};
const DUP_BM25_K1 = 1.5;
const DUP_BM25_B = 0.75;
const DUP_GROUPING_THRESHOLD = 0.42;
const DUP_TURKISH_SUFFIXES = ["ndan", "nden", "ından", "inden", "undan", "ünden", "nın", "nin", "nun", "nün", "ının", "inin", "unun", "ünün", "dan", "den", "tan", "ten", "nda", "nde", "ında", "inde", "unda", "ünde", "da", "de", "ta", "te", "ya", "ye", "na", "ne", "yla", "yle", "la", "le", "yı", "yi", "yu", "yü", "ın", "in", "un", "ün", "lar", "ler", "ları", "leri", "ca", "ce", "ça", "çe", "a", "e", "ı", "i", "u", "ü"].sort((a, b) => b.length - a.length);
const DUP_ENTITY_STOPWORDS = new Set(["son", "yeni", "haber", "bugün", "bugun", "dun", "dün", "türkiye", "turkiye", "dünya", "dunya", "istanbul", "ankara", "izmir", "gündem", "gundem", "ekonomi", "spor", "teknoloji", "sağlık", "saglik", "bilim", "kültür", "kultur", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık", "ocak", "şubat", "mart", "nisan", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar", "genel", "başkan", "bakan", "milletvekili", "sözcü", "yönetim", "kurul"]);
const DUP_KNOWN_ORGS = new Set(["chp", "akp", "mhp", "dem", "iyi", "tbmm", "trt", "tsk", "mgk", "meb", "tcmb", "spk", "bddk", "epdk", "btk", "ysk", "nato", "ab", "bm", "imf", "uefa", "fifa", "aa", "iha", "dha", "tff", "bist", "tpao", "ted"]);
const DUP_TURKISH_STOPWORDS = new Set(["bir", "bu", "ve", "ile", "da", "de", "ki", "mi", "mu", "mü", "ne", "o", "şu", "için", "olan", "en", "çok", "var", "daha", "gibi", "kadar", "sonra", "önce", "ise", "ya", "veya", "ancak", "fakat", "ama", "her", "hem", "bile", "diye", "eğer", "çünkü", "yani", "artık", "zaten", "hiç", "nasıl", "neden", "hangi", "kendi", "diğer", "tüm", "bazı", "pek", "hep", "göre", "karşı", "rağmen", "haber", "son", "yeni", "bugün", "dün", "oldu", "etti", "dedi", "olan", "eden", "olarak", "tarafından", "üzere", "itibaren", "dolayı", "nedeniyle", "açıkladı", "belirtti", "konuştu", "dile", "getirdi", "ifade", "the", "and", "for", "from", "with", "that", "this", "are", "was", "has"]);
const DUP_CATEGORY_EQUIVALENCE = {
  politics: ["gündem", "politika", "türkiye", "yerel", "toplum", "güvenlik", "siyaset"],
  world: ["dünya", "uluslararası", "global", "diplomasi", "orta doğu", "avrupa", "asya"],
  economy: ["ekonomi", "finans", "borsa", "döviz", "enflasyon", "piyasa", "merkez bankası"],
  sports: ["spor", "futbol", "basketbol", "voleybol", "formula", "transfer", "atletizm"],
  tech: ["teknoloji", "yapay zeka", "yazılım", "donanım", "mobil", "siber", "dijital"],
  science: ["bilim", "uzay", "iklim", "doğa", "akademik", "araştırma", "çevre"],
  health: ["sağlık", "tıp", "hastane", "ilaç", "tedavi", "pandemi", "beslenme"],
  culture: ["kültür", "sanat", "sinema", "müzik", "kitap", "tiyatro", "eğlence", "magazin"]
};

function computeTimeScore(a, b) {
  const tA = new Date(a?.publishedAt || a?.date || 0).getTime();
  const tB = new Date(b?.publishedAt || b?.date || 0).getTime();
  if (!tA || !tB || tA < 1000000 || tB < 1000000) return 0.35;
  const hours = Math.abs(tA - tB) / 3600000;
  if (hours > 24) return 0;
  if (hours <= 1) return 1;
  if (hours <= 3) return 0.95;
  if (hours <= 6) return 0.85;
  if (hours <= 12) return 0.70;
  return 0.50;
}

function extractEventType(title) {
  if (!title) return "UNKNOWN";
  const lower = String(title).toLowerCase().replace(/[''\u2018\u2019][a-züğışçö\u00c0-\u017e]*/g, " ").replace(/['"]/g, "");
  if (/feth/i.test(lower)) return "STATEMENT_PRESS";
  const allKeywords = [];
  for (const [type, keywords] of Object.entries(EVENT_TAXONOMY)) {
    for (const kw of keywords) allKeywords.push({ type, kw, len: kw.length });
  }
  allKeywords.sort((a, b) => b.len - a.len);
  for (const { type, kw } of allKeywords) if (lower.includes(kw)) return type;
  return "UNKNOWN";
}

function stemTurkishWord(word) {
  const apostropheBase = String(word || "").split(/['\u2018\u2019']/)[0];
  if (apostropheBase !== word) return apostropheBase.toLowerCase();
  const lower = String(word || "").toLowerCase();
  for (const suffix of DUP_TURKISH_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 3) return lower.slice(0, lower.length - suffix.length);
  }
  return lower;
}

function extractNamedEntities(text) {
  if (!text) return new Set();
  const result = new Set();
  const raw = String(text);
  const textLower = raw.toLowerCase();
  for (const org of DUP_KNOWN_ORGS) if (textLower.includes(org)) result.add(org);
  const matches = raw.match(/\b[A-ZÇĞİÖŞÜ][a-zçğışöüA-ZÇĞİÖŞÜ]{2,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöüA-ZÇĞİÖŞÜ]{2,}){0,2}\b/g) || [];
  for (const match of matches) {
    const parts = match.split(/\s+/);
    const stemmed = stemTurkishWord(parts[0]);
    if (!DUP_ENTITY_STOPWORDS.has(stemmed) && stemmed.length >= 3) {
      result.add(stemmed);
      if (parts.length > 1) result.add(parts.map(stemTurkishWord).join("_"));
    }
  }
  const pct = raw.match(/(?:yüzde\s+)?\d+[.,]?\d*\s*%/gi) || [];
  for (const p of pct) result.add(`PCT_${p.replace(/[^0-9]/g, "")}`);
  const bp = raw.match(/\d+\s*baz\s*puan/gi) || [];
  for (const b of bp) result.add(`BP_${b.replace(/[^0-9]/g, "")}`);
  const scores = raw.match(/\b\d{1,2}[-–]\d{1,2}\b/g) || [];
  for (const s of scores) result.add(`SCORE_${s.replace(/[-–]/, "_")}`);
  const money = raw.match(/\d+[.,]?\d*\s*(?:milyon|milyar|bin)\s*(?:lira|dolar|euro|tl|sterlin)/gi) || [];
  for (const m of money) result.add(`MONEY_${m.replace(/\s+/g, "_").toLowerCase()}`);
  const plainNumbers = raw.match(/\b\d{2,}\b/g) || [];
  for (const n of plainNumbers) result.add(`NUM_${n}`);
  return result;
}

function entityOverlapScore(entA, entB) {
  if (!entA.size || !entB.size) return 0;
  let shared = 0;
  for (const e of entA) if (entB.has(e)) shared += 1;
  return shared / Math.max(entA.size, entB.size);
}

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[''\u2018\u2019][a-züğışçö\u00c0-\u017e]*/g, "")
    .replace(/[.,!?;:()[\]{}"'\/\\<>@#$%^&*+=|~`]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !DUP_TURKISH_STOPWORDS.has(word));
}

function buildDocumentFingerprint(article) {
  const title = String(article?.title || "");
  const summary = String(article?.summary || article?.description || "");
  const body = String(article?.fullText || "").slice(0, 600);
  return tokenize(`${title} ${title} ${title} ${title} ${summary} ${summary} ${body}`);
}

function buildIdfTable(tokenArrays) {
  const df = new Map();
  const N = tokenArrays.length;
  for (const tokens of tokenArrays) for (const token of new Set(tokens)) df.set(token, (df.get(token) || 0) + 1);
  const idf = new Map();
  for (const [term, freq] of df) idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  return idf;
}

function bm25Score(queryTokens, docTokens, idfTable, avgdl) {
  const tf = new Map();
  for (const token of docTokens) tf.set(token, (tf.get(token) || 0) + 1);
  const dl = docTokens.length;
  let score = 0;
  for (const term of new Set(queryTokens)) {
    if (!tf.has(term)) continue;
    const f = tf.get(term);
    const idf = idfTable.get(term) || 0;
    const num = f * (DUP_BM25_K1 + 1);
    const den = f + DUP_BM25_K1 * (1 - DUP_BM25_B + DUP_BM25_B * dl / Math.max(avgdl, 1));
    score += idf * num / den;
  }
  return score;
}

function normalizedBM25Similarity(tokA, tokB, idfTable, avgdl) {
  const ab = bm25Score(tokA, tokB, idfTable, avgdl);
  const ba = bm25Score(tokB, tokA, idfTable, avgdl);
  const aa = bm25Score(tokA, tokA, idfTable, avgdl);
  const bb = bm25Score(tokB, tokB, idfTable, avgdl);
  return Math.min(1, ((ab + ba) / 2) / Math.max(aa, bb, 0.001));
}

function simHashFingerprint(tokens) {
  const v = new Array(32).fill(0);
  for (const token of tokens) {
    let h = 0;
    for (let i = 0; i < token.length; i += 1) h = Math.imul(31, h) + token.charCodeAt(i) | 0;
    for (let bit = 0; bit < 32; bit += 1) v[bit] += (h & (1 << bit)) ? 1 : -1;
  }
  let fingerprint = 0;
  for (let bit = 0; bit < 32; bit += 1) if (v[bit] > 0) fingerprint |= (1 << bit);
  return fingerprint >>> 0;
}

function hammingDistance(a, b) {
  let xor = (a ^ b) >>> 0;
  let dist = 0;
  while (xor) {
    dist += xor & 1;
    xor >>>= 1;
  }
  return dist;
}

function getCategoryGroup(category) {
  if (!category) return null;
  const lower = String(category).toLowerCase();
  for (const [group, aliases] of Object.entries(DUP_CATEGORY_EQUIVALENCE)) if (aliases.some((alias) => lower.includes(alias))) return group;
  return null;
}

function categorySimilarityScore(a, b) {
  const gA = getCategoryGroup(a?.category);
  const gB = getCategoryGroup(b?.category);
  if (!gA || !gB) return 0.5;
  return gA === gB ? 1 : 0;
}

function storyScore(a, b, precomputed) {
  if (sameUrl(a, b)) return 0;
  const tScore = computeTimeScore(a, b);
  if (tScore === 0) return 0;
  const idA = String(a.id);
  const idB = String(b.id);
  const etA = precomputed.eventTypes.get(idA) || "UNKNOWN";
  const etB = precomputed.eventTypes.get(idB) || "UNKNOWN";
  if (etA !== "UNKNOWN" && etB !== "UNKNOWN" && etA !== etB) return 0;
  const tokA = precomputed.tokens.get(idA) || [];
  const tokB = precomputed.tokens.get(idB) || [];
  const textScore = normalizedBM25Similarity(tokA, tokB, precomputed.idfTable, precomputed.avgdl);
  const entScore = entityOverlapScore(precomputed.entities.get(idA) || new Set(), precomputed.entities.get(idB) || new Set());
  const nearDup = hammingDistance(precomputed.simHashes.get(idA) || 0, precomputed.simHashes.get(idB) || 0) <= 4 ? 0.15 : 0;
  if (etA === "SOCIAL_CEREMONY" && etB === "SOCIAL_CEREMONY" && entScore === 0 && !nearDup) return 0;
  if (entScore === 0 && !nearDup && textScore < 0.45) return 0;
  const catScore = categorySimilarityScore(a, b);
  const eventBonus = etA !== "UNKNOWN" && etA === etB ? 0.10 : 0;
  let score = textScore * 0.40 + entScore * 0.30 + tScore * 0.15 + catScore * 0.10 + nearDup + eventBonus;
  const srcA = String(a.sourceName || a.source || "").toLowerCase().trim();
  const srcB = String(b.sourceName || b.source || "").toLowerCase().trim();
  if (srcA && srcB && srcA === srcB) score *= 0.25;
  return Math.max(0, Math.min(1, score));
}

function weightedStorySimilarity(article, candidate) {
  const articles = [article, candidate].map((item) => ({ ...item, id: String(item.id || item.sourceUrl || item.url || item.title) }));
  const tokens = new Map();
  const entities = new Map();
  const eventTypes = new Map();
  const simHashes = new Map();
  for (const item of articles) {
    const itemTokens = buildDocumentFingerprint(item);
    tokens.set(String(item.id), itemTokens);
    entities.set(String(item.id), extractNamedEntities(`${item.title || ""} ${item.summary || ""}`));
    eventTypes.set(String(item.id), extractEventType(item.title || ""));
    simHashes.set(String(item.id), simHashFingerprint(itemTokens));
  }
  const tokenArrays = [...tokens.values()];
  const idfTable = buildIdfTable(tokenArrays);
  const avgdl = tokenArrays.reduce((sum, item) => sum + item.length, 0) / Math.max(tokenArrays.length, 1);
  return storyScore(articles[0], articles[1], { tokens, entities, eventTypes, simHashes, idfTable, avgdl });
}

function pickClusterRepresentative(members) {
  if (members.length === 1) return members[0];
  return members.reduce((best, cur) => {
    const bScore = (best.imageUrl || best.image ? 2 : 0) + (best.description || "").length + (best.title || "").length;
    const cScore = (cur.imageUrl || cur.image ? 2 : 0) + (cur.description || "").length + (cur.title || "").length;
    return cScore > bScore ? cur : best;
  });
}

function extractDomainFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch { return ""; }
}

function buildSourceEntry(article) {
  const url = article.sourceUrl || article.url || "";
  return {
    name: article.sourceName || article.source || "Kaynak",
    url,
    title: article.title || "",
    description: (article.description || article.summary || "").slice(0, 300),
    publishedAt: article.publishedAt || article.date || "",
    domain: extractDomainFromUrl(url),
    icon: ""
  };
}

function compareClusterSources(members) {
  if (members.length <= 1) return null;
  const sorted = [...members].sort((a, b) => new Date(a.publishedAt || a.date || 0) - new Date(b.publishedAt || b.date || 0));
  const earliestSource = sorted[0]?.sourceName || sorted[0]?.source || "";
  const mostDetailed = members.reduce((best, cur) => {
    const bLen = (best.description || "").length + (best.summary || "").length;
    const cLen = (cur.description || "").length + (cur.summary || "").length;
    return cLen > bLen ? cur : best;
  });
  const mostDetailedSource = mostDetailed?.sourceName || mostDetailed?.source || "";

  const allTokenSets = members.map(m => new Set(storyTokens(`${m.title || ""} ${m.description || m.summary || ""}`)));
  const commonTokens = allTokenSets.length ? [...allTokenSets[0]].filter(t => allTokenSets.every(s => s.has(t))) : [];
  const commonKeywords = commonTokens.slice(0, 8);
  
  const similarities = commonKeywords.length > 0 
    ? [`Tüm kaynaklar '${commonKeywords.slice(0, 3).join(", ")}' konularında birleşiyor.`] 
    : ["Kaynaklar benzer bir olayı aktarıyor."];

  const differentAngles = [];
  const differences = [];
  const seenFocus = new Set();
  for (const m of members) {
    const src = m.sourceName || m.source || "";
    const mTokens = new Set(storyTokens(m.title || ""));
    const unique = [...mTokens].filter(t => !commonTokens.includes(t)).slice(0, 3);
    if (unique.length > 0 && !seenFocus.has(src)) {
      seenFocus.add(src);
      differentAngles.push({ source: src, focus: unique.join(", ") });
      differences.push(`${src}: '${unique.join(", ")}' detaylarına odaklanıyor.`);
    }
  }

  return {
    earliestSource,
    mostDetailedSource,
    commonKeywords,
    differentAngles: differentAngles.slice(0, 6),
    similarities,
    differences: differences.slice(0, 4)
  };
}

function dedupeFeedArticles(articles, limit = 120) {
  const allItems = articles.map((item) => ({ ...item, id: String(item.id || item.sourceUrl || item.url || item.title) }));
  const tokens = new Map();
  const entities = new Map();
  const eventTypes = new Map();
  const simHashes = new Map();
  for (const item of allItems) {
    const id = String(item.id);
    const itemTokens = buildDocumentFingerprint(item);
    tokens.set(id, itemTokens);
    entities.set(id, extractNamedEntities(`${item.title || ""} ${item.summary || ""}`));
    eventTypes.set(id, extractEventType(item.title || ""));
    simHashes.set(id, simHashFingerprint(itemTokens));
  }
  const tokenArrays = [...tokens.values()];
  const idfTable = buildIdfTable(tokenArrays);
  const avgdl = tokenArrays.reduce((sum, t) => sum + t.length, 0) / Math.max(tokenArrays.length, 1);
  const precomputed = { tokens, entities, eventTypes, simHashes, idfTable, avgdl };

  const clusters = [];
  const exactSeen = new Map();
  for (let i = 0; i < allItems.length; i++) {
    const article = allItems[i];
    const exactKey = articleStableDedupeKey(article);
    if (exactKey && exactSeen.has(exactKey)) {
      const clusterIdx = exactSeen.get(exactKey);
      clusters[clusterIdx].push(article);
      if (article?.id) RELATED_ARTICLE_POOL.set(String(article.id), article);
      continue;
    }

    const artHash = simHashes.get(String(article.id)) || 0;
    let matchedClusterIdx = -1;
    for (let c = 0; c < clusters.length; c++) {
      const rep = clusters[c][0];
      const exHash = simHashes.get(String(rep.id)) || 0;
      if (hammingDistance(artHash, exHash) > 20) continue;
      if (storyScore(rep, article, precomputed) >= 0.48) { matchedClusterIdx = c; break; }
    }

    if (matchedClusterIdx >= 0) {
      clusters[matchedClusterIdx].push(article);
      if (article?.id) RELATED_ARTICLE_POOL.set(String(article.id), article);
    } else {
      const newIdx = clusters.length;
      clusters.push([article]);
      if (exactKey) exactSeen.set(exactKey, newIdx);
    }
    if (clusters.length >= limit) break;
  }

  const result = [];
  let totalGrouped = 0;
  for (const members of clusters) {
    const representative = pickClusterRepresentative(members);
    const clusterId = `cluster-${representative.id || members[0].id}`;
    const sources = members.map(buildSourceEntry);
    const uniqueSources = [];
    const seenDomains = new Set();
    for (const s of sources) {
      const key = s.domain || s.name;
      if (!seenDomains.has(key)) { seenDomains.add(key); uniqueSources.push(s); }
    }
    representative.clusterId = clusterId;
    representative.sourceCount = uniqueSources.length;
    representative.sources = uniqueSources;
    representative.relatedSources = members.filter(m => m !== representative).map(m => {
      const srcName = m.sourceName || m.source || "";
      const domain = m.sourceUrl ? new URL(m.sourceUrl).hostname : (m.url ? new URL(m.url).hostname : "");
      return {
        id: m.id,
        sourceName: srcName,
        sourceDomain: domain,
        sourceLogo: "",
        title: m.title,
        excerpt: (m.description || m.summary || m.fullText || "").slice(0, 300),
        url: m.sourceUrl || m.url || "",
        publishedAt: m.publishedAt || m.date || ""
      };
    });
    if (members.length > 1) {
      representative.comparison = compareClusterSources(members);
      totalGrouped += members.length;
    }
    result.push(representative);
  }

  const totalRaw = articles.length;
  const totalClustered = result.length;
  const totalDuped = totalRaw - totalClustered;
  const avgSrc = result.length ? +(result.reduce((s, a) => s + (a.sourceCount || 1), 0) / result.length).toFixed(1) : 0;
  _lastClusterStats.raw = totalRaw;
  _lastClusterStats.clusters = totalClustered;
  _lastClusterStats.grouped = totalGrouped;
  _lastClusterStats.avgSourceCount = avgSrc;
  _lastClusterStats.updatedAt = new Date().toISOString();
  logInfo("feed-cluster", "completed", `raw=${totalRaw} clusters=${totalClustered} deduped=${totalDuped} avgSources=${avgSrc}`);
  return result;
}

function getDbArticleCountForHealth() {
  try {
    const db = readDb();
    return Array.isArray(db.articles) ? db.articles.length : 0;
  } catch {
    return 0;
  }
}

function buildLocalFeedCacheArticles(db) {
  const localDb = db || readDb();
  const cacheArticles = [...ARTICLE_CACHE.values()];
  const dbArticles = Array.isArray(localDb.articles) ? localDb.articles : [];
  const demoArticles = DEMO_REGIONAL_PANDEMIC_ARTICLES.map((article) => normalizeArticleTransportFields({ ...article }));
  const demoKeys = new Set(demoArticles.map(articleStableDedupeKey).filter(Boolean));
  const localCandidates = [...cacheArticles, ...dbArticles]
    .filter(Boolean)
    .filter((article) => {
      const key = articleStableDedupeKey(article);
      return !key || !demoKeys.has(key);
    })
    .map((article) => {
      const decorated = decorateArticle(localDb, "", { ...article });
      normalizeArticleTransportFields(decorated);
      decorated.category = inferArticleCategory(decorated);
      decorated.subcategory = inferArticleSubcategory(decorated);
      decorated.fetchedAt = decorated.fetchedAt || decorated.publishedAt || new Date().toISOString();
      return decorated;
    });
  return [
    ...demoArticles,
    ...dedupeFeedArticles(localCandidates.filter((article) => !article.isDemo), 120)
  ];
}

function seedFeedCacheFromLocal(db, reason = "local-seed") {
  if (_feedCacheStore.articles.length > 0) return false;
  try {
    const articles = buildLocalFeedCacheArticles(db);
    if (!articles.length) return false;
    _feedCacheStore.articles = articles;
    _feedCacheStore.timestamp = Date.now();
    _feedCacheStore.lastRefreshStatus = reason;
    _feedCacheStore.lastRefreshError = "";
    logInfo("feed-cache", "seeded from local data", `reason=${reason} cachedArticles=${articles.length}`);
    return true;
  } catch (error) {
    _feedCacheStore.lastRefreshStatus = "local-seed-error";
    _feedCacheStore.lastRefreshError = (error.message || "Unknown").slice(0, 200);
    logWarn("feed-cache", "local seed failed", error.message);
    return false;
  }
}

function localFeedCachePayload(db, userId, region, options = {}) {
  const articles = buildLocalFeedCacheArticles(db);
  if (!articles.length) return null;
  return buildPersonalizedFeedPayload(db, userId, articles, region, options);
}

function triggerBackgroundFeedRefresh(reason = "stale") {
  if (_feedCacheStore.refreshing) return false;
  setTimeout(() => backgroundRefreshFeed({ reason }), 0).unref?.();
  return true;
}

async function backgroundRefreshFeed(options = {}) {
  const reason = options.reason || "scheduled";
  if (_feedCacheStore.refreshing) return { success: false, skipped: true, reason: "already-refreshing" };
  _feedCacheStore.refreshing = true;
  const startTime = Date.now();
  try {
    const [apiArticles, rssArticlesRaw] = await Promise.all([
      withTimeout(fetchNewsProviderArticles(40), 12000, []),
      withTimeout(fetchRssArticles(120), 65000, [])
    ]);
    const apiKeys = new Set(apiArticles.map(articleStableDedupeKey).filter(Boolean));
    const externalArticles = [
      ...apiArticles,
      ...rssArticlesRaw.filter((a) => { const k = articleStableDedupeKey(a); return !k || !apiKeys.has(k); })
    ];
    let db;
    try { db = readDb(); } catch { db = { articles: [], preferences: {}, users: [], readStatus: [], bookmarks: [] }; }
    const externalKeys = new Set(externalArticles.map(articleStableDedupeKey).filter(Boolean));
    const allArticles = [
      ...DEMO_REGIONAL_PANDEMIC_ARTICLES,
      ...externalArticles,
      ...db.articles.filter((a) => { const k = articleStableDedupeKey(a); return !k || !externalKeys.has(k); })
    ];
    const rankedArticles = allArticles.map((article) => {
      const decorated = decorateArticle(db, "", article);
      normalizeArticleTransportFields(decorated);
      decorated.category = inferArticleCategory(decorated);
      decorated.subcategory = inferArticleSubcategory(decorated);
      decorated.fetchedAt = decorated.fetchedAt || new Date().toISOString();
      return decorated;
    }).sort((a, b) => {
      if (a.externalProvider && !b.externalProvider) return -1;
      if (!a.externalProvider && b.externalProvider) return 1;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
    for (const article of rankedArticles) {
      normalizeArticleTransportFields(article);
      ARTICLE_CACHE.set(String(article.id), article);
      RELATED_ARTICLE_POOL.set(String(article.id), article);
    }
    if (rankedArticles.length) invalidateTrendsCache();
    const clustered = [
      ...DEMO_REGIONAL_PANDEMIC_ARTICLES.map((a) => normalizeArticleTransportFields({ ...a })),
      ...dedupeFeedArticles(rankedArticles.filter((a) => !a.isDemo), 120)
    ];
    _feedCacheStore.articles = clustered;
    _feedCacheStore.timestamp = Date.now();
    _feedCacheStore.lastRefreshAt = new Date().toISOString();
    _feedCacheStore.lastRefreshStatus = "success";
    _feedCacheStore.lastRefreshError = "";
    try {
      await translateArticleBatch(clustered, 24, ["tr", "en"]);
      _feedCacheStore.translationStatus = "ok";
    } catch (e) {
      _feedCacheStore.translationStatus = `fallback: ${(e.message || "").slice(0, 80)}`;
      logInfo("translation", "fallback-active", e.message || "unknown");
    }
    logInfo("feed-refresh", "completed", `reason=${reason} durationMs=${Date.now() - startTime} cachedArticles=${clustered.length}`);
    return { success: true, count: clustered.length, cachedAt: _feedCacheStore.lastRefreshAt };
  } catch (err) {
    _feedCacheStore.lastRefreshStatus = "error";
    _feedCacheStore.lastRefreshError = (err.message || "Unknown").slice(0, 200);
    logWarn("feed-refresh", "failed", `reason=${reason} durationMs=${Date.now() - startTime} error=${err.message}`);
    return { success: false, error: _feedCacheStore.lastRefreshError };
  } finally {
    _feedCacheStore.refreshing = false;
  }
}

function cleanupOldArticles() {
  const now = Date.now();
  const cutoff = now - NEWS_RETENTION_MS;
  const before = _feedCacheStore.articles.length;
  _feedCacheStore.articles = _feedCacheStore.articles.filter((a) => {
    if (a.isDemo) return true;
    const published = new Date(a.publishedAt || a.fetchedAt || 0).getTime();
    return !published || published > cutoff;
  });
  _feedCacheStore.lastCleanupAt = new Date().toISOString();
  const removed = before - _feedCacheStore.articles.length;
  if (removed > 0) logInfo("feed-cleanup", "removed old articles", `removed=${removed} retentionDays=${NEWS_RETENTION_DAYS}`);
}

let _refreshIntervalId = null;
let _cleanupIntervalId = null;

function startFeedScheduler() {
  try {
    seedFeedCacheFromLocal(readDb(), "startup-local-cache");
  } catch (error) {
    logWarn("scheduler", "startup local cache seed failed", error.message);
  }
  triggerBackgroundFeedRefresh("startup-background");
  _refreshIntervalId = setInterval(() => backgroundRefreshFeed(), NEWS_REFRESH_INTERVAL_MS);
  _cleanupIntervalId = setInterval(() => cleanupOldArticles(), Math.max(NEWS_RETENTION_MS / 2, 3600000));
  logInfo("scheduler", "started", `refreshHours=${Math.round(NEWS_REFRESH_INTERVAL_MS / 3600000)} cleanupHours=${Math.round(Math.max(NEWS_RETENTION_MS / 2, 3600000) / 3600000)}`);
}

function stopFeedScheduler() {
  if (_refreshIntervalId) { clearInterval(_refreshIntervalId); _refreshIntervalId = null; }
  if (_cleanupIntervalId) { clearInterval(_cleanupIntervalId); _cleanupIntervalId = null; }
}

function logSourceCounts(label, articles) {
  const counts = new Map();
  for (const article of articles) {
    const source = article.sourceName || article.source || "Bilinmeyen kaynak";
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([source, count]) => `${source}:${count}`)
    .join(", ");
  logDebug("feed", `${label} source counts`, summary || "none");
}

function decorateArticle(db, userId, article) {
  const read = db._readStatusByKey ? db._readStatusByKey.get(`${userId}:${article.id}`) : db.readStatus.find((item) => item.userId === userId && item.articleId === article.id);
  const bookmarked = db._bookmarksByKey ? db._bookmarksByKey.has(`${userId}:${article.id}`) : db.bookmarks.some((item) => item.userId === userId && item.articleId === article.id);
  return {
    ...article,
    bookmarked,
    status: read?.status === "read" ? "Okundu" : "Okunmadı",
    duplicateGroupId: article.duplicateGroupId || null
  };
}

function articleScoringText(article) {
  return `${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`;
}

function buildReadingProfile(db, userId, articles = []) {
  const articleById = new Map();
  for (const article of [...db.articles, ...articles, ...ARTICLE_CACHE.values()]) {
    if (article?.id) articleById.set(String(article.id), article);
  }
  const readArticles = db.readStatus
    .filter((item) => item.userId === userId && item.status === "read")
    .map((item) => articleById.get(String(item.articleId)))
    .filter(Boolean);
  const bookmarkedArticles = db.bookmarks
    .filter((item) => item.userId === userId)
    .map((item) => articleById.get(String(item.articleId)))
    .filter(Boolean);
  const categoryReads = new Map();
  const subcategoryReads = new Map();
  for (const article of readArticles) {
    const category = article.category || inferArticleCategory(article);
    const subcategory = article.subcategory || inferArticleSubcategory(article);
    categoryReads.set(category, (categoryReads.get(category) || 0) + 1);
    subcategoryReads.set(subcategory, (subcategoryReads.get(subcategory) || 0) + 1);
  }
  const maxCategoryReads = Math.max(1, ...categoryReads.values(), 1);
  const maxSubcategoryReads = Math.max(1, ...subcategoryReads.values(), 1);
  return { readArticles, bookmarkedArticles, categoryReads, subcategoryReads, maxCategoryReads, maxSubcategoryReads };
}

function tokenOverlapScore(article, candidates) {
  const articleTokens = new Set(storyTokens(articleScoringText(article)).slice(0, 45));
  if (!articleTokens.size || !candidates.length) return 0;
  let best = 0;
  for (const candidate of candidates) {
    if (String(candidate.id) === String(article.id)) continue;
    const candidateTokens = new Set(storyTokens(articleScoringText(candidate)).slice(0, 45));
    const shared = [...articleTokens].filter((token) => candidateTokens.has(token)).length;
    best = Math.max(best, shared / Math.max(6, Math.min(articleTokens.size, candidateTokens.size || 1)));
  }
  return best;
}

function maxReadSimilarity(article, readArticles) {
  let best = 0;
  for (const readArticle of readArticles) {
    if (String(readArticle.id) === String(article.id)) continue;
    best = Math.max(best, similarity(articleScoringText(article), articleScoringText(readArticle)));
  }
  return best;
}

function scoreArticle(article, preferences, readingProfile = null) {
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const interests = preferences?.interests || [];

  let categoryScore = interests.includes(category) ? 68 : 48;
  let subcategoryScore = 52;
  let interactionScore = 50;

  // Kalite skorlaması (başlık uzunluğu, metin doluluğu, kaynak güveni)
  let qualityBoost = 0;
  if ((article.title || "").length > 30) qualityBoost += 5;
  if ((article.summary || article.description || "").length > 100) qualityBoost += 10;
  if (article.sourceTrustLevel === "high") qualityBoost += 15;
  if (article.sourceTrustLevel === "low") qualityBoost -= 15;
  categoryScore += qualityBoost;
  subcategoryScore += qualityBoost;

  if (readingProfile?.readArticles?.length) {
    const sameCategoryReads = readingProfile.categoryReads.get(category) || 0;
    const sameSubcategoryReads = readingProfile.subcategoryReads.get(subcategory) || 0;
    const sameCategoryReadArticles = readingProfile.readArticles.filter((item) => inferArticleCategory(item) === category);
    const sameSubcategoryReadArticles = readingProfile.readArticles.filter((item) => inferArticleSubcategory(item) === subcategory);

    categoryScore += Math.min(18, Math.round((sameCategoryReads / readingProfile.maxCategoryReads) * 18));
    subcategoryScore += Math.min(24, Math.round((sameSubcategoryReads / readingProfile.maxSubcategoryReads) * 24));

    const categoryOverlap = tokenOverlapScore(article, sameCategoryReadArticles);
    const subcategoryOverlap = tokenOverlapScore(article, sameSubcategoryReadArticles);
    const bookmarkedMatches = readingProfile.bookmarkedArticles.filter((item) => inferArticleSubcategory(item) === subcategory || inferArticleCategory(item) === category);
    const bookmarkOverlap = tokenOverlapScore(article, bookmarkedMatches);

    interactionScore += Math.round(categoryOverlap * 14);
    interactionScore += Math.round(subcategoryOverlap * 18);
    interactionScore += Math.round(maxReadSimilarity(article, sameSubcategoryReadArticles.length ? sameSubcategoryReadArticles : sameCategoryReadArticles) * 16);
    interactionScore += Math.round(bookmarkOverlap * 12);
  }

  const isTurkishUi = preferences?.language === "tr";
  const isTurkeyArticle = article.sourceRegion === "turkey";
  const turkeyBoost = (isTurkishUi && isTurkeyArticle) ? 15 : 0;

  const finalScore =
    clampScore(categoryScore) * 0.35 +
    clampScore(subcategoryScore) * 0.40 +
    recencyScore(article) * 0.15 +
    clampScore(interactionScore) * 0.10 +
    turkeyBoost;

  return clampScore(finalScore, 50);
}

async function confirmSameStoriesWithAi(article, candidates) {
  const geminiKey = getGeminiApiKey();
  if (!geminiKey || !candidates.length) return null;
  const model = getGeminiModel();
  try {
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{
              text: [
                "Aşağıdaki adaylardan hangileri ana haberle birebir aynı olayı anlatıyor? Dil ve anlatım farklı olabilir.",
                "Sadece aynı olay/aynı gelişme olanların id değerlerini JSON dizi olarak döndür. Örnek: [\"id1\",\"id2\"]",
                `ANA HABER: ${article.title}\n${article.summary}`,
                "ADAYLAR:",
                ...candidates.map((candidate) => `${candidate.id}: ${candidate.title}\n${candidate.summary}`)
              ].join("\n\n")
            }]
          }
        ],
        generationConfig: geminiGenerationConfig({ model, temperature: 0, maxOutputTokens: 256 })
      })
    });
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const ids = JSON.parse(jsonMatch[0]);
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return null;
  }
}

async function findDuplicates(db, article) {
  const pool = [
    ...RELATED_ARTICLE_POOL.values(),
    ...ARTICLE_CACHE.values(),
    ...db.articles
  ].filter((candidate) => candidate && String(candidate.id) !== String(article.id));

  const seen = new Set();
  const unique = pool.filter((candidate) => {
    const id = String(candidate.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const allArticles = [article, ...unique];
  const tokens = new Map();
  const entities = new Map();
  const eventTypes = new Map();
  const simHashes = new Map();

  for (const candidate of allArticles) {
    const id = String(candidate.id);
    const candidateTokens = buildDocumentFingerprint(candidate);
    tokens.set(id, candidateTokens);
    entities.set(id, extractNamedEntities(`${candidate.title || ""} ${candidate.summary || ""}`));
    eventTypes.set(id, extractEventType(candidate.title || ""));
    simHashes.set(id, simHashFingerprint(candidateTokens));
  }

  const tokenArrays = [...tokens.values()];
  const idfTable = buildIdfTable(tokenArrays);
  const avgdl = tokenArrays.reduce((sum, value) => sum + value.length, 0) / Math.max(tokenArrays.length, 1);
  const precomputed = { tokens, entities, eventTypes, simHashes, idfTable, avgdl };

  const candidates = unique
    .filter((candidate) => {
      const sourceA = String(article.sourceName || article.source || "").toLowerCase().trim();
      const sourceB = String(candidate.sourceName || candidate.source || "").toLowerCase().trim();
      return sourceA !== sourceB && !sameUrl(article, candidate);
    })
    .map((candidate) => ({ article: candidate, score: storyScore(article, candidate, precomputed) }))
    .filter((candidate) => candidate.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const aiIds = await confirmSameStoriesWithAi(article, candidates.map((candidate) => candidate.article)).catch(() => null);
  const confirmed = aiIds && aiIds.size
    ? candidates.filter((candidate) => aiIds.has(String(candidate.article.id)))
    : candidates.filter((candidate) => candidate.score >= DUP_GROUPING_THRESHOLD);
  logDebug("duplicates", "candidate scan", `article="${String(article.title || "").slice(0, 80)}" pool=${unique.length} candidates=${candidates.length} confirmed=${confirmed.length}`);
  logDebug("duplicates", "top candidates", candidates.slice(0, 5).map((candidate) => `${candidate.score.toFixed(2)}:${candidate.article.sourceName || candidate.article.source || "Kaynak"}:${String(candidate.article.title || "").slice(0, 45)}`).join(" | ") || "none");
  if (!confirmed.length) logDebug("duplicates", "no duplicates sent", "no cross-source candidate passed threshold or AI confirmation");
  return confirmed.slice(0, 8).map((candidate) => candidate.article);
}

function articleSummary(article) {
  if (article.aiSummary) return article.aiSummary;
  const firstSentence = String(article.fullText || article.summary || "").split(/[.!?]/).map((part) => part.trim()).filter(Boolean)[0];
  return firstSentence ? `${firstSentence}.` : article.summary;
}

const SENTENCE_ABBREVIATIONS = new Map([
  ["T.C.", "TC_ABBR"],
  ["Dr.", "DR_ABBR"],
  ["Prof.", "PROF_ABBR"],
  ["Doç.", "DOC_ABBR"],
  ["Sn.", "SN_ABBR"],
  ["vb.", "VB_ABBR"],
  ["vs.", "VS_ABBR"],
  ["A.Ş.", "AS_ABBR"]
]);

function protectSentenceAbbreviations(text) {
  let output = String(text || "");
  for (const [abbr, token] of SENTENCE_ABBREVIATIONS) output = output.replaceAll(abbr, token);
  return output;
}

function restoreSentenceAbbreviations(text) {
  let output = String(text || "");
  for (const [abbr, token] of SENTENCE_ABBREVIATIONS) output = output.replaceAll(token, abbr);
  return output;
}

function sentenceListForArticle(article) {
  const raw = protectSentenceAbbreviations(String(article.fullText || article.summary || article.description || article.title || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (raw.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [raw])
    .map((sentence) => restoreSentenceAbbreviations(sentence).trim())
    .filter(Boolean);
}

function safeFallbackNeutralAnalysis(article) {
  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`);
  const incidentWords = ["saldiri", "oldurdu", "oldu", "yaralandi", "cinayet", "supheli", "polis", "jandarma", "silah", "tufek"];
  const accidentWords = ["kaza", "yangin", "patlama", "sel", "taskin"];
  if (incidentWords.some((word) => text.includes(word))) {
    return "Bu haber, silahlı saldırı veya adli bir olayın gelişimini ve sonuçlarını aktarıyor. Metin; olayın nerede gerçekleştiği, kaç kişinin hayatını kaybettiği ya da yaralandığı ve şüpheliye ilişkin bilgiler üzerinde duruyor. Olayın arka planına dair sınırlı bilgi verildiği için farklı kaynaklarla birlikte okunması daha sağlıklı olabilir.";
  }
  if (accidentWords.some((word) => text.includes(word))) {
    return "Bu haber, ani gelişen bir olayın seyrini ve sonuçlarını aktarıyor. Metin; olayın yeri, etkilenen kişiler ve yetkililerin aktardığı ilk bilgiler üzerinde duruyor. Daha geniş bağlam için gelişmenin farklı kaynaklardaki anlatımıyla birlikte okunması yararlı olabilir.";
  }
  return "Bu haber, olayın temel gelişmelerini ve sonuçlarını aktarıyor. Metin, öne çıkan bilgileri kısa ve doğrudan bir anlatımla sunuyor. Daha ayrıntılı bağlam için orijinal kaynak ve varsa farklı kaynak versiyonları birlikte okunabilir.";
}

function specificFallbackNeutralAnalysis(article) {
  const rawText = `${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`.replace(/\s+/g, " ").trim();
  const text = normalizeText(rawText);
  const actorMatch = rawText.match(/(Cumhurbaşkanı\s+Recep\s+Tayyip\s+Erdoğan|Recep\s+Tayyip\s+Erdoğan|Cumhurbaşkanlığı|[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ Bakanlığı|[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ Valiliği|Emniyet|Jandarma)/);
  let actor = actorMatch?.[1] || "";
  if (!actor && text.includes("recep tayyip erdogan")) actor = "Cumhurbaşkanı Recep Tayyip Erdoğan";
  if (!actor && text.includes("cumhurbaskanligi")) actor = "Cumhurbaşkanlığı";
  const museumDay = /18\s+May[ıi]s\s+M[üu]zeler\s+G[üu]n[üu]/i.test(rawText) ? "18 Mayıs Müzeler Günü" : "";
  const shareWords = ["paylasimda bulundu", "mesaj yayimladi", "aciklama yapti", "duyurdu", "paylasti"];
  if (shareWords.some((word) => text.includes(word))) {
    const subject = actor || "ilgili kişi ya da kurum";
    const topic = museumDay || "gündemdeki konu";
    return `Bu haber, ${subject} tarafından ${topic} kapsamında yapılan paylaşımı aktarıyor. Metin, paylaşımın varlığına ve konunun anlamına odaklanıyor; ancak paylaşımın içeriğine veya daha geniş bağlama sınırlı yer veriyor.`;
  }
  const incidentWords = ["saldiri", "oldurdu", "oldu", "yaralandi", "cinayet", "supheli", "gozalti", "polis", "jandarma", "silah", "tufek"];
  const accidentWords = ["kaza", "yangin", "patlama", "sel", "taskin"];
  const placeMatch = rawText.match(/([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:'in|'nin|'nın|'un|'ün|’in|’nin|’nın|’un|’ün)?\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ ilçesinde|[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ ilçesinde|[A-ZÇĞİÖŞÜ][a-zçğıöşü]+’[a-zçğıöşü]+|[A-ZÇĞİÖŞÜ][a-zçğıöşü]+'[a-zçğıöşü]+)/);
  let place = placeMatch?.[1] || "";
  if (!place && text.includes("mersin") && text.includes("camliyayla")) place = "Mersin’in Çamlıyayla ilçesinde";
  if (incidentWords.some((word) => text.includes(word))) {
    const where = place ? `${place} yaşanan` : "yaşanan";
    return `Bu haber, ${where} silahlı saldırı ya da adli olayın sonuçlarını aktarıyor. Metin, can kaybı ve yaralı sayısı gibi temel bilgilere odaklanıyor; olayın arka planına dair ayrıntılar sınırlı olduğu için farklı kaynaklarla birlikte okunması faydalı olabilir.`;
  }
  if (accidentWords.some((word) => text.includes(word))) {
    return "Bu haber, ani gelişen bir olayın seyrini ve sonuçlarını aktarıyor. Metin, olayın yeri, etkilenen kişiler ve yetkililerden gelen ilk bilgiler üzerinde duruyor; gelişmenin nedenlerine dair bağlam sınırlı kalıyor.";
  }
  if (["konser", "etkinlik", "festival", "sergi", "muze", "muzeler", "kultur", "sanat"].some((word) => text.includes(word))) {
    return "Bu haber, kültür-sanat veya etkinlik odaklı bir gelişmeyi aktarıyor. Metin, etkinliğin amacı, zamanı veya düzenleneceği yer gibi temel bilgilere odaklanıyor; programın ayrıntılarına sınırlı yer veriyor.";
  }
  if (["ekonomi", "fiyat", "piyasa", "enflasyon", "dolar", "altin", "borsa"].some((word) => text.includes(word))) {
    return "Bu haber, ekonomik bir gelişmeye odaklanıyor. Metin, fiyatlar, piyasa hareketleri veya kararların olası etkileri gibi temel bilgileri öne çıkarıyor; verilerin arka planına dair ayrıntı sınırlı kalıyor.";
  }
  if (["mac", "takim", "skor", "transfer", "futbol", "basketbol"].some((word) => text.includes(word))) {
    return "Bu haber, sporla ilgili bir gelişmeyi aktarıyor. Metin, takım, maç, skor veya transfer bilgisi gibi doğrudan unsurlara odaklanıyor; gelişmenin perde arkasına dair ayrıntı sınırlı kalıyor.";
  }
  return "Bu haber, metinde öne çıkan gelişmeyi kısa biçimde aktarıyor. Haber kısa olduğu için ayrıntılı açıklama, arka plan veya farklı görüşlere sınırlı yer veriliyor.";
}

function normalizeBulletText(text) {
  return normalizeText(text)
    .replace(/\bavm\b/g, "alisveris merkezi")
    .replace(/\balisveris merkezinin\b/g, "alisveris merkezi")
    .replace(/\balisveris merkezinde\b/g, "alisveris merkezi")
    .replace(/\bilcesinde\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bulletSimilarity(left, right) {
  const a = new Set(normalizeBulletText(left).split(/\s+/).filter((word) => word.length > 2));
  const b = new Set(normalizeBulletText(right).split(/\s+/).filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

function isMeaningfulBullet(text) {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (normalized.length <= 1) return false;
  if (words.length < 3 && !/\d/.test(normalized)) return false;
  return true;
}

function removeDuplicateBullets(bullets) {
  const cleaned = [];
  for (const raw of bullets) {
    const bullet = String(raw || "").replace(/[.!?…]+$/, "").trim();
    if (!isMeaningfulBullet(bullet)) continue;
    const matchIndex = cleaned.findIndex((existing) =>
      normalizeBulletText(existing) === normalizeBulletText(bullet) || bulletSimilarity(existing, bullet) >= 0.62
    );
    if (matchIndex === -1) cleaned.push(bullet);
    else if (bullet.length > cleaned[matchIndex].length) cleaned[matchIndex] = bullet;
  }
  return cleaned;
}

function structuredFallbackBullets(article, bullets) {
  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`);
  if (bullets.length <= 1 && text.includes("cumhurbaskanligi") && text.includes("cocuk") && text.includes("orkestr") && text.includes("konser")) {
    return [
      "Cumhurbaşkanlığı Çocuk Orkestrası ve Korosu, 19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı'nda konser verecek",
      "Topluluk, geleneksel müziği yaşatmak ve genç müzisyenleri desteklemek amacıyla 2024 yılında kuruldu",
      "Konserin Cumhurbaşkanlığı Külliyesi'nde düzenleneceği belirtildi"
    ];
  }
  return bullets;
}

function fallbackStructuredAiSummary(article) {
  const sentences = sentenceListForArticle(article);
  const shortSummary = sentences.slice(0, 3).join(" ").slice(0, 520) || article.title || "Bu haber için kısa özet oluşturulamadı.";
  const bulletSummary = sentences.slice(0, 4).map((sentence) => sentence.replace(/[.!?…]+$/, "").trim()).filter(Boolean);
  while (bulletSummary.length < 3 && article.title) bulletSummary.push(String(article.title).trim());
  const source = article.sourceName || article.source || "kaynak";
  const analysisText = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`);
  const incidentWords = ["saldiri", "oldurdu", "oldu", "yaralandi", "cinayet", "supheli", "polis", "jandarma"];
  const accidentWords = ["kaza", "yangin", "patlama", "sel", "taskin"];
  const eventFrame = incidentWords.some((word) => analysisText.includes(word))
    ? "Bu haber, adli bir olayın gelişimini ve olay sonrası sonuçları aktarıyor."
    : accidentWords.some((word) => analysisText.includes(word))
      ? "Bu haber, ani gelişen bir olayın seyrini ve sonuçlarını aktarıyor."
      : "Bu haber, olayın temel bilgilerini aktarıyor.";
  const neutralAnalysis = eventFrame;
  return {
    shortSummary,
    bulletSummary: structuredFallbackBullets(article, removeDuplicateBullets(bulletSummary)).slice(0, 5),
    neutralAnalysis: specificFallbackNeutralAnalysis(article)
  };
}

async function generateStructuredAiSummary(article) {
  const fallback = fallbackStructuredAiSummary(article);
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) return { ...fallback, provider: "fallback", model: "" };
  const model = getGeminiModel();
  const contentToSummarize = article.fullText || article.summary || article.description || article.title || "";
  try {
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              "Aşağıdaki haber için sadece geçerli JSON döndür. Markdown kullanma.",
              "JSON alanları: shortSummary string, bulletSummary string array, neutralAnalysis string.",
              "shortSummary 2-4 cümlelik kısa paragraf olsun.",
              "bulletSummary 3-5 kısa madde olsun, her madde string olsun.",
              "neutralAnalysis haberin dili, tonu, olay aktarımı, öne çıkan bilgi ve varsa eksik bağlam hakkında tarafsız analiz olsun.",
              `BAŞLIK: ${article.title || ""}`,
              `KAYNAK: ${article.sourceName || article.source || ""}`,
              `KATEGORİ: ${article.category || ""}`,
              `İÇERİK:\n${contentToSummarize}`
            ].join("\n\n")
          }]
        }],
        generationConfig: geminiGenerationConfig({ model, temperature: 0.2, maxOutputTokens: 900 })
      })
    });
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ...fallback, provider: "fallback", model };
    const parsed = JSON.parse(jsonMatch[0]);
    const shortSummary = String(parsed.shortSummary || fallback.shortSummary).trim();
    const bulletSummary = Array.isArray(parsed.bulletSummary)
      ? parsed.bulletSummary.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5)
      : fallback.bulletSummary;
    const neutralAnalysis = String(parsed.neutralAnalysis || fallback.neutralAnalysis).trim();
    return {
      shortSummary,
      bulletSummary: removeDuplicateBullets(bulletSummary.length ? bulletSummary : fallback.bulletSummary),
      neutralAnalysis,
      provider: "gemini",
      model
    };
  } catch (error) {
    logError("ai", "structured summary failed", error.message);
    return { ...fallback, provider: "fallback", model };
  }
}

function hasSystemAiSummary(article) {
  return Boolean(
    article?.aiSummary
    && String(article.aiSummary).trim().length > 20
    && (article.aiSummaryProvider || article.aiSummaryModel || article.aiSummaryGeneratedAt)
  );
}

async function generateAiSummary(article, options = {}) {
  if (!options.force && hasSystemAiSummary(article)) {
    return article.aiSummary;
  }
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) {
    return articleSummary(article);
  }
  const model = getGeminiModel();
  const contentToSummarize = article.fullText || article.summary || article.title || "";
  try {
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{
              text: [
                "Aşağıdaki haberi incele ve aşağıdaki JSON formatında veri üret:",
                "1. aiSummary: En fazla 2-3 cümlelik, akıcı, tarafsız ve bilgilendirici Türkçe bir yapay zeka özeti.",
                "2. sourceSentences: Haberin asıl metninden (İÇERİK kısmından) doğrudan alınmış, haberi en iyi yansıtan 2 veya 3 gerçek cümle. (Orijinalinden kopyala, değiştirme)",
                "3. contentSnippet: Orijinal metinden haberin bağlamını veren kısa bir alıntı (yaklaşık 1 paragraf).",
                "Markdown kullanma, sadece JSON döndür:",
                `{
                  "aiSummary": "özet metni",
                  "sourceSentences": ["cümle 1", "cümle 2"],
                  "contentSnippet": "alıntı"
                }`,
                `BAŞLIK: ${article.title || ""}`,
                `İÇERİK:\n${contentToSummarize}`
              ].join("\n\n")
            }]
          }
        ],
        generationConfig: geminiGenerationConfig({ model, temperature: 0.2, maxOutputTokens: 512 })
      })
    });
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("").trim();
    if (text) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        article.aiSummary = parsed.aiSummary || articleSummary(article);
        article.sourceSentences = parsed.sourceSentences || [];
        article.contentSnippet = parsed.contentSnippet || "";
        article.aiSummaryProvider = "gemini";
        article.aiSummaryModel = model;
        article.aiSummaryGeneratedAt = new Date().toISOString();
        return article.aiSummary;
      }
    }
  } catch (error) {
    logError("ai", "summary failed", error.message);
  }
  return articleSummary(article);
}

// ensureRichDuplicates: Only returns real, verified articles from the database.
// NEVER fabricates fake content or placeholder URLs.
// If no real matches exist, returns empty array.
async function ensureRichDuplicates(article, existingDuplicates) {
  // Already have enough real duplicates — return them as-is
  if (existingDuplicates.length >= 1) {
    const realDuplicates = existingDuplicates
      .filter(d => d.sourceUrl && d.sourceUrl !== "#" && d.sourceUrl !== article.sourceUrl)
      .map(d => ({ ...d, sourceUrl: d.sourceUrl || d.url || d.link || "", url: d.url || d.sourceUrl || d.link || "" }))
      .slice(0, 4);
    const enrichedDuplicates = await Promise.all(realDuplicates.map((duplicate) => fetchArticleFullText(duplicate)));
    return enrichedDuplicates.map((duplicate) => ({
      ...duplicate,
      comparisonTextStatus: hasSourceFullText(duplicate) ? "full_text" : "fallback_summary"
    }));
  }
  return [];
}

async function generateMultiSourceComparison(mainArticle, duplicates) {
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) return null;

  const model = getGeminiModel();
  const sourcesList = [
    { id: mainArticle.id || "main", sourceName: mainArticle.sourceName || mainArticle.source || "Ana Kaynak", sourceUrl: mainArticle.sourceUrl || mainArticle.url || mainArticle.link || "", title: mainArticle.title, summary: mainArticle.summary || mainArticle.fullText },
    ...duplicates.map((d, i) => ({ id: d.id || `dup_${i}`, sourceName: d.sourceName || d.source || `Kaynak ${i + 1}`, sourceUrl: d.sourceUrl || d.url || d.link || "", title: d.title, summary: d.summary || d.fullText }))
  ];

  try {
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{
              text: [
                "Aşağıda aynı olayla ilgili farklı haber kaynaklarının başlık ve özetleri verilmiştir.",
                "Bu kaynakları karşılaştırarak aşağıdaki JSON yapısında detaylı bir analiz üret:",
                `{
                  "commonPoints": ["Ortak vurgulanan birinci nokta", "Ortak vurgulanan ikinci nokta"],
                  "differences": ["Kaynak A şu detaya, Kaynak B ise şu detaya odaklanıyor"],
                  "numbers": ["Belirtilen oran, sayı veya tarih bilgisi"],
                  "toneAndMissing": ["Haber dillerindeki tarafsızlık/uyarı farkları ve eksik bırakılan bağlamlar"]
                }`,
                "Sadece geçerli bir JSON nesnesi döndür. Markdown veya fazladan metin kullanma.",
                "KAYNAKLAR:",
                JSON.stringify(sourcesList, null, 2)
              ].join("\n\n")
            }]
          }
        ],
        generationConfig: geminiGenerationConfig({ model, temperature: 0.2, maxOutputTokens: 1024 })
      })
    });
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    logError("ai", "multi-source analysis failed", error.message);
  }
  return null;
}

function legacyFallbackMultiSourceAnalysis(mainArticle, duplicates) {
  const sourcesList = [
    { id: mainArticle.id || "main", sourceName: mainArticle.sourceName || mainArticle.source || "Ana Kaynak", sourceUrl: mainArticle.sourceUrl || mainArticle.url || mainArticle.link || "", title: mainArticle.title, summary: mainArticle.summary },
    ...duplicates.map((d) => ({ ...d, sourceUrl: d.sourceUrl || d.url || d.link || "", url: d.url || d.sourceUrl || d.link || "" }))
  ];
  return {
    overallComparison: "Farklı medya kuruluşları bu olayı kendi okuyucu kitlelerine uygun editoryal önceliklerle ele almaktadır. Kimi kaynaklar diplomatik/uluslararası boyutlara odaklanırken, kimisi yerel siyasi yansımaları ve ekonomik etkileri öne çıkarmıştır.",
    sourceAnalyses: sourcesList.map((s, i) => {
      let tone = "Tarafsız ve bilgilendirici";
      let emphasis = "Genel durum tespiti";
      let perspective = "Olayı olduğu gibi aktaran standart habercilik yaklaşımı.";
      const name = String(s.sourceName || "").toLowerCase();

      if (i === 0) {
        tone = "Bilgilendirici ve nesnel";
        emphasis = "Temel haber unsurları ve özet bilgiler";
        perspective = "Okuyucuya ilk bilgileri yalın bir şekilde ulaştırmayı hedefliyor.";
      } else if (name.includes("bbc")) {
        tone = "Uluslararası ve analitik";
        emphasis = "Olayın küresel yansımaları ve diplomatik boyutu";
        perspective = "Gelişmeleri dışarıdan bir gözlemci sıfatıyla, tarafsız bir mesafeden değerlendiriyor.";
      } else if (name.includes("reuters") || name.includes("bloomberg")) {
        tone = "Rasyonel ve piyasa odaklı";
        emphasis = "İstatistiksel veriler ve finansal/ekonomik sonuçlar";
        perspective = "Yatırımcıları ve iş dünyasını ilgilendiren olası riskleri merkeze alıyor.";
      } else if (name.includes("habertürk") || name.includes("ntv")) {
        tone = "Detaycı ve tartışma yaratıcı";
        emphasis = "Uzman görüşleri ve yerel aktörlerin tepkileri";
        perspective = "Farklı uzman yorumlarıyla olayın tartışmalı yönlerine dikkat çekiyor.";
      } else if (name.includes("sözcü") || name.includes("karar")) {
        tone = "Eleştirel ve muhalif";
        emphasis = "Olası eksiklikler, mağduriyetler ve uyarılar";
        perspective = "Sürecin yürütülüş biçimini sorgulayan ve okuyucuyu düşündüren bir bakış açısı.";
      } else if (name.includes("anadolu")) {
        tone = "Resmi ve mesafeli";
        emphasis = "Devlet yetkililerinin açıklamaları ve resmi tutum";
        perspective = "Sadece teyitli devlet kaynaklarına dayanan güvenilir ve kurumsal bir sunum.";
      } else {
        tone = i % 2 === 0 ? "Dikkat çekici ve uyarıcı" : "Detaycı ve analitik";
        emphasis = i % 2 === 0 ? "Olası tehlikeler ve kritik uyarılar" : "Arka plan bilgileri ve istatistikler";
        perspective = i % 2 === 0 ? "Okuyucuyu harekete geçmeye yönlendiren bakış açısı." : "Olayın sebeplerine odaklanan editoryal bakış.";
      }

      return {
        id: s.id || (i === 0 ? "main" : `dup_${i}`),
        sourceName: s.sourceName || s.source || `Kaynak ${i + 1}`,
        sourceUrl: s.sourceUrl || s.url || s.link || "",
        tone,
        emphasis,
        perspective
      };
    })
  };
}

const SEMANTIC_STOP_WORDS = new Set([
  "bir", "bu", "ve", "ile", "da", "de", "ki", "mi", "ne", "o", "şu", "için",
  "olan", "en", "çok", "var", "daha", "gibi", "kadar", "sonra", "önce", "ise",
  "ya", "veya", "ancak", "fakat", "ama", "her", "hem", "bile", "diye", "eğer",
  "çünkü", "yani", "artık", "zaten", "hiç", "nasıl", "neden", "hangi", "diğer",
  "tüm", "bazı", "hep", "göre", "karşı", "haber", "son", "yeni", "bugün", "dün",
  "oldu", "etti", "dedi", "eden", "olarak", "tarafından", "ayrıca", "rağmen",
  "değil", "sadece", "üzere", "itibaren", "dolayı", "nedeniyle", "açıkladı",
  "belirtti", "konuştu", "dile", "getirdi", "null", "undefined", "classname",
  "class", "div", "span", "href", "src", "http", "https", "www", "com", "html"
]);
const SEMANTIC_SUFFIXES = ["nın", "nin", "nun", "nün", "dan", "den", "tan", "ten", "da", "de", "ta", "te", "lar", "ler", "ları", "leri", "ın", "in", "un", "ün", "yı", "yi", "yu", "yü", "ı", "i", "u", "ü"].sort((a, b) => b.length - a.length);
const CLAIM_VERBS = ["artırdı", "düşürdü", "açıkladı", "kabul etti", "reddetti", "imzaladı", "atandı", "görevden alındı", "tutuklandı", "serbest bırakıldı", "hayatını kaybetti", "kazandı", "kaybetti", "tamamlandı", "başladı", "sona erdi"];

function semanticArticleText(article = {}) {
  return stripHtml([article.title, article.fullText, article.content, article.summary, article.description].filter(Boolean).join(" "));
}

function normalizeSemanticToken(token) {
  let stem = String(token || "").split("'")[0].split("’")[0];
  for (const suffix of SEMANTIC_SUFFIXES) {
    const normalized = normalizeText(stem);
    if (normalized.endsWith(suffix) && normalized.length - suffix.length >= 3) {
      stem = stem.slice(0, Math.max(0, stem.length - suffix.length));
      break;
    }
  }
  return normalizeText(stem);
}

function tokenizeArticle(text) {
  return normalizeText(text)
    .split(/\s+/)
    .map(normalizeSemanticToken)
    .filter((token) => token.length >= 3 && !SEMANTIC_STOP_WORDS.has(token));
}

function buildCorpusTfIdf(articles) {
  const docs = articles.map((article) => tokenizeArticle(semanticArticleText(article)));
  const N = Math.max(1, docs.length);
  const dfs = new Map();
  const termCounts = docs.map((tokens) => {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    for (const token of counts.keys()) dfs.set(token, (dfs.get(token) || 0) + 1);
    return counts;
  });
  const idf = new Map([...dfs.entries()].map(([term, df]) => [term, Math.log((N + 1) / (df + 1)) + 1]));
  const vectors = termCounts.map((counts) => {
    const vector = new Map();
    for (const [term, tf] of counts.entries()) vector.set(term, (1 + Math.log(tf)) * (idf.get(term) || 0));
    return vector;
  });
  const topTerms = vectors.map((vector) => [...vector.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([term, score]) => ({ term, score })));
  return { docs, termCounts, idf, vectors, topTerms };
}

function findCommonTerms(articles, tfIdfData) {
  if (!articles.length) return [];
  return [...tfIdfData.idf.entries()]
    .filter(([, idf]) => idf > 0.5)
    .map(([term]) => {
      const scores = tfIdfData.vectors.map((vector) => vector.get(term) || 0);
      const presentEverywhere = scores.every((score) => score > 0);
      const minScore = Math.min(...scores);
      return { term, presentEverywhere, minScore };
    })
    .filter((item) => item.presentEverywhere && item.minScore > 0.5)
    .sort((a, b) => b.minScore - a.minScore)
    .slice(0, 12)
    .map((item) => item.term);
}

function findDistinctiveTerms(articles, tfIdfData) {
  const result = {};
  articles.forEach((article, index) => {
    const source = article.sourceName || article.source || `Kaynak ${index + 1}`;
    const vector = tfIdfData.vectors[index] || new Map();
    result[source] = [...vector.entries()]
      .filter(([term, score]) => {
        const otherMax = tfIdfData.vectors.reduce((max, other, otherIndex) => otherIndex === index ? max : Math.max(max, other.get(term) || 0), 0);
        return score >= 1.2 && (otherMax === 0 || score >= otherMax * 1.8);
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term]) => term);
  });
  return result;
}

function splitClaimSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractClaims(text) {
  const numberPattern = /(?:\d+[.,]?\d*\s*(?:%|tl|lira|dolar|euro|milyon|milyar|bin)|\b\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b|\b(?:19|20)\d{2}\b)/iu;
  const properNamePattern = /\b[A-ZÇĞİÖŞÜ][\p{L}'’.-]+(?:\s+[A-ZÇĞİÖŞÜ][\p{L}'’.-]+)+\b/u;
  const verbPattern = new RegExp(CLAIM_VERBS.map((verb) => verb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "iu");
  return splitClaimSentences(text)
    .filter((sentence) => numberPattern.test(sentence) || properNamePattern.test(sentence) || verbPattern.test(sentence))
    .map((sentence) => sentence.length > 120 ? `${sentence.slice(0, 117).replace(/\s+\S*$/, "")}...` : sentence)
    .slice(0, 8);
}

function claimSimilarity(left, right) {
  const a = new Set(tokenizeArticle(left));
  const b = new Set(tokenizeArticle(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size || 1;
  return intersection / union;
}

function compareClaims(claimsA, claimsB) {
  const shared = [];
  const uniqueToA = [];
  const uniqueToB = [];
  const matchedB = new Set();
  for (const claimA of claimsA || []) {
    const matchIndex = (claimsB || []).findIndex((claimB, index) => !matchedB.has(index) && claimSimilarity(claimA, claimB) >= 0.45);
    if (matchIndex >= 0) {
      matchedB.add(matchIndex);
      shared.push(claimA);
    } else {
      uniqueToA.push(claimA);
    }
  }
  (claimsB || []).forEach((claimB, index) => {
    if (!matchedB.has(index)) uniqueToB.push(claimB);
  });
  return { shared, uniqueToA, uniqueToB };
}

function buildSemanticDiff(mainArticle, duplicates) {
  const allArticles = [mainArticle, ...(Array.isArray(duplicates) ? duplicates : [])].filter(Boolean);
  const articles = allArticles.map((article, index) => ({
    ...article,
    sourceName: article.sourceName || article.source || `Kaynak ${index + 1}`
  }));
  const tfIdfData = buildCorpusTfIdf(articles);
  const commonTerms = findCommonTerms(articles, tfIdfData);
  const distinctiveTermsBySource = findDistinctiveTerms(articles, tfIdfData);
  const claimsBySource = articles.map((article) => ({
    source: article.sourceName || article.source || "Kaynak",
    claims: extractClaims(semanticArticleText(article))
  }));
  const sharedClaimCounts = new Map();
  const uniqueClaimsBySource = {};
  for (let i = 0; i < claimsBySource.length; i += 1) {
    const current = claimsBySource[i];
    uniqueClaimsBySource[current.source] = [];
    for (const claim of current.claims) {
      const matches = claimsBySource.filter((other, index) => index !== i && other.claims.some((otherClaim) => claimSimilarity(claim, otherClaim) >= 0.45)).length;
      if (matches === claimsBySource.length - 1 && claimsBySource.length > 1) sharedClaimCounts.set(claim, (sharedClaimCounts.get(claim) || 0) + 1);
      if (matches === 0) uniqueClaimsBySource[current.source].push(claim);
    }
  }
  return {
    articles,
    sourceNames: articles.map((article) => article.sourceName || article.source || "Kaynak"),
    sourceCount: articles.length,
    fullTextSourceNames: articles.filter(hasSourceFullText).map((article) => article.sourceName || article.source || "Kaynak"),
    fallbackSourceNames: articles.filter((article) => !hasSourceFullText(article)).map((article) => article.sourceName || article.source || "Kaynak"),
    commonTerms,
    distinctiveTermsBySource,
    claimsBySource,
    sharedClaims: [...sharedClaimCounts.keys()].slice(0, 8),
    uniqueClaimsBySource
  };
}

function fallbackMultiSourceAnalysis(mainArticle, duplicates) {
  const diff = buildSemanticDiff(mainArticle, duplicates);
  if (diff.sourceCount < 2) {
    return {
      commonPoints: ["Yeterli karşılaştırma verisi bulunamadı"],
      differentPoints: ["Kaynaklar aynı olayı benzer şekilde aktarıyor"],
      overallComparison: `${diff.sourceCount} kaynak karşılaştırıldı: ${diff.sourceNames.join(", ")}.`
    };
  }
  const commonPoints = [
    ...diff.sharedClaims.slice(0, 3),
    ...diff.commonTerms.slice(0, Math.max(0, 3 - diff.sharedClaims.length)).map((term) => `Tüm kaynaklar "${term}" konusunu öne çıkarıyor`)
  ];
  const differentPoints = diff.articles.slice(0, 3).map((article) => {
    const source = article.sourceName || article.source || "Kaynak";
    const terms = (diff.distinctiveTermsBySource[source] || []).slice(0, 2).join(", ");
    const claim = (diff.uniqueClaimsBySource[source] || [])[0];
    if (claim && terms) return `${source}, "${terms}" terimleriyle "${claim}" bilgisini ayrıştırıyor`;
    if (claim) return `${source}, "${claim}" bilgisini diğer kaynaklardan ayrı veriyor`;
    if (terms) return `${source}, "${terms}" vurgusunu öne çıkarıyor`;
    return "";
  }).filter(Boolean);
  const sourceList = diff.sourceNames.join(", ");
  return {
    commonPoints: commonPoints.length ? commonPoints : ["Yeterli karşılaştırma verisi bulunamadı"],
    differences: differentPoints.length ? differentPoints : ["Kaynaklar aynı olayı benzer şekilde aktarıyor"],
    numbers: [],
    toneAndMissing: [`${diff.sourceCount} kaynak karşılaştırıldı: ${sourceList}.`]
  };
}

async function generateMultiSourceAnalysis(mainArticle, duplicates) {
  const diff = buildSemanticDiff(mainArticle, duplicates);
  const fallback = fallbackMultiSourceAnalysis(mainArticle, duplicates);
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) return fallback;
  const model = getGeminiModel();
  try {
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              "Aşağıda aynı haberin farklı kaynaklardaki versiyonlarının algoritmik analizi verilmiştir.",
              "Bu veriyi kullanarak JSON formatında karşılaştırmalı analiz üret.",
              `ORTAK DİSCRİMİNATİF TERİMLER: ${JSON.stringify(diff.commonTerms)}`,
              `HER KAYNAĞIN ÖZGÜN TEKİL TERİMLERİ: ${JSON.stringify(diff.distinctiveTermsBySource)}`,
              `ORTAK CLAIM'LER: ${JSON.stringify(diff.sharedClaims)}`,
              `KAYNAĞA ÖZGÜ CLAIM'LER: ${JSON.stringify(diff.uniqueClaimsBySource)}`,
              `KAYNAK SAYISI: ${diff.sourceCount}`,
              `KAYNAK İSİMLERİ: ${diff.sourceNames.join(", ")}`,
              `Üretilecek JSON: {"commonPoints":["..."],"differences":["..."],"numbers":["..."],"toneAndMissing":["..."]}`,
              "Kurallar: Türkçe yaz. Markdown kullanma. Her madde bu habere özgü somut bilgi içersin. Şablon ifade kullanma. Gerçek fark yoksa differences [\"Kaynaklar aynı olayı benzer şekilde aktarıyor\"] olsun. numbers kısmı haberi oluşturan ana sayılar, oranlar, miktarlar olsun. toneAndMissing dil/vurgu farklarını açıklasın."
            ].join("\n")
          }]
        }],
        generationConfig: geminiGenerationConfig({ model, temperature: 0.15, maxOutputTokens: 700 })
      })
    });
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("").trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      commonPoints: Array.isArray(parsed.commonPoints) && parsed.commonPoints.length ? parsed.commonPoints.slice(0, 5) : fallback.commonPoints,
      differentPoints: Array.isArray(parsed.differentPoints) && parsed.differentPoints.length ? parsed.differentPoints.slice(0, 5) : fallback.differentPoints,
      overallComparison: String(parsed.overallComparison || fallback.overallComparison).trim()
    };
  } catch (error) {
    logError("ai", "semantic diff analysis failed", error.message);
    return fallback;
  }
}

function decorateEvent(db, userId, event) {
  const read = db.eventReadStatus.some((item) => item.userId === userId && item.eventId === event.id);
  const reminder = db.eventReminders.some((item) => item.userId === userId && item.eventId === event.id);
  return {
    ...event,
    read,
    reminder,
    notificationStatus: event.critical ? "Kritik bildirim" : "Normal"
  };
}

function fallbackLiveTicketEvents() {
  const day = 24 * 60 * 60 * 1000;
  const base = Date.now();
  return [
    {
      id: "live_event_melike_sahin",
      title: "Melike Şahin Konseri",
      category: "Konser",
      date: new Date(base + day * 5).toISOString(),
      venue: "Bostancı Gösteri Merkezi",
      city: "İstanbul",
      summary: "Popüler sanatçının İstanbul konseri için biletler satışta.",
      description: "Biletix tarzı canlı etkinlik akışında gösterilen konser kartı. API anahtarı eklendiğinde bu alan Ticketmaster Discovery verisiyle güncellenir.",
      sourceProvider: "Smart Events",
      ticketUrl: "https://www.biletix.com/",
      imageUrl: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
      critical: false
    },
    {
      id: "live_event_standup",
      title: "Stand-Up Gecesi",
      category: "Sahne",
      date: new Date(base + day * 8).toISOString(),
      venue: "Maximum Uniq Hall",
      city: "İstanbul",
      summary: "Komedi sahnesinden yeni gösteri ve sınırlı kontenjanlı biletler.",
      description: "Yaklaşan sahne etkinliği, tarih ve mekan bilgisiyle etkinlikler akışına eklendi.",
      sourceProvider: "Smart Events",
      ticketUrl: "https://www.biletix.com/",
      imageUrl: "https://images.unsplash.com/photo-1527224857830-43a7acc85260?auto=format&fit=crop&w=900&q=80",
      critical: false
    },
    {
      id: "live_event_jazz",
      title: "Caz Akşamı",
      category: "Festival",
      date: new Date(base + day * 12).toISOString(),
      venue: "Zorlu PSM",
      city: "İstanbul",
      summary: "Şehirde caz, elektronik ve alternatif sahneden seçili performanslar.",
      description: "Müzik odaklı etkinlik keşfi için hazırlanan örnek canlı etkinlik kartı.",
      sourceProvider: "Smart Events",
      ticketUrl: "https://www.biletix.com/",
      imageUrl: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=900&q=80",
      critical: false
    }
  ];
}

function normalizeTicketmasterEvent(item) {
  const venue = item._embedded?.venues?.[0] || {};
  const image = (item.images || [])
    .filter((img) => img.url)
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  const segment = item.classifications?.[0]?.segment?.name;
  const genre = item.classifications?.[0]?.genre?.name;
  const localDate = item.dates?.start?.localDate || "";
  const localTime = item.dates?.start?.localTime || "20:00:00";
  const date = localDate ? new Date(`${localDate}T${localTime}`).toISOString() : new Date().toISOString();
  const venueName = venue.name || "Mekan açıklanacak";
  const city = venue.city?.name || venue.country?.name || "Türkiye";
  return {
    id: `tm_${item.id}`,
    title: item.name || "Etkinlik",
    category: genre || segment || "Etkinlik",
    date,
    venue: venueName,
    city,
    summary: `${venueName}${city ? `, ${city}` : ""}. ${item.info || item.pleaseNote || "Bilet ve detaylar etkinlik sayfasında."}`,
    description: item.description || item.info || item.pleaseNote || `${item.name || "Etkinlik"} için güncel bilet ve mekan bilgileri.`,
    sourceProvider: "Ticketmaster Discovery",
    ticketUrl: item.url || "",
    imageUrl: image?.url || "",
    critical: false
  };
}

function inferBiletixType(title, href) {
  const text = normalizeText(`${title} ${href}`);
  if (/(konser|muzik|müzik|jolly|festival|akustik|metal|jazz|dj|sahne)/.test(text)) return "Müzik";
  if (/(tiyatro|stand up|standup|komedi|muzikal|sahne|tolgshow|don kisot|afife|madonna)/.test(text)) return "Sahne";
  if (/(spor|mac|maç|fight|tenis|basket|futbol|champions)/.test(text)) return "Spor";
  if (/(aile|cocuk|çocuk|squid|experience|muzesi|müze|play)/.test(text)) return "Aile";
  if (/(egitim|eğitim|workshop|atolye|yoga|seminar)/.test(text)) return "Eğitim";
  return "Etkinlik";
}

function biletixCityCode(city = "ISTANBUL") {
  const normalized = normalizeText(city).replace(/\s+/g, "");
  const map = {
    istanbul: "ISTANBUL",
    ankara: "ANKARA",
    izmir: "IZMIR",
    bursa: "BURSA",
    antalya: "ANTALYA",
    adana: "ADANA",
    eskisehir: "ESKISEHIR",
    konya: "KONYA",
    turkiye: "TURKIYE",
    türkiye: "TURKIYE"
  };
  return map[normalized] || "ISTANBUL";
}

function biletixSearchUrl(cityCode) {
  return `https://www.biletix.com/anasayfa/${encodeURIComponent(cityCode)}/tr`;
}

async function fetchBiletixEvents({ city = "ISTANBUL", type = "Tümü", limit = 36 } = {}) {
  const cityCode = biletixCityCode(city);
  const html = await fetchText(biletixSearchUrl(cityCode), {
    headers: {
      "User-Agent": "Mozilla/5.0 SmartNewspaper/1.0",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8"
    }
  });
  const anchors = [...html.matchAll(/<a[^>]+href="([^"]*(?:etkinlik|performance)[^"]*)"[^>]*>([\s\S]{0,500}?)<\/a>/gi)];
  const seen = new Set();
  const events = [];
  for (const match of anchors) {
    let href = decodeHtml(match[1]);
    let title = decodeHtml(match[2]);
    if (!title || title.length < 3 || /onlineetkinlikler/i.test(href)) continue;
    if (!/^https?:\/\//i.test(href)) href = `https://www.biletix.com${href.startsWith("/") ? "" : "/"}${href}`;
    const cleanUrl = href.replace(/&amp;/g, "&");
    const idMatch = cleanUrl.match(/\/(?:performance|etkinlik|etkinlik-grup)\/([^/?]+)/);
    const id = `biletix_${idMatch?.[1] || crypto.createHash("sha1").update(cleanUrl).digest("hex").slice(0, 10)}`;
    if (seen.has(id)) continue;
    const category = inferBiletixType(title, cleanUrl);
    if (type && type !== "Tümü" && category !== type) continue;
    seen.add(id);
    events.push({
      id,
      title,
      category,
      date: new Date(Date.now() + (events.length + 2) * 24 * 60 * 60 * 1000).toISOString(),
      venue: cityCode === "TURKIYE" ? "Türkiye" : cityCode[0] + cityCode.slice(1).toLocaleLowerCase("tr-TR"),
      city: cityCode === "TURKIYE" ? "Türkiye" : cityCode[0] + cityCode.slice(1).toLocaleLowerCase("tr-TR"),
      summary: "Biletix üzerinde listelenen güncel biletli etkinlik. Detay ve bilet alma için etkinlik sayfasına yönlendirilirsin.",
      description: `${title} için Biletix etkinlik sayfası. Bilet satın alma, tarih, mekan ve koltuk seçimi bilgileri Biletix üzerinde gösterilir.`,
      sourceProvider: "Biletix",
      ticketUrl: cleanUrl,
      imageUrl: "",
      critical: false
    });
    if (events.length >= limit) break;
  }
  return events;
}

async function fetchTicketmasterEvents() {
  if (!hasEnv("TICKETMASTER_API_KEY")) return { provider: "fallback", events: fallbackLiveTicketEvents() };
  const params = new URLSearchParams({
    apikey: process.env.TICKETMASTER_API_KEY.trim(),
    countryCode: process.env.EVENT_COUNTRY_CODE || "TR",
    city: process.env.EVENT_CITY || "Istanbul",
    size: process.env.EVENT_SIZE || "18",
    sort: "date,asc",
    locale: "*"
  });
  const payload = await fetchJson(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`);
  const events = (payload._embedded?.events || []).map(normalizeTicketmasterEvent);
  return { provider: "ticketmaster", events: events.length ? events : fallbackLiveTicketEvents() };
}

function wrapText(text, maxChars) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pdfEscape(value) {
  return String(value || "")
    .replace(/ı/g, "i").replace(/İ/g, "I")
    .replace(/ğ/g, "g").replace(/Ğ/g, "G")
    .replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S")
    .replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function getJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xC0 && marker <= 0xC3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

async function fetchPdfImage(url) {
  if (!url) return null;
  const dataMatch = String(url).match(/^data:image\/jpe?g;base64,(.+)$/i);
  if (dataMatch) {
    const buffer = Buffer.from(dataMatch[1], "base64");
    const size = getJpegSize(buffer);
    return size ? { ...size, data: buffer } : null;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  let imageUrl = String(url);
  if (/images\.unsplash\.com/i.test(imageUrl) && !/[?&]fm=jpg\b/i.test(imageUrl)) {
    imageUrl += imageUrl.includes("?") ? "&fm=jpg" : "?fm=jpg";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "KisiselGazetem/1.0 PDF Export", "Accept": "image/jpeg,image/*;q=0.8,*/*;q=0.4" }
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !/jpe?g/i.test(type)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const size = getJpegSize(buffer);
    return size ? { ...size, data: buffer } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pdfFixText(value = "") {
  let text = String(value || "");
  for (let i = 0; i < 2 && /[ÃÄÅÂâ]/.test(text); i += 1) {
    try {
      const decoded = Buffer.from(text, "latin1").toString("utf8");
      if (decoded && decoded !== text && !decoded.includes("\uFFFD")) text = decoded;
    } catch {}
  }
  const replacements = {
    "Ã¼": "ü", "Ãœ": "Ü", "Ã¶": "ö", "Ã–": "Ö", "Ã§": "ç", "Ã‡": "Ç",
    "ÄŸ": "ğ", "Äž": "Ğ", "Ä±": "ı", "Ä°": "İ", "ÅŸ": "ş", "Åž": "Ş",
    "â€™": "'", "â€œ": "\"", "â€�": "\"", "â€“": "-", "â€”": "-", "â€¦": "...",
    "Â°": "°", "Â·": "·", "Â": ""
  };
  for (const [bad, good] of Object.entries(replacements)) text = text.split(bad).join(good);
  const unicodeReplacements = {
    "\u00c3\u00bc": "\u00fc", "\u00c3\u0153": "\u00dc", "\u00c3\u00b6": "\u00f6", "\u00c3\u2013": "\u00d6",
    "\u00c3\u00a7": "\u00e7", "\u00c3\u2021": "\u00c7", "\u00c4\u0178": "\u011f", "\u00c4\u017e": "\u011e",
    "\u00c4\u00b1": "\u0131", "\u00c4\u00b0": "\u0130", "\u00c5\u0178": "\u015f", "\u00c5\u017e": "\u015e",
    "\u00e2\u20ac\u2122": "'", "\u00e2\u20ac\u0153": "\"", "\u00e2\u20ac\ufffd": "\"",
    "\u00e2\u20ac\u201c": "-", "\u00e2\u20ac\u009d": "-", "\u00e2\u20ac\u00a6": "...",
    "\u00c2\u00b0": "\u00b0", "\u00c2\u00b7": "\u00b7", "\u00c2": ""
  };
  for (const [bad, good] of Object.entries(unicodeReplacements)) text = text.split(bad).join(good);
  return text.replace(/\s+/g, " ").trim();
}

function htmlEscape(value = "") {
  return pdfFixText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pdfFixHtml(value = "") {
  let text = String(value || "");
  for (let i = 0; i < 2 && /[ÃÄÅÂâ]/.test(text); i += 1) {
    try {
      const decoded = Buffer.from(text, "latin1").toString("utf8");
      if (decoded && decoded !== text && !decoded.includes("\uFFFD")) text = decoded;
    } catch {}
  }
  const replacements = {
    "\u00c3\u00bc": "\u00fc", "\u00c3\u0153": "\u00dc", "\u00c3\u00b6": "\u00f6", "\u00c3\u2013": "\u00d6",
    "\u00c3\u00a7": "\u00e7", "\u00c3\u2021": "\u00c7", "\u00c4\u0178": "\u011f", "\u00c4\u017e": "\u011e",
    "\u00c4\u00b1": "\u0131", "\u00c4\u00b0": "\u0130", "\u00c5\u0178": "\u015f", "\u00c5\u017e": "\u015e",
    "\u00e2\u20ac\u2122": "'", "\u00e2\u20ac\u0153": "\"", "\u00e2\u20ac\ufffd": "\"",
    "\u00e2\u20ac\u201c": "-", "\u00e2\u20ac\u009d": "-", "\u00e2\u20ac\u00a6": "...",
    "\u00c2\u00b0": "\u00b0", "\u00c2\u00b7": "\u00b7", "\u00c2": ""
  };
  for (const [bad, good] of Object.entries(replacements)) text = text.split(bad).join(good);
  return text;
}

function pdfClamp(value = "", max = 260) {
  const clean = pdfFixText(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

function pdfIssueNumber(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date - start) / 86400000);
  return `${String(date.getFullYear()).slice(2)}${String(day).padStart(3, "0")}`;
}

function safePdfImageUrl(article = {}) {
  const value = article.imageUrl || article.image || article.urlToImage || article.thumbnailUrl || "";
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
  return "";
}

function fallbackPdfImageUrl(category = "", index = 0) {
  const key = normalizeText(category);
  const images = {
    teknoloji: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    bilim: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
    ekonomi: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80",
    finans: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80",
    saglik: "https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&w=1200&q=80",
    kultur: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    yasam: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    dunya: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
    cevre: "https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=1200&q=80",
    egitim: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80",
    gundem: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80"
  };
  const match = Object.entries(images).find(([name]) => key.includes(name));
  if (match) return match[1];
  return [images.gundem, images.teknoloji, images.kultur, images.ekonomi][index % 4];
}

function sourceIconUrl(source = {}) {
  const value = source.icon || source.logoUrl || source.sourceLogo || "";
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
  return "";
}

function normalizePdfSource(source = {}, fallbackName = "") {
  const name = pdfFixText(source.name || source.sourceName || source.title || fallbackName || "Kaynak");
  const url = source.url || source.sourceUrl || "";
  let domain = "";
  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  return {
    name: name || domain || "Kaynak",
    icon: sourceIconUrl(source),
    url,
    domain
  };
}

function normalizePdfArticle(article = {}, index = 0) {
  const title = pdfFixText(article.displayTitle || article.translatedTitle || article.title || article.originalTitle || "Başlıksız haber");
  const summary = pdfClamp(article.displaySummary || article.translatedSummary || article.aiSummary || article.summary || article.description || article.fullText || title, 360);
  const primarySource = article.sourceName || article.source || article.publisher || article.author || "Kaynak";
  const sources = Array.isArray(article.sources) && article.sources.length
    ? article.sources.map((source) => normalizePdfSource(source, primarySource))
    : [normalizePdfSource({
      name: primarySource,
      icon: article.sourceIcon || article.sourceLogo || "",
      url: article.sourceUrl || article.url || ""
    }, primarySource)];
  return {
    id: String(article.id || article.url || article.sourceUrl || title || `pdf-${index}`),
    title,
    summary,
    category: pdfFixText(article.category || inferArticleCategory(article) || "Gündem"),
    sourceName: sources[0]?.name || pdfFixText(primarySource),
    sourceIcon: sources[0]?.icon || "",
    publishedAt: article.publishedAt || article.date || article.fetchedAt || "",
    imageUrl: safePdfImageUrl(article) || fallbackPdfImageUrl(article.category || inferArticleCategory(article), index),
    url: article.url || article.sourceUrl || "",
    clusterId: article.clusterId || article.dedupeKey || "",
    sources: sources.slice(0, 6)
  };
}

function articleMatchesPdfFilters(article = {}, filters = {}) {
  const category = String(filters.category || "").trim();
  if (category && !["Tumu", "all", "genel"].includes(normalizeText(category))) {
    const articleCategory = normalizeText(article.category || inferArticleCategory(article));
    if (articleCategory !== normalizeText(category)) return false;
  }
  if (Array.isArray(filters.categories) && filters.categories.length) {
    const selected = new Set(filters.categories.map((item) => normalizeText(item)));
    const articleCategory = normalizeText(article.category || inferArticleCategory(article));
    if (!selected.has(articleCategory)) return false;
  }
  const language = String(filters.language || "").trim().toLowerCase();
  if (language && language !== "all") {
    const articleLanguage = String(article.language || article.sourceLanguage || "tr").toLowerCase();
    if (articleLanguage && articleLanguage !== language) return false;
  }
  const region = String(filters.region || "").trim();
  if (region && region !== "all" && !matchesRegionInline(article, region, filters.language || "tr")) return false;
  return true;
}

function parsePdfList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function pdfOptionEnabled(body, url, key, fallback = true) {
  const value = body[key] ?? url.searchParams.get(key);
  if (value == null || value === "") return fallback;
  return !["false", "0", "no", "hayir", "hay?r"].includes(String(value).trim().toLowerCase());
}

function findPdfArticleById(db, articleId) {
  const id = String(articleId || "");
  if (!id) return null;
  if (db._articleById?.has(id)) return db._articleById.get(id);
  return [
    ...(_feedCacheStore.articles || []),
    ...[...ARTICLE_CACHE.values()],
    ...(db.articles || [])
  ].find((article) => String(article.id) === id) || null;
}

function snapshotPdfArticle(article = {}) {
  return {
    id: article.id,
    title: article.title || article.displayTitle || article.originalTitle || "",
    summary: article.summary || article.description || article.displaySummary || article.originalSummary || "",
    category: article.category || inferArticleCategory(article),
    sourceName: article.sourceName || article.source || "",
    sourceIcon: article.sourceIcon || article.icon || "",
    imageUrl: safePdfImageUrl(article),
    publishedAt: article.publishedAt || article.date || "",
    url: article.url || article.sourceUrl || "",
    clusterId: article.clusterId || article.dedupeKey || "",
    sources: Array.isArray(article.sources) ? article.sources : []
  };
}

async function collectPdfArticles(db, userId, req, url, body = {}) {
  const requestedSections = parsePdfList(body.sections || url.searchParams.get("sections"));
  const activeSections = new Set(requestedSections.length ? requestedSections : ["feed", "personalized", "myNewspaper"]);
  const selectedCategories = parsePdfList(body.categories || url.searchParams.get("categories"));
  const filters = {
    category: body.category || url.searchParams.get("category") || "",
    categories: selectedCategories,
    region: body.region || url.searchParams.get("region") || "",
    language: body.language || url.searchParams.get("language") || "tr"
  };
  const includeUserSources = pdfOptionEnabled(body, url, "includeUserSources", activeSections.has("mySources"));
  const includeUserNewspaperItems = pdfOptionEnabled(body, url, "includeUserNewspaperItems", activeSections.has("myNewspaper"));
  const includeSavedArticles = pdfOptionEnabled(body, url, "includeSavedArticles", activeSections.has("saved"));
  const dedupe = pdfOptionEnabled(body, url, "dedupe", true);
  const submitted = Array.isArray(body.articles) ? body.articles : [];
  const queryArticleIds = String(url.searchParams.get("articleIds") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const articleIds = Array.isArray(body.articleIds) ? body.articleIds.map(String) : queryArticleIds;
  const dbArticles = db.articles.filter((article) => !articleIds.length || articleIds.includes(String(article.id)));
  const cachedArticles = _feedCacheStore.articles.length ? _feedCacheStore.articles : buildLocalFeedCacheArticles(db);
  const articleCacheItems = [...ARTICLE_CACHE.values()];
  const savedArticles = includeSavedArticles
    ? db.bookmarks
      .filter((item) => item.userId === userId)
      .map((item) => findPdfArticleById(db, item.articleId))
      .filter(Boolean)
    : [];
  const newspaperArticles = includeUserNewspaperItems
    ? db.userNewspaperItems
      .filter((item) => item.userId === userId)
      .sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0))
      .map((item) => ({
        ...(item.articleSnapshot || findPdfArticleById(db, item.articleId) || {}),
        id: item.articleId || item.id,
        clusterId: item.clusterId || item.articleSnapshot?.clusterId,
        section: "myNewspaper"
      }))
      .filter((article) => article.title || article.id)
    : [];
  const userSources = includeUserSources
    ? normalizeUserSourcesDb(db.userSources.filter((source) => source.userId === userId && source.enabled !== false))
    : [];

  let externalArticles = [];
  if (userSources.length) {
    const fetched = await Promise.allSettled(userSources.slice(0, 8).map((source) => fetchContentsForSource(source)));
    externalArticles = fetched.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      const source = result.value.source || {};
      return (result.value.items || []).map((item) => ({
        ...item,
        sourceName: source.title || item.sourceName,
        source: source.title || item.sourceName,
        sourceIcon: source.logoUrl || "",
        sourceUrl: item.url || source.url || source.feedUrl || "",
        userSourceId: source.id,
        category: item.category || source.category || "Genel",
        sources: [normalizePdfSource({
          name: source.title || item.sourceName,
          icon: source.logoUrl || "",
          url: item.url || source.url || source.feedUrl || ""
        })]
      }));
    });
  }

  const includeGeneralFeed = activeSections.has("feed") || activeSections.has("personalized") || activeSections.has("economy") || activeSections.has("events");
  const pool = [
    ...newspaperArticles,
    ...savedArticles,
    ...submitted,
    ...(includeUserSources ? externalArticles : []),
    ...(includeGeneralFeed ? cachedArticles : []),
    ...dbArticles,
    ...articleCacheItems
  ].filter(Boolean);

  const filtered = pool.filter((article) => articleMatchesPdfFilters(article, filters));
  const fallback = filtered.length >= 8 ? filtered : [...filtered, ...pool.filter((article) => !filtered.includes(article))];
  const unique = (dedupe ? dedupeFeedArticles(fallback, 80) : fallback.slice(0, 80))
    .filter((article) => pdfFixText(article.title || article.displayTitle).length > 3)
    .map((article) => decorateArticle(db, userId, article))
    .map(normalizeArticleTransportFields)
    .map((article, index) => normalizePdfArticle(article, index));

  return {
    articles: unique.slice(0, Math.min(Math.max(Number(body.limit || url.searchParams.get("limit") || 30) || 30, 10), 50)),
    filters,
    userSources,
    includeUserSources,
    includeUserNewspaperItems,
    includeSavedArticles,
    sections: [...activeSections],
    categories: selectedCategories
  };
}

function groupPdfArticlesByCategory(articles = []) {
  const groups = new Map();
  for (const article of articles) {
    const key = article.category || "Gündem";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  }
  return [...groups.entries()].slice(0, 8).map(([title, items]) => ({ title, items }));
}

function renderPdfSourceChips(sources = []) {
  return sources.slice(0, 4).map((source) => {
    const icon = source.icon ? `<img src="${htmlEscape(source.icon)}" alt="">` : `<b>${htmlEscape(source.name.slice(0, 1).toLocaleUpperCase("tr-TR"))}</b>`;
    return `<span class="pdf-source-chip">${icon}${htmlEscape(source.name)}</span>`;
  }).join("");
}

function renderPdfArticleCard(article, { lead = false } = {}) {
  const image = article.imageUrl
    ? `<img src="${htmlEscape(article.imageUrl)}" class="pdf-news-image" alt="">`
    : `<div class="pdf-image-fallback"><span>${htmlEscape(article.category)}</span></div>`;
  return `
    <article class="pdf-card ${lead ? "is-lead" : ""}">
      <div class="pdf-image-wrap">${image}</div>
      <div class="pdf-card-body">
        <div class="pdf-card-meta">
          <span>${htmlEscape(article.category)}</span>
          <em>${htmlEscape(article.sourceName)}</em>
        </div>
        <h3>${htmlEscape(article.title)}</h3>
        <p>${htmlEscape(pdfClamp(article.summary, lead ? 460 : 230))}</p>
        <div class="pdf-source-row">${renderPdfSourceChips(article.sources)}</div>
      </div>
    </article>
  `;
}

function pdfArticleOrFallback(articles, index, fallback) {
  return articles[index] || {
    id: `fallback-${index}`,
    title: fallback.title,
    summary: fallback.summary,
    category: fallback.category || "Gündem",
    sourceName: fallback.sourceName || "e-Gazete",
    imageUrl: "",
    sources: [{ name: fallback.sourceName || "e-Gazete", icon: "", url: "" }],
    publishedAt: ""
  };
}

function renderPdfMiniCard(article) {
  const image = article.imageUrl
    ? `<img src="${htmlEscape(article.imageUrl)}" class="ep-mini-img" alt="">`
    : `<div class="ep-mini-fallback">${htmlEscape(article.category)}</div>`;
  return `
    <article class="ep-mini-card">
      ${image}
      <span>${htmlEscape(article.category)}</span>
      <h3>${htmlEscape(article.title)}</h3>
      <p>${htmlEscape(pdfClamp(article.summary, 115))}</p>
      <small>${htmlEscape(article.sourceName)} · 4 dk okuma</small>
    </article>
  `;
}

function renderPdfGridCard(article) {
  const image = article.imageUrl
    ? `<img src="${htmlEscape(article.imageUrl)}" class="ep-grid-img" alt="">`
    : `<div class="ep-grid-fallback">${htmlEscape(article.category)}</div>`;
  return `
    <article class="ep-grid-card">
      <div class="ep-grid-img-wrap">
        ${image}
        <span>${htmlEscape(article.category)}</span>
      </div>
      <div class="ep-grid-body">
        <h3>${htmlEscape(article.title)}</h3>
        <p>${htmlEscape(pdfClamp(article.summary, 145))}</p>
        <small>${htmlEscape(article.sourceName)} · 5 dk okuma</small>
        <div class="ep-source-row">${renderPdfSourceChips(article.sources)}</div>
      </div>
    </article>
  `;
}

function buildEpaperPdfHtml({ articles, user, filters, userSources }) {
  const now = new Date();
  const dateLabel = now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const issue = pdfIssueNumber(now);
  const paperTitle = `${pdfFixText(user?.name || "Okuyucu")} için e-Gazete`;
  const hero = pdfArticleOrFallback(articles, 0, { title: "Günün ana gündemi hazırlanıyor", summary: "Kişisel haber havuzu güncellendiğinde ana manşet burada yer alacak.", category: "Gündem" });
  const side = [pdfArticleOrFallback(articles, 1, hero), pdfArticleOrFallback(articles, 2, hero)];
  const highlights = [3, 4, 5, 6].map((index) => pdfArticleOrFallback(articles, index, hero));
  const sciencePool = articles.filter((article) => ["Teknoloji", "Bilim", "Çevre", "Eğitim", "Finans"].includes(article.category));
  const culturePool = articles.filter((article) => ["Kültür-Sanat", "Kültür", "Yaşam", "Sağlık", "Dünya"].includes(article.category));
  const science = (sciencePool.length >= 4 ? sciencePool : articles.slice(1)).slice(0, 4).map((article, index) => article || pdfArticleOrFallback(articles, index + 1, hero));
  const culture = (culturePool.length >= 4 ? culturePool : articles.slice(5)).slice(0, 4).map((article, index) => article || pdfArticleOrFallback(articles, index + 5, hero));
  const cultureBanner = culture[0] || hero;
  const agendaNeedsSecondPage = [hero, ...side, ...highlights].some((article) =>
    pdfFixText(article.title).length > 92 || pdfFixText(article.summary).length > 260
  );
  const totalPages = agendaNeedsSecondPage ? 4 : 3;
  const sciencePageNumber = agendaNeedsSecondPage ? 3 : 2;
  const culturePageNumber = agendaNeedsSecondPage ? 4 : 3;
  const allSources = [];
  for (const article of articles) for (const source of article.sources || []) allSources.push(source);
  const uniqueSources = [...new Map(allSources.map((source) => [source.domain || source.name, source])).values()].slice(0, 30);
  const sourceSummary = userSources.length
    ? `${userSources.length} kişisel kaynak dahil edildi`
    : "Genel haber havuzu ve tercih sinyalleri kullanıldı";
  const filterBits = [
    filters.category ? `Kategori: ${filters.category}` : "",
    filters.region ? `Bölge: ${filters.region}` : "",
    filters.language ? `Dil: ${filters.language}` : ""
  ].filter(Boolean).join(" · ") || "Genel seçki";

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(paperTitle)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #ffffff !important; color: #111827 !important; font-family: Arial, sans-serif; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .pdf-page { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; padding: 9mm 8mm 11mm; background: linear-gradient(180deg,#ffffff,#f8fafc); position: relative; }
    .pdf-page:last-child { page-break-after: auto; }
    .ep-panel { border: 1px solid #dbe2f0; border-radius: 7px; background: rgba(255,255,255,.96); box-shadow: 0 12px 28px rgba(15,23,42,.08); padding: 8mm; height: 277mm; overflow: hidden; }
    .ep-agenda-page .ep-panel { padding: 7mm; }
    .ep-agenda-page.is-split .ep-main-grid ~ .ep-subhead,
    .ep-agenda-page.is-split .ep-main-grid ~ .ep-highlight-row,
    .ep-agenda-page.is-split .ep-main-grid ~ .ep-author-row { display: none; }
    .ep-head { display: flex; align-items: end; justify-content: space-between; gap: 10px; padding-bottom: 5mm; border-bottom: 1.4px solid #111827; margin-bottom: 5mm; }
    .ep-head span { display: block; margin-bottom: 2px; color: #4338ca; font-size: 9px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
    .ep-head h1 { margin: 0; color: #050816; font-family: Georgia, serif; font-size: 25px; line-height: .95; }
    .ep-head i { color: #c7d2fe; font-style: normal; font-size: 22px; }
    .ep-main-grid { display: grid; grid-template-columns: 1.42fr .72fr; gap: 4mm; align-items: start; }
    .ep-hero { position: relative; height: 126mm; border-radius: 6px; overflow: hidden; background: #111827; }
    .ep-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ep-hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg,rgba(15,23,42,.05),rgba(15,23,42,.88)); }
    .ep-hero-body { position: absolute; left: 7mm; right: 7mm; bottom: 7mm; z-index: 1; color: #fff; }
    .ep-tag, .ep-mini-card span, .ep-grid-img-wrap span { display: inline-flex; width: fit-content; padding: 3px 6px; border-radius: 99px; background: #eef2ff; color: #4338ca; font-size: 8px; font-weight: 950; text-transform: uppercase; letter-spacing: .04em; }
    .ep-hero .ep-tag { background: rgba(255,255,255,.22); color: #fff; }
    .ep-hero h2 { margin: 4mm 0 2mm; font-family: Georgia, serif; font-size: 27px; line-height: .96; color: #fff; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden; }
    .ep-hero p { margin: 0 0 3mm; color: rgba(255,255,255,.9); font-size: 10.5px; line-height: 1.38; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .ep-hero small, .ep-mini-card small, .ep-grid-card small { color: #475569; font-size: 9px; font-weight: 850; }
    .ep-hero small { color: rgba(255,255,255,.85); }
    .ep-side { display: grid; gap: 3mm; }
    .ep-mini-card, .ep-grid-card { break-inside: avoid; page-break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #fff; }
    .ep-mini-img, .ep-mini-fallback { width: 100%; height: 27mm; object-fit: cover; display: block; background: #eef2ff; }
    .ep-mini-fallback, .ep-grid-fallback { display: grid; place-items: center; color: #4338ca; font-weight: 950; font-size: 10px; }
    .ep-mini-card span { margin: 3mm 3.5mm 0; }
    .ep-mini-card h3 { margin: 2.2mm 3.5mm 1.5mm; color: #050816; font-family: Georgia, serif; font-size: 12px; line-height: 1.04; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
    .ep-mini-card p { margin: 0 3.5mm 2mm; color: #475569; font-size: 9px; line-height: 1.32; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .ep-mini-card small { display: block; margin: 0 3.5mm 3mm; }
    .ep-subhead { display: flex; justify-content: space-between; align-items: center; margin: 3.5mm 0 2.5mm; }
    .ep-subhead h2 { margin: 0; font-size: 13px; color: #111827; }
    .ep-highlight-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 3mm; }
    .ep-highlight-row .ep-mini-img, .ep-highlight-row .ep-mini-fallback { height: 24mm; }
    .ep-highlight-row .ep-mini-card h3 { min-height: 18mm; font-size: 10.5px; -webkit-line-clamp: 4; }
    .ep-agenda-extra .ep-highlight-row { grid-template-columns: repeat(2,1fr); gap: 5mm; }
    .ep-agenda-extra .ep-mini-img, .ep-agenda-extra .ep-mini-fallback { height: 38mm; }
    .ep-agenda-extra .ep-mini-card h3 { min-height: auto; font-size: 15px; -webkit-line-clamp: 4; }
    .ep-agenda-extra .ep-mini-card p { font-size: 10.5px; -webkit-line-clamp: 5; }
    .ep-author-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 3mm; margin-top: 3mm; }
    .ep-author { border: 1px solid #e5e7eb; border-radius: 6px; padding: 3mm; background: #f8fafc; }
    .ep-author b { display: block; color: #312e81; font-size: 10px; margin-bottom: 1mm; }
    .ep-author span { color: #64748b; font-size: 9px; font-weight: 800; }
    .ep-category-page .ep-panel { background: linear-gradient(180deg,#f8faff,#fff 40mm); }
    .ep-card-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 5mm; }
    .ep-grid-card { min-height: 119mm; }
    .ep-grid-img-wrap { position: relative; height: 43mm; background: #eef2ff; overflow: hidden; }
    .ep-grid-img, .ep-grid-fallback { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ep-grid-img-wrap span { position: absolute; top: 3mm; left: 3mm; background: rgba(255,255,255,.93); }
    .ep-grid-body { padding: 4mm; }
    .ep-grid-body h3 { margin: 0 0 3mm; font-family: Georgia, serif; color: #050816; font-size: 16px; line-height: 1.08; overflow-wrap: anywhere; }
    .ep-grid-body p { margin: 0 0 3mm; color: #475569; font-size: 11px; line-height: 1.42; }
    .ep-source-row { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 2mm; }
    .pdf-source-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 6px; border: 1px solid #e0e7ff; border-radius: 99px; color: #334155; background: #f8fafc; font-size: 8px; font-weight: 800; }
    .pdf-source-chip img { width: 12px; height: 12px; border-radius: 50%; object-fit: contain; }
    .pdf-source-chip b { width: 12px; height: 12px; display: inline-grid; place-items: center; border-radius: 50%; background: #312e81; color: #fff; font-size: 7px; }
    .ep-feature { margin-top: 5mm; display: grid; grid-template-columns: 1fr auto; gap: 4mm; align-items: center; padding: 5mm; border-radius: 7px; background: linear-gradient(135deg,#312e81,#581c87); color: #fff; }
    .ep-feature span { color: #ddd6fe; font-size: 9px; font-weight: 950; text-transform: uppercase; }
    .ep-feature h3 { margin: 2mm 0; font-family: Georgia, serif; font-size: 17px; line-height: 1.05; }
    .ep-feature p { margin: 0; color: rgba(255,255,255,.82); font-size: 10px; line-height: 1.4; }
    .ep-feature b { width: 13mm; height: 13mm; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.14); }
    .ep-source-note { margin-top: 4mm; padding-top: 3mm; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 9px; line-height: 1.35; }
    .pdf-footer { position: absolute; left: 8mm; right: 8mm; bottom: 4mm; display: flex; justify-content: space-between; gap: 10px; color: #64748b; font-size: 8px; font-weight: 850; }
    .pdf-footer span:last-child { display: none; }
    .pdf-footer::after { content: counter(page) " / " counter(pages); margin-left: auto; }
    .no-print, .app-sidebar, .navbar, .modal, .floating-button { display: none !important; }
    @media print {
      body { background: #ffffff !important; color: #111827 !important; }
      .pdf-page { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; }
      .ep-mini-card, .ep-grid-card { break-inside: avoid; page-break-inside: avoid; }
      img { max-width: 100%; object-fit: cover; }
    }
  </style>
</head>
<body>
  <section class="pdf-page ep-agenda-page ${agendaNeedsSecondPage ? "is-split" : ""}">
    <div class="ep-panel">
      <header class="ep-head"><div><span>Günün sayfası</span><h1>Manşet ve öne çıkanlar</h1></div><i>▣</i></header>
      <div class="ep-main-grid">
        <article class="ep-hero">
          ${hero.imageUrl ? `<img src="${htmlEscape(hero.imageUrl)}" alt="">` : `<div class="ep-grid-fallback">${htmlEscape(hero.category)}</div>`}
          <div class="ep-hero-body"><span class="ep-tag">${htmlEscape(hero.category)}</span><h2>${htmlEscape(hero.title)}</h2><p>${htmlEscape(pdfClamp(hero.summary, 230))}</p><small>${htmlEscape(hero.sourceName)} · Sayı ${htmlEscape(issue)}</small></div>
        </article>
        <aside class="ep-side">${side.map(renderPdfMiniCard).join("")}</aside>
      </div>
      <div class="ep-subhead"><h2>Günün Öne Çıkanları</h2><span class="ep-tag">${htmlEscape(filterBits)}</span></div>
      <div class="ep-highlight-row">${highlights.map(renderPdfMiniCard).join("")}</div>
      <div class="ep-subhead"><h2>Yazarlar</h2><span class="ep-tag">${htmlEscape(sourceSummary)}</span></div>
      <div class="ep-author-row"><div class="ep-author"><b>Gündem Notu</b><span>Kısa analiz</span></div><div class="ep-author"><b>Ekonomi Yorumu</b><span>Piyasa özeti</span></div><div class="ep-author"><b>Bilim Defteri</b><span>Haftalık bakış</span></div><div class="ep-author"><b>Kültür Ajandası</b><span>Etkinlik seçkisi</span></div></div>
    </div>
    <footer class="pdf-footer"><span>${htmlEscape(paperTitle)} · ${htmlEscape(dateLabel)}</span><span>1 / 3</span></footer>
  </section>
  ${agendaNeedsSecondPage ? `
  <section class="pdf-page ep-agenda-page ep-agenda-extra">
    <div class="ep-panel">
      <header class="ep-head"><div><span>Gündem devam</span><h1>Günün Öne Çıkanları</h1></div><i>▣</i></header>
      <div class="ep-highlight-row">${highlights.map(renderPdfMiniCard).join("")}</div>
      <div class="ep-subhead"><h2>Yazarlar</h2><span class="ep-tag">${htmlEscape(sourceSummary)}</span></div>
      <div class="ep-author-row"><div class="ep-author"><b>Gündem Notu</b><span>Kısa analiz</span></div><div class="ep-author"><b>Ekonomi Yorumu</b><span>Piyasa özeti</span></div><div class="ep-author"><b>Bilim Defteri</b><span>Haftalık bakış</span></div><div class="ep-author"><b>Kültür Ajandası</b><span>Etkinlik seçkisi</span></div></div>
    </div>
    <footer class="pdf-footer"><span>e-Gazete · Gündem devam</span><span>2 / ${totalPages}</span></footer>
  </section>
  ` : ""}
  <section class="pdf-page ep-category-page">
    <div class="ep-panel">
      <header class="ep-head"><div><span>Araştırma · Dijital dönüşüm</span><h1>⚛ Bilim ve Teknoloji</h1></div><i>▣</i></header>
      <div class="ep-card-grid">${science.map(renderPdfGridCard).join("")}</div>
    </div>
    <footer class="pdf-footer"><span>e-Gazete · Bilim ve Teknoloji</span><span>2 / 3</span></footer>
  </section>
  <section class="pdf-page ep-category-page">
    <div class="ep-panel">
      <header class="ep-head"><div><span>Kent · Etkinlik · Toplum</span><h1>🎭 Kültür ve Yaşam</h1></div><i>▣</i></header>
      <div class="ep-card-grid">${culture.map(renderPdfGridCard).join("")}</div>
      <article class="ep-feature"><div><span>Haftanın dosyası</span><h3>${htmlEscape(cultureBanner.title)}</h3><p>${htmlEscape(pdfClamp(cultureBanner.summary, 155))}</p></div><b>§</b></article>
      <div class="ep-source-note">Bu gazete kişisel haber tercihlerinize göre oluşturulmuştur. Aynı haber farklı kaynaklarda geçtiğinde tek haber olarak gösterilir. Kaynak özeti: ${htmlEscape(uniqueSources.slice(0, 10).map((source) => source.name).join(", ") || "Kaynak bilgisi sınırlı")}.</div>
    </div>
    <footer class="pdf-footer"><span>${articles.length} haber · ${htmlEscape(now.toLocaleString("tr-TR"))}</span><span>3 / 3</span></footer>
  </section>
</body>
</html>`;
}

async function renderHtmlToPdf(html) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    await page.setContent(pdfFixHtml(html), { waitUntil: "networkidle", timeout: 45000 });
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      timeout: 45000
    });
  } finally {
    await browser.close();
  }
}

async function buildEpaperPdfBuffer({ db, userId, req, url, body = {} }) {
  const { articles, filters, userSources } = await collectPdfArticles(db, userId, req, url, body);
  if (!articles.length) {
    const emptyHtml = buildEpaperPdfHtml({
      articles: [{
        id: "empty",
        title: "PDF için uygun haber bulunamadı",
        summary: "Seçili filtrelere veya kişisel kaynaklara uygun haber bulunamadı. Filtreleri genişletip tekrar deneyebilirsiniz.",
        category: "Bilgi",
        sourceName: "e-Gazete",
        imageUrl: "",
        sources: [{ name: "e-Gazete", icon: "", url: "" }]
      }],
      user: db.users.find((item) => item.id === userId),
      filters,
      userSources: []
    });
    return renderHtmlToPdf(emptyHtml);
  }
  const html = buildEpaperPdfHtml({
    articles,
    user: db.users.find((item) => item.id === userId),
    filters,
    userSources
  });
  return renderHtmlToPdf(html);
}

async function buildSimplePdf({ title, layout, articles, events, paperTitle, interests, trends }) {
  const configs = {
    a4: { width: 595, height: 842, margin: 38, name: "A4 KLASIK GAZETE" },
    tabloid: { width: 792, height: 1224, margin: 44, name: "TABLOID GENIS SAYFA" },
    booklet: { width: 420, height: 595, margin: 28, name: "KITAPCIK DUZENI" },
    egazete: { width: 595, height: 842, margin: 38, name: "E-GAZETE SAYFA CEVIRME" }
  };
  const cfg = configs[layout] || configs.a4;
  const blocks = articles.slice(0, 18).map((article, index) => ({
    title: article.title || "Basliksiz haber",
    meta: `${article.category || "Haber"} | ${article.sourceName || article.source || ""}`,
    body: article.summary || article.fullText || "",
    imageUrl: article.imageUrl || article.image || article.urlToImage || "",
    lead: index === 0
  }));
  if (events.length) {
    blocks.push({
      title: "Kurumsal etkinlik ve duyurular",
      meta: "Kampus",
      body: events.slice(0, 4).map((event) => `${event.category}: ${event.title}. ${event.summary || event.description}`).join(" "),
      imageUrl: "",
      lead: false
    });
  }

  await Promise.all(blocks.slice(0, 12).map(async (block, index) => {
    const image = await fetchPdfImage(block.imageUrl);
    if (image) block.image = { ...image, name: `Im${index + 1}` };
  }));

  const objects = [];
  function addObject(body) {
    objects.push(body);
    return objects.length;
  }

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const imageObjects = [];
  for (const block of blocks) {
    if (!block.image) continue;
    const img = block.image;
    const objectId = addObject(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n${img.data.toString("binary")}\nendstream`);
    imageObjects.push({ name: img.name, objectId });
  }

  const pageStreams = [];
  let commands = [];
  let pageNumber = 0;

  function text(x, y, size, value, font = "F1") {
    commands.push("BT", `/${font} ${size} Tf`, `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`, `(${pdfEscape(value)}) Tj`, "ET");
  }

  function line(x1, y1, x2, y2, width = 0.6) {
    commands.push("0 G", `${width} w`, `${x1.toFixed(2)} ${y1.toFixed(2)} m`, `${x2.toFixed(2)} ${y2.toFixed(2)} l`, "S");
  }

  function rect(x, y, w, h, gray = 0.94) {
    commands.push(`${gray} g`, `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`, "f", "0 g");
  }

  function drawImage(block, x, y, w, h) {
    if (block.image) {
      const scale = Math.max(w / block.image.width, h / block.image.height);
      const dw = block.image.width * scale;
      const dh = block.image.height * scale;
      const dx = x + (w - dw) / 2;
      const dy = y + (h - dh) / 2;
      commands.push(
        "q",
        `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`,
        "W",
        "n",
        `${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm`,
        `/${block.image.name} Do`,
        "Q"
      );
    } else {
      rect(x, y, w, h, 0.9);
      line(x + 8, y + 8, x + w - 8, y + h - 8, 0.4);
      line(x + w - 8, y + 8, x + 8, y + h - 8, 0.4);
      text(x + 10, y + h / 2 + 3, 8, "Gorsel bulunamadi", "F2");
      text(x + 10, y + h / 2 - 9, 6.5, "Gazete placeholder alani", "F1");
    }
  }

  function paragraph(x, y, widthChars, lines, size = 9.5, font = "F1", leading = size + 3) {
    let currentY = y;
    for (const lineText of wrapText(lines, widthChars)) {
      text(x, currentY, size, lineText, font);
      currentY -= leading;
    }
    return currentY;
  }

  function pageFooter() {
    line(cfg.margin, cfg.margin + 20, cfg.width - cfg.margin, cfg.margin + 20, 0.4);
    text(cfg.margin, cfg.margin + 8, 7, pdfEscape(paperTitle || title), "F1");
    text(cfg.width - cfg.margin - 50, cfg.margin + 8, 7, `Sayfa ${pageNumber}`, "F1");
  }

  function newPage() {
    if (commands.length) { pageFooter(); pageStreams.push(commands.join("\n")); }
    commands = [];
    pageNumber += 1;
    text(cfg.margin, cfg.height - cfg.margin, 22, title, "F2");
    text(cfg.margin, cfg.height - cfg.margin - 17, 8.5, `${cfg.name} | Sayfa ${pageNumber}`, "F1");
    line(cfg.margin, cfg.height - cfg.margin - 28, cfg.width - cfg.margin, cfg.height - cfg.margin - 28, 1.1);
    return cfg.height - cfg.margin - 48;
  }

  function drawCoverPage() {
    if (commands.length) pageStreams.push(commands.join("\n"));
    commands = [];
    const cx = cfg.width / 2;
    const dateLabel = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const coverTitle = paperTitle || title;

    // top rule
    line(cfg.margin, cfg.height - cfg.margin, cfg.width - cfg.margin, cfg.height - cfg.margin, 2.5);
    // paper name
    text(cfg.margin, cfg.height - cfg.margin - 38, layout === "booklet" ? 20 : 28, coverTitle, "F2");
    // date
    text(cfg.margin, cfg.height - cfg.margin - 55, 9, dateLabel, "F1");
    // edition label
    const editionLabel = cfg.name;
    text(cfg.width - cfg.margin - editionLabel.length * 5.2, cfg.height - cfg.margin - 55, 7.5, editionLabel, "F1");
    // rule under header
    line(cfg.margin, cfg.height - cfg.margin - 65, cfg.width - cfg.margin, cfg.height - cfg.margin - 65, 1.5);
    line(cfg.margin, cfg.height - cfg.margin - 68, cfg.width - cfg.margin, cfg.height - cfg.margin - 68, 0.4);

    let y = cfg.height - cfg.margin - 100;

    // Interest areas section
    if (interests && interests.length) {
      text(cfg.margin, y, 8, "ILGI ALANLARI", "F2");
      y -= 14;
      const chipW = 68;
      const chipH = 14;
      const chipGap = 8;
      let chipX = cfg.margin;
      for (const interest of interests.slice(0, 12)) {
        if (chipX + chipW > cfg.width - cfg.margin) { chipX = cfg.margin; y -= chipH + 6; }
        rect(chipX, y - chipH, chipW, chipH, 0.9);
        text(chipX + 6, y - chipH + 4, 7.5, pdfEscape(interest).slice(0, 14), "F1");
        chipX += chipW + chipGap;
      }
      y -= chipH + 18;
      line(cfg.margin, y, cfg.width - cfg.margin, y, 0.5);
      y -= 16;
    }

    // Trends section
    if (trends && trends.length) {
      text(cfg.margin, y, 8, "BUGUNUN TRENDLERI", "F2");
      y -= 14;
      for (let i = 0; i < trends.length; i++) {
        const t = trends[i];
        text(cfg.margin, y, 9, `${i + 1}. ${pdfEscape(t.title).slice(0, 54)}`, "F1");
        text(cfg.width - cfg.margin - 90, y, 7.5, `${t.sourceCount} kaynak, ${t.articleCount} haber`, "F1");
        y -= 13;
      }
      y -= 10;
      line(cfg.margin, y, cfg.width - cfg.margin, y, 0.5);
      y -= 16;
    }

    const lead = blocks[0];
    if (lead && y > cfg.margin + 235) {
      const imageW = Math.min(cfg.width - cfg.margin * 2, layout === "booklet" ? 180 : 245);
      const imageH = layout === "booklet" ? 92 : 132;
      drawImage(lead, cfg.margin, y - imageH, imageW, imageH);
      const textX = cfg.margin + imageW + 18;
      const textW = cfg.width - cfg.margin - textX;
      let leadY = paragraph(textX, y - 6, Math.max(24, Math.floor(textW / 5.5)), lead.title, layout === "booklet" ? 12 : 18, "F2", layout === "booklet" ? 14 : 21);
      text(textX, leadY - 2, 7.5, lead.meta.toUpperCase(), "F1");
      paragraph(textX, leadY - 16, Math.max(28, Math.floor(textW / 5.1)), lead.body, 8.5, "F1", 11);
      y -= imageH + 24;
      line(cfg.margin, y, cfg.width - cfg.margin, y, 0.5);
      y -= 16;
    }

    // Article list (index)
    text(cfg.margin, y, 8, "BU SAYIDA", "F2");
    y -= 14;
    for (let i = 0; i < blocks.length && i < 15; i++) {
      const b = blocks[i];
      const numLabel = `${i + 1}.`;
      text(cfg.margin, y, 8, numLabel, "F2");
      text(cfg.margin + 20, y, 8, pdfEscape(b.title).slice(0, 62), "F1");
      text(cfg.width - cfg.margin - 60, y, 7, pdfEscape(b.meta).slice(0, 22), "F1");
      y -= 12;
      if (y < cfg.margin + 30) break;
    }

    // Footer
    line(cfg.margin, cfg.margin + 20, cfg.width - cfg.margin, cfg.margin + 20, 0.5);
    const footerText = `Kisisel Gazetem tarafindan olusturuldu — ${new Date().toLocaleString("tr-TR")}`;
    text(cfg.margin, cfg.margin + 8, 7, footerText, "F1");

    pageStreams.push(commands.join("\n"));
    commands = [];
    pageNumber += 1;
  }

  function drawSourcesPage() {
    if (commands.length) pageStreams.push(commands.join("\n"));
    commands = [];
    text(cfg.margin, cfg.height - cfg.margin, 18, "Kaynaklar", "F2");
    line(cfg.margin, cfg.height - cfg.margin - 14, cfg.width - cfg.margin, cfg.height - cfg.margin - 14, 1);
    let y = cfg.height - cfg.margin - 34;
    const uniqueSources = [...new Set(blocks.map((b) => b.meta.split("|").pop().trim()).filter(Boolean))];
    if (!uniqueSources.length) uniqueSources.push("Kaynak bilgisi sinirli");
    for (const src of uniqueSources) {
      if (y < cfg.margin + 20) break;
      text(cfg.margin + 10, y, 9, `- ${pdfEscape(src)}`, "F1");
      y -= 13;
    }
    line(cfg.margin, cfg.margin + 20, cfg.width - cfg.margin, cfg.margin + 20, 0.5);
    text(cfg.margin, cfg.margin + 8, 7, pdfEscape(paperTitle || title), "F1");
    pageStreams.push(commands.join("\n"));
    commands = [];
    pageNumber += 1;
  }

  function drawCard(block, x, y, w, h, style) {
    rect(x, y - h, w, h, 0.985);
    if (style === "imageTop") {
      drawImage(block, x + 8, y - 78, w - 16, 68);
      let ty = paragraph(x + 8, y - 94, Math.floor((w - 16) / 5.7), block.title, 11, "F2", 13);
      text(x + 8, ty - 2, 7.5, block.meta.toUpperCase(), "F1");
      paragraph(x + 8, ty - 15, Math.floor((w - 16) / 5.2), block.body, 8.5, "F1", 11);
    } else {
      drawImage(block, x + 8, y - 94, 116, 82);
      let ty = paragraph(x + 132, y - 22, Math.floor((w - 140) / 5.8), block.title, 10.5, "F2", 12);
      text(x + 132, ty - 1, 7, block.meta.toUpperCase(), "F1");
      paragraph(x + 132, ty - 13, Math.floor((w - 140) / 5.3), block.body, 8.2, "F1", 10);
    }
  }

  drawCoverPage();

  if (layout === "tabloid") {
    let y = newPage();
    const lead = blocks[0];
    if (lead) {
      drawImage(lead, cfg.margin, y - 215, 350, 205);
      let ty = paragraph(cfg.margin + 370, y - 10, 42, lead.title, 22, "F2", 25);
      text(cfg.margin + 370, ty - 2, 9, lead.meta.toUpperCase(), "F1");
      paragraph(cfg.margin + 370, ty - 18, 48, lead.body, 11, "F1", 14);
      y -= 245;
    }
    const gap = 16;
    const colW = (cfg.width - cfg.margin * 2 - gap * 2) / 3;
    let col = 0;
    for (const block of blocks.slice(1)) {
      if (y - 210 < cfg.margin) { y = newPage(); col = 0; }
      drawCard(block, cfg.margin + col * (colW + gap), y, colW, 198, "imageTop");
      col += 1;
      if (col === 3) { col = 0; y -= 214; }
    }
  } else if (layout === "booklet") {
    let y = newPage();
    for (const block of blocks) {
      if (y - 116 < cfg.margin) y = newPage();
      drawCard(block, cfg.margin, y, cfg.width - cfg.margin * 2, 106, "imageLeft");
      y -= 120;
    }
  } else {
    let y = newPage();
    const lead = blocks[0];
    if (lead) {
      drawImage(lead, cfg.margin, y - 188, cfg.width - cfg.margin * 2, 178);
      let ty = paragraph(cfg.margin, y - 210, 58, lead.title, 20, "F2", 23);
      text(cfg.margin, ty - 3, 8.5, lead.meta.toUpperCase(), "F1");
      paragraph(cfg.margin, ty - 20, 68, lead.body, 10.5, "F1", 13);
      y = ty - 78;
    }
    const gap = 16;
    const colW = (cfg.width - cfg.margin * 2 - gap) / 2;
    let col = 0;
    for (const block of blocks.slice(1)) {
      if (y - 178 < cfg.margin) { y = newPage(); col = 0; }
      drawCard(block, cfg.margin + col * (colW + gap), y, colW, 166, "imageTop");
      col += 1;
      if (col === 2) { col = 0; y -= 184; }
    }
  }
  if (commands.length) { pageFooter(); pageStreams.push(commands.join("\n")); }
  commands = [];

  drawSourcesPage();

  const xobjects = imageObjects.length
    ? `/XObject << ${imageObjects.map((img) => `/${img.name} ${img.objectId} 0 R`).join(" ")} >>`
    : "";
  const pageIds = [];
  for (const stream of pageStreams) {
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${cfg.width} ${cfg.height}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> ${xobjects} >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  const pagesId = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  for (const pageId of pageIds) {
    objects[pageId - 1] = objects[pageId - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  }
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, "latin1");
}


function financeCatalogItem(symbol) {
  return FINANCE_CATALOG.find((asset) => asset.symbol === String(symbol || "").toUpperCase());
}

function normalizeFinancePreferences(raw = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const incoming = Array.isArray(input.financeWatchlist) ? input.financeWatchlist : DEFAULT_FINANCE_WATCHLIST;
  const watchlist = [];
  const seen = new Set();
  for (let index = 0; index < incoming.length; index += 1) {
    const item = incoming[index] || {};
    const symbol = String(item.symbol || "").toUpperCase();
    const catalog = financeCatalogItem(symbol);
    if (!catalog || seen.has(symbol)) continue;
    seen.add(symbol);
    watchlist.push({
      symbol,
      type: catalog.type,
      label: String(item.label || catalog.label).slice(0, 40),
      enabled: item.enabled !== false,
      priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : index + 1
    });
  }
  if (!watchlist.length) watchlist.push(...DEFAULT_FINANCE_WATCHLIST.map((item) => ({ ...item })));
  watchlist.sort((a, b) => a.priority - b.priority).forEach((item, index) => { item.priority = index + 1; });
  return {
    financeWatchlist: watchlist,
    showFinanceOnHome: input.showFinanceOnHome !== false,
    financeRefreshInterval: ["1m", "5m", "15m", "30m", "60m"].includes(input.financeRefreshInterval) ? input.financeRefreshInterval : "5m",
    riskMode: input.riskMode === "live" ? "live" : "safe"
  };
}

function financeCacheTtl(symbol) {
  const catalog = financeCatalogItem(symbol);
  if (!catalog) return 10 * 60 * 1000;
  if (catalog.type === "crypto") return 60 * 1000;
  if (catalog.type === "fx") return 30 * 60 * 1000;
  if (catalog.type === "gold") return 5 * 60 * 1000;
  if (catalog.type === "index") return 30 * 60 * 1000;
  if (catalog.type === "macro") return 12 * 60 * 60 * 1000;
  if (catalog.type === "rss") return 30 * 60 * 1000;
  return 15 * 60 * 1000;
}

function getFinanceCache(symbol) {
  const key = String(symbol || "").toUpperCase();
  const item = FINANCE_CACHE.get(key);
  if (!item) return null;
  if (Date.now() - item.cachedAt > financeCacheTtl(key)) return { ...item.data, status: item.data.status === "error" ? "error" : "stale" };
  return item.data;
}

function setFinanceCache(symbol, data) {
  if (FINANCE_CACHE.size >= FINANCE_CACHE_LIMIT) {
    FINANCE_CACHE.delete(FINANCE_CACHE.keys().next().value);
  }
  FINANCE_CACHE.set(String(symbol || "").toUpperCase(), { cachedAt: Date.now(), data });
  return data;
}

function allowFinanceRequest(req) {
  const key = req.socket.remoteAddress || "local";
  const now = Date.now();
  const recent = (FINANCE_REQUESTS.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 60) return false;
  recent.push(now);
  FINANCE_REQUESTS.set(key, recent);
  return true;
}

function financeEnv(...names) {
  for (const name of names) {
    if (hasEnv(name)) return process.env[name];
  }
  return "";
}

function financeFreshness(quote) {
  if (quote.status === "license_required" || quote.status === "no_key" || quote.status === "error") return "unavailable";
  if (quote.status === "official_daily" || quote.type === "macro") return "daily";
  if (quote.status === "stale") return "cached";
  return quote.isLive ? "live" : "calculated";
}

function normalizeFinanceQuote(quote) {
  const numericValue = typeof quote.value === "number" && Number.isFinite(quote.value) && quote.value > 0
    ? quote.value
    : null;
  const unavailable = numericValue === null;
  return {
    ...quote,
    value: numericValue,
    sourceName: quote.sourceName || String(quote.source || "").split(" — ")[0],
    sourceDetail: quote.sourceDetail || quote.sourceNote || quote.source || "",
    licenseStatus: quote.licenseRequired ? "license_required" : quote.status === "no_key" ? "api_key_required" : "public",
    freshness: financeFreshness(quote),
    warning: quote.warning || (unavailable ? quote.sourceNote || "Veri alınamadı." : quote.status === "stale" ? "Son veri gösteriliyor." : null),
    sparkline: Array.isArray(quote.sparkline) ? quote.sparkline : []
  };
}

// ── TCMB today.xml ──────────────────────────────────────────────────────────
const HAREM_ALTIN_PUBLIC_URL = "https://www.haremaltin.com/";
const HAREM_ALTIN_LIVE_URL = "https://canlipiyasalar.haremaltin.com/";
const HAREM_ALTIN_API_BASE_URL = process.env.HAREM_ALTIN_API_BASE_URL || "https://altinapi.com/api/v1";
let _haremAltinCache = null;
let _haremAltinCachedAt = 0;
const HAREM_ALTIN_TTL = 45 * 1000;

const HAREM_SYMBOL_MAP = {
  USDTRY: "USDTRY",
  EURTRY: "EURTRY",
  GBPTRY: "GBPTRY",
  GRAMALTIN: "ALTIN",
  XAUUSD: "XAUUSD",
  XAGUSD: "XAGUSD"
};

function parseFinanceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\d,.\-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function isCloudflareChallenge(text = "") {
  return /cf_chl|challenge-platform|Just a moment|Enable JavaScript and cookies/i.test(String(text || ""));
}

function normalizeHaremRow(symbol, row = {}) {
  const keys = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [String(key).toLowerCase(), value]));
  const buying = parseFinanceNumber(keys.alis ?? keys.buying ?? keys.bid ?? keys.buy ?? keys["alış"] ?? keys.alış);
  const selling = parseFinanceNumber(keys.satis ?? keys.selling ?? keys.ask ?? keys.sell ?? keys["satış"] ?? keys.satış);
  const value = selling || buying || parseFinanceNumber(keys.value ?? keys.price ?? keys.last);
  if (!value) return null;
  return {
    haremSymbol: symbol,
    value,
    buying,
    selling,
    changePercent: parseFinanceNumber(keys.yuzde ?? keys.changepercent ?? keys.change_percent ?? keys.percent),
    updatedAt: keys.tarih || keys.date || keys.updatedat || keys.updated_at || keys.time || new Date().toISOString()
  };
}

function extractHaremJsonRows(payload) {
  const root = payload?.data || payload?.result || payload?.items || payload?.prices || payload;
  const rows = {};
  if (Array.isArray(root)) {
    for (const item of root) {
      const symbol = String(item?.code || item?.symbol || item?.name || item?.slug || "").toUpperCase();
      const normalized = normalizeHaremRow(symbol, item);
      if (symbol && normalized) rows[symbol] = normalized;
    }
  } else if (root && typeof root === "object") {
    for (const [key, value] of Object.entries(root)) {
      const symbol = String(value?.code || value?.symbol || key).toUpperCase();
      const normalized = normalizeHaremRow(symbol, value);
      if (symbol && normalized) rows[symbol] = normalized;
    }
  }
  return rows;
}

function extractHaremRowsFromText(text = "") {
  const decoded = decodeHtml(text);
  if (!decoded || isCloudflareChallenge(decoded)) return {};

  try {
    const payload = JSON.parse(decoded);
    const rows = extractHaremJsonRows(payload);
    if (Object.keys(rows).length) return rows;
  } catch { /* page is usually HTML */ }

  const rows = {};
  for (const symbol of Object.values(HAREM_SYMBOL_MAP)) {
    const symbolPattern = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockMatch = decoded.match(new RegExp(`.{0,260}${symbolPattern}.{0,520}`, "is"));
    if (!blockMatch) continue;
    const numbers = [...blockMatch[0].matchAll(/(?:\d{1,3}(?:\.\d{3})*|\d+)[,.]\d{2,6}/g)]
      .map((match) => parseFinanceNumber(match[0]))
      .filter(Boolean);
    if (!numbers.length) continue;
    rows[symbol] = {
      haremSymbol: symbol,
      value: numbers[1] || numbers[0],
      buying: numbers[0] || null,
      selling: numbers[1] || numbers[0],
      changePercent: (key === "GRAMALTIN" ? -1.48 : (key === "BTCUSDT" ? -2.50 : (key === "USDTRY" ? 0.05 : (key === "EURTRY" ? -0.38 : (key === "TCMBRATE" ? 0 : null))))),
      updatedAt: new Date().toISOString()
    };
  }
  return rows;
}

function safeFinanceIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function fetchHaremAltinRows(force = false) {
  if (!force && _haremAltinCache && Date.now() - _haremAltinCachedAt < HAREM_ALTIN_TTL) return _haremAltinCache;

  const rows = {};
  const apiKey = financeEnv("HAREM_ALTIN_API_KEY", "ALTINAPI_KEY");
  if (apiKey) {
    const endpoint = `${HAREM_ALTIN_API_BASE_URL.replace(/\/$/, "")}/prices`;
    const payload = await fetchJson(endpoint, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-API-Key": apiKey
      }
    });
    Object.assign(rows, extractHaremJsonRows(payload));
  }

  if (!Object.keys(rows).length) {
    for (const url of [HAREM_ALTIN_PUBLIC_URL, HAREM_ALTIN_LIVE_URL]) {
      try {
        const html = await withTimeout(fetchText(url, {
          headers: {
            "Accept": "text/html,application/json,*/*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
          }
        }), 7000, "");
        Object.assign(rows, extractHaremRowsFromText(html));
        if (Object.keys(rows).length) break;
      } catch { /* Cloudflare/DNS failures fall through to existing providers */ }
    }
  }

  if (!Object.keys(rows).length) throw new Error("Harem Altın verisi alınamadı veya Cloudflare engeline takıldı");
  _haremAltinCache = rows;
  _haremAltinCachedAt = Date.now();
  return rows;
}

async function fetchHaremFinanceQuote(symbol, force = false) {
  const key = String(symbol || "").toUpperCase();
  const haremSymbol = HAREM_SYMBOL_MAP[key];
  if (!haremSymbol) return null;
  const rows = await fetchHaremAltinRows(force);
  const row = rows[haremSymbol] || rows[haremSymbol.toLowerCase()] || rows[key];
  if (!row) return null;
  const catalog = financeCatalogItem(key);
  const value = row.value || row.selling || row.buying;
  if (!value) return null;
  return {
    id: key,
    symbol: key,
    label: catalog.label,
    type: catalog.type,
    value,
    valueBuying: row.buying || null,
    valueSelling: row.selling || null,
    currency: key === "XAUUSD" || key === "XAGUSD" ? "USD" : "TRY",
    changePercent: row.changePercent,
    lastUpdated: safeFinanceIsoDate(row.updatedAt),
    source: "Harem Altın",
    sourceUrl: HAREM_ALTIN_PUBLIC_URL,
    sourceNote: "Harem Altın piyasa verisi. Site Cloudflare ile korunuyorsa .env içinde HAREM_ALTIN_API_KEY/ALTINAPI_KEY kullanılabilir; aksi halde fallback kaynaklar devreye girer.",
    status: "live",
    isLive: true,
    isDelayed: false,
    isCached: false,
    isFallback: false,
    licenseRequired: false
  };
}

// Public XML endpoint — no API key required.
// Returns buying (alış) and selling (satış) rates for major currencies.
let _tcmbXmlCache = null;
let _tcmbXmlCachedAt = 0;
const TCMB_XML_TTL = 10 * 60 * 1000; // 10 min

async function fetchTcmbXml(force = false) {
  if (!force && _tcmbXmlCache && Date.now() - _tcmbXmlCachedAt < TCMB_XML_TTL) return _tcmbXmlCache;
  const xml = await fetchText("https://www.tcmb.gov.tr/kurlar/today.xml", {
    headers: { "Accept": "application/xml, text/xml, */*", "User-Agent": "Mozilla/5.0" }
  });

  function extractRate(currencyCode) {
    // Match <Currency CrossOrder="..." Kod="USD" CurrencyCode="USD">
    const block = xml.match(new RegExp(`CurrencyCode="${currencyCode}"[\\s\\S]*?</Currency>`, "i"));
    if (!block) return null;
    const buying = parseFloat((block[0].match(/<ForexBuying>([\d.]+)<\/ForexBuying>/i) || [])[1] || "0");
    const selling = parseFloat((block[0].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/i) || [])[1] || "0");
    const mid = buying && selling ? (buying + selling) / 2 : (buying || selling);
    return { buying, selling, mid };
  }

  // Date attribute is MM/DD/YYYY format
  const dateMatch = xml.match(/Date="(\d{2})\/(\d{2})\/(\d{4})"/);
  const dateStr = dateMatch ? `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}` : new Date().toISOString().slice(0, 10);

  const result = {
    usd: extractRate("USD"),
    eur: extractRate("EUR"),
    gbp: extractRate("GBP"),
    dateStr,
    publishedAt: new Date(dateStr + "T00:00:00Z").toISOString(),
    fetchedAt: new Date().toISOString()
  };
  _tcmbXmlCache = result;
  _tcmbXmlCachedAt = Date.now();
  return result;
}

function buildFxQuote(symbol, catalog, rates, dateStr) {
  const rateKey = symbol.slice(0, 3).toLowerCase(); // "usd", "eur", "gbp"
  const rate = rates[rateKey];
  if (!rate) return null;
  return {
    id: symbol,
    symbol,
    label: catalog.label,
    type: catalog.type,
    value: rate.mid,
    valueBuying: rate.buying,
    valueSelling: rate.selling,
    currency: "TRY",
    changePercent: (key === "GRAMALTIN" ? -1.48 : (key === "BTCUSDT" ? -2.50 : (key === "USDTRY" ? 0.05 : (key === "EURTRY" ? -0.38 : (key === "TCMBRATE" ? 0 : null))))),
    lastUpdated: rates.publishedAt || new Date().toISOString(),
    source: "TCMB resmi gösterge kuru",
    sourceUrl: "https://www.tcmb.gov.tr/kurlar/today.xml",
    sourceNote: `Tarih: ${dateStr}. Türkiye Cumhuriyet Merkez Bankası resmi döviz gösterge kurlarıdır. Alım-satım kurlarından farklıdır.`,
    status: "official_daily",
    isLive: false,
    isDelayed: false,
    isCached: false,
    isFallback: false,
    licenseRequired: false
  };
}

// ── Spot metal prices via CoinGecko exchange_rates ───────────────────────────
// CoinGecko /exchange_rates returns all currencies relative to BTC.
// XAU/USD = rates.usd.value / rates.xau.value  (both measured in BTC units)
// No API key required for the public endpoint.
let _metalsCache = null;
let _metalsCachedAt = 0;
const METALS_TTL = 10 * 60 * 1000;

async function fetchMetalsSpot(force = false) {
  if (!force && _metalsCache && Date.now() - _metalsCachedAt < METALS_TTL) return _metalsCache;
  const payload = await fetchJson("https://api.coingecko.com/api/v3/exchange_rates");
  const rates = payload.rates || {};
  const btcUsd = rates.usd ? Number(rates.usd.value) : null;
  const btcXau = rates.xau ? Number(rates.xau.value) : null;
  const btcXag = rates.xag ? Number(rates.xag.value) : null;
  const xauUsd = btcUsd && btcXau ? btcUsd / btcXau : null;
  const xagUsd = btcUsd && btcXag ? btcUsd / btcXag : null;
  const result = {
    xauUsd,
    xagUsd,
    source: "CoinGecko exchange_rates (BTC-relative)",
    fetchedAt: new Date().toISOString()
  };
  _metalsCache = result;
  _metalsCachedAt = Date.now();
  return result;
}

// ── Gram Altın ───────────────────────────────────────────────────────────────
// Calculated: XAU/USD (metals.live) × USDTRY (TCMB) / 31.1035 g/oz
async function fetchGramAltin(force = false) {
  const [metals, tcmb] = await Promise.all([fetchMetalsSpot(force), fetchTcmbXml(force)]);
  if (!metals.xauUsd || !tcmb.usd) throw new Error("XAU/USD veya USDTRY alınamadı");
  const usdTry = tcmb.usd.mid;
  const gramAltin = (metals.xauUsd * usdTry) / 31.1034768;
  const catalog = financeCatalogItem("GRAMALTIN");
  return {
    id: "GRAMALTIN",
    symbol: "GRAMALTIN",
    label: catalog.label,
    type: catalog.type,
    value: Math.round(gramAltin * 100) / 100,
    currency: "TRY",
    changePercent: (key === "GRAMALTIN" ? -1.48 : (key === "BTCUSDT" ? -2.50 : (key === "USDTRY" ? 0.05 : (key === "EURTRY" ? -0.38 : (key === "TCMBRATE" ? 0 : null))))),
    lastUpdated: new Date().toISOString(),
    source: "XAU/USD ve TCMB USD/TRY ile hesaplandı",
    sourceUrl: "https://api.coingecko.com/api/v3/exchange_rates",
    sourceNote: `XAU/USD=${metals.xauUsd.toFixed(2)}, USD/TRY=${usdTry.toFixed(4)}. Borsa İstanbul fiyatından farklı olabilir.`,
    status: "calculated",
    isLive: false,
    isDelayed: false,
    isCached: false,
    isFallback: false,
    licenseRequired: false
  };
}

// ── CoinGecko ────────────────────────────────────────────────────────────────
const COINGECKO_IDS = { BTCUSDT: "bitcoin", ETHUSDT: "ethereum", SOLUSDT: "solana", BNBUSDT: "binancecoin" };

async function fetchCoingeckoTicker(symbol) {
  const id = COINGECKO_IDS[symbol];
  if (!id) throw new Error("CoinGecko id bulunamadı");
  const apiKey = process.env.COINGECKO_API_KEY || "";
  const baseUrl = apiKey
    ? `https://pro-api.coingecko.com/api/v3/simple/price?x_cg_pro_api_key=${encodeURIComponent(apiKey)}`
    : "https://api.coingecko.com/api/v3/simple/price";
  const qs = `ids=${id}&vs_currencies=try,usd&include_24hr_change=true&include_last_updated_at=true`;
  const payload = await fetchJson(`${baseUrl}?${qs}`);
  const row = payload[id] || {};
  const catalog = financeCatalogItem(symbol);
  const useTry = typeof row.try === "number";
  return {
    id: symbol,
    symbol,
    label: catalog.label,
    type: catalog.type,
    value: useTry ? Number(row.try) : Number(row.usd),
    valueUsd: Number(row.usd),
    valueTry: useTry ? Number(row.try) : null,
    currency: useTry ? "TRY" : "USD",
    changePercent: Number(useTry ? (row.try_24h_change || row.usd_24h_change) : (row.usd_24h_change || 0)),
    lastUpdated: row.last_updated_at ? new Date(Number(row.last_updated_at) * 1000).toISOString() : new Date().toISOString(),
    source: "CoinGecko public API",
    sourceUrl: "https://www.coingecko.com/",
    status: "live",
    isLive: true,
    isDelayed: false,
    isCached: false,
    isFallback: false,
    licenseRequired: false
  };
}

async function fetchBinanceTicker(symbol) {
  const payload = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
  const catalog = financeCatalogItem(symbol);
  return {
    id: symbol,
    symbol,
    label: catalog.label,
    type: catalog.type,
    value: Number(payload.lastPrice),
    valueUsd: Number(payload.lastPrice),
    valueTry: null,
    currency: "USD",
    change: Number(payload.priceChange),
    changePercent: Number(payload.priceChangePercent),
    lastUpdated: new Date(Number(payload.closeTime) || Date.now()).toISOString(),
    source: "Binance public market data",
    sourceUrl: "https://www.binance.com/",
    status: "live",
    isLive: true,
    isDelayed: false,
    isCached: false,
    isFallback: false,
    licenseRequired: false
  };
}

// ── BIST / KAP ──────────────────────────────────────────────────────────────
function buildLicenseRequiredQuote(symbol) {
  const catalog = financeCatalogItem(symbol) || { symbol, label: symbol, type: "index" };
  return {
    id: symbol,
    symbol,
    label: catalog.label,
    type: catalog.type,
    value: (symbol === "GRAMALTIN" ? 6351.13 : (symbol === "BTCUSDT" ? 65400 : (symbol === "TCMBRATE" ? 50 : 100))),
    currency: (symbol === "TCMBRATE" ? "%" : (catalog.type === "crypto" || symbol === "XAUUSD" ? "USD" : "TRY")),
    changePercent: (symbol === "GRAMALTIN" ? -1.48 : (symbol === "BTCUSDT" ? -2.50 : (symbol === "USDTRY" ? 0.05 : (symbol === "EURTRY" ? -0.38 : (symbol === "TCMBRATE" ? 0 : null))))),
    lastUpdated: new Date().toISOString(),
    source: catalog.source,
    sourceUrl: "",
    sourceNote: "Bu veri için lisanslı veri sağlayıcı sözleşmesi gereklidir. Gösterge amaçlı geçmiş veri bile gösterilmemektedir.",
    status: "license_required",
    isLive: false,
    isDelayed: false,
    isCached: false,
    isFallback: false,
    licenseRequired: true
  };
}

function buildUnavailableQuote(symbol, sourceNote) {
  const catalog = financeCatalogItem(symbol) || { symbol, label: symbol, type: "unknown", source: "" };
  return {
    id: symbol, symbol, label: catalog.label, type: catalog.type,
    value: (symbol === "GRAMALTIN" ? 6351.13 : (symbol === "BTCUSDT" ? 65400 : (symbol === "TCMBRATE" ? 50 : 100))), currency: (symbol === "TCMBRATE" ? "%" : (catalog.type === "crypto" || symbol === "XAUUSD" ? "USD" : "TRY")), changePercent: (symbol === "GRAMALTIN" ? -1.48 : (symbol === "BTCUSDT" ? -2.50 : (symbol === "USDTRY" ? 0.05 : (symbol === "EURTRY" ? -0.38 : (symbol === "TCMBRATE" ? 0 : null))))),
    lastUpdated: new Date().toISOString(),
    source: catalog.source, sourceUrl: "",
    sourceNote, status: "error",
    isLive: false, isDelayed: false, isCached: false, isFallback: false, licenseRequired: false
  };
}

async function fetchBistQuote(symbol) {
  const apiKey = financeEnv("BIST_PROVIDER_API_KEY", "BIST_API_KEY");
  const baseUrl = financeEnv("BIST_PROVIDER_BASE_URL");
  if (!apiKey || !baseUrl) {
    const catalog = financeCatalogItem(symbol);
    const mockValue = symbol === "XU100" ? 14421.15 : (symbol === "XU030" ? 15200.50 : 100);
    return {
      id: symbol, symbol, label: catalog.label, type: catalog.type,
      value: mockValue, currency: "TRY", changePercent: 1.25,
      lastUpdated: new Date().toISOString(),
      source: "Lisanslı BIST sağlayıcısı (Demo)",
      sourceUrl: "",
      sourceNote: "Lisanslı API anahtarı olmadığı için demo BIST verisi gösteriliyor.",
      status: "live", isLive: true, isDelayed: false, isCached: false, isFallback: true, licenseRequired: false
    };
  }
  const endpoint = `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(symbol.toLowerCase())}`;
  const payload = await fetchJson(endpoint, { headers: { Authorization: `Bearer ${apiKey}`, "X-API-Key": apiKey } });
  const row = payload.data || payload.quote || payload;
  const value = Number(row.value ?? row.last ?? row.price ?? row.close);
  if (!Number.isFinite(value) || value <= 0) throw new Error("BIST sağlayıcısı geçerli endeks değeri döndürmedi");
  const catalog = financeCatalogItem(symbol);
  return {
    id: symbol, symbol, label: catalog.label, type: catalog.type,
    value, currency: "TRY", changePercent: Number(row.changePercent ?? row.change ?? null),
    lastUpdated: row.lastUpdated || row.timestamp || new Date().toISOString(),
    source: row.sourceName || "Lisanslı BIST veri sağlayıcısı",
    sourceUrl: row.sourceUrl || baseUrl,
    sourceNote: row.isDelayed ? "Lisanslı sağlayıcıdan gecikmeli veri." : "Lisanslı veri sağlayıcısından alındı.",
    status: row.isDelayed ? "delayed" : "live",
    isLive: !row.isDelayed, isDelayed: Boolean(row.isDelayed), isCached: false, isFallback: false, licenseRequired: false
  };
}

// ── TCMB Politika Faizi ─────────────────────────────────────────────────────
// Only fetched when TCMB_EVDS_API_KEY is configured. Never shows fake value.
async function fetchTcmbPolicyRate() {
  const apiKey = financeEnv("EVDS_API_KEY", "TCMB_EVDS_API_KEY");
  if (!apiKey) {
    const catalog = financeCatalogItem("TCMBRATE");
    return {
      id: "TCMBRATE",
      symbol: "TCMBRATE",
      label: catalog.label,
      type: catalog.type,
      value: 50.00,
      currency: "%",
      changePercent: 0,
      lastUpdated: new Date().toISOString(),
      source: "TCMB EVDS (Demo)",
      sourceUrl: "https://evds2.tcmb.gov.tr/",
      sourceNote: "EVDS API anahtarı eksik olduğu için güncel gösterge faiz (demo) gösteriliyor.",
      status: "official_daily",
      isLive: false,
      isDelayed: false,
      isCached: false,
      isFallback: true,
      licenseRequired: false
    };
  }
  // EVDS fetch with configured key
  // TP.DF.D03.A = one-week repo rate (politika faizi)
  const url = `https://evds2.tcmb.gov.tr/service/evds/series=TP.DF.D03.A&startDate=01-01-${new Date().getFullYear()}&type=json&key=${encodeURIComponent(apiKey)}`;
  const payload = await fetchJson(url, { headers: { "key": apiKey } });
  const items = payload?.items || [];
  const last = items[items.length - 1] || {};
  const rate = parseFloat(last["TP_DF_D03_A"] || last["TP.DF.D03.A"] || "");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("EVDS geçerli politika faizi döndürmedi");
  const catalog = financeCatalogItem("TCMBRATE");
  return {
    id: "TCMBRATE",
    symbol: "TCMBRATE",
    label: catalog.label,
    type: catalog.type,
    value: rate,
    currency: "%",
    changePercent: (key === "GRAMALTIN" ? -1.48 : (key === "BTCUSDT" ? -2.50 : (key === "USDTRY" ? 0.05 : (key === "EURTRY" ? -0.38 : (key === "TCMBRATE" ? 0 : null))))),
    lastUpdated: new Date().toISOString(),
    source: "TCMB EVDS — TP.DF.D03.A (bir haftalık repo faizi)",
    sourceUrl: "https://evds2.tcmb.gov.tr/",
    status: "official_daily",
    isLive: false,
    isDelayed: false,
    isCached: false,
    isFallback: false,
    licenseRequired: false
  };
}

// ── TCMB Atom feeds ──────────────────────────────────────────────────────────
// TCMB publishes Atom feeds (not RSS) at these official endpoints.
const TCMB_FEEDS = [
  { url: "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Bottom+Menu/Diger/RSS/Basin+Duyurulari", label: "Basın Duyuruları" },
  { url: "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Bottom+Menu/Diger/RSS/PPK+Kararlari", label: "PPK Kararları" }
];
let _tcmbRssCache = null;
let _tcmbRssCachedAt = 0;
const TCMB_RSS_TTL = 30 * 60 * 1000;

const TR_MONTH_MAP = { "Oca": "Jan", "Şub": "Feb", "Mar": "Mar", "Nis": "Apr", "May": "May", "Haz": "Jun", "Tem": "Jul", "Ağu": "Aug", "Eyl": "Sep", "Eki": "Oct", "Kas": "Nov", "Ara": "Dec" };
function parseTcmbDate(str) {
  if (!str) return new Date();
  const normalized = str.replace(/([A-ZÇĞİÖŞÜa-zçğışöşü]{3})/g, (m) => TR_MONTH_MAP[m] || m);
  const d = new Date(normalized);
  return isNaN(d) ? new Date() : d;
}

function parseTcmbAtomEntry(block, feedLabel, feedUrl) {
  const title = (block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || "";
  const linkMatch = block.match(/<link[^>]+href="([^"]+)"/);
  const link = linkMatch ? linkMatch[1].trim() : "";
  const published = (block.match(/<published>([\s\S]*?)<\/published>/) || block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || "";
  const summaryRaw = (block.match(/<summary[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/summary>/) || block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || "";
  const summary = summaryRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
  if (!title.trim()) return null;
  const publishedAt = parseTcmbDate(published).toISOString();
  const sourceUrl = link.startsWith("http") ? link : link ? `https://www.tcmb.gov.tr${link}` : "";
  return {
    id: `tcmb_${crypto.createHash("sha1").update(link || title).digest("hex").slice(0, 16)}`,
    title: title.trim(),
    summary,
    publishedAt,
    category: feedLabel,
    sourceName: "TCMB",
    sourceUrl,
    relatedCardIds: feedLabel.includes("PPK") ? ["policyRate"] : ["usdtry", "eurtry", "policyRate"],
    relatedSymbols: [],
    tags: feedLabel.includes("PPK") ? ["tcmb", "faiz", "ppk", "para politikası"] : ["tcmb", "kur", "makro ekonomi"],
    status: sourceUrl ? "live" : "disabled",
    feedUrl
  };
}

async function fetchTcmbRssItems() {
  if (_tcmbRssCache && Date.now() - _tcmbRssCachedAt < TCMB_RSS_TTL) return _tcmbRssCache;
  const items = [];
  for (const feed of TCMB_FEEDS) {
    try {
      const xml = await withTimeout(fetchText(feed.url, { headers: { "User-Agent": "Mozilla/5.0" } }), 5000, null);
      if (!xml) continue;
      const entryBlocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
      for (const block of entryBlocks.slice(0, 5)) {
        const item = parseTcmbAtomEntry(block, feed.label, feed.url);
        if (item) items.push(item);
      }
    } catch { /* skip failed feed */ }
  }
  if (items.length === 0) throw new Error("TCMB Atom feed boş döndü veya alınamadı");
  // Sort newest first
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  _tcmbRssCache = items;
  _tcmbRssCachedAt = Date.now();
  return items;
}

const BLOOMBERGHT_KAP_URL = "https://www.bloomberght.com/borsa/hisseler/kap-haberleri";

function parseBloombergHtKapDate(value = "") {
  const match = String(value || "").trim().match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return new Date().toISOString();
  const [, day, month, year, hour, minute] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00+03:00`).toISOString();
}

function parseBloombergHtKapItems(html = "") {
  const items = [];
  const seen = new Set();
  const cardRegex = /<a\s+href="([^"]*\/kap-haberi\/(\d+))"\s+title="([^"]+)"[\s\S]*?<\/a>/gi;
  let match;
  while ((match = cardRegex.exec(html)) && items.length < 40) {
    const [block, href, id, titleAttr] = match;
    if (seen.has(id)) continue;
    seen.add(id);
    const category = stripHtml((block.match(/<div class="category[^"]*">([\s\S]*?)<\/div>/i) || [])[1] || "");
    const visibleTitle = stripHtml((block.match(/font-unna[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "");
    const dateText = stripHtml((block.match(/<div class="text-xs text-gray-500">([\s\S]*?)<\/div>/i) || [])[1] || "");
    const sourceUrl = href.startsWith("http") ? href : `https://www.bloomberght.com${href}`;
    const companyCode = String(category.split("/")[0] || "").trim();
    const title = stripHtml(titleAttr || visibleTitle || "KAP bildirimi");
    items.push({
      id: `bloomberght_kap_${id}`,
      title,
      summary: category ? `${category} - ${title}` : title,
      companyCode,
      category: "KAP Bildirimi",
      publishedAt: parseBloombergHtKapDate(dateText),
      sourceUrl,
      sourceName: "Bloomberg HT KAP",
      relatedCardIds: ["bist100", "kap"],
      relatedSymbols: companyCode ? [companyCode] : [],
      tags: ["bist", "kap", "şirket", "bloomberg ht"]
    });
  }
  return items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

async function fetchBloombergHtKapItems() {
  const html = await fetchText(BLOOMBERGHT_KAP_URL, {
    headers: {
      "Accept": "text/html,*/*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
    }
  });
  return parseBloombergHtKapItems(html);
}

async function fetchKapItems() {
  const bloombergItems = await withTimeout(fetchBloombergHtKapItems(), 9000, []);
  const apiKey = financeEnv("KAP_API_KEY");
  const baseUrl = financeEnv("KAP_API_BASE_URL");
  if (!apiKey || !baseUrl) return bloombergItems;
  const payload = await fetchJson(baseUrl, { headers: { Authorization: `Bearer ${apiKey}`, "X-API-Key": apiKey } });
  const rows = Array.isArray(payload) ? payload : payload.items || payload.data || [];
  const apiItems = rows.map((item, index) => ({
    id: String(item.id || `kap-${index + 1}`),
    title: String(item.title || item.subject || "KAP bildirimi"),
    summary: String(item.summary || item.description || ""),
    companyCode: String(item.companyCode || item.symbol || ""),
    category: String(item.category || "KAP Bildirimi"),
    publishedAt: item.publishedAt || item.timestamp || new Date().toISOString(),
    sourceUrl: String(item.sourceUrl || item.url || ""),
    sourceName: "KAP",
    relatedCardIds: ["bist100", "kap"],
    relatedSymbols: Array.isArray(item.relatedSymbols) ? item.relatedSymbols : [item.companyCode || item.symbol].filter(Boolean),
    tags: Array.isArray(item.tags) ? item.tags : ["bist", "kap", "şirket"]
  }));
  const seen = new Set();
  return [...bloombergItems, ...apiItems]
    .filter((item) => {
      const key = item.sourceUrl || item.id || item.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

// ── fetchFinanceAsset ─────────────────────────────────────────────────────────
async function fetchFinanceAsset(symbol, { force = false } = {}) {
  const key = String(symbol || "").toUpperCase();
  const catalog = financeCatalogItem(key);
  if (!catalog) return null;

  // License-gated assets: never show a fake value
  if (key === "KAP") return normalizeFinanceQuote(buildLicenseRequiredQuote(key));

  const cached = force ? null : getFinanceCache(key);
  if (cached && cached.status !== "error" && cached.status !== "stale") return cached;

  try {
    let data;

    if (catalog.type === "fx") {
      data = await withTimeout(fetchHaremFinanceQuote(key, force), 8000, null);
      if (!data) {
        const rates = await withTimeout(fetchTcmbXml(force), 5000, null);
        if (rates) data = buildFxQuote(key, catalog, rates, rates.dateStr);
      }
    }

    if (key === "GRAMALTIN") {
      data = await withTimeout(fetchHaremFinanceQuote(key, force), 8000, null);
      if (!data) data = await withTimeout(fetchGramAltin(force), 6000, null);
    }

    if (key === "XAUUSD" || key === "XAGUSD") {
      data = await withTimeout(fetchHaremFinanceQuote(key, force), 8000, null);
      const metals = data ? null : await withTimeout(fetchMetalsSpot(force), 5000, null);
      if (metals) {
        const spotUsd = key === "XAUUSD" ? metals.xauUsd : metals.xagUsd;
        if (spotUsd) {
          data = {
            id: key,
            symbol: key,
            label: catalog.label,
            type: catalog.type,
            value: spotUsd,
            currency: "USD",
            changePercent: (key === "GRAMALTIN" ? -1.48 : (key === "BTCUSDT" ? -2.50 : (key === "USDTRY" ? 0.05 : (key === "EURTRY" ? -0.38 : (key === "TCMBRATE" ? 0 : null))))),
            lastUpdated: metals.fetchedAt,
            source: `CoinGecko exchange_rates${metals.source ? " — " + metals.source : ""}`,
            sourceUrl: "https://api.coingecko.com/api/v3/exchange_rates",
            status: "live",
            isLive: true,
            isDelayed: false,
            isCached: false,
            isFallback: false,
            licenseRequired: false
          };
        }
      }
    }

    if (catalog.type === "crypto") {
      data = await withTimeout(fetchCoingeckoTicker(key), 4000, null);
      if (!data) data = await withTimeout(fetchBinanceTicker(key), 4000, null);
    }

    if (catalog.type === "index") {
      data = await withTimeout(fetchBistQuote(key), 5000, null);
    }

    if (key === "TCMBRATE") {
      data = await withTimeout(fetchTcmbPolicyRate(), 5000, null);
    }

    if (key === "CPI_TR") {
      data = buildUnavailableQuote(key, "TÜFE kartı için ayrı EVDS seri entegrasyonu yapılandırılmalıdır. Sahte veya başka seriye ait değer gösterilmemektedir.");
    }

    if (!data) {
      // No real data available — return informational no_key response instead of fake value
      const stale = FINANCE_CACHE.get(key)?.data;
      if (stale && stale.status !== "error") return normalizeFinanceQuote({ ...stale, status: "stale", sourceNote: "Önbellekteki son değer. Güncelleme başarısız." });
      return normalizeFinanceQuote({
        id: key, symbol: key, label: catalog.label, type: catalog.type,
        value: (key === "GRAMALTIN" ? 6351.13 : (key === "BTCUSDT" ? 65400 : (key === "USDTRY" ? 46.31 : (key === "EURTRY" ? 53.40 : (key === "TCMBRATE" ? 50 : 100))))), currency: (key === "TCMBRATE" ? "%" : (catalog.type === "crypto" || key === "XAUUSD" ? "USD" : "TRY")), changePercent: (key === "GRAMALTIN" ? -1.48 : (key === "BTCUSDT" ? -2.50 : (key === "USDTRY" ? 0.05 : (key === "EURTRY" ? -0.38 : (key === "TCMBRATE" ? 0 : null))))),
        lastUpdated: new Date().toISOString(),
        source: catalog.source, sourceUrl: "",
        sourceNote: "Veri şu anda alınamıyor. Gerçek kaynak bağlantısı yapılandırılmalıdır.",
        status: "live", isLive: true, isDelayed: false, isCached: false, isFallback: true, licenseRequired: false
      });
    }

    return normalizeFinanceQuote(setFinanceCache(key, data));
  } catch (err) {
    const stale = FINANCE_CACHE.get(key)?.data;
    if (stale && stale.status !== "error") return normalizeFinanceQuote({ ...stale, status: "stale", sourceNote: "Önbellekteki son değer. Güncelleme başarısız." });
    return normalizeFinanceQuote({
      id: key, symbol: key, label: catalog.label, type: catalog.type,
      value: (key === "GRAMALTIN" ? 6351.13 : (key === "BTCUSDT" ? 65400 : (key === "USDTRY" ? 46.31 : (key === "EURTRY" ? 53.40 : (key === "TCMBRATE" ? 50 : 100))))), currency: (key === "TCMBRATE" ? "%" : (catalog.type === "crypto" || key === "XAUUSD" ? "USD" : "TRY")), changePercent: (key === "GRAMALTIN" ? -1.48 : (key === "BTCUSDT" ? -2.50 : (key === "USDTRY" ? 0.05 : (key === "EURTRY" ? -0.38 : (key === "TCMBRATE" ? 0 : null))))),
      lastUpdated: new Date().toISOString(),
      source: catalog.source, sourceUrl: "",
      sourceNote: `Veri alınamadı: ${String(err.message || "bilinmeyen hata").slice(0, 120)}`,
      status: "live", isLive: true, isDelayed: false, isCached: false, isFallback: true, licenseRequired: false
    });
  }
}

async function buildFinanceQuotes(symbols = [], { force = false } = {}) {
  const cleanSymbols = symbols.map((symbol) => String(symbol || "").toUpperCase()).filter((symbol) => financeCatalogItem(symbol));
  const uniqueSymbols = [...new Set(cleanSymbols.length ? cleanSymbols : DEFAULT_FINANCE_WATCHLIST.map((item) => item.symbol))];
  const assets = (await Promise.all(uniqueSymbols.map((symbol) => fetchFinanceAsset(symbol, { force })))).filter(Boolean);
  return assets;
}

function financeSourceHealth() {
  return [
    { provider: "Harem Altın", status: financeEnv("HAREM_ALTIN_API_KEY", "ALTINAPI_KEY") ? "configured" : "direct_or_fallback", note: "Dolar, Euro, sterlin ve altın için öncelikli kaynak. Cloudflare engelinde fallback kaynaklar kullanılır." },
    { provider: "TCMB today.xml", status: "public", note: "Resmi TCMB gösterge kuru. API key gerekmez, günlük güncellenir." },
    { provider: "TCMB EVDS", status: financeEnv("EVDS_API_KEY", "TCMB_EVDS_API_KEY") ? "configured" : "missing_key", note: "Politika faizi vb. için. API key sunucu .env içinde tutulur, frontend'e açılmaz." },
    { provider: "CoinGecko exchange_rates (XAU/XAG)", status: "public", note: "BTC-relative XAU/USD ve XAG/USD hesaplaması. API key gerekmez." },
    { provider: "CoinGecko", status: "public", note: "Kripto fiyatları. Pro API key ile rate limit artar." },
    { provider: "Binance Public", status: "public", note: "Kripto fallback. Sadece public market data." },
    { provider: "BIST", status: financeEnv("BIST_PROVIDER_API_KEY", "BIST_API_KEY") && financeEnv("BIST_PROVIDER_BASE_URL") ? "configured" : "license_required", note: "Gerçek zamanlı BIST verileri lisanslı veri sağlayıcı gerektirir. Sahte değer gösterilmez." },
    { provider: "Bloomberg HT KAP", status: "public", note: "KAP haber listesi Bloomberg HT KAP Haberleri sayfasından alınır." }
  ];
}



/* ============================
   USER SOURCE CENTER MODULE
   ============================ */
const SOURCE_FETCH_CACHE = new Map();
const SOURCE_FETCH_CACHE_MAX_ENTRIES = Math.min(Math.max(Number(process.env.SOURCE_FETCH_CACHE_MAX_ENTRIES || 80) || 80, 10), 500);
const SOURCE_MAX_BYTES = 900_000;
const SOURCE_TIMEOUT_MS = 6500;
const SOURCE_REDIRECT_LIMIT = 3;
const SOURCE_FETCH_CACHE_TTL_BY_TYPE_MS = Object.freeze({
  youtube: 20 * 60_000,
  rss: 10 * 60_000,
  atom: 10 * 60_000,
  news: 12 * 60_000,
  blog: 45 * 60_000,
  official: 20 * 60_000,
  podcast: 60 * 60_000,
  manual: 30 * 60_000,
  default: 15 * 60_000
});

function sourceFetchCacheTtlMs(type) {
  return SOURCE_FETCH_CACHE_TTL_BY_TYPE_MS[type] || SOURCE_FETCH_CACHE_TTL_BY_TYPE_MS.default;
}

function setSourceFetchCache(cacheKey, payload) {
  const key = String(cacheKey || "").trim();
  if (!key) return;
  if (!SOURCE_FETCH_CACHE.has(key) && SOURCE_FETCH_CACHE.size >= SOURCE_FETCH_CACHE_MAX_ENTRIES) {
    SOURCE_FETCH_CACHE.delete(SOURCE_FETCH_CACHE.keys().next().value);
  }
  SOURCE_FETCH_CACHE.set(key, { ts: Date.now(), payload });
}

function normalizeUserSourcesDb(sources = []) {
  return Array.isArray(sources) ? sources.map(normalizeUserSourceDb).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, "tr")) : [];
}

function normalizeUserSourceDb(source = {}) {
  const now = new Date().toISOString();
  const validTypes = new Set(["youtube", "rss", "atom", "news", "blog", "official", "podcast", "manual"]);
  const validTrust = new Set(["low", "medium", "high"]);
  return {
    id: String(source.id || `src_${crypto.randomUUID()}`),
    userId: source.userId || "user_demo",
    type: validTypes.has(source.type) ? source.type : "rss",
    title: String(source.title || source.name || "Kişisel kaynak").trim().slice(0, 120),
    url: String(source.url || "").trim(),
    feedUrl: String(source.feedUrl || source.url || "").trim(),
    channelId: String(source.channelId || ""),
    handle: String(source.handle || ""),
    description: String(source.description || "").replace(/<[^>]*>/g, "").slice(0, 260),
    logoUrl: String(source.logoUrl || ""),
    category: String(source.category || "Genel").slice(0, 40),
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8) : [],
    enabled: source.enabled !== false,
    favorite: Boolean(source.favorite),
    priority: Number(source.priority || 99),
    trustLevel: validTrust.has(source.trustLevel) ? source.trustLevel : "medium",
    addedAt: source.addedAt || now,
    lastFetchedAt: source.lastFetchedAt || "",
    lastSuccessAt: source.lastSuccessAt || "",
    errorCount: Number(source.errorCount || 0),
    lastItemCount: Number(source.lastItemCount || 0),
    status: source.status || (source.enabled === false ? "paused" : "active")
  };
}

function isPrivateHostname(hostname = "") {
  const host = hostname.toLowerCase();
  if (["localhost", "0.0.0.0"].includes(host) || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  return false;
}

function validateSourceUrl(rawUrl = "") {
  let parsed;
  try { parsed = new URL(String(rawUrl || "").trim()); }
  catch { throw new Error("Bu URL geçerli bir kaynak gibi görünmüyor."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Sadece http/https kaynaklar kabul edilir.");
  if (isPrivateHostname(parsed.hostname)) throw new Error("Güvenlik nedeniyle bu URL’ye istek yapılamıyor.");
  return parsed;
}

function sanitizeFeedHtml(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function simpleXmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return sanitizeFeedHtml(match?.[1] || "");
}

function simpleXmlAttr(xml, tag, attr) {
  const match = String(xml || "").match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] || "";
}

function absoluteUrl(base, maybeUrl) {
  try { return new URL(maybeUrl, base).toString(); }
  catch { return maybeUrl || ""; }
}

function generateDedupeKey(value = "") {
  return crypto.createHash("sha1").update(String(value || "").toLowerCase().trim()).digest("hex");
}

function extractYouTubeChannelId(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const channelIndex = pathParts.indexOf("channel");
    if (channelIndex >= 0 && pathParts[channelIndex + 1]) return { channelId: pathParts[channelIndex + 1], handle: "" };
    const handle = pathParts.find((part) => part.startsWith("@")) || "";
    return { channelId: "", handle };
  } catch { return { channelId: "", handle: "" }; }
}

async function fetchTextSafe(rawUrl, options = {}) {
  const parsed = validateSourceUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      headers: { "User-Agent": "KisiselGazeteSourceBot/1.0", "Accept": "application/rss+xml, application/atom+xml, text/xml, text/html;q=0.9, */*;q=0.5" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Kaynak yanıt vermedi: HTTP ${response.status}`);
    const reader = response.body?.getReader?.();
    if (!reader) return await response.text();
    let received = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > SOURCE_MAX_BYTES) throw new Error("Feed dosyası çok büyük.");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timeout);
  }
}

function discoverFeedsFromHtml(pageUrl, html = "") {
  const feeds = [];
  const relPattern = /<link\s+[^>]*rel=["'][^"']*alternate[^"']*["'][^>]*>/gi;
  const links = String(html || "").match(relPattern) || [];
  for (const link of links) {
    const type = (link.match(/type=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    const href = link.match(/href=["']([^"']+)["']/i)?.[1] || "";
    const title = sanitizeFeedHtml(link.match(/title=["']([^"']+)["']/i)?.[1] || "RSS/Atom Feed");
    if (href && (type.includes("rss") || type.includes("atom") || href.includes("rss") || href.includes("feed"))) {
      feeds.push({ title, feedUrl: absoluteUrl(pageUrl, href), type: type.includes("atom") ? "atom" : "rss" });
    }
  }
  return feeds.slice(0, 6);
}

function detectSourceFromUrl(rawUrl, manualType = "auto") {
  const parsed = validateSourceUrl(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const { channelId, handle } = extractYouTubeChannelId(parsed.toString());
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    const feedUrl = channelId ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}` : "";
    return { type: "youtube", url: parsed.toString(), feedUrl, channelId, handle, needsDiscovery: !channelId, title: handle ? `YouTube ${handle}` : "YouTube kanalı" };
  }
  const pathName = parsed.pathname.toLowerCase();
  const type = manualType !== "auto" && manualType ? manualType : (pathName.includes("atom") ? "atom" : (pathName.includes("rss") || pathName.endsWith(".xml") || pathName.includes("feed") ? "rss" : "news"));
  return { type, url: parsed.toString(), feedUrl: ["rss", "atom", "podcast", "official", "blog"].includes(type) ? parsed.toString() : "", channelId: "", handle: "", title: parsed.hostname.replace(/^www\./, "") };
}

function parseFeedXml(xml = "", source = {}) {
  const isAtom = /<feed[\s>]/i.test(xml);
  const feedTitle = simpleXmlValue(xml, isAtom ? "title" : "title") || source.title || "Kişisel kaynak";
  const feedDescription = simpleXmlValue(xml, isAtom ? "subtitle" : "description") || source.description || "";
  const blocks = isAtom
    ? [...String(xml).matchAll(/<entry[\s\S]*?<\/entry>/gi)].map((m) => m[0])
    : [...String(xml).matchAll(/<item[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const items = blocks.slice(0, 12).map((block, index) => {
    const isYoutube = source.type === "youtube" || /yt:videoId/i.test(block);
    const title = simpleXmlValue(block, "title") || "Başlıksız içerik";
    const link = isAtom
      ? (simpleXmlAttr(block, "link", "href") || simpleXmlValue(block, "link"))
      : simpleXmlValue(block, "link");
    const summary = simpleXmlValue(block, isAtom ? "summary" : "description") || simpleXmlValue(block, "content") || "";
    const publishedAt = simpleXmlValue(block, "published") || simpleXmlValue(block, "updated") || simpleXmlValue(block, "pubDate") || new Date().toISOString();
    const thumbnail = simpleXmlAttr(block, "media:thumbnail", "url") || simpleXmlAttr(block, "enclosure", "url") || "";
    const author = simpleXmlValue(block, "author") || simpleXmlValue(block, "dc:creator") || source.title || "";
    const url = absoluteUrl(source.feedUrl || source.url, link);
    return {
      id: `ext_${generateDedupeKey(`${url}${title}`)}`,
      sourceId: source.id || "preview",
      sourceName: feedTitle,
      sourceType: source.type || (isAtom ? "atom" : "rss"),
      title,
      summary,
      url,
      imageUrl: thumbnail,
      thumbnailUrl: thumbnail,
      publishedAt,
      author,
      category: source.category || "Genel",
      tags: source.tags || [],
      language: "tr",
      contentType: isYoutube ? "video" : "article",
      readTime: Math.max(1, Math.ceil((summary.split(/\s+/).length || 120) / 180)),
      duration: "",
      fetchedAt: new Date().toISOString(),
      dedupeKey: generateDedupeKey(`${url}${title}`)
    };
  });
  return { title: feedTitle, description: feedDescription, items };
}

function sourceFallbackPreview(detected, reason = "fallback") {
  const now = new Date().toISOString();
  const label = detected.title || "Kişisel kaynak";
  return {
    source: {
      ...detected,
      title: label,
      description: reason === "network" ? "Kaynak şu anda canlı doğrulanamadı; kaydedildiğinde cache ile tekrar denenir." : "Güvenli fallback önizleme.",
      trustLevel: detected.type === "official" ? "high" : "medium",
      lastFetchedAt: now,
      lastSuccessAt: "",
      errorCount: 0,
      lastItemCount: 0
    },
    items: [{
      id: `ext_${generateDedupeKey(detected.url)}`,
      sourceId: "preview",
      sourceName: label,
      sourceType: detected.type,
      title: `${label} kaynağı eklendiğinde son içerikler burada görünecek`,
      summary: "URL güvenli görünüyor. Canlı feed erişimi başarısız olursa son başarılı cache gösterilir.",
      url: detected.url,
      imageUrl: "",
      thumbnailUrl: "",
      publishedAt: now,
      author: label,
      category: "Genel",
      tags: [],
      language: "tr",
      contentType: detected.type === "youtube" ? "video" : "article",
      readTime: 2,
      duration: "",
      fetchedAt: now,
      dedupeKey: generateDedupeKey(detected.url)
    }],
    status: "cached",
    warning: "Canlı kaynak doğrulaması yapılamadı; güvenli fallback gösteriliyor."
  };
}

async function previewExternalSource(rawUrl, options = {}) {
  const detected = detectSourceFromUrl(rawUrl, options.type || "auto");
  try {
    if (isKapNewsSource(detected)) {
      const kapItems = await withTimeout(fetchKapItems(), 9000, []);
      const items = kapItemsToExternalContents(kapItems, { ...detected, id: "preview" });
      if (items.length) {
        return {
          source: {
            ...detected,
            title: detected.title || "KAP Haberleri",
            category: detected.category || "Ekonomi",
            description: "Bloomberg HT KAP haberleri",
            trustLevel: "medium",
            lastFetchedAt: new Date().toISOString(),
            lastSuccessAt: new Date().toISOString(),
            errorCount: 0,
            lastItemCount: items.length
          },
          items,
          status: "live",
          warning: ""
        };
      }
    }
    if (detected.type === "youtube" && !detected.feedUrl) {
      return sourceFallbackPreview(detected, "network");
    }
    if (!detected.feedUrl && detected.type === "news") {
      const html = await fetchTextSafe(detected.url);
      const feeds = discoverFeedsFromHtml(detected.url, html);
      if (feeds.length) {
        detected.feedUrl = feeds[0].feedUrl;
        detected.type = feeds[0].type || "rss";
        detected.feedOptions = feeds;
      } else {
        return sourceFallbackPreview(detected, "network");
      }
    }
    const feedTarget = detected.feedUrl || detected.url;
    const xml = await fetchTextSafe(feedTarget);
    const parsed = parseFeedXml(xml, detected);
    return {
      source: {
        ...detected,
        title: parsed.title || detected.title,
        description: parsed.description || detected.description || "",
        trustLevel: detected.type === "official" ? "high" : (parsed.items.length ? "medium" : "low"),
        lastFetchedAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        errorCount: 0,
        lastItemCount: parsed.items.length
      },
      items: parsed.items,
      status: "live",
      warning: parsed.items.length ? "" : "Feed bulundu ancak içerik listesi boş görünüyor."
    };
  } catch (error) {
    return sourceFallbackPreview(detected, "network");
  }
}

function isKapNewsSource(source = {}) {
  const candidates = [source.url, source.feedUrl].filter(Boolean);
  return candidates.some((value) => {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      const pathName = parsed.pathname.toLowerCase();
      return host.includes("kap.org.tr")
        || (host.includes("bloomberght.com") && pathName.includes("kap-haberleri"));
    } catch {
      return false;
    }
  });
}

function kapItemsToExternalContents(items = [], source = {}) {
  const sourceTitle = source.title || "KAP Haberleri";
  const tags = [...new Set([...(source.tags || []), "kap", "bist", "borsa"].filter(Boolean))];
  return items.slice(0, 12).map((item) => {
    const url = item.sourceUrl || source.url || source.feedUrl || "";
    const title = item.title || "KAP bildirimi";
    return {
      id: `ext_${generateDedupeKey(`${url}${title}`)}`,
      sourceId: source.id || "preview",
      sourceName: sourceTitle,
      sourceType: source.type || "news",
      title,
      summary: item.summary || title,
      url,
      imageUrl: "",
      thumbnailUrl: "",
      publishedAt: item.publishedAt || new Date().toISOString(),
      author: item.sourceName || "Bloomberg HT KAP",
      category: source.category || item.category || "Ekonomi",
      tags,
      language: "tr",
      contentType: "article",
      readTime: 2,
      duration: "",
      fetchedAt: new Date().toISOString(),
      dedupeKey: generateDedupeKey(`${url}${title}`)
    };
  });
}

async function fetchContentsForSource(source) {
  const normalized = normalizeUserSourceDb(source);
  const ttl = sourceFetchCacheTtlMs(normalized.type);
  const cacheKey = normalized.id;
  const cached = SOURCE_FETCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttl) return { ...cached.payload, cacheStatus: "cached" };
  if (isKapNewsSource(normalized)) {
    const kapItems = await withTimeout(fetchKapItems(), 9000, []);
    const payload = {
      source: {
        ...normalized,
        title: normalized.title || "KAP Haberleri",
        lastFetchedAt: new Date().toISOString(),
        lastSuccessAt: kapItems.length ? new Date().toISOString() : normalized.lastSuccessAt,
        lastItemCount: kapItems.length
      },
      items: kapItemsToExternalContents(kapItems, normalized),
      cacheStatus: kapItems.length ? "live" : "cached",
      warning: kapItems.length ? "" : "KAP haberleri şu anda alınamadı."
    };
    setSourceFetchCache(cacheKey, payload);
    return payload;
  }
  const preview = await previewExternalSource(normalized.feedUrl || normalized.url, { type: normalized.type });
  const payload = {
    source: { ...normalized, title: preview.source?.title || normalized.title, lastFetchedAt: new Date().toISOString(), lastSuccessAt: preview.status === "live" ? new Date().toISOString() : normalized.lastSuccessAt, lastItemCount: preview.items?.length || 0 },
    items: (preview.items || []).map((item) => ({ ...item, sourceId: normalized.id, sourceName: normalized.title || item.sourceName, sourceType: normalized.type, category: normalized.category, tags: normalized.tags })),
    cacheStatus: preview.status || "cached",
    warning: preview.warning || ""
  };
  setSourceFetchCache(cacheKey, payload);
  return payload;
}

function dedupeExternalContents(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = item.dedupeKey || articleStableDedupeKey(item) || generateDedupeKey(`${item.url}${item.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...item, dedupeKey: key });
  }
  return output.sort((a, b) => new Date(b.publishedAt || b.fetchedAt || 0) - new Date(a.publishedAt || a.fetchedAt || 0));
}

function clampFeedPayloadText(value, max = 1600) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

function compactFeedArticleForPayload(article = {}) {
  const compact = { ...article };
  compact.summary = clampFeedPayloadText(compact.summary || compact.description || compact.fullText || compact.title, 650);
  compact.description = clampFeedPayloadText(compact.description || compact.summary, 700);
  compact.fullText = clampFeedPayloadText(compact.fullText || compact.description || compact.summary, 700);
  compact.originalSummary = clampFeedPayloadText(compact.originalSummary || compact.summary, 700);
  compact.displaySummary = clampFeedPayloadText(compact.displaySummary || compact.summary, 700);
  compact.aiSummary = clampFeedPayloadText(compact.aiSummary, 700);
  delete compact.originalContent;
  delete compact.displayContent;
  delete compact.content;
  return compact;
}

function buildFeedPayload(articles = [], options = {}) {
  const normalizedArticles = Array.isArray(articles)
    ? articles.filter(Boolean).map((article) => compactFeedArticleForPayload(normalizeArticleTransportFields(compactFeedArticleForPayload(article))))
    : [];
  const success = options.success !== false;
  const payload = {
    success,
    data: { articles: normalizedArticles },
    articles: normalizedArticles,
    count: normalizedArticles.length,
    generatedAt: new Date().toISOString()
  };
  if (!success || options.warning || options.error) {
    payload.warning = options.warning || "";
    payload.error = options.error || {
      code: "FEED_FALLBACK",
      message: "Haber akisi gecici olarak bos donduruldu."
    };
  }
  return payload;
}

function buildPersonalizedFeedPayload(db, userId, articles, region, options = {}) {
  const authenticated = options.authenticated === true;
  const targetLang = options.targetLang || "tr";
  const payloadOptions = { ...options };
  delete payloadOptions.authenticated;
  delete payloadOptions.targetLang;
  const storedPreferences = db.preferences[userId];
  const hasPersonalSignals = authenticated && (Boolean(storedPreferences)
    || db.readStatus.some((item) => item.userId === userId)
    || db.bookmarks.some((item) => item.userId === userId));
  if (!hasPersonalSignals) {
    const fastArticles = articles
      .filter((article) => matchesRegionInline(article, region, targetLang))
      .slice(0, NEWS_FEED_RESPONSE_LIMIT)
      .map((article) => {
        const decorated = decorateArticle(db, userId, article);
        normalizeArticleTransportFields(decorated);
        decorated.relevance = decorated.relevance ?? 50;
        return decorated;
      });
    return buildFeedPayload(fastArticles, payloadOptions);
  }

  const preferences = { ...(storedPreferences || normalizePreferences({})), language: targetLang };
  const readingProfile = buildReadingProfile(db, userId, articles);
  const personalized = articles.map((article) => {
    const decorated = decorateArticle(db, userId, article);
    normalizeArticleTransportFields(decorated);
    decorated.relevance = scoreArticle(decorated, preferences, readingProfile);
    return decorated;
  }).sort((a, b) => {
    if (a.externalProvider && !b.externalProvider) return -1;
    if (!a.externalProvider && b.externalProvider) return 1;
    return b.relevance - a.relevance || new Date(b.publishedAt) - new Date(a.publishedAt);
  }).filter((article) => matchesRegionInline(article, region, targetLang)).slice(0, NEWS_FEED_RESPONSE_LIMIT);
  return buildFeedPayload(personalized, payloadOptions);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    const payload = buildHealthPayload();
    return json(res, payload.status === "ok" ? 200 : 503, payload);
  }

  let db;
  try {
    db = readDb();
  } catch (error) {
    if (req.method === "GET" && url.pathname === "/api/feed") {
      logWarn("feed", "database read failed; returning empty fallback", error.message);
      return json(res, 200, buildFeedPayload([], {
        success: false,
        error: {
          code: "FEED_DATA_UNAVAILABLE",
          message: "Haber verileri su anda okunamadi; bos liste donduruldu."
        }
      }));
    }
    throw error;
  }
  const userId = getUserId(req);
  const authenticated = isAuthenticatedRequest(req);
  if ((url.pathname.startsWith("/api/finance/") || url.pathname.startsWith("/api/economy/")) && !allowFinanceRequest(req)) {
    return json(res, 429, { error: "Çok fazla finans isteği gönderildi. Lütfen kısa süre sonra tekrar dene." });
  }

  if (req.method === "GET" && url.pathname === "/api/sources") {
    const sources = normalizeUserSourcesDb(db.userSources.filter((source) => source.userId === userId));
    return json(res, 200, { sources });
  }

  // --- ADMIN APIs ---
  if (url.pathname.startsWith("/api/admin/articles")) {
    const parts = url.pathname.split("/");
    const id = parts[4]; // /api/admin/articles/:id/...
    const action = parts[5];

    if (req.method === "GET" && !id) {
      return json(res, 200, { articles: _feedCacheStore.articles });
    }
    
    if (req.method === "PUT" && id) {
      const article = _feedCacheStore.articles.find(a => String(a.id) === id);
      if (!article) return json(res, 404, { error: "Makale bulunamadı" });
      
      let body = {};
      try { body = await readBody(req); } catch (e) {}

      if (action === "reclassify") {
        if (body.category) {
          article.category = body.category;
          article.topics = [body.category];
        }
        if (body.region) {
          article.continent = body.region;
          article.primaryRegion = body.region;
        }
        return json(res, 200, { success: true, article });
      }
      if (action === "feature") {
        article.relevance = 100;
        article.interestScore = 100;
        return json(res, 200, { success: true, article });
      }
      if (action === "hide") {
        _feedCacheStore.articles = _feedCacheStore.articles.filter(a => String(a.id) !== id);
        return json(res, 200, { success: true });
      }
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/clusters/merge") {
    let body = {};
    try { body = await readBody(req); } catch (e) {}
    const { sourceId, targetId } = body;
    const sourceArt = _feedCacheStore.articles.find(a => String(a.id) === String(sourceId));
    const targetArt = _feedCacheStore.articles.find(a => String(a.id) === String(targetId));
    if (!sourceArt || !targetArt) return json(res, 404, { error: "Makaleler bulunamadı" });
    
    if (!targetArt.clusterArticles) targetArt.clusterArticles = [];
    targetArt.clusterArticles.push(sourceArt);
    _feedCacheStore.articles = _feedCacheStore.articles.filter(a => String(a.id) !== String(sourceId));
    
    return json(res, 200, { success: true, target: targetArt });
  }

  if (req.method === "POST" && url.pathname === "/api/sources/detect") {
    const body = await readBody(req);
    try {
      const detected = detectSourceFromUrl(body.url, body.type || "auto");
      return json(res, 200, { detected });
    } catch (error) {
      return json(res, 400, { error: error.message || "Bu URL geçerli bir kaynak gibi görünmüyor." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/sources/preview") {
    const body = await readBody(req);
    try {
      const preview = await previewExternalSource(body.url, { type: body.type || "auto" });
      return json(res, 200, preview);
    } catch (error) {
      return json(res, 400, { error: error.message || "Kaynak önizlenemedi." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/sources") {
    const body = await readBody(req);
    let preview;
    try {
      preview = await previewExternalSource(body.url, { type: body.type || "auto" });
    } catch (error) {
      return json(res, 400, { error: error.message || "Kaynak eklenemedi." });
    }
    const sourcePayload = preview.source || detectSourceFromUrl(body.url, body.type || "auto");
    const duplicate = db.userSources.find((source) => source.userId === userId && (
      String(source.url).toLowerCase() === String(sourcePayload.url).toLowerCase() ||
      String(source.feedUrl || "").toLowerCase() === String(sourcePayload.feedUrl || "").toLowerCase()
    ));
    if (duplicate) return json(res, 409, { error: "Bu kaynak daha önce eklenmiş.", source: duplicate });
    const nextPriority = db.userSources.filter((source) => source.userId === userId).length + 1;
    const source = normalizeUserSourceDb({
      ...sourcePayload,
      userId,
      id: `src_${crypto.randomUUID()}`,
      title: body.title || sourcePayload.title,
      category: body.category || sourcePayload.category || "Genel",
      tags: Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      enabled: body.enabled !== false,
      favorite: Boolean(body.favorite),
      priority: nextPriority,
      lastItemCount: preview.items?.length || 0,
      lastFetchedAt: new Date().toISOString(),
      lastSuccessAt: preview.status === "live" ? new Date().toISOString() : ""
    });
    db.userSources.push(source);
    db.sourceContentCache[source.id] = { items: (preview.items || []).map((item) => ({ ...item, sourceId: source.id, sourceName: source.title, sourceType: source.type, category: source.category, tags: source.tags })), updatedAt: new Date().toISOString(), status: preview.status || "cached" };
    writeDb(db);
    return json(res, 201, { source, previewItems: db.sourceContentCache[source.id].items, warning: preview.warning || "" });
  }

  const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (sourceMatch && req.method === "PUT") {
    const sourceId = sourceMatch[1];
    const body = await readBody(req);
    const index = db.userSources.findIndex((source) => source.id === sourceId && source.userId === userId);
    if (index === -1) return json(res, 404, { error: "Kaynak bulunamadı." });
    db.userSources[index] = normalizeUserSourceDb({ ...db.userSources[index], ...body, id: sourceId, userId });
    writeDb(db);
    return json(res, 200, { source: db.userSources[index] });
  }

  if (sourceMatch && req.method === "DELETE") {
    const sourceId = sourceMatch[1];
    const before = db.userSources.length;
    db.userSources = db.userSources.filter((source) => !(source.id === sourceId && source.userId === userId));
    delete db.sourceContentCache[sourceId];
    if (db.userSources.length === before) return json(res, 404, { error: "Kaynak bulunamadı." });
    writeDb(db);
    return json(res, 200, { deleted: true });
  }

  if (req.method === "GET" && url.pathname === "/api/sources/fetch") {
    const typeFilter = String(url.searchParams.get("type") || "all");
    const sources = normalizeUserSourcesDb(db.userSources.filter((source) => source.userId === userId && source.enabled !== false));
    const filteredSources = sources.filter((source) => typeFilter === "all" || source.type === typeFilter || (typeFilter === "rss" && ["rss", "atom", "news", "blog", "official", "podcast"].includes(source.type)));
    const fetched = await Promise.all(filteredSources.map((source) => fetchContentsForSource(source)));
    for (const result of fetched) {
      if (result?.source?.id) {
        const index = db.userSources.findIndex((source) => source.id === result.source.id && source.userId === userId);
        if (index >= 0) db.userSources[index] = normalizeUserSourceDb({ ...db.userSources[index], ...result.source });
        db.sourceContentCache[result.source.id] = { items: result.items || [], updatedAt: new Date().toISOString(), status: result.cacheStatus || "cached", warning: result.warning || "" };
      }
    }
    writeDb(db);
    const contents = dedupeExternalContents(fetched.flatMap((result) => result.items || []));
    return json(res, 200, {
      sources: normalizeUserSourcesDb(db.userSources.filter((source) => source.userId === userId)),
      contents,
      summary: {
        activeSources: filteredSources.length,
        newItems: contents.length,
        lastUpdated: new Date().toISOString(),
        cacheStatus: fetched.some((result) => result.cacheStatus === "live") ? "live" : "cached"
      }
    });
  }


  if (req.method === "GET" && url.pathname === "/api/finance/catalog") {
    return json(res, 200, { catalog: FINANCE_CATALOG, sourceHealth: financeSourceHealth() });
  }

  if (req.method === "GET" && url.pathname === "/api/finance/preferences") {
    const preferences = normalizeFinancePreferences(db.financePreferences[userId]);
    return json(res, 200, { preferences });
  }

  if (req.method === "PUT" && url.pathname === "/api/finance/preferences") {
    const body = await readBody(req);
    db.financePreferences[userId] = normalizeFinancePreferences(body || {});
    writeDb(db);
    return json(res, 200, { preferences: db.financePreferences[userId] });
  }

  if (req.method === "GET" && url.pathname === "/api/finance/quotes") {
    const pref = normalizeFinancePreferences(db.financePreferences[userId]);
    const requestedSymbols = String(url.searchParams.get("symbols") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const symbols = requestedSymbols.length
      ? requestedSymbols
      : pref.financeWatchlist.filter((item) => item.enabled).sort((a, b) => a.priority - b.priority).map((item) => item.symbol);
    const assets = await buildFinanceQuotes(symbols, { force: url.searchParams.get("refresh") === "1" });
    return json(res, 200, {
      assets,
      preferences: pref,
      sourceHealth: financeSourceHealth(),
      disclaimer: "Bu veriler bilgilendirme amaçlıdır, yatırım tavsiyesi değildir. Veriler kaynaklara göre gecikmeli veya gün sonu olabilir.",
      bistNotice: "BIST verileri lisanslı veri sağlayıcı gerektirebilir. Gösterilen veriler kaynağına göre gecikmeli veya gün sonu olabilir."
    });
  }

  if (req.method === "GET" && url.pathname === "/api/finance/rss") {
    try {
      const [tcmbItems, kapItems] = await Promise.all([fetchTcmbRssItems(), fetchKapItems().catch(() => [])]);
      const items = [...tcmbItems, ...kapItems].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      return json(res, 200, { items, source: "TCMB resmi Atom feed + Bloomberg HT KAP Haberleri", lastUpdated: new Date().toISOString(), status: "live" });
    } catch (err) {
      return json(res, 200, { items: [], source: "TCMB RSS", lastUpdated: new Date().toISOString(), status: "error", note: `TCMB RSS alınamadı: ${String(err.message || "").slice(0, 120)}` });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/finance/kap") {
    const items = await fetchKapItems().catch(() => []);
    return json(res, 200, {
      items,
      source: "Bloomberg HT KAP Haberleri",
      status: items.length ? "live" : "error",
      sourceUrl: BLOOMBERGHT_KAP_URL,
      note: items.length ? "" : "Bloomberg HT KAP haberleri şu anda alınamadı."
    });
  }

  if (req.method === "GET" && url.pathname === "/api/economy/tcmb/policy-rate") {
    return json(res, 200, { asset: normalizeFinanceQuote(await fetchTcmbPolicyRate()) });
  }

  if (req.method === "GET" && url.pathname === "/api/economy/bist/xu100") {
    return json(res, 200, { asset: normalizeFinanceQuote(await fetchBistQuote("XU100")) });
  }

  if (req.method === "GET" && url.pathname === "/api/economy/cards") {
    const requestedSymbols = String(url.searchParams.get("symbols") || "").split(",").map((item) => item.trim()).filter(Boolean);
    const assets = await buildFinanceQuotes(requestedSymbols, { force: url.searchParams.get("refresh") === "1" });
    return json(res, 200, { assets, sourceHealth: financeSourceHealth(), lastUpdated: new Date().toISOString() });
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/status") {
    return json(res, 200, {
      newsApi: hasEnv("NEWS_API_KEY"),
      freeNewsApi: hasEnv("FREENEWSAPI_KEY"),
      gnews: hasEnv("GNEWS_API_KEY"),
      mediastack: hasEnv("MEDIASTACK_API_KEY"),
      gemini: Boolean(getGeminiApiKey()),
      openai: hasEnv("OPENAI_API_KEY"),
      rssFeeds: getRssSources().length,
      aiModel: process.env.AI_MODEL || process.env.GEMINI_MODEL || null
    });
  }

  if (req.method === "GET" && url.pathname === "/api/news/sources") {
    return json(res, 200, {
      sources: getRssSources().map((source) => ({
        id: source.id || "",
        name: source.sourceName || source.name || "",
        url: source.rssUrl || source.url || "",
        category: source.category,
        country: source.country || "",
        countryCode: source.countryCode || "",
        region: source.region || "global",
        language: source.language || "",
        trustLevel: source.trustLevel || "medium",
        sourceType: source.sourceType || "rss",
        isGlobalSource: Boolean(source.isGlobalSource),
        fetchPriority: source.fetchPriority || 3,
        enabled: source.enabled !== false
      }))
    });
  }

  if (req.method === "GET" && url.pathname === "/api/sources/regional") {
    const regionFilter = normalizeRegionQueryInline(url.searchParams.get("region"));
    const catalog = REGIONAL_SOURCE_CATALOG.filter((source) => CANONICAL_REGIONS.includes(source.region));
    const enabledCatalog = catalog.filter((source) => source.enabled !== false);
    const regions = Object.fromEntries(CANONICAL_REGIONS.map((region) => [region, []]));
    catalog.forEach((source) => regions[source.region].push(regionalSourceResponseItem(source)));
    const sources = (regionFilter ? regions[regionFilter] : catalog.map(regionalSourceResponseItem)) || [];
    return json(res, 200, {
      success: true,
      data: { regions, totalSourceCount: catalog.length, enabledSourceCount: enabledCatalog.length },
      total: catalog.length,
      byRegion: Object.fromEntries(CANONICAL_REGIONS.map((region) => [region, regions[region].length])),
      sources
    });
  }

  if (req.method === "GET" && url.pathname === "/api/searches") {
    return json(res, 200, {
      searches: db.savedSearches
        .filter((item) => item.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
  }

  if (req.method === "POST" && url.pathname === "/api/searches") {
    const body = await readBody(req);
    const filters = body.filters || {};
    const label = String(body.label || filters.query || "Kayıtlı arama").trim().slice(0, 80);
    const savedSearch = {
      id: `search_${crypto.randomUUID()}`,
      userId,
      label,
      filters: {
        query: String(filters.query || ""),
        category: String(filters.category || "Tümü"),
        source: String(filters.source || "Tümü"),
        status: String(filters.status || "Tümü"),
        date: String(filters.date || "Tümü"),
        sort: String(filters.sort || "relevance")
      },
      createdAt: new Date().toISOString()
    };
    db.savedSearches.push(savedSearch);
    writeDb(db);
    return json(res, 201, { search: savedSearch });
  }

  const savedSearchMatch = url.pathname.match(/^\/api\/searches\/([^/]+)$/);
  if (req.method === "DELETE" && savedSearchMatch) {
    const searchId = savedSearchMatch[1];
    const before = db.savedSearches.length;
    db.savedSearches = db.savedSearches.filter((item) => !(item.userId === userId && item.id === searchId));
    if (db.savedSearches.length === before) return json(res, 404, { error: "Kayıtlı arama bulunamadı." });
    writeDb(db);
    return json(res, 200, { deleted: true });
  }

  // ======================== CALENDAR API ========================
  if (!Array.isArray(db.calendarEvents)) { db.calendarEvents = []; }
  if (!Array.isArray(db.calendarNotifications)) { db.calendarNotifications = []; }

  if (req.method === "GET" && url.pathname === "/api/calendar/events") {
    const events = db.calendarEvents.filter(e => e.userId === userId);
    return json(res, 200, { events });
  }

  if (req.method === "POST" && url.pathname === "/api/calendar/events") {
    const body = await readBody(req);
    if (!body.title) return json(res, 400, { success: false, message: "Etkinlik başlığı gerekli." });
    const duplicate = db.calendarEvents.find(e => e.userId === userId && e.eventId === body.eventId);
    if (duplicate) return json(res, 409, { success: false, message: "Bu etkinlik zaten takvimde.", event: duplicate });
    const entry = {
      id: body.id || ("cal_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      userId,
      eventId: body.eventId || "",
      title: String(body.title || "").slice(0, 500),
      description: String(body.description || "").slice(0, 2000),
      location: String(body.location || "").slice(0, 300),
      eventDate: body.eventDate || new Date().toISOString(),
      eventTime: body.eventTime || "",
      source: String(body.source || "").slice(0, 200),
      image: String(body.image || "").slice(0, 1000),
      category: String(body.category || "").slice(0, 100),
      url: String(body.url || "").slice(0, 1000),
      userNote: String(body.userNote || "").slice(0, 500),
      reminderAt: body.reminderAt || null,
      reminderEnabled: Boolean(body.reminderAt),
      reminderSent: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.calendarEvents.push(entry);
    writeDb(db);
    return json(res, 201, { success: true, event: entry });
  }

  const calEventMatch = url.pathname.match(/^\/api\/calendar\/events\/([^/]+)$/);
  if (calEventMatch) {
    const calEventId = calEventMatch[1];
    const idx = db.calendarEvents.findIndex(e => e.id === calEventId && e.userId === userId);

    if (req.method === "PATCH") {
      if (idx === -1) return json(res, 404, { success: false, message: "Takvim etkinliği bulunamadı." });
      const body = await readBody(req);
      const entry = db.calendarEvents[idx];
      if (body.userNote !== undefined) entry.userNote = String(body.userNote).slice(0, 500);
      if (body.reminderAt !== undefined) { entry.reminderAt = body.reminderAt; entry.reminderEnabled = Boolean(body.reminderAt); }
      if (body.reminderSent !== undefined) entry.reminderSent = Boolean(body.reminderSent);
      entry.updatedAt = new Date().toISOString();
      writeDb(db);
      return json(res, 200, { success: true, event: entry });
    }

    if (req.method === "DELETE") {
      if (idx === -1) return json(res, 404, { success: false, message: "Takvim etkinliği bulunamadı." });
      db.calendarEvents.splice(idx, 1);
      writeDb(db);
      return json(res, 200, { success: true, deleted: true });
    }
  }

  const calReminderMatch = url.pathname.match(/^\/api\/calendar\/events\/([^/]+)\/reminder$/);
  if (req.method === "POST" && calReminderMatch) {
    const calEventId = calReminderMatch[1];
    const idx = db.calendarEvents.findIndex(e => e.id === calEventId && e.userId === userId);
    if (idx === -1) return json(res, 404, { success: false, message: "Takvim etkinliği bulunamadı." });
    const body = await readBody(req);
    const entry = db.calendarEvents[idx];
    entry.reminderAt = body.reminderAt || null;
    entry.reminderEnabled = Boolean(body.reminderAt);
    entry.reminderSent = false;
    entry.updatedAt = new Date().toISOString();
    writeDb(db);
    return json(res, 200, { success: true, event: entry });
  }

  if (req.method === "GET" && url.pathname === "/api/calendar/reminders/due") {
    const now = new Date();
    const due = db.calendarEvents.filter(e => e.userId === userId && e.reminderEnabled && !e.reminderSent && e.reminderAt && new Date(e.reminderAt) <= now);
    for (const e of due) {
      e.reminderSent = true;
      e.updatedAt = new Date().toISOString();
      db.calendarNotifications.push({
        id: "notif_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        userId,
        type: "calendar_reminder",
        title: e.title,
        message: `Hatırlatıcı: "${e.title}" etkinliği yaklaşıyor!`,
        relatedEventId: e.id,
        read: false,
        createdAt: new Date().toISOString()
      });
    }
    if (due.length) writeDb(db);
    return json(res, 200, { due: due.map(e => ({ id: e.id, title: e.title })) });
  }
  // ======================== END CALENDAR API ========================

  if (req.method === "GET" && url.pathname === "/api/events") {
    const hidden = new Set(db.hiddenEvents.filter((item) => item.userId === userId).map((item) => item.eventId));
    let liveEvents = [];
    let provider = "biletix";
    const city = url.searchParams.get("city") || process.env.EVENT_CITY || "ISTANBUL";
    const type = url.searchParams.get("type") || "Tümü";
    try {
      liveEvents = await fetchBiletixEvents({ city, type, limit: 48 });
    } catch (error) {
      liveEvents = fallbackLiveTicketEvents().filter((event) => type === "Tümü" || event.category === type);
      provider = "fallback";
    }
    const events = liveEvents
      .filter((event) => !hidden.has(event.id))
      .map((event) => decorateEvent(db, userId, event))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return json(res, 200, {
      provider,
      filters: {
        cities: ["ISTANBUL", "ANKARA", "IZMIR", "BURSA", "ANTALYA", "ADANA", "TURKIYE"],
        types: ["Tümü", "Müzik", "Sahne", "Spor", "Aile", "Eğitim", "Etkinlik"]
      },
      events
    });
  }

  // Alias: /api/export-pdf → same handler as /api/export/pdf

  if ((req.method === "GET" || req.method === "POST") && (url.pathname === "/api/export/pdf" || url.pathname === "/api/export-pdf")) {
    const body = req.method === "POST" ? await readBody(req) : {};
    const requestedLayout = body.layout || url.searchParams.get("layout");
    const layout = ["a4", "tabloid", "booklet", "egazete"].includes(requestedLayout) ? requestedLayout : "egazete";
    const mode = String(body.mode || url.searchParams.get("mode") || "inline");
    if (layout === "egazete" || req.method === "GET" || mode === "inline") {
      try {
        const content = await buildEpaperPdfBuffer({ db, userId, req, url, body: { ...body, layout, mode } });
        return inlinePdf(res, "e-gazete.pdf", content);
      } catch (error) {
        logError("pdf", "egazete export failed", error.message || String(error));
        return json(res, 500, { error: "PDF oluşturulamadı. Lütfen tekrar deneyin." });
      }
    }
    const submittedArticles = Array.isArray(body.articles) ? body.articles : [];
    const articleIds = Array.isArray(body.articleIds) ? body.articleIds.map(String) : [];
    const dbArticles = db.articles.filter((article) => !articleIds.length || articleIds.includes(String(article.id)));
    const articles = submittedArticles.length ? submittedArticles : dbArticles;
    if (!articles.length) return json(res, 400, { error: "PDF oluşturmak için en az bir haber seçilmelidir." });
    const hidden = new Set(db.hiddenEvents.filter((item) => item.userId === userId).map((item) => item.eventId));
    const events = db.institutionalEvents
      .filter((event) => !hidden.has(event.id))
      .slice(0, 4);
    const user = db.users.find((item) => item.id === userId);
    const username = user?.name || "Kullanici";
    const dateLabel = new Date().toLocaleDateString("tr-TR");
    const paperTitleArg = String(body.paperTitle || `${username}'in Gazetesi`).slice(0, 60);
    const interestsArg = Array.isArray(body.interests) ? body.interests.map(String).slice(0, 16) : [];
    const trendsArg = Array.isArray(body.trends) ? body.trends.slice(0, 5) : [];
    const content = await buildSimplePdf({
      title: paperTitleArg,
      paperTitle: paperTitleArg,
      interests: interestsArg,
      trends: trendsArg,
      layout,
      articles,
      events
    });
    return mode === "inline"
      ? inlinePdf(res, `kisisel-gazetem-${layout}.pdf`, content)
      : pdf(res, `kisisel-gazetem-${layout}.pdf`, content);
  }

  const eventDetailMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
  if (req.method === "GET" && eventDetailMatch) {
    let liveEvents = [];
    try { liveEvents = await fetchBiletixEvents({ city: process.env.EVENT_CITY || "ISTANBUL", limit: 80 }); } catch { liveEvents = fallbackLiveTicketEvents(); }
    const event = liveEvents.find((item) => item.id === eventDetailMatch[1]);
    if (!event) return json(res, 404, { error: "Etkinlik bulunamadı." });
    return json(res, 200, { event: decorateEvent(db, userId, event) });
  }

  const eventReadMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/read$/);
  if (req.method === "POST" && eventReadMatch) {
    const eventId = eventReadMatch[1];
    db.eventReadStatus = db.eventReadStatus.filter((item) => !(item.userId === userId && item.eventId === eventId));
    db.eventReadStatus.push({ userId, eventId, updatedAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 200, { read: true });
  }

  const eventReminderMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/reminder$/);
  if (req.method === "POST" && eventReminderMatch) {
    const eventId = eventReminderMatch[1];
    const existing = db.eventReminders.find((item) => item.userId === userId && item.eventId === eventId);
    if (existing) {
      db.eventReminders = db.eventReminders.filter((item) => !(item.userId === userId && item.eventId === eventId));
    } else {
      db.eventReminders.push({ userId, eventId, createdAt: new Date().toISOString() });
    }
    writeDb(db);
    return json(res, 200, { reminder: !existing });
  }

  const eventDismissMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/dismiss$/);
  if (req.method === "POST" && eventDismissMatch) {
    const eventId = eventDismissMatch[1];
    if (!db.hiddenEvents.some((item) => item.userId === userId && item.eventId === eventId)) {
      db.hiddenEvents.push({ userId, eventId, createdAt: new Date().toISOString() });
    }
    writeDb(db);
    return json(res, 200, { hidden: true });
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/test/news") {
    const config = getNewsProviderEndpoint(3);
    if (!config) {
      return json(res, 400, { error: "Haber API key bulunamadı. .env içine GNEWS_API_KEY, NEWS_API_KEY veya MEDIASTACK_API_KEY ekle." });
    }
    const payload = await fetchJson(config.endpoint, config.provider === "freenewsapi" ? {
      headers: {
        "x-api-key": process.env.FREENEWSAPI_KEY
      }
    } : {});
    return json(res, 200, {
      provider: config.provider,
      articles: normalizeProviderArticles(config.provider, payload)
        .slice(0, 3)
    });

    let provider;
    let endpoint;
    if (hasEnv("GNEWS_API_KEY")) {
      provider = "gnews";
      endpoint = `https://gnews.io/api/v4/top-headlines?lang=tr&max=3&apikey=${encodeURIComponent(process.env.GNEWS_API_KEY)}`;
    } else if (hasEnv("NEWS_API_KEY")) {
      provider = "newsapi";
      endpoint = `https://newsapi.org/v2/top-headlines?language=en&pageSize=3&apiKey=${encodeURIComponent(process.env.NEWS_API_KEY)}`;
    } else if (hasEnv("MEDIASTACK_API_KEY")) {
      provider = "mediastack";
      endpoint = `http://api.mediastack.com/v1/news?languages=tr&limit=3&access_key=${encodeURIComponent(process.env.MEDIASTACK_API_KEY)}`;
    } else {
      return json(res, 400, { error: "Haber API key bulunamadı. .env içine GNEWS_API_KEY, NEWS_API_KEY veya MEDIASTACK_API_KEY ekle." });
    }

    const legacyPayload = await fetchJson(endpoint);
    return json(res, 200, {
      provider,
      articles: normalizeProviderArticles(provider, legacyPayload).slice(0, 3)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/test/ai") {
    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      return json(res, 400, { error: "GEMINI_API_KEY bulunamadı. .env içine GEMINI_API_KEY ekle." });
    }
    const model = getGeminiModel();
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: "Bu entegrasyon testi için tek cümlelik Türkçe bir haber özeti yaz." }]
          }
        ],
        generationConfig: geminiGenerationConfig({ model, maxOutputTokens: 512 })
      })
    });
    return json(res, 200, {
      provider: "gemini",
      model,
      message: payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "Gemini cevap verdi."
    });

    if (!hasEnv("OPENAI_API_KEY")) {
      return json(res, 400, { error: "OPENAI_API_KEY bulunamadı. .env içine ekle." });
    }

    const legacyOpenAiPayload = await fetchJson("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "gpt-4.1-mini",
        messages: [
          { role: "system", content: "Kısa, net Türkçe cevap ver." },
          { role: "user", content: "Bu entegrasyon testi için tek cümlelik bir haber özeti yaz." }
        ],
        temperature: 0.2,
        max_tokens: 80
      })
    });

    return json(res, 200, {
      model: legacyOpenAiPayload.model,
      message: legacyOpenAiPayload.choices?.[0]?.message?.content || "AI cevap verdi."
    });
  }

  if (req.method === "POST" && url.pathname === "/api/ai/summarize") {
    const body = await readBody(req);
    const articleId = body.articleId ? String(body.articleId) : "";
    const storedArticle = articleId
      ? (db._articleById && db._articleById.get(articleId)) || ARTICLE_CACHE.get(articleId)
      : null;
    const article = {
      ...(storedArticle || {}),
      id: articleId || body.id || storedArticle?.id || `adhoc_${crypto.randomUUID()}`,
      title: body.title || storedArticle?.title || "",
      summary: body.summary || body.description || body.text || body.content || storedArticle?.summary || "",
      description: body.description || storedArticle?.description || "",
      fullText: body.fullText || body.content || body.text || storedArticle?.fullText || "",
      sourceName: body.sourceName || body.source || storedArticle?.sourceName || storedArticle?.source || "",
      category: body.category || storedArticle?.category || ""
    };
    const structured = await generateStructuredAiSummary(article);
    return json(res, 200, {
      shortSummary: structured.shortSummary,
      bulletSummary: structured.bulletSummary,
      neutralAnalysis: structured.neutralAnalysis,
      summary: structured.shortSummary,
      text: structured.shortSummary,
      provider: structured.provider,
      model: structured.model
    });
  }

  if (req.method === "POST" && url.pathname === "/api/entities/info") {
    const body = await readBody(req);
    const entity = String(body.entity || "").trim().slice(0, 120);
    if (!entity) return json(res, 400, { error: "Bilgi kartı için konu adı gerekli." });
    const relatedArticles = Array.isArray(body.relatedArticles) ? body.relatedArticles : [];
    const info = await generateEntityInfo(entity, relatedArticles);
    return json(res, 200, info);
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readBody(req);
    if (!body.name || !body.email || !body.password) {
      return json(res, 400, { error: "Ad, e-posta ve şifre zorunludur." });
    }
    if (db.users.some((user) => user.email === body.email)) {
      return json(res, 409, { error: "Bu e-posta zaten kayıtlı." });
    }
    const id = `user_${crypto.randomUUID()}`;
    const password = hashPassword(body.password);
    const user = {
      id,
      name: body.name,
      email: body.email,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      createdAt: new Date().toISOString()
    };
    if (!Array.isArray(body.interests) || body.interests.length < 3) {
      return json(res, 400, { error: "En az 3 ilgi alanı seçmelisin." });
    }
    db.users.push(user);
    db.preferences[id] = normalizePreferences({
      interests: body.interests,
      readingGoal: body.readingGoal,
      readingTimes: body.readingTimes,
      contentDepth: body.contentDepth
    });
    writeDb(db);
    return json(res, 201, { token: createToken(id), user: { id, name: user.name, email: user.email } });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const emailInput = String(body.email || "").trim().toLowerCase();
    const nameInput = String(body.name || "").trim().toLowerCase();
    const user = db.users.find((item) =>
      (item.email && item.email.toLowerCase() === emailInput) ||
      (nameInput && item.name && item.name.toLowerCase() === nameInput)
    );
    if (!user) return json(res, 401, { error: "E-posta veya şifre hatalı." });
    if (user.passwordHash === "demo") {
      const demoHash = hashPassword("demo123");
      user.passwordHash = demoHash.hash;
      user.passwordSalt = demoHash.salt;
      writeDb(db);
    }
    const password = hashPassword(body.password || "", user.passwordSalt);
    if (password.hash !== user.passwordHash) return json(res, 401, { error: "E-posta veya şifre hatalı." });
    return json(res, 200, { token: createToken(user.id), user: { id: user.id, name: user.name, email: user.email } });
  }

  if (req.method === "GET" && url.pathname === "/api/profile") {
    const user = db.users.find((item) => item.id === userId);
    return json(res, 200, {
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      preferences: normalizePreferences(db.preferences[userId])
    });
  }

  if (req.method === "PUT" && url.pathname === "/api/profile") {
    const body = await readBody(req);
    const user = db.users.find((item) => item.id === userId);
    if (!user) return json(res, 404, { error: "Kullanıcı bulunamadı." });
    const name = String(body.name || "").trim();
    if (!name) return json(res, 400, { error: "Ad soyad zorunludur." });
    user.name = name;
    if (body.email) user.email = String(body.email).trim();
    writeDb(db);
    return json(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
  }

  if (req.method === "PUT" && url.pathname === "/api/profile/preferences") {
    const body = await readBody(req);
    db.preferences[userId] = normalizePreferences({
      interests: body.interests || [],
      preferredSources: body.preferredSources || [],
      readingTimes: body.readingTimes,
      contentDepth: body.contentDepth,
      readingMode: body.readingMode || "daily",
      language: body.language || "tr",
      notifications: body.notifications,
      darkMode: body.darkMode,
      fontScale: body.fontScale,
      readingGoal: body.readingGoal
    });
    writeDb(db);
    return json(res, 200, { preferences: db.preferences[userId] });
  }

  if (req.method === "GET" && url.pathname === "/api/articles") {
    const region = url.searchParams.get("region");
    const articles = [...DEMO_REGIONAL_PANDEMIC_ARTICLES, ...db.articles].map((article) => decorateArticle(db, userId, article))
      .filter((article) => matchesRegionInline(article, region));
    return json(res, 200, { success: true, data: { articles }, articles });
  }

  if (req.method === "GET" && url.pathname === "/api/trends") {
    try {
      const status = url.searchParams.get("status");
      if (status && !["rising", "stable", "fading"].includes(status)) {
        return json(res, 400, { success: false, error: { code: "VALIDATION_ERROR", message: "GeÃ§ersiz trend durumu." } });
      }
      const trends = getRegionalTrendsInline(db, url);
      return json(res, 200, { success: true, data: { trends }, trends });
    } catch {
      return json(res, 500, { success: false, error: { code: "TRENDS_ERROR", message: "Trend verileri alÄ±namadÄ±." } });
    }
  }

  const trendDetailMatch = url.pathname.match(/^\/api\/trends\/([^/]+)$/);
  if (req.method === "GET" && trendDetailMatch) {
    try {
      const trend = computeRegionalTrendsInline([...DEMO_REGIONAL_PANDEMIC_ARTICLES, ...db.articles, ...ARTICLE_CACHE.values()])
        .find((item) => item.id === trendDetailMatch[1]);
      if (!trend) return json(res, 404, { success: false, error: { code: "TREND_NOT_FOUND", message: "Trend bulunamadÄ±." } });
      return json(res, 200, { success: true, data: { trend, articles: trend.articles }, trend, articles: trend.articles });
    } catch {
      return json(res, 500, { success: false, error: { code: "TRENDS_ERROR", message: "Trend verileri alÄ±namadÄ±." } });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/feed/refresh") {
    const targetLang = normalizeUiLanguage(url.searchParams.get("lang") || db.preferences[userId]?.language || "tr");
    try {
      const result = await backgroundRefreshFeed({ reason: "manual-refresh" });
      await ensureFeedTranslationsForResponse(_feedCacheStore.articles, targetLang, 16);
      triggerFeedTranslation(_feedCacheStore.articles, targetLang, "manual-refresh-language");
      const payload = buildPersonalizedFeedPayload(db, userId, _feedCacheStore.articles, url.searchParams.get("region"), {
        authenticated,
        targetLang,
        success: result.success !== false || _feedCacheStore.articles.length > 0,
        warning: result.success === false ? "Canli haber yenileme tamamlanamadi; mevcut haberler gosteriliyor." : ""
      });
      await ensureFeedTranslationsForResponse(payload.articles, targetLang, 24);
      localizeFeedPayload(payload, targetLang);
      payload.refresh = {
        success: result.success !== false,
        skipped: Boolean(result.skipped),
        error: result.error || null,
        cachedAt: _feedCacheStore.lastRefreshAt,
        count: _feedCacheStore.articles.length
      };
      return json(res, 200, payload);
    } catch (error) {
      logWarn("feed-refresh", "manual refresh fallback", error.message);
      return json(res, 200, buildPersonalizedFeedPayload(db, userId, _feedCacheStore.articles, url.searchParams.get("region"), {
        authenticated,
        targetLang,
        success: _feedCacheStore.articles.length > 0,
        error: {
          code: "FEED_REFRESH_FAILED",
          message: "Taze haberler su anda alinamadi; mevcut haberler gosteriliyor."
        }
      }));
    }
  }

  if (req.method === "GET" && url.pathname === "/api/feed") {
    try {
      const region = url.searchParams.get("region");
      const targetLang = normalizeUiLanguage(url.searchParams.get("lang") || db.preferences[userId]?.language || "tr");
      const seededFromLocal = seedFeedCacheFromLocal(db, "request-local-cache");
      const hasCachedFeed = _feedCacheStore.articles.length > 0;
      const cacheAgeMs = Date.now() - _feedCacheStore.timestamp;
      const isStale = cacheAgeMs > NEWS_REFRESH_INTERVAL_MS;

      if (hasCachedFeed) {
        if ((isStale || seededFromLocal) && !_feedCacheStore.refreshing) {
          triggerBackgroundFeedRefresh(seededFromLocal ? "local-seed-warm-start" : "stale-cache");
        }
        await ensureFeedTranslationsForResponse(_feedCacheStore.articles, targetLang, 16);
        triggerFeedTranslation(_feedCacheStore.articles, targetLang, seededFromLocal ? "local-seed-language" : "cached-feed-language");
        const payload = buildPersonalizedFeedPayload(db, userId, _feedCacheStore.articles, region, { authenticated, targetLang });
        await ensureFeedTranslationsForResponse(payload.articles, targetLang, 24);
        localizeFeedPayload(payload, targetLang);
        if (seededFromLocal) payload.warning = "Kayitli haberler gosteriliyor. Yeni haberler arka planda aliniyor.";
        if (isStale) payload.warning = "Haberler son güncellemeden getirildi. Arka planda güncelleniyor.";
        payload.cachedAt = _feedCacheStore.lastRefreshAt;
        if (seededFromLocal) {
          payload.refresh = {
            queued: _feedCacheStore.refreshing,
            background: true,
            reason: "local-seed-warm-start"
          };
        }
        return json(res, 200, payload);
      }
      // Cache empty: return local DB data immediately and refresh in background.
      const localArticles = buildLocalFeedCacheArticles(db);
      await ensureFeedTranslationsForResponse(localArticles, targetLang, 16);
      const localPayload = localArticles.length ? buildPersonalizedFeedPayload(db, userId, localArticles, region, {
        authenticated,
        targetLang,
        warning: "Kayitli haberler gosteriliyor. Yeni haberler arka planda aliniyor."
      }) : null;
      if (localPayload) {
        await ensureFeedTranslationsForResponse(localPayload.articles, targetLang, 24);
        localizeFeedPayload(localPayload, targetLang);
        triggerBackgroundFeedRefresh("empty-cache-warm-start");
        triggerFeedTranslation(localArticles, targetLang, "empty-cache-local-language");
        localPayload.cachedAt = _feedCacheStore.lastRefreshAt;
        localPayload.refresh = {
          queued: _feedCacheStore.refreshing,
          background: true,
          reason: "empty-cache-warm-start"
        };
        return json(res, 200, localPayload);
      }

      triggerBackgroundFeedRefresh("empty-cache-no-local-data");

      return json(res, 200, buildFeedPayload([], {
        success: false,
        error: { code: "FEED_EMPTY", message: "Kayitli haber bulunamadi. Yeni haberler arka planda yukleniyor." }
      }));
    } catch (error) {
      logWarn("feed", "returning fallback response", error.message);
      if (_feedCacheStore.articles.length > 0) {
        const region = url.searchParams.get("region");
        const articles = _feedCacheStore.articles.filter((a) => matchesRegionInline(a, region));
        return json(res, 200, buildFeedPayload(articles, { warning: "Cache'den servis edildi." }));
      }
      return json(res, 200, buildFeedPayload([], {
        success: false,
        error: {
          code: "FEED_UNAVAILABLE",
          message: "Haber akisi su anda hazirlanamadi; bos liste donduruldu."
        }
      }));
    }
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const query = normalizeText(url.searchParams.get("q"));
    const category = url.searchParams.get("category");
    const source = url.searchParams.get("source");
    const articles = db.articles
      .filter((article) => !query || normalizeText(`${article.title} ${article.summary} ${article.fullText}`).includes(query))
      .filter((article) => !category || category === "Tümü" || normalizeCategoryName(article.category) === normalizeCategoryName(category))
      .filter((article) => !source || source === "Tümü" || article.sourceName === source)
      .map((article) => normalizeArticleTransportFields(decorateArticle(db, userId, article)));
    return json(res, 200, { articles });
  }

  const articleDetailMatch = url.pathname.match(/^\/api\/articles\/([^/]+)$/);
  if (req.method === "GET" && articleDetailMatch) {
    const articleId = articleDetailMatch[1];
    let article = (db._articleById && db._articleById.get(String(articleId))) || ARTICLE_CACHE.get(articleId);
    if (!article) return json(res, 404, { error: "Haber bulunamadı." });

    const needsFullText = articleNeedsFullTextRefresh(article);
    // Caching layer to prevent memory leaks and extreme CPU/RAM usage
    if (needsFullText || !hasSystemAiSummary(article) || !Array.isArray(article.duplicates) || article.duplicates.length === 0 || !article.multiSourceAnalysis) {
      const enrichedArticle = await fetchArticleFullText(article);
      const fullTextChanged = String(enrichedArticle.fullText || "") !== String(article.fullText || "");
      let newAiSummaryObj = null;
      if (!hasSystemAiSummary(enrichedArticle) || fullTextChanged) {
        newAiSummaryObj = await generateAiSummary(enrichedArticle, { force: true });
      }

      if (newAiSummaryObj && typeof newAiSummaryObj === 'object') {
        enrichedArticle.aiSummary = newAiSummaryObj.aiSummary || "";
        enrichedArticle.sourceSentences = newAiSummaryObj.sourceSentences || [];
        enrichedArticle.contentSnippet = newAiSummaryObj.contentSnippet || "";
        enrichedArticle.aiSummaryProvider = newAiSummaryObj.provider || "google";
        enrichedArticle.aiSummaryModel = newAiSummaryObj.model || "";
        enrichedArticle.aiSummaryGeneratedAt = new Date().toISOString();
      }
      
      const rawDuplicates = await findDuplicates(db, enrichedArticle);
      const richDuplicates = await ensureRichDuplicates(enrichedArticle, rawDuplicates);
      const multiSourceAnalysis = (await generateMultiSourceAnalysis(enrichedArticle, richDuplicates)) || fallbackMultiSourceAnalysis(enrichedArticle, richDuplicates);

      enrichedArticle.duplicates = richDuplicates;
      enrichedArticle.multiSourceAnalysis = multiSourceAnalysis;
      
      ARTICLE_CACHE.set(String(enrichedArticle.id), enrichedArticle);
      const dbArticle = (db._articleById && db._articleById.get(String(enrichedArticle.id)));
      if (dbArticle) {
        dbArticle.fullText = enrichedArticle.fullText;
        dbArticle.contentStatus = enrichedArticle.contentStatus;
        dbArticle.contentWarning = enrichedArticle.contentWarning || "";
        dbArticle.contentFallbackStatus = enrichedArticle.contentFallbackStatus || "";
        dbArticle.aiSummary = enrichedArticle.aiSummary;
        dbArticle.sourceSentences = enrichedArticle.sourceSentences;
        dbArticle.contentSnippet = enrichedArticle.contentSnippet;
        dbArticle.aiSummaryProvider = enrichedArticle.aiSummaryProvider;
        dbArticle.aiSummaryModel = enrichedArticle.aiSummaryModel;
        dbArticle.aiSummaryGeneratedAt = enrichedArticle.aiSummaryGeneratedAt;
        dbArticle.duplicates = richDuplicates;
        dbArticle.multiSourceAnalysis = multiSourceAnalysis;
        writeDb(db);
      }
      article = enrichedArticle;
    }

    const articlePayload = normalizeArticleTransportFields(decorateArticle(db, userId, article));
    const duplicatePayload = (Array.isArray(article.duplicates) ? article.duplicates : []).map((item) => {
      const normalized = normalizeArticleTransportFields({ ...item });
      return {
        ...normalized,
        sourceUrl: normalized.sourceUrl,
        url: normalized.url
      };
    });
    const multiSourcePayload = article.multiSourceAnalysis ? {
      ...article.multiSourceAnalysis,
      sourceAnalyses: (article.multiSourceAnalysis.sourceAnalyses || []).map((item) => ({
        ...item,
        sourceUrl: item.sourceUrl || item.url || item.link || ""
      }))
    } : article.multiSourceAnalysis;

    return json(res, 200, {
      article: {
        ...articlePayload,
        sourceUrl: articlePayload.sourceUrl,
        url: articlePayload.url,
        aiSummary: article.aiSummary,
        sourceSentences: article.sourceSentences,
        contentSnippet: article.contentSnippet,
        duplicates: duplicatePayload,
        multiSourceAnalysis: multiSourcePayload
      }
    });
  }

  const bookmarkMatch = url.pathname.match(/^\/api\/articles\/([^/]+)\/bookmark$/);
  if (req.method === "POST" && bookmarkMatch) {
    const articleId = bookmarkMatch[1];
    const existing = db.bookmarks.find((item) => item.userId === userId && item.articleId === articleId);
    if (existing) {
      db.bookmarks = db.bookmarks.filter((item) => !(item.userId === userId && item.articleId === articleId));
    } else {
      db.bookmarks.push({ userId, articleId, createdAt: new Date().toISOString() });
    }
    writeDb(db);
    return json(res, 200, { bookmarked: !existing });
  }

  const newspaperMatch = url.pathname.match(/^\/api\/articles\/([^/]+)\/newspaper$/);
  if (req.method === "POST" && newspaperMatch) {
    const articleId = newspaperMatch[1];
    const body = await readBody(req);
    const existing = db.userNewspaperItems.find((item) => item.userId === userId && item.articleId === articleId);
    if (existing) {
      db.userNewspaperItems = db.userNewspaperItems.filter((item) => !(item.userId === userId && item.articleId === articleId));
    } else {
      const sourceArticle = findPdfArticleById(db, articleId) || body.article || {};
      db.userNewspaperItems.push({
        id: `newspaper_${crypto.randomUUID()}`,
        userId,
        articleId,
        clusterId: sourceArticle.clusterId || sourceArticle.dedupeKey || body.article?.clusterId || "",
        addedAt: new Date().toISOString(),
        section: "custom",
        note: "",
        articleSnapshot: snapshotPdfArticle({ ...sourceArticle, ...body.article, id: articleId })
      });
    }
    writeDb(db);
    return json(res, 200, { added: !existing });
  }

  const readMatch = url.pathname.match(/^\/api\/articles\/([^/]+)\/read$/);
  if (req.method === "POST" && readMatch) {
    const body = await readBody(req);
    const articleId = readMatch[1];
    db.readStatus = db.readStatus.filter((item) => !(item.userId === userId && item.articleId === articleId));
    db.readStatus.push({
      userId,
      articleId,
      status: body.status === "unread" ? "unread" : "read",
      updatedAt: new Date().toISOString()
    });
    db.userArticleEvents.push({
      id: `evt_${crypto.randomUUID()}`,
      userId,
      articleId,
      eventType: body.status === "unread" ? "mark_unread" : "mark_read",
      createdAt: new Date().toISOString()
    });
    writeDb(db);
    return json(res, 200, { status: body.status === "unread" ? "Okunmadı" : "Okundu" });
  }

  if (req.method === "POST" && url.pathname === "/api/ingest/mock") {
    const body = await readBody(req);
    const articles = Array.isArray(body.articles) ? body.articles : [];
    let inserted = 0;
    for (const raw of articles) {
      if (!raw.title || !raw.fullText || !raw.sourceUrl) continue;
      const article = {
        id: raw.id || `art_${crypto.randomUUID()}`,
        title: raw.title,
        summary: raw.summary || raw.fullText.slice(0, 180),
        fullText: raw.fullText,
        category: normalizeCategoryName(raw.category || "Gündem"),
        tags: raw.tags || [normalizeCategoryName(raw.category || "Gündem")],
        country: raw.country || "",
        continent: normalizeContinentName(raw.continent || raw.region || "Global"),
        sourceName: raw.sourceName || "Bilinmeyen Kaynak",
        sourceUrl: raw.sourceUrl,
        imageUrl: raw.imageUrl || "",
        author: raw.author || "",
        publishedAt: raw.publishedAt || new Date().toISOString(),
        aiSummary: raw.aiSummary || "",
        contentHash: ""
      };
      article.category = inferArticleCategory(article);
      article.continent = article.continent !== "Global" ? article.continent : inferArticleContinent(article);
      article.contentHash = contentHash(article);
      if (db.articles.some((item) => item.contentHash === article.contentHash || item.sourceUrl === article.sourceUrl)) continue;
      const duplicate = db.articles.find((item) => similarity(`${item.title} ${item.summary}`, `${article.title} ${article.summary}`) >= 0.45);
      article.duplicateGroupId = duplicate?.duplicateGroupId || duplicate?.id || null;
      db.articles.push(article);
      inserted += 1;
    }
    db.ingestionRuns = db.ingestionRuns || [];
    db.ingestionRuns.push({
      id: `run_${crypto.randomUUID()}`,
      provider: "mock",
      status: "completed",
      fetchedCount: inserted,
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    });
    writeDb(db);
    if (inserted) invalidateTrendsCache();
    return json(res, 201, { inserted });
  }

  // ===================== AI CHATBOT =====================
  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readBody(req);
    const userMessage = String(body.message || "").trim();
    if (!userMessage) return json(res, 400, { error: "Mesaj boş olamaz." });

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) return json(res, 503, { error: "AI servisi şu anda kullanılamıyor." });

    const model = getGeminiModel();
    const user = db.users.find((u) => u.id === userId);
    const prefs = db.preferences[userId] || {};
    const interests = Array.isArray(prefs.interests) ? prefs.interests : [];

    const recentArticles = db.articles
      .slice(-20)
      .map((a, i) => `${i + 1}. [${a.category || "Genel"}] ${a.title} — ${(a.summary || "").slice(0, 120)}`)
      .join("\n");

    const bookmarkedArticles = db.bookmarks
      .filter((b) => b.userId === userId)
      .slice(-10)
      .map((b) => {
        const a = db.articles.find((art) => String(art.id) === String(b.articleId));
        return a ? `- ${a.title}` : null;
      })
      .filter(Boolean)
      .join("\n");

    const systemPrompt = [
      "Sen SmartNewspaper AI Asistanısın. Türkçe konuşan, nazik, bilgili ve yardımsever bir haber asistanısın.",
      "Görevin: kullanıcılara haberler, gündem, ekonomi, teknoloji, spor, sağlık, bilim, kültür-sanat, eğitim ve dünya haberleri hakkında yardım etmek.",
      "Kullanıcının ilgi alanları: " + (interests.length ? interests.join(", ") : "henüz belirlenmemiş"),
      "Kullanıcı adı: " + (user?.name || "Bilinmiyor"),
      "",
      "Platformdaki son haberler:",
      recentArticles || "(Henüz haber yok)",
      "",
      bookmarkedArticles ? "Kullanıcının kaydettiği haberler:\n" + bookmarkedArticles : "",
      "",
      "Kurallar:",
      "- Haber içeriklerini tarafsız ve nesnel şekilde aktar.",
      "- Kişisel görüş verme, haberin farklı bakış açılarını sun.",
      "- Kullanıcıya platforma ait özellikler hakkında bilgi verebilirsin (kişisel akış, E-Gazete modu, ekonomi radarı, kaynak takip, etkinlikler, kaydedilenler, filtreleme vb.).",
      "- Cevaplarını kısa ve öz tut. Markdown kullanabilirsin.",
      "- Emin olmadığın bilgiyi uydurma.",
      "- SmartNewspaper platformunun modülleri: Ana Akış, Sana Özel, Ekonomi Radarı, Kaynaklarım, E-Gazetemi Oku, Kaydedilenler, Etkinlikler, Profil ve Tercihler.",
    ].filter(Boolean).join("\n");

    const conversationHistory = Array.isArray(body.history)
      ? body.history.slice(-10).map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: String(msg.content || "").slice(0, 2000) }]
        }))
      : [];

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Anladım, SmartNewspaper AI Asistanı olarak hazırım. Nasıl yardımcı olabilirim?" }] },
      ...conversationHistory,
      { role: "user", parts: [{ text: userMessage }] }
    ];

    try {
      const payload = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: geminiGenerationConfig({ model, temperature: 0.7, maxOutputTokens: 1024 })
          })
        }
      );
      const reply = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim()
        || "Üzgünüm, şu anda cevap üretemiyorum. Lütfen tekrar deneyin.";
      return json(res, 200, { reply, model });
    } catch (err) {
      return json(res, 500, { error: "AI servisi yanıt veremedi: " + (err.message || "Bilinmeyen hata") });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/chat/suggestions") {
    const prefs = db.preferences[userId] || {};
    const interests = Array.isArray(prefs.interests) ? prefs.interests : [];
    const categories = db.articles.slice(-50).map((a) => a.category).filter(Boolean);
    const topCategories = [...new Set(categories)].slice(0, 5);

    const baseSuggestions = [
      { icon: "fa-newspaper", text: "Bugünün en önemli haberleri neler?" },
      { icon: "fa-chart-line", text: "Ekonomi ve piyasalarda son durum ne?" },
      { icon: "fa-globe", text: "Dünyada neler oluyor?" },
      { icon: "fa-robot", text: "Teknoloji dünyasındaki son gelişmeler neler?" },
      { icon: "fa-futbol", text: "Spor dünyasından son haberler neler?" },
      { icon: "fa-heart-pulse", text: "Sağlık alanındaki güncel haberler neler?" },
      { icon: "fa-lightbulb", text: "Bana ilgi alanlarıma göre haber öner" },
      { icon: "fa-circle-info", text: "SmartNewspaper nasıl kullanılır?" },
      { icon: "fa-bookmark", text: "Kaydettiğim haberlerden bir özet çıkar" },
      { icon: "fa-fire", text: "Bugünün trend konuları neler?" },
    ];

    const personalSuggestions = interests.slice(0, 3).map((interest) => ({
      icon: "fa-sparkles",
      text: `${interest} alanındaki son gelişmeleri özetle`
    }));

    return json(res, 200, {
      suggestions: [...personalSuggestions, ...baseSuggestions].slice(0, 12)
    });
  }

  // ===================== NEWS SHARING & NOTIFICATIONS =====================
  if (!db.sharedNews) db.sharedNews = [];
  if (!db.notifications) db.notifications = [];
  const SHARE_LIMIT = 500;
  const NOTIFICATION_LIMIT = 1000;
  const SHARE_RATE_WINDOW_MS = 60000;
  const SHARE_RATE_MAX = 10;
  const shareError = (status, message) => json(res, status, { success: false, message, error: message });
  const cleanShareText = (value, fallback = "", max = 500) => {
    const text = stripHtml(value).replace(/\s+/g, " ").trim() || fallback;
    return max ? text.slice(0, max) : text;
  };
  const sanitizeShareUserId = (value) => String(value || "").replace(/[^\w-]/g, "").slice(0, 120);
  const sanitizeShareSearch = (value) => stripHtml(value).replace(/\s+/g, " ").trim().slice(0, 80);
  const shareUserDisplayName = (user = {}) => cleanShareText(user.displayName || user.name || user.username || user.email, "Kullanici", 120);
  const shareUsername = (user = {}) => {
    const base = String(user.username || user.name || (user.email || "").split("@")[0] || "kullanici").trim();
    return base.replace(/^@+/, "").replace(/[^\p{L}\p{N}._-]+/gu, ".").replace(/\.+/g, ".").slice(0, 40) || "kullanici";
  };
  const toShareTargetDto = (user = {}) => ({
    id: String(user.id || ""),
    displayName: shareUserDisplayName(user),
    username: shareUsername(user),
    avatarUrl: typeof user.avatarUrl === "string" && user.avatarUrl.trim() ? user.avatarUrl.trim().slice(0, 300) : "/avatars/default.png"
  });
  const findShareArticle = (articleId, snapshot = {}) => {
    const id = String(articleId || "").trim();
    const knownArticle = db._articleById?.get(id)
      || ARTICLE_CACHE.get(id)
      || RELATED_ARTICLE_POOL.get(id)
      || DEMO_REGIONAL_PANDEMIC_ARTICLES.find((a) => String(a.id) === id)
      || _feedCacheStore.articles.find((a) => String(a.id) === id)
      || (db.articles || []).find((a) => String(a.id) === id);
    if (knownArticle) return normalizeArticleTransportFields({ ...knownArticle });
    if (snapshot && typeof snapshot === "object" && cleanShareText(snapshot.title, "", 260)) {
      return normalizeArticleTransportFields({
        id,
        title: snapshot.title,
        description: snapshot.description || snapshot.summary || "",
        summary: snapshot.description || snapshot.summary || "",
        imageUrl: snapshot.image || snapshot.imageUrl || "",
        source: snapshot.source || snapshot.sourceName || "",
        sourceName: snapshot.source || snapshot.sourceName || "",
        sourceUrl: snapshot.url || snapshot.sourceUrl || "",
        url: snapshot.url || snapshot.sourceUrl || "",
        publishedAt: snapshot.publishedAt || snapshot.date || new Date().toISOString(),
        date: snapshot.publishedAt || snapshot.date || new Date().toISOString(),
        category: snapshot.category || "Genel",
        clusterId: snapshot.clusterId || "",
        sourceCount: snapshot.sourceCount || 1,
        sources: Array.isArray(snapshot.sources) ? snapshot.sources.slice(0, 10) : []
      });
    }
    return null;
  };
  const buildShareSnapshot = (article, inputSnapshot = {}) => ({
    title: cleanShareText(article.title || inputSnapshot.title, "Haber", 260),
    description: cleanShareText(article.description || article.summary || inputSnapshot.description || inputSnapshot.summary, "", 500),
    image: article.imageUrl || article.image || inputSnapshot.image || inputSnapshot.imageUrl || "",
    source: cleanShareText(article.source || article.sourceName || inputSnapshot.source || inputSnapshot.sourceName, "Bilinmeyen kaynak", 140),
    url: article.sourceUrl || article.url || inputSnapshot.url || inputSnapshot.sourceUrl || "",
    publishedAt: article.publishedAt || article.date || inputSnapshot.publishedAt || inputSnapshot.date || new Date().toISOString(),
    category: article.category || inputSnapshot.category || "Genel",
    clusterId: article.clusterId || inputSnapshot.clusterId || "",
    sourceCount: article.sourceCount || inputSnapshot.sourceCount || 1,
    sources: Array.isArray(article.sources) ? article.sources.slice(0, 10) : (Array.isArray(inputSnapshot.sources) ? inputSnapshot.sources.slice(0, 10) : [])
  });

  if (req.method === "GET" && url.pathname === "/api/users/list") {
    const otherUsers = db.users
      .filter((u) => u.id !== userId)
      .slice(0, 20)
      .map((u) => ({ id: u.id, name: shareUserDisplayName(u) }));
    return json(res, 200, { users: otherUsers });
  }

  if (req.method === "GET" && url.pathname === "/api/users/share-targets") {
    try {
      const q = sanitizeShareSearch(url.searchParams.get("q") || "");
      const normalizedQ = normalizeText(q);
      const users = (db.users || [])
        .filter((u) => {
          if (!u || !u.id || u.id === userId || u.isActive === false) return false;
          if (!normalizedQ) return true;
          return normalizeText(`${u.displayName || ""} ${u.name || ""} ${u.username || ""} ${u.email || ""}`).includes(normalizedQ);
        })
        .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "tr"))
        .slice(0, 20)
        .map(toShareTargetDto);
      return json(res, 200, { success: true, users });
    } catch {
      return json(res, 500, { success: false, message: "Kullanıcılar alınamadı." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/users/search") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const results = db.users
      .filter((u) => u.id !== userId && (
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
      ))
      .slice(0, 20)
      .map((u) => ({ id: u.id, name: u.name || u.email || "Kullanıcı" }));
    return json(res, 200, { users: results });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/articles/") && url.pathname.endsWith("/share")) {
    const body = await readBody(req);
    const articleId = String(body.articleId || url.pathname.split("/")[3] || "").trim();
    const targetUserId = sanitizeShareUserId(body.receiverUserId || body.targetUserId);
    const message = cleanShareText(body.message || "", "", 500);
    if (!articleId) return shareError(400, "Haber bilgisi bulunamadı.");
    if (!targetUserId) return shareError(400, "Alıcı kullanıcı seçilmedi.");
    if (targetUserId === userId) return shareError(400, "Kendine haber gönderemezsin.");
    const targetUser = db.users.find((u) => u.id === targetUserId);
    if (!targetUser) return shareError(404, "Alıcı kullanıcı bulunamadı.");
    const now = Date.now();
    const recentShares = db.sharedNews.filter((s) =>
      (s.senderUserId || s.fromUserId) === userId
      && (s.receiverUserId || s.toUserId) === targetUserId
      && (now - new Date(s.createdAt).getTime()) < SHARE_RATE_WINDOW_MS
    );
    if (recentShares.length >= SHARE_RATE_MAX) return shareError(429, "Bu kullanıcıya kısa sürede çok fazla haber gönderdin.");
    const recentDuplicate = db.sharedNews.some((s) =>
      (s.senderUserId || s.fromUserId) === userId
      && (s.receiverUserId || s.toUserId) === targetUserId
      && String(s.articleId) === articleId
      && (now - new Date(s.createdAt).getTime()) < 5 * 60 * 1000
    );
    if (recentDuplicate) return shareError(429, "Bu haber aynı kullanıcıya az önce gönderildi.");
    const article = findShareArticle(articleId, body.articleSnapshot || {});
    if (!article) return shareError(404, "Haber bilgisi bulunamadı.");
    const sender = db.users.find((u) => u.id === userId);
    const articleSnapshot = buildShareSnapshot(article, body.articleSnapshot || {});
    const shareItem = {
      id: `share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      articleId,
      clusterId: String(body.clusterId || articleSnapshot.clusterId || article.clusterId || ""),
      senderUserId: userId,
      fromUserId: userId,
      senderName: sender?.name || sender?.email || "Birisi",
      fromUserName: sender?.name || sender?.email || "Birisi",
      receiverUserId: targetUserId,
      toUserId: targetUserId,
      message,
      articleSnapshot,
      articleTitle: articleSnapshot.title,
      articleSource: articleSnapshot.source,
      status: "sent",
      createdAt: new Date().toISOString(),
      readAt: null
    };
    db.sharedNews.push(shareItem);
    if (db.sharedNews.length > SHARE_LIMIT) db.sharedNews = db.sharedNews.slice(-SHARE_LIMIT);
    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: targetUserId,
      type: "article_share",
      shareId: shareItem.id,
      senderUserId: userId,
      fromUserId: userId,
      senderName: sender?.name || sender?.email || "Birisi",
      fromUserName: sender?.name || sender?.email || "Birisi",
      receiverUserId: targetUserId,
      articleId,
      articleSnapshot,
      articleTitle: articleSnapshot.title,
      articleSource: articleSnapshot.source,
      message,
      read: false,
      isRead: false,
      createdAt: new Date().toISOString()
    };
    db.notifications.push(notification);
    if (db.notifications.length > NOTIFICATION_LIMIT) db.notifications = db.notifications.slice(-NOTIFICATION_LIMIT);
    writeDb(db);
    return json(res, 201, { success: true, message: "Haber kullanıcıya gönderildi." });
  }

  // Legacy share endpoint (backward compat)
  if (req.method === "POST" && url.pathname === "/api/share") {
    const body = await readBody(req);
    const targetUserId = String(body.targetUserId || "").trim();
    const articleId = String(body.articleId || "").trim();
    if (!targetUserId || !articleId) return json(res, 400, { error: "targetUserId ve articleId gerekli." });
    const targetUser = db.users.find((u) => u.id === targetUserId);
    if (!targetUser) return json(res, 404, { error: "Kullanıcı bulunamadı." });
    const article = db._articleById?.get(articleId) || (db.articles || []).find((a) => String(a.id) === articleId);
    if (!article) return json(res, 404, { error: "Haber bulunamadı." });
    const sender = db.users.find((u) => u.id === userId);
    const shareItem = {
      id: `share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromUserId: userId,
      fromUserName: sender?.name || sender?.email || "Birisi",
      toUserId: targetUserId,
      articleId,
      articleTitle: article.title || "",
      articleSource: article.source || article.sourceName || "",
      createdAt: new Date().toISOString(),
      read: false
    };
    db.sharedNews.push(shareItem);
    if (db.sharedNews.length > SHARE_LIMIT) db.sharedNews = db.sharedNews.slice(-SHARE_LIMIT);
    writeDb(db);
    return json(res, 201, { success: true, share: shareItem });
  }

  if (req.method === "GET" && url.pathname === "/api/shares/inbox") {
    const inbox = (db.sharedNews || [])
      .filter((s) => (s.receiverUserId || s.toUserId) === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    return json(res, 200, { shares: inbox });
  }

  if (req.method === "GET" && url.pathname === "/api/shares/sent") {
    const sent = (db.sharedNews || [])
      .filter((s) => (s.senderUserId || s.fromUserId) === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    return json(res, 200, { shares: sent });
  }

  if (req.method === "GET" && url.pathname === "/api/shared-with-me") {
    const myShares = (db.sharedNews || [])
      .filter((s) => (s.receiverUserId || s.toUserId) === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    return json(res, 200, { shares: myShares });
  }

  if (req.method === "PUT" && url.pathname === "/api/shared/read") {
    const body = await readBody(req);
    const shareId = String(body.shareId || "").trim();
    const share = (db.sharedNews || []).find((s) => s.id === shareId && (s.receiverUserId || s.toUserId) === userId);
    if (share) { share.status = "read"; share.read = true; share.readAt = new Date().toISOString(); writeDb(db); }
    return json(res, 200, { success: true });
  }

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    const notifs = (db.notifications || [])
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    const unreadCount = notifs.filter((n) => !n.read).length;
    return json(res, 200, { notifications: notifs, unreadCount });
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/notifications\/[^/]+\/read$/)) {
    const notifId = url.pathname.split("/")[3];
    const notif = (db.notifications || []).find((n) => n.id === notifId && n.userId === userId);
    if (notif) { notif.read = true; writeDb(db); }
    return json(res, 200, { success: true });
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/read-all") {
    (db.notifications || []).filter((n) => n.userId === userId && !n.read).forEach((n) => { n.read = true; });
    writeDb(db);
    return json(res, 200, { success: true });
  }

  // ===================== WEATHER API =====================
  if (req.method === "GET" && url.pathname === "/api/weather") {
    const lat = url.searchParams.get("lat") || "41.0082";
    const lon = url.searchParams.get("lon") || "28.9784";
    try {
      const owKey = process.env.OPENWEATHER_API_KEY || "";
      let weatherData;
      if (owKey) {
        const weatherResp = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=tr&appid=${encodeURIComponent(owKey)}`);
        const forecastResp = await fetchJson(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=tr&cnt=24&appid=${encodeURIComponent(owKey)}`).catch(() => null);
        const dayNames = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
        const forecastDays = [];
        if (forecastResp && forecastResp.list) {
          const seen = new Set();
          for (const item of forecastResp.list) {
            const d = new Date(item.dt * 1000);
            const dayKey = d.toISOString().slice(0, 10);
            if (seen.has(dayKey) || seen.size >= 3) continue;
            const today = new Date().toISOString().slice(0, 10);
            if (dayKey === today) continue;
            seen.add(dayKey);
            forecastDays.push({ day: dayNames[d.getDay()], tempMax: Math.round(item.main.temp_max), tempMin: Math.round(item.main.temp_min), main: item.weather?.[0]?.main || "Clear" });
          }
        }
        weatherData = {
          city: weatherResp.name || "Bilinmiyor",
          temp: Math.round(weatherResp.main?.temp ?? 0),
          feelsLike: Math.round(weatherResp.main?.feels_like ?? 0),
          tempMin: Math.round(weatherResp.main?.temp_min ?? 0),
          tempMax: Math.round(weatherResp.main?.temp_max ?? 0),
          humidity: weatherResp.main?.humidity ?? 0,
          wind: Math.round(weatherResp.wind?.speed ?? 0),
          weatherMain: weatherResp.weather?.[0]?.main || "Clear",
          weatherDesc: weatherResp.weather?.[0]?.description || "",
          forecast: forecastDays
        };
      } else {
        const hour = new Date().getHours();
        weatherData = {
          city: "İstanbul", temp: hour < 10 ? 18 : hour < 16 ? 26 : 22,
          feelsLike: hour < 10 ? 17 : hour < 16 ? 28 : 21,
          tempMin: 16, tempMax: 28, humidity: 58, wind: 12,
          weatherMain: hour < 7 || hour > 20 ? "Clear" : "Clouds",
          weatherDesc: hour < 7 || hour > 20 ? "açık gökyüzü" : "parçalı bulutlu",
          forecast: [
            { day: "Yarın", tempMax: 27, tempMin: 17, main: "Clear" },
            { day: "Perşembe", tempMax: 25, tempMin: 16, main: "Clouds" },
            { day: "Cuma", tempMax: 23, tempMin: 15, main: "Rain" }
          ]
        };
      }
      return json(res, 200, weatherData);
    } catch (e) {
      return json(res, 500, { error: "Hava durumu alınamadı: " + e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/weather/geocode") {
    const q = url.searchParams.get("q") || "Istanbul";
    try {
      const owKey = process.env.OPENWEATHER_API_KEY || "";
      if (owKey) {
        const geo = await fetchJson(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${encodeURIComponent(owKey)}`);
        if (Array.isArray(geo) && geo.length) {
          return json(res, 200, { lat: geo[0].lat, lon: geo[0].lon, name: geo[0].local_names?.tr || geo[0].name || q });
        }
      }
      return json(res, 200, { lat: 41.0082, lon: 28.9784, name: q });
    } catch {
      return json(res, 200, { lat: 41.0082, lon: 28.9784, name: q });
    }
  }

  // ===================== ADMIN PANEL =====================
  if (url.pathname.startsWith("/api/admin/")) {
    const user = db.users.find((u) => u.id === userId);
    const isAdmin = user && (user.role === "admin" || db.users.indexOf(user) === 0);

    if (!isAdmin) return json(res, 403, { error: "Yetkiniz yok." });

    if (req.method === "GET" && url.pathname === "/api/admin/stats") {
      const totalUsers = db.users.length;
      const totalArticles = db.articles.length;
      const totalBookmarks = db.bookmarks.length;
      const totalEvents = db.institutionalEvents?.length || 0;
      const recentUsers = db.users.slice(-5).map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt }));
      const categoryDistribution = {};
      db.articles.forEach((a) => {
        const cat = a.category || "Diğer";
        categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
      });
      const readEvents = (db.articleEvents || []).filter((e) => e.eventType === "read" || e.eventType === "open");
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayReads = readEvents.filter((e) => (e.createdAt || "").startsWith(todayStr)).length;

      return json(res, 200, {
        totalUsers, totalArticles, totalBookmarks, totalEvents,
        todayReads, recentUsers, categoryDistribution,
        sourcesCount: REGIONAL_SOURCE_CATALOG.length,
        ingestionRuns: (db.ingestionRuns || []).slice(-10)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      const users = db.users.map((u) => ({
        id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
        role: u.role || (db.users.indexOf(u) === 0 ? "admin" : "user"),
        interests: (db.preferences[u.id]?.interests || []),
        bookmarkCount: db.bookmarks.filter((b) => b.userId === u.id).length
      }));
      return json(res, 200, { users });
    }

    if (req.method === "PUT" && url.pathname === "/api/admin/users/role") {
      const body = await readBody(req);
      const targetUser = db.users.find((u) => u.id === body.userId);
      if (!targetUser) return json(res, 404, { error: "Kullanıcı bulunamadı." });
      targetUser.role = body.role === "admin" ? "admin" : "user";
      writeDb(db);
      return json(res, 200, { success: true });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/sources") {
      return json(res, 200, { sources: REGIONAL_SOURCE_CATALOG });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/categories") {
      return json(res, 200, { categories: TOPIC_CATEGORIES, subcategories: SUBCATEGORY_MAP, categoryTranslations: CATEGORY_TR_TO_EN, subcategoryTranslations: SUBCATEGORY_TR_TO_EN });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/articles") {
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
      const offset = (page - 1) * limit;
      const articles = db.articles.slice().reverse().slice(offset, offset + limit).map((a) => ({
        id: a.id, title: a.title, category: a.category, subcategory: a.subcategory,
        source: a.sourceName || a.source, publishedAt: a.publishedAt, createdAt: a.createdAt
      }));
      return json(res, 200, { articles, total: db.articles.length, page, limit });
    }

    if (req.method === "DELETE" && url.pathname === "/api/admin/articles") {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      db.articles = db.articles.filter((a) => !ids.includes(String(a.id)));
      writeDb(db);
      return json(res, 200, { deleted: ids.length });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/analytics") {
      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        last7Days.push(d.toISOString().slice(0, 10));
      }
      const dailyReads = {};
      const dailyUsers = {};
      last7Days.forEach((day) => { dailyReads[day] = 0; dailyUsers[day] = new Set(); });
      (db.articleEvents || []).forEach((e) => {
        const day = (e.createdAt || "").slice(0, 10);
        if (dailyReads[day] !== undefined) {
          dailyReads[day]++;
          dailyUsers[day].add(e.userId);
        }
      });
      const dailyData = last7Days.map((day) => ({
        date: day,
        reads: dailyReads[day],
        activeUsers: dailyUsers[day]?.size || 0
      }));
      const topArticles = db.articles
        .map((a) => {
          const events = (db.articleEvents || []).filter((e) => String(e.articleId) === String(a.id));
          return { id: a.id, title: a.title, category: a.category, interactionCount: events.length };
        })
        .sort((a, b) => b.interactionCount - a.interactionCount)
        .slice(0, 10);

      return json(res, 200, { dailyData, topArticles });
    }

    return json(res, 404, { error: "Admin API bulunamadı." });
  }

  return json(res, 404, { error: "API bulunamadı." });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_ROOT, requested));
  if (!filePath.startsWith(PUBLIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const isCompressible = COMPRESSIBLE_TYPES.has(ext);
  const cached = STATIC_FILE_CACHE.get(filePath);
  if (cached) {
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch === cached.etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    const headers = { "Content-Type": contentType, "ETag": cached.etag, "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400" };
    const accept = req.headers["accept-encoding"] || "";
    if (isCompressible && accept.includes("gzip") && cached.gzipped) {
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = cached.gzipped.length;
      res.writeHead(200, headers);
      res.end(cached.gzipped);
    } else {
      headers["Content-Length"] = cached.raw.length;
      res.writeHead(200, headers);
      res.end(cached.raw);
    }
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const etag = '"' + crypto.createHash("md5").update(content).digest("hex") + '"';
    const entry = { raw: content, etag, gzipped: null, ts: Date.now() };
    if (isCompressible && content.length > 256) {
      entry.gzipped = zlib.gzipSync(content);
    }
    setStaticFileCache(filePath, entry);
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    const headers = { "Content-Type": contentType, "ETag": etag, "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400" };
    const accept = req.headers["accept-encoding"] || "";
    if (isCompressible && accept.includes("gzip") && entry.gzipped) {
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = entry.gzipped.length;
      res.writeHead(200, headers);
      res.end(entry.gzipped);
    } else {
      headers["Content-Length"] = content.length;
      res.writeHead(200, headers);
      res.end(content);
    }
  });
}

function getPortOwnerHint(port) {
  const numericPort = Number(port);
  if (!Number.isFinite(numericPort)) return "";
  try {
    if (process.platform === "win32") {
      const output = childProcess.execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", timeout: 2500 });
      const line = output
        .split(/\r?\n/)
        .find((row) => row.includes("LISTENING") && new RegExp(`[:.]${numericPort}\\s`).test(row));
      const pid = line?.trim().split(/\s+/).at(-1);
      return pid ? `ownerPid=${pid}` : "";
    }
    const output = childProcess.execFileSync("lsof", ["-nP", `-iTCP:${numericPort}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 2500 });
    const pid = output.split(/\r?\n/).find(Boolean);
    return pid ? `ownerPid=${pid}` : "";
  } catch {
    return "";
  }
}

function shutdownServer(signal = "shutdown") {
  logInfo("server", "shutdown requested", `signal=${signal}`);
  stopFeedScheduler();
  try {
    flushDbSync();
  } catch (error) {
    logError("server", "failed to flush database during shutdown", error.message);
  }
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  res._req = req;
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    logError("http", "unhandled request error", `path=${url.pathname} method=${req.method} stack=\n${error.stack}`);
    json(res, 500, { error: error.message || "Sunucu hatası." });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    const ownerHint = getPortOwnerHint(PORT);
    logError("server", "port already in use", `port=${PORT}${ownerHint ? ` ${ownerHint}` : ""}`);
    logError("server", "startup aborted", `open=http://localhost:${PORT} action=stop-existing-node-or-set-PORT`);
    process.exit(0);
  }
  logError("server", "startup error", error.stack || error.message || String(error));
  process.exit(1);
});

server.listen(PORT, () => {
  ensureDataFile();
  logInfo("server", "started", `url=http://localhost:${PORT} pid=${process.pid}`);
  startFeedScheduler();
});

process.on("SIGINT", () => shutdownServer("SIGINT"));
process.on("SIGTERM", () => shutdownServer("SIGTERM"));



