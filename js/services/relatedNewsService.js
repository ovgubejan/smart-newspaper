/**
 * Related News Service — Gelişmiş haber eşleştirme ve benzerlik skorlama.
 *
 * Skorlama ağırlıkları (config ile ayarlanabilir):
 *   NLP / semantic similarity : %50
 *   Başlık benzerliği         : %20
 *   İçerik / özet benzerliği  : %15
 *   Tarih yakınlığı           : %10
 *   Kategori / etiket uyumu   : %5
 *
 * İleride Gemini/OpenAI embedding servisine bağlanabilecek şekilde modüler.
 */

const CONFIG = {
  weights: {
    nlpSemantic: 0.50,
    title: 0.20,
    content: 0.15,
    dateProximity: 0.10,
    categoryTag: 0.05
  },
  threshold: 0.28,
  maxResults: 5,
  maxTimeWindowHours: 72,
  minTokenLength: 2
};

// --- Turkish NLP ---

const TR_STOPWORDS = new Set([
  "bir","bu","ve","ile","da","de","ki","mi","mu","mü","ne","o","şu","için",
  "olan","en","çok","var","daha","gibi","kadar","sonra","önce","ise","ya",
  "veya","ancak","fakat","ama","her","hem","bile","diye","eğer","çünkü",
  "yani","artık","zaten","hiç","nasıl","neden","hangi","kendi","diğer",
  "tüm","bazı","pek","hep","göre","karşı","rağmen","haber","son","yeni",
  "bugün","dün","oldu","etti","dedi","olan","eden","olarak","tarafından",
  "üzere","itibaren","dolayı","nedeniyle","açıkladı","belirtti","konuştu",
  "the","and","for","from","with","that","this","are","was","has","been",
  "will","have","had","not","but","they","said","its","his","her","also",
  "about","more","after","which","their","would","other","into","could",
  "than","been","only","over","such","where","most","some","these","many"
]);

const TR_SUFFIXES = [
  "ından","inden","undan","ünden","ndan","nden",
  "ının","inin","unun","ünün","nın","nin","nun","nün",
  "ında","inde","unda","ünde","nda","nde",
  "ları","leri","lar","ler",
  "yla","yle","la","le",
  "dan","den","tan","ten",
  "da","de","ta","te",
  "ya","ye","na","ne",
  "yı","yi","yu","yü",
  "ın","in","un","ün",
  "ca","ce","ça","çe"
].sort((a, b) => b.length - a.length);

function stemTurkish(word) {
  const base = String(word || "").split(/['‘’']/)[0].toLowerCase();
  for (const suffix of TR_SUFFIXES) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 3) {
      return base.slice(0, -suffix.length);
    }
  }
  return base;
}

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/['''‘’][a-züğışçöâîû]*/g, "")
    .replace(/[.,!?;:()[\]{}"'\/\\<>@#$%^&*+=|~`\-–—]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > CONFIG.minTokenLength && !TR_STOPWORDS.has(w))
    .map(stemTurkish);
}

// --- TF-IDF ---

function buildTfVector(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function buildCorpusIdf(documents) {
  const N = documents.length;
  const df = new Map();
  for (const doc of documents) {
    const unique = new Set(doc);
    for (const term of unique) df.set(term, (df.get(term) || 0) + 1);
  }
  const idf = new Map();
  for (const [term, freq] of df) {
    idf.set(term, Math.log((N + 1) / (freq + 1)) + 1);
  }
  return idf;
}

function cosineSimilarity(tokensA, tokensB, idf) {
  const tfA = buildTfVector(tokensA);
  const tfB = buildTfVector(tokensB);
  const allTerms = new Set([...tfA.keys(), ...tfB.keys()]);
  let dotProduct = 0, magA = 0, magB = 0;
  for (const term of allTerms) {
    const idfVal = idf.get(term) || 1;
    const a = (tfA.get(term) || 0) * idfVal;
    const b = (tfB.get(term) || 0) * idfVal;
    dotProduct += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
}

// --- Named Entity Overlap ---

const KNOWN_ENTITIES = new Set([
  "chp","akp","mhp","dem","iyi","tbmm","trt","tsk","mgk","meb","tcmb",
  "spk","bddk","epdk","btk","ysk","nato","ab","bm","imf","uefa","fifa",
  "aa","iha","dha","tff","bist","tpao","ted","who","fbi","cia","un",
  "eu","ecb","fed","opec","g7","g20","nba","nfl","f1"
]);

function extractEntities(text) {
  if (!text) return new Set();
  const result = new Set();
  const raw = String(text);
  const lower = raw.toLowerCase();
  for (const ent of KNOWN_ENTITIES) {
    if (lower.includes(ent)) result.add(ent);
  }
  const properNouns = raw.match(/[A-ZÇĞİÖŞÜ][a-zçğışöü]{2,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]{2,}){0,2}/g) || [];
  const SKIP = new Set(["Son","Yeni","Haber","Bugün","Dünya","Türkiye","Istanbul","Ankara"]);
  for (const name of properNouns) {
    const first = name.split(/\s+/)[0];
    if (!SKIP.has(first) && first.length >= 3) {
      result.add(stemTurkish(first));
    }
  }
  const numbers = raw.match(/\d+[.,]?\d*\s*%/g) || [];
  for (const n of numbers) result.add("NUM_" + n.replace(/\s/g, ""));
  return result;
}

function entityOverlap(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const e of setA) if (setB.has(e)) shared++;
  return shared / Math.max(setA.size, setB.size);
}

// --- Scoring Functions ---

function titleSimilarity(titleA, titleB, idf) {
  const tA = tokenize(titleA);
  const tB = tokenize(titleB);
  return cosineSimilarity(tA, tB, idf);
}

function contentSimilarity(articleA, articleB, idf) {
  const textA = `${articleA.summary || ""} ${articleA.description || ""} ${(articleA.fullText || "").slice(0, 500)}`;
  const textB = `${articleB.summary || ""} ${articleB.description || ""} ${(articleB.fullText || "").slice(0, 500)}`;
  const tA = tokenize(textA);
  const tB = tokenize(textB);
  return cosineSimilarity(tA, tB, idf);
}

function nlpSemanticScore(articleA, articleB, idf) {
  const fullA = `${articleA.title || ""} ${articleA.title || ""} ${articleA.summary || ""} ${articleA.description || ""} ${(articleA.fullText || "").slice(0, 800)}`;
  const fullB = `${articleB.title || ""} ${articleB.title || ""} ${articleB.summary || ""} ${articleB.description || ""} ${(articleB.fullText || "").slice(0, 800)}`;
  const tokA = tokenize(fullA);
  const tokB = tokenize(fullB);

  const tfidfScore = cosineSimilarity(tokA, tokB, idf);

  const entA = extractEntities(fullA);
  const entB = extractEntities(fullB);
  const entScore = entityOverlap(entA, entB);

  return tfidfScore * 0.65 + entScore * 0.35;
}

function dateProximityScore(articleA, articleB) {
  const tA = new Date(articleA.publishedAt || articleA.date || 0).getTime();
  const tB = new Date(articleB.publishedAt || articleB.date || 0).getTime();
  if (!tA || !tB || tA < 1000000 || tB < 1000000) return 0.3;
  const hours = Math.abs(tA - tB) / 3600000;
  if (hours > CONFIG.maxTimeWindowHours) return 0;
  if (hours <= 2) return 1;
  if (hours <= 6) return 0.9;
  if (hours <= 12) return 0.75;
  if (hours <= 24) return 0.55;
  if (hours <= 48) return 0.35;
  return 0.15;
}

const CATEGORY_MAP = {
  politics: ["gündem","politika","türkiye","yerel","toplum","güvenlik","siyaset"],
  world: ["dünya","uluslararası","global","diplomasi","world","international"],
  economy: ["ekonomi","finans","borsa","döviz","enflasyon","piyasa","economy","business","finance"],
  sports: ["spor","futbol","basketbol","voleybol","formula","transfer","sports"],
  tech: ["teknoloji","yapay zeka","yazılım","donanım","mobil","siber","technology","tech","science"],
  science: ["bilim","uzay","iklim","doğa","akademik","araştırma","çevre"],
  health: ["sağlık","tıp","hastane","ilaç","tedavi","pandemi","health"],
  culture: ["kültür","sanat","sinema","müzik","kitap","tiyatro","eğlence","magazin","entertainment"]
};

function getCategoryGroup(category) {
  if (!category) return null;
  const lower = String(category).toLowerCase();
  for (const [group, aliases] of Object.entries(CATEGORY_MAP)) {
    if (aliases.some(a => lower.includes(a))) return group;
  }
  return null;
}

function categoryTagScore(articleA, articleB) {
  const gA = getCategoryGroup(articleA.category);
  const gB = getCategoryGroup(articleB.category);
  if (!gA || !gB) return 0.5;
  if (gA === gB) return 1;
  return 0;
}

// --- URL Dedup ---

function sameSource(a, b) {
  const srcA = String(a?.sourceName || a?.source || "").toLowerCase().trim();
  const srcB = String(b?.sourceName || b?.source || "").toLowerCase().trim();
  return srcA && srcB && srcA === srcB;
}

function sameUrl(a, b) {
  const uA = String(a?.sourceUrl || a?.url || "").trim().toLowerCase();
  const uB = String(b?.sourceUrl || b?.url || "").trim().toLowerCase();
  return uA.startsWith("http") && uA.length > 20 && uA === uB;
}

// --- Main API ---

function buildArticleDocument(article) {
  return tokenize(
    `${article.title || ""} ${article.title || ""} ${article.summary || ""} ` +
    `${article.description || ""} ${(article.fullText || "").slice(0, 600)}`
  );
}

let _idfCache = null;
let _idfArticleCount = 0;

function getCorpusIdf(articles) {
  if (_idfCache && _idfArticleCount === articles.length) return _idfCache;
  const docs = articles.map(buildArticleDocument);
  _idfCache = buildCorpusIdf(docs);
  _idfArticleCount = articles.length;
  return _idfCache;
}

export function computeRelatedScore(articleA, articleB, idf) {
  if (sameUrl(articleA, articleB)) return 0;

  const dateScore = dateProximityScore(articleA, articleB);
  if (dateScore === 0) return 0;

  const nlpScore = nlpSemanticScore(articleA, articleB, idf);
  const titleScore = titleSimilarity(
    articleA.title || "", articleB.title || "", idf
  );
  const contScore = contentSimilarity(articleA, articleB, idf);
  const catScore = categoryTagScore(articleA, articleB);

  let total =
    nlpScore   * CONFIG.weights.nlpSemantic +
    titleScore * CONFIG.weights.title +
    contScore  * CONFIG.weights.content +
    dateScore  * CONFIG.weights.dateProximity +
    catScore   * CONFIG.weights.categoryTag;

  if (sameSource(articleA, articleB)) total *= 0.3;

  return Math.max(0, Math.min(1, total));
}

export function findRelatedArticles(targetArticle, allArticles, options = {}) {
  const maxResults = options.maxResults || CONFIG.maxResults;
  const threshold = options.threshold || CONFIG.threshold;
  const articles = Array.isArray(allArticles) ? allArticles.filter(Boolean) : [];

  if (articles.length < 2) return [];

  const idf = getCorpusIdf(articles);

  const scored = [];
  for (const candidate of articles) {
    const cId = String(candidate.id || candidate.sourceUrl || candidate.title || "");
    const tId = String(targetArticle.id || targetArticle.sourceUrl || targetArticle.title || "");
    if (cId === tId) continue;

    const score = computeRelatedScore(targetArticle, candidate, idf);
    if (score >= threshold) {
      scored.push({ article: candidate, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const results = [];
  for (const item of scored) {
    const src = String(item.article.sourceName || item.article.source || "").toLowerCase();
    const key = `${src}_${(item.article.title || "").slice(0, 40).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
    if (results.length >= maxResults) break;
  }

  return results;
}

export function invalidateIdfCache() {
  _idfCache = null;
  _idfArticleCount = 0;
}

export { CONFIG as RELATED_NEWS_CONFIG };
