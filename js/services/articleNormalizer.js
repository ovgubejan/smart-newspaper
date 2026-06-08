/**
 * Article normalization pipeline — pure functions, no DOM, no global state.
 * ES Module; imported by frontend services and tests.
 *
 * Responsibilities:
 *  - Preserve original-language data alongside optional translations
 *  - Derive locale-aware display fields
 *  - Heuristic named entity extraction (people, orgs, locations, countries, diseases, events, topics)
 *  - Detect event region (where the event happened) vs source region (where the publisher is)
 *  - Backward compatibility for legacy articles that only have title/summary
 */

import { REGION_KEYWORDS } from "../utils/regionKeywords.js";

// ─── Canonical regions ────────────────────────────────────────────────────────

const CANONICAL_REGIONS = [
  "global", "europe", "asia", "africa",
  "north-america", "south-america", "oceania", "middle-east", "turkey",
];

// ─── Language detection ───────────────────────────────────────────────────────
// Ordered by specificity — first match wins.

const LANG_DETECTORS = [
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

/**
 * Detect the original language of an article.
 * Priority: explicit source catalog language > text heuristic > "tr" fallback.
 */
export function detectOriginalLanguage(article = {}, sourceMeta = {}) {
  const explicit = sourceMeta.language || article.sourceLanguage;
  if (explicit) return explicit;

  const sample = (
    String(article.title || article.originalTitle || "").slice(0, 300) +
    " " +
    String(article.summary || article.originalSummary || "").slice(0, 200)
  ).trim();
  if (!sample) return "tr";

  for (const [lang, pattern] of LANG_DETECTORS) {
    if (pattern.test(sample)) return lang;
  }
  return "tr";
}

// ─── Country lookup ───────────────────────────────────────────────────────────
// Multi-language name variants → {code, region, label}

const COUNTRY_LOOKUP = [
  // North America
  { names: ["united states", "usa", "u.s.", "america", "abd", "washington dc", "white house"], code: "US", region: "north-america", label: "ABD" },
  { names: ["canada", "kanada", "ottawa", "toronto"], code: "CA", region: "north-america", label: "Kanada" },
  { names: ["mexico", "meksika", "mexico city"], code: "MX", region: "north-america", label: "Meksika" },
  // Europe
  { names: ["united kingdom", "uk", "britain", "england", "ingiltere", "londra", "london"], code: "GB", region: "europe", label: "Birleşik Krallık" },
  { names: ["germany", "almanya", "deutschland", "berlin", "munich", "münchen"], code: "DE", region: "europe", label: "Almanya" },
  { names: ["france", "fransa", "paris", "marseille"], code: "FR", region: "europe", label: "Fransa" },
  { names: ["italy", "italya", "italia", "rome", "roma", "milan", "milano"], code: "IT", region: "europe", label: "İtalya" },
  { names: ["spain", "ispanya", "madrid", "barcelona"], code: "ES", region: "europe", label: "İspanya" },
  { names: ["ukraine", "ukrayna", "kyiv", "kiev", "zelensky", "zelenskyy"], code: "UA", region: "europe", label: "Ukrayna" },
  { names: ["russia", "rusya", "moscow", "moskova", "putin", "kremlin"], code: "RU", region: "europe", label: "Rusya" },
  { names: ["poland", "polonya", "warsaw", "varşova"], code: "PL", region: "europe", label: "Polonya" },
  { names: ["netherlands", "hollanda", "amsterdam", "the hague"], code: "NL", region: "europe", label: "Hollanda" },
  { names: ["greece", "yunanistan", "athens", "atina"], code: "GR", region: "europe", label: "Yunanistan" },
  { names: ["sweden", "isveç", "stockholm"], code: "SE", region: "europe", label: "İsveç" },
  { names: ["norway", "norveç", "oslo"], code: "NO", region: "europe", label: "Norveç" },
  // Asia
  { names: ["china", "çin", "cin", "beijing", "pekin", "shanghai", "xi jinping", "xinhua"], code: "CN", region: "asia", label: "Çin" },
  { names: ["japan", "japonya", "tokyo", "osaka", "kyoto"], code: "JP", region: "asia", label: "Japonya" },
  { names: ["india", "hindistan", "new delhi", "delhi", "mumbai", "modi"], code: "IN", region: "asia", label: "Hindistan" },
  { names: ["south korea", "güney kore", "guney kore", "seoul", "seul", "busan"], code: "KR", region: "asia", label: "Güney Kore" },
  { names: ["north korea", "kuzey kore", "pyongyang", "kim jong"], code: "KP", region: "asia", label: "Kuzey Kore" },
  { names: ["pakistan", "islamabad", "karachi", "lahore"], code: "PK", region: "asia", label: "Pakistan" },
  { names: ["singapore", "singapur"], code: "SG", region: "asia", label: "Singapur" },
  { names: ["hong kong"], code: "HK", region: "asia", label: "Hong Kong" },
  { names: ["indonesia", "endonezya", "jakarta"], code: "ID", region: "asia", label: "Endonezya" },
  { names: ["malaysia", "malezya", "kuala lumpur"], code: "MY", region: "asia", label: "Malezya" },
  { names: ["thailand", "tayland", "bangkok"], code: "TH", region: "asia", label: "Tayland" },
  // Middle East
  { names: ["israel", "israil", "tel aviv", "jerusalem", "kudüs", "kudus", "netanyahu"], code: "IL", region: "middle-east", label: "İsrail" },
  { names: ["palestine", "filistin", "gaza", "gazze", "west bank", "ramallah", "hamas"], code: "PS", region: "middle-east", label: "Filistin" },
  { names: ["iran", "tehran", "tahran", "khamenei", "hamaney"], code: "IR", region: "middle-east", label: "İran" },
  { names: ["iraq", "irak", "baghdad", "bağdat", "erbil"], code: "IQ", region: "middle-east", label: "Irak" },
  { names: ["saudi arabia", "suudi arabistan", "riyadh", "riyad", "mbs", "bin salman"], code: "SA", region: "middle-east", label: "Suudi Arabistan" },
  { names: ["syria", "suriye", "damascus", "şam", "halep", "aleppo"], code: "SY", region: "middle-east", label: "Suriye" },
  { names: ["lebanon", "lübnan", "lubnan", "beirut", "beyrut", "hezbollah"], code: "LB", region: "middle-east", label: "Lübnan" },
  { names: ["qatar", "katar", "doha"], code: "QA", region: "middle-east", label: "Katar" },
  { names: ["uae", "bae", "dubai", "abu dhabi", "abu dabi"], code: "AE", region: "middle-east", label: "BAE" },
  { names: ["yemen"], code: "YE", region: "middle-east", label: "Yemen" },
  // Africa
  { names: ["egypt", "mısır", "misir", "cairo", "kahire", "sisi"], code: "EG", region: "africa", label: "Mısır" },
  { names: ["south africa", "güney afrika", "guney afrika", "johannesburg", "cape town", "pretoria"], code: "ZA", region: "africa", label: "Güney Afrika" },
  { names: ["nigeria", "nijerya", "lagos", "abuja"], code: "NG", region: "africa", label: "Nijerya" },
  { names: ["kenya", "nairobi"], code: "KE", region: "africa", label: "Kenya" },
  { names: ["morocco", "fas", "rabat", "casablanca"], code: "MA", region: "africa", label: "Fas" },
  { names: ["ethiopia", "etiyopya", "addis ababa"], code: "ET", region: "africa", label: "Etiyopya" },
  { names: ["sudan", "khartoum", "hartum"], code: "SD", region: "africa", label: "Sudan" },
  { names: ["algeria", "cezayir", "algiers"], code: "DZ", region: "africa", label: "Cezayir" },
  // South America
  { names: ["brazil", "brezilya", "brasil", "brasilia", "são paulo", "sao paulo", "rio de janeiro", "lula"], code: "BR", region: "south-america", label: "Brezilya" },
  { names: ["argentina", "arjantin", "buenos aires", "milei"], code: "AR", region: "south-america", label: "Arjantin" },
  { names: ["chile", "sili", "şili", "santiago"], code: "CL", region: "south-america", label: "Şili" },
  { names: ["colombia", "kolombiya", "bogota", "bogotá"], code: "CO", region: "south-america", label: "Kolombiya" },
  { names: ["venezuela", "caracas", "maduro"], code: "VE", region: "south-america", label: "Venezuela" },
  { names: ["peru", "lima"], code: "PE", region: "south-america", label: "Peru" },
  // Oceania
  { names: ["australia", "avustralya", "sydney", "melbourne", "canberra"], code: "AU", region: "oceania", label: "Avustralya" },
  { names: ["new zealand", "yeni zelanda", "wellington", "auckland"], code: "NZ", region: "oceania", label: "Yeni Zelanda" },
  // Turkey
  { names: ["turkey", "türkiye", "turkiye", "ankara", "istanbul", "izmir", "erdoğan", "erdogan"], code: "TR", region: "turkey", label: "Türkiye" },
];

// ─── Named entity support data ────────────────────────────────────────────────

const DISEASE_KEYWORDS = [
  "covid", "coronavirus", "mpox", "monkeypox", "ebola", "sars", "mers",
  "influenza", "flu", "grippe", "dengue", "malaria", "sıtma", "kolera",
  "cholera", "tuberculosis", "tüberküloz", "hiv", "aids", "kanser", "cancer",
  "pandemi", "pandemic", "salgın", "salgin", "epidemic",
];

const KNOWN_ORGS = new Set([
  "chp", "akp", "mhp", "dem", "iyi", "tbmm", "trt", "tsk", "mgk", "meb",
  "tcmb", "spk", "bddk", "epdk", "btk", "ysk", "nato", "eu", "un", "bm",
  "imf", "worldbank", "wto", "who", "ioc", "uefa", "fifa", "aa", "iha", "dha",
  "reuters", "ap", "afp", "bbc", "cnn", "tff", "bist", "tpao",
  "pentagon", "cia", "fbi", "kremlin", "amazon", "google", "apple",
  "microsoft", "meta", "tesla", "openai", "spacex", "nvidia", "samsung",
  "huawei", "alibaba", "tencent",
]);

const EVENT_CLASSIFIERS = [
  ["Siyasi Toplantı", ["summit", "zirve", "meeting", "görüşme", "conference", "konferans"]],
  ["Askeri Operasyon", ["military", "saldırı", "attack", "strike", "bombing", "operasyon", "operation"]],
  ["Ekonomik Veri", ["inflation", "enflasyon", "gdp", "economic", "faiz", "rate", "interest", "budget"]],
  ["Seçim", ["election", "seçim", "vote", "ballot", "campaign", "kampanya", "referendum"]],
  ["Afet", ["earthquake", "deprem", "flood", "sel", "fire", "yangın", "disaster", "hurricane", "kasırga"]],
  ["Spor Müsabakası", ["championship", "şampiyona", "tournament", "cup", "kupa", "liga", "league", "final"]],
  ["Diplomatik Kriz", ["crisis", "kriz", "sanctions", "yaptırım", "expel", "sınır dışı"]],
];

// Proper-noun words that should not be classified as people names
const ENTITY_STOPWORDS = new Set([
  "The", "New", "North", "South", "East", "West", "United", "European", "Middle",
  "Yeni", "Kuzey", "Güney", "Doğu", "Batı", "Orta", "Son", "Haber",
  "BBC", "CNN", "TRT", "NHK", "Reuters", "Xinhua", "AFP", "AP",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "June", "July", "August",
  "September", "October", "November", "December",
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect countries mentioned in the article text.
 * Returns [{name, code, region}] sorted by detection order.
 */
export function detectMentionedCountries(article) {
  const text = _articleSearchText(article).toLowerCase();
  if (!text.trim()) return [];

  const found = [];
  const seenCodes = new Set();

  for (const country of COUNTRY_LOOKUP) {
    if (seenCodes.has(country.code)) continue;
    const hit = country.names.some((name) => {
      if (name.length <= 3) return new RegExp(`\\b${name}\\b`, "i").test(text);
      return text.includes(name);
    });
    if (hit) {
      found.push({ name: country.label, code: country.code, region: country.region });
      seenCodes.add(country.code);
    }
  }
  return found;
}

/**
 * Detect canonical regions mentioned in the article.
 * Uses both REGION_KEYWORDS keyword matching and country-to-region mapping.
 * Returns canonical hyphen-format region values.
 */
export function detectMentionedRegions(article) {
  const text = _articleSearchText(article).toLowerCase();
  const found = new Set();

  // From country detection (fastest to region lookup)
  for (const c of detectMentionedCountries(article)) {
    if (c.region) found.add(c.region);
  }

  // From REGION_KEYWORDS (which use underscore format internally)
  for (const [regionKey, keywords] of Object.entries(REGION_KEYWORDS)) {
    const canonical = regionKey.replace(/_/g, "-"); // north_america → north-america
    if (!CANONICAL_REGIONS.includes(canonical)) continue;
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        found.add(canonical);
        break;
      }
    }
  }

  return [...found].filter((r) => CANONICAL_REGIONS.includes(r));
}

/**
 * Detect the region where the news event occurred — separate from sourceRegion.
 * BBC (global/europe) reporting on Gaza → detectedEventRegion = "middle-east".
 */
export function detectEventRegion(article) {
  const sourceRegion = article.sourceRegion || "global";
  const mentioned = detectMentionedRegions(article);

  // Prefer a non-source, non-global region
  const external = mentioned.find((r) => r !== sourceRegion && r !== "global");
  if (external) return external;

  // If source region itself is mentioned or nothing detected
  return mentioned[0] || sourceRegion;
}

/**
 * Extract named entities from article text (heuristic/regex, no ML).
 * Returns { people, organizations, locations, countries, diseases, events, topics }.
 */
export function extractNamedEntities(article) {
  const result = {
    people: [],
    organizations: [],
    locations: [],
    countries: [],
    diseases: [],
    events: [],
    topics: [],
  };

  const text = _articleSearchText(article);
  if (!text) return result;
  const textLower = text.toLowerCase();

  // Countries (detectMentionedCountries returns {name, code, region})
  const countries = detectMentionedCountries(article);
  result.countries = countries.map((c) => c.name);
  result.locations.push(...result.countries);

  // Organizations
  for (const org of KNOWN_ORGS) {
    if (textLower.includes(org.toLowerCase())) {
      result.organizations.push(org.toUpperCase());
    }
  }
  result.organizations = [...new Set(result.organizations)];

  // Diseases
  for (const disease of DISEASE_KEYWORDS) {
    if (textLower.includes(disease)) {
      result.diseases.push(disease);
    }
  }
  result.diseases = [...new Set(result.diseases)];

  // Events
  for (const [eventType, keywords] of EVENT_CLASSIFIERS) {
    if (keywords.some((kw) => textLower.includes(kw))) {
      result.events.push(eventType);
    }
  }
  result.events = [...new Set(result.events)];

  // People — look for capitalized 2+ word sequences in the title (less noisy than body)
  const titleText = String(article.originalTitle || article.translatedTitle || article.title || "");
  const candidateMatches = titleText.match(
    /\b[A-ZÇĞİÖŞÜ][a-zçğışöü]{1,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]{1,}){1,2}\b/g
  ) || [];

  const orgLabels = new Set(result.organizations.map((o) => o.toLowerCase()));
  const countryLabels = new Set(result.countries.map((c) => c.toLowerCase()));

  for (const match of candidateMatches) {
    const first = match.split(/\s+/)[0];
    if (ENTITY_STOPWORDS.has(first)) continue;
    if (orgLabels.has(match.toLowerCase())) continue;
    if (countryLabels.has(match.toLowerCase())) continue;
    result.people.push(match);
  }
  result.people = [...new Set(result.people)].slice(0, 10);

  // Topics — from existing category/subcategory/tags fields
  const topicSources = [
    article.category,
    article.subcategory,
    ...(Array.isArray(article.tags) ? article.tags : []),
    ...(Array.isArray(article.topics) ? article.topics : []),
  ].filter(Boolean);
  result.topics = [...new Set(topicSources)];

  return result;
}

/**
 * Build locale-aware display fields.
 * Falls back gracefully when translations are absent.
 */
export function buildDisplayFields(article, userLocale = "tr") {
  let displayTitle, displaySummary, displayContent;

  if (userLocale === "tr") {
    displayTitle = article.translatedTitle || article.originalTitle || article.title || "";
    displaySummary = article.translatedSummary || article.originalSummary || article.summary || article.description || "";
    displayContent = article.translatedContent || article.originalContent || article.fullText || "";
  } else {
    displayTitle = article.originalTitle || article.title || "";
    displaySummary = article.originalSummary || article.summary || article.description || "";
    displayContent = article.originalContent || article.fullText || "";
  }

  // Last-resort summary fallback from content
  if (!displaySummary && displayContent) {
    displaySummary = displayContent.slice(0, 280).trim() + (displayContent.length > 280 ? "…" : "");
  }

  return { displayTitle, displaySummary, displayContent };
}

/**
 * Backward-compat normalization for legacy articles (title/summary-only format).
 * Never overwrites existing fields.
 */
export function normalizeLegacyArticle(article) {
  if (!article || typeof article !== "object") return article;
  const a = { ...article };

  if (!a.originalTitle) a.originalTitle = a.title || "";
  if (!a.originalSummary) a.originalSummary = a.summary || a.description || "";
  if (!a.originalContent) a.originalContent = a.fullText || a.content || "";
  if (!a.originalLanguage) a.originalLanguage = a.sourceLanguage || "tr";

  if (a.translatedTitle === undefined) a.translatedTitle = "";
  if (a.translatedSummary === undefined) a.translatedSummary = "";
  if (a.translatedContent === undefined) a.translatedContent = "";

  if (!a.displayTitle) a.displayTitle = a.translatedTitle || a.originalTitle || a.title || "";
  if (!a.displaySummary) a.displaySummary = a.translatedSummary || a.originalSummary || a.summary || "";
  if (!a.displayContent) a.displayContent = a.translatedContent || a.originalContent || a.fullText || "";

  if (!a.namedEntities || typeof a.namedEntities !== "object") {
    a.namedEntities = { people: [], organizations: [], locations: [], countries: [], diseases: [], events: [], topics: [] };
  }
  if (!Array.isArray(a.mentionedRegions)) a.mentionedRegions = [];
  if (!Array.isArray(a.mentionedCountries)) a.mentionedCountries = [];
  if (!a.detectedEventRegion) a.detectedEventRegion = a.sourceRegion || "global";
  if (!Array.isArray(a.topics)) a.topics = Array.isArray(a.tags) ? [...a.tags] : [];
  if (!a.fetchedAt) a.fetchedAt = a.publishedAt || new Date().toISOString();

  return a;
}

/**
 * Full normalization for any article object.
 * Applies legacy compat, language detection, display fields,
 * named entities, region/country detection.
 *
 * @param {Object} rawArticle
 * @param {Object} sourceMeta   - Source catalog entry (language, region, etc.)
 * @param {Object} options      - { userLocale: "tr" }
 */
export function normalizeArticle(rawArticle, sourceMeta = {}, options = {}) {
  const { userLocale = "tr" } = options;
  if (!rawArticle || typeof rawArticle !== "object") return rawArticle;

  const a = normalizeLegacyArticle(rawArticle);

  // Language — detect if still default
  if (!a.originalLanguage || a.originalLanguage === "tr") {
    const detected = detectOriginalLanguage(a, sourceMeta);
    if (detected !== "tr" || !a.originalLanguage) a.originalLanguage = detected;
  }

  // Display fields
  const display = buildDisplayFields(a, userLocale);
  a.displayTitle = display.displayTitle;
  a.displaySummary = display.displaySummary;
  a.displayContent = display.displayContent;

  // Named entities — only compute if empty
  const hasEntities = a.namedEntities && (
    a.namedEntities.people?.length ||
    a.namedEntities.organizations?.length ||
    a.namedEntities.countries?.length
  );
  if (!hasEntities) {
    a.namedEntities = extractNamedEntities(a);
  }

  // Countries
  if (!a.mentionedCountries?.length) {
    a.mentionedCountries = detectMentionedCountries(a).map((c) => c.name);
  }

  // Regions
  if (!a.mentionedRegions?.length) {
    a.mentionedRegions = detectMentionedRegions(a);
  }

  // Event region
  if (!a.detectedEventRegion || a.detectedEventRegion === (a.sourceRegion || "global")) {
    a.detectedEventRegion = detectEventRegion(a);
  }

  // Topics
  if (!a.topics?.length) {
    a.topics = [...new Set([a.category, a.subcategory, ...(Array.isArray(a.tags) ? a.tags : [])].filter(Boolean))];
  }

  if (!a.fetchedAt) a.fetchedAt = new Date().toISOString();

  return a;
}

/**
 * Lightweight enrichment used by trendService before trend grouping.
 * Only fills the fields trend matching actually needs.
 */
export function ensureArticleTrendMetadata(article) {
  const a = normalizeLegacyArticle(article);
  if (!a.mentionedRegions?.length) a.mentionedRegions = detectMentionedRegions(a);
  if (!a.detectedEventRegion) a.detectedEventRegion = detectEventRegion(a);
  if (!a.mentionedCountries?.length) a.mentionedCountries = detectMentionedCountries(a).map((c) => c.name);
  return a;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _articleSearchText(article) {
  return [
    article.originalTitle || article.title || "",
    article.originalSummary || article.summary || article.description || "",
    article.translatedTitle || "",
    article.translatedSummary || "",
  ].filter(Boolean).join(" ");
}
