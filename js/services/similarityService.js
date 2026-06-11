const GROUPING_THRESHOLD = 0.68;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

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

const TURKISH_SUFFIXES = ["ndan", "nden", "ından", "inden", "undan", "ünden", "nın", "nin", "nun", "nün", "ının", "inin", "unun", "ünün", "dan", "den", "tan", "ten", "nda", "nde", "ında", "inde", "unda", "ünde", "da", "de", "ta", "te", "ya", "ye", "na", "ne", "yla", "yle", "la", "le", "yı", "yi", "yu", "yü", "ın", "in", "un", "ün", "lar", "ler", "ları", "leri", "ca", "ce", "ça", "çe", "a", "e", "ı", "i", "u", "ü"].sort((a, b) => b.length - a.length);
const ENTITY_STOPWORDS = new Set(["son", "yeni", "haber", "bugün", "bugun", "dun", "dün", "türkiye", "turkiye", "dünya", "dunya", "istanbul", "ankara", "izmir", "gündem", "gundem", "ekonomi", "spor", "teknoloji", "sağlık", "saglik", "bilim", "kültür", "kultur", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık", "ocak", "şubat", "mart", "nisan", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar", "genel", "başkan", "bakan", "milletvekili", "sözcü", "yönetim", "kurul"]);
const KNOWN_ORGS = new Set(["chp", "akp", "mhp", "dem", "iyi", "tbmm", "trt", "tsk", "mgk", "meb", "tcmb", "spk", "bddk", "epdk", "btk", "ysk", "nato", "ab", "bm", "imf", "uefa", "fifa", "aa", "iha", "dha", "tff", "bist", "tpao", "ted"]);
const TURKISH_STOPWORDS = new Set(["bir", "bu", "ve", "ile", "da", "de", "ki", "mi", "mu", "mü", "ne", "o", "şu", "için", "olan", "en", "çok", "var", "daha", "gibi", "kadar", "sonra", "önce", "ise", "ya", "veya", "ancak", "fakat", "ama", "her", "hem", "bile", "diye", "eğer", "çünkü", "yani", "artık", "zaten", "hiç", "nasıl", "neden", "hangi", "kendi", "diğer", "tüm", "bazı", "pek", "hep", "göre", "karşı", "rağmen", "haber", "son", "yeni", "bugün", "dün", "oldu", "etti", "dedi", "olan", "eden", "olarak", "tarafından", "üzere", "itibaren", "dolayı", "nedeniyle", "açıkladı", "belirtti", "konuştu", "dile", "getirdi", "ifade", "the", "and", "for", "from", "with", "that", "this", "are", "was", "has"]);
const CATEGORY_EQUIVALENCE = {
  politics: ["gündem", "politika", "türkiye", "yerel", "toplum", "güvenlik", "siyaset"],
  world: ["dünya", "uluslararası", "global", "diplomasi", "orta doğu", "avrupa", "asya"],
  economy: ["ekonomi", "finans", "borsa", "döviz", "enflasyon", "piyasa", "merkez bankası"],
  sports: ["spor", "futbol", "basketbol", "voleybol", "formula", "transfer", "atletizm"],
  tech: ["teknoloji", "yapay zeka", "yazılım", "donanım", "mobil", "siber", "dijital"],
  science: ["bilim", "uzay", "iklim", "doğa", "akademik", "araştırma", "çevre"],
  health: ["sağlık", "tıp", "hastane", "ilaç", "tedavi", "pandemi", "beslenme"],
  culture: ["kültür", "sanat", "sinema", "müzik", "kitap", "tiyatro", "eğlence", "magazin"]
};

function sameUrl(a, b) {
  const uA = String(a?.sourceUrl || a?.url || "").trim().toLowerCase();
  const uB = String(b?.sourceUrl || b?.url || "").trim().toLowerCase();
  const isValidUrl = (url) => url.startsWith("http") && url.length > 20;
  return isValidUrl(uA) && isValidUrl(uB) && uA === uB;
}

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
  for (const suffix of TURKISH_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 3) return lower.slice(0, lower.length - suffix.length);
  }
  return lower;
}

function extractNamedEntities(text) {
  if (!text) return new Set();
  const result = new Set();
  const raw = String(text);
  const textLower = raw.toLowerCase();
  for (const org of KNOWN_ORGS) if (textLower.includes(org)) result.add(org);
  const matches = raw.match(/\b[A-ZÇĞİÖŞÜ][a-zçğışöüA-ZÇĞİÖŞÜ]{2,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöüA-ZÇĞİÖŞÜ]{2,}){0,2}\b/g) || [];
  for (const match of matches) {
    const words = match.split(/\s+/);
    const stemmed = stemTurkishWord(words[0]);
    if (!ENTITY_STOPWORDS.has(stemmed) && stemmed.length >= 3) {
      result.add(stemmed);
      if (words.length > 1) result.add(words.map(stemTurkishWord).join("_"));
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
    .filter((word) => word.length >= 3 && !TURKISH_STOPWORDS.has(word));
}

function buildDocumentFingerprint(article) {
  // Use both original and translated fields so cross-language duplicates group correctly.
  const title = String(article?.originalTitle || article?.title || "");
  const translatedTitle = String(article?.translatedTitle || "");
  const summary = String(article?.originalSummary || article?.summary || article?.description || "");
  const translatedSummary = String(article?.translatedSummary || "");
  const body = String(article?.originalContent || article?.fullText || "").slice(0, 600);
  return tokenize(`${title} ${title} ${title} ${title} ${translatedTitle} ${translatedTitle} ${summary} ${summary} ${translatedSummary} ${body}`);
}

function buildIdfTable(tokenArrays) {
  const df = new Map();
  const N = tokenArrays.length;
  for (const tokens of tokenArrays) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) || 0) + 1);
  }
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
    const num = f * (BM25_K1 + 1);
    const den = f + BM25_K1 * (1 - BM25_B + BM25_B * dl / Math.max(avgdl, 1));
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
  for (const [group, aliases] of Object.entries(CATEGORY_EQUIVALENCE)) {
    if (aliases.some((alias) => lower.includes(alias))) return group;
  }
  return null;
}

function categorySimilarityScore(a, b) {
  const gA = getCategoryGroup(a?.category);
  const gB = getCategoryGroup(b?.category);
  if (!gA || !gB) return 0.5;
  return gA === gB ? 1 : 0;
}

function articleKey(article, index = 0) {
  return String(article?.id || article?.sourceUrl || article?.url || article?.title || `article_${index}`);
}

function storyScore(a, b, precomputed) {
  if (sameUrl(a, b)) return 0;
  const tScore = computeTimeScore(a, b);
  if (tScore === 0) return 0;
  const idA = articleKey(a);
  const idB = articleKey(b);
  const etA = precomputed.eventTypes.get(idA) || "UNKNOWN";
  const etB = precomputed.eventTypes.get(idB) || "UNKNOWN";
  if (etA !== "UNKNOWN" && etB !== "UNKNOWN" && etA !== etB) return 0;
  const tokA = precomputed.tokens.get(idA) || [];
  const tokB = precomputed.tokens.get(idB) || [];
  const textScore = normalizedBM25Similarity(tokA, tokB, precomputed.idfTable, precomputed.avgdl);
  const entA = precomputed.entities.get(idA) || new Set();
  const entB = precomputed.entities.get(idB) || new Set();
  const shA = precomputed.simHashes.get(idA) || 0;
  const shB = precomputed.simHashes.get(idB) || 0;
  const entScore = entityOverlapScore(entA, entB);
  const nearDup = hammingDistance(shA, shB) <= 4 ? 0.15 : 0;
  if (etA === "SOCIAL_CEREMONY" && etB === "SOCIAL_CEREMONY" && entScore === 0 && !nearDup) return 0;
  if (entScore === 0 && !nearDup && textScore < 0.60) return 0;
  if (entScore < 0.15 && textScore < 0.55 && !nearDup) return 0;
  const catScore = categorySimilarityScore(a, b);
  if (catScore === 0 && entScore < 0.25 && textScore < 0.65) return 0;
  const eventBonus = etA !== "UNKNOWN" && etA === etB ? 0.08 : 0;
  let score = textScore * 0.45 + entScore * 0.30 + tScore * 0.10 + catScore * 0.08 + nearDup + eventBonus;
  const srcA = String(a?.sourceName || a?.source || "").toLowerCase().trim();
  const srcB = String(b?.sourceName || b?.source || "").toLowerCase().trim();
  if (srcA && srcB && srcA === srcB) score *= 0.25;
  return Math.max(0, Math.min(1, score));
}

function buildPrecomputed(articles) {
  const tokens = new Map();
  const entities = new Map();
  const eventTypes = new Map();
  const simHashes = new Map();
  articles.forEach((article, index) => {
    const id = articleKey(article, index);
    const articleTokens = buildDocumentFingerprint(article);
    tokens.set(id, articleTokens);
    entities.set(id, extractNamedEntities(`${article?.originalTitle || article?.title || ""} ${article?.originalSummary || article?.summary || ""} ${article?.translatedTitle || ""} ${article?.translatedSummary || ""}`));
    eventTypes.set(id, extractEventType(article?.title || ""));
    simHashes.set(id, simHashFingerprint(articleTokens));
  });
  const tokenArrays = [...tokens.values()];
  const idfTable = buildIdfTable(tokenArrays);
  const avgdl = tokenArrays.reduce((sum, item) => sum + item.length, 0) / Math.max(tokenArrays.length, 1);
  return { tokens, entities, eventTypes, simHashes, idfTable, avgdl };
}

function computeSimilarGroupsFrom(articles) {
  const input = Array.isArray(articles) ? articles.filter(Boolean) : [];
  if (input.length < 2) {
    return input.map((article) => ({
      representative: article,
      articles: [article],
      sources: new Set([article?.sourceName || article?.source || ""]),
      confidence: 1.0
    }));
  }
  const precomputed = buildPrecomputed(input);
  const idList = input.map((article, index) => articleKey(article, index));
  const parent = new Map(idList.map((id) => [id, id]));
  const rank = new Map(idList.map((id) => [id, 0]));
  const find = (id) => {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  };
  const unite = (idA, idB) => {
    const pA = find(idA);
    const pB = find(idB);
    if (pA === pB) return;
    if (rank.get(pA) < rank.get(pB)) parent.set(pA, pB);
    else if (rank.get(pA) > rank.get(pB)) parent.set(pB, pA);
    else {
      parent.set(pB, pA);
      rank.set(pA, rank.get(pA) + 1);
    }
  };
  for (let i = 0; i < input.length; i += 1) {
    for (let j = i + 1; j < input.length; j += 1) {
      if (storyScore(input[i], input[j], precomputed) >= GROUPING_THRESHOLD) unite(idList[i], idList[j]);
    }
  }
  const groupMap = new Map();
  input.forEach((article, index) => {
    const root = find(idList[index]);
    if (!groupMap.has(root)) groupMap.set(root, { articles: [], sources: new Set() });
    const group = groupMap.get(root);
    group.articles.push(article);
    const source = article?.sourceName || article?.source || "";
    if (source) group.sources.add(source);
  });
  const groups = [];
  for (const group of groupMap.values()) {
    if (group.articles.length === 1) {
      groups.push({ representative: group.articles[0], articles: group.articles, sources: group.sources, confidence: 1.0 });
      continue;
    }
    let representative = group.articles[0];
    let bestScore = -1;
    for (const candidate of group.articles) {
      let total = 0;
      for (const other of group.articles) if (articleKey(other) !== articleKey(candidate)) total += storyScore(candidate, other, precomputed);
      const avg = total / (group.articles.length - 1);
      if (avg > bestScore) {
        bestScore = avg;
        representative = candidate;
      }
    }
    groups.push({
      representative,
      articles: group.articles,
      sources: group.sources,
      confidence: Math.min(1, group.sources.size / group.articles.length + 0.2)
    });
  }
  return groups.sort((a, b) => (b.sources.size * b.confidence) - (a.sources.size * a.confidence));
}

function getSimilarArticlesFor(article, groups) {
  const articleId = articleKey(article);
  const group = (Array.isArray(groups) ? groups : []).find((item) => item.articles.some((candidate) => articleKey(candidate) === articleId));
  if (!group) return [];
  return group.articles
    .filter((candidate) => articleKey(candidate) !== articleId && !sameUrl(article, candidate))
    .sort((a, b) => {
      const srcMain = String(article?.sourceName || article?.source || "");
      const aSrc = String(a?.sourceName || a?.source || "");
      const bSrc = String(b?.sourceName || b?.source || "");
      return Number(bSrc !== srcMain) - Number(aSrc !== srcMain);
    });
}

export { computeSimilarGroupsFrom, getSimilarArticlesFor };
