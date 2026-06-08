import { normalizeText } from "../utils/textUtils.js";

export const SOURCE_TYPE_LABELS = {
  youtube: "YouTube",
  rss: "RSS",
  atom: "Atom",
  news: "Haber",
  blog: "Blog",
  official: "Resmi",
  podcast: "Podcast",
  manual: "Manuel"
};

export const SOURCE_TYPE_ICONS = {
  youtube: "fa-brands fa-youtube",
  rss: "fa-solid fa-rss",
  atom: "fa-solid fa-square-rss",
  news: "fa-regular fa-newspaper",
  blog: "fa-solid fa-pen-nib",
  official: "fa-solid fa-building-columns",
  podcast: "fa-solid fa-podcast",
  manual: "fa-solid fa-link"
};

export const SOURCE_CATEGORIES = [
  "Genel", "Gündem", "Ekonomi", "Teknoloji", "Spor", "Sağlık", "Bilim", "Kültür-Sanat", "Finans", "Yapay Zeka", "Resmi Duyuru"
];

export const SOURCE_FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "mine", label: "Kaynaklarımdan Gelenler" },
  { id: "youtube", label: "Sadece YouTube" },
  { id: "rss", label: "Sadece RSS" },
  { id: "official", label: "Resmi Duyurular" },
  { id: "favorites", label: "Favori Kaynaklar" }
];

const STORAGE_KEY = "newspaperUserSources";

export function normalizeUserSource(source = {}) {
  const now = new Date().toISOString();
  return {
    id: String(source.id || `src_${crypto.randomUUID?.() || Date.now()}`),
    type: SOURCE_TYPE_LABELS[source.type] ? source.type : "rss",
    title: String(source.title || source.name || "Yeni kaynak").trim().slice(0, 120),
    url: String(source.url || "").trim(),
    feedUrl: String(source.feedUrl || source.url || "").trim(),
    channelId: source.channelId || "",
    handle: source.handle || "",
    description: String(source.description || "").slice(0, 260),
    logoUrl: source.logoUrl || "",
    category: SOURCE_CATEGORIES.includes(source.category) ? source.category : "Genel",
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8) : [],
    enabled: source.enabled !== false,
    favorite: Boolean(source.favorite),
    priority: Number(source.priority || 99),
    trustLevel: ["low", "medium", "high"].includes(source.trustLevel) ? source.trustLevel : "medium",
    addedAt: source.addedAt || now,
    lastFetchedAt: source.lastFetchedAt || "",
    lastSuccessAt: source.lastSuccessAt || "",
    errorCount: Number(source.errorCount || 0),
    lastItemCount: Number(source.lastItemCount || 0),
    status: source.status || "active"
  };
}

export function normalizeUserSources(sources = []) {
  return Array.isArray(sources) ? sources.map(normalizeUserSource).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, "tr")) : [];
}

export function loadLocalUserSources() {
  try {
    return normalizeUserSources(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function saveLocalUserSources(sources = []) {
  const normalized = normalizeUserSources(sources);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function sourceTypeLabel(type) {
  return SOURCE_TYPE_LABELS[type] || "Kaynak";
}

export function sourceTypeIcon(type) {
  return SOURCE_TYPE_ICONS[type] || "fa-solid fa-link";
}

export function trustLabel(level) {
  return ({ low: "Düşük", medium: "Orta", high: "Yüksek" })[level] || "Orta";
}

export function calculateSourcePreferenceBoost(article, sources = []) {
  const enabled = normalizeUserSources(sources).filter((source) => source.enabled);
  if (!enabled.length || !article) return 0;
  const haystack = normalizeText(`${article.title || ""} ${article.summary || ""} ${article.source || ""} ${article.category || ""} ${article.subcategory || ""}`);
  let boost = 0;
  for (const source of enabled) {
    const title = normalizeText(source.title);
    const category = normalizeText(source.category);
    const tags = (source.tags || []).map(normalizeText).filter(Boolean);
    const sourceMatch = title && haystack.includes(title);
    const categoryMatch = category && category !== "genel" && haystack.includes(category);
    const tagMatch = tags.some((tag) => tag.length > 2 && haystack.includes(tag));
    if (sourceMatch) boost += source.favorite ? 5 : 3;
    if (categoryMatch) boost += 1.5;
    if (tagMatch) boost += 1.5;
    if (source.trustLevel === "low") boost *= 0.8;
    if (source.trustLevel === "high") boost *= 1.1;
  }
  return Math.min(8, Math.max(0, boost));
}

export function normalizeExternalContent(item = {}) {
  return {
    id: String(item.id || item.dedupeKey || `ext_${Date.now()}`),
    sourceId: String(item.sourceId || ""),
    sourceName: String(item.sourceName || "Kişisel kaynak"),
    sourceType: item.sourceType || "rss",
    title: String(item.title || "İçerik başlığı yok").trim(),
    summary: String(item.summary || "").trim(),
    url: String(item.url || ""),
    imageUrl: item.imageUrl || item.thumbnailUrl || "",
    thumbnailUrl: item.thumbnailUrl || item.imageUrl || "",
    publishedAt: item.publishedAt || "",
    author: item.author || "",
    category: item.category || "Genel",
    tags: Array.isArray(item.tags) ? item.tags : [],
    language: item.language || "tr",
    contentType: item.contentType || (item.sourceType === "youtube" ? "video" : "article"),
    readTime: item.readTime || 3,
    duration: item.duration || "",
    fetchedAt: item.fetchedAt || new Date().toISOString(),
    dedupeKey: item.dedupeKey || ""
  };
}
