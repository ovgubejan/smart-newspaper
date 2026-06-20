import { createBoundedMemoryCache, collectStorageKeysByPrefix, pruneStorageCache } from "./services/cacheService.js";
import { escapeHtml, normalizeText } from "./utils/textUtils.js";
import { REGION_OPTIONS } from "./utils/regionKeywords.js";
import {
  detectNewsRegions,
  enrichArticleRegion,
  explainRegionMatch,
  getArticleRegionInfo,
  hasRegionFilterValue,
  matchesRegion,
  normalizeRegionSearchText,
  normalizeSelectedRegions,
  regionKeywordMatches,
  regionLabel,
  regionValue
} from "./utils/regionFilter.js";
import { dateKey, getRecencyScore } from "./utils/dateUtils.js";
import { generateComparisonInsight, normalizeComparisonArticles } from "./utils/comparisonInsight.js";
import { computeSimilarGroupsFrom, getSimilarArticlesFor } from "./services/similarityService.js";
import { computeTrendGroupsFrom, matchesTrendRegion, trendReason } from "./services/trendService.js";
import { fallbackSummary } from "./services/aiSummaryService.js";
import { HeroSlider } from "./components/heroSlider.js";
import { PersonalizedCarousel } from "./components/personalizedCarousel.js";
import { EGazeteMode } from "./components/eGazeteMode.js";
import { Chatbot } from "./components/chatbot.js";
import { findRelatedArticles } from "./services/relatedNewsService.js";
import { WeatherWidget } from "./components/weatherWidget.js";
import {
  FINANCE_ASSET_CATALOG,
  DEFAULT_FINANCE_PREFERENCES,
  normalizeFinancePreferences,
  loadLocalFinancePreferences,
  saveLocalFinancePreferences,
  enabledFinanceSymbols,
  formatFinanceValue,
  formatFinanceChange,
  financeAssetTone,
  calculateFinancePreferenceBoost,
  financeGroups
} from "./services/financeService.js";
import {
  SOURCE_CATEGORIES,
  SOURCE_FILTERS,
  loadLocalUserSources,
  saveLocalUserSources,
  normalizeUserSources,
  normalizeExternalContent,
  sourceTypeLabel,
  sourceTypeIcon,
  trustLabel,
  calculateSourcePreferenceBoost
} from "./services/sourceService.js";
import { initCalendarStore, isEventInCalendar, getCalendarNotifications } from "./utils/calendarStore.js";
import { initReminderManager } from "./utils/reminderManager.js";
import { initCalendarPanel, renderCalendarPage, showAddToCalendarModal } from "./components/calendarPanel.js";

function renderArticlesChunked(articles, container, renderFn, chunkSize = 8) {
  if (articles.length <= chunkSize) {
    container.innerHTML = articles.map(renderFn).join("");
    return;
  }
  container.innerHTML = articles.slice(0, chunkSize).map(renderFn).join("");
  let i = chunkSize;
  function nextChunk() {
    if (i >= articles.length) return;
    const end = Math.min(i + chunkSize, articles.length);
    const fragment = document.createRange().createContextualFragment(
      articles.slice(i, end).map(renderFn).join("")
    );
    container.appendChild(fragment);
    i = end;
    if (i < articles.length) requestAnimationFrame(nextChunk);
  }
  requestAnimationFrame(nextChunk);
}

function debounce(fn, ms) {
  let timer;
  return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
}

function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, args); }
  };
}

/* ============================
   TOPIC CATEGORY & REGION SYSTEM
   ============================ */
const TOPIC_CATEGORIES = [
  "Politika",
  "Gündem",
  "Ekonomi",
  "Teknoloji",
  "Spor",
  "Sağlık",
  "Bilim",
  "Kültür-Sanat",
  "Eğitim",
  "Finans",
  "Dünya",
  "Eğlence"
];

const CATEGORY_OPTIONS = [
  { value: "all", label: "Tümü", legacy: "Tümü" },
  { value: "general", label: "Gündem", legacy: "Gündem" },
  { value: "politics", label: "Politika", legacy: "Politika" },
  { value: "technology", label: "Teknoloji", legacy: "Teknoloji" },
  { value: "world", label: "Dünya", legacy: "Dünya" },
  { value: "economy", label: "Ekonomi", legacy: "Ekonomi" },
  { value: "sports", label: "Spor", legacy: "Spor" },
  { value: "science", label: "Bilim", legacy: "Bilim" },
  { value: "health", label: "Sağlık", legacy: "Sağlık" },
  { value: "entertainment", label: "Eğlence", legacy: "Eğlence" }
];

const CATEGORY_KEYWORDS = {
  politics: [
    "siyaset", "politika", "hükümet", "hukumet", "parti", "seçim", "secim",
    "milletvekili", "meclis", "tbmm", "cumhurbaşkanı", "cumhurbaskani",
    "başkan", "baskan", "bakan", "ak parti", "chp", "mhp", "erdoğan",
    "erdogan", "bahçeli", "bahceli", "belediye", "dışişleri", "disisleri",
    "diplomasi", "müzakere", "muzakere"
  ],
  technology: [
    "teknoloji", "teknolojik", "yazılım", "yazilim", "software", "donanım",
    "donanim", "hardware", "bilgisayar", "computer", "telefon", "smartphone",
    "uygulama", "app", "internet", "dijital", "digital", "siber",
    "cybersecurity", "cyber security", "çip", "cip", "chip", "semiconductor",
    "yarı iletken", "yari iletken", "cloud", "bulut", "veri merkezi",
    "data center", "startup", "robot", "yapay zeka", "artificial intelligence",
    "machine learning", "deep learning", "openai", "chatgpt", "gemini",
    "claude", "üretken yapay zeka", "uretken yapay zeka", "generative ai",
    "elektrikli araç", "elektrikli arac", "batarya"
  ],
  world: ["dünya", "dunya", "küresel", "kuresel", "uluslararası", "uluslararasi", "ülke", "ulke", "ülkeler", "ulkeler", "dış haber", "dis haber", "foreign", "global"],
  economy: ["ekonomi", "piyasa", "borsa", "dolar", "euro", "faiz", "enflasyon", "yatırım", "yatirim", "hisse", "şirket", "sirket", "merkez bankası", "merkez bankasi", "finans", "ticaret", "ihracat", "ithalat"],
  sports: [
    "spor", "futbol", "basketbol", "voleybol", "tenis", "maç", "mac",
    "karşılaşma", "karsilasma", "lig", "süper lig", "super lig", "şampiyon",
    "sampiyon", "takım", "takim", "oyuncu", "teknik direktör", "teknik direktor",
    "gol", "transfer", "hakem", "turnuva", "antrenman", "galatasaray",
    "fenerbahçe", "fenerbahce", "beşiktaş", "besiktas", "trabzonspor",
    "milli takım", "milli takim", "uefa", "fifa"
  ],
  science: ["bilim", "araştırma", "arastirma", "uzay", "nasa", "iklim", "akademik", "keşif", "kesif"],
  health: ["sağlık", "saglik", "hastane", "doktor", "tedavi", "ilaç", "ilac", "hastalık", "hastalik"],
  entertainment: ["eğlence", "eglence", "kültür", "kultur", "sanat", "film", "dizi", "müzik", "muzik", "konser", "sinema"]
};

const CATEGORY_ALIASES_BY_VALUE = {
  "Tümü": "all",
  "Politika": "politics",
  "Yapay Zeka": "technology",
  "Teknoloji": "technology",
  "Dünya": "world",
  "Ekonomi": "economy",
  "Spor": "sports",
  "Bilim": "science",
  "Sağlık": "health",
  "Eğlence": "entertainment",
  "Kültür-Sanat": "entertainment",
  "Gündem": "general",
  general: "general",
  all: "all",
  artificial_intelligence: "technology",
  politics: "politics",
  technology: "technology",
  world: "world",
  economy: "economy",
  sports: "sports",
  science: "science",
  health: "health",
  entertainment: "entertainment"
};

const WEAK_CATEGORY_KEYWORDS = {
  technology: new Set(["telefon", "uygulama", "app", "batarya"])
};

const STRONG_SPORTS_KEYWORDS = new Set([
  "futbol", "basketbol", "voleybol", "tenis", "mac", "karsilasma", "lig",
  "super lig", "sampiyon", "takim", "oyuncu", "teknik direktor", "gol",
  "transfer", "hakem", "turnuva", "antrenman", "galatasaray", "fenerbahce",
  "besiktas", "trabzonspor", "milli takim", "uefa", "fifa"
]);

const SPORTS_FALSE_CONTEXTS = [
  "19 mayis", "genclik ve spor bayrami", "ataturku anma genclik ve spor bayrami",
  "resmi tatil", "noter acik mi", "hastane acik mi", "eczane acik mi",
  "kargo acik mi", "okullar tatil mi", "bakan mesaji", "kutlama mesaji"
];

const CONTINENT_FILTERS = [
  "Global",
  "Avrupa",
  "Asya",
  "Afrika",
  "Kuzey Amerika",
  "Güney Amerika",
  "Okyanusya",
  "Orta Doğu"
];

const CATEGORY_ALIASES = {
  "Türkiye": "Gündem",
  "Turkiye": "Gündem",
  "Kültür": "Kültür-Sanat",
  "Kultur": "Kültür-Sanat",
  "Kültür Sanat": "Kültür-Sanat",
  "YapayZeka": "Teknoloji"
};

const CATEGORY_COLORS = {
  "Politika": "#a43f2f",
  "Gündem": "#a43f2f",
  "Ekonomi": "#7c3aed",
  "Teknoloji": "#2563eb",
  "Spor": "#ef4444",
  "Sağlık": "#0891b2",
  "Bilim": "#059669",
  "Kültür-Sanat": "#db2777",
  "Eğitim": "#4f46e5",
  "Finans": "#0f766e",
  "Dünya": "#d97706",
  "Eğlence": "#db2777"
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

const CONTINENT_ALIASES = {
  "Europe": "Avrupa",
  "Asia": "Asya",
  "Africa": "Afrika",
  "North America": "Kuzey Amerika",
  "South America": "Güney Amerika",
  "Oceania": "Okyanusya",
  "Australia": "Okyanusya",
  "Worldwide": "Global",
  "World": "Global"
};

const CONTINENT_KEYWORDS = [
  ["Avrupa", ["avrupa", "almanya", "fransa", "italya", "ispanya", "hollanda", "belcika", "ingiltere", "britanya", "uk", "londra", "berlin", "paris", "brüksel", "bruksel", "madrid", "roma", "polonya", "yunanistan", "ukrayna"]],
  ["Asya", ["asya", "turkiye", "türkiye", "istanbul", "ankara", "izmir", "cin", "çin", "pekin", "japonya", "tokyo", "hindistan", "kore", "iran", "irak", "suriye", "israil", "suudi", "katar", "bae", "dubai", "rusya"]],
  ["Afrika", ["afrika", "misir", "mısır", "kahire", "nijerya", "kenya", "fas", "cezayir", "tunus", "güney afrika", "guney afrika"]],
  ["Kuzey Amerika", ["kuzey amerika", "abd", "amerika", "amerika birleşik devletleri", "usa", "kanada", "meksika", "washington", "new york", "california", "trump"]],
  ["Güney Amerika", ["güney amerika", "guney amerika", "brezilya", "arjantin", "sili", "şili", "kolombiya", "peru", "venezuela"]],
  ["Okyanusya", ["okyanusya", "avustralya", "yeni zelanda", "sydney", "melbourne"]],
  ["Orta Doğu", ["orta dogu", "orta doğu", "israil", "filistin", "iran", "suriye", "irak", "lübnan", "lubnan", "gazze", "hurmuz", "suudi arabistan", "katar", "bae", "dubai", "ürdün", "urdun", "yemen"]]
];

const DEBUG_FILTERS = typeof window !== "undefined"
  && (window.SMART_NEWSPAPER_DEBUG_FILTERS === true || localStorage.getItem("smartNewsDebugFilters") === "1");
const REGION_DEBUG = DEBUG_FILTERS;

const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3000" : "";


/* ============================
   NEWS CACHE SYSTEM
   ============================ */
const NEWS_CACHE_PREFIX = "news_cache_";
const NEWS_FEED_CACHE_KEY = `${NEWS_CACHE_PREFIX}feed_all_global_1_latest_empty`;
const NEWS_CACHE_VERSION = 6;
const NEWS_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const NEWS_CACHE_MAX_ITEMS = 40;
const NEWS_CACHE_MEMORY_MAX_ITEMS = 20;
const NEWS_CACHE_MIN_FEED_ITEMS = 12;
const PENDING_API_MAX_ITEMS = 30;
const SESSION_KEY_MAX_ITEMS = 600;
const ENTITY_INFO_CACHE_MAX_ITEMS = 60;
const newsCacheMemory = createBoundedMemoryCache(NEWS_CACHE_MEMORY_MAX_ITEMS);
const pendingApiRequests = createBoundedMemoryCache(PENDING_API_MAX_ITEMS);

function newsCacheDebug(status, key) {
  if (typeof console !== "undefined" && console.debug) console.debug(`Cache ${status}`, key);
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageRemove(key) {
  try { localStorage.removeItem(key); } catch { }
  newsCacheMemory.delete(key);
}

function trimSetToMax(set, maxItems) {
  while (set.size > maxItems) {
    set.delete(set.values().next().value);
  }
}

function trimObjectCacheToMax(cache, maxItems) {
  const keys = Object.keys(cache || {});
  if (keys.length <= maxItems) return;
  keys.slice(0, keys.length - maxItems).forEach((key) => delete cache[key]);
}

function normalizeCachePart(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "Tümü") return raw === "Tümü" ? "Tümü" : "empty";
  return raw.replace(/\s+/g, "-").replace(/_+/g, "-");
}

function getSelectedSubcategory() {
  return state.selectedSubcategory || "Tümü";
}

function getSortCacheValue() {
  const value = state.selectedSort || sortFilter?.value || "latest";
  return value === "date" ? "latest" : value;
}

function getSearchCacheValue() {
  return state.selectedSearchQuery || searchInput?.value?.trim() || "empty";
}

function buildNewsCacheKey({ category, subcategory, continent, page, sort, search, tab } = {}) {
  return [
    NEWS_CACHE_PREFIX.replace(/_$/, ""),
    normalizeCachePart(category || state.selectedCategory || "all"),
    normalizeCachePart((subcategory || getSelectedSubcategory()) === "Tümü" ? "empty" : (subcategory || getSelectedSubcategory())),
    normalizeCachePart(continent || currentSelectedRegions().join("+")),
    normalizeCachePart(page || state.currentPage || 1),
    normalizeCachePart(sort || getSortCacheValue()),
    normalizeCachePart(search || getSearchCacheValue()),
    normalizeCachePart(tab || state.personalFeedTab || "today")
  ].join("_");
}

function currentNewsCacheContext() {
  return {
    category: state.selectedCategory || "all",
    subcategory: state.selectedSubcategory === "Tümü" ? "empty" : state.selectedSubcategory || getSelectedSubcategory(),
    continent: currentSelectedRegions().join(","),
    regions: currentSelectedRegions(),
    page: state.currentPage || 1,
    sort: getSortCacheValue(),
    search: getSearchCacheValue(),
    tab: state.personalFeedTab || "today"
  };
}

function currentNewsCacheSignature() {
  return JSON.stringify({
    ...currentNewsCacheContext(),
    source: state.selectedSource || sourceFilter?.value || "Tümü",
    status: state.selectedReadStatus || statusFilter?.value || "Tümü",
    date: state.selectedDate || dateFilter?.value || "Tümü",
    favoriteFeedOnly: Boolean(state.favoriteFeedOnly),
    personalFeedTab: state.personalFeedTab || "today",
    pageSize: state.pageSize
  });
}

function currentCacheUserId() {
  return String(state.authUser?.id || state.authUser?.email || state.authUser?.name || "guest");
}

function minimizeArticleForCache(article) {
  const regionInfo = getArticleRegionInfo(article);
  const categoryInfo = detectNewsCategories(article);
  return {
    id: article.id,
    title: article.title || "",
    summary: article.summary || article.description || "",
    description: article.description || article.fullText || article.summary || "",
    source: article.source || article.sourceName || "",
    image: article.image || article.imageUrl || "",
    publishedAt: article.publishedAt || "",
    url: article.url || article.sourceUrl || "",
    category: categoryLabel(categoryInfo.primaryCategory),
    actualNewsCategory: categoryInfo.primaryCategory,
    detectedCategories: categoryInfo.categories,
    matchedCategoryKeywords: categoryInfo.matchedCategoryKeywords,
    subcategory: inferArticleSubcategory(article),
    continent: regionInfo.primaryRegion,
    primaryRegion: regionInfo.primaryRegion,
    relatedRegions: regionInfo.relatedRegions,
    regions: regionInfo.regions,
    country: article.country || regionInfo.country || "",
    detectedLocationKeywords: regionInfo.detectedLocationKeywords,
    relevanceScore: regionInfo.relevanceScore,
    interestScore: clampScore(article.interestScore ?? article.relevance ?? 0)
    ,
    sourceRegion: article.sourceRegion || "",
    sourceCountry: article.sourceCountry || "",
    sourceCountryCode: article.sourceCountryCode || "",
    detectedEventRegion: article.detectedEventRegion || "",
    mentionedRegions: article.mentionedRegions || [],
    mentionedCountries: article.mentionedCountries || [],
    isDemo: Boolean(article.isDemo),
    demoScenario: article.demoScenario || ""
  };
}

function restoreArticleFromCache(article) {
  const publishedAt = article.publishedAt || new Date().toISOString();
  const description = article.description || article.summary || "";
  const restored = {
    id: article.id,
    title: article.title || "Başlıksız",
    summary: article.summary || description,
    fullText: description,
    source: article.source || "",
    sourceUrl: article.url || "",
    imageUrl: article.image || "",
    publishedAt,
    category: normalizeCategoryName(article.category),
    actualNewsCategory: categoryValue(article.actualNewsCategory || article.category),
    detectedCategories: Array.isArray(article.detectedCategories) ? article.detectedCategories : [],
    matchedCategoryKeywords: Array.isArray(article.matchedCategoryKeywords) ? article.matchedCategoryKeywords : [],
    subcategory: inferArticleSubcategory(article),
    continent: regionValue(article.primaryRegion || article.continent || "global"),
    primaryRegion: regionValue(article.primaryRegion || article.continent || "global"),
    relatedRegions: Array.isArray(article.relatedRegions) ? article.relatedRegions.map(regionValue).filter((region) => region !== "global") : [],
    regions: Array.isArray(article.regions) ? article.regions.map(regionValue).filter(Boolean) : [],
    detectedLocationKeywords: Array.isArray(article.detectedLocationKeywords) ? article.detectedLocationKeywords : [],
    country: article.country || "",
    relevanceScore: Number(article.relevanceScore || 0),
    date: new Date(publishedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }),
    dateRange: "Son 24 saat",
    readTime: `${Math.max(2, Math.round(description.length / 900))} dk`,
    relevance: clampScore(article.interestScore || 0),
    status: "Okunmadı",
    bookmarked: false
    ,
    sourceRegion: article.sourceRegion || "",
    sourceCountry: article.sourceCountry || "",
    sourceCountryCode: article.sourceCountryCode || "",
    detectedEventRegion: article.detectedEventRegion || "",
    mentionedRegions: Array.isArray(article.mentionedRegions) ? article.mentionedRegions : [],
    mentionedCountries: Array.isArray(article.mentionedCountries) ? article.mentionedCountries : [],
    isDemo: Boolean(article.isDemo),
    demoScenario: article.demoScenario || ""
  };
  return enrichArticleCategory(enrichArticleRegion(restored));
}

function validateNewsCachePayload(payload, expectedSignature) {
  if (!payload || payload.version !== NEWS_CACHE_VERSION) return false;
  if (payload.userId && payload.userId !== currentCacheUserId()) return false;
  if (expectedSignature && payload.signature !== expectedSignature) return false;
  if (!Array.isArray(payload.articles)) return false;
  if (Date.now() - Number(payload.createdAt || 0) > NEWS_CACHE_TTL_MS) return "expired";
  return true;
}

function readNewsCache(key, expectedSignature) {
  const cached = newsCacheMemory.has(key) ? newsCacheMemory.get(key) : safeStorageGet(key);
  if (!cached) { newsCacheDebug("MISS", key); return null; }

  let payload = cached;
  if (typeof cached === "string") {
    try {
      payload = JSON.parse(cached);
      newsCacheMemory.set(key, payload);
    } catch {
      safeStorageRemove(key);
      newsCacheDebug("MISS", `${key} (BROKEN)`);
      return null;
    }
  }

  const validation = validateNewsCachePayload(payload, expectedSignature);
  if (validation === "expired") {
    safeStorageRemove(key);
    newsCacheDebug("EXPIRED", key);
    return null;
  }
  if (!validation) {
    newsCacheDebug("MISS", key);
    return null;
  }
  newsCacheDebug("HIT", key);
  return {
    ...payload,
    articles: payload.articles.map(restoreArticleFromCache)
  };
}

function pruneNewsCacheStorage() {
  pruneStorageCache({
    prefix: NEWS_CACHE_PREFIX,
    maxItems: NEWS_CACHE_MAX_ITEMS,
    ttlMs: NEWS_CACHE_TTL_MS,
    remove: safeStorageRemove
  });
}

function writeNewsCache(key, articles, { signature = "", totalCount = articles.length } = {}) {
  const payload = {
    version: NEWS_CACHE_VERSION,
    createdAt: Date.now(),
    ttlMs: NEWS_CACHE_TTL_MS,
    userId: currentCacheUserId(),
    signature,
    totalCount,
    articles: articles.map(minimizeArticleForCache)
  };
  newsCacheMemory.set(key, payload);
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    newsCacheDebug("WRITE", key);
  } catch {
    pruneNewsCacheStorage();
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      newsCacheDebug("WRITE", key);
    } catch {
      newsCacheDebug("MISS", `${key} (STORAGE_FULL)`);
    }
  }
}

function clearNewsCaches(reason = "CLEAR") {
  try {
    collectStorageKeysByPrefix(NEWS_CACHE_PREFIX).forEach(safeStorageRemove);
  } catch {
    newsCacheMemory.clear();
  }
  newsCacheDebug(reason, NEWS_CACHE_PREFIX);
}

function categoryColor(category) {
  return CATEGORY_COLORS[normalizeCategoryName(category)] || "#28536b";
}

function categoryValue(category) {
  const raw = String(category || "").trim();
  if (!raw) return "general";
  const normalized = normalizeRegionSearchText(raw).replace(/\s+/g, "_");
  return CATEGORY_ALIASES_BY_VALUE[raw]
    || CATEGORY_ALIASES_BY_VALUE[normalized]
    || CATEGORY_ALIASES_BY_VALUE[normalizeCategoryName(raw)]
    || "general";
}

function categoryValueStrict(category) {
  const raw = String(category || "").trim();
  if (!raw || raw === "Tümü") return null;
  const normalized = normalizeRegionSearchText(raw).replace(/\s+/g, "_");
  const alias = CATEGORY_ALIASES_BY_VALUE[raw] || CATEGORY_ALIASES_BY_VALUE[normalized];
  if (alias && alias !== "all") return alias;

  const byLabel = CATEGORY_OPTIONS.find((item) =>
    normalizeRegionSearchText(item.label).replace(/\s+/g, "_") === normalized
    || normalizeRegionSearchText(item.legacy || "").replace(/\s+/g, "_") === normalized
  );
  if (byLabel && byLabel.value !== "all") return byLabel.value;

  const aliasedLabel = CATEGORY_ALIASES[raw] || CATEGORY_ALIASES[raw.replace(/\s+/g, "")];
  if (aliasedLabel) return categoryValueStrict(aliasedLabel);
  return null;
}

function categoryLabel(category) {
  const value = categoryValue(category);
  if (value === "general") return "Gündem";
  return CATEGORY_OPTIONS.find((item) => item.value === value)?.label || "Politika";
}

function normalizeCategoryName(category) {
  const value = String(category || "").trim();
  if (!value || value === "Tümü") return value || "Gündem";
  if (CATEGORY_ALIASES_BY_VALUE[value]) return categoryLabel(value);
  const aliased = CATEGORY_ALIASES[value] || CATEGORY_ALIASES[value.replace(/\s+/g, "")] || value;
  return TOPIC_CATEGORIES.includes(aliased) ? aliased : "Politika";
}

function normalizeContinentName(continent) {
  return regionLabel(regionValue(continent));
}

function currentSelectedRegions() {
  return normalizeSelectedRegions(state.selectedRegions || state.selectedContinent || "global");
}

function pendingSelectedRegions() {
  return normalizeSelectedRegions(continentFilter?.value || state.selectedRegions || state.selectedContinent || "global");
}

function hasRegionFilter(regions = currentSelectedRegions()) {
  return hasRegionFilterValue(regions);
}

function logFilterDebug(details) {
  if (!REGION_DEBUG) return;
  console.debug("News filters", {
    selectedRegions: details.selectedRegions,
    selectedCategory: details.selectedCategory,
    totalNewsCount: details.totalNewsCount,
    afterCategoryFilterCount: details.afterCategoryFilterCount,
    afterRegionFilterCount: details.afterRegionFilterCount,
    finalResultCount: details.finalResultCount,
    sample: (details.allArticles || []).slice(0, 20).map((article) => {
      const regionInfo = enrichArticleRegion(article);
      const categoryInfo = enrichArticleCategory(article);
      const categoryOk = matchesCategory(article, details.selectedCategory);
      const regionDetails = explainRegionMatch(article, details.selectedRegions);
      const regionOk = regionDetails.match;
      const isIncluded = categoryOk && regionOk;
      const excludedReason = isIncluded
        ? regionDetails.reason
        : [
          !categoryOk ? `excluded: category ${categoryInfo.primaryCategory || categoryInfo.detectedCategory || categoryInfo.category} does not match selectedCategory ${details.selectedCategory}` : "",
          !regionOk ? regionDetails.reason : ""
        ].filter(Boolean).join("; ");
      return {
        title: article.title,
        primaryRegion: regionInfo.primaryRegion,
        relatedRegions: regionInfo.relatedRegions,
        selectedRegions: details.selectedRegions,
        categoryMatch: categoryOk,
        regionMatch: regionOk,
        finalIncluded: isIncluded,
        detectedCategories: categoryInfo.detectedCategories,
        matchedCategoryKeywords: categoryInfo.matchedCategoryKeywords,
        matchedRegionKeywords: regionInfo.detectedLocationKeywords,
        excludedReason
      };
    })
  });
}

function applyNewsFilters(newsList, filters = currentSearchFilters()) {
  const allArticles = Array.isArray(newsList) ? newsList : [];
  const selectedRegions = normalizeSelectedRegions(filters.regions || filters.continent || "global");
  const selectedCategory = categoryValue(filters.category || "all");
  const categoryFiltered = selectedCategory !== "all"
    ? allArticles.filter((article) => matchesCategory(article, selectedCategory))
    : allArticles;
  const regionFiltered = hasRegionFilter(selectedRegions)
    ? categoryFiltered.filter((article) => matchesRegion(article, selectedRegions))
    : categoryFiltered;
  logFilterDebug({
    selectedRegions,
    selectedCategory,
    totalNewsCount: allArticles.length,
    afterCategoryFilterCount: categoryFiltered.length,
    afterRegionFilterCount: regionFiltered.length,
    finalResultCount: regionFiltered.length,
    allArticles,
    finalArticles: regionFiltered
  });
  return regionFiltered;
}

function weightedArticleCategoryFields(article = {}) {
  return [
    { weight: 5, text: article.title || "" },
    { weight: 3, text: `${article.summary || ""} ${article.description || ""} ${article.aiSummary || ""}` },
    { weight: 1, text: article.fullText || article.content || "" }
  ];
}

function normalizeCategoryInputList(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeCategoryInputList);
  if (value && typeof value === "object") {
    return [
      value.category,
      value.mainCategory,
      value.topicCategory,
      value.subCategory,
      value.subcategory
    ].flatMap(normalizeCategoryInputList);
  }
  return String(value || "")
    .split(/[|,;/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function subcategoryParentValue(subcategory) {
  const normalized = normalizeRegionSearchText(subcategory).replace(/\s+/g, "_");
  if (!normalized) return null;
  for (const [parent, subcategories] of Object.entries(SUBCATEGORY_MAP)) {
    const match = subcategories.some((item) =>
      normalizeRegionSearchText(item).replace(/\s+/g, "_") === normalized
    );
    if (match) return categoryValueStrict(parent);
  }
  return null;
}

function explicitTopicCategoryValues(article = {}) {
  const directFields = [
    article.category,
    article.mainCategory,
    article.topicCategory,
    article.categories
  ].flatMap(normalizeCategoryInputList);
  const directValues = directFields.map(categoryValueStrict).filter(Boolean);

  const subcategoryValues = [
    article.subCategory,
    article.subcategory
  ].flatMap(normalizeCategoryInputList)
    .map(subcategoryParentValue)
    .filter(Boolean);

  return [...new Set([...directValues, ...subcategoryValues])];
}

function detectNewsCategories(newsItem = {}) {
  const scored = new Map();
  const detected = new Map();

  for (const { weight, text } of weightedArticleCategoryFields(newsItem)) {
    if (weight <= 0) continue;
    const normalizedText = normalizeRegionSearchText(text);
    if (!normalizedText) continue;
    for (const [value, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const keyword of keywords) {
        const normalizedKeyword = normalizeRegionSearchText(keyword);
        if (!regionKeywordMatches(normalizedText, normalizedKeyword)) continue;
        scored.set(value, (scored.get(value) || 0) + weight);
        if (!detected.has(value)) detected.set(value, new Set());
        detected.get(value).add(keyword);
      }
    }
  }

  for (const [category, weakWords] of Object.entries(WEAK_CATEGORY_KEYWORDS)) {
    const matches = [...(detected.get(category) || [])];
    if (matches.length && matches.every((word) => weakWords.has(normalizeRegionSearchText(word)))) {
      detected.delete(category);
      scored.delete(category);
    }
  }

  const sportsMatches = [...(detected.get("sports") || [])].map(normalizeRegionSearchText);
  if (sportsMatches.length) {
    const allText = normalizeRegionSearchText(weightedArticleCategoryFields(newsItem).map((field) => field.text).join(" "));
    const hasStrongSports = sportsMatches.some((word) => STRONG_SPORTS_KEYWORDS.has(word));
    const hasHolidayFalseContext = SPORTS_FALSE_CONTEXTS.some((phrase) => allText.includes(phrase));
    if (!hasStrongSports || hasHolidayFalseContext) {
      detected.delete("sports");
      scored.delete("sports");
    }
  }

  const ranked = [...scored.entries()].sort((left, right) => right[1] - left[1]);
  const explicitCategories = explicitTopicCategoryValues(newsItem);
  const detectedCategories = ranked.map(([value]) => value);
  const categories = [...new Set([...explicitCategories, ...detectedCategories])];
  return {
    categories,
    primaryCategory: categories[0] || "general",
    matchedCategoryKeywords: [...new Set(ranked.flatMap(([value]) => [...(detected.get(value) || [])]))],
    matchesByCategory: Object.fromEntries([...detected.entries()].map(([value, words]) => [value, [...words]]))
  };
}

function getNewsCategories(newsItem = {}) {
  return detectNewsCategories(newsItem).categories;
}

function getExplicitNewsCategories(newsItem = {}) {
  return explicitTopicCategoryValues(newsItem);
}

function matchesCategory(newsItem, selectedCategory) {
  const selected = categoryValue(selectedCategory);
  if (selected === "all") return true;
  const explicitCategories = getExplicitNewsCategories(newsItem);
  if (explicitCategories.length) return explicitCategories.includes(selected);
  return getNewsCategories(newsItem).includes(selected);
}

function enrichArticleCategory(article = {}) {
  const detected = detectNewsCategories(article);
  return {
    ...article,
    actualNewsCategory: detected.primaryCategory,
    detectedCategory: detected.primaryCategory,
    detectedCategories: detected.categories,
    matchedCategoryKeywords: detected.matchedCategoryKeywords,
    category: categoryLabel(detected.primaryCategory)
  };
}

function inferArticleCategory(article) {
  return categoryLabel(detectNewsCategories(article).primaryCategory);
}

function inferArticleContinent(article) {
  const detected = detectNewsRegions(article);
  if (detected.primaryRegion !== "global") return detected.primaryRegion;
  return "global";
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

  const text = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.description || ""} ${article.fullText || ""} ${(article.tags || []).join(" ")} ${article.sourceUrl || article.url || ""}`);
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

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

const INTERACTION_WEIGHTS = {
  impression: 0.2,
  click: 2,
  read_30_seconds: 4,
  bookmark: 6,
  repeated_subcategory_interest: 3,
  dismiss: -1
};

const USER_INTEREST_STORAGE_KEY = "newspaperUserInterest_v2";

function defaultUserInterest(interests = []) {
  const categories = {};
  const subcategories = {};
  TOPIC_CATEGORIES.forEach((category) => { categories[category] = interests.includes(category) ? 65 : 50; });
  ALL_SUBCATEGORIES.forEach((subcategory) => { subcategories[subcategory] = 50; });
  return { categories, subcategories, interactions: {}, subcategoryInteractions: {}, version: 2 };
}

function normalizeUserInterest(raw = {}, interests = []) {
  const base = defaultUserInterest(interests);
  const sourceCategories = raw.categories && typeof raw.categories === "object" ? raw.categories : {};
  const sourceSubcategories = raw.subcategories && typeof raw.subcategories === "object" ? raw.subcategories : {};

  for (const [key, value] of Object.entries(sourceCategories)) {
    const category = normalizeCategoryName(key);
    if (TOPIC_CATEGORIES.includes(category)) base.categories[category] = clampScore(value, base.categories[category]);
  }

  // Legacy migration: old plain category score objects or old interest arrays can be folded into the new structure.
  for (const [key, value] of Object.entries(raw || {})) {
    if (["categories", "subcategories", "interactions", "subcategoryInteractions", "version"].includes(key)) continue;
    const category = normalizeCategoryName(key);
    if (TOPIC_CATEGORIES.includes(category)) base.categories[category] = clampScore(value, base.categories[category]);
  }

  for (const [key, value] of Object.entries(sourceSubcategories)) {
    const subcategory = normalizeSubcategoryName(key);
    if (ALL_SUBCATEGORIES.includes(subcategory)) base.subcategories[subcategory] = clampScore(value, base.subcategories[subcategory]);
  }

  if (raw.interactions && typeof raw.interactions === "object") base.interactions = raw.interactions;
  if (raw.subcategoryInteractions && typeof raw.subcategoryInteractions === "object") base.subcategoryInteractions = raw.subcategoryInteractions;
  return base;
}

function loadUserInterestFromStorage(interests = []) {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_INTEREST_STORAGE_KEY) || "null");
    return normalizeUserInterest(raw || {}, interests);
  } catch {
    return defaultUserInterest(interests);
  }
}

function saveUserInterest(userInterest) {
  try {
    localStorage.setItem(USER_INTEREST_STORAGE_KEY, JSON.stringify(userInterest));
  } catch { }
}

function getPreferencesWithInterest() {
  const preferences = normalizePreferences(state.data.preferences);
  if (!preferences.userInterest) preferences.userInterest = loadUserInterestFromStorage(preferences.interests);
  state.data.preferences = { ...state.data.preferences, ...preferences };
  return preferences;
}

function updateInterestBucket(bucket, key, delta) {
  if (!key) return;
  const current = clampScore(bucket[key] ?? 50, 50);
  bucket[key] = clampScore(current + delta, current);
}

function recordUserInteraction(article, type) {
  if (!article || !type) return;
  const weight = INTERACTION_WEIGHTS[type];
  if (!Number.isFinite(weight)) return;

  const preferences = getPreferencesWithInterest();
  const userInterest = preferences.userInterest;
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory(article);
  const articleId = String(article.id || `${article.title}-${article.source}`);

  const interaction = userInterest.interactions[articleId] || { impression: 0, click: 0, read_30_seconds: 0, bookmark: 0, dismiss: 0 };
  if (type === "impression") {
    interaction.impression += 1;
  } else {
    interaction[type] = (interaction[type] || 0) + 1;
  }
  userInterest.interactions[articleId] = interaction;

  updateInterestBucket(userInterest.categories, category, weight * 0.7);
  updateInterestBucket(userInterest.subcategories, subcategory, weight);

  if (["click", "read_30_seconds", "bookmark"].includes(type)) {
    const count = (userInterest.subcategoryInteractions[subcategory] || 0) + 1;
    userInterest.subcategoryInteractions[subcategory] = count;
    if (count > 1 && count % 3 === 0) {
      updateInterestBucket(userInterest.subcategories, subcategory, INTERACTION_WEIGHTS.repeated_subcategory_interest);
    }
  }

  saveUserInterest(userInterest);
  article.category = category;
  article.subcategory = subcategory;
  article.relevance = calculatePersonalizedScore(article, preferences);
  article.interestScore = article.relevance;
}

function getArticleInteractionScore(article, userInterest) {
  const articleId = String(article.id || `${article.title}-${article.source}`);
  const interaction = userInterest?.interactions?.[articleId] || {};
  const raw =
    (interaction.impression || 0) * INTERACTION_WEIGHTS.impression +
    (interaction.click || 0) * INTERACTION_WEIGHTS.click +
    (interaction.read_30_seconds || 0) * INTERACTION_WEIGHTS.read_30_seconds +
    (interaction.bookmark || 0) * INTERACTION_WEIGHTS.bookmark +
    (interaction.dismiss || 0) * INTERACTION_WEIGHTS.dismiss;
  const behaviorScore = clampScore(50 + raw * 6, 50);
  const sourceScore = Array.isArray(state.data.preferences?.preferredSources) && state.data.preferences.preferredSources.includes(article.source) ? 75 : 55;
  return clampScore(behaviorScore * 0.7 + sourceScore * 0.3, 50);
}

// getRecencyScore imported from ./utils/dateUtils.js

function calculatePersonalizedScore(article, preferences = getPreferencesWithInterest()) {
  const userInterest = normalizeUserInterest(preferences.userInterest || {}, preferences.interests || []);
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const categoryScore = clampScore(userInterest.categories?.[category] ?? ((preferences.interests || []).includes(category) ? 65 : 50));
  const subcategoryScore = clampScore(userInterest.subcategories?.[subcategory] ?? 50);
  const recencyScore = getRecencyScore(article);
  const interactionScore = getArticleInteractionScore({ ...article, category, subcategory }, userInterest);
  const existingScore = categoryScore * 0.35 + subcategoryScore * 0.40 + recencyScore * 0.15 + interactionScore * 0.10;
  const financePreferenceBoost = calculateFinancePreferenceBoost(article, state.finance?.preferences || loadLocalFinancePreferences());
  const sourcePreferenceBoost = calculateSourcePreferenceBoost(article, state.sources?.list || loadLocalUserSources());
  const isTurkishUi = state.uiLanguage === "tr";
  const isTurkeyArticle = article.sourceRegion === "turkey";
  const turkeyBoost = (isTurkishUi && isTurkeyArticle) ? 15 : 0;
  return clampScore(existingScore + financePreferenceBoost + sourcePreferenceBoost + turkeyBoost);
}

function interestInfoButtonHtml(extraClass = "") {
  const className = ["interest-score-info", extraClass].filter(Boolean).join(" ");
  return `<button class="${className}" type="button" data-interest-info aria-haspopup="dialog" aria-controls="interest-info-modal" aria-label="İlgi puanı nasıl hesaplanır?"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>`;
}

function personalizeArticleScores(articles = state.data.articles) {
  const preferences = getPreferencesWithInterest();
  articles.forEach((article) => {
    article.category = inferArticleCategory(article);
    article.subcategory = inferArticleSubcategory(article);
    article.relevance = calculatePersonalizedScore(article, preferences);
    article.interestScore = article.relevance;
  });
  return articles;
}

function recordImpressions(articles = []) {
  if (!state.impressionSessionKeys) state.impressionSessionKeys = new Set();
  for (const article of articles) {
    const key = `${article.id || article.title}:${state.selectedCategory}:${state.selectedSubcategory}:${currentSelectedRegions().join("+")}`;
    if (state.impressionSessionKeys.has(key)) continue;
    state.impressionSessionKeys.add(key);
    trimSetToMax(state.impressionSessionKeys, SESSION_KEY_MAX_ITEMS);
    recordUserInteraction(article, "impression");
  }
}

/* ============================
   STATE
   ============================ */
const state = {
  data: window.newspaperMockData,
  liveIndex: 0,
  liveTimer: null,
  usingApi: false,
  events: [],
  savedSearches: [],
  newspaperArticles: [],
  currentPage: 1,
  pageSize: 12,
  trendPage: 0,
  trendError: "",
  expandedTrendIds: [],
  demoTrendDetailsInitialized: false,
  activePage: "feed",
  activeEntity: "",
  entityInfoCache: {},
  eventFilters: { city: "ISTANBUL", type: "Tümü" },
  selectedCategory: "all",
  selectedSubcategory: "Tümü",
  selectedContinent: "global",
  selectedRegions: ["global"],
  selectedSource: "Tümü",
  selectedReadStatus: "Tümü",
  selectedDate: "Tümü",
  selectedSort: "relevance",
  selectedSearchQuery: "",
  impressionSessionKeys: new Set(),
  readTimers: new Map(),
  viewByCategory: false,
  favoriteFeedOnly: false,
  highInterestPanelOpen: false,
  personalFeedTab: "today",
  highInterestMemo: { signature: "", articles: [] },
  personalizedCarouselMemo: { signature: "", articles: [], fallback: false },
  authToken: localStorage.getItem("newspaperAuthToken") || "",
  authUser: JSON.parse(localStorage.getItem("newspaperAuthUser") || "null"),
  lastFetchedAt: 0,
  openArticleId: null,
  entityReturn: null,
  uiLanguage: localStorage.getItem("smartnews_uiLanguage") || "tr",
  finance: {
    preferences: normalizeFinancePreferences(loadLocalFinancePreferences() || DEFAULT_FINANCE_PREFERENCES),
    assets: [],
    sourceHealth: [],
    news: [],
    selectedCardId: "USDTRY",
    loading: false,
    error: "",
    warning: ""
  },
  sources: {
    list: normalizeUserSources(loadLocalUserSources()),
    contents: [],
    preview: null,
    activeFilter: "all",
    loading: false,
    error: "",
    summary: { activeSources: 0, newItems: 0, lastUpdated: "", cacheStatus: "cached" }
  }
};

/* ============================
   DOM REFERENCES
   ============================ */
const searchInput = document.querySelector("#global-search");
const categoryFilter = document.querySelector("#category-filter");
const subcategoryFilter = document.querySelector("#subcategory-filter");
const continentFilter = document.querySelector("#continent-filter");
const sourceFilter = document.querySelector("#source-filter");
const statusFilter = document.querySelector("#status-filter");
const dateFilter = document.querySelector("#date-filter");
const sortFilter = document.querySelector("#sort-filter");
const filterToggleButton = document.querySelector("#filter-toggle");
const filterPopover = document.querySelector("#filter-popover");
const filterActiveCount = document.querySelector("#filter-active-count");
const filterSummaryCard = document.querySelector("#filter-summary-card");
const filterSummaryCount = document.querySelector("#filter-summary-count");
const filterSummaryLine = document.querySelector("#filter-summary-line");
const filterSummaryExtra = document.querySelector("#filter-summary-extra");
const applyFiltersButton = document.querySelector("#apply-filters");
const saveSearchButton = document.querySelector("#save-search");
const savedSearchList = document.querySelector("#saved-search-list");
const recommendedGrid = document.querySelector("#recommended-grid");
const todayHeadlineSection = document.querySelector("#today-headline-section");
const articlePagination = document.querySelector("#article-pagination");
const highInterestOpenButton = document.querySelector("#high-interest-open");
const highInterestSection = document.querySelector("#high-interest-section");
const highInterestList = document.querySelector("#high-interest-list");
const highInterestCount = document.querySelector("#high-interest-count");
const highInterestCloseButton = document.querySelector("#high-interest-close");
const hiPageIntro = document.querySelector("#hi-page-intro");
const hiPageListBlock = document.querySelector("#hi-page-list-block");
const interestInfoOpenButton = document.querySelector("#interest-info-open");
const interestInfoModal = document.querySelector("#interest-info-modal");
const interestInfoDialog = document.querySelector(".interest-info-dialog");
const topicTitle = document.querySelector("#topic-title");
const topicSummary = document.querySelector("#topic-summary");
const topicRelated = document.querySelector("#topic-related");
const topicBack = document.querySelector("#topic-back");
const briefList = document.querySelector("#brief-list");
const eventCityFilter = document.querySelector("#event-city-filter");
const eventTypeFilter = document.querySelector("#event-type-filter");
const headlineList = document.querySelector("#headline-list");
const bookmarkList = document.querySelector("#bookmark-list");
const emptyState = document.querySelector("#empty-state");
const personalTabs = document.querySelector(".personal-tabs");
const personalTabNote = document.querySelector("#personal-tab-note");
const recommendationReasonModal = document.querySelector("#recommendation-reason-modal");
const recommendationReasonDialog = document.querySelector(".recommendation-reason-dialog");
const recommendationReasonTitle = document.querySelector("#recommendation-reason-title");
const recommendationReasonText = document.querySelector("#recommendation-reason-text");
const recommendationReasonFactors = document.querySelector("#recommendation-reason-factors");
/* HeroSlider instance (replaces live-news-card / featured-section) */
let heroSlider = null;
let personalizedCarousel = null;
let eGazeteMode = null;
const detailPanel = document.querySelector("#article-detail");
const detailContent = document.querySelector("#article-detail-content");
const readerBackdrop = document.querySelector("#reader-backdrop");
const profileDetail = document.querySelector("#profile-detail");
const profileBackdrop = document.querySelector("#profile-backdrop");
const openProfileButton = document.querySelector("#open-profile");
const closeProfileButton = document.querySelector("#close-profile");
const profileChipName = document.querySelector(".profile-chip strong");
const profileChipAvatar = document.querySelector(".profile-avatar-trigger .avatar, .profile-chip .avatar");
const brandTitle = document.querySelector("#brand-title");
const brandSubtitle = document.querySelector("#brand-subtitle");
const openNotificationsButton = document.querySelector("#open-notifications");
const notificationPopover = document.querySelector("#notification-popover");
const notificationList = document.querySelector("#notification-list");
const markNotificationsReadButton = document.querySelector("#mark-notifications-read");
const editionCalendarPopover = document.querySelector("#edition-calendar-popover");
const editionCalendarGrid = document.querySelector("#edition-calendar-grid");
const calendarMonthLabel = document.querySelector("#calendar-month-label");
const calendarAgenda = document.querySelector("#calendar-agenda");
const calendarReminderCount = document.querySelector("#calendar-reminder-count");
const calendarTimeInput = document.querySelector("#calendar-time-input");
const calendarNoteInput = document.querySelector("#calendar-note-input");
const calendarSaveNoteButton = document.querySelector("#calendar-save-note");
const logoutButton = document.querySelector("#logout-button");
const integrationStatus = document.querySelector("#integration-status");
const integrationResult = document.querySelector("#integration-result");
const printEditionButton = document.querySelector("#print-edition");
const downloadPdfButton = document.querySelector("#download-pdf");
const printPreview = document.querySelector("#print-preview");
const exportArticleList = document.querySelector("#export-article-list");
const profileForm = document.querySelector("#profile-form");
const profileNameInput = document.querySelector("#profile-name");
const profileAvatarInput = document.querySelector("#profile-avatar-input");
const profileAvatarPreview = document.querySelector("#profile-avatar-preview");
const profileCardName = document.querySelector("#profile-card-name");
const profileCardMeta = document.querySelector("#profile-card-meta");
const removeProfileAvatarButton = document.querySelector("#remove-profile-avatar");
const interestList = document.querySelector("#interest-list");
const darkModeToggle = document.querySelector("#dark-mode-toggle");
const notificationToggle = document.querySelector("#notification-toggle");
const fontSizeRange = document.querySelector("#font-size-range");
const fontSizeValue = document.querySelector("#font-size-value");
const readingGoalInput = document.querySelector("#reading-goal-input");
const resetPreferencesButton = document.querySelector("#reset-preferences");
const profileStatus = document.querySelector("#profile-status");
const readingStats = document.querySelector("#reading-stats");
const sidebarSourceNews = document.querySelector("#sidebar-source-news");
const sidebarEconomyData = document.querySelector("#sidebar-economy-data");
const categoryChart = document.querySelector("#category-chart");
const financeWatchlistMini = document.querySelector("#finance-watchlist-mini");
const financeDashboardGrid = document.querySelector("#finance-dashboard-grid");
const financeSourceHealth = document.querySelector("#finance-source-health");
const financeNewsPanel = document.querySelector("#finance-news-panel");
const financeNewsTitle = document.querySelector("#finance-news-title");
const financePreferenceModal = document.querySelector("#finance-preference-modal");
const financePreferenceDialog = document.querySelector(".finance-preference-dialog");
const financePreferenceBody = document.querySelector("#finance-preference-body");
const financePreferenceStatus = document.querySelector("#finance-preference-status");
const financeShowHomeInput = document.querySelector("#finance-show-home");
const financeRefreshInterval = document.querySelector("#finance-refresh-interval");
const sourceUrlInput = document.querySelector("#source-url-input");
const sourceTypeSelect = document.querySelector("#source-type-select");
const sourceCategorySelect = document.querySelector("#source-category-select");
const sourceTagsInput = document.querySelector("#source-tags-input");
const sourceStatus = document.querySelector("#source-status");
const sourceCardsGrid = document.querySelector("#source-cards-grid");
const sourceContentList = document.querySelector("#source-content-list");
const sourceFilterTabs = document.querySelector("#source-filter-tabs");
const sourceRadarSummary = document.querySelector("#source-radar-summary");
const sourcePreviewModal = document.querySelector("#source-preview-modal");
const sourcePreviewBody = document.querySelector("#source-preview-body");
const sourcePreviewAddBtn = document.querySelector("#source-preview-add");
const authOverlay = document.querySelector("#auth-overlay");
const authStatus = document.querySelector("#auth-status");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const onboardingForm = document.querySelector("#onboarding-form");
const loginUsername = document.querySelector("#login-username");
const loginPassword = document.querySelector("#login-password");
const registerUsername = document.querySelector("#register-username");
const registerPassword = document.querySelector("#register-password");
const registerPasswordRepeat = document.querySelector("#register-password-repeat");
const onboardingGoal = document.querySelector("#onboarding-goal");

/* ============================
   UTILITIES
   ============================ */
// escapeHtml and normalizeText imported from ./utils/textUtils.js

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(value || "");
  return textarea.value;
}

function usernameToEmail(username) {
  const clean = normalizeText(username)
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/\s+/g, ".") || "okur";
  return `${clean}@kisisel-gazetem.local`;
}

function onboardingKey(username = state.authUser?.name) {
  return `newspaperOnboardingComplete:${normalizeText(username || "demo")}`;
}

/* ============================
   TOAST NOTIFICATIONS
   ============================ */
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icons = { success: "fa-circle-check", error: "fa-circle-xmark", info: "fa-circle-info" };
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${escapeHtml(message)}`;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("toast-visible"));
  });
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ============================
   AUTH
   ============================ */
function setAuthSession(payload, username) {
  state.authToken = payload.token;
  state.authUser = payload.user || { name: username };
  localStorage.setItem("newspaperAuthToken", state.authToken);
  localStorage.setItem("newspaperAuthUser", JSON.stringify(state.authUser));
}

function showAuthStep(step) {
  if (!loginForm || !registerForm || !onboardingForm) return;
  loginForm.hidden = step !== "login";
  registerForm.hidden = step !== "register";
  onboardingForm.hidden = step !== "onboarding";
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === step);
  });
}

function sourceLogoUrl(sourceUrl) {
  try {
    const domain = new URL(sourceUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  } catch { return ""; }
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const pendingKey = method === "GET" ? `${method}:${path}` : "";
  if (pendingKey && pendingApiRequests.has(pendingKey)) return pendingApiRequests.get(pendingKey);

  const request = (async () => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {})
      },
      ...options
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text.replace(/^\uFEFF/, "")) : {};
    } catch {
      payload = { error: text || "Sunucudan JSON olmayan cevap geldi." };
    }
    if (!response.ok) throw new Error(payload.error || "API istegi basarisiz.");
    return payload;
  })();

  if (pendingKey) {
    pendingApiRequests.set(pendingKey, request);
    request.then(
      () => pendingApiRequests.delete(pendingKey),
      () => pendingApiRequests.delete(pendingKey)
    );
  }
  return request;
}

function buildArticleShareSnapshot(article = {}) {
  return {
    title: article.title || article.displayTitle || "",
    summary: article.summary || article.description || article.displaySummary || "",
    source: article.source || article.sourceName || "",
    url: article.sourceUrl || article.url || "",
    publishedAt: article.publishedAt || article.date || "",
    clusterId: article.clusterId || "",
    sourceCount: article.sourceCount || 1,
    sources: Array.isArray(article.sources) ? article.sources.slice(0, 10) : []
  };
}

function userInitials(user = {}) {
  const label = String(user.displayName || user.username || "?").trim();
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : label.slice(0, 2)).toLocaleUpperCase("tr-TR");
}

function renderShareTargetAvatar(user = {}) {
  if (user.avatarUrl && user.avatarUrl !== "/avatars/default.png") {
    return `<img src="${escapeHtml(user.avatarUrl)}" alt="" loading="lazy" onerror="this.remove();">`;
  }
  return `<span>${escapeHtml(userInitials(user))}</span>`;
}

function initModalSharePicker(root, article = {}) {
  const picker = root?.querySelector("[data-modal-share-picker]");
  const input = picker?.querySelector("[data-share-user-input]");
  const menu = picker?.querySelector("[data-share-user-menu]");
  const clearButton = picker?.querySelector("[data-share-user-clear]");
  const chip = picker?.querySelector("[data-selected-chip]");
  const sendButton = root?.querySelector("#modal-internal-share-btn");
  if (!picker || !input || !menu || !sendButton) return;

  let selectedUser = null;
  let debounceTimer = null;
  let requestSeq = 0;

  const setMenu = (html, open = true) => {
    menu.innerHTML = html;
    menu.hidden = !open;
  };
  const setSelectedUser = (user) => {
    selectedUser = user || null;
    sendButton.disabled = !selectedUser;
    if (selectedUser) {
      input.value = "";
      input.placeholder = "";
      chip.textContent = `${selectedUser.displayName || selectedUser.username} @${selectedUser.username || "kullanici"}`;
      chip.hidden = false;
      if (clearButton) clearButton.hidden = false;
      menu.hidden = true;
    } else {
      chip.hidden = true;
      if (clearButton) clearButton.hidden = true;
      input.placeholder = "Platform içi kullanıcı ara...";
    }
  };
  const renderUsers = (users = []) => {
    if (!users.length) {
      setMenu(`<div class="modal-user-share-state">Kayıtlı kullanıcı bulunamadı.</div>`);
      return;
    }
    setMenu(users.map((user) => `
      <button type="button" class="modal-user-share-option" data-user-id="${escapeHtml(user.id)}">
        <span class="modal-user-share-avatar">${renderShareTargetAvatar(user)}</span>
        <span class="modal-user-share-text">
          <strong>${escapeHtml(user.displayName || "Kullanıcı")}</strong>
          <small>@${escapeHtml(user.username || "kullanici")}</small>
        </span>
      </button>
    `).join(""));
    menu.querySelectorAll("[data-user-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const user = users.find((item) => String(item.id) === String(button.dataset.userId));
        setSelectedUser(user);
      });
    });
  };
  const loadUsers = async (query = "") => {
    const seq = ++requestSeq;
    setMenu(`<div class="modal-user-share-state"><span class="modal-user-share-spinner"></span>Kullanıcılar yükleniyor...</div>`);
    try {
      const path = `/api/users/share-targets${query ? `?q=${encodeURIComponent(query)}` : ""}`;
      const payload = await api(path);
      if (seq !== requestSeq) return;
      renderUsers(payload.users || []);
    } catch {
      if (seq !== requestSeq) return;
      setMenu(`<div class="modal-user-share-state is-error">Kullanıcı listesi alınamadı. Tekrar deneyin.</div>`);
    }
  };

  input.addEventListener("focus", () => loadUsers(input.value.trim()));
  input.addEventListener("input", () => {
    setSelectedUser(null);
    window.clearTimeout(debounceTimer);
    const query = input.value.trim().slice(0, 80);
    debounceTimer = window.setTimeout(() => loadUsers(query), 300);
  });
  clearButton?.addEventListener("click", () => {
    setSelectedUser(null);
    input.value = "";
    input.focus();
    loadUsers("");
  });
  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) menu.hidden = true;
  });
  picker.addEventListener("click", (event) => event.stopPropagation());
  sendButton.addEventListener("click", async () => {
    if (!selectedUser) return;
    sendButton.disabled = true;
    sendButton.classList.add("is-loading");
    try {
      await api(`/api/articles/${encodeURIComponent(article.id)}/share`, {
        method: "POST",
        body: JSON.stringify({
          receiverUserId: selectedUser.id,
          message: "Bu haberi seninle paylaşmak istedim.",
          clusterId: article.clusterId || "",
          articleSnapshot: buildArticleShareSnapshot(article)
        })
      });
      showToast("Haber başarıyla gönderildi.", "success");
      setSelectedUser(null);
    } catch (error) {
      showToast(error.message || "Paylaşım başarısız oldu.", "error");
      sendButton.disabled = !selectedUser;
    } finally {
      sendButton.classList.remove("is-loading");
    }
  });
}

function toUiArticle(article) {
  const categoryInfo = detectNewsCategories(article);
  const category = categoryLabel(categoryInfo.primaryCategory);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const detectedRegion = detectNewsRegions(article);
  const baseArticle = {
    id: article.id,
    category,
    actualNewsCategory: categoryInfo.primaryCategory,
    detectedCategory: categoryInfo.primaryCategory,
    detectedCategories: categoryInfo.categories,
    matchedCategoryKeywords: categoryInfo.matchedCategoryKeywords,
    subcategory,
    continent: detectedRegion.primaryRegion,
    regions: detectedRegion.regions,
    country: article.country || detectedRegion.country || "",
    detectedLocationKeywords: detectedRegion.detectedLocationKeywords,
    relevanceScore: detectedRegion.relevanceScore,
    title: article.title,
    summary: article.summary || article.description || "",
    description: article.description || article.fullText || article.summary || "",
    fullText: article.fullText || article.description || article.summary || "",
    source: article.sourceName || article.source,
    sourceUrl: article.sourceUrl || article.url,
    url: article.sourceUrl || article.url,
    imageUrl: article.imageUrl || article.image,
    image: article.imageUrl || article.image,
    publishedAt: article.publishedAt,
    date: article.date || new Date(article.publishedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }),
    dateRange: article.dateRange || "Son 24 saat",
    readTime: article.readTime || `${Math.max(2, Math.round((article.fullText || article.summary || "").length / 900))} dk`,
    relevance: article.relevance ?? 25,
    status: article.status || "Okunmadı",
    bookmarked: Boolean(article.bookmarked),
    aiSummary: article.aiSummary,
    contentStatus: article.contentStatus,
    contentWarning: article.contentWarning || "",
    contentFallbackStatus: article.contentFallbackStatus || ""
    ,
    originalTitle: article.originalTitle || article.title || "",
    originalSummary: article.originalSummary || article.summary || "",
    translatedTitle: article.translatedTitle || "",
    translatedSummary: article.translatedSummary || "",
    displayTitle: article.displayTitle || article.title || "",
    displaySummary: article.displaySummary || article.summary || "",
    sourceRegion: article.sourceRegion || "",
    sourceCountry: article.sourceCountry || "",
    sourceCountryCode: article.sourceCountryCode || "",
    detectedEventRegion: article.detectedEventRegion || "",
    mentionedRegions: Array.isArray(article.mentionedRegions) ? article.mentionedRegions : [],
    mentionedCountries: Array.isArray(article.mentionedCountries) ? article.mentionedCountries : [],
    namedEntities: article.namedEntities || {},
    topics: Array.isArray(article.topics) ? article.topics : [],
    isDemo: Boolean(article.isDemo),
    demoScenario: article.demoScenario || ""
  };
  baseArticle.relevance = calculatePersonalizedScore(baseArticle);
  baseArticle.interestScore = baseArticle.relevance;
  return enrichArticleCategory(enrichArticleRegion(baseArticle));
}

let isLoadingData = false;

function setRefreshButtonState(loading) {
  const btn = document.getElementById("refresh-news-btn");
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<i class="fa-solid fa-rotate fa-spin"></i> Yükleniyor...`
    : `<i class="fa-solid fa-rotate"></i> Taze Haberleri Getir`;
}

function updateLastFetchedDisplay() {
  const el = document.getElementById("last-fetched-display");
  if (!el) return;
  if (!state.lastFetchedAt) { el.textContent = ""; return; }
  const mins = Math.floor((Date.now() - state.lastFetchedAt) / 60000);
  el.textContent = mins < 1 ? "Az önce güncellendi" : `${mins} dakika önce güncellendi`;
}

async function loadBackendData({ force = false } = {}) {
  if (isLoadingData) return;
  if (!force) {
    const cachedFeed = readNewsCache(NEWS_FEED_CACHE_KEY, "feed");
    if (cachedFeed?.articles?.length >= NEWS_CACHE_MIN_FEED_ITEMS) {
      const articles = cachedFeed.articles;
      state.data = {
        ...state.data,
        articles,
        last24: articles.slice(0, 5).map((article) => ({
          id: article.id,
          category: article.category,
          title: article.title,
          summary: article.summary,
          source: article.source,
          time: article.date
        }))
      };
      state.usingApi = true;
      return;
    }
    if (cachedFeed?.articles?.length) {
      safeStorageRemove(NEWS_FEED_CACHE_KEY);
    }
  }

  isLoadingData = true;
  setRefreshButtonState(true);
  try {
    const regionParam = currentSelectedRegions().join(",");
    const feed = await api(`/api/feed?lang=${state.uiLanguage || "tr"}&region=${regionParam}`);
    const articles = feed.articles.map(toUiArticle);
    state.data = {
      ...state.data,
      articles,
      last24: articles.slice(0, 5).map((article) => ({
        id: article.id,
        category: article.category,
        title: article.title,
        summary: article.summary,
        source: article.source,
        time: article.date
      }))
    };
    writeNewsCache(NEWS_FEED_CACHE_KEY, articles, { signature: "feed", totalCount: articles.length });
    state.usingApi = true;
    state.lastFetchedAt = Date.now();
    updateLastFetchedDisplay();
  } catch {
    state.usingApi = false;
  } finally {
    isLoadingData = false;
    setRefreshButtonState(false);
  }
}

function updateSelectOptions(select, values, allLabel, options = {}) {
  if (!select) return;
  const currentValue = select.value;
  const cleanValues = [...new Set(values.filter(Boolean))];
  const orderedValues = options.sort === false
    ? cleanValues
    : cleanValues.sort((a, b) => a.localeCompare(b, "tr-TR"));
  const optionValues = [allLabel, ...orderedValues.filter((value) => value !== allLabel)];
  select.innerHTML = optionValues.map((value) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
  ).join("");
  select.value = optionValues.includes(currentValue) ? currentValue : allLabel;
}

function updateRegionSelectOptions() {
  if (!continentFilter) return;
  continentFilter.value = normalizeSelectedRegions(state.selectedRegions || continentFilter.value || "global").join(",");
}

function availableCategoryOptions() {
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const presentValues = new Set(
    articles
      .map((article) => categoryValue(article.category || inferArticleCategory(article)))
      .filter((value) => value && value !== "all")
  );
  const options = CATEGORY_OPTIONS.filter((category) => category.value === "all" || presentValues.has(category.value));
  return options.length > 1 ? options : CATEGORY_OPTIONS;
}

function updateCategorySelectOptions() {
  if (!categoryFilter) return;
  const currentValue = categoryValue(categoryFilter.value || state.selectedCategory || "all");
  const options = availableCategoryOptions();
  categoryFilter.innerHTML = options.map((category) =>
    `<option value="${escapeHtml(category.value)}">${escapeHtml(category.label)}</option>`
  ).join("");
  categoryFilter.value = options.some((category) => category.value === currentValue) ? currentValue : "all";
}

function updateSubcategoryOptions() {
  const selectedCategory = categoryFilter?.value || "all";
  const available = categoryValue(selectedCategory) === "all"
    ? ALL_SUBCATEGORIES
    : subcategoriesForCategory(categoryLabel(selectedCategory));
  updateSelectOptions(subcategoryFilter, available, "Tümü", { sort: false });
}

function syncRegionPickerState() {
  const selectedRegions = pendingSelectedRegions();
  const isGlobal = selectedRegions.includes("global");
  document.querySelectorAll("[data-region-value]").forEach((button) => {
    const value = regionValue(button.dataset.regionValue);
    const active = isGlobal ? value === "global" : selectedRegions.includes(value);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-region-map]").forEach((node) => {
    const value = regionValue(node.dataset.regionMap);
    const active = isGlobal || selectedRegions.includes(value);
    node.classList.toggle("active", active);
  });
}

function setSelectedRegions(regions, { render = true, commit = true } = {}) {
  const selectedRegions = normalizeSelectedRegions(regions);
  if (continentFilter) continentFilter.value = selectedRegions.join(",");
  if (commit) {
    state.selectedRegions = selectedRegions;
    state.selectedContinent = state.selectedRegions[0] || "global";
    syncFilterStateFromControls();
  }
  syncRegionPickerState();
  if (!render) return;
  state.currentPage = 1;
  renderArticles();
}

function toggleSelectedRegion(region, options = {}) {
  const value = regionValue(region);
  if (value === "global") {
    setSelectedRegions(["global"], options);
    return;
  }
  const current = pendingSelectedRegions().filter((item) => item !== "global");
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  setSelectedRegions(next.length ? next : ["global"], options);
}

function renderRegionPicker() {
  const buttons = document.getElementById("region-buttons");
  if (buttons) {
    buttons.innerHTML = REGION_OPTIONS.map((region) => `
      <button type="button" data-region-value="${escapeHtml(region.value)}" aria-pressed="false">
        <i class="fa-solid ${escapeHtml(region.icon)}" aria-hidden="true"></i>
        <span>${escapeHtml(region.label)}</span>
      </button>
    `).join("");
  }
  syncRegionPickerState();
}

function syncFilterStateFromControls() {
  state.selectedSearchQuery = searchInput?.value?.trim() || "";
  state.selectedCategory = categoryValue(categoryFilter?.value || "all");
  if (categoryFilter) categoryFilter.value = state.selectedCategory;
  state.selectedSubcategory = subcategoryFilter?.value || "Tümü";
  state.selectedRegions = normalizeSelectedRegions(continentFilter?.value || state.selectedRegions || "global");
  state.selectedContinent = state.selectedRegions[0] || "global";
  if (continentFilter) continentFilter.value = state.selectedRegions.join(",");
  state.selectedSource = sourceFilter?.value || "Tümü";
  state.selectedReadStatus = statusFilter?.value || "Tümü";
  state.selectedDate = dateFilter?.value || "Tümü";
  state.selectedSort = sortFilter?.value || "relevance";
  if (sourceFilter) sourceFilter.value = state.selectedSource;
  if (statusFilter) statusFilter.value = state.selectedReadStatus;
  if (dateFilter) dateFilter.value = state.selectedDate;
  if (sortFilter) sortFilter.value = state.selectedSort;
  syncRegionPickerState();
}

function syncFilterControlsFromState() {
  if (searchInput) searchInput.value = state.selectedSearchQuery || "";
  if (categoryFilter) categoryFilter.value = state.selectedCategory || "all";
  updateSubcategoryOptions();
  if (subcategoryFilter) subcategoryFilter.value = state.selectedSubcategory || "Tümü";
  if (continentFilter) continentFilter.value = normalizeSelectedRegions(state.selectedRegions || "global").join(",");
  if (sortFilter) sortFilter.value = state.selectedSort || "relevance";
  syncRegionPickerState();
}

function normalizeLoadedData() {
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  state.data.articles = personalizeArticleScores(articles.map((article) => ({
    ...enrichArticleCategory(enrichArticleRegion(article)),
    subcategory: inferArticleSubcategory(article)
  })));
  if (Array.isArray(state.data?.last24)) {
    state.data.last24 = state.data.last24.map((article) => ({
      ...enrichArticleCategory(enrichArticleRegion(article)),
      subcategory: inferArticleSubcategory(article)
    }));
  }
}

function populateFilters() {
  normalizeLoadedData();
  updateCategorySelectOptions();
  updateSubcategoryOptions();
  updateRegionSelectOptions();
  updateSelectOptions(sourceFilter, [...new Set(state.data.articles.map((a) => a.source))], "Tümü");
  syncFilterStateFromControls();
  renderRegionPicker();
}

/* ============================
   PAGE NAVIGATION
   ============================ */
function showPage(pageName) {
  if (pageName === "export") {
    pageName = "feed";
  }
  state.activePage = pageName;
  document.body.dataset.activePage = pageName;
  document.querySelectorAll(".page-view").forEach((section) => {
    const pages = (section.dataset.pages || "").split(/\s+/).filter(Boolean);
    section.hidden = !pages.includes(pageName);
  });
  const showHomeDashboard = pageName === "feed";
  document.querySelector("#category-sidebar")?.toggleAttribute("hidden", !showHomeDashboard);
  document.querySelector(".premium-right-sidebar")?.toggleAttribute("hidden", !showHomeDashboard);
  // Legacy section-list nav
  document.querySelectorAll(".section-list a[data-page]").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === pageName);
  });
  // Edition tab nav
  activateEditionTab(null, pageName);
  if (pageName === "feed" || pageName === "search" || pageName === "foryou") {
    renderArticles();
  }
  if (pageName === "calendar") {
    renderEditionCalendar();
  }
  if (pageName === "my-calendar") {
    const calContainer = document.getElementById("my-calendar-content");
    if (calContainer) renderCalendarPage(calContainer);
  }
  if (pageName === "high-interest") {
    renderHighInterestPage();
  }
  if (pageName === "economy") {
    renderFinanceRadar();
  }
  if (pageName === "sources") {
    renderSourceCenter();
  }
  if (pageName === "egazete") {
    renderEGazeteDashboard();
  }
}
// Expose globally so eGazeteMode.returnToPreviousUI() can call it
window.showPage = showPage;

function showFilteredPersonalFeed({ scroll = false } = {}) {
  state.viewByCategory = false;
  showPage("foryou");
  if (scroll) {
    document.getElementById("article-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ============================
   PREFERENCES
   ============================ */
function normalizePreferences(preferences = {}) {
  const validReadingTimes = ["morning", "noon", "evening", "night"];
  const validDepths = ["short", "detailed", "mixed"];
  const normalizedInterests = Array.isArray(preferences.interests)
    ? [...new Set(preferences.interests.map(normalizeCategoryName).filter((category) => TOPIC_CATEGORIES.includes(category)))]
    : [];
  const normalizedUserInterest = preferences.userInterest || preferences.interestScores
    ? normalizeUserInterest(preferences.userInterest || preferences.interestScores || {}, normalizedInterests.length ? normalizedInterests : ["Teknoloji", "Bilim"])
    : loadUserInterestFromStorage(normalizedInterests.length ? normalizedInterests : ["Teknoloji", "Bilim"]);
  return {
    interests: normalizedInterests.length ? normalizedInterests : ["Teknoloji", "Bilim"],
    userInterest: normalizedUserInterest,
    preferredSources: Array.isArray(preferences.preferredSources) ? preferences.preferredSources : [],
    readingTimes: Array.isArray(preferences.readingTimes)
      ? preferences.readingTimes.filter((t) => validReadingTimes.includes(t))
      : [],
    contentDepth: validDepths.includes(preferences.contentDepth) ? preferences.contentDepth : "mixed",
    readingMode: preferences.readingMode || "daily",
    language: preferences.language || "tr",
    notifications: preferences.notifications !== false,
    notificationTypes: {
      highInterest: preferences.notificationTypes?.highInterest !== false,
      trends: preferences.notificationTypes?.trends !== false,
    },
    notificationThreshold: Math.min(95, Math.max(60, Number(preferences.notificationThreshold || 85))),
    darkMode: Boolean(preferences.darkMode),
    fontScale: Math.min(120, Math.max(90, Number(preferences.fontScale || 100))),
    readingGoal: Math.max(1, Number(preferences.readingGoal || 20))
  };
}

function applyReadabilityPreferences(preferences) {
  const fontScale = Math.min(120, Math.max(90, Number(preferences.fontScale || 100)));
  document.documentElement.classList.toggle("dark-mode", Boolean(preferences.darkMode));
  document.documentElement.style.fontSize = `${fontScale}%`;
  document.documentElement.style.setProperty("--read-scale", String(fontScale / 100));
  if (fontSizeValue) fontSizeValue.textContent = `${fontScale}%`;
  document.body.dataset.depth = preferences.contentDepth || "mixed";
}

/* ============================
   UI LANGUAGE SYSTEM
   ============================ */

/**
 * Returns localized text for an article field based on current UI language.
 * Priority: translations[lang] > original field > fallback
 */
function getLocalizedText(article, field, fallback = "") {
  const lang = state.uiLanguage || "tr";
  // Check if article has translation for this language
  const t = article.translations && article.translations[lang];
  if (t) {
    if (field === "title" && t.title) return t.title;
    if (field === "summary" && t.summary) return t.summary;
    if (field === "content" && t.content) return t.content;
  }
  // Fallback: if no translation, return original field
  return article[field] || fallback;
}

/** Sets the active UI language, persists to localStorage, updates buttons, re-renders */
function setUiLanguage(lang) {
  if (lang !== "tr" && lang !== "en") return;
  const isChanged = state.uiLanguage !== lang;
  state.uiLanguage = lang;
  localStorage.setItem("smartnews_uiLanguage", lang);
  // Update button visual state
  document.querySelectorAll("#lang-toggle-btns .lang-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
  // Update html lang attribute for accessibility
  document.documentElement.lang = lang;
  if (isChanged) {
    loadBackendData({ force: true }).then(() => {
      renderArticles();
      if (state.openArticleId && detailPanel && !detailPanel.hidden) {
        showDetail(state.openArticleId);
      }
    });
  } else {
    renderArticles();
    if (state.openArticleId && detailPanel && !detailPanel.hidden) {
      showDetail(state.openArticleId);
    }
  }
}

/** Initialize language toggle buttons */
function initLangToggle() {
  const langBtns = document.querySelectorAll("#lang-toggle-btns .lang-btn");
  langBtns.forEach(btn => {
    // Set initial active state
    btn.classList.toggle("active", btn.dataset.lang === state.uiLanguage);
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;
      if (lang && lang !== state.uiLanguage) {
        setUiLanguage(lang);
      }
    });
  });
  // Also set html lang
  document.documentElement.lang = state.uiLanguage;
}

const READING_TIME_LABELS = {
  morning: { label: "Sabah okuyucusu", icon: "fa-mug-saucer", range: [5, 11] },
  noon: { label: "Öğle okuyucusu", icon: "fa-sun", range: [11, 17] },
  evening: { label: "Akşam okuyucusu", icon: "fa-cloud-sun", range: [17, 22] },
  night: { label: "Gece okuyucusu", icon: "fa-moon", range: [22, 5] }
};

const CONTENT_DEPTH_LABELS = {
  short: { label: "Hızlı özet stili", icon: "fa-bolt" },
  mixed: { label: "Karma okuyucu", icon: "fa-shuffle" },
  detailed: { label: "Detay tutkunu", icon: "fa-book-open" }
};

function currentTimeSlot() {
  const hour = new Date().getHours();
  for (const [slot, info] of Object.entries(READING_TIME_LABELS)) {
    const [start, end] = info.range;
    if (start < end) {
      if (hour >= start && hour < end) return slot;
    } else {
      if (hour >= start || hour < end) return slot;
    }
  }
  return null;
}

function trimSummary(text) {
  const depth = state.data.preferences?.contentDepth || "mixed";
  const limits = { short: 80, mixed: 160, detailed: 280 };
  const limit = limits[depth] || 160;
  const clean = String(text || "").trim();
  if (clean.length <= limit) return clean;
  return clean.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}

let pendingRegister = null;
const PROFILE_AVATAR_KEY = "smartNewspaperProfileAvatar";
const PROFILE_FALLBACK_KEY = "smartNewspaperProfileFallback";
const NOTIFICATION_READ_KEY = "smartNewspaperReadNotifications";
const CALENDAR_PERSONAL_KEY = "smartNewspaperCalendarPersonalization";
let selectedCalendarDay = "";

function getStoredReadNotifications() {
  try { return JSON.parse(localStorage.getItem(NOTIFICATION_READ_KEY) || "[]"); }
  catch { return []; }
}

function setStoredReadNotifications(ids) {
  localStorage.setItem(NOTIFICATION_READ_KEY, JSON.stringify([...new Set(ids)]));
}

function getCalendarPersonalization() {
  try { return JSON.parse(localStorage.getItem(CALENDAR_PERSONAL_KEY) || "{}"); }
  catch { return {}; }
}

function saveCalendarPersonalization(data) {
  localStorage.setItem(CALENDAR_PERSONAL_KEY, JSON.stringify(data));
}

function initialsFromName(name) {
  return String(name || "Okur").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join("").toLocaleUpperCase("tr-TR") || "OK";
}

function personalizedNewspaperSubtitle(name = profileNameInput?.value || state.authUser?.name) {
  const fallback = state.authUser?.email || state.authUser?.name || name || "Okur";
  const display = String(name || fallback || "Okur").trim();
  return `${display}'in kişiselleştirilmiş gazetesi`;
}

function updateNewspaperTitle(name = profileNameInput?.value || state.authUser?.name) {
  if (brandTitle) brandTitle.textContent = "Smart Newspaper";
  if (brandSubtitle) brandSubtitle.textContent = personalizedNewspaperSubtitle(name);
  const brandUserName = document.getElementById("brand-user-name");
  if (brandUserName) brandUserName.textContent = name ? `${name}'in ` : "";
}

function renderAvatar(target, name) {
  if (!target) return;
  const avatar = localStorage.getItem(PROFILE_AVATAR_KEY);
  if (avatar) {
    target.innerHTML = `<img src="${avatar}" alt="">`;
    target.classList.add("has-image");
  } else {
    target.textContent = initialsFromName(name);
    target.classList.remove("has-image");
  }
}

function updateProfileCardSummary(name) {
  const preferences = normalizePreferences(state.data.preferences || {});
  const selectedInterests = interestList
    ? [...interestList.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value)
    : preferences.interests;
  const selectedReadingTimes = document.querySelectorAll("#profile-reading-times input[name='readingTime']:checked").length
    ? [...document.querySelectorAll("#profile-reading-times input[name='readingTime']:checked")].map((input) => input.value)
    : preferences.readingTimes;
  const selectedDepth = document.querySelector("#profile-content-depth input[name='contentDepth']:checked")?.value || preferences.contentDepth;
  const firstReadingTime = selectedReadingTimes?.[0];
  const readingLabel = firstReadingTime
    ? READING_TIME_LABELS[firstReadingTime]?.label
    : READING_TIME_LABELS[currentTimeSlot()]?.label;
  const depthLabel = CONTENT_DEPTH_LABELS[selectedDepth]?.label || "Karma okuyucu";
  const interestCount = selectedInterests?.length || 0;
  if (profileCardName) profileCardName.textContent = name || state.authUser?.name || "Kullanıcı";
  if (profileCardMeta) {
    profileCardMeta.textContent = [
      readingLabel || "Günlük okur",
      depthLabel,
      `${interestCount} ilgi alanı seçildi`
    ].filter(Boolean).join(" · ");
  }
  if (removeProfileAvatarButton) {
    removeProfileAvatarButton.hidden = !localStorage.getItem(PROFILE_AVATAR_KEY);
  }
}

function updateProfileChip(name) {
  const displayName = name || state.authUser?.name || "Kullanıcı";
  if (profileChipName) profileChipName.textContent = displayName;
  renderAvatar(profileChipAvatar, displayName);
  renderAvatar(profileAvatarPreview, displayName);
  updateProfileCardSummary(displayName);
  updateNewspaperTitle(displayName);
}

function renderProfileForm(profile) {
  const preferences = normalizePreferences(profile?.preferences);
  state.data.preferences = preferences;
  if (profile?.user?.name) {
    state.authUser = { ...(state.authUser || {}), ...profile.user };
    localStorage.setItem("newspaperAuthUser", JSON.stringify(state.authUser));
  }
  if (profileNameInput) profileNameInput.value = profile?.user?.name || state.authUser?.name || "Kullanıcı";
  updateProfileChip(profileNameInput?.value);
  updateNewspaperTitle(profileNameInput?.value);
  if (darkModeToggle) darkModeToggle.checked = preferences.darkMode;
  if (notificationToggle) notificationToggle.checked = preferences.notifications;
  if (fontSizeRange) fontSizeRange.value = preferences.fontScale;
  if (readingGoalInput) readingGoalInput.value = preferences.readingGoal;
  interestList?.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = preferences.interests.includes(input.value);
  });
  document.querySelectorAll("#profile-reading-times input[name='readingTime']").forEach((input) => {
    input.checked = preferences.readingTimes.includes(input.value);
  });
  document.querySelectorAll("#profile-content-depth input[name='contentDepth']").forEach((input) => {
    input.checked = input.value === preferences.contentDepth;
  });
  updateProfileCardSummary(profileNameInput?.value);
  applyReadabilityPreferences(preferences);
  renderReadingInsights();
  renderInterestCloud();
  renderCategoryNav(state.data.articles || []);
  renderPersonaChips();
  updateEditionStrip();
  applyReadingTimeBanner();
}

function getProfileFormPayload() {
  const interests = [...interestList.querySelectorAll("input[type='checkbox']:checked")].map((i) => i.value);
  const readingTimes = [...document.querySelectorAll("#profile-reading-times input[name='readingTime']:checked")].map((i) => i.value);
  const contentDepth = document.querySelector("#profile-content-depth input[name='contentDepth']:checked")?.value || "mixed";
  const currentPreferences = normalizePreferences(state.data.preferences || {});
  return {
    name: profileNameInput.value.trim(),
    preferences: normalizePreferences({
      interests,
      readingTimes,
      contentDepth,
      language: currentPreferences.language || "tr",
      notifications: notificationToggle?.checked !== false,
      notificationTypes: currentPreferences.notificationTypes,
      notificationThreshold: currentPreferences.notificationThreshold,
      darkMode: darkModeToggle?.checked,
      fontScale: Number(fontSizeRange?.value || currentPreferences.fontScale),
      readingGoal: Number(readingGoalInput?.value || currentPreferences.readingGoal)
    })
  };
}

function applyProfilePayloadLocally(payload) {
  applyReadabilityPreferences(payload.preferences);
  updateProfileChip(payload.name);
  updateNewspaperTitle(payload.name);
  state.authUser = { ...(state.authUser || {}), name: payload.name };
  localStorage.setItem("newspaperAuthUser", JSON.stringify(state.authUser));
  state.data.preferences = payload.preferences;
  localStorage.setItem(PROFILE_FALLBACK_KEY, JSON.stringify({
    user: { name: payload.name },
    preferences: payload.preferences
  }));
  renderArticles();
  renderExportArticleOptions();
  renderInterestCloud();
  updateEditionStrip();
  renderNotifications();
}

async function loadProfile() {
  try {
    const fallbackProfile = JSON.parse(localStorage.getItem(PROFILE_FALLBACK_KEY) || "null");
    const profile = state.usingApi ? await api("/api/profile") : fallbackProfile || {
      user: { name: state.authUser?.name || "Kullanıcı" },
      preferences: state.data.preferences
    };
    renderProfileForm(profile);
  } catch (error) {
    const fallbackProfile = JSON.parse(localStorage.getItem(PROFILE_FALLBACK_KEY) || "null");
    if (profileStatus) profileStatus.textContent = "Profil sunucudan yüklenemedi. Bu cihazdaki son ayarlar kullanılıyor.";
    renderProfileForm(fallbackProfile || {});
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const payload = getProfileFormPayload();
  if (!payload.name) { profileStatus.textContent = "Ad soyad alanı boş bırakılamaz."; return; }
  if (!payload.preferences.interests.length) { profileStatus.textContent = "En az bir ilgi alanı seçilmelidir."; return; }

  try {
    profileStatus.textContent = "Kaydediliyor...";
    applyProfilePayloadLocally(payload);
    if (state.usingApi) {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ name: payload.name }) });
      await api("/api/profile/preferences", { method: "PUT", body: JSON.stringify(payload.preferences) });
      await loadBackendData();
      populateFilters();
      renderStaticLists();
      renderArticles();
      renderExportArticleOptions();
      startLiveNews();
    }
    profileStatus.textContent = "Tercihler kaydedildi ve akış güncellendi.";
    showToast("Tercihler kaydedildi.", "success");
    closeProfileDetail();
  } catch (error) {
    profileStatus.textContent = "Sunucuya ulaşılamadı. Ayarlar bu cihazda uygulandı, bağlantı gelince tekrar kaydedebilirsin.";
    showToast("Sunucuya ulaşılamadı; ayarlar yerel olarak uygulandı.", "error");
    renderArticles();
    renderExportArticleOptions();
    renderNotifications();
  }
}

function resetProfilePreferences() {
  renderProfileForm({
    user: { name: profileNameInput.value || state.authUser?.name || "Kullanıcı" },
    preferences: { interests: ["Teknoloji", "Bilim", "Dünya"], language: "tr", notifications: true, darkMode: false, fontScale: 100, readingGoal: 20 }
  });
  profileStatus.textContent = "Varsayılan tercihler forma yüklendi. Kalıcı yapmak için Kaydet'i kullan.";
}

function logout() {
  localStorage.removeItem("newspaperAuthToken");
  localStorage.removeItem("newspaperAuthUser");
  state.authToken = "";
  state.authUser = null;
  closeProfileDetail();
  pendingRegister = null;
  if (loginForm) loginForm.reset();
  if (registerForm) registerForm.reset();
  authStatus.textContent = "Oturum kapatıldı.";
  showAuthStep("login");
  authOverlay.hidden = false;
  showToast("Çıkış yapıldı.", "info");
}

function getNotificationItems() {
  const now = new Date();
  const todayKey = dateKey(now);
  const personal = getCalendarPersonalization();

  const personalReminders = [];
  // Get reminders for today and tomorrow
  [todayKey, dateKey(new Date(now.getTime() + 86400000))].forEach(key => {
    const dayData = personal[key];
    if (dayData && Array.isArray(dayData.reminders)) {
      const dayDate = new Date(key);
      dayData.reminders.forEach((rem, idx) => {
        if (rem.time && rem.time.includes(":")) {
          const [h, m] = rem.time.split(":").map(Number);
          const reminderDate = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), h, m);
          const diffMs = reminderDate - now;

          if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
            const hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
            const minutesLeft = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            let timeLabel = hoursLeft > 0 ? `${hoursLeft} saat kaldı` : `${minutesLeft} dakika kaldı`;

            personalReminders.push({
              id: `personal:${key}:${idx}`,
              type: "Hatırlatıcı",
              title: rem.note || "Etkinlik",
              body: `Saat ${rem.time}'da gerçekleşecek.`,
              timeRemaining: timeLabel,
              icon: "fa-clock"
            });
          }
        }
      });
    }
  });

  const corporateReminders = (state.events || [])
    .filter((event) => event.reminder)
    .map((event) => {
      const item = {
        id: `event:${event.id}`,
        type: "Etkinlik",
        title: event.title,
        body: event.venue || event.summary || "Hatırlatıcı kuruldu.",
        icon: "fa-calendar-check"
      };
      if (event.date) {
        const diffMs = new Date(event.date) - now;
        if (diffMs > 0 && diffMs < 72 * 60 * 60 * 1000) {
          const hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
          const minutesLeft = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          item.timeRemaining = hoursLeft > 0 ? `${hoursLeft} saat kaldı` : `${minutesLeft} dakika kaldı`;
        }
      }
      return item;
    });

  // High-interest article notifications (≥75%)
  const preferences = normalizePreferences(state.data.preferences);
  const sentNotifKey = "smartNewspaper_sentNotifIds";
  let sentIds = [];
  try { sentIds = JSON.parse(localStorage.getItem(sentNotifKey) || "[]"); } catch { }

  const highInterestNotifs = [];
  if (preferences.notifications && Array.isArray(state.data?.articles)) {
    const top = (state.data.articles)
      .filter((a) => clampScore(a.relevance || 0) >= 75 && !sentIds.includes(String(a.id)))
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .slice(0, 2);
    for (const a of top) {
      highInterestNotifs.push({
        id: `hi:${a.id}`,
        type: "Sana Özel",
        title: a.title,
        body: `%${clampScore(a.relevance || 0)} ilgi puanı · ${a.source || ""}`,
        icon: "fa-sparkles"
      });
    }
  }

  // Top trend notification
  const trendNotifs = [];
  if (preferences.notifications) {
    const trends = computeTrendGroups().slice(0, 1);
    for (const g of trends) {
      const id = `trend:${g.representative.id}`;
      if (!sentIds.includes(id)) {
        trendNotifs.push({
          id,
          type: "Trend",
          title: g.representative.title,
          body: `${g.articles.length} haber · ${g.sources.size} kaynak — ${trendReason(g)}`,
          icon: "fa-fire"
        });
      }
    }
  }

  const calNotifs = [];
  try {
    const calendarNotifications = getCalendarNotifications();
    for (const cn of calendarNotifications.filter(n => !n.read).slice(0, 3)) {
      calNotifs.push({
        id: `calremind:${cn.id}`,
        type: "Takvim Hatırlatıcı",
        title: cn.title,
        body: cn.message,
        icon: "fa-bell"
      });
    }
  } catch {}

  return [...calNotifs, ...personalReminders, ...corporateReminders, ...highInterestNotifs, ...trendNotifs].slice(0, 15);
}

function sendBrowserNotification(title, body, icon = "fa-bell") {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico", badge: "/favicon.ico" });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification(title, { body, icon: "/favicon.ico" });
    });
  }
}

const BROWSER_NOTIF_SENT_KEY = "smartNewspaper_browserNotifSent";
function getBrowserNotifSent() { try { return JSON.parse(localStorage.getItem(BROWSER_NOTIF_SENT_KEY) || "[]"); } catch { return []; } }
function setBrowserNotifSent(ids) { localStorage.setItem(BROWSER_NOTIF_SENT_KEY, JSON.stringify(ids.slice(-50))); }

function renderNotifications() {
  if (!notificationList) return;
  const preferences = normalizePreferences(state.data.preferences);
  const items = getNotificationItems();
  const readIds = getStoredReadNotifications();
  const unreadCount = preferences.notifications ? items.filter((item) => !readIds.includes(item.id)).length : 0;
  const dot = document.getElementById("notif-dot");
  if (dot) {
    dot.hidden = unreadCount === 0;
    dot.textContent = unreadCount > 9 ? "9+" : String(unreadCount || "");
  }

  if (preferences.notifications && "Notification" in window && Notification.permission === "default" && unreadCount > 0) {
    Notification.requestPermission();
  }

  if (preferences.notifications && unreadCount > 0) {
    const browserSent = getBrowserNotifSent();
    const newItems = items.filter((item) => !readIds.includes(item.id) && !browserSent.includes(item.id));
    if (newItems.length > 0 && document.hidden) {
      const top = newItems[0];
      sendBrowserNotification(`SmartNewspaper: ${top.type}`, top.title);
      setBrowserNotifSent([...browserSent, ...newItems.map((i) => i.id)]);
    }
  }

  if (!preferences.notifications) {
    notificationList.innerHTML = `<p class="notification-empty">Bildirimler profil tercihlerinde kapalı.</p>`;
    return;
  }
  if (!items.length) {
    notificationList.innerHTML = `<p class="notification-empty">Şimdilik yeni bildirim yok.</p>`;
    return;
  }
  notificationList.innerHTML = items.map((item) => {
    const unread = !readIds.includes(item.id);
    return `
      <button type="button" class="notification-item ${unread ? "is-unread" : ""}" data-notification-id="${escapeHtml(item.id)}">
        <i class="fa-solid ${escapeHtml(item.icon)}"></i>
        <span>
          <small>${escapeHtml(item.type)}${item.timeRemaining ? ` · <span class="notif-time-left">${escapeHtml(item.timeRemaining)}</span>` : ""}</small>
          <strong>${escapeHtml(item.title)}</strong>
          <em>${escapeHtml(item.body)}</em>
        </span>
      </button>
    `;
  }).join("");
}

function positionNotificationPopover() {
  if (!notificationPopover || !openNotificationsButton || notificationPopover.hidden) return;
  const buttonRect = openNotificationsButton.getBoundingClientRect();
  const margin = 16;
  const gap = 12;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const right = Math.max(margin, viewportWidth - buttonRect.right);
  const availableWidth = Math.max(0, viewportWidth - right - margin);
  const width = Math.min(420, availableWidth);
  const top = buttonRect.bottom + gap;
  const maxHeight = Math.max(180, Math.min(viewportHeight * 0.6, viewportHeight - top - margin));

  notificationPopover.style.top = `${top}px`;
  notificationPopover.style.right = `${right}px`;
  notificationPopover.style.width = `${width}px`;
  notificationPopover.style.maxHeight = `${maxHeight}px`;
}

function toggleNotifications(forceOpen) {
  if (!notificationPopover || !openNotificationsButton) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : notificationPopover.hidden;
  notificationPopover.hidden = !shouldOpen;
  openNotificationsButton.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    renderNotifications();
    positionNotificationPopover();
  }
}

// dateKey imported from ./utils/dateUtils.js

function calendarReadingLabel(slot) {
  if (!slot) return "";
  const labels = {
    morning: "Sabah okuma vakti",
    noon: "Öğle okuma vakti",
    evening: "Akşam okuma vakti",
    night: "Gece okuma vakti"
  };
  return labels[slot] || `${slot} okuma vakti`;
}

function updateCalendarAgenda(dayKey, reminderByDay) {
  if (!calendarAgenda) return;
  const personal = getCalendarPersonalization();
  const dayData = personal[dayKey] || {};
  if (calendarTimeInput) calendarTimeInput.value = "09:00";
  if (calendarNoteInput) calendarNoteInput.value = "";

  const events = reminderByDay.get(dayKey) || [];
  const combinedReminders = Array.isArray(dayData.reminders) ? dayData.reminders : [];

  const parts = [];

  // Show combined reminders (Time + Note)
  combinedReminders.sort((a, b) => a.time.localeCompare(b.time)).forEach((rem) => {
    parts.push(`
      <div class="calendar-agenda-item is-reading">
        <strong>${escapeHtml(rem.time)} ${escapeHtml(rem.note)}</strong>
        <span>Kişisel hatırlatıcı</span>
      </div>
    `);
  });

  for (const event of events) {
    parts.push(`
      <div class="calendar-agenda-item is-event">
        <strong>${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(event.displayDate)}${event.venue ? ` · ${escapeHtml(event.venue)}` : ""}</span>
      </div>
    `);
  }
  calendarAgenda.innerHTML = parts.join("") || `<p>Bu gün için etkinlik ya da kişisel hatırlatıcı yok.</p>`;
}

function renderEditionCalendar() {
  if (!editionCalendarGrid) return;
  const now = new Date();
  if (!selectedCalendarDay) selectedCalendarDay = dateKey(now);
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = dateKey(now);
  const personal = getCalendarPersonalization();
  const reminderEvents = (state.events || []).filter((event) => event.reminder);
  const reminderByDay = new Map();
  for (const event of reminderEvents) {
    const key = dateKey(new Date(event.date));
    reminderByDay.set(key, [...(reminderByDay.get(key) || []), event]);
  }
  if (calendarReminderCount) calendarReminderCount.textContent = String(reminderEvents.length);
  if (calendarMonthLabel) {
    calendarMonthLabel.textContent = now.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  }

  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(`<span class="calendar-day is-empty"></span>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const key = dateKey(date);
    const hasReminder = reminderByDay.has(key);
    const isToday = key === todayKey;
    const isSelected = key === selectedCalendarDay;
    const hasPersonal = Boolean(personal[key]?.reminders?.length);
    const isReadingDay = hasPersonal;
    cells.push(`
      <button type="button" class="calendar-day ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""} ${hasReminder ? "has-reminder" : ""} ${isReadingDay ? "has-reading" : ""}" data-calendar-day="${key}" aria-pressed="${isSelected}">
        <span>${day}</span>
      </button>
    `);
  }
  editionCalendarGrid.innerHTML = cells.join("");
  updateCalendarAgenda(selectedCalendarDay, reminderByDay);
}

/* ============================
   PERSONALIZED BANNER & STRIP
   ============================ */
function updateEditionStrip() {
  const preferences = normalizePreferences(state.data.preferences);
  const now = new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  const userName = state.authUser?.name || profileNameInput?.value || "Kullanıcı";

  const el = (id) => document.getElementById(id);
  if (el("edition-date-display")) el("edition-date-display").textContent = now;
  if (el("edition-interests-display")) el("edition-interests-display").textContent = preferences.interests.slice(0, 4).join(", ");
  if (el("edition-article-count")) el("edition-article-count").textContent = `${state.data.articles.length} haber`;
  if (el("sidebar-user-name")) el("sidebar-user-name").textContent = `${userName.split(" ")[0]} için`;
  if (el("sidebar-date-display")) el("sidebar-date-display").textContent = now;

  const sources = [...new Set(state.data.articles.map((a) => a.source).filter(Boolean))];
  if (el("sidebar-source-count")) el("sidebar-source-count").textContent = `${sources.length} kaynaktan derlendi`;
}

function renderPersonalizedBanner() {
  const banner = document.getElementById("personalized-banner");
  if (!banner) return;

  const preferences = normalizePreferences(state.data.preferences);
  const userName = state.authUser?.name || profileNameInput?.value || "Kullanıcı";
  const articleCount = state.data.articles.length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";

  const pbGreeting = document.getElementById("pb-greeting");
  const pbMessage = document.getElementById("pb-message");
  const pbStats = document.getElementById("pb-stats");

  if (pbGreeting) pbGreeting.textContent = `${greet}, ${userName.split(" ")[0]}`;
  if (pbMessage) pbMessage.textContent = `${preferences.interests.join(", ")} kategorilerinden ${articleCount} haber seçildi.`;

  if (pbStats) {
    const insights = getReadingInsights();
    pbStats.innerHTML = `
      <div class="pb-stat"><strong>${insights.readCount}</strong><span>Okunan</span></div>
      <div class="pb-stat"><strong>${insights.bookmarkCount}</strong><span>Kaydedilen</span></div>
      <div class="pb-stat"><strong>${insights.minutes} dk</strong><span>Okuma süresi</span></div>
    `;
  }
  banner.hidden = false;
}

/* ============================
   INTEREST CLOUD & CATEGORY NAV
   ============================ */
function renderInterestCloud() {
  const cloud = document.getElementById("interest-cloud-sidebar");
  if (!cloud) return;
  const preferences = normalizePreferences(state.data.preferences);

  let html = preferences.interests.map((interest) => `
    <div class="interest-tag-wrapper">
      <button class="interest-tag" data-cat-interest="${escapeHtml(interest)}"
              style="--cat-color: ${categoryColor(interest)}" title="${escapeHtml(interest)} haberlerini filtrele">
        ${escapeHtml(interest)}
      </button>
      <button class="remove-interest-btn" onclick="toggleInterest('${escapeHtml(interest)}')" title="Çıkar">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");

  html += `
    <button class="add-interest-btn" onclick="openAddInterestMenu()" title="Yeni İlgi Alanı Ekle">
      <i class="fa-solid fa-plus"></i> Ekle
    </button>
  `;

  cloud.innerHTML = html;
}

async function toggleInterest(interest) {
  const preferences = normalizePreferences(state.data.preferences);
  const exists = preferences.interests.includes(interest);

  if (exists) {
    preferences.interests = preferences.interests.filter(i => i !== interest);
  } else {
    preferences.interests.push(interest);
  }

  state.data.preferences = preferences;

  // Update UI immediately
  renderInterestCloud();
  renderArticles();
  renderPersonaChips();

  showToast(exists ? `${interest} çıkarıldı.` : `${interest} eklendi.`, "success");

  // Persist to API if logged in
  if (state.usingApi) {
    try {
      await api("/api/profile/preferences", { method: "PUT", body: JSON.stringify(preferences) });
    } catch (e) {
      console.error("Preferences sync failed", e);
    }
  }
}

function openAddInterestMenu() {
  const menu = document.getElementById("add-interest-menu");
  if (!menu) return;

  const allCategories = TOPIC_CATEGORIES;
  const currentInterests = normalizePreferences(state.data.preferences).interests;
  const available = allCategories.filter(cat => !currentInterests.includes(cat));

  if (available.length === 0) {
    showToast("Tüm kategoriler zaten ekli.", "info");
    return;
  }

  menu.innerHTML = `
    <div class="add-menu-header">
      <span>Kategori Ekle</span>
      <button onclick="document.getElementById('add-interest-menu').hidden = true"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="add-menu-list">
      ${available.map(cat => `
        <button class="add-menu-item" onclick="toggleInterest('${escapeHtml(cat)}'); document.getElementById('add-interest-menu').hidden = true;">
          <span class="dot" style="background: ${categoryColor(cat)}"></span>
          ${escapeHtml(cat)}
        </button>
      `).join("")}
    </div>
  `;

  menu.hidden = false;
}

function renderCategoryNav(articles) {
  const navList = document.getElementById("category-nav-list");
  if (!navList) return;

  const preferences = normalizePreferences(state.data.preferences);
  const interests = new Set(preferences.interests);
  const counts = {};
  for (const a of articles) { counts[a.category] = (counts[a.category] || 0) + 1; }

  const categories = [...new Set([
    ...TOPIC_CATEGORIES,
    ...preferences.interests.map(normalizeCategoryName),
    ...Object.keys(counts).map(normalizeCategoryName)
  ])].filter((category) => TOPIC_CATEGORIES.includes(category));

  const entries = categories.map((category) => [category, counts[category] || 0]).sort((a, b) => {
    const aScore = interests.has(a[0]) ? 1 : 0;
    const bScore = interests.has(b[0]) ? 1 : 0;
    return bScore - aScore || b[1] - a[1] || a[0].localeCompare(b[0], "tr-TR");
  });

  const allEntry = { category: "Tümü", count: articles.length, isAll: true };
  const rows = [allEntry, ...entries.map(([category, count]) => ({ category, count }))];

  navList.innerHTML = rows.map(({ category, count, isAll }) => {
    const rowValue = isAll ? "all" : categoryValue(category);
    const isActive = isAll
      ? categoryValue(categoryFilter.value) === "all"
      : categoryValue(categoryFilter.value) === rowValue;
    const color = isAll ? null : categoryColor(category);
    const isInterest = !isAll && interests.has(category);
    const starLabel = isInterest ? `${category} favorilerden çıkar` : `${category} favorilere ekle`;
    return `
      <div class="cat-nav-row${isActive ? " active" : ""}${isInterest ? " is-favorite" : ""}"
           ${color ? `style="--cat-color: ${color}"` : ""}>
        <button class="cat-nav-btn${isActive ? " active" : ""}"
                data-cat-filter="${escapeHtml(rowValue)}"
                type="button">
          <span class="cat-nav-active-line" aria-hidden="true"></span>
          <span class="cat-nav-dot" ${color ? `style="background:${color}"` : ""}></span>
          <span class="cat-nav-label">${escapeHtml(category)}</span>
          <span class="cat-nav-count">${count}</span>
        </button>
        ${isAll ? `<span class="cat-favorite-placeholder" aria-hidden="true"></span>` : `
          <button class="cat-favorite-btn${isInterest ? " active" : ""}"
                  type="button"
                  data-cat-star="${escapeHtml(category)}"
                  aria-label="${escapeHtml(starLabel)}"
                  title="${escapeHtml(starLabel)}">
            <i class="fa-${isInterest ? "solid" : "regular"} fa-star"></i>
          </button>
        `}
      </div>
    `;
  }).join("");
}

/* ============================
   READING GOAL
   ============================ */
function updateReadingGoalUI(insights) {
  const data = insights || getReadingInsights();
  const fill = document.getElementById("rg-fill");
  const fraction = document.getElementById("rg-fraction");
  const label = document.getElementById("rg-label");
  const editionFill = document.getElementById("edition-goal-fill");
  const editionLabel = document.getElementById("edition-goal-label");

  if (fill) fill.style.width = `${data.progress}%`;
  if (fraction) fraction.textContent = `${data.readCount}/${data.goal}`;
  if (editionFill) editionFill.style.width = `${data.progress}%`;
  if (editionLabel) editionLabel.textContent = `${data.readCount}/${data.goal}`;

  if (label) {
    if (data.progress >= 100) label.textContent = "Günlük hedefe ulaştın! 🎉";
    else if (data.progress >= 50) label.textContent = `${data.goal - data.readCount} haber daha okuyunca hedef tamam`;
    else if (data.readCount > 0) label.textContent = `${data.readCount} haber okundu`;
    else label.textContent = "Henüz okuma yapılmadı";
  }

  const notifDot = document.getElementById("notif-dot");
  renderNotifications();
}

/* ============================
   HERO SLIDER (replaces featured-article + live-news)
   ============================ */
function _getHeroSlider() {
  if (heroSlider) return heroSlider;
  const stage = document.getElementById("hs-stage");
  if (!stage) return null;
  heroSlider = new HeroSlider({
    stage,
    dots: document.getElementById("hs-dots"),
    counter: document.getElementById("hs-counter"),
    prev: document.getElementById("hs-prev"),
    next: document.getElementById("hs-next"),
    progressFill: document.getElementById("hs-progress-fill"),
    onAction: (action, id) => handleArticleAction(action, findArticleForAction(id))
  });
  return heroSlider;
}

/* ============================
   ARTICLE CARD HTML
   ============================ */
function articleCategoryIcon(category = "") {
  const normalized = normalizeCategoryName(category);
  const icons = {
    "Gündem": "fa-newspaper",
    "Ekonomi": "fa-chart-line",
    "Teknoloji": "fa-microchip",
    "Yapay Zeka": "fa-robot",
    "Bilim": "fa-atom",
    "Dünya": "fa-globe",
    "Spor": "fa-trophy",
    "Sağlık": "fa-heart-pulse",
    "Kültür-Sanat": "fa-palette",
    "Eğitim": "fa-graduation-cap",
    "Finans": "fa-coins"
  };
  return icons[normalized] || "fa-feather-pointed";
}

function renderArticleVisualHtml(article, category, color) {
  const imageSrc = article.imageUrl || article.image || article.urlToImage || "";
  if (imageSrc) {
    return `<img class="article-thumb" src="${escapeHtml(imageSrc)}" alt="" loading="lazy" decoding="async">`;
  }
  return `
    <div class="article-thumb article-thumb-placeholder" style="--cat-color:${color}" aria-hidden="true">
      <i class="fa-solid ${articleCategoryIcon(category)}"></i>
      <span>${escapeHtml(category)}</span>
    </div>
  `;
}

function buildRecommendationReasonText(article) {
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const score = articleInterestScore(article);
  const base = buildInterestReason(article);
  const parts = [
    `${category} kategorisine ilgin`,
    `${subcategory} konusundaki benzer haber etkileşimlerin`,
    `ilgi puanının %${score} seviyesinde olması`
  ];
  if (article.bookmarked) parts.push("bu haberi kaydetmiş olman");
  if (article.status === "Okundu") parts.push("okuma geçmişinde benzer sinyaller bulunması");
  return `${base} Bu haber; ${parts.slice(0, 4).join(", ")} nedeniyle öne çıkarıldı.`;
}

function recommendationFactorHtml(article) {
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const score = articleInterestScore(article);
  const factors = [
    { icon: "fa-bullseye", label: "Kategori uyumu", value: category },
    { icon: "fa-layer-group", label: "Alt kategori", value: subcategory },
    { icon: "fa-chart-simple", label: "İlgi puanı", value: `%${score}` },
    { icon: article.status === "Okundu" ? "fa-check" : "fa-eye", label: "Okuma durumu", value: article.status || "Okunmadı" }
  ];
  return factors.map((factor) => `
    <span class="recommendation-factor">
      <i class="fa-solid ${factor.icon}" aria-hidden="true"></i>
      <strong>${escapeHtml(factor.label)}</strong>
      <em>${escapeHtml(factor.value)}</em>
    </span>
  `).join("");
}

function renderArticleCardHtml(article) {
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const color = categoryColor(category);
  const score = articleInterestScore(article);
  const sourceUrl = article.sourceUrl || article.url || "";
  
  // Use localized title and summary based on UI language
  const localTitle = getLocalizedText(article, "title", article.title || "Başlıksız haber");
  const localSummary = getLocalizedText(article, "summary", article.summary || article.description || "");
  const noTextLabel = state.uiLanguage === "en" ? "Text unavailable." : "Metin bulunamadı.";

  const hasSourceSentences = article.sourceSentences && article.sourceSentences.length > 0;
  const fallbackText = article.originalExcerpt
    || article.contentSnippet
    || article.description
    || localSummary
    || noTextLabel;

  const relatedSources = article.relatedSources || getSimilarArticles(article) || [];
  const relatedCount = relatedSources.length;

  const cardSourceName = article.sourceName || article.source || "Kaynak yok";
  const cardReadTime = article.readTime || "3 dk";
  const cardDateLabel = article.date || (article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })
    : "");
  const relatedPreview = relatedSources.slice(0, 5);
  const sourceDotsHtml = relatedPreview.length ? `
    <div class="news-card-source-stack" aria-label="Benzer kaynaklar">
      ${relatedPreview.map((rs) => {
        const rsUrl = rs.url || rs.sourceUrl || "";
        const rsName = rs.sourceName || rs.source || "Kaynak";
        return `<span class="news-card-source-dot" title="${escapeHtml(rsName)}">${renderSourceLogoHtml(rs, rsUrl, rsName, 22)}</span>`;
      }).join("")}
      ${relatedCount > relatedPreview.length ? `<span class="news-card-source-more">+${relatedCount - relatedPreview.length}</span>` : ""}
    </div>
  ` : "";
  const visualHtml = article.imageUrl ? `
    <img class="news-card-image article-thumb" src="${escapeHtml(article.imageUrl)}" alt="" loading="lazy" decoding="async"
      onerror="this.hidden=true;this.closest('.news-card-image-wrap')?.classList.add('is-missing-image');">
    <div class="news-card-placeholder" style="--cat-color:${color}" aria-hidden="true">
      <i class="fa-solid ${articleCategoryIcon(category)}"></i>
    </div>
  ` : `
    <div class="news-card-placeholder article-thumb article-thumb-placeholder" style="--cat-color:${color}" aria-hidden="true">
      <i class="fa-solid ${articleCategoryIcon(category)}"></i>
      <span>Görsel yok</span>
    </div>
  `;

  return `
    <article class="article-card personal-news-card news-card" style="--cat-color:${color}" data-drag-article-id="${escapeHtml(String(article.id))}" draggable="true">
      <div class="news-card-image-wrap">
        ${visualHtml}
      </div>

      <div class="news-card-body personal-card-body">
        <div class="news-card-meta-row card-topline personal-card-topline">
          <span class="news-chip news-chip-category">${escapeHtml(category)}</span>
          <span class="news-chip news-chip-source">${escapeHtml(cardSourceName)}</span>
          ${score >= 70 ? `<span class="news-chip news-chip-hot"><i class="fa-solid fa-fire" aria-hidden="true"></i> Trend</span>` : ""}
        </div>

        <h4 class="news-card-title">
          <button type="button" class="title-link card-title" data-action="detail" data-id="${escapeHtml(String(article.id))}">${escapeHtml(localTitle)}</button>
        </h4>

        <div class="card-summary-wrap">
          ${hasSourceSentences ? `
            <div class="news-card-source-sentences">
              ${article.sourceSentences.slice(0, 2).map(s => `<p class="news-card-source-quote">"${escapeHtml(trimSummary(s, 160))}"</p>`).join("")}
            </div>
          ` : `
            <p class="news-card-summary card-summary">${escapeHtml(trimSummary(fallbackText, 200))}</p>
          `}
          ${article.aiSummary ? `
            <div class="news-card-ai-badge">
              <i class="fa-solid fa-sparkles" aria-hidden="true"></i>
              <span>${escapeHtml(trimSummary(article.aiSummary, 120))}</span>
            </div>
          ` : ""}
        </div>

        <div class="news-card-footer source-line compact-source personal-source-line">
          <div class="news-card-footer-main">
            <span class="news-card-primary-source">${renderSourceLogoHtml(article, sourceUrl, cardSourceName, 22)}</span>
            ${sourceDotsHtml}
          </div>
          <div class="news-card-footer-meta">
            ${cardDateLabel ? `<span>${escapeHtml(cardDateLabel)}</span>` : ""}
            <span>${escapeHtml(cardReadTime)}</span>
          </div>
          <div class="news-card-actions card-actions personal-card-actions">
            <button type="button" data-action="bookmark" data-id="${escapeHtml(String(article.id))}" title="Kaydet" aria-label="Haberi kaydet">
              <i class="${article.bookmarked ? "fa-solid" : "fa-regular"} fa-bookmark" aria-hidden="true"></i>
            </button>
            <button type="button" data-action="detail" data-id="${escapeHtml(String(article.id))}" title="Oku" aria-label="Haberi oku">
              <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </article>
  `;
}
/* ============================
   HIGH INTEREST SUMMARY PANEL
   ============================ */
function articleInterestScore(article) {
  return clampScore(Number(article?.interestScore ?? article?.relevance ?? 0));
}

function highInterestSignature() {
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  return articles.map((article) => [
    article.id || article.title || "article",
    articleInterestScore(article),
    article.status || "",
    article.bookmarked ? 1 : 0,
    article.publishedAt || article.date || ""
  ].join(":")).join("|");
}

function getHighInterestArticles() {
  const signature = highInterestSignature();
  if (state.highInterestMemo.signature === signature) {
    return state.highInterestMemo.articles;
  }

  const articles = (Array.isArray(state.data?.articles) ? state.data.articles : [])
    .filter((article) => articleInterestScore(article) >= 75)
    .sort((a, b) => {
      const scoreDelta = articleInterestScore(b) - articleInterestScore(a);
      if (scoreDelta) return scoreDelta;
      return new Date(b.publishedAt || b.date || 0) - new Date(a.publishedAt || a.date || 0);
    });

  state.highInterestMemo = { signature, articles };
  return articles;
}


function articleTitleFingerprint(article) {
  return normalizeText(article?.title || "")
    .replace(/[^a-z0-9ğüşöçıİ\s]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 8)
    .join(" ") || String(article?.id || "article");
}

function isBreakingArticle(article) {
  const text = normalizeText(`${article?.title || ""} ${Array.isArray(article?.tags) ? article.tags.join(" ") : ""}`);
  return Boolean(article?.breaking) || ["son dakika", "breaking", "acil", "flash", "flaş"].some((word) => text.includes(normalizeText(word)));
}

function isCriticalArticle(article) {
  const text = normalizeText(`${article?.title || ""} ${Array.isArray(article?.tags) ? article.tags.join(" ") : ""}`);
  return Boolean(article?.critical || article?.urgent) || ["kritik", "urgent", "alarm", "uyarı", "uyari", "önemli", "onemli"].some((word) => text.includes(normalizeText(word)));
}

function articleAgeHours(article) {
  const published = new Date(article?.publishedAt || article?.date || 0).getTime();
  if (!Number.isFinite(published) || !published) return Infinity;
  return (Date.now() - published) / 36e5;
}

function readingDepthMatches(article, preferences) {
  const depth = preferences?.contentDepth || "mixed";
  if (depth === "mixed") return false;
  const textLength = String(article?.summary || article?.description || article?.fullText || "").length;
  const readMinutes = Number(String(article?.readTime || "").match(/\d+/)?.[0] || 0);
  if (depth === "short") return (readMinutes && readMinutes <= 3) || textLength <= 520;
  if (depth === "detailed") return (readMinutes && readMinutes >= 4) || textLength >= 800;
  return false;
}

function personalizedCarouselScore(article, preferences = normalizePreferences(state.data.preferences), seenTitles = new Set()) {
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const interest = articleInterestScore(article);
  const trendScore = Number(article.trendScore || article.popularity || article.importance || 0);
  const fingerprint = articleTitleFingerprint(article);
  const ageHours = articleAgeHours(article);

  let score = interest;
  const reasons = [];

  if (interest >= 90) { score += 100; reasons.push("çok yüksek ilgi puanı"); }
  else if (interest >= 75) { score += 70; reasons.push("%75 üzeri ilgi puanı"); }

  if ((preferences.interests || []).includes(category)) {
    score += 40;
    reasons.push(`${category} ilgi alanınla eşleşiyor`);
  }

  if (readingDepthMatches(article, preferences)) {
    score += 8;
    reasons.push("okuma tarzına uygun");
  }

  if (isBreakingArticle(article)) { score += 35; reasons.push("son dakika gelişmesi"); }
  if (isCriticalArticle(article)) { score += 30; reasons.push("kritik gelişme"); }

  if (ageHours <= 2) { score += 25; reasons.push("çok yeni yayınlandı"); }
  else if (ageHours <= 24) { score += 15; reasons.push("son 24 saatte yayınlandı"); }

  if (trendScore >= 70) { score += 20; reasons.push("yüksek trend skoru"); }
  else if (trendScore >= 40) { score += 10; reasons.push("trend sinyali güçlü"); }

  if (article.status !== "Okundu") score += 10;

  if (seenTitles.has(fingerprint)) score -= 20;

  return { score, reasons, category, subcategory, fingerprint };
}

function generatePersonalRecommendationReason(article, preferences, details) {
  const reasonList = Array.isArray(details?.reasons) ? details.reasons : [];
  const selected = reasonList
    .filter(Boolean)
    .filter((reason, index, arr) => arr.indexOf(reason) === index)
    .slice(0, 3);

  if (selected.length) {
    return `Bu haber ${selected.join(", ")} nedeniyle önerildi.`;
  }

  const category = details?.category || inferArticleCategory(article);
  if ((preferences.interests || []).includes(category)) {
    return `Bu haber ${category} ilgi alanına uyduğu için önerildi.`;
  }

  return "Bu haber güncellik, kategori uyumu ve genel ilgi sinyallerine göre önerildi.";
}

function rankPersonalizedArticles(articles = [], { fallback = false } = {}) {
  const preferences = normalizePreferences(state.data.preferences);
  const seenTitles = new Set();
  const ranked = articles
    .filter((article) => article && article.title)
    .map((article) => {
      const details = personalizedCarouselScore(article, preferences, seenTitles);
      seenTitles.add(details.fingerprint);
      article.category = details.category;
      article.subcategory = details.subcategory;
      article._personalizedScore = Math.round(details.score);
      article._personalizedReason = generatePersonalRecommendationReason(article, preferences, details);
      article._catColor = categoryColor(details.category);
      article._isPersonalFallback = fallback;
      return { article, score: details.score, fingerprint: details.fingerprint };
    })
    .sort((a, b) => {
      const delta = b.score - a.score;
      if (delta) return delta;
      return new Date(b.article.publishedAt || b.article.date || 0) - new Date(a.article.publishedAt || a.article.date || 0);
    });

  const used = new Set();
  const unique = [];
  for (const item of ranked) {
    if (used.has(item.fingerprint)) continue;
    used.add(item.fingerprint);
    unique.push(item.article);
  }
  return unique;
}

function personalizedPageSignature() {
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const pref = normalizePreferences(state.data.preferences);
  return [
    highInterestSignature(),
    pref.interests.join(","),
    pref.contentDepth,
    pref.readingTimes.join(","),
    articles.length
  ].join("|");
}

function getPersonalizedPageArticles() {
  const signature = personalizedPageSignature();
  if (state.personalizedCarouselMemo.signature === signature) {
    return state.personalizedCarouselMemo;
  }

  const highInterest = getHighInterestArticles();
  const sourceArticles = highInterest.length
    ? highInterest
    : (Array.isArray(state.data?.articles) ? state.data.articles : []);
  const fallback = highInterest.length === 0;
  const articles = rankPersonalizedArticles(sourceArticles, { fallback }).slice(0, fallback ? 16 : 24);
  state.personalizedCarouselMemo = { signature, articles, fallback };
  return state.personalizedCarouselMemo;
}

function _getPersonalizedCarousel() {
  if (personalizedCarousel) return personalizedCarousel;
  const stage = document.getElementById("pc-stage");
  if (!stage) return null;
  personalizedCarousel = new PersonalizedCarousel({
    stage,
    dots: document.getElementById("pc-dots"),
    counter: document.getElementById("pc-counter"),
    prev: document.getElementById("pc-prev"),
    next: document.getElementById("pc-next"),
    progressFill: document.getElementById("pc-progress-fill"),
    onAction: (action, id) => handleArticleAction(action, findArticleForAction(id))
  });
  return personalizedCarousel;
}

function getPersonalNewspaperArticles() {
  const allArticles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  personalizeArticleScores(allArticles);

  // Ana akışta büyük manşet göstermiyoruz; kullanıcı E-Gazete'yi açınca
  // aynı güvenli manşet seçimi gazetenin kapak sayfasında ilk haber olarak görünür.
  const eGazeteHeadline = selectTodayHeadlineArticle(allArticles);
  const personalized = getPersonalizedPageArticles().articles || [];
  const bookmarked = allArticles.filter((article) => article.bookmarked);
  const ids = new Set();
  const merged = [eGazeteHeadline, ...bookmarked, ...personalized, ...rankPersonalizedArticles(allArticles, { fallback: true })]
    .filter((article) => {
      const id = String(article?.id || article?.title || Math.random());
      if (!article || ids.has(id)) return false;
      ids.add(id);
      return true;
    });
  return merged.slice(0, 18);
}

function getEGazeteProfile() {
  const preferences = normalizePreferences(state.data.preferences);
  const name = profileNameInput?.value?.trim() || state.authUser?.name || "Okuyucu";
  return {
    name,
    paperName: "Smart Newspaper",
    interests: preferences.interests,
    contentDepth: preferences.contentDepth,
    readingTimes: preferences.readingTimes
  };
}

function _getEGazeteMode() {
  if (eGazeteMode) return eGazeteMode;
  eGazeteMode = new EGazeteMode({
    getArticles: getPersonalNewspaperArticles,
    getProfile: getEGazeteProfile,
    getSimilarArticles: (article) => getSimilarArticles(article),
    onArticleAction: (action, id) => {
      const article = findArticleForAction(id);
      if (article) handleArticleAction(action, article);
    }
  });
  return eGazeteMode;
}


function openEGazeteMode() {
  _getEGazeteMode()?.open();
}

function renderEGazeteDashboard() {
  const container = document.getElementById("egazete-dashboard-content");
  if (!container) return;
  const mode = _getEGazeteMode();
  if (mode && typeof mode.renderDashboard === "function") {
    mode.renderDashboard(container);
  } else {
    const articles = getPersonalNewspaperArticles();
    const profile = getEGazeteProfile();
    const name = profile.name || "Okuyucu";
    const totalArticles = articles.length;
    const totalPages = Math.max(1, Math.ceil(totalArticles / 2) + 2);
    const readTime = Math.max(5, totalArticles * 2);
    const weatherData = _getWeatherData();
    const weatherHtml = weatherData ? `
      <div class="egd-weather-mini">
        <i class="fa-solid ${weatherData.icon}"></i>
        <span>${escapeHtml(weatherData.city)} · ${weatherData.temp}°C · ${escapeHtml(weatherData.label)}</span>
      </div>` : "";
    const categories = [...new Set(articles.map(a => inferArticleCategory(a)).filter(Boolean))].slice(0, 6);
    const mainArticle = articles[0];
    const aiPicks = articles.filter(a => articleInterestScore(a) >= 75).slice(0, 4);
    const multiSourceArticles = articles.filter(a => getSimilarArticles(a).length >= 2).slice(0, 3);

    container.innerHTML = `
      <div class="egd-dashboard">
        <div class="egd-hero">
          <div class="egd-hero-left">
            <div class="egd-cover-label">AI Destekli Kişisel Baskı</div>
            <h1 class="egd-cover-title">${escapeHtml(profile.paperName || "Kişisel E-Gazete")}</h1>
            <div class="egd-cover-meta">
              <span>${escapeHtml(new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()))}</span>
              <span>Sayın ${escapeHtml(name)} için hazırlandı</span>
            </div>
            ${weatherHtml}
          </div>
          <div class="egd-hero-right">
            <div class="egd-stat"><strong>${totalArticles}</strong><span>Haber</span></div>
            <div class="egd-stat"><strong>${totalPages}</strong><span>Sayfa</span></div>
            <div class="egd-stat"><strong>~${readTime} dk</strong><span>Okuma</span></div>
          </div>
        </div>
        <div class="egd-actions-row">
          <button type="button" class="egd-primary-btn" id="egd-open-reader"><i class="fa-solid fa-book-open"></i> Gazeteyi Oku</button>
          <button type="button" class="egd-secondary-btn" id="egd-download-pdf"><i class="fa-solid fa-download"></i> PDF İndir</button>
        </div>
        <div class="egd-categories">
          ${categories.map(c => `<span class="egd-cat-chip" style="--cat-color:${categoryColor(c)}">${escapeHtml(c)}</span>`).join("")}
        </div>
        ${mainArticle ? `
        <div class="egd-headline-card">
          <div class="egd-headline-kicker">Bugünün Manşeti</div>
          <h2 class="egd-headline-title">${escapeHtml(mainArticle.title)}</h2>
          <p class="egd-headline-summary">${escapeHtml(trimSummary(mainArticle.summary || mainArticle.description || "", 200))}</p>
          <div class="egd-headline-meta">
            <span>${escapeHtml(mainArticle.source || "")}</span>
            <span>${escapeHtml(mainArticle.category || "Gündem")}</span>
          </div>
        </div>` : ""}
        ${aiPicks.length ? `
        <div class="egd-section">
          <h3 class="egd-section-title"><i class="fa-solid fa-sparkles"></i> AI Seçkisi</h3>
          <div class="egd-picks-grid">
            ${aiPicks.map(a => `
              <div class="egd-pick-card" data-action="detail" data-id="${escapeHtml(String(a.id))}">
                <span class="egd-pick-cat" style="--cat-color:${categoryColor(inferArticleCategory(a))}">${escapeHtml(inferArticleCategory(a))}</span>
                <h4>${escapeHtml(a.title)}</h4>
                <span class="egd-pick-source">${escapeHtml(a.source || "")}</span>
              </div>
            `).join("")}
          </div>
        </div>` : ""}
        ${multiSourceArticles.length ? `
        <div class="egd-section">
          <h3 class="egd-section-title"><i class="fa-solid fa-layer-group"></i> Çok Kaynakta Doğrulanan</h3>
          <div class="egd-verified-list">
            ${multiSourceArticles.map(a => {
              const sims = getSimilarArticles(a);
              return `<div class="egd-verified-item" data-action="detail" data-id="${escapeHtml(String(a.id))}">
                <strong>${escapeHtml(a.title)}</strong>
                <span>${sims.length + 1} kaynakta geçti</span>
              </div>`;
            }).join("")}
          </div>
        </div>` : ""}
      </div>
    `;
    container.querySelector("#egd-open-reader")?.addEventListener("click", () => openEGazeteMode());
    container.querySelector("#egd-download-pdf")?.addEventListener("click", () => {
      openEGazeteMode();
      setTimeout(() => _getEGazeteMode()?.printPdf(), 500);
    });
    container.querySelectorAll("[data-action='detail']").forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => showDetail(el.dataset.id));
    });
  }
}

function _getWeatherData() {
  try {
    const raw = localStorage.getItem("smart_newspaper_weather");
    if (!raw) return null;
    const d = JSON.parse(raw);
    const ICONS = { Clear: "fa-sun", Clouds: "fa-cloud", Rain: "fa-cloud-rain", Snow: "fa-snowflake", Thunderstorm: "fa-cloud-bolt", Mist: "fa-smog", Fog: "fa-smog", Haze: "fa-smog" };
    const LABELS = { Clear: "Güneşli", Clouds: "Bulutlu", Rain: "Yağmurlu", Snow: "Karlı", Thunderstorm: "Fırtınalı", Mist: "Sisli", Fog: "Sisli", Haze: "Puslu" };
    return { city: d.city || "İstanbul", temp: d.temp || 0, icon: ICONS[d.main] || "fa-cloud-sun", label: LABELS[d.main] || d.main || "Bilinmiyor" };
  } catch { return null; }
}

let _weatherWidget = null;
function initWeatherWidget() {
  if (_weatherWidget) return;
  _weatherWidget = new WeatherWidget("np-brief-weather");
  _weatherWidget.init();
}

function renderPersonalBriefHeader() {
  const greeting = document.getElementById("np-brief-greeting");
  const summary = document.getElementById("np-brief-summary");
  const chips = document.getElementById("np-brief-chips");
  if (!greeting) return;

  const profile = getEGazeteProfile();
  const name = profile.name || "Okuyucu";
  const hour = new Date().getHours();
  const greetEmoji = hour < 12 ? "\u2600\ufe0f" : hour < 18 ? "\ud83c\udf24\ufe0f" : "\ud83c\udf19";
  const greetText = hour < 12 ? "Günaydın" : hour < 18 ? "İyi Günler" : "İyi Akşamlar";
  greeting.innerHTML = `${greetEmoji} ${escapeHtml(greetText)}, <strong>${escapeHtml(name)}</strong>! \ud83d\udc4b`;

  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const highInterest = articles.filter(a => articleInterestScore(a) >= 75).length;
  const multiSourceCount = articles.filter(a => getSimilarArticles(a).length >= 2).length;
  const personalCount = articles.filter(a => articleInterestScore(a) >= 60).length;

  let summaryText = `Bugün senin için ${articles.length} önemli haber seçildi.`;
  if (personalCount > 0) summaryText += ` İlgi alanlarına göre analiz edildi`;
  if (multiSourceCount > 0) summaryText += ` ve ${multiSourceCount} kaynakta ayrı haber doğrulandı`;
  summaryText += ".";
  if (summary) summary.textContent = summaryText;

  if (chips) {
    const avgReadTime = articles.length > 0
      ? Math.max(3, Math.round(articles.slice(0, 10).reduce((sum, a) => {
          const rt = parseInt(String(a.readTime || "").match(/\d+/)?.[0] || "3", 10);
          return sum + rt;
        }, 0) / Math.min(10, articles.length)))
      : 5;

    chips.innerHTML = [
      personalCount > 0 ? `<span class="np-brief-chip chip-articles"><i class="fa-solid fa-newspaper"></i> ${personalCount} Sana özel haber</span>` : "",
      multiSourceCount > 0 ? `<span class="np-brief-chip chip-sources"><i class="fa-solid fa-check-double"></i> ${multiSourceCount} Kaynakta doğrulandı</span>` : "",
      `<span class="np-brief-chip chip-readtime"><i class="fa-regular fa-clock"></i> ${avgReadTime} dk Okuma süresi</span>`,
      highInterest > 0 ? `<span class="np-brief-chip chip-interest"><i class="fa-solid fa-star"></i> ${highInterest} Yüksek ilgi</span>` : "",
      `<button class="np-brief-why-link" type="button" data-interest-info aria-haspopup="dialog" aria-controls="interest-info-modal"><i class="fa-solid fa-circle-info"></i> Neden bu haberler? Kişiselleştirme ayarları</button>`
    ].filter(Boolean).join("");
  }

  initWeatherWidget();
}

function buildInterestReason(article) {
  const preferences = normalizePreferences(state.data.preferences);
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const userInterest = normalizeUserInterest(preferences.userInterest || {}, preferences.interests || []);

  const reasons = [];

  if (preferences.interests.includes(category)) {
    reasons.push(`${category} ilgi alanlarında`);
  }

  const subScore = userInterest.subcategories?.[subcategory] ?? 0;
  if (subScore > 70) {
    reasons.push(`${subcategory} konusunda yüksek ilgin var`);
  }

  const inTrend = computeTrendGroups().some((g) => g.articles.some((a) => String(a.id) === String(article.id)));
  if (inTrend) {
    reasons.push("gündemde trend");
  }

  if (getRecencyScore(article) > 70) {
    reasons.push("son 24 saatte yayınlandı");
  }

  if (reasons.length === 0) {
    return "Genel gündem ve kategori uyumuna göre önerildi.";
  }
  return `Bu haber ${reasons.slice(0, 2).join(" ve ")} için önerildi.`;
}

function highInterestSummary(article) {
  const raw = decodeHtmlEntities(article?.aiSummary || article?.summary || article?.description || article?.fullText || article?.content || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "Bu haber için kısa özet bulunamadı.";

  const sentences = raw.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [raw];
  let summary = sentences.slice(0, 4).join(" ").replace(/\s+/g, " ").trim();

  if (summary.length > 620) {
    summary = summary.slice(0, 620).replace(/\s+\S*$/, "") + "…";
  }

  return summary || "Bu haber için kısa özet bulunamadı.";
}

function renderHighInterestCard(article) {
  const score = articleInterestScore(article);
  const category = inferArticleCategory(article);
  const subcategory = inferArticleSubcategory({ ...article, category });
  const color = categoryColor(category);
  const dateLabel = article.date || (article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })
    : "Tarih yok");
  const sourceUrl = article.sourceUrl || article.url || "";
  const similarCount = getSimilarArticles(article).length;

  return `
    <article class="high-interest-card" style="--cat-color:${color}">
      <div class="high-interest-card-top">
        <div>
          <div class="high-interest-meta">
            <span>${escapeHtml(article.source || "Kaynak yok")}</span>
            <span>${escapeHtml(dateLabel)}</span>
          </div>
          <h4>${escapeHtml(article.title || "Başlıksız haber")}</h4>
        </div>
        <span class="high-interest-score">%${score} ${interestInfoButtonHtml("on-dark")}</span>
      </div>
      <div class="high-interest-tags">
        <span class="tag">${escapeHtml(category)}</span>
        <span class="tag subcategory-tag">${escapeHtml(subcategory)}</span>
      </div>
      <p class="interest-reason">${escapeHtml(article._personalizedReason || buildInterestReason(article))}</p>
      <p>${escapeHtml(highInterestSummary(article))}</p>
      <div class="high-interest-actions">
        <button type="button" data-action="detail" data-id="${escapeHtml(String(article.id))}">Detay</button>
        <button type="button" data-action="bookmark" data-id="${escapeHtml(String(article.id))}">
          <i class="${article.bookmarked ? "fa-solid" : "fa-regular"} fa-bookmark" aria-hidden="true"></i> ${article.bookmarked ? "Kaydedildi" : "Kaydet"}
        </button>
        ${similarCount > 0 ? `<button type="button" data-action="similar" data-id="${escapeHtml(String(article.id))}"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> Benzer</button>` : ""}
        ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Kaynağa Git</a>` : ""}
      </div>
    </article>
  `;
}

function renderHighInterestPanel() {
  if (!highInterestSection || !highInterestList) return;

  highInterestSection.classList.toggle("is-open", state.highInterestPanelOpen);
  highInterestOpenButton?.classList.toggle("active", state.highInterestPanelOpen);
  highInterestOpenButton?.setAttribute("aria-expanded", String(state.highInterestPanelOpen));

  if (!state.highInterestPanelOpen) return;

  personalizeArticleScores(state.data.articles);
  const articles = getHighInterestArticles();
  if (highInterestCount) highInterestCount.textContent = `${articles.length} haber`;

  highInterestList.innerHTML = articles.length
    ? articles.map(renderHighInterestCard).join("")
    : `<p class="empty-state high-interest-empty">Henüz %75 üzerinde ilgi puanına sahip haber bulunamadı. Haber okudukça ve ilgi alanların netleştikçe bu alan kişiselleşecek.</p>`;
}

function renderHighInterestPage() {
  const container = document.getElementById("hi-page-list");
  if (!container) return;
  personalizeArticleScores(state.data.articles);

  const pageData = getPersonalizedPageArticles();
  const articles = pageData.articles;
  const carouselArticles = articles.slice(0, 12);
  const carouselIds = new Set(carouselArticles.map((article) => String(article.id)));
  const remainingArticles = articles.filter((article) => !carouselIds.has(String(article.id)));
  const countEl = document.getElementById("hi-page-count");
  const carousel = _getPersonalizedCarousel();

  if (countEl) countEl.textContent = `${articles.length} haber`;
  if (hiPageIntro) {
    hiPageIntro.textContent = pageData.fallback
      ? "Henüz %75 üzerinde güçlü eşleşme yok; sana en yakın haberleri ilgi alanı, güncellik ve trend sinyallerine göre sıraladık."
      : "Bunlar ilgi puanın %75 ve üzerinde olan haberler. Üstteki kişisel gazete kartlarını sürükleyebilir, her kartın neden önerildiğini görebilirsin.";
  }

  carousel?.refresh(carouselArticles);

  if (hiPageListBlock) {
    hiPageListBlock.hidden = remainingArticles.length === 0;
  }
  container.innerHTML = remainingArticles.length
    ? remainingArticles.map(renderHighInterestCard).join("")
    : "";
}

/* ============================
   PERSONA CHIPS & READING TIME
   ============================ */
function renderPersonaChips() {
  const container = document.getElementById("persona-chips");
  if (!container) return;
  const preferences = normalizePreferences(state.data.preferences);
  const currentSlot = currentTimeSlot();
  const chips = [];

  for (const slot of preferences.readingTimes) {
    const info = READING_TIME_LABELS[slot];
    if (!info) continue;
    const isActive = slot === currentSlot;
    chips.push(`
      <div class="persona-chip-wrapper">
        <span class="persona-chip ${isActive ? "is-active" : ""}" title="${isActive ? "Şu an senin okuma vaktin" : ""}">
          <i class="fa-solid ${info.icon}"></i> ${info.label}
        </span>
      </div>
    `);
  }

  const depth = CONTENT_DEPTH_LABELS[preferences.contentDepth];
  if (depth) {
    chips.push(`
      <div class="persona-chip-wrapper">
        <span class="persona-chip">
          <i class="fa-solid ${depth.icon}"></i> ${depth.label}
        </span>
      </div>
    `);
  }

  container.innerHTML = chips.join("");
}

function applyReadingTimeBanner() {
  const banner = document.getElementById("reading-time-banner");
  const text = document.getElementById("reading-time-banner-text");
  if (!banner || !text) return;
  const preferences = normalizePreferences(state.data.preferences);
  const slot = currentTimeSlot();
  if (!slot || !preferences.readingTimes.includes(slot)) {
    banner.hidden = true;
    return;
  }
  const label = READING_TIME_LABELS[slot]?.label || "";
  text.textContent = `${label} olarak işaretlemişsin — şu an tam senin okuma vaktin.`;
  banner.hidden = false;
}

/* ============================
   EVENTS
   ============================ */
function toUiEvent(event) {
  return {
    id: event.id,
    title: event.title,
    category: event.category || event.type || "Duyuru",
    summary: event.summary || event.body || "",
    description: event.description || event.body || event.summary || "",
    date: event.date,
    displayDate: event.date
      ? new Date(event.date).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
      : event.date || "",
    venue: event.venue || "",
    city: event.city || "",
    imageUrl: event.imageUrl || "",
    ticketUrl: event.ticketUrl || "",
    sourceProvider: event.sourceProvider || "",
    critical: Boolean(event.critical),
    read: Boolean(event.read),
    reminder: Boolean(event.reminder),
    notificationStatus: event.notificationStatus || event.sourceProvider || (event.critical ? "Kritik bildirim" : "Normal")
  };
}

async function loadEvents() {
  if (!state.usingApi) {
    state.events = state.data.briefs.map((item, index) => toUiEvent({
      id: `mock_event_${index}`,
      title: item.title,
      category: item.type,
      summary: item.body,
      description: item.body,
      date: new Date().toISOString()
    }));
    return;
  }
  try {
    const params = new URLSearchParams({
      city: state.eventFilters.city,
      type: state.eventFilters.type
    });
    const payload = await api(`/api/events?${params.toString()}`);
    state.events = payload.events.map(toUiEvent);
  } catch { state.events = []; }
}

async function renderEvents() {
  const calendarChecks = await Promise.all(state.events.map(item => isEventInCalendar(item.id)));
  briefList.innerHTML = state.events.map((item, idx) => {
    const inCalendar = calendarChecks[idx];
    return `
    <article class="announcement-item event-ticket-card ${item.read ? "is-read" : ""}">
      <div class="event-ticket-media">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy">` : `<span>${escapeHtml(item.category)}</span>`}
      </div>
      <div>
        <div class="event-ticket-topline">
          <span>${escapeHtml(item.category)}</span>
          <small>${escapeHtml(item.sourceProvider || item.notificationStatus)}</small>
        </div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="event-ticket-meta">
          <span><i class="fa-regular fa-calendar"></i> ${escapeHtml(item.displayDate)}</span>
          ${item.venue ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.venue)}${item.city ? `, ${escapeHtml(item.city)}` : ""}</span>` : ""}
        </div>
        <p>${escapeHtml(item.summary)}</p>
        <div class="event-actions">
          <button data-event-action="detail" data-id="${escapeHtml(item.id)}">Detay</button>
          ${item.ticketUrl ? `<a class="ticket-link" href="${escapeHtml(item.ticketUrl)}" target="_blank" rel="noopener">Bilet Al</a>` : ""}
          <button class="event-cal-btn ${inCalendar ? 'in-calendar' : ''}" data-event-action="add-to-calendar" data-id="${escapeHtml(item.id)}" ${inCalendar ? "disabled" : ""}>
            <i class="fa-${inCalendar ? 'solid' : 'regular'} fa-calendar-plus"></i> ${inCalendar ? "Takvimde" : "Takvime Ekle"}
          </button>
          <button data-event-action="reminder" data-id="${escapeHtml(item.id)}">${item.reminder ? "Hatırlatıcı Açık" : "Hatırlat"}</button>
          <button data-event-action="read" data-id="${escapeHtml(item.id)}">${item.read ? "Okundu" : "Okundu İşaretle"}</button>
          <button data-event-action="dismiss" data-id="${escapeHtml(item.id)}">Gizle</button>
        </div>
      </div>
    </article>`;
  }).join("") || `<p class="empty-state inline">Kurumsal etkinlik veya duyuru bulunamadı.</p>`;
}

async function showEventDetail(eventId) {
  let event = state.events.find((item) => String(item.id) === String(eventId));
  if (state.usingApi) {
    try {
      const payload = await api(`/api/events/${eventId}`);
      event = toUiEvent(payload.event);
    } catch { }
  }
  if (!event) return;
  detailPanel.hidden = false;
  document.body.classList.add("reader-open");
  detailContent.innerHTML = `
    <div class="article-meta">
      <span>${escapeHtml(event.category)}</span>
      <span>${escapeHtml(event.displayDate)}</span>
      <span>${escapeHtml(event.notificationStatus)}</span>
    </div>
    <h2>${escapeHtml(event.title)}</h2>
    ${event.imageUrl ? `<img class="event-detail-image" src="${escapeHtml(event.imageUrl)}" alt="" loading="lazy">` : ""}
    <div class="${event.critical ? "content-warning" : "content-ok"}">
      <strong>${event.critical ? "Kritik duyuru" : "Etkinlik bilgisi"}</strong>
      <p>${escapeHtml(event.summary)}</p>
    </div>
    ${event.venue ? `<p><strong>Mekan:</strong> ${escapeHtml(event.venue)}${event.city ? `, ${escapeHtml(event.city)}` : ""}</p>` : ""}
    <p>${escapeHtml(event.description)}</p>
    ${event.ticketUrl ? `<p><a class="ticket-link detail-ticket-link" href="${escapeHtml(event.ticketUrl)}" target="_blank" rel="noopener">Bilet sayfasını aç</a></p>` : ""}
  `;
}

async function handleEventAction(action, eventId) {
  const event = state.events.find((item) => String(item.id) === String(eventId));
  if (!event) return;
  if (action === "detail") { showEventDetail(event.id); return; }
  if (action === "add-to-calendar") {
    const alreadyAdded = await isEventInCalendar(event.id);
    if (alreadyAdded) { showToast("Bu etkinlik zaten takviminde.", "info"); return; }
    showAddToCalendarModal(event, () => renderEvents());
    return;
  }
  try {
    if (action === "read") {
      if (state.usingApi) await api(`/api/events/${event.id}/read`, { method: "POST", body: "{}" });
      event.read = true;
      showToast("Okundu olarak işaretlendi.", "success");
    }
    if (action === "reminder") {
      if (state.usingApi) {
        const payload = await api(`/api/events/${event.id}/reminder`, { method: "POST", body: "{}" });
        event.reminder = payload.reminder;
      } else {
        event.reminder = !event.reminder;
      }
      showToast(event.reminder ? "Hatırlatıcı eklendi." : "Hatırlatıcı kaldırıldı.", "info");
      renderEditionCalendar();
    }
    if (action === "dismiss") {
      if (state.usingApi) await api(`/api/events/${event.id}/dismiss`, { method: "POST", body: "{}" });
      state.events = state.events.filter((item) => item.id !== event.id);
      showToast("Duyuru gizlendi.", "info");
    }
    renderEvents();
    renderEditionCalendar();
  } catch (error) {
    integrationResult.textContent = `Duyuru işlemi başarısız: ${error.message}`;
  }
}

/* ============================
   EXPORT / PDF
   ============================ */
function getExportLayout() {
  return document.querySelector("input[name='layout']:checked")?.value || "a4";
}

function getSelectedExportArticles() {
  return state.newspaperArticles
    .map((id) => state.data.articles.find((a) => String(a.id) === String(id)))
    .filter(Boolean);
}

function renderExportArticleOptionsLegacy() {
  if (!exportArticleList) return;
  const selected = getSelectedExportArticles();
  exportArticleList.innerHTML = `
    <strong>Gazeteye eklenen haberler</strong>
    ${selected.length ? selected.map((article) => `
      <article class="newspaper-selection-item">
        <span>${escapeHtml(article.title)}</span>
        <button data-remove-newspaper="${escapeHtml(String(article.id))}" type="button">Çıkar</button>
      </article>
    `).join("") : `<p class="empty-state inline">Akıştaki haberlerden "Gazeteye Ekle" butonuyla seçim yap.</p>`}
  `;
  updatePrintPreview();
}

function updatePrintPreviewLegacy() {
  if (!printPreview) return;
  const layoutNames = { a4: "A4 klasik gazete", tabloid: "Tabloid geniş sayfa", booklet: "Kitapçık düzeni" };
  const layout = getExportLayout();
  const selected = getSelectedExportArticles();
  const preferences = normalizePreferences(state.data.preferences);
  const userName = state.authUser?.name || "Okuyucu";
  const now = new Date();
  const dateStr = now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const paperTitle = (() => {
    const mode = localStorage.getItem("newspaperTitleMode") || "personalized";
    return mode === "personalized" ? `${userName.split(" ")[0]}'in Gazetesi` : "Kişisel Gazetem";
  })();

  const interests = preferences.interests.length
    ? preferences.interests.map((i) => `<span class="pp-tag">${escapeHtml(i)}</span>`).join("")
    : `<span class="pp-tag">—</span>`;

  const trends = computeTrendGroups().slice(0, 3);
  const trendRows = trends.length
    ? trends.map((g, i) => `
        <li class="pp-trend-row">
          <span class="pp-trend-rank">${i + 1}</span>
          <span>${escapeHtml(g.representative.title.slice(0, 70))}${g.representative.title.length > 70 ? "…" : ""}</span>
          <span class="pp-trend-meta">${g.sources.size} kaynak</span>
        </li>`).join("")
    : `<li>—</li>`;

  const articleRows = selected.length
    ? selected.map((a, i) => `
        <li class="pp-article-row">
          <span class="pp-art-num">${i + 1}</span>
          <span class="pp-art-cat" style="color:${categoryColor(a.category) || "var(--accent)"}">${escapeHtml(a.category)}</span>
          <span class="pp-art-title">${escapeHtml(a.title)}</span>
          <span class="pp-art-src">${escapeHtml(a.source || "")}</span>
        </li>`).join("")
    : `<li class="pp-empty">Henüz haber eklenmedi — "İlgi Alanıma Göre Otomatik Seç" ile başlayabilirsin.</li>`;

  const sources = [...new Set(selected.map((a) => a.source).filter(Boolean))];
  const sourceList = sources.length ? sources.map((s) => escapeHtml(s)).join(" · ") : "—";

  printPreview.innerHTML = `
    <div class="pp-cover">
      <div class="pp-paper-name">${escapeHtml(paperTitle)}</div>
      <div class="pp-date">${escapeHtml(dateStr)}</div>
      <div class="pp-edition-label">${escapeHtml(layoutNames[layout] || layoutNames.a4)} · ${selected.length} haber · ${state.events.length} duyuru</div>
    </div>
    <div class="pp-section">
      <div class="pp-section-heading">İlgi Alanları</div>
      <div class="pp-tags">${interests}</div>
    </div>
    <div class="pp-section">
      <div class="pp-section-heading">Seçilen Haberler</div>
      <ol class="pp-article-list">${articleRows}</ol>
    </div>
    <div class="pp-section">
      <div class="pp-section-heading">Bugünün Trendleri</div>
      <ol class="pp-trend-list">${trendRows}</ol>
    </div>
    <div class="pp-section">
      <div class="pp-section-heading">Kaynaklar</div>
      <p class="pp-sources">${sourceList}</p>
    </div>
    <div class="pp-footer">
      <span>Oluşturulma: ${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
    </div>
  `;
}

function exportLayoutNames() {
  return {
    a4: "A4 klasik gazete",
    tabloid: "Tabloid geniş sayfa",
    booklet: "Kitapçık düzeni",
    egazete: "E-Gazete / Sayfa Çevirme"
  };
}

function enhanceExportLayoutChoices() {
  const descriptions = {
    a4: "Dengeli iki kolon, baskıya uygun kişisel gazete.",
    tabloid: "Büyük manşet ve üç kolonlu dergi/gazete düzeni.",
    booklet: "Kompakt, sayfa sayfa okunabilir mini gazete.",
    egazete: "Önizlemede ileri-geri sayfa deneyimi, PDF'te aynı sayfa yapısı."
  };
  const names = exportLayoutNames();
  document.querySelectorAll(".export-options input[name='layout']").forEach((input) => {
    const label = input.closest("label");
    if (!label || label.classList.contains("export-layout-choice")) return;
    const checked = input.checked ? "checked" : "";
    label.className = "export-layout-choice";
    label.innerHTML = `<input type="radio" name="layout" value="${escapeHtml(input.value)}" ${checked} /><span><strong>${escapeHtml(names[input.value] || input.value)}</strong><small>${escapeHtml(descriptions[input.value] || "")}</small></span>`;
  });
}

function getExportPaperTitle() {
  return "Smart Newspaper";
}

function exportArticleImage(article = {}) {
  return article.imageUrl || article.image || article.urlToImage || "";
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function exportArticleSummary(article = {}, limit = 190) {
  const text = stripHtml(article.summary || article.description || article.fullText || article.content || "");
  if (!text) return "Bu haber için kısa özet mevcut değil; başlık ve kaynak bilgisi üzerinden gazete seçkisine eklendi.";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}

function exportArticleDate(article = {}) {
  return article.date || article.publishedAt || article.time || "Bugün";
}

function buildNewspaperPdfPages(selected = getSelectedExportArticles()) {
  const layout = getExportLayout();
  const preferences = normalizePreferences(state.data.preferences);
  const trends = computeTrendGroups().slice(0, 3);
  const dateStr = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const paperTitle = getExportPaperTitle();
  const lead = selected.find(exportArticleImage) || selected[0] || null;
  const pages = [{
    type: "cover",
    title: "Kapak",
    dateStr,
    paperTitle,
    interests: preferences.interests || [],
    trends,
    lead,
    highlights: selected.filter((article) => article !== lead).slice(0, 3),
    articles: selected
  }];
  const groups = new Map();
  for (const article of selected) {
    const category = inferArticleCategory(article) || article.category || "Gündem";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(article);
  }
  for (const [category, articles] of groups.entries()) {
    const chunkSize = layout === "booklet" ? 3 : layout === "tabloid" ? 5 : 4;
    for (let index = 0; index < articles.length; index += chunkSize) {
      pages.push({ type: "section", title: category, dateStr, paperTitle, articles: articles.slice(index, index + chunkSize) });
    }
  }
  pages.push({
    type: "sources",
    title: "Kaynaklar",
    dateStr,
    paperTitle,
    articles: selected,
    sources: [...new Set(selected.map((article) => article.source || article.sourceName).filter(Boolean))]
  });
  return pages;
}

function renderPdfImage(article = {}, className = "pdf-news-image") {
  const image = exportArticleImage(article);
  if (image) return `<img class="${className}" src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async">`;
  return `<div class="${className} pdf-image-placeholder"><i class="fa-regular fa-image"></i><span>Görsel bulunamadı</span></div>`;
}

function renderPreviewArticleCard(article = {}, index = 0, lead = false) {
  const category = inferArticleCategory(article) || article.category || "Gündem";
  return `
    <article class="pdf-preview-story ${lead ? "is-lead" : ""}">
      ${renderPdfImage(article)}
      <div class="pdf-preview-story-body">
        <div class="pdf-story-meta">
          <span style="--cat-color:${categoryColor(category) || "var(--accent)"}">${escapeHtml(category)}</span>
          <em>${escapeHtml(article.source || article.sourceName || "Kaynak")}</em>
          <em>${escapeHtml(exportArticleDate(article))}</em>
        </div>
        <h4>${escapeHtml(article.title || `Haber ${index + 1}`)}</h4>
        <p>${escapeHtml(exportArticleSummary(article, lead ? 260 : 160))}</p>
      </div>
    </article>
  `;
}

function renderNewspaperPreviewPage(page = {}, index = 0, total = 1) {
  const footer = `
    <footer class="pdf-preview-footer">
      <span>${escapeHtml(page.paperTitle || getExportPaperTitle())}</span>
      <span>${escapeHtml(page.dateStr || "")}</span>
      <strong>Sayfa ${index + 1}/${total}</strong>
    </footer>
  `;
  if (page.type === "cover") {
    const lead = page.lead || page.articles?.[0] || {};
    return `
      <section class="pdf-preview-page pdf-preview-cover">
        <header class="pdf-preview-masthead">
          <span>${escapeHtml(page.dateStr || "")}</span>
          <h2>${escapeHtml(page.paperTitle || getExportPaperTitle())}</h2>
          <em>Kişisel gazete baskısı</em>
        </header>
        <div class="pdf-cover-grid">
          <div class="pdf-cover-main">
            ${renderPdfImage(lead, "pdf-cover-image")}
            <h3>${escapeHtml(lead.title || "Bugünün manşeti hazırlanıyor")}</h3>
            <p>${escapeHtml(exportArticleSummary(lead, 300))}</p>
          </div>
          <aside class="pdf-cover-side">
            <strong>İlgi Alanları</strong>
            <div class="pdf-mini-tags">${(page.interests?.length ? page.interests : ["Genel"]).slice(0, 6).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
            <strong>Bugünün Trendleri</strong>
            <ol>${(page.trends || []).map((trend) => `<li>${escapeHtml(trend.title || trend.representative?.title || "Trend")}</li>`).join("") || "<li>Trend verisi sınırlı</li>"}</ol>
            <strong>Öne Çıkanlar</strong>
            ${(page.highlights || []).map((article, i) => renderPreviewArticleCard(article, i, false)).join("")}
          </aside>
        </div>
        ${footer}
      </section>
    `;
  }
  if (page.type === "sources") {
    return `
      <section class="pdf-preview-page pdf-preview-sources">
        <header class="pdf-preview-page-head"><span>Kaynakça</span><h3>Bu Baskıda Kullanılan Kaynaklar</h3></header>
        <div class="pdf-source-grid">
          ${(page.sources?.length ? page.sources : ["Kaynak bilgisi sınırlı"]).map((source, i) => `<div><b>${String(i + 1).padStart(2, "0")}</b><span>${escapeHtml(source)}</span></div>`).join("")}
        </div>
        <p class="pdf-source-note">Bu kişisel gazete yalnızca seçili haberlerin başlık, özet, kaynak ve görsel alanlarından oluşturulur.</p>
        ${footer}
      </section>
    `;
  }
  return `
    <section class="pdf-preview-page pdf-preview-section">
      <header class="pdf-preview-page-head"><span>${escapeHtml(page.dateStr || "")}</span><h3>${escapeHtml(page.title || "Haberler")}</h3></header>
      <div class="pdf-preview-story-grid">
        ${(page.articles || []).map((article, i) => renderPreviewArticleCard(article, i, i === 0)).join("")}
      </div>
      ${footer}
    </section>
  `;
}

function renderExportArticleOptions() {
  if (!exportArticleList) return;
  const selected = getSelectedExportArticles();
  const byCategory = selected.reduce((acc, article) => {
    const category = inferArticleCategory(article) || article.category || "Gündem";
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  exportArticleList.innerHTML = `
    <strong>Gazeteye eklenen haberler (${selected.length})</strong>
    ${selected.length ? `<div class="export-category-summary">${Object.entries(byCategory).map(([category, count]) => `<span>${escapeHtml(category)}: ${count}</span>`).join("")}</div>` : ""}
    ${selected.length ? selected.map((article) => `
      <article class="newspaper-selection-item">
        <span>${escapeHtml(article.title)}<small>${escapeHtml(inferArticleCategory(article) || article.category || "Gündem")} · ${escapeHtml(article.source || "")}</small></span>
        <button data-remove-newspaper="${escapeHtml(String(article.id))}" type="button">Çıkar</button>
      </article>
    `).join("") : `<p class="empty-state inline">Henüz haber eklenmedi. İlgi alanına göre otomatik seçerek görselli bir kişisel gazete oluşturabilirsin.</p>`}
  `;
  updatePrintPreview();
}

function updatePrintPreview() {
  if (!printPreview) return;
  const layoutNames = exportLayoutNames();
  const layout = getExportLayout();
  const selected = getSelectedExportArticles();
  const pages = buildNewspaperPdfPages(selected);
  state.exportPreviewPage = Math.min(state.exportPreviewPage || 0, Math.max(0, pages.length - 1));
  const activePage = pages[state.exportPreviewPage] || pages[0];

  // Preserve current height to prevent layout shift during page flip
  const currentHeight = printPreview.offsetHeight;
  if (currentHeight > 0) printPreview.style.minHeight = currentHeight + "px";

  const newHtml = `
    <div class="pdf-preview-toolbar">
      <div><span>Sayfa Önizleme</span><strong>${escapeHtml(layoutNames[layout] || layoutNames.a4)} · ${selected.length} haber</strong></div>
      <div class="pdf-preview-controls">
        <button type="button" data-export-page="prev" ${state.exportPreviewPage <= 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left"></i></button>
        <em>${state.exportPreviewPage + 1}/${pages.length}</em>
        <button type="button" data-export-page="next" ${state.exportPreviewPage >= pages.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-right"></i></button>
      </div>
    </div>
    ${selected.length ? renderNewspaperPreviewPage(activePage, state.exportPreviewPage, pages.length) : `<div class="pdf-preview-empty"><i class="fa-regular fa-newspaper"></i><strong>Gazete için haber seçilmedi</strong><p>Otomatik seçimle veya haber kartlarından “Gazeteye Ekle” ile kapağı, iç sayfaları ve kaynakçası olan bir PDF hazırlayabilirsin.</p></div>`}
  `;

  // Apply with a short fade to avoid jarring visual shift
  printPreview.style.transition = "opacity 120ms ease";
  printPreview.style.opacity = "0";
  requestAnimationFrame(() => {
    printPreview.innerHTML = newHtml;
    requestAnimationFrame(() => {
      printPreview.style.opacity = "1";
      // Release minHeight once new content is rendered
      requestAnimationFrame(() => { printPreview.style.minHeight = ""; });
    });
  });
}

function buildInterestBasedPdfSelectionLegacy() {
  personalizeArticleScores(state.data.articles);

  const highInterest = getHighInterestArticles();
  const trendArticles = computeTrendGroups().flatMap((g) => g.articles).filter((a) => articleInterestScore(a) >= 50);

  const seen = new Set();
  const candidates = [...highInterest, ...trendArticles].filter((a) => {
    const key = String(a.id || a.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const categoryCount = {};
  const selected = [];
  for (const article of candidates) {
    const cat = inferArticleCategory(article);
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    if (categoryCount[cat] <= 3) selected.push(article);
    if (selected.length >= 12) break;
  }

  if (selected.length < 5) {
    const extra = [...state.data.articles]
      .sort((a, b) => articleInterestScore(b) - articleInterestScore(a))
      .filter((a) => !selected.some((s) => String(s.id) === String(a.id)));
    selected.push(...extra.slice(0, 5 - selected.length));
  }

  state.newspaperArticles = selected.map((a) => String(a.id));
  renderExportArticleOptions();
  showToast(`${selected.length} haber ilgi alanlarına göre seçildi.`, "success");
}

function buildInterestBasedPdfSelection() {
  personalizeArticleScores(state.data.articles);
  const prefs = normalizePreferences(state.data.preferences);
  const selectedInterests = new Set((prefs.interests || []).map((item) => normalizeText(item)));
  const highInterest = getHighInterestArticles();
  const trendArticles = computeTrendGroups().flatMap((group) => group.articles).filter((article) => articleInterestScore(article) >= 50);
  const seen = new Set();
  const candidates = [...highInterest, ...trendArticles, ...state.data.articles]
    .filter((article) => {
      const key = String(article.id || article.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aCategory = normalizeText(inferArticleCategory(a) || a.category || "");
      const bCategory = normalizeText(inferArticleCategory(b) || b.category || "");
      const aInterest = selectedInterests.has(aCategory) ? 120 : 0;
      const bInterest = selectedInterests.has(bCategory) ? 120 : 0;
      const aImage = exportArticleImage(a) ? 35 : 0;
      const bImage = exportArticleImage(b) ? 35 : 0;
      return (articleInterestScore(b) + bInterest + bImage) - (articleInterestScore(a) + aInterest + aImage);
    });

  const selected = [];
  if (selectedInterests.size) {
    for (const interest of selectedInterests) {
      const match = candidates.find((article) => normalizeText(inferArticleCategory(article) || article.category || "") === interest);
      if (match && !selected.some((article) => String(article.id) === String(match.id))) selected.push(match);
    }
  }

  const categoryCount = {};
  for (const article of candidates) {
    const category = inferArticleCategory(article) || article.category || "Gündem";
    categoryCount[category] = (categoryCount[category] || 0) + 1;
    if (categoryCount[category] <= 3 && !selected.some((item) => String(item.id) === String(article.id))) selected.push(article);
    if (selected.length >= 12) break;
  }

  if (!selected.length) {
    showToast("Seçili ilgi alanlarına uygun haber bulunamadı.", "error");
    return;
  }

  selected.sort((a, b) => {
    const aImage = exportArticleImage(a) ? 80 : 0;
    const bImage = exportArticleImage(b) ? 80 : 0;
    return (articleInterestScore(b) + bImage) - (articleInterestScore(a) + aImage);
  });
  state.newspaperArticles = selected.map((article) => String(article.id));
  state.exportPreviewPage = 0;
  renderExportArticleOptions();
  showToast(`${selected.length} haber ilgi alanlarına göre seçildi.`, "success");
}

function openPrintPreview() {
  updatePrintPreview();
  window.print();
}

function exportPdfLayoutConfig(layout = getExportLayout()) {
  const configs = {
    a4: { format: "a4", widthMm: 210, heightMm: 297, orientation: "portrait", className: "pdf-export-layout-a4" },
    tabloid: { format: [279.4, 431.8], widthMm: 279.4, heightMm: 431.8, orientation: "portrait", className: "pdf-export-layout-tabloid" },
    booklet: { format: "a5", widthMm: 148, heightMm: 210, orientation: "portrait", className: "pdf-export-layout-booklet" },
    egazete: { format: "a4", widthMm: 210, heightMm: 297, orientation: "portrait", className: "pdf-export-layout-egazete" }
  };
  return configs[layout] || configs.a4;
}

function exportPdfFilename(layout = getExportLayout()) {
  const dateKeyText = new Date().toISOString().slice(0, 10);
  return `kisisel-gazetem-${layout}-${dateKeyText}.pdf`;
}

function replacePdfImageWithPlaceholder(img) {
  const placeholder = document.createElement("div");
  placeholder.className = (img.className || "pdf-news-image") + " pdf-image-placeholder";
  placeholder.innerHTML = '<span style="font-size:11px;font-weight:800;color:#888;">Görsel yüklenemedi</span>';
  placeholder.style.cssText = "display:grid;place-items:center;background:linear-gradient(135deg,rgba(40,83,107,.10),rgba(164,63,47,.06));border-radius:6px;min-height:" + (img.classList.contains("pdf-cover-image") ? "200px" : "100px");
  img.replaceWith(placeholder);
}

async function preparePdfImages(container) {
  const images = [...container.querySelectorAll("img")];
  await Promise.all(images.map((img) => new Promise((resolve) => {
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.loading = "eager";
    img.decoding = "sync";
    const done = () => {
      if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) replacePdfImageWithPlaceholder(img);
      resolve();
    };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", () => { replacePdfImageWithPlaceholder(img); resolve(); }, { once: true });
    if (img.complete) done();
    window.setTimeout(done, 4500);
  })));
}

async function downloadPdfFromServerFallback(selected) {
  const prefs = normalizePreferences(state.data.preferences);
  const pdfTrends = computeTrendGroups().slice(0, 3).map((g) => ({
    title: g.title, articleCount: g.articles.length, sourceCount: g.sources.size
  }));
  const response = await fetch(`${API_BASE_URL}/api/export/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layout: getExportLayout(),
      paperTitle: getExportPaperTitle(),
      interests: prefs.interests || [],
      trends: pdfTrends,
      articles: selected.map((a) => ({
        id: a.id, title: a.title, summary: a.summary, fullText: a.fullText,
        category: a.category, sourceName: a.source, publishedAt: a.date,
        imageUrl: exportArticleImage(a), image: exportArticleImage(a),
        urlToImage: exportArticleImage(a), similarCount: a.similarCount || 0
      }))
    })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Sunucu PDF fallback oluşturulamadı.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportPdfFilename(getExportLayout());
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function buildPdfExportAllPagesHtml(selected) {
  const pages = buildNewspaperPdfPages(selected);
  return pages.map((page, i) => renderNewspaperPreviewPage(page, i, pages.length)).join("\n");
}

async function downloadPdf() {
  const selected = getSelectedExportArticles();
  let container = null;
  const params = new URLSearchParams({
    mode: "inline",
    personalized: "true",
    includeUserSources: "true",
    layout: "egazete",
    language: normalizePreferences(state.data.preferences).language || "tr",
    articleIds: selected.map((article) => String(article.id)).filter(Boolean).join(",")
  });
  const activeCategory = state.selectedCategory && state.selectedCategory !== "all" ? state.selectedCategory : "";
  const activeRegion = typeof currentSelectedRegions === "function"
    ? currentSelectedRegions().filter((region) => region && region !== "global")[0] || ""
    : "";
  if (activeCategory) params.set("category", activeCategory);
  if (activeRegion) params.set("region", activeRegion);
  if (selected.length) {
    showToast("PDF hazÄ±rlanÄ±yor, yeni sekmede aÃ§Ä±lacak...", "info");
    window.open(`${API_BASE_URL}/api/export/pdf?${params.toString()}`, "_blank", "noopener,noreferrer");
    return;
  }
  if (!selected.length) { showToast("PDF için en az bir haber seç.", "error"); return; }

  try {
    downloadPdfButton.disabled = true;
    downloadPdfButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PDF hazırlanıyor...';

    const config = exportPdfLayoutConfig(getExportLayout());
    const allPagesHtml = buildPdfExportAllPagesHtml(selected);

    // Build a self-contained off-screen DOM container with inline styles
    container = document.createElement("div");
    container.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:" + config.widthMm + "mm;background:#fffdf8;font-family:'Playfair Display',Georgia,serif;color:#1f2933;";

    // Inject critical inline styles so html2canvas renders properly
    const styleEl = document.createElement("style");
    styleEl.textContent = [
      "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
      ".pdf-preview-page { display:flex;flex-direction:column;gap:16px;min-height:" + config.heightMm + "mm;padding:24px;background:linear-gradient(180deg,#fffdf8,#f7efe0);color:#1f2933;page-break-after:always;break-after:page;overflow:hidden; }",
      ".pdf-preview-page:last-child { page-break-after:avoid;break-after:avoid; }",
      ".pdf-preview-masthead { display:flex;flex-direction:column;align-items:center;gap:6px;padding-bottom:13px;border-bottom:4px double rgba(39,30,19,.72);text-align:center; }",
      ".pdf-preview-masthead h2 { margin:0;font-family:'Playfair Display',Georgia,serif;color:#1f2933;font-size:42px;line-height:.95; }",
      ".pdf-preview-masthead span,.pdf-preview-masthead em,.pdf-preview-page-head span { color:#6b7280;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase; }",
      ".pdf-preview-page-head { display:flex;flex-direction:column;gap:6px;padding-bottom:10px;border-bottom:3px double rgba(39,30,19,.62); }",
      ".pdf-preview-page-head h3 { margin:0;font-family:'Playfair Display',Georgia,serif;color:#17202a;font-size:32px;line-height:1.02; }",
      ".pdf-cover-grid { display:grid;grid-template-columns:1.6fr .9fr;gap:18px; }",
      ".pdf-cover-main { display:flex;flex-direction:column;gap:12px; }",
      ".pdf-cover-main h3 { margin:0;font-family:'Playfair Display',Georgia,serif;color:#17202a;font-size:32px;line-height:1.02; }",
      ".pdf-cover-main p,.pdf-preview-story p,.pdf-source-note { margin:0;color:#4b5563;font-size:13px;line-height:1.55; }",
      ".pdf-cover-image,.pdf-news-image { width:100%;object-fit:cover;border:1px solid rgba(40,32,24,.18);background:#e7dcc9;border-radius:6px; }",
      ".pdf-cover-image { height:220px; }",
      ".pdf-news-image { height:120px; }",
      ".pdf-image-placeholder { display:grid;place-items:center;gap:8px;color:rgba(40,83,107,.82);border-radius:6px;background:linear-gradient(135deg,rgba(40,83,107,.14),rgba(164,63,47,.08));font-size:12px;font-weight:900;min-height:100px; }",
      ".pdf-cover-side { display:flex;flex-direction:column;gap:10px;padding-left:16px;border-left:1px solid rgba(115,88,54,.18); }",
      ".pdf-cover-side>strong { color:#8f2f2a;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase; }",
      ".pdf-mini-tags { display:flex;flex-wrap:wrap;gap:6px; }",
      ".pdf-mini-tags span { padding:5px 8px;background:rgba(40,83,107,.09);border-radius:999px;font-size:11px;font-weight:850; }",
      ".pdf-cover-side ol { margin:0 0 4px 18px;color:#1f2933;font-size:12px;line-height:1.45; }",
      ".pdf-preview-story-grid { display:grid;grid-template-columns:repeat(2,1fr);gap:14px; }",
      ".pdf-preview-story { display:flex;flex-direction:column;gap:10px;min-width:0;padding:12px;border:1px solid rgba(115,88,54,.14);background:rgba(255,255,255,.58);border-radius:8px; }",
      ".pdf-preview-story.is-lead { grid-column:1/-1;display:grid;grid-template-columns:.9fr 1.1fr;align-items:stretch; }",
      ".pdf-preview-story.is-lead .pdf-news-image { height:180px; }",
      ".pdf-preview-story-body { display:flex;flex-direction:column;gap:6px; }",
      ".pdf-story-meta { display:flex;flex-wrap:wrap;gap:6px;align-items:center; }",
      ".pdf-story-meta span { padding:4px 7px;border-radius:999px;font-size:10px;font-weight:950;background:rgba(139,26,26,.10);color:#8f2f2a; }",
      ".pdf-story-meta em { color:#6b7280;font-size:10px;font-style:normal;font-weight:850; }",
      ".pdf-preview-story h4 { margin:0;color:#17202a;font-family:'Playfair Display',Georgia,serif;font-size:18px;line-height:1.12; }",
      ".pdf-source-grid { display:grid;grid-template-columns:repeat(2,1fr);gap:10px; }",
      ".pdf-source-grid div { display:grid;grid-template-columns:34px 1fr;gap:10px;padding:12px;border:1px solid rgba(115,88,54,.14);background:rgba(255,255,255,.55);border-radius:8px; }",
      ".pdf-source-grid b { color:#8f2f2a; }",
      ".pdf-source-grid span { color:#1f2933;font-weight:850; }",
      ".pdf-preview-footer { display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:10px;border-top:1px solid rgba(39,30,19,.2);color:#6b7280;font-size:11px;font-weight:850; }"
    ].join("\n");
    container.appendChild(styleEl);

    const content = document.createElement("div");
    content.innerHTML = allPagesHtml;
    container.appendChild(content);
    document.body.appendChild(container);

    await preparePdfImages(container);

    const opt = {
      margin: 0,
      filename: exportPdfFilename(getExportLayout()),
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#fffdf8",
        logging: false
      },
      jsPDF: {
        unit: "mm",
        format: config.format,
        orientation: config.orientation
      },
      pagebreak: {
        mode: ["css", "legacy"],
        before: ".pdf-preview-page",
        avoid: [".pdf-preview-story", ".pdf-source-grid div"]
      }
    };

    await html2pdf().set(opt).from(container).save();
    showToast("PDF önizleme düzeniyle indirildi!", "success");

  } catch (error) {
    console.error("PDF Client-side Error:", error);
    try {
      showToast("PDF istemci tarafında oluşturulamadı; sunucu fallback deneniyor...", "info");
      await downloadPdfFromServerFallback(selected);
      showToast("PDF sunucu fallback ile indirildi.", "success");
    } catch (fallbackError) {
      showToast("PDF oluşturulamadı: " + (fallbackError.message || error.message), "error");
    }
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    downloadPdfButton.disabled = false;
    downloadPdfButton.innerHTML = '<i class="fa-solid fa-download"></i> PDF İndir';
  }
}

/* ============================
   INTEGRATION STATUS
   ============================ */
function renderIntegrationStatus(status) {
  if (!integrationStatus) return;
  const items = [
    ["FreeNewsApi", status.freeNewsApi],
    ["GNews", status.gnews],
    ["NewsAPI", status.newsApi],
    ["Mediastack", status.mediastack],
    ["Gemini", status.gemini],
    ["RSS", status.rssFeeds > 0]
  ];
  integrationStatus.innerHTML = items.map(([name, active]) => `
    <span class="${active ? "active" : ""}">
      <i class="fa-solid ${active ? "fa-circle-check" : "fa-circle-xmark"}"></i>
      ${name}
    </span>
  `).join("");
}

async function refreshIntegrations() {
  if (!integrationResult) return;
  try {
    const status = await api("/api/integrations/status");
    renderIntegrationStatus(status);
    integrationResult.textContent = `Backend çalışıyor. AI modeli: ${status.aiModel || "tanımlı değil"}. RSS kaynak sayısı: ${status.rssFeeds}.`;
  } catch {
    integrationResult.textContent = "Backend çalışmıyor veya bu sayfa doğrudan dosya olarak açıldı. Test için node server.js ile başlat.";
  }
}

async function testNewsApi() {
  integrationResult.textContent = "Haber API test ediliyor...";
  try {
    const payload = await api("/api/integrations/test/news", { method: "POST", body: "{}" });
    integrationResult.innerHTML = `
      <strong>${payload.provider} çalıştı.</strong>
      ${payload.articles.map((a) => `<p>${escapeHtml(a.title || "Başlıksız")} <span>${escapeHtml(a.source || "")}</span></p>`).join("")}
    `;
  } catch (error) {
    integrationResult.textContent = `Haber API testi başarısız: ${error.message}`;
  }
}

async function testAiApi() {
  integrationResult.textContent = "AI API test ediliyor...";
  try {
    const payload = await api("/api/integrations/test/ai", { method: "POST", body: "{}" });
    integrationResult.innerHTML = `<strong>${payload.model || "AI"} çalıştı.</strong><p>${escapeHtml(payload.message)}</p>`;
  } catch (error) {
    integrationResult.textContent = `AI testi başarısız: ${error.message}`;
  }
}

/* ============================
   ARTICLE FILTERING & SORTING
   ============================ */
function articleMatches(article, filters = currentSearchFilters()) {
  const rawQuery = filters.query || "";
  const query = normalizeText(rawQuery);
  const enrichedArticle = enrichArticleRegion(article);
  const categoryInfo = enrichArticleCategory(article);
  const articleCategory = categoryInfo.category;
  const articleSubcategory = inferArticleSubcategory(article);
  const articleRegions = (enrichedArticle.regions || []).join(" ");
  const articleKeywords = (enrichedArticle.detectedLocationKeywords || []).join(" ");
  const haystack = normalizeText(`${article.title} ${article.summary} ${article.fullText || ""} ${article.source} ${articleCategory} ${articleSubcategory} ${articleRegions} ${articleKeywords} ${enrichedArticle.country || ""}`);
  return (!query || haystack.includes(query))
    && (!state.favoriteFeedOnly || Number(article.relevance || 0) >= 75)
    && matchesCategory(article, filters.category)
    && (filters.subcategory === "Tümü" || articleSubcategory === filters.subcategory)
    && matchesRegion(enrichedArticle, filters.regions)
    && (filters.source === "Tümü" || article.source === filters.source)
    && (filters.status === "Tümü" || article.status === filters.status)
    && (filters.date === "Tümü" || article.dateRange === filters.date);
}

function articlePopularity(article) {
  return Number(article.relevance || 0) + (article.bookmarked ? 10 : 0) + (article.status === "Okundu" ? 4 : 0);
}

function parseReadTimeMinutes(readTime) {
  const value = Number(String(readTime || "").replace(",", ".").match(/\d+(\.\d+)?/)?.[0] || 3);
  return Number.isFinite(value) ? value : 3;
}

function sortArticles(articles) {
  const selectedSort = state.selectedSort || sortFilter?.value || "relevance";
  return [...articles].sort((a, b) => {
    if (selectedSort === "date") return new Date(b.publishedAt || b.date || 0) - new Date(a.publishedAt || a.date || 0);
    if (selectedSort === "popularity") return articlePopularity(b) - articlePopularity(a);
    return Number(b.relevance || 0) - Number(a.relevance || 0);
  });
}

/* ============================
   READING INSIGHTS
   ============================ */
function getReadingInsights() {
  const preferences = normalizePreferences(state.data.preferences);
  const readArticles = state.data.articles.filter((a) => a.status === "Okundu");
  const bookmarkedArticles = state.data.articles.filter((a) => a.bookmarked);
  const interactedArticles = state.data.articles.filter((a) =>
    a.status === "Okundu" || a.bookmarked || state.newspaperArticles.includes(String(a.id))
  );
  const weights = new Map();
  const sourceWeights = new Map();

  for (const article of state.data.articles) {
    let weight = 0;
    if (article.status === "Okundu") weight += 2;
    if (article.bookmarked) weight += 1;
    if (state.newspaperArticles.includes(String(article.id))) weight += 1;
    if (!weight) continue;
    const category = inferArticleCategory(article);
    weights.set(category, (weights.get(category) || 0) + weight);
    if (article.source) sourceWeights.set(article.source, (sourceWeights.get(article.source) || 0) + weight);
  }

  const totalWeight = [...weights.values()].reduce((sum, v) => sum + v, 0);
  const categories = [...weights.entries()]
    .map(([category, weight]) => ({
      category,
      weight,
      percent: totalWeight ? Math.round((weight / totalWeight) * 100) : 0
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const topSourceEntry = [...sourceWeights.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const totalReadMinutes = readArticles.reduce((sum, a) => sum + parseReadTimeMinutes(a.readTime), 0);
  const averageReadTime = readArticles.length ? Math.max(1, Math.round(totalReadMinutes / readArticles.length)) : 0;

  return {
    goal: preferences.readingGoal,
    progress: Math.min(100, Math.round((readArticles.length / preferences.readingGoal) * 100)),
    readCount: readArticles.length,
    bookmarkCount: bookmarkedArticles.length,
    minutes: Math.round(totalReadMinutes),
    categories,
    topCategory: categories[0]?.category || "-",
    topSource: topSourceEntry?.[0] || "-",
    averageReadTime,
    signalCount: interactedArticles.length,
    interestTrend: interactedArticles.length >= 4 ? "Yükseliyor" : interactedArticles.length ? "Yeni oluşuyor" : "-"
  };
}

function renderReadingInsights() {
  if (!readingStats) return;
  const insights = getReadingInsights();
  const statCards = [
    { icon: "fa-bullseye", value: `${insights.progress}%`, label: "Günlük hedef", accent: "goal", progress: insights.progress },
    { icon: "fa-newspaper", value: `${insights.readCount}/${insights.goal}`, label: "Okunan haber", accent: "read" },
    { icon: "fa-bookmark", value: `${insights.bookmarkCount}`, label: "Kaydedilen", accent: "saved" },
    { icon: "fa-clock", value: `${insights.minutes} dk`, label: "Okuma süresi", accent: "time" }
  ];

  readingStats.innerHTML = `
    ${statCards.map((card) => `
      <div class="metric-card metric-card-${card.accent}">
        <i class="fa-solid ${card.icon}" aria-hidden="true"></i>
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        ${card.progress != null ? `<div class="reading-progress-track" aria-label="Günlük hedef ${card.progress}%"><i style="width: ${card.progress}%"></i></div>` : ""}
      </div>
    `).join("")}
  `;

  if (!categoryChart) {
    updateReadingGoalUI(insights);
    return;
  }

  if (!insights.signalCount) {
    categoryChart.innerHTML = `
      <div class="sidebar-empty-state sidebar-empty-state-visual">
        <i class="fa-solid fa-sparkles" aria-hidden="true"></i>
        <strong>Henüz yeterli okuma sinyali yok.</strong>
        <span>Haberleri okudukça kişisel analizlerin burada oluşacak.</span>
      </div>
    `;
  } else {
    categoryChart.innerHTML = `
      <div class="analysis-metric">
        <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
        <span>En çok ilgilenilen kategori</span>
        <strong>${escapeHtml(insights.topCategory)}</strong>
      </div>
      <div class="analysis-metric">
        <i class="fa-solid fa-radio" aria-hidden="true"></i>
        <span>En çok okunan kaynak</span>
        <strong>${escapeHtml(insights.topSource)}</strong>
      </div>
      <div class="analysis-metric">
        <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
        <span>Ortalama okuma süresi</span>
        <strong>${insights.averageReadTime} dk</strong>
      </div>
      <div class="analysis-metric">
        <i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i>
        <span>İlgi trendi</span>
        <strong>${escapeHtml(insights.interestTrend)}</strong>
      </div>
      <div class="category-mini-bars" aria-label="Kategori ağırlıkları">
        ${insights.categories.map((item) => `
          <div class="category-bar">
            <div class="category-bar-row">
              <span>${escapeHtml(item.category)}</span>
              <small>${item.percent}%</small>
            </div>
            <div class="category-track"><i style="width: ${item.percent}%"></i></div>
          </div>
        `).join("")}
      </div>
    `;
  }

  updateReadingGoalUI(insights);
}

/* ============================
   FINANCE RADAR / ECONOMY CENTER
   ============================ */
function financeTimeLabel(value) {
  if (!value) return "güncelleme yok";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "güncelleme yok";
  return date.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function financeStatusLabel(status) {
  const labels = { live: "LIVE", delayed: "DELAYED", stale: "CACHE", official_daily: "PUBLIC", calculated: "PUBLIC", no_key: "API_KEY_REQUIRED", license_required: "LICENSE_REQUIRED", error: "HATA" };
  return labels[status] || "PUBLIC";
}

function financeMiniSparkline(asset) {
  const values = Array.isArray(asset?.sparkline) ? asset.sparkline.map(Number).filter(Number.isFinite) : [];
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const range = Math.max(1, Math.max(...values) - min);
  const points = values.map((value, index) => `${index * (48 / (values.length - 1))},${28 - ((value - min) / range) * 24}`).join(" ");
  return `<svg class="finance-sparkline" viewBox="0 0 48 32" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function financeAssetCardHtml(asset, compact = false) {
  const tone = financeAssetTone(asset);
  const selected = !compact && state.finance.selectedCardId === asset.symbol;
  const hasValue = Number.isFinite(Number(asset?.value)) && Number(asset.value) > 0;
  const change = formatFinanceChange(asset);
  return `
    <article class="finance-asset-card finance-tone-${tone}${compact ? " is-compact" : ""}${selected ? " is-selected" : ""}${hasValue ? "" : " is-unavailable"}"
      ${compact ? "" : `data-finance-card="${escapeHtml(asset.symbol)}" tabindex="0" role="button" aria-pressed="${selected ? "true" : "false"}"`}>
      <div class="finance-asset-top">
        <div>
          <span class="finance-asset-type">${escapeHtml(asset.type || "finans")}</span>
          <h4>${escapeHtml(asset.label || asset.symbol)}</h4>
        </div>
        ${change ? `<span class="finance-change-badge">${escapeHtml(change)}</span>` : ""}
      </div>
      <div class="finance-asset-value-row">
        <strong>${hasValue ? escapeHtml(formatFinanceValue(asset)) : "Veri alınamadı"}</strong>
        ${financeMiniSparkline(asset)}
      </div>
      <div class="finance-asset-meta">
        <span>${escapeHtml(asset.sourceName || asset.source || "Kaynak")}</span>
        <span>${escapeHtml(financeStatusLabel(asset.status))}</span>
      </div>
      ${asset.warning || (!hasValue && asset.sourceNote) ? `<small class="finance-warning">${escapeHtml(asset.warning || asset.sourceNote)}</small>` : ""}
      <small class="finance-updated">Son güncelleme: ${escapeHtml(financeTimeLabel(asset.lastUpdated))}</small>
    </article>
  `;
}

const FINANCE_NEWS_CONFIG = {
  USDTRY: { title: "Dolar/TL ile ilgili piyasa haberleri", tags: ["tcmb", "döviz", "doviz", "kur", "usd", "dolar"] },
  EURTRY: { title: "Euro/TL ile ilgili piyasa haberleri", tags: ["tcmb", "döviz", "doviz", "kur", "eur", "euro"] },
  GRAMALTIN: { title: "Gram altın ve emtia haberleri", tags: ["altın", "altin", "gold", "xau", "emtia"] },
  BTCUSDT: { title: "Bitcoin ve kripto piyasa haberleri", tags: ["bitcoin", "btc", "crypto", "kripto", "binance", "coingecko"] },
  XU100: { title: "BIST 100 / KAP / piyasa duyuruları", tags: ["bist", "xu100", "endeks", "piyasa", "borsa", "kap", "şirket", "sirket"] },
  TCMBRATE: { title: "TCMB faiz ve para politikası duyuruları", tags: ["tcmb", "faiz", "ppk", "enflasyon", "para politikası"] },
  KAP: { title: "KAP bildirimleri", tags: ["kap"] }
};

function financeNewsSearchText(item) {
  return normalizeText(`${item.title || ""} ${item.summary || item.description || ""} ${item.category || ""} ${(item.tags || []).join(" ")} ${item.sourceName || item.source || ""}`);
}

function selectedFinanceNews() {
  const config = FINANCE_NEWS_CONFIG[state.finance.selectedCardId] || FINANCE_NEWS_CONFIG.USDTRY;
  const sourcedArticles = (state.data.articles || []).map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    category: item.subcategory || item.category || "Piyasa Haberi",
    publishedAt: item.publishedAt || item.date,
    sourceName: item.sourceName || item.source || "Haber",
    sourceUrl: item.sourceUrl || item.url || "",
    tags: item.tags || []
  }));
  const seen = new Set();
  return [...state.finance.news, ...sourcedArticles]
    .filter((item) => {
      if (state.finance.selectedCardId === "KAP") return item.sourceName === "KAP" || financeNewsSearchText(item).includes("kap");
      const text = financeNewsSearchText(item);
      return config.tags.some((tag) => text.includes(normalizeText(tag)));
    })
    .filter((item) => {
      const key = item.sourceUrl || item.id || item.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 10);
}

function sidebarSourceNewsRow(item, index = 0) {
  const content = normalizeExternalContent(item);
  const isVideo = content.contentType === "video" || content.sourceType === "youtube";
  const icon = isVideo ? "fa-circle-play" : "fa-newspaper";
  const href = content.url ? `href="${escapeHtml(content.url)}" target="_blank" rel="noopener noreferrer"` : "";

  // Try to get favicon from URL
  let faviconHtml = `<i class="fa-solid ${icon}"></i>`;
  if (content.logoUrl) {
    faviconHtml = `<img src="${escapeHtml(content.logoUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                   <i class="fa-solid ${icon}" style="display:none"></i>`;
  } else if (content.thumbnailUrl || content.imageUrl) {
    faviconHtml = `<img src="${escapeHtml(content.thumbnailUrl || content.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                   <i class="fa-solid ${icon}" style="display:none"></i>`;
  } else if (content.url) {
    try {
      const domain = new URL(content.url).hostname;
      faviconHtml = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                     <i class="fa-solid ${icon}" style="display:none"></i>`;
    } catch { /* use default icon */ }
  }

  // Recent badge (within last 2 hours)
  const pubTime = content.publishedAt || content.fetchedAt;
  const isNew = pubTime && (Date.now() - new Date(pubTime).getTime()) < 7200000;
  const newBadge = isNew ? `<span class="sidebar-source-new-badge">yeni</span>` : "";

  return `
    <article class="sidebar-source-news-row">
      <div class="sidebar-source-icon" aria-hidden="true">
        ${faviconHtml}
      </div>
      <div class="sidebar-source-copy">
        <div class="sidebar-source-meta">
          <span>${escapeHtml(content.sourceName || "Kaynak")}${newBadge}</span>
          <span>${escapeHtml(sourceTimeLabel(content.publishedAt || content.fetchedAt))}</span>
        </div>
        ${content.url
    ? `<a class="sidebar-source-title" ${href}>${escapeHtml(content.title || "Kaynak haberi")}</a>`
    : `<strong class="sidebar-source-title">${escapeHtml(content.title || "Kaynak haberi")}</strong>`}
        <small>${escapeHtml(content.category || sourceTypeLabel(content.sourceType) || "Kaynaklarım")}</small>
      </div>
    </article>
  `;
}

function isPlaceholderSourceContent(item = {}) {
  const text = `${item.title || ""} ${item.summary || ""}`;
  return /kaynağ[ıi]\s+eklendiğinde|kaynağı eklendiğinde|son içerikler burada/i.test(text);
}

function renderSidebarSourceNews() {
  if (!sidebarSourceNews) return;
  const items = state.sources.contents
    .map(normalizeExternalContent)
    .filter((item) => item.title)
    .filter((item) => !isPlaceholderSourceContent(item))
    .sort((a, b) => new Date(b.publishedAt || b.fetchedAt || 0) - new Date(a.publishedAt || a.fetchedAt || 0))
    .slice(0, 5);

  if (state.sources.loading && !items.length) {
    sidebarSourceNews.innerHTML = `<div class="sidebar-compact-loading">Kaynak haberleri yükleniyor...</div>`;
    return;
  }

  if (!state.sources.list.length) {
    sidebarSourceNews.innerHTML = `
      <div class="sidebar-compact-empty">
        <i class="fa-solid fa-rss" aria-hidden="true"></i>
        <strong>Henüz kaynak eklemedin.</strong>
        <span>Kaynak ekleyince haberleri burada görünür.</span>
        <button type="button" data-source-manage>Kaynak ekle</button>
      </div>
    `;
    return;
  }

  if (!items.length) {
    sidebarSourceNews.innerHTML = `
      <div class="sidebar-compact-empty">
        <i class="fa-regular fa-newspaper" aria-hidden="true"></i>
        <strong>Kaynaklarından yeni haber yok.</strong>
        <span>Kaynaklarını yenileyebilir veya yeni kaynak ekleyebilirsin.</span>
        <button type="button" data-source-manage>Kaynakları yönet</button>
      </div>
    `;
    return;
  }

  sidebarSourceNews.innerHTML = `
    <div class="sidebar-source-news-list">
      ${items.map(sidebarSourceNewsRow).join("")}
    </div>
    <button type="button" class="sidebar-panel-link" data-source-manage>Kaynakları yönet</button>
  `;
}

function sidebarEconomyAssetRow(asset) {
  const tone = financeAssetTone(asset);
  const hasValue = Number.isFinite(Number(asset?.value)) && Number(asset.value) > 0;
  const change = formatFinanceChange(asset);
  return `
    <article class="sidebar-economy-row finance-tone-${escapeHtml(tone)}">
      <div>
        <span>${escapeHtml(asset.type || "finans")}</span>
        <strong>${escapeHtml(asset.label || asset.symbol || "Gösterge")}</strong>
      </div>
      <div>
        <b>${hasValue ? escapeHtml(formatFinanceValue(asset)) : "Yok"}</b>
        ${change ? `<small>${escapeHtml(change)}</small>` : `<small>${escapeHtml(financeStatusLabel(asset.status))}</small>`}
      </div>
    </article>
  `;
}

function renderSidebarEconomyData() {
  if (!sidebarEconomyData) return;
  const assets = state.finance.assets.slice(0, 5);
  if (state.finance.loading && !assets.length) {
    sidebarEconomyData.innerHTML = `<div class="sidebar-compact-loading">Ekonomi verileri yükleniyor...</div>`;
    return;
  }

  if (!assets.length) {
    sidebarEconomyData.innerHTML = `
      <div class="sidebar-compact-empty">
        <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
        <strong>Ekonomi verisi alınamadı.</strong>
        <span>Ekonomi Radarı ayarlarından göstergeleri kontrol edebilirsin.</span>
        <button type="button" data-sidebar-page="economy">Ekonomi Radarı</button>
      </div>
    `;
    return;
  }

  const updatedAt = assets.map((asset) => asset.lastUpdated).filter(Boolean).sort().at(-1);
  sidebarEconomyData.innerHTML = `
    <div class="sidebar-economy-list">
      ${assets.map(sidebarEconomyAssetRow).join("")}
    </div>
    <div class="sidebar-economy-footer">
      <span>${escapeHtml(financeTimeLabel(updatedAt))}</span>
      <button type="button" data-sidebar-page="economy">Detaylar</button>
    </div>
  `;
}

function renderFinanceWatchlistMini() {
  const card = document.getElementById("finance-radar-card");
  if (!financeWatchlistMini || !card) return;
  const prefs = normalizeFinancePreferences(state.finance.preferences);
  card.hidden = !prefs.showFinanceOnHome;
  const assets = state.finance.assets.slice(0, 4);
  if (state.finance.loading && !assets.length) {
    financeWatchlistMini.innerHTML = `<div class="finance-mini-loading">Finans verileri yükleniyor...</div>`;
    return;
  }
  if (!assets.length) {
    financeWatchlistMini.innerHTML = `
      <div class="finance-empty-mini">
        <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
        <span>Henüz takip ettiğin finansal gösterge yok.</span>
      </div>
    `;
    return;
  }
  financeWatchlistMini.innerHTML = assets.map((asset) => financeAssetCardHtml(asset, true)).join("");
}

function renderFinanceDashboard() {
  if (!financeDashboardGrid) return;
  const assets = state.finance.assets;
  if (state.finance.loading && !assets.length) {
    financeDashboardGrid.innerHTML = Array.from({ length: 6 }).map(() => `<div class="finance-skeleton"></div>`).join("");
  } else if (!assets.length) {
    financeDashboardGrid.innerHTML = `
      <div class="finance-empty-state">
        <i class="fa-solid fa-chart-simple" aria-hidden="true"></i>
        <strong>Henüz takip ettiğin finansal gösterge yok.</strong>
        <span>Ekonomi Radarı’nı kişiselleştirmek için varlık ekle.</span>
        <button type="button" data-finance-settings>Ekonomi Radarı’nı Ayarla</button>
      </div>
    `;
  } else {
    financeDashboardGrid.innerHTML = assets.map((asset) => financeAssetCardHtml(asset)).join("");
  }
  if (!assets.some((asset) => asset.symbol === state.finance.selectedCardId) && assets[0]) {
    state.finance.selectedCardId = assets[0].symbol;
  }

  if (financeSourceHealth) {
    const health = state.finance.sourceHealth || [];
    financeSourceHealth.innerHTML = health.length ? health.map((item) => `
      <div class="finance-health-row finance-health-${escapeHtml(item.status || "info")}">
        <strong>${escapeHtml(item.provider)}</strong>
        <span>${escapeHtml(item.status)}</span>
        <small>${escapeHtml(item.note || "")}</small>
      </div>
    `).join("") : `<p class="finance-muted">Kaynak durumu yükleniyor...</p>`;
  }

  if (financeNewsPanel) {
    const items = selectedFinanceNews();
    const config = FINANCE_NEWS_CONFIG[state.finance.selectedCardId] || FINANCE_NEWS_CONFIG.USDTRY;
    if (financeNewsTitle) financeNewsTitle.textContent = config.title;
    financeNewsPanel.innerHTML = items.length ? items.map((item) => `
      <article class="finance-news-row${item.sourceUrl ? "" : " is-disabled"}">
        <span>${escapeHtml(item.sourceName || item.source || "Finans")}</span>
        <strong>${escapeHtml(item.title || "Duyuru")}</strong>
        <small>${escapeHtml(item.category || "Piyasa Haberi")}</small>
        ${item.summary || item.description ? `<p>${escapeHtml(item.summary || item.description)}</p>` : ""}
        <small>${escapeHtml(financeTimeLabel(item.publishedAt))}</small>
        ${item.sourceUrl
    ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Aç <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i></a>`
    : `<em>Kaynak linki yok</em>`}
      </article>
    `).join("") : `<p class="finance-muted">Seçilen kartla ilgili kaynak bağlantılı haber bulunamadı.</p>`;
  }
}

function renderFinanceRadar() {
  renderSidebarEconomyData();
  renderFinanceWatchlistMini();
  renderFinanceDashboard();
  renderMarketSummaryLeftRail();
}

function renderMarketSummaryLeftRail() {
  const container = document.getElementById("market-summary-list");
  if (!container) return;

  const assets = state.finance.assets.slice(0, 5);
  
  if (state.finance.loading && !assets.length) {
    container.innerHTML = `<div class="finance-muted" style="padding: 1rem; text-align: center;">Veriler yükleniyor...</div>`;
    return;
  }

  if (!assets.length) {
    container.innerHTML = `<div class="finance-muted" style="padding: 1rem; text-align: center;">Gösterilecek finans verisi bulunamadı.</div>`;
    return;
  }

  const dateObj = new Date(assets[0].lastUpdated || Date.now());
  const dateStr = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' ' + dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  const html = assets.map(asset => {
    const hasValue = asset.value !== null && asset.value !== undefined;
    const isError = !hasValue || asset.status === "error";
    
    // Fallback status source strings
    let sourceLabel = "LIVE";
    if (asset.sourceNote?.includes("PUBLIC") || asset.sourceNote?.includes("public")) sourceLabel = "PUBLIC";
    if (asset.isFallback || asset.status === "no_key") sourceLabel = "DEMO";
    if (asset.type === "index" && !asset.isFallback) sourceLabel = "DELAYED";
    if (asset.type === "fx") sourceLabel = "PUBLIC";

    const change = formatFinanceChange(asset);
    const tone = financeAssetTone(asset);
    const valClass = tone === "positive" ? "color-positive" : (tone === "negative" ? "color-negative" : "color-neutral");

    return `
      <div class="market-row">
        <div class="market-col-left">
          <span class="market-type">${escapeHtml(asset.type || "VERİ").toUpperCase()}</span>
          <span class="market-name">${escapeHtml(asset.label || asset.symbol)}</span>
        </div>
        <div class="market-col-right">
          <span class="market-val">${hasValue ? escapeHtml(formatFinanceValue(asset)) : "Veri Yok"}</span>
          <div class="market-source-row">
            ${change ? `<span class="market-change ${valClass}">${change}</span>` : `<span class="market-source">${sourceLabel}</span>`}
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="market-rows-wrapper">
      ${html}
    </div>
    <div class="market-summary-footer">
      <span>${dateStr}</span>
      <span class="market-footer-logo">DA<span>TA</span></span>
    </div>
  `;
}

async function loadFinanceRadar({ force = false } = {}) {
  if (state.finance.loading && !force) return;
  state.finance.loading = true;
  renderFinanceRadar();
  try {
    const prefsPayload = await api("/api/finance/preferences");
    state.finance.preferences = saveLocalFinancePreferences(prefsPayload.preferences || state.finance.preferences);
    const symbols = enabledFinanceSymbols(state.finance.preferences).join(",");
    const [quotesPayload, rssPayload] = await Promise.all([
      api(`/api/finance/quotes?symbols=${encodeURIComponent(symbols)}${force ? "&refresh=1" : ""}`),
      api("/api/finance/rss").catch(() => ({ items: [] }))
    ]);
    state.finance.assets = Array.isArray(quotesPayload.assets) ? quotesPayload.assets : [];
    state.finance.sourceHealth = Array.isArray(quotesPayload.sourceHealth) ? quotesPayload.sourceHealth : [];
    state.finance.news = Array.isArray(rssPayload.items) ? rssPayload.items : [];
    state.finance.error = "";
    state.finance.warning = "";
  } catch (error) {
    state.finance.error = error.message || "Finans verileri yüklenemedi.";
    state.finance.preferences = normalizeFinancePreferences(loadLocalFinancePreferences());
    state.finance.warning = state.finance.assets.length ? "Yenileme başarısız. Son veri gösteriliyor." : state.finance.error;
  } finally {
    state.finance.loading = false;
    renderFinanceRadar();
  }
}

function renderFinancePreferenceModal() {
  if (!financePreferenceBody) return;
  const prefs = normalizeFinancePreferences(state.finance.preferences);
  const enabledMap = new Map(prefs.financeWatchlist.map((item) => [item.symbol, item]));
  const groups = financeGroups();
  financePreferenceBody.innerHTML = `
    <div class="finance-preference-groups">
      ${groups.map((group) => {
    const assets = FINANCE_ASSET_CATALOG.filter((asset) => asset.group === group);
    return `
          <section class="finance-pref-group">
            <h4>${escapeHtml(group)}</h4>
            <div class="finance-pref-options">
              ${assets.map((asset) => {
      const checked = enabledMap.has(asset.symbol) && enabledMap.get(asset.symbol).enabled !== false;
      return `
                  <label class="finance-pref-option">
                    <input type="checkbox" data-finance-symbol="${escapeHtml(asset.symbol)}" ${checked ? "checked" : ""} />
                    <span>
                      <strong>${escapeHtml(asset.label)}</strong>
                      <small>${escapeHtml(asset.sourceHint || asset.type)}</small>
                    </span>
                  </label>
                `;
    }).join("")}
            </div>
          </section>
        `;
  }).join("")}
    </div>
    <section class="finance-selected-order">
      <h4>Görünüm sırası</h4>
      <div id="finance-selected-list" class="finance-selected-list"></div>
    </section>
  `;
  if (financeShowHomeInput) financeShowHomeInput.checked = prefs.showFinanceOnHome;
  if (financeRefreshInterval) financeRefreshInterval.value = prefs.financeRefreshInterval;
  updateFinanceSelectedList();
}

function updateFinanceSelectedList() {
  const list = document.getElementById("finance-selected-list");
  if (!list) return;
  const checkedSymbols = [...document.querySelectorAll("[data-finance-symbol]:checked")].map((input) => input.dataset.financeSymbol);
  const currentOrder = normalizeFinancePreferences(state.finance.preferences).financeWatchlist.map((item) => item.symbol);
  const ordered = [
    ...currentOrder.filter((symbol) => checkedSymbols.includes(symbol)),
    ...checkedSymbols.filter((symbol) => !currentOrder.includes(symbol))
  ];
  list.innerHTML = ordered.length ? ordered.map((symbol) => {
    const asset = FINANCE_ASSET_CATALOG.find((item) => item.symbol === symbol);
    return `
      <div class="finance-selected-row" data-finance-selected="${escapeHtml(symbol)}">
        <span>${escapeHtml(asset?.label || symbol)}</span>
        <div>
          <button type="button" data-finance-move="up" aria-label="Yukarı taşı"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" data-finance-move="down" aria-label="Aşağı taşı"><i class="fa-solid fa-arrow-down"></i></button>
        </div>
      </div>
    `;
  }).join("") : `<p class="finance-muted">Seçili varlık yok.</p>`;
}

function openFinancePreferenceModal() {
  if (!financePreferenceModal) return;
  renderFinancePreferenceModal();
  financePreferenceModal.hidden = false;
  document.body.classList.add("finance-modal-open");
  requestAnimationFrame(() => financePreferenceDialog?.focus());
}

function closeFinancePreferenceModal() {
  if (!financePreferenceModal) return;
  financePreferenceModal.hidden = true;
  document.body.classList.remove("finance-modal-open");
}

async function saveFinancePreferencesFromModal() {
  const checkedSymbols = [...document.querySelectorAll("[data-finance-symbol]:checked")].map((input) => input.dataset.financeSymbol);
  const selectedRows = [...document.querySelectorAll("[data-finance-selected]")].map((row) => row.dataset.financeSelected);
  const orderedSymbols = [...selectedRows.filter((symbol) => checkedSymbols.includes(symbol)), ...checkedSymbols.filter((symbol) => !selectedRows.includes(symbol))];
  const financeWatchlist = orderedSymbols.map((symbol, index) => {
    const asset = FINANCE_ASSET_CATALOG.find((item) => item.symbol === symbol);
    return { symbol, type: asset?.type || "macro", label: asset?.label || symbol, enabled: true, priority: index + 1 };
  });
  const preferences = normalizeFinancePreferences({
    financeWatchlist,
    showFinanceOnHome: financeShowHomeInput?.checked !== false,
    financeRefreshInterval: financeRefreshInterval?.value || "5m",
    riskMode: "safe"
  });
  state.finance.preferences = saveLocalFinancePreferences(preferences);
  if (financePreferenceStatus) financePreferenceStatus.textContent = "Kaydediliyor...";
  try {
    await api("/api/finance/preferences", { method: "PUT", body: JSON.stringify(preferences) });
    if (financePreferenceStatus) financePreferenceStatus.textContent = "Kaydedildi.";
  } catch {
    if (financePreferenceStatus) financePreferenceStatus.textContent = "Yerel olarak kaydedildi; server daha sonra senkronlanır.";
  }
  await loadFinanceRadar({ force: true });
  personalizeArticleScores();
  renderArticles();
  showToast("Ekonomi Radarı tercihleri güncellendi.", "success");
  closeFinancePreferenceModal();
}


/* ============================
   SOURCE FOLLOW CENTER
   ============================ */
function sourceTimeLabel(value) {
  if (!value) return "Henüz yok";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "Henüz yok";
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return new Date(value).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

function sourceStatusText(source) {
  if (!source.enabled) return "Pasif";
  if (source.errorCount > 2) return "Kontrol gerekli";
  return "Aktif";
}

function renderSourceTypeOptions() {
  if (!sourceTypeSelect) return;
  const options = [
    ["auto", "Otomatik algıla"], ["youtube", "YouTube kanalı"], ["rss", "RSS feed"], ["atom", "Atom feed"],
    ["news", "Haber sitesi"], ["blog", "Blog"], ["official", "Resmi duyuru"], ["podcast", "Podcast"], ["manual", "Manuel URL"]
  ];
  sourceTypeSelect.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function renderSourceCategoryOptions() {
  if (!sourceCategorySelect) return;
  sourceCategorySelect.innerHTML = SOURCE_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
}

function sourceCardHtml(source) {
  const icon = sourceTypeIcon(source.type);
  return `
    <article class="source-card source-trust-${escapeHtml(source.trustLevel)}" data-source-id="${escapeHtml(source.id)}">
      <div class="source-card-top">
        <div class="source-logo" aria-hidden="true">${source.logoUrl ? `<img src="${escapeHtml(source.logoUrl)}" alt="" loading="lazy">` : `<i class="${escapeHtml(icon)}"></i>`}</div>
        <div>
          <h4>${escapeHtml(source.title)}</h4>
          <p>${escapeHtml(source.url || "")}</p>
        </div>
      </div>
      <div class="source-badges">
        <span>${escapeHtml(source.category || "Genel")}</span>
        ${source.favorite ? `<span><i class="fa-solid fa-star"></i> Favori</span>` : ""}
      </div>
      <div class="source-card-actions">
        <button type="button" data-source-favorite="${escapeHtml(source.id)}">${source.favorite ? "Favoriden çıkar" : "Favori yap"}</button>
        <button type="button" class="danger" data-source-delete="${escapeHtml(source.id)}">Sil</button>
      </div>
    </article>
  `;
}

function externalContentHtml(item) {
  const content = normalizeExternalContent(item);
  const isVideo = content.contentType === "video" || content.sourceType === "youtube";
  const icon = isVideo ? "fa-circle-play" : "fa-newspaper";
  return `
    <article class="source-content-item">
      <div class="source-content-thumb ${content.thumbnailUrl || content.imageUrl ? "has-image" : ""}">
        ${content.thumbnailUrl || content.imageUrl ? `<img src="${escapeHtml(content.thumbnailUrl || content.imageUrl)}" alt="" loading="lazy">` : `<i class="fa-solid ${icon}"></i>`}
      </div>
      <div class="source-content-body">
        <div class="source-content-meta">
          <span>${escapeHtml(sourceTypeLabel(content.sourceType))}</span>
          <span>${escapeHtml(content.sourceName)}</span>
          <span>${escapeHtml(sourceTimeLabel(content.publishedAt || content.fetchedAt))}</span>
        </div>
        <h4>${escapeHtml(content.title)}</h4>
        <p>${escapeHtml(content.summary || "Bu içerik takip ettiğin kaynaktan geldi.")}</p>
        <div class="source-content-actions">
          <a href="${escapeHtml(content.url)}" target="_blank" rel="noopener noreferrer">${isVideo ? "YouTube’da izle" : "Kaynağı aç"}</a>
          <button type="button" data-source-save-content="${escapeHtml(content.id)}">Kişisel gazeteye ekle</button>
        </div>
      </div>
    </article>
  `;
}

function filteredSourceContents() {
  const filter = state.sources.activeFilter || "all";
  const contents = state.sources.contents.map(normalizeExternalContent);
  if (filter === "youtube") return contents.filter((item) => item.sourceType === "youtube");
  if (filter === "rss") return contents.filter((item) => ["rss", "atom", "news", "blog", "podcast"].includes(item.sourceType));
  if (filter === "official") return contents.filter((item) => item.sourceType === "official" || item.category === "Resmi Duyuru");
  if (filter === "favorites") {
    const favorites = new Set(state.sources.list.filter((source) => source.favorite).map((source) => source.id));
    return contents.filter((item) => favorites.has(item.sourceId));
  }
  return contents;
}

function renderSourceRadar() {
  if (!sourceRadarSummary) return;
  const active = state.sources.list.filter((source) => source.enabled).length;
  const newItems = state.sources.contents.length;
  const lastUpdated = state.sources.summary?.lastUpdated || state.sources.list.map((source) => source.lastFetchedAt).filter(Boolean).sort().at(-1) || "";
  sourceRadarSummary.innerHTML = `
    <div class="source-radar-metrics">
      <span><strong>${active}</strong><small>aktif kaynak</small></span>
      <span><strong>${newItems}</strong><small>yeni içerik</small></span>
      <span><strong>${escapeHtml(sourceTimeLabel(lastUpdated))}</strong><small>son güncelleme</small></span>
    </div>
    <button type="button" id="source-open-page" class="source-open-page">Kaynakları yönet</button>
  `;
}

function renderSourceCenter() {
  renderSourceTypeOptions();
  renderSourceCategoryOptions();
  renderSourceRadar();
  renderSidebarSourceNews();
  if (sourceFilterTabs) {
    sourceFilterTabs.innerHTML = SOURCE_FILTERS.map((filter) => `
      <button type="button" class="${filter.id === state.sources.activeFilter ? "active" : ""}" data-source-filter="${filter.id}">${escapeHtml(filter.label)}</button>
    `).join("");
  }
  if (sourceCardsGrid) {
    sourceCardsGrid.innerHTML = state.sources.list.length
      ? state.sources.list.map(sourceCardHtml).join("")
      : `<div class="source-empty"><i class="fa-solid fa-rss"></i><strong>Henüz kaynak eklemedin.</strong><p>YouTube kanalı, RSS linki veya haber sitesi URL’si yapıştırarak başlayabilirsin.</p></div>`;
  }
  if (sourceContentList) {
    const items = filteredSourceContents();
    sourceContentList.innerHTML = items.length
      ? items.slice(0, 12).map(externalContentHtml).join("")
      : `<div class="source-empty"><i class="fa-regular fa-newspaper"></i><strong>Kaynaklarından yeni içerik yok.</strong><p>Kaynak ekledikçe son içerikler burada ve kişisel gazetende görünecek.</p></div>`;
  }
}

async function loadUserSources({ force = false } = {}) {
  if (state.sources.loading && !force) return;
  state.sources.loading = true;
  renderSourceRadar();
  renderSidebarSourceNews();
  try {
    const payload = await api("/api/sources");
    state.sources.list = saveLocalUserSources(payload.sources || state.sources.list);
    const fetched = await api(`/api/sources/fetch?type=${encodeURIComponent(state.sources.activeFilter === "youtube" ? "youtube" : "all")}`);
    state.sources.list = saveLocalUserSources(fetched.sources || state.sources.list);
    state.sources.contents = Array.isArray(fetched.contents) ? fetched.contents.map(normalizeExternalContent) : [];
    state.sources.summary = fetched.summary || state.sources.summary;
    state.sources.error = "";
  } catch (error) {
    state.sources.error = error.message || "Kaynaklar yüklenemedi.";
    state.sources.list = normalizeUserSources(loadLocalUserSources());
    state.sources.contents = [];
  } finally {
    state.sources.loading = false;
    renderSourceCenter();
  }
}

function openSourcePreviewModal(preview = state.sources.preview) {
  if (!sourcePreviewModal || !sourcePreviewBody || !preview) return;
  const source = preview.source || {};
  const items = preview.items || [];
  sourcePreviewBody.innerHTML = `
    <div class="source-preview-head">
      <div class="source-logo"><i class="${escapeHtml(sourceTypeIcon(source.type))}"></i></div>
      <div>
        <p class="kicker">${escapeHtml(sourceTypeLabel(source.type))} önizleme</p>
        <h3>${escapeHtml(source.title || "Kaynak önizleme")}</h3>
        <p>${escapeHtml(source.description || preview.warning || "Son içerikler kontrol edildi.")}</p>
      </div>
    </div>
    ${preview.warning ? `<div class="source-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(preview.warning)}</div>` : ""}
    <div class="source-preview-list">
      ${items.length ? items.slice(0, 5).map(externalContentHtml).join("") : `<p class="empty-state inline">Son içerik bulunamadı.</p>`}
    </div>
  `;
  sourcePreviewModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeSourcePreviewModal() {
  if (!sourcePreviewModal) return;
  sourcePreviewModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function autoDetectSourceInfo(url) {
  const lowercaseUrl = url.toLowerCase();
  let type = "auto";
  let category = "Genel";

  if (lowercaseUrl.includes("youtube.com") || lowercaseUrl.includes("youtu.be")) {
    type = "youtube";
  } else if (lowercaseUrl.includes(".rss") || lowercaseUrl.includes(".xml") || lowercaseUrl.includes("/feed")) {
    type = "rss";
  } else {
    type = "news";
  }

  if (lowercaseUrl.includes("/spor") || lowercaseUrl.includes("fanatik") || lowercaseUrl.includes("fotomac") || lowercaseUrl.includes("ntvspor")) {
    category = "Spor";
  } else if (lowercaseUrl.includes("/ekonomi") || lowercaseUrl.includes("bloomberg") || lowercaseUrl.includes("finans") || lowercaseUrl.includes("uzmanpara")) {
    category = "Ekonomi";
  } else if (lowercaseUrl.includes("/teknoloji") || lowercaseUrl.includes("shiftdelete") || lowercaseUrl.includes("donanimhaber") || lowercaseUrl.includes("webtekno")) {
    category = "Teknoloji";
  } else if (lowercaseUrl.includes("/dunya") || lowercaseUrl.includes("/world")) {
    category = "Dünya";
  } else if (lowercaseUrl.includes("/saglik")) {
    category = "Sağlık";
  } else if (lowercaseUrl.includes("hurriyet.com.tr")) {
    if (lowercaseUrl.includes("/gundem")) category = "Gündem";
    else if (lowercaseUrl.includes("/kelebek")) category = "Kültür-Sanat";
  } else if (lowercaseUrl.includes("/gundem")) {
    category = "Gündem";
  }

  return { type, category };
}

function readSourceFormPayload() {
  const url = sourceUrlInput?.value?.trim() || "";
  const auto = autoDetectSourceInfo(url);
  return {
    url,
    type: sourceTypeSelect?.value || auto.type,
    category: sourceCategorySelect?.value || auto.category,
    tags: []
  };
}

async function previewSourceFromForm() {
  const payload = readSourceFormPayload();
  if (!payload.url) {
    if (sourceStatus) sourceStatus.textContent = "Önce bir YouTube/RSS/site URL’si gir.";
    return;
  }
  if (sourceStatus) sourceStatus.textContent = "Kaynak güvenli şekilde kontrol ediliyor...";
  try {
    const preview = await api("/api/sources/preview", { method: "POST", body: JSON.stringify(payload) });
    state.sources.preview = preview;
    if (sourceStatus) sourceStatus.textContent = preview.warning || "Önizleme hazır.";
    openSourcePreviewModal(preview);
  } catch (error) {
    if (sourceStatus) sourceStatus.textContent = error.message || "Kaynak önizlenemedi.";
    showToast(error.message || "Kaynak önizlenemedi.", "error");
  }
}

async function addSourceFromForm() {
  const payload = readSourceFormPayload();
  if (!payload.url) {
    if (sourceStatus) sourceStatus.textContent = "Kaynak eklemek için URL gerekli.";
    return;
  }
  if (sourceStatus) sourceStatus.textContent = "Kaynak ekleniyor...";
  try {
    const result = await api("/api/sources", { method: "POST", body: JSON.stringify(payload) });
    state.sources.list = saveLocalUserSources([...state.sources.list, result.source]);
    sourceUrlInput.value = "";
    if (sourceTagsInput) sourceTagsInput.value = "";
    closeSourcePreviewModal();
    await loadUserSources({ force: true });
    personalizeArticleScores();
    renderArticles();
    showToast("Kaynak Takip Merkezi güncellendi.", "success");
    if (sourceStatus) sourceStatus.textContent = result.warning || "Kaynak eklendi.";
  } catch (error) {
    if (sourceStatus) sourceStatus.textContent = error.message || "Kaynak eklenemedi.";
    showToast(error.message || "Kaynak eklenemedi.", "error");
  }
}

async function updateSource(sourceId, patch) {
  const source = state.sources.list.find((item) => item.id === sourceId);
  if (!source) return;
  try {
    const result = await api(`/api/sources/${encodeURIComponent(sourceId)}`, { method: "PUT", body: JSON.stringify({ ...source, ...patch }) });
    state.sources.list = saveLocalUserSources(state.sources.list.map((item) => item.id === sourceId ? result.source : item));
    await loadUserSources({ force: true });
    personalizeArticleScores();
    renderArticles();
  } catch (error) {
    showToast(error.message || "Kaynak güncellenemedi.", "error");
  }
}

async function deleteSource(sourceId) {
  try {
    await api(`/api/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
    state.sources.list = saveLocalUserSources(state.sources.list.filter((item) => item.id !== sourceId));
    state.sources.contents = state.sources.contents.filter((item) => item.sourceId !== sourceId);
    renderSourceCenter();
    personalizeArticleScores();
    renderArticles();
    showToast("Kaynak silindi.", "success");
  } catch (error) {
    showToast(error.message || "Kaynak silinemedi.", "error");
  }
}

function saveExternalContentToNewspaper(contentId) {
  const item = state.sources.contents.find((entry) => String(entry.id) === String(contentId));
  if (!item) return;
  const article = {
    id: `external_${item.id}`,
    title: item.title,
    summary: item.summary || `${item.sourceName} kaynağından gelen içerik.`,
    fullText: item.summary || "",
    source: item.sourceName,
    sourceName: item.sourceName,
    sourceUrl: item.url,
    imageUrl: item.imageUrl || item.thumbnailUrl || "",
    category: item.category || "Genel",
    subcategory: item.sourceType === "youtube" ? "Video" : "Kişisel Kaynak",
    continent: "global",
    publishedAt: item.publishedAt || item.fetchedAt,
    readTime: item.duration || `${item.readTime || 3} dk`,
    status: "Okunmadı",
    bookmarked: true,
    isExternalSource: true
  };
  if (!state.data.articles.some((existing) => existing.id === article.id || existing.sourceUrl === article.sourceUrl)) {
    state.data.articles.unshift(article);
  }
  state.newspaperArticles = [...new Set([...state.newspaperArticles, String(article.id)])];
  personalizeArticleScores();
  renderArticles();
  showToast("İçerik kişisel gazetene eklendi.", "success");
}


/* ============================
   PERSONAL NEWS CENTER TABS
   ============================ */
const PERSONAL_FEED_TABS = {
  today: {
    label: "Bugün Senin İçin",
    note: "Okuma alışkanlıkların ve ilgi alanlarınla şekillenen günlük özel akışın."
  },
  interests: {
    label: "İlgi Alanlarına Göre",
    note: "Sadece belirlediğin ilgi alanlarına giren başlıklar listelenir."
  }
};

function updatePersonalFeedTabs() {
  if (!personalTabs) return;
  personalTabs.querySelectorAll("[data-personal-tab]").forEach((button) => {
    const active = button.dataset.personalTab === state.personalFeedTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (personalTabNote) {
    personalTabNote.textContent = PERSONAL_FEED_TABS[state.personalFeedTab]?.note || PERSONAL_FEED_TABS.today.note;
  }
}

function applyPersonalFeedTab(articles) {
  const preferences = normalizePreferences(state.data.preferences);
  const interests = new Set((preferences.interests || []).map(normalizeCategoryName));
  const tab = state.personalFeedTab || "today";
  const list = [...articles];

  if (tab === "interests") {
    return list.sort((a, b) => {
      const aInterest = interests.has(inferArticleCategory(a)) ? 1 : 0;
      const bInterest = interests.has(inferArticleCategory(b)) ? 1 : 0;
      return bInterest - aInterest
        || articleInterestScore(b) - articleInterestScore(a)
        || getRecencyScore(b) - getRecencyScore(a);
    });
  }

  // today logic
  return list.sort((a, b) => {
    const aHistory = (a.status === "Okundu" ? 5 : 0) + (a.bookmarked ? 4 : 0);
    const bHistory = (b.status === "Okundu" ? 5 : 0) + (b.bookmarked ? 4 : 0);
    return bHistory - aHistory || articleInterestScore(b) - articleInterestScore(a) || getRecencyScore(b) - getRecencyScore(a);
  });
}

function renderPersonalEmptyState(hasAnyArticles = false) {
  if (!emptyState) return;
  const hasActiveFilters = hasAnyArticles && getActiveFilterCount() > 0;
  emptyState.innerHTML = `
    <strong>${hasActiveFilters ? "Seçtiğiniz filtrelere uygun haber bulunamadı." : "Henüz yeterli okuma sinyali yok."}</strong>
    <span>${hasAnyArticles
      ? "Bölge filtrelerinden bazılarını kaldırmayı, kategoriyi Tümü yapmayı veya Filtreleri Temizle ile yeniden başlamayı deneyin."
      : "Haberleri okudukça sana özel akışın daha akıllı hale gelecek."}</span>
    <button type="button" id="start-reading-empty" data-start-reading>Okumaya Başla</button>
  `;
}

function openRecommendationReasonModal(articleId, trigger = null) {
  const article = findArticleForAction(articleId);
  if (!article || !recommendationReasonModal) return;
  if (recommendationReasonTitle) recommendationReasonTitle.textContent = article.title || "Bu haber sana neden gösteriliyor?";
  if (recommendationReasonText) recommendationReasonText.textContent = buildRecommendationReasonText(article);
  if (recommendationReasonFactors) recommendationReasonFactors.innerHTML = recommendationFactorHtml(article);
  recommendationReasonModal._lastTrigger = trigger || document.activeElement;
  recommendationReasonModal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => recommendationReasonDialog?.focus());
}

function closeRecommendationReasonModal() {
  if (!recommendationReasonModal) return;
  recommendationReasonModal.hidden = true;
  document.body.classList.remove("modal-open");
  const trigger = recommendationReasonModal._lastTrigger;
  if (trigger && typeof trigger.focus === "function") trigger.focus();
}

/* ============================
   LIVE NEWS (now routed to HeroSlider)
   ============================ */
function _prepareHeroSrc(src) {
  return src.map(a => {
    const sims = getSimilarArticles(a);
    if (!sims.length) return a;
    return {
      ...a,
      _similarSources: sims.map(s => s.sourceName || s.source).filter(Boolean)
    };
  });
}

function renderLiveNews() {
  const slider = _getHeroSlider();
  if (!slider) return;
  const src = state.data.articles.length ? state.data.articles : state.data.last24;
  slider.refresh(_prepareHeroSrc(src));
}

function startLiveNews() {
  const slider = _getHeroSlider();
  if (!slider) return;
  const src = state.data.articles.length ? state.data.articles : state.data.last24;
  slider.init(_prepareHeroSrc(src));
}

/* ========================================================
   SOURCE LOGOS BAR — "Bu Haber Başka Kaynaklarda"
   ======================================================== */
function renderSourceLogosBar() {
  const bar = document.getElementById("source-logos-list");
  if (!bar) return;
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];

  // Collect unique sources with favicon
  const seen = new Set();
  const sources = [];
  for (const a of articles) {
    const name = a.sourceName || a.source;
    const url = a.sourceUrl || a.url || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    let favicon = "";
    try {
      const domain = new URL(url).hostname;
      favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch { /* no url */ }
    sources.push({ name, url, favicon });
    if (sources.length >= 10) break;
  }

  if (!sources.length) {
    const section = document.getElementById("source-logos-bar");
    if (section) section.hidden = true;
    return;
  }

  const section = document.getElementById("source-logos-bar");
  if (section) section.hidden = false;

  bar.innerHTML = sources.map(s => `
    <a class="source-logo-chip" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.name)}">
      ${s.favicon
        ? `<img src="${escapeHtml(s.favicon)}" alt="${escapeHtml(s.name)}" loading="lazy" onerror="this.style.display='none'">`
        : `<span class="source-logo-initials">${escapeHtml(s.name.substring(0,2).toUpperCase())}</span>`
      }
      <span>${escapeHtml(s.name)}</span>
    </a>
  `).join("");
}

/* ========================================================
   SANA ÖZEL HABERLER GRID
   ======================================================== */
function renderSanaOzelGrid() {
  const grid = document.getElementById("sana-ozel-grid");
  if (!grid) return;
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  if (!articles.length) { grid.innerHTML = ""; return; }

  personalizeArticleScores(articles);
  const personal = [...articles]
    .sort((a, b) => articleInterestScore(b) - articleInterestScore(a))
    .slice(0, 4);

  grid.innerHTML = personal.map(a => {
    const score = articleInterestScore(a);
    const ageMs = Date.now() - new Date(a.publishedAt || a.date || 0);
    const ageH = ageMs / 3.6e6;
    const timeLabel = ageH <= 1 ? "Az önce" : ageH <= 24 ? `${Math.round(ageH)} saat önce` : (a.date || "");
    const readTime = a.readTime || "3 dk";
    return `
      <div class="sana-ozel-card" data-action="detail" data-id="${escapeHtml(String(a.id))}" role="button" tabindex="0">
        <div class="sana-ozel-img-wrap">
          ${a.imageUrl
            ? `<img src="${escapeHtml(a.imageUrl)}" alt="" loading="lazy">`
            : `<div class="sana-ozel-img-placeholder"><i class="fa-solid fa-newspaper"></i></div>`
          }
          ${score >= 75 ? `<span class="sana-ozel-badge">Sana Özel</span>` : ""}
        </div>
        <div class="sana-ozel-card-body">
          <div class="sana-ozel-meta">
            <span class="sana-ozel-cat">${escapeHtml(a.category || "Gündem")}</span>
            <span class="sana-ozel-time">${escapeHtml(readTime)}</span>
          </div>
          <div class="sana-ozel-title">${escapeHtml(a.title || "")}</div>
          <div class="sana-ozel-source">${escapeHtml(a.sourceName || a.source || "")} · ${escapeHtml(timeLabel)}</div>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", () => handleArticleAction("detail", findArticleForAction(el.dataset.id)));
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") handleArticleAction("detail", findArticleForAction(el.dataset.id)); });
  });
}

function headlineCandidateScore(article) {
  const interest = articleInterestScore(article);
  const recency = getRecencyScore(article);
  const popularity = articlePopularity(article);
  const readDepth = parseReadTimeMinutes(article.readTime || article.readingTime || "3 dk");
  return (interest * 3) + (recency * 1.4) + Math.min(25, popularity) + Math.min(10, readDepth);
}

function selectTodayHeadlineArticle(articles = []) {
  const list = (Array.isArray(articles) ? articles : []).filter(Boolean);
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const scoreDelta = headlineCandidateScore(b) - headlineCandidateScore(a);
    if (scoreDelta) return scoreDelta;
    return new Date(b.publishedAt || b.date || 0) - new Date(a.publishedAt || a.date || 0);
  })[0];
}

function editorialPickArticles(articles = [], headline = null) {
  const headlineId = headline ? String(headline.id || headline.title || "") : "";
  const base = (Array.isArray(articles) ? articles : [])
    .filter(Boolean)
    .filter((article) => String(article.id || article.title || "") !== headlineId);

  const byPersonal = [...base].sort((a, b) => headlineCandidateScore(b) - headlineCandidateScore(a));
  const byEditor = [...base].sort((a, b) => {
    const aDepth = parseReadTimeMinutes(a.readTime || "3 dk") + Math.min(8, (a.summary || a.description || "").length / 180);
    const bDepth = parseReadTimeMinutes(b.readTime || "3 dk") + Math.min(8, (b.summary || b.description || "").length / 180);
    return (articlePopularity(b) + bDepth) - (articlePopularity(a) + aDepth);
  });
  const quick = [...base]
    .filter((article) => parseReadTimeMinutes(article.readTime || "3 dk") <= 3)
    .sort((a, b) => articleInterestScore(b) - articleInterestScore(a) || getRecencyScore(b) - getRecencyScore(a));
  const deep = [...base]
    .filter((article) => parseReadTimeMinutes(article.readTime || "3 dk") >= 4)
    .sort((a, b) => parseReadTimeMinutes(b.readTime || "3 dk") - parseReadTimeMinutes(a.readTime || "3 dk") || articleInterestScore(b) - articleInterestScore(a));

  const slots = [
    { key: "personal", label: "Bugün Senin İçin Öne Çıkanlar", icon: "fa-sparkles", article: byPersonal[0] },
    { key: "editor", label: "Editör Seçimi", icon: "fa-feather-pointed", article: byEditor[0] || byPersonal[1] },
    { key: "quick", label: "Hızlı Okuma", icon: "fa-bolt", article: quick[0] || byPersonal[2] },
    { key: "deep", label: "Derinlemesine Oku", icon: "fa-book-open-reader", article: deep[0] || byPersonal[3] }
  ];

  const seen = new Set();
  return slots.map((slot) => {
    let article = slot.article;
    if (article) {
      const id = String(article.id || article.title || slot.key);
      if (seen.has(id)) {
        article = byPersonal.find((candidate) => {
          const candidateId = String(candidate.id || candidate.title || "");
          return candidateId && !seen.has(candidateId);
        }) || null;
      }
    }
    if (article) seen.add(String(article.id || article.title || slot.key));
    return { ...slot, article };
  }).filter((slot) => slot.article);
}

function renderEditorialMiniCard(slot) {
  const article = slot.article;
  const category = inferArticleCategory(article);
  const score = articleInterestScore(article);
  return `
    <article class="editorial-mini-card" data-editorial-slot="${escapeHtml(slot.key)}">
      <div class="editorial-mini-topline">
        <span><i class="fa-solid ${slot.icon}" aria-hidden="true"></i> ${escapeHtml(slot.label)}</span>
        <em>%${score}</em>
      </div>
      <h4><button type="button" data-action="detail" data-id="${escapeHtml(String(article.id))}">${escapeHtml(article.title || "Başlıksız haber")}</button></h4>
      <div class="editorial-mini-meta">
        <span>${escapeHtml(category)}</span>
        <span>${escapeHtml(article.source || "Kaynak yok")}</span>
        <span>${escapeHtml(article.readTime || "3 dk")}</span>
      </div>
    </article>
  `;
}

function renderTodayHeadline(articles = []) {
  if (!todayHeadlineSection) return;
  const list = Array.isArray(articles) ? articles.filter(Boolean) : [];
  const headline = selectTodayHeadlineArticle(list);

  if (!headline) {
    todayHeadlineSection.innerHTML = `
      <div class="today-headline-empty">
        <p class="kicker">Bugünün Manşeti</p>
        <h2>Henüz manşet oluşturulamadı.</h2>
        <p>Haberler yüklendiğinde kişisel gazetenin ana manşeti burada görünecek.</p>
        <button type="button" data-start-reading>Okumaya Başla</button>
      </div>
    `;
    return;
  }

  const category = inferArticleCategory(headline);
  const subcategory = inferArticleSubcategory({ ...headline, category });
  const color = categoryColor(category);
  const score = articleInterestScore(headline);
  const summary = trimSummary(headline.summary || headline.aiSummary || headline.description || "Bu haber için kısa özet bulunamadı.", 220);
  const source = headline.source || "Kaynak yok";
  const readTime = headline.readTime || "3 dk";
  const miniCards = editorialPickArticles(list, headline).map(renderEditorialMiniCard).join("");

  todayHeadlineSection.innerHTML = `
    <div class="today-headline-paper" style="--cat-color:${color}">
      <div class="today-headline-label-row">
        <span class="edition-label"><i class="fa-regular fa-newspaper" aria-hidden="true"></i> Bugünün Manşeti</span>
        <span class="edition-rule"></span>
        <span class="edition-date">Kişisel gazete seçkisi</span>
      </div>
      <article class="main-headline-card">
        <div class="headline-visual-wrap">
          ${headline.imageUrl
      ? `<img class="headline-visual" src="${escapeHtml(headline.imageUrl)}" alt="" loading="lazy">`
      : `<div class="headline-visual headline-gradient" aria-hidden="true"><i class="fa-solid ${articleCategoryIcon(category)}"></i><span>${escapeHtml(category)}</span></div>`}
        </div>
        <div class="headline-content">
          <div class="headline-meta-row">
            <span class="headline-category">${escapeHtml(category)}</span>
            <span>${escapeHtml(subcategory)}</span>
            <span>${escapeHtml(source)}</span>
            <span>${escapeHtml(readTime)}</span>
            <strong class="headline-score">İlgi %${score}</strong>
          </div>
          <h2>${escapeHtml(headline.title || "Başlıksız haber")}</h2>
          <p>${escapeHtml(summary)}</p>
          <div class="headline-reason-note">
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            <span>${escapeHtml(buildRecommendationReasonText(headline))}</span>
          </div>
          <div class="headline-actions">
            <button type="button" class="headline-save-btn" data-action="bookmark" data-id="${escapeHtml(String(headline.id))}">
              <i class="${headline.bookmarked ? "fa-solid" : "fa-regular"} fa-bookmark" aria-hidden="true"></i> ${headline.bookmarked ? "Kaydedildi" : "Kaydet"}
            </button>
          </div>
        </div>
      </article>
      ${miniCards ? `<div class="editorial-strip" aria-label="Editoryal haber bölümleri">${miniCards}</div>` : ""}
    </div>
  `;
}

/* ============================
   ARTICLE RENDERING
   ============================ */
function renderFilterSummary(matchCount = 0) {
  if (!filterSummaryCard) return;
  const filters = currentSearchFilters();
  const selectedRegions = normalizeSelectedRegions(filters.regions || filters.continent || "global");
  const categoryText = categoryLabel(filters.category || "all");
  const subcategoryText = filters.subcategory && filters.subcategory !== "Tümü" ? filters.subcategory : "Tümü";
  const regionText = selectedRegions.map(regionLabel).join(", ") || "Global";
  const sortText = SORT_FILTER_LABELS[filters.sort] || filters.sort || "İlgi puanı";
  const detailParts = [
    `Alt: ${subcategoryText}`,
    filters.source !== "Tümü" ? `Kaynak: ${filters.source}` : "",
    filters.status !== "Tümü" ? `Okuma: ${filters.status}` : "",
    filters.date !== "Tümü" ? `Tarih: ${filters.date}` : ""
  ].filter(Boolean);

  if (filterSummaryCount) {
    filterSummaryCount.textContent = `${Number(matchCount || 0)} haber eşleşti`;
  }
  if (filterSummaryLine) {
    filterSummaryLine.textContent = `${categoryText} · ${regionText} · ${sortText}`;
  }
  if (filterSummaryExtra) {
    filterSummaryExtra.textContent = detailParts.join(" · ") || "Fallback kapalı";
  }
}

function renderArticles() {
  renderActiveFilterChips();
  const filters = currentSearchFilters();
  const isFiltered = filters.query || categoryValue(filters.category) !== "all" || filters.subcategory !== "Tümü" || hasRegionFilter(filters.regions)
    || filters.source !== "Tümü" || filters.status !== "Tümü" || filters.date !== "Tümü";

  /* Hero slider stays visible — no hide needed */
  updatePersonalFeedTabs();
  const feedHeading = document.getElementById("feed-heading");
  if (feedHeading) feedHeading.textContent = state.activePage === "foryou" ? "Kişisel Haber Akışın" : "Ana Haber Akışı";
  renderPersonalEmptyState(Boolean(state.data.articles?.length));

  // Category nav
  renderCategoryNav(state.data.articles);

  const usePageCache = !isFiltered && !state.viewByCategory;
  const cacheContext = currentNewsCacheContext();
  const cacheKey = buildNewsCacheKey(cacheContext);
  const cacheSignature = currentNewsCacheSignature();
  const cachedPage = usePageCache ? readNewsCache(cacheKey, cacheSignature) : null;
  const expectedCachedCount = Math.min(state.pageSize, state.data.articles?.length || 0);
  const canUseCachedPage = cachedPage
    && (state.currentPage > 1 || !expectedCachedCount || cachedPage.articles.length >= expectedCachedCount);

  if (canUseCachedPage) {
    personalizeArticleScores(cachedPage.articles);
    renderFilterSummary(Number(cachedPage.totalCount || cachedPage.articles.length));
    renderTodayHeadline(cachedPage.articles.length ? cachedPage.articles : state.data.articles);
    recordImpressions(cachedPage.articles);
    const totalPages = Math.max(1, Math.ceil(Number(cachedPage.totalCount || cachedPage.articles.length) / state.pageSize));
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
    recommendedGrid.innerHTML = cachedPage.articles.map((article) => renderArticleCardHtml(article)).join("");
    emptyState.style.display = cachedPage.totalCount ? "none" : "block";
    renderPagination(Number(cachedPage.totalCount || cachedPage.articles.length), totalPages);
    renderBookmarks();
    renderReadingInsights();
    renderPersonalizedBanner();
    renderHighInterestPanel();
    return;
  }

  personalizeArticleScores(state.data.articles);
  const strictFiltered = applyNewsFilters(state.data.articles, filters).filter((article) => articleMatches(article, filters));
  const allFiltered = applyPersonalFeedTab(sortArticles(strictFiltered));
  renderFilterSummary(allFiltered.length);
  renderTodayHeadline(allFiltered);

  // Category view
  if (state.viewByCategory && !isFiltered) {
    renderArticlesByCategory(allFiltered);
    emptyState.style.display = "none";
    articlePagination.innerHTML = "";
    renderHighInterestPanel();
    return;
  }

  const gridArticles = allFiltered;
  const totalPages = Math.max(1, Math.ceil(gridArticles.length / state.pageSize));
  state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
  const pageStart = (state.currentPage - 1) * state.pageSize;
  const pageArticles = gridArticles.slice(pageStart, pageStart + state.pageSize);

  recordImpressions(pageArticles);
  renderArticlesChunked(pageArticles, recommendedGrid, renderArticleCardHtml);
  emptyState.style.display = allFiltered.length ? "none" : "block";
  renderPagination(gridArticles.length, totalPages);
  renderBookmarks();
  renderReadingInsights();
  renderPersonalizedBanner();
  renderHighInterestPanel();

  if (usePageCache) {
    const finalContext = currentNewsCacheContext();
    writeNewsCache(buildNewsCacheKey(finalContext), pageArticles, {
      signature: currentNewsCacheSignature(),
      totalCount: gridArticles.length
    });
  }
}

function renderArticlesByCategory(articles) {
  const preferences = normalizePreferences(state.data.preferences);
  const interests = preferences.interests;

  const grouped = {};
  for (const article of articles) {
    (grouped[article.category] = grouped[article.category] || []).push(article);
  }

  const orderedCategories = Object.keys(grouped).sort((a, b) => {
    const aScore = interests.includes(a) ? 1 : 0;
    const bScore = interests.includes(b) ? 1 : 0;
    return bScore - aScore || grouped[b].length - grouped[a].length;
  });

  if (!orderedCategories.length) {
    recommendedGrid.innerHTML = `<p class="empty-state inline">Haber bulunamadı.</p>`;
    return;
  }

  recommendedGrid.innerHTML = orderedCategories.map((category) => {
    const catArticles = grouped[category].slice(0, 3);
    const color = categoryColor(category);
    const isInterest = interests.includes(category);
    return `
      <div class="category-section" style="--cat-color: ${color}; grid-column: 1 / -1">
        <div class="category-section-header">
          <span class="cat-section-dot"></span>
          <h4>${escapeHtml(category)}${isInterest ? ' <i class="fa-solid fa-star cat-interest-star"></i>' : ""}</h4>
          <button class="cat-more-btn" data-cat-more="${escapeHtml(category)}">Tümünü gör →</button>
        </div>
        <div class="cat-articles-row">
          ${catArticles.map((a) => renderArticleCardHtml(a)).join("")}
        </div>
      </div>
    `;
  }).join("");

  renderBookmarks();
  renderReadingInsights();
  renderPersonalizedBanner();
}

function renderPagination(totalArticles, totalPages) {
  if (!articlePagination) return;
  if (!totalArticles) { articlePagination.innerHTML = ""; return; }

  const buttons = Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => `
    <button class="${page === state.currentPage ? "active" : ""}" data-page-number="${page}" aria-label="${page}. haber sayfası">${page}</button>
  `).join("");

  const start = (state.currentPage - 1) * state.pageSize + 1;
  const end = Math.min(state.currentPage * state.pageSize, totalArticles);
  articlePagination.innerHTML = `
    <span>${start}-${end} / ${totalArticles} haber</span>
    <div>
      <button data-page-number="${Math.max(1, state.currentPage - 1)}" ${state.currentPage === 1 ? "disabled" : ""}>Önceki</button>
      ${buttons}
      <button data-page-number="${Math.min(totalPages, state.currentPage + 1)}" ${state.currentPage === totalPages ? "disabled" : ""}>Sonraki</button>
    </div>
  `;
}

function renderBookmarks() {
  const bookmarks = state.data.articles.filter((a) => a.bookmarked);
  bookmarkList.innerHTML = bookmarks.map((article) => `
    <article class="bookmark-item">
      <strong>${escapeHtml(article.title)}</strong>
      <span>${escapeHtml(article.category)} / ${escapeHtml(inferArticleSubcategory(article))} · ${escapeHtml(article.source || "")} · ${escapeHtml(article.status)}</span>
    </article>
  `).join("") || `<p class="empty-state inline">Henüz kaydedilmiş haber yok.</p>`;
}

/* ============================
   POPULAR TOPICS (headlines sidebar)
   ============================ */
function getPopularTopics() {
  const significantWords = (value) => normalizeText(value)
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["haber", "son", "yeni", "icin", "için", "olan", "gore", "göre", "sonra", "once", "önce"].includes(w));

  const sim = (left, right) => {
    const ls = new Set(significantWords(left));
    const rs = new Set(significantWords(right));
    if (!ls.size || !rs.size) return 0;
    const inter = [...ls].filter((w) => rs.has(w)).length;
    return inter / new Set([...ls, ...rs]).size;
  };

  const groups = [];
  for (const article of sortArticles(state.data.articles)) {
    const text = `${article.title} ${article.summary || ""}`;
    let group = groups.find((g) => sim(g.text, text) >= 0.28);
    if (!group) { group = { text, representative: article, articles: [], sources: new Set(), score: 0 }; groups.push(group); }
    group.articles.push(article);
    if (article.source) group.sources.add(article.source);
    group.score += Number(article.relevance || 0) + (article.dateRange === "Son 24 saat" ? 8 : 0);
  }

  return groups
    .filter((g) => g.articles.length > 1 || g.sources.size > 1)
    .sort((a, b) => b.sources.size - a.sources.size || b.articles.length - a.articles.length || b.score - a.score)
    .slice(0, 5)
    .map((g, i) => ({ day: String(i + 1), month: "Sıra", id: g.representative.id, title: g.representative.title }));
}

/* ============================
   ACTIVE FILTER CHIPS (Priority 7)
   ============================ */
const SORT_FILTER_LABELS = {
  relevance: "İlgi puanı",
  date: "Yayın tarihi",
  popularity: "Popülerlik"
};

const FILTER_CHIP_LABELS = {
  category: (v) => categoryValue(v) !== "all" ? `Kategori: ${categoryLabel(v)}` : null,
  subcategory: (v) => v !== "Tümü" ? `Alt Kategori: ${v}` : null,
  continent: (v) => regionValue(v) !== "global" ? `Bölge: ${regionLabel(v)}` : null,
  source: (v) => v !== "Tümü" ? `Kaynak: ${v}` : null,
  status: (v) => v !== "Tümü" ? `Okuma: ${v || "Tümü"}` : null,
  date: (v) => v !== "Tümü" ? `Tarih: ${v}` : null,
  sort: (v) => v !== "relevance" ? `Sıralama: ${SORT_FILTER_LABELS[v] || v || "İlgi puanı"}` : null,
  search: (v) => v ? `Arama: "${v}"` : null
};

function getActiveFilterCount() {
  const filters = currentSearchFilters();
  const baseCount = [
    filters.query,
    categoryValue(filters.category) !== "all",
    filters.subcategory !== "Tümü",
    filters.source !== "Tümü",
    filters.status !== "Tümü",
    filters.date !== "Tümü",
    filters.sort !== "relevance"
  ].filter(Boolean).length;
  const regionCount = hasRegionFilter(filters.regions || filters.continent)
    ? normalizeSelectedRegions(filters.regions || filters.continent).filter((region) => region !== "global").length
    : 0;
  return baseCount + regionCount;
}

function updateFilterToggleState() {
  if (!filterToggleButton) return;
  const isOpen = Boolean(filterPopover && !filterPopover.hidden);
  filterToggleButton.setAttribute("aria-expanded", String(isOpen));
  const count = getActiveFilterCount();
  if (filterActiveCount) {
    filterActiveCount.textContent = String(count);
    filterActiveCount.hidden = count === 0;
  }
}

function setFilterPopoverOpen(open) {
  if (!filterPopover || !filterToggleButton) return;
  filterPopover.hidden = !open;
  updateFilterToggleState();
}

function renderActiveFilterChips() {
  const container = document.getElementById("active-filter-chips");
  if (!container) return;
  const filters = currentSearchFilters();
  const chips = [];
  const push = (key, value, clear) => {
    const label = FILTER_CHIP_LABELS[key]?.(value);
    if (label) chips.push({ label, clear });
  };
  push("search", filters.query || "", () => { if (searchInput) { searchInput.value = ""; } });
  push("category", filters.category || "all", () => { if (categoryFilter) categoryFilter.value = "all"; updateSubcategoryOptions(); });
  push("subcategory", filters.subcategory || "Tümü", () => { if (subcategoryFilter) subcategoryFilter.value = "Tümü"; });
  filters.regions.filter((region) => region !== "global").forEach((region) => {
    push("continent", region, () => {
      const next = currentSelectedRegions().filter((item) => item !== region);
      setSelectedRegions(next.length ? next : ["global"], { render: false });
    });
  });
  push("source", filters.source || "Tümü", () => { if (sourceFilter) sourceFilter.value = "Tümü"; });
  push("status", filters.status || "Tümü", () => { if (statusFilter) statusFilter.value = "Tümü"; });
  push("date", filters.date || "Tümü", () => { if (dateFilter) dateFilter.value = "Tümü"; });
  push("sort", filters.sort || "relevance", () => { if (sortFilter) sortFilter.value = "relevance"; });

  container.hidden = chips.length === 0;
  container.innerHTML = chips.map((chip, i) => `
    <button class="filter-chip" data-chip-index="${i}" type="button" title="Bu filtreyi kaldır">
      <span>${escapeHtml(chip.label)}</span> <i class="fa-solid fa-xmark" aria-hidden="true"></i>
    </button>
  `).join("") + (getActiveFilterCount() > 1
      ? `<button class="filter-chip filter-chip-clear" id="clear-all-chips" type="button">Tümünü Temizle</button>`
      : "");
  container._chipActions = chips.map((c) => c.clear);
  updateFilterToggleState();
}

/* ============================
   SIMILAR NEWS SYSTEM (Priority 11)
   ============================ */
let similarGroupsCache = { sig: "", groups: [] };

function computeSimilarGroups() {
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const sig = articles.map((a) => a.id || a.title).join("|");
  if (similarGroupsCache.sig === sig) return similarGroupsCache.groups;
  const groups = computeSimilarGroupsFrom(articles);
  similarGroupsCache = { sig, groups };
  return groups;
}

function getSimilarArticles(article) {
  return getSimilarArticlesFor(article, computeSimilarGroups());
}

function openSimilarNewsModal(articleId) {
  const article = state.data.articles.find((a) => String(a.id) === String(articleId));
  if (!article) return;
  const similar = getSimilarArticles(article);
  const modal = document.getElementById("similar-news-modal");
  const title = document.getElementById("similar-news-title");
  const list = document.getElementById("similar-news-list");
  if (!modal || !list) return;
  if (title) title.textContent = similar.length
    ? `"${article.title.slice(0, 60)}…" ile benzer ${similar.length} haber`
    : `Benzer haber bulunamadı`;
  list.innerHTML = similar.length
    ? similar.map((a) => `
        <article class="similar-news-item">
          <div class="similar-news-meta">
            <span class="tag" style="--cat-color:${categoryColor(a.category)}">${escapeHtml(a.category)}</span>
            <span>${escapeHtml(a.source || "")}</span>
            <span>${escapeHtml(a.date || "")}</span>
          </div>
          <strong>${escapeHtml(a.title)}</strong>
          <p>${escapeHtml(trimSummary(a.summary || ""))}</p>
          <button class="link-btn" data-action="detail" data-id="${escapeHtml(String(a.id))}">Haberi Oku →</button>
        </article>
      `).join("")
    : `<p class="empty-state inline">Bu haberle benzer başka haber bulunamadı.</p>`;
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeSimilarNewsModal() {
  const modal = document.getElementById("similar-news-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

/* ============================
   TREND PANEL (Priority 12)
   ============================ */
function computeTrendGroups() {
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const trends = computeTrendGroupsFrom(articles);
  return hasRegionFilter() ? trends.filter((trend) => matchesTrendRegion(trend, currentSelectedRegions())) : trends;
}

// trendReason imported from ./services/trendService.js
const TREND_PANEL_PAGE_SIZE = 5;

function trendScoreForArticle(article = {}) {
  const recency = getRecencyScore(article);
  const interest = articleInterestScore(article);
  const popularity = articlePopularity(article);
  const sourceBoost = article.source ? 6 : 0;
  return (recency * 1.2) + interest + popularity + sourceBoost;
}

function buildTrendPanelItems(limit = 8) {
  const groupedTrends = computeTrendGroups();
  const items = groupedTrends.map((group) => ({ group, article: group.representative }));
  const seen = new Set(items.map((item) => String(item.article?.id || item.article?.sourceUrl || item.article?.title || "")));
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const fallbackItems = [...articles]
    .filter(Boolean)
    .sort((a, b) => trendScoreForArticle(b) - trendScoreForArticle(a))
    .filter((article) => {
      const key = String(article.id || article.sourceUrl || article.title || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((article) => {
      const source = article.source || article.sourceName || "";
      const meta = {
        sourceCount: source ? 1 : 0,
        primaryCategory: inferArticleCategory(article) || article.category || "Gündem",
        sparklineData: [1, 2, 2, 3, 4, 5, 6, 7],
        growth: getRecencyScore(article) >= 70 ? "artıyor" : "stabil",
        reason: "Güncellik, ilgi puanı ve popülerlik sinyallerine göre öne çıktı.",
        firstSignal: source || "Ana Akış"
      };
      return {
        article,
        group: {
          representative: article,
          articles: [article],
          sources: new Set(source ? [source] : []),
          trendMeta: meta
        }
      };
    });
  return [...items, ...fallbackItems].slice(0, limit);
}

function parseArticleTime(article = {}) {
  const time = new Date(article.publishedAt || article.date || Date.now()).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function trendLineDataForGroup(group = {}) {
  const articles = Array.isArray(group.articles) && group.articles.length
    ? group.articles
    : [group.representative].filter(Boolean);
  const now = Date.now();
  const times = articles.map(parseArticleTime).filter(Number.isFinite);
  const firstTime = Math.min(...times, now);
  const start = Number.isFinite(firstTime) ? firstTime : now - 3600000;
  const end = Math.max(now, start + 60000);
  const steps = 8;
  const points = Array.from({ length: steps }, (_, index) => {
    const progress = steps === 1 ? 1 : index / (steps - 1);
    const bucketTime = start + (end - start) * progress;
    const cumulative = articles.reduce((total, article) => {
      const articleTime = parseArticleTime(article);
      if (articleTime > bucketTime) return total;
      const sourceWeight = article.source || article.sourceName ? 1.2 : 0.8;
      return total + sourceWeight + articleInterestScore(article) / 100;
    }, 0);
    const fallbackCurve = articles.length === 1 ? Math.pow(progress, 1.35) * (1 + articleInterestScore(articles[0]) / 70) : 0;
    return Math.max(0.1, cumulative || fallbackCurve);
  });
  return points.map((value, index, arr) => {
    const previous = index ? arr[index - 1] : value;
    return Math.max(value, previous);
  });
}

function trendStatusLabel(status) {
  return { rising: "Yükseliyor", stable: "Sabit", fading: "Düşüyor" }[status] || "Sabit";
}

function formatTrendDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderTrendRegionChips(regions = []) {
  const values = [...new Set(regions.map(regionValue).filter(Boolean))];
  return values.length ? `<div class="trend-region-chips">${values.map((region) =>
    `<span class="trend-region-chip">${escapeHtml(regionLabel(region))}</span>`
  ).join("")}</div>` : "";
}

function renderPropagationPath(path = []) {
  if (!path.length) return `<span class="trend-data-empty">Yayılım verisi yok</span>`;
  return `<div class="trend-propagation-path">${path.map((step, index) => {
    const region = regionValue(step.region || step) || "global";
    const detail = [step.country, formatTrendDate(step.firstSeenAt)].filter(Boolean).join(" · ");
    return `${index ? `<span class="trend-propagation-arrow" aria-hidden="true">→</span>` : ""}
      <span class="trend-propagation-step" title="${escapeHtml(detail)}">${escapeHtml(regionLabel(region))}${step.country ? `<small>${escapeHtml(step.country)}</small>` : ""}</span>`;
  }).join("")}</div>`;
}

function renderTrendSparkline(growthSeries = []) {
  const data = growthSeries.map((point) => Number(point.sourceCount ?? point)).filter(Number.isFinite);
  if (!data.length) return `<span class="trend-data-empty">Yeterli veri yok</span>`;
  const max = Math.max(...data, 1);
  const width = 124;
  const height = 38;
  const pad = 3;
  const usableWidth = width - pad * 2;
  const usableHeight = height - pad * 2;
  const points = data.map((value, index) => {
    const x = pad + (usableWidth * index) / Math.max(1, data.length - 1);
    const y = height - pad - (value / max) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const areaPoints = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  return `
    <svg class="trend-line-chart trend-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Trend büyüme grafiği" focusable="false">
      <polyline class="trend-line-grid" points="${pad},${height - pad} ${width - pad},${height - pad}"></polyline>
      <polygon class="trend-line-area" points="${areaPoints}"></polygon>
      <polyline class="trend-line-path" points="${points}"></polyline>
      <circle class="trend-line-dot" cx="${points.split(" ").at(-1).split(",")[0]}" cy="${points.split(" ").at(-1).split(",")[1]}" r="2.6"></circle>
    </svg>
  `;
}

function renderTrendArticles(articles = []) {
  if (!articles.length) return `<p class="trend-data-empty">Kaynak haber bulunamadı.</p>`;
  return `<ul class="trend-article-list">${articles.map((article) => `
    <li>
      <strong>${escapeHtml(article.displayTitle || article.title || "Başlıksız haber")}</strong>
      <small>${escapeHtml(article.sourceName || article.source || "Bilinmeyen kaynak")} · ${escapeHtml(regionLabel(article.sourceRegion || "global"))}${article.sourceCountry ? ` / ${escapeHtml(article.sourceCountry)}` : ""}${article.publishedAt ? ` · ${escapeHtml(formatTrendDate(article.publishedAt))}` : ""}</small>
    </li>
  `).join("")}</ul>`;
}

function toggleTrendDetails(trendId) {
  const current = new Set(state.expandedTrendIds || []);
  if (current.has(trendId)) current.delete(trendId);
  else current.add(trendId);
  state.expandedTrendIds = [...current];
  renderTrendPanel();
}

function renderTrendPanel() {
  if (!headlineList) return;
  if (isLoadingData && !state.data?.articles?.length) {
    headlineList.innerHTML = `<div class="trend-loading-state">Trendler analiz ediliyor...</div>`;
    return;
  }
  if (state.trendError) {
    headlineList.innerHTML = `<div class="trend-error-state">Trend verileri alınamadı. Lütfen tekrar deneyin.</div>`;
    return;
  }
  const trends = buildTrendPanelItems(8);
  const pageSize = TREND_PANEL_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(trends.length / pageSize));
  state.trendPage = Math.min(Math.max(0, state.trendPage || 0), totalPages - 1);
  const visibleTrends = trends.slice(state.trendPage * pageSize, (state.trendPage + 1) * pageSize);
  if (!trends.length) {
    headlineList.innerHTML = `
      <div class="sidebar-empty-state sidebar-empty-state-visual">
        <i class="fa-solid fa-satellite-dish" aria-hidden="true"></i>
        <span>Henüz yeterli bölgesel trend verisi yok.</span>
      </div>
    `;
    return;
  }

  const STATUS_ICONS = {
    rising: '<i class="fa-solid fa-arrow-trend-up" style="color:#16a34a"></i>',
    stable: '<i class="fa-solid fa-minus" style="color:#d97706"></i>',
    falling: '<i class="fa-solid fa-arrow-trend-down" style="color:#dc2626"></i>',
    breaking: '<i class="fa-solid fa-bolt" style="color:#dc2626"></i>'
  };
  const STATUS_LABELS = { rising: 'Yükseliyor', stable: 'Sabit', falling: 'Düşüyor', breaking: 'Son Dakika' };

  const listHtml = visibleTrends.map((item, visibleIndex) => {
    const g = item.group || item;
    const i = state.trendPage * pageSize + visibleIndex;
    const title = g.title || g.representative.displayTitle || g.representative.title || "Başlıksız trend";
    const articleId = String(g.representative.id || "");
    const meta = g.trendMeta || {};
    const status = meta.trendStatus || "stable";
    const statusIcon = STATUS_ICONS[status] || STATUS_ICONS.stable;
    const statusLabel = STATUS_LABELS[status] || "Sabit";
    const sourceCount = meta.sourceCount || g.sources?.size || 1;
    const category = meta.primaryCategory || "Gündem";
    const trendLineHtml = renderTrendSparkline(meta.growthSeries || []);

    return `
      <div class="trend-compact-item" data-action="detail" data-id="${escapeHtml(articleId)}" role="button" tabindex="0">
        <div class="trend-compact-rank">${i + 1}</div>
        <div class="trend-compact-body">
          <div class="trend-compact-title">${escapeHtml(title)}</div>
          <div class="trend-compact-meta">
            <span class="trend-compact-cat">${escapeHtml(category)}</span>
            <span class="trend-compact-sources">— ${sourceCount} kaynak</span>
          </div>
          <div class="trend-compact-footer">
            ${trendLineHtml}
            <span class="trend-compact-status">${statusIcon} ${escapeHtml(statusLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  const controlsHtml = trends.length > pageSize ? `
    <div class="trend-panel-controls" aria-label="Trend haber sayfalama">
      <button type="button" data-trend-page="prev" ${state.trendPage === 0 ? "disabled" : ""} aria-label="Önceki trend haberleri göster">
        <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
      </button>
      <span>${state.trendPage + 1}/${totalPages}</span>
      <button type="button" data-trend-page="next" ${state.trendPage >= totalPages - 1 ? "disabled" : ""} aria-label="Sonraki trend haberleri göster">
        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
      </button>
    </div>
  ` : "";
  headlineList.innerHTML = `${listHtml}${controlsHtml}`;
}


function renderCountryTrends() {
  const grid = document.getElementById("country-trends-grid");
  if (!grid) return;
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const countryMap = new Map();
  const COUNTRY_FLAGS = { "Turkiye": "\u{1F1F9}\u{1F1F7}", "United States": "\u{1F1FA}\u{1F1F8}", "United Kingdom": "\u{1F1EC}\u{1F1E7}", "Germany": "\u{1F1E9}\u{1F1EA}", "France": "\u{1F1EB}\u{1F1F7}", "Russia": "\u{1F1F7}\u{1F1FA}", "China": "\u{1F1E8}\u{1F1F3}", "Japan": "\u{1F1EF}\u{1F1F5}", "Israel": "\u{1F1EE}\u{1F1F1}", "Brazil": "\u{1F1E7}\u{1F1F7}", "India": "\u{1F1EE}\u{1F1F3}", "Italy": "\u{1F1EE}\u{1F1F9}", "Spain": "\u{1F1EA}\u{1F1F8}", "Australia": "\u{1F1E6}\u{1F1FA}", "Canada": "\u{1F1E8}\u{1F1E6}", "South Korea": "\u{1F1F0}\u{1F1F7}" };
  const COUNTRY_TR = { "Turkiye": "Türkiye", "United States": "ABD", "United Kingdom": "İngiltere", "Germany": "Almanya", "France": "Fransa", "Russia": "Rusya", "China": "Çin", "Japan": "Japonya", "Israel": "İsrail", "Brazil": "Brezilya", "India": "Hindistan", "Italy": "İtalya", "Spain": "İspanya", "Australia": "Avustralya", "Canada": "Kanada", "South Korea": "Güney Kore" };
  for (const a of articles) {
    const country = a.country || a.sourceCountry || "";
    if (!country) continue;
    if (!countryMap.has(country)) countryMap.set(country, []);
    countryMap.get(country).push(a);
  }
  const sorted = [...countryMap.entries()]
    .filter(([, arts]) => arts.length >= 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);
  if (sorted.length === 0) {
    grid.innerHTML = '<div class="share-empty">Ülke bazlı trend verisi henüz oluşturulmadı.</div>';
    return;
  }
  grid.innerHTML = sorted.map(([country, arts]) => {
    const flag = COUNTRY_FLAGS[country] || "\u{1F30D}";
    const label = COUNTRY_TR[country] || country;
    const topArticle = arts.sort((a, b) => (new Date(b.publishedAt || b.date || 0)) - (new Date(a.publishedAt || a.date || 0)))[0];
    return `
      <div class="country-trend-card">
        <div class="country-trend-header">
          <span class="country-flag">${flag}</span>
          <span class="country-name">${escapeHtml(label)}</span>
          <span class="country-count">${arts.length} haber</span>
        </div>
        <button type="button" class="country-trend-title" data-action="detail" data-id="${escapeHtml(String(topArticle.id))}">${escapeHtml((topArticle.title || "").slice(0, 80))}</button>
        <div class="country-trend-meta">${escapeHtml(topArticle.source || "")} · ${escapeHtml(topArticle.category || "")}</div>
      </div>
    `;
  }).join("");
  grid.querySelectorAll("[data-action=detail]").forEach((btn) => {
    btn.addEventListener("click", () => handleArticleAction("detail", findArticleForAction(btn.dataset.id)));
  });
}

function updateMapTrendBadges() {
  const REGION_CENTERS = {
    "north-america": { x: 138, y: 135 },
    "south-america": { x: 181, y: 245 },
    "europe": { x: 338, y: 108 },
    "africa": { x: 350, y: 210 },
    "middle-east": { x: 423, y: 162 },
    "asia": { x: 514, y: 145 },
    "oceania": { x: 517, y: 265 },
    "turkey": { x: 393, y: 140 }
  };
  const svg = document.querySelector(".region-map svg");
  if (!svg) return;
  svg.querySelectorAll(".trend-count-badge").forEach((el) => el.remove());
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const regionCounts = new Map();
  for (const a of articles) {
    const region = a.region || a.detectedRegion || "";
    if (region && REGION_CENTERS[region]) {
      regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
    }
  }
  for (const [region, count] of regionCounts) {
    const center = REGION_CENTERS[region];
    if (!center || count < 1) continue;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("trend-count-badge");
    g.setAttribute("data-region-map", region);
    g.style.cursor = "pointer";
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", center.x);
    circle.setAttribute("cy", center.y);
    circle.setAttribute("r", count > 9 ? 12 : 10);
    circle.setAttribute("fill", "#ef4444");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", "2");
    g.appendChild(circle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", center.x);
    text.setAttribute("y", center.y + 4);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#fff");
    text.setAttribute("font-size", "10");
    text.setAttribute("font-weight", "800");
    text.textContent = count > 99 ? "99+" : String(count);
    g.appendChild(text);
    svg.appendChild(g);
  }
}

function renderSidebarWorldTrends() {
  const container = document.getElementById("sidebar-world-trends");
  if (!container) return;
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const countryMap = new Map();
  const FLAGS = { "Turkiye": "\u{1F1F9}\u{1F1F7}", "United States": "\u{1F1FA}\u{1F1F8}", "United Kingdom": "\u{1F1EC}\u{1F1E7}", "Germany": "\u{1F1E9}\u{1F1EA}", "France": "\u{1F1EB}\u{1F1F7}", "Russia": "\u{1F1F7}\u{1F1FA}", "China": "\u{1F1E8}\u{1F1F3}", "Japan": "\u{1F1EF}\u{1F1F5}", "Israel": "\u{1F1EE}\u{1F1F1}", "Brazil": "\u{1F1E7}\u{1F1F7}", "India": "\u{1F1EE}\u{1F1F3}", "Italy": "\u{1F1EE}\u{1F1F9}", "Spain": "\u{1F1EA}\u{1F1F8}", "Australia": "\u{1F1E6}\u{1F1FA}", "Canada": "\u{1F1E8}\u{1F1E6}", "South Korea": "\u{1F1F0}\u{1F1F7}" };
  const TR = { "Turkiye": "Türkiye", "United States": "ABD", "United Kingdom": "İngiltere", "Germany": "Almanya", "France": "Fransa", "Russia": "Rusya", "China": "Çin", "Japan": "Japonya", "Israel": "İsrail", "Brazil": "Brezilya", "India": "Hindistan", "Italy": "İtalya", "Spain": "İspanya", "Australia": "Avustralya", "Canada": "Kanada", "South Korea": "Güney Kore" };
  for (const a of articles) {
    const c = a.country || a.sourceCountry || "";
    if (c) countryMap.set(c, (countryMap.get(c) || 0) + 1);
  }
  const sorted = [...countryMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!sorted.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:.78rem">Henüz veri yok.</p>'; return; }
  container.innerHTML = sorted.map(([country, count], i) => `
    <div class="sidebar-trend-row">
      <span class="sidebar-trend-num">${i + 1}</span>
      <span class="sidebar-trend-flag">${FLAGS[country] || "\u{1F30D}"}</span>
      <span class="sidebar-trend-name">${escapeHtml(TR[country] || country)}</span>
      <span class="sidebar-trend-count">${count} haber</span>
    </div>
  `).join("");
}

function renderStaticLists() {
  renderTrendPanel();
  renderCountryTrends();
  renderSidebarWorldTrends();
  updateMapTrendBadges();
}

/* ============================
   ENTITY LINKS
   ============================ */
const ENTITY_STOPWORDS = new Set([
  "Bugün", "Son", "Yeni", "Kaynak", "Haber", "AI", "RSS", "Tam", "Metin",
  "Türkiye", "Dünya", "Ekonomi", "Bilim", "Teknoloji", "Gündem", "Spor",
  "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
  "Ocak", "Şubat", "Mart", "Nisan", "Pazartesi", "Salı", "Çarşamba",
  "Perşembe", "Cuma", "Cumartesi", "Pazar"
]);

const KNOWN_ENTITY_TERMS = [
  "Türkiye", "Amerika Birleşik Devletleri", "ABD", "Almanya", "Fransa", "İngiltere",
  "Rusya", "Çin", "Ukrayna", "İran", "İsrail", "Filistin", "Suriye", "Irak",
  "Yunanistan", "İtalya", "İspanya", "Hollanda", "Japonya", "Kanada", "Brezilya",
  "Meksika", "Hindistan", "Pakistan", "Suudi Arabistan", "Mısır", "Katar",
  "Birleşik Arap Emirlikleri", "BAE", "Güney Kore", "Kuzey Kore", "Avustralya",
  "Avusturya", "Belçika", "İsveç", "Norveç", "Danimarka", "Polonya", "Romanya",
  "Bulgaristan", "Gürcistan", "Azerbaycan", "Ermenistan", "Lübnan", "Ürdün",
  "Avrupa Birliği", "NATO",
  "Birleşmiş Milletler", "NASA", "UEFA", "FIFA", "TBMM", "MEB", "Merkez Bankası",
  "Adalet Bakanlığı", "İçişleri Bakanlığı", "Düzce Cumhuriyet Başsavcılığı",
  "Düzce İl Jandarma Komutanlığı", "Jandarma Genel Komutanlığı", "Emniyet Genel Müdürlüğü",
  "İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Adana", "Konya", "Gaziantep",
  "Kayseri", "Samsun", "Trabzon", "Diyarbakır", "Eskişehir", "Paris", "Londra",
  "Berlin", "Moskova", "Kiev", "Pekin", "Washington", "New York", "Brüksel",
  "Eurovision", "Eurovision 2026", "Dünya Kupası", "Avrupa Şampiyonası",
  "Şampiyonlar Ligi", "Süper Lig", "Olimpiyat Oyunları", "Gelinim Mutfakta",
  "Survivor", "Fenerbahçe", "Galatasaray", "Beşiktaş", "Trabzonspor",
  "Donald Trump", "Trump", "Şi Cinping", "Xi Jinping", "Elon Musk", "Musk",
  "Recep Tayyip Erdoğan", "Erdoğan", "Vladimir Putin", "Putin", "Volodimir Zelenskiy",
  "Zelenskiy", "Binyamin Netanyahu", "Netanyahu"
];

const ENTITY_DESCRIPTIONS = {
  "ABD": "Kuzey Amerika'da yer alan, 50 eyaletten oluşan federal cumhuriyet. Başkenti Washington D.C., en kalabalık şehri New York'tur. Dünyanın en büyük ekonomisine sahip olup uluslararası siyaset, teknoloji ve kültürde belirleyici bir aktördür.",
  "Amerika Birleşik Devletleri": "Kuzey Amerika'da yer alan, 50 eyaletten oluşan federal cumhuriyet. Başkenti Washington D.C.'dir. NATO'nun kurucu üyesidir ve küresel ekonomi, savunma ve teknoloji alanlarında lider konumdadır.",
  "Türkiye": "Anadolu ve Trakya topraklarında yer alan, başkenti Ankara olan parlamenter cumhuriyet. NATO üyesidir ve Avrupa ile Asya'yı bağlayan stratejik konumda bulunur. En kalabalık şehri İstanbul'dur.",
  "Almanya": "Orta Avrupa'da yer alan federal cumhuriyet. Başkenti Berlin olup Avrupa Birliği'nin en büyük ekonomisidir. Otomotiv ve mühendislik sektörlerinde küresel öncüdür.",
  "Fransa": "Batı Avrupa'da yer alan, başkenti Paris olan cumhuriyet. BM Güvenlik Konseyi daimi üyesi ve nükleer güç sahibi bir ülkedir. Avrupa Birliği'nin kurucu üyelerindendir.",
  "İngiltere": "Birleşik Krallık'ın en büyük ülkesi. Başkenti Londra olup parlamenter monarşi ile yönetilir. Endüstri Devrimi'nin doğduğu ve İngilizce'nin ana yurdu olan bir ülkedir.",
  "Rusya": "Avrupa ve Asya kıtalarına yayılan, yüzölçümü en büyük ülke. Başkenti Moskova'dır. Nükleer güç sahibi olup BM Güvenlik Konseyi daimi üyesidir.",
  "Çin": "Doğu Asya'da yer alan, dünyanın en kalabalık ülkelerinden biri. Başkenti Pekin olup dünyanın ikinci büyük ekonomisidir. Üretim ve teknolojide küresel öneme sahiptir.",
  "Ukrayna": "Doğu Avrupa'da yer alan cumhuriyet. Başkenti Kiev'dir. 2022'den bu yana Rusya ile devam eden savaş nedeniyle uluslararası gündemde geniş yer tutmaktadır.",
  "İran": "Batı Asya'da yer alan, başkenti Tahran olan İslam Cumhuriyeti. Petrol ve doğal gaz rezervleri açısından dünyanın en zengin ülkelerinden biridir.",
  "İsrail": "Orta Doğu'da Akdeniz kıyısında yer alan, başkenti Kudüs (uluslararası tanınma sınırlı) olan ülke. Teknoloji sektörü ve bölgesel çatışmalarla sık sık gündeme gelir.",
  "Filistin": "Orta Doğu'da, Batı Şeria ve Gazze Şeridi'nde varlığını sürdüren devlet. Birçok ülke tarafından tanınmakta olup İsrail ile süregelen toprak anlaşmazlığının merkezindedir.",
  "Suriye": "Orta Doğu'da yer alan, başkenti Şam olan ülke. 2011'den itibaren süren iç savaş nedeniyle bölgesel siyasette önemli bir ağırlığa sahiptir.",
  "Yunanistan": "Güneydoğu Avrupa'da yer alan, başkenti Atina olan ülke. AB ve NATO üyesi olup batı medeniyetinin doğduğu topraklar arasında sayılır.",
  "İtalya": "Güney Avrupa'da yer alan, başkenti Roma olan cumhuriyet. AB'nin kurucu üyelerindendir ve sanat, moda, otomotiv alanlarında tanınır.",
  "Hollanda": "Batı Avrupa'da yer alan, başkenti Amsterdam olan ülke. Avrupa Birliği'nin kurucu üyelerinden biri olup limanları ve tarımıyla öne çıkar.",
  "Avrupa Birliği": "Avrupa'da 27 üye devletten oluşan ekonomik ve siyasi birlik. Tek pazar, ortak para birimi (euro) ve ortak dış politika temelinde kurulmuştur.",
  "NATO": "Kuzey Atlantik Antlaşması Örgütü; 1949'da kurulan, 32 üye ülkeden oluşan kolektif savunma ittifakı. Türkiye 1952'den bu yana üyedir.",
  "Birleşmiş Milletler": "1945'te kurulan, 193 üye devletten oluşan uluslararası örgüt. Merkezi New York'tadır ve barış, güvenlik, insan hakları alanlarında çalışır.",
  "NASA": "Amerika Birleşik Devletleri'nin sivil havacılık ve uzay araştırmaları ajansı. 1958'de kurulmuş olup Apollo, Artemis ve Mars görevleriyle tanınır.",
  "UEFA": "Avrupa Futbol Federasyonları Birliği. Şampiyonlar Ligi, Avrupa Ligi ve EURO turnuvalarını düzenler. Merkezi İsviçre Nyon'dadır.",
  "FIFA": "Uluslararası Futbol Federasyonları Birliği. Dünya Kupası başta olmak üzere küresel futbol organizasyonlarını yönetir. Merkezi Zürih'tedir.",
  "TBMM": "Türkiye Büyük Millet Meclisi; Türkiye Cumhuriyeti'nin yasama organı. Ankara'da bulunur ve 600 milletvekilinden oluşur.",
  "MEB": "Milli Eğitim Bakanlığı; Türkiye'de örgün ve yaygın eğitim hizmetlerinden sorumlu bakanlık.",
  "Merkez Bankası": "Türkiye Cumhuriyet Merkez Bankası (TCMB); para politikasını yöneten, fiyat istikrarını sağlamakla görevli kurum. Merkezi Ankara'dadır.",
  "İstanbul": "Türkiye'nin en kalabalık şehri ve ekonomik merkezi. Avrupa ile Asya kıtalarına yayılan, Boğaz'la ikiye bölünen tarihi metropol.",
  "Ankara": "Türkiye'nin başkenti ve ikinci büyük şehri. Devlet kurumlarının ve büyükelçiliklerin merkezidir.",
  "İzmir": "Türkiye'nin Ege kıyısındaki üçüncü büyük şehri. Liman, fuar ve turizm açısından önemli bir merkezdir.",
  "Bursa": "Marmara Bölgesi'nde yer alan, Osmanlı'nın ilk başkentlerinden biri olan şehir. Otomotiv ve tekstil sanayisiyle tanınır.",
  "Antalya": "Akdeniz kıyısındaki turizm başkenti. Yüksek yabancı turist sayısı ve sahil otelleriyle bilinir.",
  "Adana": "Çukurova Bölgesi'nde yer alan büyükşehir. Pamuk üretimi, sanayi ve kebabıyla tanınır.",
  "Konya": "İç Anadolu'nun en büyük şehri. Mevlana ve Selçuklu mirasıyla bilinen tarım ve sanayi merkezi.",
  "Gaziantep": "Güneydoğu Anadolu'nun sanayi ve mutfak başkenti. Baklavası ve tekstil üretimiyle tanınır.",
  "Paris": "Fransa'nın başkenti ve en büyük şehri. Sanat, moda ve diplomasinin merkezlerinden biridir.",
  "Londra": "Birleşik Krallık'ın başkenti. Küresel finans merkezlerinden biri olup tarihi mimarisi ile öne çıkar.",
  "Berlin": "Almanya'nın başkenti ve en kalabalık şehri. Soğuk Savaş tarihi ve canlı kültürel hayatıyla bilinir.",
  "Moskova": "Rusya'nın başkenti ve en kalabalık şehri. Kremlin ve Kızıl Meydan'a ev sahipliği yapar.",
  "Kiev": "Ukrayna'nın başkenti. Dinyeper Nehri kıyısında kurulmuş tarihi bir Doğu Avrupa şehridir.",
  "Pekin": "Çin Halk Cumhuriyeti'nin başkenti. Yasak Şehir ve Çin Seddi'ne yakınlığıyla tanınır.",
  "Washington": "ABD'nin başkenti Washington D.C. Beyaz Saray ve Kongre binasının bulunduğu federal başkent.",
  "New York": "ABD'nin en kalabalık şehri. Wall Street ve BM Genel Merkezi'ne ev sahipliği yapar.",
  "Brüksel": "Belçika'nın başkenti ve Avrupa Birliği kurumlarının merkezi. NATO genel merkezi de buradadır.",
  "Eurovision": "Avrupa Yayın Birliği tarafından her yıl düzenlenen şarkı yarışması. Üye ülkelerin temsilcileri yarışır.",
  "Eurovision 2026": "Eurovision Şarkı Yarışması'nın 2026 yılı için planlanan organizasyonu.",
  "Dünya Kupası": "FIFA'nın dört yılda bir düzenlediği, milli takımların katıldığı en prestijli futbol turnuvası.",
  "Avrupa Şampiyonası": "UEFA EURO; dört yılda bir Avrupa milli takımları arasında düzenlenen futbol şampiyonası.",
  "Şampiyonlar Ligi": "UEFA Şampiyonlar Ligi; Avrupa'nın en iyi kulüplerinin katıldığı yıllık futbol turnuvası.",
  "Süper Lig": "Türkiye'nin en üst düzey profesyonel futbol ligi. TFF tarafından organize edilir.",
  "Olimpiyat Oyunları": "Uluslararası Olimpiyat Komitesi tarafından dört yılda bir düzenlenen çok branşlı spor organizasyonu.",
  "Fenerbahçe": "İstanbul Kadıköy merkezli, 1907'de kurulmuş çok şubeli spor kulübü. Sarı-lacivert renkleriyle tanınır.",
  "Galatasaray": "İstanbul merkezli, 1905'te kurulmuş Türkiye'nin köklü spor kulüplerinden biri. Sarı-kırmızı renkler.",
  "Beşiktaş": "İstanbul Beşiktaş ilçesinde kurulmuş, siyah-beyaz renkli köklü Türk spor kulübü.",
  "Trabzonspor": "Trabzon merkezli, 1967'de kurulmuş Türk spor kulübü. Bordo-mavi renkleriyle tanınır.",
  "Donald Trump": "ABD'li siyasetçi ve iş insanı. 2017-2021 döneminde ABD başkanlığı yaptı ve 2025'te başlayan ikinci başkanlık dönemiyle yeniden dünya gündeminde öne çıktı.",
  "Trump": "Donald Trump; ABD'li siyasetçi ve iş insanı. ABD başkanlığı ve dış politika kararlarıyla dünya gündeminde sıkça yer alır.",
  "Şi Cinping": "Çin Devlet Başkanı ve Çin Komünist Partisi Genel Sekreteri. Çin'in iç politikası, ekonomisi ve dış ilişkilerinde belirleyici konumdadır.",
  "Xi Jinping": "Çin Devlet Başkanı ve Çin Komünist Partisi Genel Sekreteri. Uluslararası haberlerde Şi Cinping adıyla da anılır.",
  "Elon Musk": "Teknoloji girişimcisi. Tesla, SpaceX, X ve yapay zeka alanındaki şirketleriyle ekonomi, teknoloji ve siyaset haberlerinde sıkça yer alır.",
  "Musk": "Elon Musk; Tesla, SpaceX ve X gibi şirketlerle teknoloji, ekonomi ve siyaset haberlerinde sıkça anılan girişimci.",
  "Recep Tayyip Erdoğan": "Türkiye Cumhurbaşkanı. Türkiye'nin iç siyaseti ve dış ilişkileriyle ilgili haberlerde öne çıkar.",
  "Erdoğan": "Recep Tayyip Erdoğan; Türkiye Cumhurbaşkanı.",
  "Vladimir Putin": "Rusya Devlet Başkanı. Rusya'nın iç politikası, dış ilişkileri ve güvenlik politikalarında belirleyici aktördür.",
  "Putin": "Vladimir Putin; Rusya Devlet Başkanı.",
  "Volodimir Zelenskiy": "Ukrayna Devlet Başkanı. Rusya-Ukrayna savaşı ve uluslararası diplomasi haberlerinde öne çıkar.",
  "Zelenskiy": "Volodimir Zelenskiy; Ukrayna Devlet Başkanı.",
  "Binyamin Netanyahu": "İsrail Başbakanı. İsrail siyaseti ve Orta Doğu gündeminde sıkça yer alır.",
  "Netanyahu": "Binyamin Netanyahu; İsrail Başbakanı."
};

function entityDescription(entity) {
  if (!entity) return "";
  if (ENTITY_DESCRIPTIONS[entity]) return ENTITY_DESCRIPTIONS[entity];
  const key = entityKey(entity);
  for (const [name, desc] of Object.entries(ENTITY_DESCRIPTIONS)) {
    if (entityKey(name) === key) return desc;
  }
  return "";
}

const PERSON_NAME_BLOCKLIST = new Set([
  "Son Dakika", "Canlı Haber", "Tam Metin", "Aynı Haber", "Kaynak Site",
  "En Yakın", "Bu Haber", "Haber Akışı", "Kişisel Gazetem"
]);

const PERSON_NAME_REJECT_WORDS = new Set([
  "Başkanı", "Başkan", "Bakanı", "Bakan", "Başbakan", "Cumhurbaşkanı",
  "Lideri", "Lider", "Sözcüsü", "Sözcü", "Genel", "Müdürü", "Direktörü",
  "Kurulu", "Partisi", "Hükümeti", "Ekibi", "Uçağı", "Ülkesi"
]);

const PERSON_TITLE_PATTERN = "(?:CHP|AK Parti|MHP|İYİ Parti|DEM Parti|Saadet Partisi|Yeniden Refah Partisi|Zafer Partisi|TİP|BBP|DSP|DP)?\\s*(?:Genel\\s+Başkanı|Eş\\s+Genel\\s+Başkanı|Cumhurbaşkanı|Başbakan|Bakanı|Bakan|Başkanı|Milletvekili|Belediye\\s+Başkanı|Valisi|Sözcüsü|Lideri|Genel\\s+Müdürü|Teknik\\s+Direktörü|Başsavcılığı|Başsavcısı)";
const INSTITUTION_PATTERN = "\\b[A-ZÇĞİÖŞÜ][\\p{L}'’.-]+(?:\\s+(?:İl|İlçe|Cumhuriyet|Büyükşehir|Belediye|Jandarma|Emniyet|Adalet|İçişleri|Dışişleri|Milli\\s+Eğitim|Sağlık|Hazine|Maliye|Ticaret|Tarım|Kültür|Turizm|Gençlik|Spor|Ulaştırma|Enerji|Çevre|Şehircilik|Başsavcılığı|Başsavcısı|Bakanlığı|Bakanlığımız|Bakanımız|Komutanlığı|Müdürlüğü|Başkanlığı|Valiliği|Kaymakamlığı|Mahkemesi|Üniversitesi)){1,5}\\b";
const EVENT_PHRASES = [
  "yasa dışı bahis şebekesi",
  "eş zamanlı operasyon",
  "sahte fatura operasyonu",
  "kara para aklama",
  "suç örgütü",
  "rüşvet operasyonu",
  "soruşturma",
  "iddianame",
  "operasyon"
];

[
  "Bugün", "Son", "Yeni", "Kaynak", "Haber", "Türkiye", "Dünya", "Ekonomi",
  "Bilim", "Teknoloji", "Gündem", "Spor", "Mayıs", "Ağustos", "Eylül",
  "Kasım", "Aralık", "Şubat", "Salı", "Çarşamba", "Perşembe"
].forEach((word) => ENTITY_STOPWORDS.add(word));

function entityKey(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function articleSearchText(article) {
  return decodeHtmlEntities(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`);
}

function isKnownEntity(entity) {
  const key = entityKey(entity);
  return KNOWN_ENTITY_TERMS.some((term) => entityKey(term) === key);
}

function isImportantDateEntity(entity) {
  return /\b\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+\d{4}\b/u.test(entity)
    || /\b(?:19|20)\d{2}\b/.test(entity);
}

function isInstitutionEntity(entity) {
  return new RegExp(INSTITUTION_PATTERN, "u").test(entity);
}

function isImportantAmountEntity(entity) {
  return /\b\d+(?:[.,]\d+)?\s*(?:milyar|milyon|bin)\s+(?:liralık|lira|TL|dolarlık|dolar|euroluk|euro)\b/iu.test(entity);
}

function isImportantEventEntity(entity) {
  const key = entityKey(entity);
  return EVENT_PHRASES.some((phrase) => key.includes(entityKey(phrase)));
}

function isLikelyPersonName(entity) {
  const words = String(entity || "").split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 3) return false;
  if (PERSON_NAME_BLOCKLIST.has(entity)) return false;
  return words.every((word) => {
    const bare = word.replace(/[’'].*$/, "").replace(/[^\p{L}.-]/gu, "");
    return bare.length >= 3
      && !ENTITY_STOPWORDS.has(bare)
      && !PERSON_NAME_REJECT_WORDS.has(bare)
      && /^[A-ZÇĞİÖŞÜ]/u.test(bare)
      && !/^[A-ZÇĞİÖŞÜ]{2,}$/u.test(bare);
  });
}

function isLikelyTitledPersonName(entity) {
  const words = String(entity || "").split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;
  return words.every((word) => {
    const bare = word.replace(/[’'].*$/, "").replace(/[^\p{L}.-]/gu, "");
    return bare.length >= 3
      && !ENTITY_STOPWORDS.has(bare)
      && !PERSON_NAME_REJECT_WORDS.has(bare)
      && /^[A-ZÇĞİÖŞÜ]/u.test(bare)
      && !/^[A-ZÇĞİÖŞÜ]{2,}$/u.test(bare);
  });
}

function stripNameSuffixes(entity) {
  return String(entity || "")
    .split(/\s+/)
    .map((word) => word.replace(/[’'].*$/, ""))
    .join(" ")
    .trim();
}

function extractEntitiesFromText(text) {
  const clean = decodeHtmlEntities(text).replace(/\s+/g, " ");
  const cleanKey = entityKey(clean);
  const entities = new Map();

  for (const term of KNOWN_ENTITY_TERMS) {
    if (cleanKey.includes(entityKey(term))) entities.set(entityKey(term), term);
  }

  for (const match of clean.matchAll(/\b\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+\d{4}\b/gu)) {
    entities.set(entityKey(match[0]), match[0]);
  }

  for (const match of clean.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    const year = match[0];
    const around = clean.slice(Math.max(0, match.index - 32), match.index + 36);
    if (/seçim|deprem|kriz|savaş|final|eurovision|olimpiyat|kupa|şampiyona/i.test(around)) {
      entities.set(entityKey(year), year);
    }
  }

  for (const match of clean.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:milyar|milyon|bin)\s+(?:liralık|lira|TL|dolarlık|dolar|euroluk|euro)\b/giu)) {
    entities.set(entityKey(match[0]), match[0]);
  }

  for (const phrase of EVENT_PHRASES) {
    const phraseKey = entityKey(phrase);
    if (cleanKey.includes(phraseKey)) {
      const found = clean.match(new RegExp(phrase.replace(/\s+/g, "\\s+"), "i"))?.[0] || phrase;
      entities.set(entityKey(found), found);
    }
  }

  for (const match of clean.matchAll(new RegExp(INSTITUTION_PATTERN, "gu"))) {
    const value = match[0].replace(/[,:;.!?]+$/g, "").trim();
    if (value.split(/\s+/).length < 2) continue;
    entities.set(entityKey(value), value);
  }

  const titledNameRegex = new RegExp(`\\b${PERSON_TITLE_PATTERN}\\s+([A-ZÇĞİÖŞÜ][\\p{L}'’.-]{2,}(?:\\s+[A-ZÇĞİÖŞÜ][\\p{L}'’.-]{2,}){0,2})`, "gu");
  for (const match of clean.matchAll(titledNameRegex)) {
    const value = stripNameSuffixes(match[1].replace(/[,:;.!?]+$/g, "").trim());
    if (!isLikelyTitledPersonName(value)) continue;
    entities.set(entityKey(value), value);
  }

  for (const match of clean.matchAll(/\b[A-ZÇĞİÖŞÜ][\p{L}'’.-]{2,}\s+[A-ZÇĞİÖŞÜ][\p{L}'’.-]{2,}(?:\s+[A-ZÇĞİÖŞÜ][\p{L}'’.-]{2,})?\b/gu)) {
    const value = stripNameSuffixes(match[0].replace(/[,:;.!?]+$/g, "").trim());
    if (!isLikelyPersonName(value)) continue;
    entities.set(entityKey(value), value);
  }

  for (const match of clean.matchAll(/\b[A-ZÇĞİÖŞÜ]{2,}(?:\s+\d{2,4})?\b/gu)) {
    const value = match[0].trim();
    if (value.length >= 3) entities.set(entityKey(value), value);
  }

  return [...entities.values()];
}

function getArticleEntities(article) {
  const baseEntities = extractEntitiesFromText(`${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`);
  const articleText = entityKey(articleSearchText(article));
  return baseEntities
    .map((entity) => ({
      entity,
      count: state.data.articles.filter((item) => entityKey(articleSearchText(item)).includes(entityKey(entity))).length
    }))
    .filter((item) => item.count > 0 && articleText.includes(entityKey(item.entity)))
    .filter((item) => isKnownEntity(item.entity)
      || isImportantDateEntity(item.entity)
      || isImportantAmountEntity(item.entity)
      || isImportantEventEntity(item.entity)
      || isInstitutionEntity(item.entity)
      || isLikelyPersonName(item.entity)
      || isLikelyTitledPersonName(item.entity))
    .sort((a, b) => b.entity.length - a.entity.length)
    .slice(0, 28)
    .map((item) => item.entity);
}

function relatedArticlesForEntity(entity) {
  const key = entityKey(entity);
  if (!key) return [];
  return sortArticles(state.data.articles.filter((article) => entityKey(articleSearchText(article)).includes(key)));
}

function getEntityInfo(entity) {
  const related = relatedArticlesForEntity(entity);
  const categories = [...new Set(related.map((article) => article.category).filter(Boolean))].slice(0, 4);
  const sources = [...new Set(related.map((article) => article.source).filter(Boolean))].slice(0, 4);
  const description = state.entityInfoCache[entityKey(entity)] || entityDescription(entity);
  const tooltip = description
    || (related[0] ? trimSummary(related[0].summary || related[0].fullText || related[0].title) : `${entity}`);
  return { related, categories, sources, description, tooltip };
}

function renderEntitySummary(entity, info, loading = false) {
  if (!topicSummary) return;
  const descriptionHtml = info.description
    ? `<p>${escapeHtml(info.description)}</p>`
    : `<p>${escapeHtml(entity)} hakkında bilgi hazırlanıyor. Aşağıdaki haberlerden güncel bağlamı inceleyebilirsin.</p>`;
  topicSummary.innerHTML = `
    <div>
      <span class="topic-kicker">Bilgi kartı${loading ? " hazırlanıyor" : ""}</span>
      ${descriptionHtml}
    </div>
    <div class="topic-facts">
      <span>${escapeHtml(info.categories.join(", ") || "Kategori bilgisi yok")}</span>
      <span>${escapeHtml(info.sources.join(", ") || "Kaynak bilgisi yok")}</span>
    </div>
  `;
}

async function loadAiEntityInfo(entity) {
  const key = entityKey(entity);
  if (!key || state.entityInfoCache[key]) return;
  const related = relatedArticlesForEntity(entity).slice(0, 5);
  try {
    const payload = await api("/api/entities/info", {
      method: "POST",
      body: JSON.stringify({
        entity,
        relatedArticles: related.map((article) => ({
          title: article.title,
          summary: article.summary,
          category: article.category,
          source: article.source
        }))
      })
    });
    const description = String(payload.description || "").trim();
    if (!description) return;
    state.entityInfoCache[key] = description;
    trimObjectCacheToMax(state.entityInfoCache, ENTITY_INFO_CACHE_MAX_ITEMS);
    if (state.activeEntity === entity) {
      renderEntitySummary(entity, getEntityInfo(entity));
    }
  } catch (error) {
    if (state.activeEntity === entity && !entityDescription(entity)) {
      showToast(`Bilgi kartı AI ile hazırlanamadı: ${error.message}`, "error");
    }
  }
}

function annotateTextWithEntities(text, entities) {
  const source = String(text || "");
  if (!source.trim()) return "";
  const sorted = [...entities].sort((a, b) => b.length - a.length);
  const linkedEntities = new Set();
  let html = "";
  let index = 0;
  while (index < source.length) {
    const match = sorted.find((entity) => {
      if (linkedEntities.has(entityKey(entity))) return false;
      if (!source.startsWith(entity, index)) return false;
      const before = source[index - 1] || "";
      const after = source[index + entity.length] || "";
      return !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after);
    });
    if (!match) {
      html += escapeHtml(source[index]);
      index += 1;
      continue;
    }
    const info = getEntityInfo(match);
    html += `<button class="entity-link" type="button" data-entity="${escapeHtml(match)}" data-tooltip="${escapeHtml(info.tooltip)}">${escapeHtml(match)}</button>`;
    linkedEntities.add(entityKey(match));
    index += match.length;
  }
  return html;
}

function renderAnnotatedBody(article) {
  const entities = getArticleEntities(article);
  const raw = decodeHtmlEntities(article.fullText || article.summary || "");
  return raw.split(/\n{2,}/).map((paragraph) => `
    <p>${annotateTextWithEntities(paragraph, entities)}</p>
  `).join("");
}

async function openEntityPage(entity) {
  const info = getEntityInfo(entity);
  state.entityReturn = {
    page: state.activePage,
    articleId: detailPanel && !detailPanel.hidden ? state.openArticleId : null
  };
  state.activeEntity = entity;
  if (detailPanel) detailPanel.hidden = true;
  if (profileDetail?.hidden) document.body.classList.remove("reader-open");
  if (topicTitle) topicTitle.textContent = entity;
  renderEntitySummary(entity, info, !state.entityInfoCache[entityKey(entity)]);
  if (topicRelated) {
    topicRelated.innerHTML = info.related.length
      ? `
        <div class="topic-related-heading">
          <h4>${escapeHtml(entity)} ile ilgili haberler</h4>
          <span>${info.related.length} haber</span>
        </div>
        <div class="article-grid">
          ${info.related.slice(0, 12).map((article) => renderArticleCardHtml(article)).join("")}
        </div>
      `
      : `<p class="empty-state inline">Bu konuya bağlı haber bulunamadı.</p>`;
  }
  showPage("topic");
  await loadAiEntityInfo(entity);
}

/* ============================
   AI SUMMARY SYSTEM (Priority 13)
   ============================ */
const aiSummaryCache = new Map();

// fallbackSummary imported from ./services/aiSummaryService.js

function fallbackStructuredSummary(article) {
  const sourceText = String(`${article.title || ""}. ${article.summary || article.description || ""}. ${article.fullText || ""}`)
    .replace(/\s+/g, " ")
    .trim();
  const sentences = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 35 && item.length < 260);
  const title = String(article.title || "Haberdeki gelişme").trim();
  const category = article.category ? `${article.category} başlığındaki` : "Bu";
  const baseBullets = [
    `${category} haber, ${title.replace(/[.!?]+$/, "")} gelişmesini merkeze alıyor.`,
    sentences.find((s) => /\b(İstanbul|Ankara|İzmir|Türkiye|Avrupa|ABD|Çin|Rusya|Gazze|Samsun)\b/i.test(s)) || sentences[0],
    sentences.find((s) => /\d/.test(s)),
    sentences.find((s) => /(etki|etkiledi|önem|uyarı|karar|sonuç|beklen|açıkla|art|azal|yüksel|düş)/i.test(s)),
    sentences[1]
  ].filter(Boolean);
  const shortSummary = String(article.aiSummary || sentences.slice(0, 2).join(" ") || fallbackSummary(article, "short") || "").trim();
  const bulletSummary = removeDuplicateBulletItems(baseBullets.concat(fallbackSummary(article, "bullets")
    .split(/\n+/)
    .map((item) => item.replace(/^[•\-\s]+/, "").trim())
    .filter(Boolean))).slice(0, 5);
  const neutralAnalysis = shortSummary || fallbackSummary(article, "analysis");
  return { shortSummary, bulletSummary, neutralAnalysis };
}

function textForSummaryMode(structured, mode) {
  if (mode === "bullets") {
    const bullets = Array.isArray(structured.bulletSummary) ? structured.bulletSummary : [];
    return bullets.length ? bullets.map((item) => `• ${item}`).join("\n") : structured.shortSummary;
  }
  if (mode === "paragraph") return structured.shortSummary || structured.neutralAnalysis || "";
  if (mode === "analysis") return structured.neutralAnalysis || structured.shortSummary;
  return structured.shortSummary || "";
}

function bulletItemsFromSummary(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "").split(/\n+|\u00e2\u20ac\u00a2|\u2022|\s-\s/g);
  return rawItems
    .map((item) => String(item || "").replace(/^[â€¢•\-\s]+/, "").trim())
    .filter(Boolean);
}

function normalizeBulletItem(text) {
  return normalizeText(text)
    .replace(/\bavm\b/g, "alisveris merkezi")
    .replace(/\balisveris merkezinin\b/g, "alisveris merkezi")
    .replace(/\balisveris merkezinde\b/g, "alisveris merkezi")
    .replace(/\bilcesinde\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bulletItemSimilarity(left, right) {
  const a = new Set(normalizeBulletItem(left).split(/\s+/).filter((word) => word.length > 2));
  const b = new Set(normalizeBulletItem(right).split(/\s+/).filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

function isMeaningfulBulletItem(text) {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (normalized.length <= 1) return false;
  if (words.length < 3 && !/\d/.test(normalized)) return false;
  return true;
}

function removeDuplicateBulletItems(items) {
  const output = [];
  for (const item of items) {
    if (!isMeaningfulBulletItem(item)) continue;
    const matchIndex = output.findIndex((existing) =>
      normalizeBulletItem(existing) === normalizeBulletItem(item) || bulletItemSimilarity(existing, item) >= 0.62
    );
    if (matchIndex === -1) output.push(item);
    else if (item.length > output[matchIndex].length) output[matchIndex] = item;
  }
  return output;
}

function renderSummaryContent(structured, mode, text) {
  if (mode === "bullets") {
    const bullets = removeDuplicateBulletItems(bulletItemsFromSummary(structured?.bulletSummary?.length ? structured.bulletSummary : text));
    if (bullets.length) {
      return `<ul id="ai-summary-text">${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    }
  }
  return `<p id="ai-summary-text">${escapeHtml(text || "")}</p>`;
}

function formatDetailDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return value || "Güncel";
  return date.toLocaleString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function getAiSummary(article, mode = "bullets") {
  const cacheKey = `${article.id}_${article.sourceUrl || article.title}_bullets`;
  if (aiSummaryCache.has(cacheKey)) {
    const structured = aiSummaryCache.get(cacheKey);
    return { text: textForSummaryMode(structured, mode), fromCache: true, structured };
  }

  if (state.usingApi) {
    try {
      const payload = await api("/api/ai/summarize", {
        method: "POST",
        body: JSON.stringify({
          articleId: article.id,
          mode: "bullets",
          title: article.title,
          summary: article.summary || article.description || "",
          fullText: article.fullText || "",
          content: article.fullText || article.summary || article.description || "",
          sourceName: article.sourceName || article.source || "",
          category: article.category || ""
        })
      });
      const structured = {
        shortSummary: String(payload.shortSummary || payload.summary || payload.text || "").trim(),
        bulletSummary: Array.isArray(payload.bulletSummary) ? payload.bulletSummary : [],
        neutralAnalysis: String(payload.neutralAnalysis || "").trim()
      };
      if (structured.shortSummary || structured.bulletSummary.length) {
        if (!structured.bulletSummary.length) structured.bulletSummary = fallbackStructuredSummary(article).bulletSummary;
        if (!structured.neutralAnalysis) structured.neutralAnalysis = fallbackStructuredSummary(article).neutralAnalysis;
        aiSummaryCache.set(cacheKey, structured);
        return { text: textForSummaryMode(structured, mode), fromCache: false, fromAi: true, structured };
      }
    } catch { }
  }

  const structured = fallbackStructuredSummary(article);
  aiSummaryCache.set(cacheKey, structured);
  return { text: textForSummaryMode(structured, mode), fromCache: false, fromAi: false, structured };
}

function renderAiSummaryBox(article, mode = "bullets", onModeChange = null) {
  const container = document.getElementById("ai-summary-container");
  if (!container) return;
  const renderKey = `${article.id}_${article.sourceUrl || article.title}_bullets`;
  container.dataset.aiSummaryKey = renderKey;
  container.innerHTML = `
    <div class="ai-summary-box${!state.usingApi ? " fallback" : ""}">
      <div class="ai-summary-header-row">
        <div class="ai-summary-label">${state.usingApi ? "Yapay Zeka Özeti" : "Otomatik Özet"}</div>
        <div class="ai-summary-mode-toggle" role="tablist" aria-label="Özet biçimi">
          <button type="button" data-summary-mode="bullets" class="${mode === "bullets" ? "active" : ""}">Madde Madde</button>
          <button type="button" data-summary-mode="paragraph" class="${mode === "paragraph" ? "active" : ""}">Paragraf</button>
        </div>
      </div>
      <p id="ai-summary-text">Yükleniyor...</p>
    </div>
  `;
  container.querySelectorAll("[data-summary-mode]").forEach((button) => {
    button.addEventListener("click", () => renderAiSummaryBox(article, button.dataset.summaryMode || "bullets"));
  });
  getAiSummary(article, mode).then(({ text, fromAi, structured }) => {
    if (container.dataset.aiSummaryKey !== renderKey) return;
    const textEl = document.getElementById("ai-summary-text");
    if (textEl) textEl.outerHTML = renderSummaryContent(structured, mode, text);
    const box = container.querySelector(".ai-summary-box");
    if (box && !fromAi) box.classList.add("fallback");
  });
}

/* ============================
   ARTICLE DETAIL
   ============================ */
function scheduleReadDepthTracking(article) {
  if (!article?.id) return;
  const key = String(article.id);
  if (state.readTimers.has(key)) clearTimeout(state.readTimers.get(key));
  const timer = setTimeout(() => {
    state.readTimers.delete(key);
    if (String(state.openArticleId) !== key) return;
    recordUserInteraction(article, "read_30_seconds");
    renderArticles();
    renderReadingInsights();
  }, 30000);
  state.readTimers.set(key, timer);
}

function clearReadDepthTracking(articleId = state.openArticleId) {
  const key = String(articleId || "");
  if (!key || !state.readTimers.has(key)) return;
  clearTimeout(state.readTimers.get(key));
  state.readTimers.delete(key);
}

const SOURCE_COLORS = {
  'habertürk': '#e52222', 'haberturk': '#e52222',
  'cnn türk': '#cc0000', 'cnn turk': '#cc0000', 'cnnturk': '#cc0000',
  'sabah': '#d4000d',
  'anadolu ajansı': '#1e5fa8', 'aa': '#1e5fa8',
  'trt': '#1a5276', 'trt haber': '#1a5276',
  'hürriyet': '#cc0000', 'hurriyet': '#cc0000',
  'milliyet': '#cc0000',
  'ntv': '#003087',
  'a haber': '#e87722', 'ahaber': '#e87722',
  'ensonhaber': '#2980b9',
  'sözcü': '#cc0000', 'sozcu': '#cc0000',
  'default': '#334155'
}

function getSourceColor(name) {
  const key = String(name || '').toLowerCase().trim()
  for (const [pattern, color] of Object.entries(SOURCE_COLORS)) {
    if (key.includes(pattern)) return color
  }
  return SOURCE_COLORS.default
}

function renderSourceLogoHtml(sourceObj, url, sourceName, size = 32) {
  const sLogo = sourceObj?.logo;
  const sFav = sourceObj?.favicon;
  const gFav = url ? getSourceFaviconUrl(url) : null;
  const initials = getSourceInitials(sourceName);
  const color = getSourceColor(sourceName);

  const imageUrl = sLogo || sFav || gFav;
  if (imageUrl) {
    return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(sourceName)}" title="${escapeHtml(sourceName)} kaynağında oku" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; border:1px solid #eaeaea; background:#fff;" onerror="this.outerHTML='<div title=\\'${escapeHtml(sourceName)} kaynağında oku\\' style=\\'width:${size}px; height:${size}px; border-radius:50%; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:${Math.round(size*0.4)}px; font-weight:bold;\\'>${initials}</div>'"/>`;
  }
  return `<div title="${escapeHtml(sourceName)} kaynağında oku" style="width:${size}px; height:${size}px; border-radius:50%; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:${Math.round(size*0.4)}px; font-weight:bold;">${initials}</div>`;
}

function getSourceInitials(name) {
  return String(name || '').split(/[\s\-–]+/).filter(Boolean)
    .slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

function getSourceFaviconUrl(sourceUrl) {
  try {
    const domain = new URL(sourceUrl).hostname
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  } catch {
    return null
  }
}

function renderComparisonPanel(insight = {}) {
  if (insight.mode === "single_source") {
    const singleSections = insight.sections || [];
    return `
      <div class="comparison-single-source">
        <div class="comparison-single-notice">
          <i class="fa-solid fa-info-circle" aria-hidden="true"></i>
          <span>Bu haber tek kaynak üzerinden analiz edilmiştir. Daha kapsamlı karşılaştırma için birden fazla kaynak gerekir.</span>
        </div>
        ${singleSections.map(s => `
          <div class="comparison-single-section">
            <h4>${escapeHtml(s.title)}</h4>
            <ul>${(s.items || []).map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
          </div>
        `).join("")}
      </div>`;
  }

  const sections = [
    { key: 'common', icon: 'fa-link', title: 'Ortak Noktalar', items: insight.commonPoints || [], empty: 'Ortak nokta bulunamadı.' },
    { key: 'different', icon: 'fa-code-compare', title: 'Farklılaşan Noktalar', items: insight.differentPoints || [], empty: 'Belirgin fark bulunamadı.' },
    { key: 'facts', icon: 'fa-chart-bar', title: 'Sayısal Veriler', items: insight.numericalData || [], empty: 'Sayısal veri bulunamadı.' },
    { key: 'tone', icon: 'fa-scale-balanced', title: 'Ton ve Eksikler', items: insight.missingPoints || [], empty: 'Eksik bilgi tespit edilemedi.' }
  ];
  const renderPanel = ({ key, items, empty }, idx) => `
      <div class="reader-accordion-panel ${idx === 0 ? 'open' : ''}" data-acc-panel="${key}">
        ${items.length
          ? `<ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
          : `<p>${escapeHtml(empty)}</p>`}
      </div>`;

  return `
    <div class="comparison-accordions">
      <div class="comparison-tabbar" role="tablist" aria-label="Haber karşılaştırma analizleri">
        ${sections.map((section, idx) => `
          <button class="reader-accordion-toggle ${idx === 0 ? 'active' : ''}" data-acc-toggle="${section.key}" aria-expanded="${idx === 0 ? 'true' : 'false'}" type="button">
            <i class="fa-solid ${section.icon}" aria-hidden="true"></i>
            <span>${section.title}</span>
          </button>
        `).join("")}
      </div>
      <div class="comparison-panel-stack">
        ${sections.map(renderPanel).join("")}
      </div>
    </div>`
}

async function showDetail(articleId) {
  let article = state.data.articles.find((item) => String(item.id) === String(articleId));
  if (!article) return;

  detailPanel.hidden = false;
  document.body.classList.add("reader-open");

  // SKELETON LOADING STATE (Immediate visual feedback)
  detailContent.innerHTML = `
    <div style="padding:40px; display:flex; flex-direction:column; gap:20px; animation: pulse 1.5s infinite ease-in-out;">
      <div style="width:20%; height:20px; background:#e2e8f0; border-radius:4px;"></div>
      <div style="width:80%; height:40px; background:#e2e8f0; border-radius:8px;"></div>
      <div style="width:100%; height:120px; background:#e2e8f0; border-radius:8px; margin-top:20px;"></div>
      <div style="width:60%; height:200px; background:#e2e8f0; border-radius:8px;"></div>
    </div>
  `;

  let duplicates = [];
  let multiSourceAnalysis = null;
  if (state.usingApi) {
    try {
      const payload = await api(`/api/articles/${articleId}`);
      article = toUiArticle(payload.article);
      duplicates = payload.article.duplicates || [];
      multiSourceAnalysis = payload.article.multiSourceAnalysis || null;
    } catch (e) {
      console.error("API Error fetching article details:", e);
      try {
        await loadBackendData({ force: true });
        const refreshedArticle = state.data.articles.find((item) =>
          String(item.id) === String(articleId)
          || (item.sourceUrl && item.sourceUrl === article.sourceUrl)
          || (item.title === article.title && item.source === article.source)
        );
        if (refreshedArticle) {
          article = refreshedArticle;
          const payload = await api(`/api/articles/${encodeURIComponent(refreshedArticle.id)}`);
          article = toUiArticle(payload.article);
          duplicates = payload.article.duplicates || [];
          multiSourceAnalysis = payload.article.multiSourceAnalysis || null;
        }
      } catch (retryError) {
        console.error("API retry fetching article details failed:", retryError);
      }
    }
  }

  state.openArticleId = article.id;
  recordUserInteraction(article, "click");

  const similarArticles = getSimilarArticles(article).slice(0, 8);
  const relatedResults = findRelatedArticles(article, state.data.articles || [], { maxResults: 5 });
  const relatedArticles = relatedResults.map(r => ({ ...r.article, similarityScore: r.score }));
  const comparisonSimilarArticles = duplicates.length ? [] : similarArticles.filter((item) => item.contentStatus === "full_from_source_page");
  const allVersions = normalizeComparisonArticles(article, duplicates, comparisonSimilarArticles);
  let activeVersionIndex = 0;

  function renderView(options = {}) {
    const activeArticle = allVersions[activeVersionIndex] || allVersions[0];
    const comparisonInsight = generateComparisonInsight(activeArticle, allVersions, multiSourceAnalysis?.overallComparison || multiSourceAnalysis || "");

    const hasImage = !!(activeArticle.imageUrl || article.imageUrl);
    const categoryName = activeArticle.category || "Gündem";
    const srcName = activeArticle.sourceName || activeArticle.source || "Bilinmiyor";
    const dateStr = formatDetailDate(activeArticle.publishedAt || activeArticle.date);
    const readTimeStr = activeArticle.readTime || article.readTime || "3 dk";
    // Localized title and summary for detail view
    const detailTitle = getLocalizedText(activeArticle, "title", activeArticle.title || "");
    const detailSummary = getLocalizedText(activeArticle, "summary", activeArticle.contentSnippet || activeArticle.summary || activeArticle.description || "");
    const contentWarningHtml = activeArticle.contentStatus === "source_full_text_unavailable"
      ? `<div class="reader-content-warning" role="note"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>${escapeHtml(activeArticle.contentWarning || "Tam metin alınamadı — RSS açıklaması ve AI özeti gösteriliyor.")}</span></div>`
      : "";

    const currentFeed = state.data.articles || [];
    const currentIndex = currentFeed.findIndex(a => String(a.id) === String(article.id));
    const nextArticle = currentIndex >= 0 && currentIndex < currentFeed.length - 1 ? currentFeed[currentIndex + 1] : null;

    const logoButtonsHtml = allVersions.map((v, idx) => {
      const name = v.sourceName || v.source || "Kaynak";
      const url = v.sourceUrl || v.url || "";
      const faviconUrl = getSourceFaviconUrl(url);
      const initials = getSourceInitials(name);
      const sourceColor = getSourceColor(name);

      const hasFavicon = !!faviconUrl;
      const imgStyle = hasFavicon ? "width:100%;height:100%;object-fit:cover;border-radius:4px;" : "display:none;width:100%;height:100%;object-fit:cover;border-radius:4px;";
      const spanStyle = hasFavicon ? `display:none;width:100%;height:100%;align-items:center;justify-content:center;font-weight:700;font-size:10px;color:white;background:${sourceColor};border-radius:4px;` : `display:flex;width:100%;height:100%;align-items:center;justify-content:center;font-weight:700;font-size:10px;color:white;background:${sourceColor};border-radius:4px;`;

      return `
        <button class="source-logo-btn ${activeVersionIndex === idx ? 'active' : ''}"
                data-version-idx="${idx}"
                title="${escapeHtml(name)}">
          <img src="${escapeHtml(faviconUrl || '')}"
               alt="${escapeHtml(name)}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
               style="${imgStyle}">
          <span class="logo-fallback" style="${spanStyle}">
            ${escapeHtml(initials)}
          </span>
        </button>
      `;
    }).join("");

    const sourceViewingHtml = allVersions.length > 1 ? `
          <div class="source-viewing-indicator">
            <i class="fa-solid fa-eye"></i>
            <span>Bu haber şu anda <strong>${escapeHtml(srcName)}</strong> üzerinden gösteriliyor</span>
            <span style="margin-left:auto;font-size:.72rem;color:#94a3b8;">${allVersions.length} kaynak mevcut</span>
          </div>` : "";

    const newHtml = `
      <div class="interactive-reader-layout">
        <main class="reader-main-column">
          <!-- Logo Buttons -->
          <div class="reader-logos-container">
            ${logoButtonsHtml}
          </div>
          ${sourceViewingHtml}

          <!-- Meta Line -->
          <div class="reader-dynamic-meta" style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:16px; font-size:13px;">
            <span class="reader-category-tag" style="background: ${categoryColor(categoryName)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 800; text-transform: uppercase;">
              ${escapeHtml(categoryName)}
            </span>
            <span class="reader-source-name" style="font-weight:700;">
              ${escapeHtml(srcName)}
            </span>
            <span>·</span>
            <span class="reader-date">
              ${escapeHtml(dateStr)}
            </span>
            <span>·</span>
            <span class="reader-read-time">
              <i class="fa-regular fa-clock"></i> ${escapeHtml(readTimeStr)}
            </span>
          </div>

          ${activeArticle.imageUrl ? `
          <div class="reader-cover-image" style="margin-bottom: 24px; border-radius: 12px; overflow: hidden; max-height: 450px; background: #f0f0f0;">
            <img src="${escapeHtml(activeArticle.imageUrl)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="">
          </div>
          ` : ""}

          <!-- Title -->
          <h2 class="reader-dynamic-title" style="font-family:'Playfair Display', Georgia, serif; font-size:clamp(24px, 4.5vw, 36px); line-height:1.25; margin:0 0 16px 0;">
            ${escapeHtml(detailTitle)}
          </h2>

          <!-- Source Sentences & Deck -->
          ${(activeArticle.sourceSentences && activeArticle.sourceSentences.length > 0) ? `
          <div class="reader-source-sentences-block" style="margin: 0 0 24px 0;">
            <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: ${categoryColor(categoryName)}; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-quote-left" aria-hidden="true"></i> Kaynaktan Alınan Haber Cümleleri
            </div>
            <div class="reader-source-sentences" style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 1.15rem; line-height: 1.7; color: #1a202c; border-left: 5px solid ${categoryColor(categoryName)}; padding-left: 20px; font-style: italic; font-weight: 500; background: #fafbfc; border-radius: 0 8px 8px 0; padding: 16px 16px 16px 20px;">
              ${activeArticle.sourceSentences.map(s => `<p style="margin: 0 0 10px 0;">"${escapeHtml(s)}"</p>`).join("")}
            </div>
          </div>
          ` : ""}

          <p class="reader-deck" style="font-size:1.1rem; line-height:1.6; margin:0 0 24px 0; color: #4a5568;">
            ${escapeHtml(detailSummary)}
          </p>

          <!-- AI Summary Container -->
          <div id="ai-summary-container" style="margin-bottom:24px;"></div>

          <div class="reader-actions-bar">
            <div class="reader-action-group">
              <button type="button" class="action-btn" data-action="bookmark" data-id="${activeArticle.id}">
                <i class="${activeArticle.bookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
                <span>${activeArticle.bookmarked ? 'Kaydedildi' : 'Kaydet'}</span>
              </button>
              <button type="button" class="action-btn" data-action="newspaper" data-id="${activeArticle.id}">
                <i class="fa-solid fa-book-open"></i>
                <span>${state.newspaperArticles.includes(String(activeArticle.id)) ? 'Gazeteden Çıkar' : 'Gazeteye Ekle'}</span>
              </button>
            </div>
            <div class="reader-action-group reader-action-group-secondary" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <a href="${escapeHtml(activeArticle.sourceUrl || activeArticle.url || '#')}" target="_blank" rel="noopener noreferrer" class="action-btn read-original-btn">
                <span>Orijinal Kaynak</span>
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
              ${nextArticle ? `<button type="button" class="action-btn next-article-cta" data-next-id="${escapeHtml(String(nextArticle.id))}">
                <i class="fa-solid fa-arrow-right"></i>
                <span>Sonraki Haberi Oku</span>
              </button>` : ""}
              <div class="modal-share-buttons">
                <div class="modal-user-share" data-modal-share-picker>
                  <div class="modal-user-share-control">
                    <span class="modal-user-share-chip" data-selected-chip hidden></span>
                    <input type="text" data-share-user-input placeholder="Platform içi kullanıcı ara..." autocomplete="off" aria-label="Platform içi kullanıcı ara">
                    <button type="button" class="modal-user-share-clear" data-share-user-clear aria-label="Seçili kullanıcıyı temizle" hidden>
                      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div class="modal-user-share-menu" data-share-user-menu hidden></div>
                </div>
                <button type="button" id="modal-internal-share-btn" class="modal-internal-share-btn" data-article-id="${escapeHtml(String(activeArticle.id))}" disabled>
                  <i class="fa-solid fa-paper-plane"></i> Gönder
                </button>
                <div style="width: 1px; height: 24px; background: #ddd; margin: 0 4px;"></div>
                <a href="https://api.whatsapp.com/send?text=${encodeURIComponent((activeArticle.title || '') + ' - ' + (activeArticle.sourceUrl || activeArticle.url || ''))}" target="_blank" rel="noopener noreferrer" title="WhatsApp'ta Paylaş" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #25D366; color: white; text-decoration: none; box-shadow: 0 2px 4px rgba(37,211,102,0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                  <i class="fa-brands fa-whatsapp" style="font-size: 18px;"></i>
                </a>
                <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(activeArticle.title || '')}&url=${encodeURIComponent(activeArticle.sourceUrl || activeArticle.url || '')}" target="_blank" rel="noopener noreferrer" title="X'te (Twitter) Paylaş" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #000000; color: white; text-decoration: none; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                  <i class="fa-brands fa-x-twitter" style="font-size: 18px;"></i>
                </a>
                <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(activeArticle.sourceUrl || activeArticle.url || '')}" target="_blank" rel="noopener noreferrer" title="Facebook'ta Paylaş" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #1877F2; color: white; text-decoration: none; box-shadow: 0 2px 4px rgba(24,119,242,0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                  <i class="fa-brands fa-facebook-f" style="font-size: 18px;"></i>
                </a>
              </div>
            </div>
          </div>

          <hr style="border:0; border-top:1px solid var(--reader-border); margin:24px 0;">

          <!-- Article Body -->
          <div class="reader-full-text" style="font-size:1.15rem; line-height:1.8; margin-bottom:24px; color: #2d3748; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            ${contentWarningHtml}
            ${renderAnnotatedBody(activeArticle)}
          </div>

          <!-- Related News Section -->
          <div class="reader-related-section">
            <div class="reader-related-heading">
              <span>Bu Haber Başka Kaynaklarda</span>
              ${relatedArticles.length ? `<em>${relatedArticles.length} farklı kaynak bulundu</em>` : ""}
            </div>
            ${relatedArticles.length ? `
            <div class="reader-related-sources-strip">
              ${relatedArticles.map(ra => {
                const raUrl = ra.sourceUrl || ra.url || "";
                const raFavicon = getSourceFaviconUrl(raUrl);
                const raInitials = getSourceInitials(ra.sourceName || ra.source || "");
                const raColor = getSourceColor(ra.sourceName || ra.source || "");
                const scorePercent = Math.round((ra.similarityScore || 0) * 100);
                return `
                  <button class="reader-related-source-btn" data-related-id="${escapeHtml(String(ra.id))}" title="${escapeHtml(ra.title || "")}">
                    <div class="reader-related-logo">
                      ${raFavicon ? `<img src="${escapeHtml(raFavicon)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="rr-logo-fallback" style="display:none;background:${raColor}">${escapeHtml(raInitials)}</span>` : `<span class="rr-logo-fallback" style="background:${raColor}">${escapeHtml(raInitials)}</span>`}
                    </div>
                    <span class="reader-related-name">${escapeHtml(ra.sourceName || ra.source || "Kaynak")}</span>
                    <span class="reader-related-score">${scorePercent}% benzer</span>
                  </button>`;
              }).join("")}
            </div>
            <div class="reader-related-cards">
              ${relatedArticles.slice(0, 3).map(ra => {
                const raSourceName = ra.sourceName || ra.source || "";
                const raSourceUrl = ra.sourceUrl || ra.url || "";
                const raHasSentences = ra.sourceSentences && ra.sourceSentences.length > 0;
                const raExcerpt = raHasSentences
                  ? `"${trimSummary(ra.sourceSentences[0], 100)}"`
                  : trimSummary(ra.contentSnippet || ra.summary || ra.description || "", 120);
                return `
                <div class="reader-related-card" data-related-id="${escapeHtml(String(ra.id))}">
                  <div class="rr-card-top">
                    <span class="rr-card-source-logo">${renderSourceLogoHtml(ra, raSourceUrl, raSourceName, 18)}</span>
                    <span class="rr-card-source">${escapeHtml(raSourceName)}</span>
                    <span class="rr-card-date">${escapeHtml(ra.date || "")}</span>
                  </div>
                  <h4 class="rr-card-title">${escapeHtml(ra.title || "")}</h4>
                  <p class="rr-card-summary ${raHasSentences ? 'rr-card-quote' : ''}">${escapeHtml(raExcerpt)}</p>
                </div>`;
              }).join("")}
            </div>
            ` : `<div class="reader-related-empty"><i class="fa-solid fa-magnifying-glass"></i><p>Bu haber için benzer veya ilgili içerik bulunamadı.</p></div>`}
          </div>
        </main>

        <aside class="reader-analysis-sidebar" aria-label="Yapay zeka analiz seçenekleri">
          <div class="reader-analysis-card">
            <div class="reader-analysis-heading">
              <span>Yapay Zeka Analizi</span>
              <strong>Kaynak Karşılaştırması</strong>
            </div>
            ${renderComparisonPanel(comparisonInsight)}
          </div>
        </aside>
      </div>
    `;

    // Apply fade transition
    detailContent.style.transition = "opacity 180ms ease-in-out";
    detailContent.style.opacity = "0";

    setTimeout(() => {
      detailContent.innerHTML = newHtml;

      // Event handlers inside details modal
      // Logo buttons
      detailContent.querySelectorAll('.source-logo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          activeVersionIndex = parseInt(btn.getAttribute('data-version-idx'), 10);
          renderView({ resetScroll: true });
        });
      });

      // Actions buttons (bookmark, newspaper)
      detailContent.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const action = btn.getAttribute('data-action');
          const id = btn.getAttribute('data-id');
          const art = findArticleForAction(id) || activeArticle;
          await handleArticleAction(action, art);
          renderView();
        });
      });

      initModalSharePicker(detailContent, activeArticle);

      // Accordion toggles
      detailContent.querySelectorAll('[data-acc-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.accToggle;
          detailContent.querySelectorAll('[data-acc-toggle]').forEach((item) => {
            const active = item === btn;
            item.classList.toggle('active', active);
            item.setAttribute('aria-expanded', String(active));
          });
          detailContent.querySelectorAll('[data-acc-panel]').forEach((panel) => {
            panel.classList.toggle('open', panel.dataset.accPanel === key);
          });
        });
      });

      // Next article CTA click
      const nextCta = detailContent.querySelector('.next-article-cta');
      if (nextCta) {
        nextCta.addEventListener('click', () => {
          const nextId = nextCta.getAttribute('data-next-id');
          showDetail(nextId);
        });
      }

      // Related news click handlers
      detailContent.querySelectorAll('[data-related-id]').forEach(btn => {
        btn.addEventListener('click', () => showDetail(btn.getAttribute('data-related-id')));
      });

      // Render the AI Summary Box in bullets mode
      renderAiSummaryBox(activeArticle, "bullets");

      detailContent.style.opacity = "1";

      if (options.resetScroll) {
        detailContent.scrollTop = 0;
      }
    }, 180);
  }

  renderView();
  scheduleReadDepthTracking(article);
  markArticleAsRead(article);
}

/* ============================
   FILTER HELPERS
   ============================ */
function resetFilters() {
  searchInput.value = "";
  categoryFilter.value = "all";
  updateSubcategoryOptions();
  if (subcategoryFilter) subcategoryFilter.value = "Tümü";
  setSelectedRegions(["global"], { render: false });
  if (sourceFilter) sourceFilter.value = "Tümü";
  if (statusFilter) statusFilter.value = "Tümü";
  if (dateFilter) dateFilter.value = "Tümü";
  if (sortFilter) sortFilter.value = "relevance";
  syncFilterStateFromControls();
  state.favoriteFeedOnly = false;
  const favoriteButton = document.querySelector("#favorite-feed");
  favoriteButton?.classList.remove("active");
  if (favoriteButton) favoriteButton.innerHTML = `<i class="fa-solid fa-star"></i> Favori Akışın`;
  state.currentPage = 1;
  renderArticles();
  updatePrintPreview();
}

function currentSearchFilters() {
  const selectedRegions = currentSelectedRegions();
  return {
    query: state.selectedSearchQuery || searchInput?.value?.trim() || "",
    category: state.selectedCategory || categoryFilter?.value || "all",
    subcategory: state.selectedSubcategory || subcategoryFilter?.value || "Tümü",
    continent: selectedRegions.join(","),
    regions: selectedRegions,
    source: state.selectedSource || "Tümü",
    status: state.selectedReadStatus || "Tümü",
    date: state.selectedDate || "Tümü",
    sort: state.selectedSort || sortFilter?.value || "relevance"
  };
}

function applySearchFilters(filters) {
  searchInput.value = filters.query || "";
  categoryFilter.value = categoryValue(filters.category || "all");
  updateSubcategoryOptions();
  if (subcategoryFilter) subcategoryFilter.value = filters.subcategory && filters.subcategory !== "empty" ? normalizeSubcategoryName(filters.subcategory, categoryFilter.value) : "Tümü";
  setSelectedRegions(filters.regions || filters.continent || "global", { render: false });
  if (sourceFilter) sourceFilter.value = filters.source || "Tümü";
  if (statusFilter) statusFilter.value = filters.status || "Tümü";
  if (dateFilter) dateFilter.value = filters.date || "Tümü";
  if (sortFilter) sortFilter.value = filters.sort || "relevance";
  syncFilterStateFromControls();
  state.currentPage = 1;
  updatePrintPreview();
  showFilteredPersonalFeed({ scroll: true });
}

/* ============================
   SAVED SEARCHES
   ============================ */
async function loadSavedSearches() {
  state.savedSearches = [];
  if (savedSearchList) savedSearchList.innerHTML = "";
}

function renderSavedSearches(searches) {
  state.savedSearches = searches;
  if (!savedSearchList) return;
  savedSearchList.innerHTML = searches.length ? searches.map((item) => `
    <article class="saved-search-item">
      <button data-search-action="apply" data-id="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>
      <span>${escapeHtml(item.filters.query || "Tüm haberler")} · ${escapeHtml(categoryLabel(item.filters.category || "all"))} · ${escapeHtml(item.filters.subcategory || "Tümü")} · ${escapeHtml(normalizeSelectedRegions(item.filters.regions || item.filters.continent || "global").map(regionLabel).join(", "))} · ${escapeHtml(item.filters.sort || "relevance")}</span>
      <button data-search-action="delete" data-id="${escapeHtml(item.id)}" aria-label="Kayıtlı aramayı sil">Sil</button>
    </article>
  `).join("") : `<p class="empty-state inline">Kayıtlı arama yok.</p>`;
}

async function saveCurrentSearch() {
  state.savedSearches = [];
}

async function handleSavedSearchAction(action, searchId) {
  if (action === "apply") {
    const search = state.savedSearches.find((s) => s.id === searchId);
    if (!search) return;
    applySearchFilters(search.filters);
    return;
  }
  if (action === "delete") {
    state.savedSearches = [];
  }
}

/* ============================
   READ / BOOKMARK TRACKING
   ============================ */
async function markArticleAsRead(article) {
  if (!article || article.status === "Okundu") return;
  const local = state.data.articles.find((item) => String(item.id) === String(article.id));
  const previous = article.status;
  article.status = "Okundu";
  if (local) local.status = "Okundu";
  try {
    if (state.usingApi) {
      await api(`/api/articles/${article.id}/read`, { method: "POST", body: JSON.stringify({ status: "read" }) });
    }
  } catch (error) {
    article.status = previous;
    if (local) local.status = previous;
  }
  renderArticles();
  renderReadingInsights();
}

function findArticleForAction(id) {
  if (id) {
    const byId = state.data.articles.find((item) => String(item.id) === String(id));
    if (byId) return byId;
  }
  const liveItem = state.data.last24[state.liveIndex];
  const matched = state.data.articles.find((item) => item.title === liveItem?.title && item.source === liveItem?.source);
  if (matched) return matched;
  if (!liveItem) return null;

  const liveArticle = {
    id: liveItem.id || `live_${state.liveIndex + 1}`,
    category: inferArticleCategory(liveItem),
    subcategory: inferArticleSubcategory(liveItem),
    continent: inferArticleContinent(liveItem),
    title: liveItem.title,
    summary: liveItem.summary || "",
    fullText: liveItem.summary || "",
    source: liveItem.source || "",
    date: liveItem.time || new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }),
    dateRange: "Son 24 saat",
    readTime: "3 dk",
    relevance: 80,
    status: "Okunmadı",
    bookmarked: Boolean(liveItem.bookmarked)
  };
  liveItem.id = liveArticle.id;
  state.data.articles.unshift(liveArticle);
  return liveArticle;
}

async function handleArticleAction(action, article) {
  if (!article) return;

  if (action === "detail") { showDetail(article.id); return; }
  if (action === "similar") { openSimilarNewsModal(article.id); return; }

  if (action === "bookmark") {
    const previous = article.bookmarked;
    article.bookmarked = !article.bookmarked;
    try {
      if (state.usingApi) await api(`/api/articles/${article.id}/bookmark`, { method: "POST", body: "{}" });
      state.data.last24
        .filter((item) => String(item.id) === String(article.id) || (item.title === article.title && item.source === article.source))
        .forEach((item) => { item.id = article.id; item.bookmarked = article.bookmarked; });
      if (article.bookmarked) recordUserInteraction(article, "bookmark");
      showToast(article.bookmarked ? "Haber kaydedildi." : "Kaydedilenlerden çıkarıldı.", article.bookmarked ? "success" : "info");
    } catch (error) {
      article.bookmarked = previous;
      showToast(`Kaydetme başarısız: ${error.message}`, "error");
    }
    renderReadingInsights();
  }

  if (action === "read") {
    const previous = article.status;
    article.status = article.status === "Okundu" ? "Okunmadı" : "Okundu";
    try {
      if (state.usingApi) {
        await api(`/api/articles/${article.id}/read`, {
          method: "POST",
          body: JSON.stringify({ status: article.status === "Okundu" ? "read" : "unread" })
        });
      }
      if (article.status === "Okundu") recordUserInteraction(article, "read_30_seconds");
      showToast(article.status === "Okundu" ? "Okundu işaretlendi." : "Okunmadı işaretlendi.", "success");
    } catch (error) {
      article.status = previous;
      showToast(`Durum güncellenemedi: ${error.message}`, "error");
    }
    renderReadingInsights();
  }

  if (action === "newspaper") {
    const id = String(article.id);
    if (state.newspaperArticles.includes(id)) {
      state.newspaperArticles = state.newspaperArticles.filter((item) => item !== id);
      showToast("Gazeteden çıkarıldı.", "info");
    } else {
      state.newspaperArticles.push(id);
      recordUserInteraction(article, "bookmark");
      showToast("Gazeteye eklendi.", "success");
    }
    renderExportArticleOptions();
    renderReadingInsights();
  }
  if (state.activePage === "high-interest") {
    renderHighInterestPage();
  } else {
    renderArticles();
  }
  renderLiveNews();
  renderSourceLogosBar();
  renderSanaOzelGrid();
}

/* ============================
   PROFILE PANEL
   ============================ */
function openProfileDetail() {
  if (!profileDetail) return;
  profileDetail.hidden = false;
  document.body.classList.add("reader-open");
  profileNameInput?.focus();
}

function closeProfileDetail() {
  if (!profileDetail) return;
  profileDetail.hidden = true;
  if (detailPanel?.hidden) document.body.classList.remove("reader-open");
}

/* ============================
   ONBOARDING / AUTH HANDLERS
   ============================ */
function getOnboardingFormValues() {
  const interests = [...onboardingForm.querySelectorAll("input[name='interest']:checked")].map((i) => i.value);
  const readingTimes = [...onboardingForm.querySelectorAll("input[name='readingTime']:checked")].map((i) => i.value);
  const contentDepth = onboardingForm.querySelector("input[name='contentDepth']:checked")?.value || "mixed";
  const readingGoal = Math.max(1, Number(onboardingGoal.value || 10));
  return { interests, readingTimes, contentDepth, readingGoal };
}

function updateOnboardingButtonState() {
  const { interests } = getOnboardingFormValues();
  const submitBtn = document.getElementById("onboarding-submit");
  const counter = document.getElementById("onboarding-interest-counter");
  if (counter) {
    counter.textContent = `${interests.length}/3`;
    counter.classList.toggle("is-complete", interests.length >= 3);
  }
  if (submitBtn) {
    if (interests.length < 3) {
      submitBtn.disabled = true;
      submitBtn.textContent = `En az 3 konu seç (${interests.length}/3)`;
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = pendingRegister
        ? "Hesabı Oluştur ve Akışı Başlat"
        : "Akışımı Başlat";
    }
  }
}

async function completeOnboarding(event) {
  event.preventDefault();
  const { interests, readingTimes, contentDepth, readingGoal } = getOnboardingFormValues();
  if (interests.length < 3) { authStatus.textContent = "En az 3 ilgi alanı seç."; return; }
  const selectedPreferences = normalizePreferences({ interests, readingTimes, contentDepth, readingGoal, language: "tr" });

  authStatus.textContent = pendingRegister ? "Hesabın oluşturuluyor..." : "Akış hazırlanıyor...";
  try {
    if (pendingRegister) {
      // Combined registration: account is only created when onboarding is completed.
      const payload = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: pendingRegister.username,
          email: usernameToEmail(pendingRegister.username),
          password: pendingRegister.password,
          interests: selectedPreferences.interests,
          readingGoal: selectedPreferences.readingGoal,
          readingTimes: selectedPreferences.readingTimes,
          contentDepth: selectedPreferences.contentDepth
        })
      });
      setAuthSession(payload, pendingRegister.username);
      // Send extended preferences as well to be safe.
      await api("/api/profile/preferences", {
        method: "PUT",
        body: JSON.stringify(selectedPreferences)
      });
      pendingRegister = null;
    } else {
      // Existing user completing onboarding.
      const profile = await api("/api/profile").catch(() => ({ user: state.authUser, preferences: {} }));
      const preferences = normalizePreferences({
        ...profile.preferences,
        interests: selectedPreferences.interests,
        readingGoal: selectedPreferences.readingGoal,
        readingTimes: selectedPreferences.readingTimes,
        contentDepth: selectedPreferences.contentDepth,
        language: "tr"
      });
      await api("/api/profile/preferences", { method: "PUT", body: JSON.stringify(preferences) });
      state.data.preferences = preferences;
    }
    state.data.preferences = selectedPreferences;

    localStorage.setItem(onboardingKey(state.authUser?.name), "1");
    authOverlay.hidden = true;
    await initAppData();
  } catch (error) {
    authStatus.textContent = `İşlem başarısız: ${error.message}`;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username) {
    authStatus.textContent = "Kullanıcı adı zorunlu.";
    loginUsername.focus();
    return;
  }
  if (!password) {
    authStatus.textContent = "Şifre zorunlu.";
    loginPassword.focus();
    return;
  }

  const submitButton = loginForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  authStatus.textContent = "Giriş yapılıyor...";
  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: username.includes("@") ? username : usernameToEmail(username), name: username, password })
    });
    setAuthSession(payload, username);
    pendingRegister = null;
    if (localStorage.getItem(onboardingKey(username))) {
      authOverlay.hidden = true;
      await initAppData();
    } else {
      authStatus.textContent = "Önce haber tercihlerini seç.";
      showAuthStep("onboarding");
      updateOnboardingButtonState();
    }
  } catch (error) {
    authStatus.textContent = `Giriş başarısız: ${error.message}`;
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const username = registerUsername.value.trim();
  if (!username) { authStatus.textContent = "Kullanıcı adı zorunlu."; return; }
  if (registerPassword.value.length < 4) { authStatus.textContent = "Şifre en az 4 karakter olmalı."; return; }
  if (registerPassword.value !== registerPasswordRepeat.value) {
    authStatus.textContent = "Şifreler eşleşmiyor.";
    return;
  }
  // No API call yet. The account is only created after the user completes onboarding.
  pendingRegister = { username, password: registerPassword.value };
  authStatus.textContent = "İyi gidiyor. Şimdi tercihlerini seç.";
  showAuthStep("onboarding");
  const backBtn = document.getElementById("onboarding-back");
  if (backBtn) backBtn.hidden = false;
  updateOnboardingButtonState();
}

/* ============================
   MOBILE CATEGORY DRAWER
   ============================ */
function setCategoryDrawerOpen(open) {
  const sidebar = document.getElementById("category-sidebar");
  const backdrop = document.getElementById("category-drawer-backdrop");
  const trigger = document.getElementById("open-category-drawer");
  if (!sidebar || !backdrop) return;
  sidebar.classList.toggle("is-open", open);
  backdrop.hidden = !open;
  document.body.classList.toggle("category-drawer-open", open);
  trigger?.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeCategoryDrawerOnMobile() {
  if (window.matchMedia("(max-width: 860px)").matches) {
    setCategoryDrawerOpen(false);
  }
}

/* ============================
   EVENT LISTENERS
   ============================ */

// Finance Radar controls
["finance-open-settings", "finance-mini-settings"].forEach((id) => {
  document.getElementById(id)?.addEventListener("click", openFinancePreferenceModal);
});
document.getElementById("finance-open-page")?.addEventListener("click", () => showPage("economy"));
document.addEventListener("click", (event) => {
  const sidebarPageButton = event.target.closest("[data-sidebar-page]");
  if (!sidebarPageButton) return;
  showPage(sidebarPageButton.dataset.sidebarPage);
});
document.getElementById("finance-refresh")?.addEventListener("click", async () => {
  await loadFinanceRadar({ force: true });
  showToast(state.finance.error ? state.finance.warning : "Ekonomi Radarı güncellendi.", state.finance.error ? "error" : "success");
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-finance-settings]")) openFinancePreferenceModal();
  if (event.target.closest("[data-finance-close]")) closeFinancePreferenceModal();
  const moveButton = event.target.closest("[data-finance-move]");
  if (moveButton) {
    const row = moveButton.closest("[data-finance-selected]");
    if (!row) return;
    if (moveButton.dataset.financeMove === "up" && row.previousElementSibling) {
      row.parentElement.insertBefore(row, row.previousElementSibling);
    }
    if (moveButton.dataset.financeMove === "down" && row.nextElementSibling) {
      row.parentElement.insertBefore(row.nextElementSibling, row);
    }
  }
  const financeCard = event.target.closest("[data-finance-card]");
  if (financeCard) {
    state.finance.selectedCardId = financeCard.dataset.financeCard;
    renderFinanceDashboard();
  }
});
document.addEventListener("keydown", (event) => {
  const financeCard = event.target.closest?.("[data-finance-card]");
  if (financeCard && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    state.finance.selectedCardId = financeCard.dataset.financeCard;
    renderFinanceDashboard();
  }
});
financePreferenceBody?.addEventListener("change", (event) => {
  if (event.target.matches("[data-finance-symbol]")) updateFinanceSelectedList();
});
document.getElementById("finance-save-preferences")?.addEventListener("click", saveFinancePreferencesFromModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && financePreferenceModal && !financePreferenceModal.hidden) closeFinancePreferenceModal();
});

// Source Follow Center controls
document.getElementById("source-open-page")?.addEventListener("click", () => showPage("sources"));
document.getElementById("source-manage-open")?.addEventListener("click", () => showPage("sources"));
document.getElementById("source-preview-btn")?.addEventListener("click", previewSourceFromForm);
document.getElementById("source-add-btn")?.addEventListener("click", addSourceFromForm);
document.getElementById("source-refresh-btn")?.addEventListener("click", async () => {
  await loadUserSources({ force: true });
  showToast("Kaynak Takip Merkezi güncellendi.", "success");
});
sourcePreviewAddBtn?.addEventListener("click", addSourceFromForm);
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-source-close]")) closeSourcePreviewModal();
  const manageButton = event.target.closest("[data-source-manage], #source-open-page, #source-manage-open");
  if (manageButton) showPage("sources");
  const filterButton = event.target.closest("[data-source-filter]");
  if (filterButton) {
    state.sources.activeFilter = filterButton.dataset.sourceFilter || "all";
    renderSourceCenter();
  }
  const toggleButton = event.target.closest("[data-source-toggle]");
  if (toggleButton) {
    const source = state.sources.list.find((item) => item.id === toggleButton.dataset.sourceToggle);
    if (source) updateSource(source.id, { enabled: !source.enabled });
  }
  const favoriteButton = event.target.closest("[data-source-favorite]");
  if (favoriteButton) {
    const source = state.sources.list.find((item) => item.id === favoriteButton.dataset.sourceFavorite);
    if (source) updateSource(source.id, { favorite: !source.favorite });
  }
  const previewButton = event.target.closest("[data-source-preview-id]");
  if (previewButton) {
    const source = state.sources.list.find((item) => item.id === previewButton.dataset.sourcePreviewId);
    if (source) {
      state.sources.preview = {
        source,
        items: state.sources.contents.filter((item) => item.sourceId === source.id).slice(0, 5),
        status: "cached"
      };
      openSourcePreviewModal(state.sources.preview);
    }
  }
  const deleteButton = event.target.closest("[data-source-delete]");
  if (deleteButton) deleteSource(deleteButton.dataset.sourceDelete);
  const saveContentButton = event.target.closest("[data-source-save-content]");
  if (saveContentButton) saveExternalContentToNewspaper(saveContentButton.dataset.sourceSaveContent);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sourcePreviewModal && !sourcePreviewModal.hidden) closeSourcePreviewModal();
});

// Edition tabs (new nav system)
function activateEditionTab(activeButton, pageName) {
  document.querySelectorAll(".etab[data-page]").forEach((btn) => {
    if (activeButton) {
      btn.classList.toggle("active", btn === activeButton);
      return;
    }
    const isDefaultFeed = pageName === "feed" && btn.dataset.navDefault === "feed";
    const isExactPage = pageName !== "feed" && btn.dataset.page === pageName;
    btn.classList.toggle("active", isDefaultFeed || isExactPage);
  });
}

document.querySelectorAll(".etab[data-page]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const nextPersonalTab = btn.dataset.personalNavTab;
    if (nextPersonalTab && PERSONAL_FEED_TABS[nextPersonalTab]) {
      state.personalFeedTab = nextPersonalTab;
      updatePersonalFeedTabs();
    }

    showPage(btn.dataset.page);
    activateEditionTab(btn, btn.dataset.page);

    const targetId = btn.dataset.scrollTarget;
    if (targetId) {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// Legacy section-list (JS compat, hidden)
document.querySelectorAll(".section-list a[data-page]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showPage(link.dataset.page);
  });
});

// Quick access sidebar buttons
document.querySelectorAll(".sidebar-quick-btn[data-page]").forEach((btn) => {
  btn.addEventListener("click", () => {
    showPage(btn.dataset.page);
    const matchingTab = document.querySelector(`.etab[data-page="${btn.dataset.page}"]`);
    if (matchingTab) activateEditionTab(matchingTab, btn.dataset.page);
  });
});

const debouncedRenderArticles = debounce(() => {
  state.selectedSearchQuery = searchInput?.value?.trim() || "";
  state.currentPage = 1;
  showFilteredPersonalFeed();
}, 300);

// Filter controls
if (searchInput) {
  searchInput.addEventListener("input", debouncedRenderArticles);
  searchInput.addEventListener("change", () => {
    state.selectedSearchQuery = searchInput?.value?.trim() || "";
    state.currentPage = 1;
    showFilteredPersonalFeed({ scroll: true });
  });
}
document.getElementById("region-picker")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-region-value]");
  const mapRegion = event.target.closest("[data-region-map]");
  const region = button?.dataset.regionValue || mapRegion?.dataset.regionMap;
  if (!region) return;
  if (mapRegion) {
    toggleSelectedRegion(region, { render: true, commit: true });
    setFilterPopoverOpen(false);
    showFilteredPersonalFeed({ scroll: true });
  } else {
    toggleSelectedRegion(region, { render: false, commit: false });
  }
});

categoryFilter?.addEventListener("input", () => { updateSubcategoryOptions(); });
categoryFilter?.addEventListener("change", () => { updateSubcategoryOptions(); });

applyFiltersButton?.addEventListener("click", () => {
  syncFilterStateFromControls();
  state.currentPage = 1;
  updatePrintPreview();
  setFilterPopoverOpen(false);
  showFilteredPersonalFeed({ scroll: true });
});

filterToggleButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (filterPopover?.hidden) syncFilterControlsFromState();
  setFilterPopoverOpen(Boolean(filterPopover?.hidden));
});

filterPopover?.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", (event) => {
  if (!filterPopover || filterPopover.hidden) return;
  if (event.target.closest("#search-tools")) return;
  setFilterPopoverOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setFilterPopoverOpen(false);
});

updateFilterToggleState();

// Mobile category drawer controls
const categoryDrawerOpenButton = document.getElementById("open-category-drawer");
const categoryDrawerCloseButton = document.getElementById("close-category-drawer");
const categoryDrawerBackdrop = document.getElementById("category-drawer-backdrop");
categoryDrawerOpenButton?.addEventListener("click", (event) => {
  event.preventDefault();
  setCategoryDrawerOpen(true);
});
categoryDrawerCloseButton?.addEventListener("click", () => setCategoryDrawerOpen(false));
categoryDrawerBackdrop?.addEventListener("click", () => setCategoryDrawerOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setCategoryDrawerOpen(false);
});
window.addEventListener("resize", throttle(() => {
  if (!window.matchMedia("(max-width: 860px)").matches) setCategoryDrawerOpen(false);
}, 250));

// Category nav (sidebar)
document.getElementById("category-nav-list")?.addEventListener("click", async (event) => {
  const starBtn = event.target.closest("button[data-cat-star]");
  if (starBtn) {
    event.preventDefault();
    event.stopPropagation();
    await toggleInterest(starBtn.dataset.catStar);
    renderCategoryNav(state.data.articles || []);
    return;
  }

  const btn = event.target.closest("button[data-cat-filter]");
  if (!btn) return;
  categoryFilter.value = categoryValue(btn.dataset.catFilter);
  updateSubcategoryOptions();
  if (subcategoryFilter) subcategoryFilter.value = "Tümü";
  syncFilterStateFromControls();
  state.currentPage = 1;
  showFilteredPersonalFeed({ scroll: true });
  closeCategoryDrawerOnMobile();
});

[eventCityFilter, eventTypeFilter].forEach((control) => {
  control?.addEventListener("change", async () => {
    state.eventFilters.city = eventCityFilter?.value || "ISTANBUL";
    state.eventFilters.type = eventTypeFilter?.value || "Tümü";
    briefList.innerHTML = `<p class="empty-state inline">Biletix etkinlikleri yükleniyor...</p>`;
    await loadEvents();
    renderEvents();
    renderNotifications();
  });
});

// Interest cloud (sidebar)
document.getElementById("interest-cloud-sidebar")?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-cat-interest]");
  if (!btn) return;
  categoryFilter.value = categoryValue(btn.dataset.catInterest);
  updateSubcategoryOptions();
  if (subcategoryFilter) subcategoryFilter.value = "Tümü";
  syncFilterStateFromControls();
  state.currentPage = 1;
  showFilteredPersonalFeed({ scroll: true });
});

// View toggle (category / normal)
document.getElementById("toggle-category-view")?.addEventListener("click", (event) => {
  state.viewByCategory = !state.viewByCategory;
  const toggleBtn = event.currentTarget;
  toggleBtn.classList.toggle("active", state.viewByCategory);
  toggleBtn.innerHTML = state.viewByCategory
    ? `<i class="fa-solid fa-list"></i> Normal Görünüm`
    : `<i class="fa-solid fa-layer-group"></i> Kategorilere Göre`;
  state.currentPage = 1;
  renderArticles();
});

// "Cat more" button inside category section view
recommendedGrid.addEventListener("click", async (event) => {
  const moreBtn = event.target.closest("button[data-cat-more]");
  if (moreBtn) {
    categoryFilter.value = categoryValue(moreBtn.dataset.catMore);
    updateSubcategoryOptions();
    if (subcategoryFilter) subcategoryFilter.value = "Tümü";
    syncFilterStateFromControls();
    state.viewByCategory = false;
    state.currentPage = 1;
    const toggleBtn = document.getElementById("toggle-category-view");
    if (toggleBtn) {
      toggleBtn.classList.remove("active");
      toggleBtn.innerHTML = `<i class="fa-solid fa-layer-group"></i> Kategorilere Göre`;
    }
    showFilteredPersonalFeed({ scroll: true });
    return;
  }
  const btn = event.target.closest("button[data-action]");
  if (btn) { await handleArticleAction(btn.dataset.action, findArticleForAction(btn.dataset.id)); return; }
  const card = event.target.closest(".article-card[data-drag-article-id]");
  if (card && !event.target.closest("button, a, .card-actions")) {
    await handleArticleAction("detail", findArticleForAction(card.dataset.dragArticleId));
  }
});

todayHeadlineSection?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  await handleArticleAction(btn.dataset.action, findArticleForAction(btn.dataset.id));
});

topicRelated?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  await handleArticleAction(btn.dataset.action, findArticleForAction(btn.dataset.id));
});

topicBack?.addEventListener("click", () => {
  const ret = state.entityReturn;
  state.entityReturn = null;
  const returnPage = ret?.page && ret.page !== "topic" ? ret.page : "feed";
  showPage(returnPage);
  if (ret?.articleId) {
    showDetail(ret.articleId);
  }
});

// Pagination
articlePagination?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-page-number]");
  if (!btn || btn.disabled) return;
  state.currentPage = Number(btn.dataset.pageNumber);
  renderArticles();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// Sort
document.querySelector("#sort-relevance")?.addEventListener("click", () => {
  sortFilter.value = "relevance";
  syncFilterStateFromControls();
  state.currentPage = 1;
  state.data.articles.sort((a, b) => b.relevance - a.relevance);
  showFilteredPersonalFeed({ scroll: true });
});

document.querySelector("#favorite-feed")?.addEventListener("click", (event) => {
  state.favoriteFeedOnly = !state.favoriteFeedOnly;
  event.currentTarget.classList.toggle("active", state.favoriteFeedOnly);
  event.currentTarget.innerHTML = state.favoriteFeedOnly
    ? `<i class="fa-solid fa-star"></i> Favori Akışın (%75+)`
    : `<i class="fa-solid fa-star"></i> Favori Akışın`;
  state.currentPage = 1;
  showFilteredPersonalFeed({ scroll: true });
});


personalTabs?.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-personal-tab]");
  if (!tabButton) return;
  const nextTab = tabButton.dataset.personalTab || "today";
  if (!PERSONAL_FEED_TABS[nextTab]) return;
  state.personalFeedTab = nextTab;
  state.currentPage = 1;
  updatePersonalFeedTabs();
  renderArticles();
});

document.addEventListener("click", (event) => {
  const whyButton = event.target.closest("[data-why-id]");
  if (whyButton) {
    event.preventDefault();
    openRecommendationReasonModal(whyButton.dataset.whyId, whyButton);
    return;
  }
  if (event.target.closest("[data-recommendation-close]")) {
    closeRecommendationReasonModal();
    return;
  }
  if (event.target.closest("[data-start-reading]")) {
    resetFilters();
    document.getElementById("article-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

let lastInterestInfoTrigger = null;

function openInterestInfoModal(trigger = null) {
  if (!interestInfoModal) return;
  lastInterestInfoTrigger = trigger || document.activeElement;
  interestInfoModal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => interestInfoDialog?.focus());
}

function closeInterestInfoModal() {
  if (!interestInfoModal) return;
  interestInfoModal.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastInterestInfoTrigger && typeof lastInterestInfoTrigger.focus === "function") {
    lastInterestInfoTrigger.focus();
  }
}

document.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-interest-info]");
  if (openButton) {
    event.preventDefault();
    openInterestInfoModal(openButton);
    return;
  }
  if (event.target.closest("[data-interest-info-close]")) {
    closeInterestInfoModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && interestInfoModal && !interestInfoModal.hidden) {
    closeInterestInfoModal();
  }
  if (event.key === "Escape" && recommendationReasonModal && !recommendationReasonModal.hidden) {
    closeRecommendationReasonModal();
  }
});

interestInfoOpenButton?.addEventListener("click", (event) => openInterestInfoModal(event.currentTarget));

highInterestOpenButton?.addEventListener("click", () => {
  state.highInterestPanelOpen = !state.highInterestPanelOpen;
  renderHighInterestPanel();
  showPage("feed");
  if (state.highInterestPanelOpen) {
    highInterestSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

highInterestCloseButton?.addEventListener("click", () => {
  state.highInterestPanelOpen = false;
  renderHighInterestPanel();
});

highInterestList?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  await handleArticleAction(btn.dataset.action, findArticleForAction(btn.dataset.id));
});

document.getElementById("hi-page-list")?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  await handleArticleAction(btn.dataset.action, findArticleForAction(btn.dataset.id));
});

document.querySelectorAll("#open-egazete-mode-feed, #open-egazete-mode-hi").forEach((button) => {
  button.addEventListener("click", openEGazeteMode);
});


// Refresh news button
document.getElementById("refresh-news-btn")?.addEventListener("click", async () => {
  clearNewsCaches("MANUAL_REFRESH");
  await loadBackendData({ force: true });
  populateFilters();
  renderStaticLists();
  renderArticles();
  startLiveNews();
  renderSourceLogosBar();
  renderSanaOzelGrid();
  showToast("Haberler güncellendi.", "success");
});

// Clear filters
document.querySelector("#clear-filters")?.addEventListener("click", resetFilters);

// Save search
saveSearchButton?.addEventListener("click", saveCurrentSearch);

// Saved search list
savedSearchList?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-search-action]");
  if (!btn) return;
  await handleSavedSearchAction(btn.dataset.searchAction, btn.dataset.id);
});

// Integration buttons
document.querySelector("#refresh-integrations")?.addEventListener("click", refreshIntegrations);
document.querySelector("#test-news-api")?.addEventListener("click", testNewsApi);
document.querySelector("#test-ai-api")?.addEventListener("click", testAiApi);

// Profile
profileForm?.addEventListener("submit", saveProfile);
resetPreferencesButton?.addEventListener("click", resetProfilePreferences);
logoutButton?.addEventListener("click", logout);
openProfileButton?.addEventListener("click", openProfileDetail);
closeProfileButton?.addEventListener("click", closeProfileDetail);
profileBackdrop?.addEventListener("click", closeProfileDetail);
profileNameInput?.addEventListener("input", () => {
  updateProfileChip(profileNameInput.value);
});
interestList?.addEventListener("change", () => updateProfileCardSummary(profileNameInput?.value));
document.getElementById("profile-reading-times")?.addEventListener("change", () => updateProfileCardSummary(profileNameInput?.value));
document.getElementById("profile-content-depth")?.addEventListener("change", () => updateProfileCardSummary(profileNameInput?.value));
profileAvatarInput?.addEventListener("change", () => {
  const file = profileAvatarInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    profileStatus.textContent = "Lütfen bir görsel dosyası seç.";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(PROFILE_AVATAR_KEY, String(reader.result));
    updateProfileChip(profileNameInput?.value || state.authUser?.name);
    profileStatus.textContent = "Profil resmi güncellendi.";
    showToast("Profil resmi güncellendi.", "success");
  };
  reader.readAsDataURL(file);
});
removeProfileAvatarButton?.addEventListener("click", () => {
  localStorage.removeItem(PROFILE_AVATAR_KEY);
  if (profileAvatarInput) profileAvatarInput.value = "";
  updateProfileChip(profileNameInput?.value || state.authUser?.name);
  if (profileStatus) profileStatus.textContent = "Profil resmi kaldırıldı.";
  showToast("Profil resmi kaldırıldı.", "info");
});
openNotificationsButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleNotifications();
});
notificationPopover?.addEventListener("click", (event) => {
  event.stopPropagation();
  const item = event.target.closest("[data-notification-id]");
  if (!item) return;
  const id = item.dataset.notificationId;
  setStoredReadNotifications([...getStoredReadNotifications(), id]);
  renderNotifications();

  if (id.startsWith("hi:") || id.startsWith("trend:")) {
    const articleId = id.split(":")[1];
    const article = state.data.articles?.find((entry) => String(entry.id) === String(articleId));
    if (article) {
      showPage("feed");
      showDetail(articleId);
    } else {
      showToast("Bu bildirime ait haber bulunamadı.", "error");
    }
  } else if (id.startsWith("personal:")) {
    const parts = id.split(":");
    const dayKey = parts[1];
    selectedCalendarDay = dayKey;
    showPage("calendar");
    renderEditionCalendar();
  } else if (id.startsWith("event:")) {
    showPage("events");
  }

  toggleNotifications(false);
});
markNotificationsReadButton?.addEventListener("click", () => {
  setStoredReadNotifications(getNotificationItems().map((item) => item.id));
  renderNotifications();
  showToast("Bildirimler okundu.", "success");
});
editionCalendarPopover?.addEventListener("click", (event) => {
  const dayButton = event.target.closest("[data-calendar-day]");
  if (!dayButton) return;
  selectedCalendarDay = dayButton.dataset.calendarDay;
  renderEditionCalendar();
});
calendarSaveNoteButton?.addEventListener("click", () => {
  if (!selectedCalendarDay) selectedCalendarDay = dateKey(new Date());
  const note = calendarNoteInput?.value.trim();
  const time = calendarTimeInput?.value;
  if (!note || !time) {
    showToast("Lütfen hem saat hem de hatırlatıcı metni girin.", "error");
    return;
  }
  const data = getCalendarPersonalization();
  const current = data[selectedCalendarDay] || {};
  const reminders = Array.isArray(current.reminders) ? current.reminders : [];
  reminders.push({ time, note });

  data[selectedCalendarDay] = {
    ...current,
    reminders
  };
  saveCalendarPersonalization(data);
  renderEditionCalendar();
  showToast("Hatırlatıcı başarıyla eklendi.", "success");
});
document.addEventListener("click", () => toggleNotifications(false));
window.addEventListener("resize", throttle(positionNotificationPopover, 250));
window.addEventListener("scroll", throttle(positionNotificationPopover, 100), true);

// Dark mode live preview
darkModeToggle?.addEventListener("change", () => {
  applyReadabilityPreferences(normalizePreferences({
    darkMode: darkModeToggle.checked,
    fontScale: Number(fontSizeRange.value),
    notifications: notificationToggle?.checked,
    readingGoal: Number(readingGoalInput?.value),
    interests: [...interestList.querySelectorAll("input[type='checkbox']:checked")].map((i) => i.value)
  }));
});

fontSizeRange?.addEventListener("input", () => {
  const preferences = normalizePreferences({
    ...state.data.preferences,
    fontScale: Number(fontSizeRange.value)
  });
  state.data.preferences = preferences;
  applyReadabilityPreferences(preferences);
});

// Active filter chips delegation
document.getElementById("active-filter-chips")?.addEventListener("click", (event) => {
  const chip = event.target.closest(".filter-chip[data-chip-index]");
  if (chip) {
    const idx = Number(chip.dataset.chipIndex);
    const container = document.getElementById("active-filter-chips");
    if (container?._chipActions?.[idx]) {
      container._chipActions[idx]();
      syncFilterStateFromControls();
      state.currentPage = 1;
      showFilteredPersonalFeed({ scroll: true });
    }
    return;
  }
  if (event.target.closest("#clear-all-chips")) {
    resetFilters();
  }
});

// Expand/collapse summary in article cards (event delegation on recommended grid)
recommendedGrid?.addEventListener("click", (event) => {
  const expandBtn = event.target.closest(".expand-summary-btn");
  if (!expandBtn) return;
  const card = expandBtn.closest(".article-card");
  if (!card) return;
  const shortEl = card.querySelector(".card-summary");
  const fullEl = card.querySelector(".card-summary-full");
  if (!shortEl || !fullEl) return;
  const isExpanded = !fullEl.hidden;
  fullEl.hidden = isExpanded;
  shortEl.hidden = !isExpanded;
  expandBtn.textContent = isExpanded ? "Devamını oku" : "Gizle";
});

// Similar news button delegation
document.addEventListener("click", (event) => {
  const similarBtn = event.target.closest(".similar-btn[data-similar-id]");
  if (similarBtn) openSimilarNewsModal(similarBtn.dataset.similarId);
});

// Similar news modal close
document.getElementById("similar-news-close")?.addEventListener("click", closeSimilarNewsModal);
document.getElementById("similar-news-backdrop")?.addEventListener("click", closeSimilarNewsModal);
document.getElementById("similar-news-list")?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  closeSimilarNewsModal();
  await handleArticleAction(btn.dataset.action, findArticleForAction(btn.dataset.id));
});

// Trend click — filter by keyword
document.addEventListener("click", (event) => {
  const detailsToggle = event.target.closest("[data-trend-toggle]");
  if (!detailsToggle) return;
  event.preventDefault();
  event.stopPropagation();
  toggleTrendDetails(detailsToggle.dataset.trendToggle);
}, true);

headlineList?.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-trend-page]");
  if (pageButton) {
    const totalPages = Math.max(1, Math.ceil(buildTrendPanelItems(8).length / TREND_PANEL_PAGE_SIZE));
    state.trendPage += pageButton.dataset.trendPage === "next" ? 1 : -1;
    state.trendPage = Math.min(Math.max(0, state.trendPage), totalPages - 1);
    renderTrendPanel();
    return;
  }
  const trendBtn = event.target.closest(".trend-title[data-trend-search]");
  if (!trendBtn) return;
  const kw = trendBtn.dataset.trendSearch;
  if (kw && searchInput) {
    searchInput.value = kw;
    syncFilterStateFromControls();
    state.currentPage = 1;
    showFilteredPersonalFeed({ scroll: true });
  }
});

// Auth forms
loginForm?.addEventListener("submit", handleLogin);
registerForm?.addEventListener("submit", handleRegister);
onboardingForm?.addEventListener("submit", completeOnboarding);
onboardingForm?.addEventListener("change", updateOnboardingButtonState);
onboardingForm?.addEventListener("input", updateOnboardingButtonState);

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;
    const showPassword = input.type === "password";
    input.type = showPassword ? "text" : "password";
    button.setAttribute("aria-label", showPassword ? "Şifreyi gizle" : "Şifreyi göster");
    button.innerHTML = showPassword ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
  });
});

const moodButton = document.querySelector(".mood-button");
const moodOptions = document.querySelector("#mood-options");
const moodSelect = document.querySelector("#mood-select");
const moodCurrent = document.querySelector("#mood-current");

moodButton?.addEventListener("click", () => {
  const isOpen = !moodOptions.hidden;
  moodOptions.hidden = isOpen;
  moodButton.setAttribute("aria-expanded", String(!isOpen));
});

moodOptions?.addEventListener("click", (event) => {
  const option = event.target.closest("[data-mood-value]");
  if (!option) return;
  const value = option.dataset.moodValue;
  if (moodCurrent) moodCurrent.textContent = value;
  if (moodSelect) moodSelect.value = value;
  moodOptions.hidden = true;
  moodButton?.setAttribute("aria-expanded", "false");
});

document.addEventListener("click", (event) => {
  if (!moodOptions || moodOptions.hidden) return;
  if (event.target.closest(".mood-selector")) return;
  moodOptions.hidden = true;
  moodButton?.setAttribute("aria-expanded", "false");
});

// "Back" button in onboarding (return to register form)
document.getElementById("onboarding-back")?.addEventListener("click", () => {
  showAuthStep("register");
  authStatus.textContent = "";
});

// Auth tab buttons reset pending register flow
document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    authStatus.textContent = "";
    // Cancel any half-completed register if user switches tab
    if (btn.dataset.authTab !== "onboarding") {
      pendingRegister = null;
      const backBtn = document.getElementById("onboarding-back");
      if (backBtn) backBtn.hidden = true;
    }
    showAuthStep(btn.dataset.authTab);
  });
});

// Article detail close
detailContent?.addEventListener("click", (event) => {
  const entityButton = event.target.closest("button[data-entity]");
  if (!entityButton) return;
  openEntityPage(entityButton.dataset.entity);
});

document.querySelector("#close-detail")?.addEventListener("click", () => {
  clearReadDepthTracking();
  detailPanel.hidden = true;
  state.openArticleId = null;
  detailContent.innerHTML = ""; // FREE MEMORY
  if (profileDetail?.hidden) document.body.classList.remove("reader-open");
});
readerBackdrop?.addEventListener("click", () => {
  clearReadDepthTracking();
  detailPanel.hidden = true;
  state.openArticleId = null;
  detailContent.innerHTML = ""; // FREE MEMORY
  if (profileDetail?.hidden) document.body.classList.remove("reader-open");
});

// HeroSlider actions are bound internally by HeroSlider class — no listener needed here.

// Headlines sidebar
headlineList?.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  await handleArticleAction(btn.dataset.action, findArticleForAction(btn.dataset.id));
});

// Events
briefList?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-event-action]");
  if (!btn) return;
  await handleEventAction(btn.dataset.eventAction, btn.dataset.id);
});

// Export
enhanceExportLayoutChoices();
printEditionButton?.addEventListener("click", openPrintPreview);
downloadPdfButton?.addEventListener("click", downloadPdf);
document.querySelector("#auto-pdf-btn")?.addEventListener("click", buildInterestBasedPdfSelection);
document.querySelectorAll("input[name='layout']").forEach((input) => {
  input.addEventListener("change", () => {
    state.exportPreviewPage = 0;
    updatePrintPreview();
  });
});
printPreview?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-export-page]");
  if (!button) return;
  const pages = buildNewspaperPdfPages();
  const direction = button.dataset.exportPage;
  if (direction === "prev") state.exportPreviewPage = Math.max(0, (state.exportPreviewPage || 0) - 1);
  if (direction === "next") state.exportPreviewPage = Math.min(pages.length - 1, (state.exportPreviewPage || 0) + 1);
  updatePrintPreview();
});
exportArticleList?.addEventListener("change", updatePrintPreview);
exportArticleList?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-remove-newspaper]");
  if (!btn) return;
  state.newspaperArticles = state.newspaperArticles.filter((id) => id !== String(btn.dataset.removeNewspaper));
  renderExportArticleOptions();
  renderArticles();
});

// Keyboard shortcuts
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (profileDetail && !profileDetail.hidden) { closeProfileDetail(); return; }
  if (!detailPanel.hidden) { detailPanel.hidden = true; document.body.classList.remove("reader-open"); }
});

/* ============================
   PUSH NOTIFICATION MANAGER (Priority 16)
   ============================ */
const PUSH_NOTIF_KEY = "smartNewspaper_sentNotifIds";
const PUSH_NOTIF_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour minimum between same-topic pushes
let pushNotifCheckInterval = null;

function getSentPushIds() {
  try { return JSON.parse(localStorage.getItem(PUSH_NOTIF_KEY) || "[]"); } catch { return []; }
}

function markPushSent(id) {
  const ids = getSentPushIds();
  if (!ids.includes(id)) {
    ids.push(id);
    try { localStorage.setItem(PUSH_NOTIF_KEY, JSON.stringify(ids.slice(-100))); } catch { }
  }
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

function sendPushBrowserNotification(title, body, icon = "/favicon.ico") {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon });
  } catch { }
}

async function checkAndSendPushNotifications() {
  const preferences = normalizePreferences(state.data.preferences);
  if (!preferences.notifications) return;
  if (!(await requestNotificationPermission())) return;

  const sentIds = getSentPushIds();
  const articles = Array.isArray(state.data?.articles) ? state.data.articles : [];
  const threshold = preferences.notificationThreshold;
  const types = preferences.notificationTypes;

  if (types.highInterest) {
    const top = articles
      .filter((a) => clampScore(a.relevance || 0) >= threshold && !sentIds.includes(`push:hi:${a.id}`))
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .slice(0, 1);

    for (const article of top) {
      sendPushBrowserNotification(
        `Sana Özel: ${article.title.slice(0, 60)}`,
        `%${clampScore(article.relevance)} ilgi puanı · ${article.source || ""}`
      );
      markPushSent(`push:hi:${article.id}`);
    }
  }

  if (types.trends) {
    const trends = computeTrendGroups().slice(0, 1);
    for (const g of trends) {
      const id = `push:trend:${g.representative.id}`;
      if (!sentIds.includes(id) && g.sources.size >= 3) {
        sendPushBrowserNotification(
          `Trend: ${g.representative.title.slice(0, 60)}`,
          `${g.articles.length} haber, ${g.sources.size} kaynak — ${trendReason(g)}`
        );
        markPushSent(id);
      }
    }
  }

  renderNotifications();
}

function startPushNotificationScheduler() {
  if (pushNotifCheckInterval) clearInterval(pushNotifCheckInterval);
  checkAndSendPushNotifications();
  pushNotifCheckInterval = setInterval(checkAndSendPushNotifications, PUSH_NOTIF_COOLDOWN_MS);
}

async function initAppData() {
  showPage("feed");
  renderSidebarSourceNews();
  renderSidebarEconomyData();
  const financePromise = loadFinanceRadar();
  const sourcesPromise = loadUserSources();
  const eventsPromise = loadEvents();
  await loadBackendData();
  await loadProfile();
  await financePromise;
  await sourcesPromise;
  await eventsPromise;
  populateFilters();
  renderStaticLists();
  renderEvents();
  renderArticles();
  renderPersonalBriefHeader();
  renderExportArticleOptions();
  startLiveNews();
  refreshIntegrations();
  updateEditionStrip();
  renderEditionCalendar();
  renderInterestCloud();
  renderPersonaChips();
  applyReadingTimeBanner();
  renderPersonalizedBanner();
  renderNotifications();
  showPage("feed");
  updateLastFetchedDisplay();
  setInterval(updateLastFetchedDisplay, 60000);
  startPushNotificationScheduler();
  initLangToggle();
  initCalendarStore(api, state.usingApi);
  initCalendarPanel(showToast);
  initReminderManager((event, notif) => {
    showToast(notif.message, "info");
    renderNotifications();
  });
}

async function init() {
  if (!state.authToken) {
    showAuthStep("register");
    authOverlay.hidden = false;
    return;
  }
  if (!localStorage.getItem(onboardingKey(state.authUser?.name))) {
    showAuthStep("onboarding");
    authOverlay.hidden = false;
    updateOnboardingButtonState();
    return;
  }
  authOverlay.hidden = true;
  await initAppData();
}

// Color Presets logic
function initColorPresets() {
  const readerPanel = document.querySelector(".reader-panel");
  const presets = document.querySelectorAll(".color-preset");
  if (!readerPanel || !presets.length) return;

  // Load saved colors
  const savedText = localStorage.getItem('readerTextColor');
  const savedBg   = localStorage.getItem('readerBgColor');
  if (savedText && savedBg) {
    readerPanel.style.setProperty('--reader-ink',   savedText);
    readerPanel.style.setProperty('--reader-paper', savedBg);
    
    // Set active button
    presets.forEach(btn => {
      const isMatching = btn.dataset.text === savedText && btn.dataset.bg === savedBg;
      btn.classList.toggle('active', isMatching);
    });
  }

  // Bind click listeners
  presets.forEach(btn => {
    btn.addEventListener('click', () => {
      const textColor = btn.dataset.text;
      const bgColor   = btn.dataset.bg;
      readerPanel.style.setProperty('--reader-ink',   textColor);
      readerPanel.style.setProperty('--reader-paper', bgColor);
      presets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      localStorage.setItem('readerTextColor', textColor);
      localStorage.setItem('readerBgColor',   bgColor);
    });
  });
}

// Initialize counters/state on form ready
document.addEventListener("DOMContentLoaded", () => {
  updateOnboardingButtonState();
  initColorPresets();
});

window.toggleInterest = toggleInterest;
window.openAddInterestMenu = openAddInterestMenu;

const chatbot = new Chatbot({
  getToken: () => state.authToken || localStorage.getItem("newspaperAuthToken") || ""
});

// ===================== NEWS SHARING (DRAG & DROP) =====================
(function initShareSystem() {
  let sharePanel = null;
  let shareUserList = null;
  let dragArticleId = null;
  let shareUsers = [];

  function buildSharePanel() {
    if (document.getElementById("share-drop-panel")) return;
    const panel = document.createElement("div");
    panel.id = "share-drop-panel";
    panel.className = "share-drop-panel";
    panel.innerHTML = `
      <div class="share-panel-header">
        <i class="fa-solid fa-paper-plane"></i>
        <span>Haber Paylaş</span>
        <button type="button" class="share-panel-close" title="Kapat">&times;</button>
      </div>
      <div class="share-panel-hint">Bir haberi sürükleyip kullanıcı üzerine bırakın</div>
      <div id="share-user-list" class="share-user-list"></div>
      <div id="share-inbox-section" class="share-inbox-section">
        <div class="share-inbox-header"><i class="fa-solid fa-inbox"></i> Gelen Haberler</div>
        <div id="share-inbox-list" class="share-inbox-list"></div>
      </div>
    `;
    document.body.appendChild(panel);
    sharePanel = panel;
    shareUserList = document.getElementById("share-user-list");
    panel.querySelector(".share-panel-close").addEventListener("click", () => {
      panel.classList.remove("open");
    });
  }

  async function loadShareUsers() {
    try {
      const res = await api("/api/users/list");
      shareUsers = res.users || [];
      renderShareUsers();
    } catch { shareUsers = []; }
  }

  function renderShareUsers() {
    if (!shareUserList) return;
    if (shareUsers.length === 0) {
      shareUserList.innerHTML = '<div class="share-empty">Henüz başka kullanıcı yok</div>';
      return;
    }
    shareUserList.innerHTML = shareUsers.map((u) => `
      <div class="share-user-item" data-share-user-id="${escapeHtml(u.id)}" data-share-user-name="${escapeHtml(u.name)}">
        <div class="share-user-avatar">${escapeHtml((u.name || "?")[0].toUpperCase())}</div>
        <span class="share-user-name">${escapeHtml(u.name)}</span>
      </div>
    `).join("");
  }

  async function loadSharedInbox() {
    try {
      const res = await api("/api/shared-with-me");
      const list = document.getElementById("share-inbox-list");
      if (!list) return;
      const shares = res.shares || [];
      if (shares.length === 0) {
        list.innerHTML = '<div class="share-empty">Henüz paylaşılan haber yok</div>';
        return;
      }
      list.innerHTML = shares.slice(0, 10).map((s) => `
        <div class="share-inbox-item ${s.read ? "read" : "unread"}" data-share-id="${escapeHtml(s.id)}" data-article-id="${escapeHtml(s.articleId)}">
          <div class="share-inbox-from"><i class="fa-solid fa-user"></i> ${escapeHtml(s.fromUserName || s.senderName || "Birisi")}</div>
          <div class="share-inbox-title">${escapeHtml(s.articleTitle)}</div>
          <div class="share-inbox-time">${escapeHtml(new Date(s.createdAt).toLocaleString("tr-TR"))}</div>
        </div>
      `).join("");
      list.querySelectorAll(".share-inbox-item").forEach((item) => {
        item.addEventListener("click", async () => {
          const articleId = item.dataset.articleId;
          const shareId = item.dataset.shareId;
          if (!item.classList.contains("read")) {
            try { await api("/api/shared/read", { method: "PUT", body: JSON.stringify({ shareId }) }); } catch {}
            item.classList.add("read");
            item.classList.remove("unread");
          }
          showDetail(articleId);
        });
      });
    } catch {}
  }

  async function shareArticle(articleId, targetUserId, targetName) {
    try {
      await api(`/api/articles/${articleId}/share`, { method: "POST", body: JSON.stringify({ targetUserId }) });
      showToast(`Haber "${targetName}" ile paylaşıldı!`);
    } catch {
      showToast("Paylaşım başarısız oldu.");
    }
  }

  function showToast(msg) {
    const existing = document.querySelector(".share-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "share-toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  document.addEventListener("dragstart", (e) => {
    const card = e.target.closest("[data-drag-article-id]");
    if (!card) return;
    dragArticleId = card.dataset.dragArticleId;
    e.dataTransfer.setData("text/plain", dragArticleId);
    e.dataTransfer.effectAllowed = "copy";
    if (sharePanel) sharePanel.classList.add("open", "drag-active");
  });

  document.addEventListener("dragend", () => {
    dragArticleId = null;
    if (sharePanel) sharePanel.classList.remove("drag-active");
  });

  document.addEventListener("dragover", (e) => {
    if (e.target.closest(".share-user-item")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      e.target.closest(".share-user-item").classList.add("drag-over");
    }
  });

  document.addEventListener("dragleave", (e) => {
    const item = e.target.closest(".share-user-item");
    if (item) item.classList.remove("drag-over");
  });

  document.addEventListener("drop", (e) => {
    const item = e.target.closest(".share-user-item");
    if (!item) return;
    e.preventDefault();
    item.classList.remove("drag-over");
    const articleId = e.dataTransfer.getData("text/plain") || dragArticleId;
    const targetUserId = item.dataset.shareUserId;
    const targetName = item.dataset.shareUserName;
    if (articleId && targetUserId) shareArticle(articleId, targetUserId, targetName);
  });

  const shareToggleBtn = document.createElement("button");
  shareToggleBtn.className = "share-fab";
  shareToggleBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i>';
  shareToggleBtn.title = "Haber Paylaş";
  shareToggleBtn.addEventListener("click", () => {
    if (!sharePanel) buildSharePanel();
    sharePanel.classList.toggle("open");
    if (sharePanel.classList.contains("open")) {
      loadShareUsers();
      loadSharedInbox();
    }
  });
  document.body.appendChild(shareToggleBtn);

  buildSharePanel();
  if (state.authToken || localStorage.getItem("newspaperAuthToken")) {
    loadShareUsers();
    loadSharedInbox();
  }
})();

init();
