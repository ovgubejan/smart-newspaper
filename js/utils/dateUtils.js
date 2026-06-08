/**
 * Date and recency utility functions — no DOM, no state.
 */

/**
 * Returns a "YYYY-MM-DD" key for a Date object.
 * @param {Date} date
 * @returns {string}
 */
export function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Tiered recency score (0-100) based on article age.
 * @param {Object} article
 * @returns {number}
 */
export function getRecencyScore(article) {
  const published = new Date(article.publishedAt || article.date || 0).getTime();
  if (!Number.isFinite(published) || !published) return 45;
  const ageHours = (Date.now() - published) / 36e5;
  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return 90;
  if (ageHours <= 72) return 75;
  if (ageHours <= 168) return 60;
  if (ageHours <= 720) return 35;
  return 20;
}
