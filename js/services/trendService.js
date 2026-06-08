/**
 * Trend detection service — pure computation, no DOM, no global state.
 */

import { normalizeText } from "../utils/textUtils.js";
import { REGION_LABELS } from "../data/regionalSources.js";
import { matchesRegion, normalizeSelectedRegions, regionValue } from "../utils/regionFilter.js";

const STOPWORDS = [
  "haber", "son", "yeni", "icin", "için", "olan", "gore", "göre",
  "sonra", "once", "önce", "daha", "bile", "gibi", "kadar",
  "buna", "bunu", "oldu", "olup", "eden", "etti"
];

function wordsOf(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.includes(w));
}

function articleText(a) {
  // Include original and translated fields so cross-language articles on the same
  // story can still be grouped together (e.g. BBC EN + TRT TR about same event).
  const title = [a.originalTitle, a.translatedTitle, a.title].filter(Boolean).join(" ");
  const summary = [a.originalSummary, a.translatedSummary, a.summary].filter(Boolean).join(" ");
  return `${title} ${summary}`;
}

function jaccard(a, b) {
  const wa = new Set(wordsOf(articleText(a)));
  const wb = new Set(wordsOf(articleText(b)));
  if (!wa.size || !wb.size) return 0;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / new Set([...wa, ...wb]).size;
}

/**
 * Extract the display label for a region canonical value.
 * Falls back to the value itself or "Global" if not found.
 */
function regionDisplayLabel(canonicalValue) {
  if (!canonicalValue) return "Global";
  return REGION_LABELS[canonicalValue] || canonicalValue;
}

/**
 * Derive the real regions covered by a trend group from source metadata.
 * Uses sourceRegion (where the source is based) and primaryRegion (what the article is about).
 */
function deriveGroupRegions(group) {
  const regionSet = new Set();
  for (const article of group.articles) {
    const candidates = [
      article.sourceRegion,
      article.detectedEventRegion,
      article.primaryRegion,
      article.continent,
      ...(Array.isArray(article.mentionedRegions) ? article.mentionedRegions : [])
    ];
    candidates.map(regionValue).filter((region) => region && region !== "global").forEach((region) => regionSet.add(region));
  }
  const unique = [...regionSet];
  if (unique.length === 0) {
    // Fall back to the representative article's source region
    const fallback = group.representative?.sourceRegion || "turkey";
    unique.push(fallback);
  }
  return unique;
}

export function matchesTrendRegion(trend, selectedRegion) {
  const regions = normalizeSelectedRegions(selectedRegion);
  if (!regions.length) return true;
  const meta = trend.trendMeta || trend;
  const propagationRegions = (meta.propagationPath || []).map((item) => regionValue(item.region || item));
  const trendRegions = [
    meta.firstSeenRegion,
    ...(meta.canonicalRegions || meta.regions || []),
    ...propagationRegions
  ].map(regionValue).filter(Boolean);
  if (regions.includes("global")) return new Set(trendRegions.filter((region) => region !== "global")).size > 1;
  return regions.some((region) => trendRegions.includes(region))
    || (trend.articles || []).some((article) => matchesRegion(article, regions));
}

/**
 * Build a monotonically-increasing sparkline that reflects the group's
 * actual article count over the last 10 time slots (not random).
 */
function buildGrowthSeries(group) {
  const times = group.articles.map((article) => new Date(article.publishedAt || Date.now()).getTime()).filter(Number.isFinite);
  const start = Math.min(...times);
  const end = Math.max(...times);
  const slotMs = Math.max(1, (end - start) / 9);
  const slots = Array.from({ length: 10 }, () => new Set());
  for (const article of group.articles) {
    const time = new Date(article.publishedAt || start).getTime();
    const slot = Math.max(0, Math.min(9, Math.floor((time - start) / slotMs)));
    slots[slot].add(article.sourceName || article.source || article.id || article.title);
  }
  const seenSources = new Set();
  return slots.map((sources, index) => {
    sources.forEach((source) => seenSources.add(source));
    return {
      at: new Date(start + index * slotMs).toISOString(),
      sourceCount: seenSources.size
    };
  });
}

function buildPropagationPath(group) {
  const steps = new Map();
  for (const article of group.articles) {
    const firstSeenAt = article.publishedAt || article.date || "";
    const country = article.sourceCountry || article.country || "";
    const regions = [
      article.detectedEventRegion,
      article.sourceRegion,
      ...(Array.isArray(article.mentionedRegions) ? article.mentionedRegions : [])
    ].map(regionValue).filter((region) => region && region !== "global");
    for (const region of regions) {
      const current = steps.get(region);
      if (!current || new Date(firstSeenAt || 0) < new Date(current.firstSeenAt || 0)) {
        steps.set(region, { region, country, firstSeenAt });
      }
    }
  }
  return [...steps.values()].sort((left, right) => new Date(left.firstSeenAt || 0) - new Date(right.firstSeenAt || 0));
}

/**
 * Compute trending topic groups from articles.
 * Trend score = sources×30 + count×10 + totalRelevanceScore.
 * @param {Array} articles
 * @returns {Array} top 8 trend groups sorted by trend score
 */
export function computeTrendGroupsFrom(articles) {
  const now = Date.now();
  const groups = [];
  for (const article of articles) {
    let g = groups.find((gr) => jaccard(gr.representative, article) >= 0.22);
    if (!g) {
      g = { representative: article, articles: [], sources: new Set(), sourceRegions: new Set(), totalScore: 0 };
      groups.push(g);
    }
    g.articles.push(article);
    const srcName = article.sourceName || article.source;
    if (srcName) g.sources.add(srcName);
    if (article.sourceRegion) g.sourceRegions.add(article.sourceRegion);
    const ageHours = (now - new Date(article.publishedAt || article.date || now).getTime()) / 3600000;
    const recency = Math.max(0, 24 - ageHours) / 24;
    g.totalScore += Number(article.relevance || 0) * 0.4 + recency * 40
      + (article.dateRange === "Son 24 saat" ? 10 : 0);
  }
  return groups
    .filter((g) => g.articles.length >= 2 || g.sources.size >= 2)
    .sort((a, b) => {
      const sa = a.sources.size * 30 + a.articles.length * 10 + a.totalScore;
      const sb = b.sources.size * 30 + b.articles.length * 10 + b.totalScore;
      return sb - sa;
    })
    .slice(0, 8)
    .map((g) => {
      const cats = [...new Set(g.articles.map((a) => a.category).filter(Boolean))];

      // Use real source region data instead of random assignment
      const canonicalRegions = deriveGroupRegions(g);
      const regionLabels = canonicalRegions.map(regionDisplayLabel);

      const growthSeries = buildGrowthSeries(g);
      const sparklineData = growthSeries.map((point) => point.sourceCount);
      const first = sparklineData[0] || 0;
      const last = sparklineData.at(-1) || 0;
      let growth = "stabil";
      if (last > first + 3) growth = "artıyor";
      if (last > first + 6) growth = "hızlı artıyor";
      if (last < first) growth = "düşüyor";

      const isMultiRegion = canonicalRegions.length > 1;
      const propagationPath = buildPropagationPath(g);
      const firstArticle = [...g.articles].sort((left, right) =>
        new Date(left.publishedAt || left.date || 0) - new Date(right.publishedAt || right.date || 0)
      )[0] || {};
      const firstSeenRegion = propagationPath[0]?.region || canonicalRegions[0] || "global";
      const firstSeenCountry = propagationPath[0]?.country || firstArticle.sourceCountry || firstArticle.country || "";
      const countries = [...new Set(g.articles.flatMap((article) => [
        article.sourceCountry || article.country,
        ...(Array.isArray(article.mentionedCountries) ? article.mentionedCountries : [])
      ]).filter(Boolean))];
      const recentIncrease = last - (sparklineData.at(-4) || first);
      const previousIncrease = (sparklineData.at(-4) || first) - (sparklineData.at(-7) || first);
      const growthSpeed = recentIncrease;
      const trendStatus = last > first && recentIncrease >= previousIncrease ? "rising" : recentIncrease < previousIncrease ? "fading" : "stable";
      const firstSignal = regionLabels[0] || "Türkiye";
      const spreadRoute = isMultiRegion
        ? regionLabels.join(" → ")
        : firstSignal;

      g.trendMeta = {
        sourceCount: g.sources.size,
        primaryCategory: cats[0] || "Genel",
        regions: regionLabels,
        canonicalRegions,
        countries,
        firstSeenRegion,
        firstSeenCountry,
        propagationPath,
        firstSignal,
        spreadRoute,
        growth,
        sparklineData,
        growthSeries,
        growthSpeed,
        trendStatus,
        isMultiRegion,
        reason: trendReason(g)
      };
      Object.assign(g, {
        id: `trend-${normalizeText(g.representative.id || g.representative.title || "").replace(/\s+/g, "-")}`,
        title: g.representative.displayTitle || g.representative.title || "Başlıksız trend",
        representativeArticle: g.representative,
        sourceCount: g.sources.size,
        regions: canonicalRegions,
        countries,
        firstSeenAt: firstArticle.publishedAt || firstArticle.date || "",
        firstSeenRegion,
        firstSeenCountry,
        firstSeenSource: firstArticle.sourceName || firstArticle.source || "",
        propagationPath,
        growthSeries,
        growthSpeed,
        trendStatus,
        namedEntities: g.representative.namedEntities || {},
        topics: [...new Set(g.articles.flatMap((article) => article.topics || article.tags || []).filter(Boolean))],
        confidenceScore: Math.min(1, 0.35 + g.sources.size * 0.15 + g.articles.length * 0.05)
      });
      return g;
    });
}

/**
 * Human-readable explanation of why a group is trending.
 * @param {Object} group
 * @returns {string}
 */
export function trendReason(group) {
  const parts = [];
  if (group.sources.size >= 3) parts.push(`${group.sources.size} farklı kaynakta yer aldı`);
  else if (group.sources.size >= 2) parts.push(`${group.sources.size} kaynakta çıktı`);
  if (group.articles.length >= 3) parts.push(`${group.articles.length} haber var`);
  const cats = [...new Set(group.articles.map((a) => a.category))];
  if (cats.length > 1) parts.push(`${cats.join(", ")} kategorilerini kesiyor`);
  return parts.length ? parts.join(" · ") : "Birden fazla kaynakta tekrar ediyor";
}
