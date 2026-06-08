import { normalizeText } from "./textUtils.js";
import { REGION_ALIASES, REGION_KEYWORDS, REGION_OPTIONS } from "./regionKeywords.js";

export function normalizeRegionSearchText(value) {
  return normalizeText(value)
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u");
}

export function regionValue(region) {
  const value = String(region || "").trim();
  if (!value) return "";
  const direct = REGION_OPTIONS.find((item) => item.value === value || item.label === value);
  if (direct) return direct.value;
  const normalized = normalizeRegionSearchText(value).replace(/[\s_]+/g, "-");
  const byNormalized = REGION_OPTIONS.find((item) =>
    item.value === normalized || normalizeRegionSearchText(item.label).replace(/[\s_]+/g, "-") === normalized
  );
  if (byNormalized) return byNormalized.value;
  return REGION_ALIASES[value] || REGION_ALIASES[normalizeRegionSearchText(value)] || "";
}

export function regionLabel(region) {
  const value = regionValue(region);
  return REGION_OPTIONS.find((item) => item.value === value)?.label || "Global";
}

export function regionCountry(regionValueKey) {
  return REGION_OPTIONS.find((item) => item.value === regionValueKey)?.country || "";
}

export function normalizeSelectedRegions(regions) {
  if (regions === null || regions === undefined || regions === "") return [];
  const raw = regions instanceof Set
    ? [...regions]
    : Array.isArray(regions) ? regions : String(regions).split(",");
  const values = [...new Set(raw.map(regionValue).filter(Boolean))];
  if (values.includes("global")) return ["global"];
  return values.filter((region) => region !== "global");
}

export function hasRegionFilterValue(regions) {
  const normalized = normalizeSelectedRegions(regions);
  return normalized.length > 0 && !normalized.includes("global");
}

function weightedArticleRegionFields(article = {}) {
  return [
    { weight: 5, text: `${article.originalTitle || ""} ${article.translatedTitle || ""} ${article.displayTitle || ""} ${article.title || ""}` },
    { weight: 3, text: `${article.originalSummary || ""} ${article.translatedSummary || ""} ${article.displaySummary || ""} ${article.summary || ""} ${article.description || ""} ${article.aiSummary || ""}` },
    { weight: 1, text: article.fullText || article.content || "" },
    { weight: 1, text: `${Array.isArray(article.tags) ? article.tags.join(" ") : article.tags || ""} ${article.category || ""} ${article.subcategory || ""}` }
  ];
}

export function regionKeywordMatches(normalizedText, normalizedKeyword) {
  if (!normalizedText || !normalizedKeyword) return false;
  if (normalizedKeyword.includes(" ")) {
    return ` ${normalizedText} `.includes(` ${normalizedKeyword} `);
  }
  return normalizedText.split(/\s+/).some((word) =>
    word === normalizedKeyword || (normalizedKeyword.length >= 5 && word.startsWith(normalizedKeyword))
  );
}

export function detectNewsRegions(newsItem = {}) {
  const scored = new Map();
  const detected = new Map();

  for (const { weight, text } of weightedArticleRegionFields(newsItem)) {
    const normalizedText = normalizeRegionSearchText(text);
    if (!normalizedText) continue;
    for (const [value, keywords] of Object.entries(REGION_KEYWORDS)) {
      for (const keyword of keywords) {
        const normalizedKeyword = normalizeRegionSearchText(keyword);
        if (!regionKeywordMatches(normalizedText, normalizedKeyword)) continue;
        scored.set(value, (scored.get(value) || 0) + weight);
        if (!detected.has(value)) detected.set(value, new Set());
        detected.get(value).add(keyword);
      }
    }
  }

  const ranked = [...scored.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);
  const regions = ranked.map(([value]) => value);
  const primaryRegion = ranked[0]?.[0] || "global";
  const matchedKeywords = [...new Set(ranked.flatMap(([value]) => [...(detected.get(value) || [])]))];

  return {
    regions,
    country: newsItem.country || regionCountry(ranked[0]?.[0] || ""),
    detectedLocationKeywords: matchedKeywords,
    relevanceScore: ranked.reduce((total, [, score]) => total + score, 0),
    primaryRegion: primaryRegion === "global" && ranked.length ? ranked[0][0] : primaryRegion,
    matchesByRegion: Object.fromEntries([...detected.entries()].map(([value, values]) => [value, [...values]]))
  };
}

function normalizeRegionList(values = []) {
  return [...new Set(values.map(regionValue).filter((region) => region && region !== "global"))];
}

function explicitPrimaryRegion(newsItem = {}) {
  for (const value of [newsItem.detectedEventRegion, newsItem.primaryRegion, newsItem.sourceRegion, newsItem.continent, newsItem.region]) {
    const normalized = regionValue(value);
    if (normalized && normalized !== "global") return normalized;
  }
  return "";
}

export function getArticleRegionInfo(newsItem = {}) {
  const detected = detectNewsRegions(newsItem);
  const primaryRegion = explicitPrimaryRegion(newsItem) || regionValue(detected.primaryRegion) || "global";
  const explicitRelated = Array.isArray(newsItem.relatedRegions) ? newsItem.relatedRegions : [];
  const explicitRegions = Array.isArray(newsItem.regions) ? newsItem.regions : [];
  const mentionedRegions = Array.isArray(newsItem.mentionedRegions) ? newsItem.mentionedRegions : [];
  const relatedRegions = normalizeRegionList([
    newsItem.sourceRegion,
    newsItem.detectedEventRegion,
    ...explicitRelated,
    ...explicitRegions,
    ...mentionedRegions,
    ...detected.regions
  ]).filter((region) => region !== primaryRegion);
  const regions = primaryRegion === "global"
    ? relatedRegions
    : [...new Set([primaryRegion, ...relatedRegions])];

  return {
    primaryRegion,
    relatedRegions,
    regions,
    country: detected.country,
    detectedLocationKeywords: detected.detectedLocationKeywords,
    relevanceScore: detected.relevanceScore,
    matchesByRegion: detected.matchesByRegion
  };
}

export function getPrimaryRegion(newsItem = {}) {
  return getArticleRegionInfo(newsItem).primaryRegion;
}

export function getNewsRegions(newsItem = {}) {
  return getArticleRegionInfo(newsItem).regions;
}

export function enrichArticleRegion(article = {}) {
  const regionInfo = getArticleRegionInfo(article);
  return {
    ...article,
    primaryRegion: regionInfo.primaryRegion,
    relatedRegions: regionInfo.relatedRegions,
    regions: regionInfo.regions,
    continent: regionInfo.primaryRegion,
    country: article.country || regionInfo.country || "",
    detectedLocationKeywords: regionInfo.detectedLocationKeywords,
    relevanceScore: regionInfo.relevanceScore
  };
}

export function matchesRegion(newsItem, selectedRegion) {
  const selectedRegions = normalizeSelectedRegions(selectedRegion);
  if (!selectedRegions || selectedRegions.length === 0) return true;
  const regionInfo = getArticleRegionInfo(newsItem);
  const metadataRegions = normalizeRegionList([
    newsItem.sourceRegion,
    newsItem.detectedEventRegion,
    ...(Array.isArray(newsItem.mentionedRegions) ? newsItem.mentionedRegions : []),
    ...regionInfo.regions
  ]);
  if (selectedRegions.includes("global")) {
    return newsItem.isGlobalSource === true
      || regionValue(newsItem.sourceRegion) === "global"
      || metadataRegions.length > 1
      || (Array.isArray(newsItem.propagationPath) && normalizeRegionList(newsItem.propagationPath).length > 1);
  }
  if (selectedRegions.some((region) => metadataRegions.includes(region))) return true;

  const countryText = [
    newsItem.sourceCountry,
    newsItem.sourceCountryCode,
    ...(Array.isArray(newsItem.mentionedCountries) ? newsItem.mentionedCountries : [])
  ].filter(Boolean).join(" ");
  const text = weightedArticleRegionFields(newsItem).map(({ text: value }) => value).join(" ");
  return selectedRegions.some((region) =>
    matchesRegionKeywords(countryText, region) || matchesRegionKeywords(text, region)
  );
}

const REGION_COUNTRY_CODES = {
  europe: ["DE", "FR", "GB", "IT", "ES", "NL", "PL", "UA", "RU"],
  asia: ["CN", "JP", "IN", "KR", "ID", "VN", "TH", "SG"],
  africa: ["EG", "NG", "ZA", "KE", "ET", "MA"],
  "north-america": ["US", "CA", "MX"],
  "south-america": ["BR", "AR", "CL", "CO", "PE"],
  oceania: ["AU", "NZ", "FJ"],
  "middle-east": ["SA", "AE", "QA", "IR", "IQ", "IL", "PS", "SY", "LB"],
  turkey: ["TR"]
};

function matchesRegionKeywords(text, region) {
  const normalizedText = normalizeRegionSearchText(text);
  if (!normalizedText) return false;
  if ((REGION_COUNTRY_CODES[region] || []).some((code) => regionKeywordMatches(normalizedText, code.toLowerCase()))) return true;
  return (REGION_KEYWORDS[region] || []).some((keyword) =>
    regionKeywordMatches(normalizedText, normalizeRegionSearchText(keyword))
  );
}

export function explainRegionMatch(newsItem, selectedRegion) {
  const selectedRegions = normalizeSelectedRegions(selectedRegion);
  const regionInfo = getArticleRegionInfo(newsItem);

  if (!selectedRegions.length || selectedRegions.includes("global")) {
    return {
      selectedRegions,
      primaryRegion: regionInfo.primaryRegion,
      relatedRegions: regionInfo.relatedRegions,
      match: true,
      reason: "region filter not applied"
    };
  }

  const match = matchesRegion(newsItem, selectedRegions);
  return {
    selectedRegions,
    primaryRegion: regionInfo.primaryRegion,
    relatedRegions: regionInfo.relatedRegions,
    match,
    reason: match
      ? `included: primaryRegion ${regionInfo.primaryRegion} is in selectedRegions [${selectedRegions.join(", ")}]`
      : `excluded: article metadata does not match selectedRegions [${selectedRegions.join(", ")}]`
  };
}
