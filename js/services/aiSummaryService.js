/**
 * AI summary fallback — pure text extraction, no API calls, no global state.
 */

function decodeEntities(value) {
  const el = document.createElement("textarea");
  el.innerHTML = String(value || "");
  return el.value;
}

/**
 * Generate an article summary without an AI API.
 * @param {Object} article
 * @param {"short"|"bullets"|"analysis"} mode
 * @returns {string}
 */
export function fallbackSummary(article, mode) {
  const raw = decodeEntities(article.fullText || article.summary || article.description || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "Bu haber için özet oluşturulamadı.";

  const sentences = (raw.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [raw])
    .map((s) => s.trim())
    .filter(Boolean);

  if (mode === "bullets") {
    return sentences.slice(0, 5).map((s) => `• ${s}`).join("\n");
  }
  if (mode === "analysis") {
    const short = sentences.slice(0, 3).join(" ");
    return `Bu haber ${article.source || "bir kaynaktan"} alındı. ${article.category} kategorisinde yer almaktadır. ${short}`;
  }
  return sentences.slice(0, 3).join(" ").slice(0, 400) + (raw.length > 400 ? "…" : "");
}
