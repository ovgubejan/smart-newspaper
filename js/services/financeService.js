export const FINANCE_STORAGE_KEY = "newspaperFinancePreferences:v1";

export const FINANCE_ASSET_CATALOG = [
  { symbol: "USDTRY", type: "fx", label: "Dolar/TL", group: "Döviz", sourceHint: "TCMB/ECB fallback" },
  { symbol: "EURTRY", type: "fx", label: "Euro/TL", group: "Döviz", sourceHint: "TCMB/ECB fallback" },
  { symbol: "GBPTRY", type: "fx", label: "Sterlin/TL", group: "Döviz", sourceHint: "TCMB/ECB fallback" },
  { symbol: "GRAMALTIN", type: "gold", label: "Gram Altın", group: "Altın & Emtia", sourceHint: "TCMB/fallback" },
  { symbol: "XAUUSD", type: "gold", label: "Ons Altın", group: "Altın & Emtia", sourceHint: "TCMB/fallback" },
  { symbol: "XAGUSD", type: "gold", label: "Gümüş", group: "Altın & Emtia", sourceHint: "TCMB/fallback" },
  { symbol: "BTCUSDT", type: "crypto", label: "Bitcoin", group: "Kripto", sourceHint: "CoinGecko/Binance" },
  { symbol: "ETHUSDT", type: "crypto", label: "Ethereum", group: "Kripto", sourceHint: "CoinGecko/Binance" },
  { symbol: "SOLUSDT", type: "crypto", label: "Solana", group: "Kripto", sourceHint: "CoinGecko/Binance" },
  { symbol: "BNBUSDT", type: "crypto", label: "BNB", group: "Kripto", sourceHint: "CoinGecko/Binance" },
  { symbol: "XU100", type: "index", label: "BIST 100", group: "Borsa", sourceHint: "Lisanslı/gecikmeli" },
  { symbol: "XU030", type: "index", label: "BIST 30", group: "Borsa", sourceHint: "Lisanslı/gecikmeli" },
  { symbol: "KAP", type: "rss", label: "KAP Bildirimleri", group: "Borsa", sourceHint: "KAP" },
  { symbol: "TCMBRATE", type: "macro", label: "TCMB Faiz", group: "Makro Ekonomi", sourceHint: "TCMB EVDS" },
  { symbol: "CPI_TR", type: "macro", label: "TÜFE / Enflasyon", group: "Makro Ekonomi", sourceHint: "TCMB/TÜİK fallback" },
  { symbol: "TCMB_PPK", type: "rss", label: "TCMB PPK Kararları", group: "Makro Ekonomi", sourceHint: "TCMB RSS" }
];

const DEFAULT_WATCHLIST = [
  { symbol: "USDTRY", type: "fx", label: "Dolar/TL", enabled: true, priority: 1 },
  { symbol: "EURTRY", type: "fx", label: "Euro/TL", enabled: true, priority: 2 },
  { symbol: "GRAMALTIN", type: "gold", label: "Gram Altın", enabled: true, priority: 3 },
  { symbol: "BTCUSDT", type: "crypto", label: "Bitcoin", enabled: true, priority: 4 },
  { symbol: "XU100", type: "index", label: "BIST 100", enabled: true, priority: 5 },
  { symbol: "TCMBRATE", type: "macro", label: "TCMB Faiz", enabled: true, priority: 6 }
];

export const DEFAULT_FINANCE_PREFERENCES = Object.freeze({
  financeWatchlist: DEFAULT_WATCHLIST,
  showFinanceOnHome: true,
  financeRefreshInterval: "5m",
  riskMode: "safe"
});

function catalogBySymbol(symbol) {
  return FINANCE_ASSET_CATALOG.find((asset) => asset.symbol === symbol);
}

export function normalizeFinancePreferences(raw = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const incoming = Array.isArray(input.financeWatchlist) ? input.financeWatchlist : DEFAULT_WATCHLIST;
  const merged = new Map();
  incoming.forEach((item, index) => {
    const symbol = String(item?.symbol || "").toUpperCase();
    const catalog = catalogBySymbol(symbol);
    if (!catalog) return;
    merged.set(symbol, {
      symbol,
      type: catalog.type,
      label: item.label || catalog.label,
      enabled: item.enabled !== false,
      priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : index + 1
    });
  });
  if (!merged.size) {
    DEFAULT_WATCHLIST.forEach((item) => merged.set(item.symbol, { ...item }));
  }
  const financeWatchlist = [...merged.values()]
    .sort((a, b) => a.priority - b.priority)
    .map((item, index) => ({ ...item, priority: index + 1 }));
  return {
    financeWatchlist,
    showFinanceOnHome: input.showFinanceOnHome !== false,
    financeRefreshInterval: ["1m", "5m", "15m", "30m", "60m"].includes(input.financeRefreshInterval) ? input.financeRefreshInterval : "5m",
    riskMode: input.riskMode === "live" ? "live" : "safe"
  };
}

export function loadLocalFinancePreferences() {
  try {
    return normalizeFinancePreferences(JSON.parse(localStorage.getItem(FINANCE_STORAGE_KEY) || "null") || DEFAULT_FINANCE_PREFERENCES);
  } catch {
    return normalizeFinancePreferences(DEFAULT_FINANCE_PREFERENCES);
  }
}

export function saveLocalFinancePreferences(preferences) {
  const normalized = normalizeFinancePreferences(preferences);
  localStorage.setItem(FINANCE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function enabledFinanceSymbols(preferences) {
  return normalizeFinancePreferences(preferences).financeWatchlist
    .filter((item) => item.enabled)
    .sort((a, b) => a.priority - b.priority)
    .map((item) => item.symbol);
}

export function formatFinanceValue(asset) {
  if (!asset) return "-";
  const value = asset.value;
  if (typeof value === "string") return value;
  if (!Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  if (asset.type === "crypto") {
    const formatted = numeric.toLocaleString("tr-TR", { maximumFractionDigits: numeric > 100 ? 0 : 2 });
    return asset.currency === "TRY" ? `${formatted} ₺` : `$${formatted}`;
  }
  if (asset.type === "fx") return `${numeric.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ₺`;
  if (asset.type === "gold" && asset.symbol === "GRAMALTIN") return `${numeric.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
  if (asset.type === "gold") return `$${numeric.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
  if (asset.type === "macro") return `%${numeric.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
  return numeric.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

export function formatFinanceChange(asset) {
  if (asset?.changePercent == null && asset?.change == null) return "";
  const value = Number(asset?.changePercent ?? asset?.change);
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0,00%";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function financeAssetTone(asset) {
  const value = Number(asset?.changePercent ?? asset?.change ?? 0);
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

const FINANCE_KEYWORDS = {
  crypto: ["bitcoin", "btc", "ethereum", "eth", "kripto", "blockchain", "coin", "token", "binance"],
  gold: ["altın", "altin", "gram altın", "ons", "gümüş", "gumus", "emtia"],
  fx: ["dolar", "euro", "sterlin", "kur", "döviz", "doviz", "tcmb", "faiz", "merkez bankası"],
  index: ["bist", "borsa", "endeks", "hisse", "kap", "şirket", "sirket", "pay piyasası"],
  macro: ["tcmb", "faiz", "enflasyon", "tüfe", "tufe", "ppk", "merkez bankası", "ekonomi"]
};

export function financeAssetMatchesArticle(asset, article) {
  const type = asset?.type;
  const text = normalizeFinanceSearchText(`${article?.title || ""} ${article?.summary || ""} ${article?.description || ""} ${article?.category || ""} ${article?.subcategory || ""}`);
  const keywords = FINANCE_KEYWORDS[type] || [];
  return keywords.some((keyword) => text.includes(normalizeFinanceSearchText(keyword)));
}

export function calculateFinancePreferenceBoost(article, preferences) {
  const normalized = normalizeFinancePreferences(preferences);
  const enabled = normalized.financeWatchlist.filter((item) => item.enabled);
  if (!enabled.length) return 0;
  const matched = enabled.filter((asset) => financeAssetMatchesArticle(asset, article));
  if (!matched.length) return 0;
  return Math.min(6, matched.length * 2.5);
}

function normalizeFinanceSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function financeGroups() {
  return [...new Set(FINANCE_ASSET_CATALOG.map((asset) => asset.group))];
}
