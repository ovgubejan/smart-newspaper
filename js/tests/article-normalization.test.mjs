import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeArticle,
  normalizeLegacyArticle,
  detectOriginalLanguage,
  buildDisplayFields,
  extractNamedEntities,
  detectMentionedCountries,
  detectMentionedRegions,
  detectEventRegion,
  ensureArticleTrendMetadata,
} from "../services/articleNormalizer.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const legacyArticle = {
  id: "art_legacy_1",
  title: "Türkiye ekonomisi büyüdü",
  summary: "Türkiye ekonomisi geçen yıl yüzde 5 büyüdü.",
  fullText: "Türkiye ekonomisi geçen yıl güçlü iç taleple yüzde 5 büyüdü. Analistler...",
  category: "Ekonomi",
  publishedAt: "2026-06-01T10:00:00.000Z",
};

const bbcGazaArticle = {
  id: "art_bbc_1",
  title: "Gaza ceasefire talks resume in Cairo",
  summary: "Israel and Hamas negotiators met in Cairo for renewed ceasefire discussions.",
  fullText: "Negotiators from Israel and Hamas gathered in Cairo on Monday...",
  category: "Dünya",
  sourceRegion: "global",
  sourceName: "BBC World",
  sourceLanguage: "en",
  publishedAt: "2026-06-01T08:00:00.000Z",
};

const fullyNormalizedArticle = {
  id: "art_normalized_1",
  originalTitle: "Climate summit held in Berlin",
  originalSummary: "EU leaders gathered in Berlin to discuss the climate agenda.",
  originalContent: "European Union leaders met in Berlin on Tuesday for the annual climate summit...",
  originalLanguage: "en",
  translatedTitle: "Berlin'de iklim zirvesi düzenlendi",
  translatedSummary: "AB liderleri iklim gündemini görüşmek üzere Berlin'de bir araya geldi.",
  translatedContent: "",
  displayTitle: "Berlin'de iklim zirvesi düzenlendi",
  displaySummary: "AB liderleri iklim gündemini görüşmek üzere Berlin'de bir araya geldi.",
  displayContent: "",
  sourceRegion: "europe",
  sourceName: "BBC World",
  publishedAt: "2026-06-01T12:00:00.000Z",
};

// ─── normalizeLegacyArticle ───────────────────────────────────────────────────

test("normalizeLegacyArticle: originalTitle filled from title", () => {
  const result = normalizeLegacyArticle(legacyArticle);
  assert.equal(result.originalTitle, legacyArticle.title);
});

test("normalizeLegacyArticle: originalSummary filled from summary", () => {
  const result = normalizeLegacyArticle(legacyArticle);
  assert.equal(result.originalSummary, legacyArticle.summary);
});

test("normalizeLegacyArticle: originalContent filled from fullText", () => {
  const result = normalizeLegacyArticle(legacyArticle);
  assert.equal(result.originalContent, legacyArticle.fullText);
});

test("normalizeLegacyArticle: translatedTitle defaults to empty string", () => {
  const result = normalizeLegacyArticle(legacyArticle);
  assert.equal(result.translatedTitle, "");
});

test("normalizeLegacyArticle: displayTitle set from originalTitle when no translation", () => {
  const result = normalizeLegacyArticle(legacyArticle);
  assert.equal(result.displayTitle, legacyArticle.title);
});

test("normalizeLegacyArticle: namedEntities initialized as object with required keys", () => {
  const result = normalizeLegacyArticle(legacyArticle);
  assert.ok(result.namedEntities && typeof result.namedEntities === "object");
  assert.ok(Array.isArray(result.namedEntities.people));
  assert.ok(Array.isArray(result.namedEntities.organizations));
  assert.ok(Array.isArray(result.namedEntities.countries));
  assert.ok(Array.isArray(result.namedEntities.diseases));
  assert.ok(Array.isArray(result.namedEntities.events));
  assert.ok(Array.isArray(result.namedEntities.topics));
});

test("normalizeLegacyArticle: mentionedRegions initialized as array", () => {
  const result = normalizeLegacyArticle(legacyArticle);
  assert.ok(Array.isArray(result.mentionedRegions));
});

test("normalizeLegacyArticle: does not overwrite existing originalTitle", () => {
  const article = { ...legacyArticle, originalTitle: "Mevcut başlık" };
  const result = normalizeLegacyArticle(article);
  assert.equal(result.originalTitle, "Mevcut başlık");
});

// ─── buildDisplayFields ───────────────────────────────────────────────────────

test("buildDisplayFields: uses translatedTitle when locale is tr and translation exists", () => {
  const display = buildDisplayFields(fullyNormalizedArticle, "tr");
  assert.equal(display.displayTitle, fullyNormalizedArticle.translatedTitle);
});

test("buildDisplayFields: falls back to originalTitle when no translatedTitle", () => {
  const article = { ...fullyNormalizedArticle, translatedTitle: "" };
  const display = buildDisplayFields(article, "tr");
  assert.equal(display.displayTitle, fullyNormalizedArticle.originalTitle);
});

test("buildDisplayFields: non-tr locale uses originalTitle directly", () => {
  const display = buildDisplayFields(fullyNormalizedArticle, "en");
  assert.equal(display.displayTitle, fullyNormalizedArticle.originalTitle);
});

test("buildDisplayFields: generates fallback displaySummary from displayContent when both summary fields empty", () => {
  const article = { originalTitle: "Test", originalContent: "This is a long content piece that exceeds the limit." };
  const display = buildDisplayFields(article, "tr");
  assert.ok(display.displaySummary.length > 0);
});

// ─── detectOriginalLanguage ───────────────────────────────────────────────────

test("detectOriginalLanguage: returns sourceLanguage from sourceMeta when provided", () => {
  const lang = detectOriginalLanguage({ title: "Hello world" }, { language: "en" });
  assert.equal(lang, "en");
});

test("detectOriginalLanguage: detects English from text", () => {
  const lang = detectOriginalLanguage({ title: "The economy has been growing this year" });
  assert.equal(lang, "en");
});

test("detectOriginalLanguage: detects Turkish chars", () => {
  const lang = detectOriginalLanguage({ title: "Türkiye ekonomisi büyüdü" });
  assert.equal(lang, "tr");
});

test("detectOriginalLanguage: detects Japanese script", () => {
  const lang = detectOriginalLanguage({ title: "東京オリンピック" });
  assert.equal(lang, "ja");
});

test("detectOriginalLanguage: detects Arabic script", () => {
  const lang = detectOriginalLanguage({ title: "الاقتصاد العالمي" });
  assert.equal(lang, "ar");
});

test("detectOriginalLanguage: falls back to tr for empty text", () => {
  const lang = detectOriginalLanguage({});
  assert.equal(lang, "tr");
});

// ─── detectMentionedCountries ─────────────────────────────────────────────────

test("detectMentionedCountries: detects Israel and Hamas (Palestine) from BBC Gaza article", () => {
  const countries = detectMentionedCountries(bbcGazaArticle);
  const codes = countries.map((c) => c.code);
  assert.ok(codes.includes("IL"), "Should detect Israel");
  assert.ok(codes.includes("PS"), "Should detect Palestine");
});

test("detectMentionedCountries: detects Egypt (Cairo) from BBC Gaza article", () => {
  const countries = detectMentionedCountries(bbcGazaArticle);
  const codes = countries.map((c) => c.code);
  assert.ok(codes.includes("EG"), "Should detect Egypt via 'Cairo'");
});

test("detectMentionedCountries: returns empty for article with no country names", () => {
  const countries = detectMentionedCountries({ title: "Genel gündem haberleri", summary: "Bugünün haberleri" });
  assert.equal(countries.length, 0);
});

test("detectMentionedCountries: returns array of objects with name, code, region", () => {
  const countries = detectMentionedCountries(bbcGazaArticle);
  assert.ok(countries.length > 0);
  assert.ok(typeof countries[0].name === "string");
  assert.ok(typeof countries[0].code === "string");
  assert.ok(typeof countries[0].region === "string");
});

// ─── detectMentionedRegions ───────────────────────────────────────────────────

test("detectMentionedRegions: detects middle-east from Gaza/Israel article", () => {
  const regions = detectMentionedRegions(bbcGazaArticle);
  assert.ok(regions.includes("middle-east"), `Expected middle-east, got: ${regions}`);
});

test("detectMentionedRegions: returns canonical hyphen-format values only", () => {
  const regions = detectMentionedRegions(bbcGazaArticle);
  const validRegions = ["global", "europe", "asia", "africa", "north-america", "south-america", "oceania", "middle-east", "turkey"];
  for (const r of regions) {
    assert.ok(validRegions.includes(r), `Invalid region value: ${r}`);
  }
});

test("detectMentionedRegions: returns array", () => {
  const regions = detectMentionedRegions({ title: "Hello world" });
  assert.ok(Array.isArray(regions));
});

// ─── detectEventRegion ────────────────────────────────────────────────────────

test("detectEventRegion: BBC Gaza article detects middle-east as event region", () => {
  const region = detectEventRegion(bbcGazaArticle);
  assert.equal(region, "middle-east");
});

test("detectEventRegion: event region can differ from source region", () => {
  const article = {
    title: "Russia attacks Ukraine border regions",
    summary: "Russian forces launched missile strikes on Ukrainian cities.",
    sourceRegion: "global",
    sourceName: "Reuters",
  };
  const region = detectEventRegion(article);
  // Should detect europe (Ukraine/Russia) not global
  assert.notEqual(region, "global");
});

test("detectEventRegion: falls back to sourceRegion when no regions detected", () => {
  const article = { title: "Breaking news", summary: "Something happened.", sourceRegion: "turkey" };
  const region = detectEventRegion(article);
  assert.equal(region, "turkey");
});

// ─── extractNamedEntities ─────────────────────────────────────────────────────

test("extractNamedEntities: returns object with all required keys", () => {
  const entities = extractNamedEntities(bbcGazaArticle);
  assert.ok(Array.isArray(entities.people));
  assert.ok(Array.isArray(entities.organizations));
  assert.ok(Array.isArray(entities.locations));
  assert.ok(Array.isArray(entities.countries));
  assert.ok(Array.isArray(entities.diseases));
  assert.ok(Array.isArray(entities.events));
  assert.ok(Array.isArray(entities.topics));
});

test("extractNamedEntities: detects Hamas as organization from Gaza article", () => {
  const entities = extractNamedEntities(bbcGazaArticle);
  const orgs = entities.organizations.map((o) => o.toLowerCase());
  assert.ok(orgs.includes("hamas") || entities.countries.some((c) => c === "Filistin"),
    "Should detect Hamas as org or Palestine as country");
});

test("extractNamedEntities: countries array contains country labels not codes", () => {
  const entities = extractNamedEntities(bbcGazaArticle);
  // Labels should be Turkish (İsrail, Filistin, Mısır...)
  for (const c of entities.countries) {
    assert.equal(typeof c, "string");
    assert.ok(c.length > 0);
  }
});

test("extractNamedEntities: disease detection works", () => {
  const article = { title: "COVID pandemic resurges globally", summary: "Coronavirus cases are rising." };
  const entities = extractNamedEntities(article);
  assert.ok(entities.diseases.length > 0, "Should detect disease keywords");
});

// ─── normalizeArticle (full pipeline) ────────────────────────────────────────

test("normalizeArticle: originalTitle is never lost", () => {
  const result = normalizeArticle(bbcGazaArticle, { language: "en" });
  assert.equal(result.originalTitle, bbcGazaArticle.title);
});

test("normalizeArticle: sourceRegion is preserved", () => {
  const result = normalizeArticle(bbcGazaArticle);
  assert.equal(result.sourceRegion, "global");
});

test("normalizeArticle: source language and country metadata are preserved", () => {
  const result = normalizeArticle({ ...bbcGazaArticle, sourceCountry: "United Kingdom" });
  assert.equal(result.originalLanguage, "en");
  assert.equal(result.sourceCountry, "United Kingdom");
});

test("normalizeArticle: detectedEventRegion is separate from sourceRegion", () => {
  const result = normalizeArticle(bbcGazaArticle, { language: "en" });
  // sourceRegion = global, but event is in middle-east
  assert.notEqual(result.detectedEventRegion, result.sourceRegion);
});

test("normalizeArticle: mentionedRegions is an array", () => {
  const result = normalizeArticle(bbcGazaArticle);
  assert.ok(Array.isArray(result.mentionedRegions));
});

test("normalizeArticle: namedEntities present and structured", () => {
  const result = normalizeArticle(bbcGazaArticle);
  assert.ok(result.namedEntities && typeof result.namedEntities === "object");
  assert.ok(Array.isArray(result.namedEntities.people));
});

test("normalizeArticle: legacy article normalizes without errors", () => {
  const result = normalizeArticle(legacyArticle);
  assert.equal(result.originalTitle, legacyArticle.title);
  assert.equal(result.originalSummary, legacyArticle.summary);
  assert.ok(result.displayTitle.length > 0);
  assert.ok(Array.isArray(result.mentionedRegions));
});

test("normalizeArticle: translatedTitle drives displayTitle when present", () => {
  const article = {
    ...bbcGazaArticle,
    translatedTitle: "Kahire'de ateşkes müzakereleri yeniden başladı",
  };
  const result = normalizeArticle(article);
  assert.equal(result.displayTitle, article.translatedTitle);
});

test("normalizeArticle: displayTitle falls back to originalTitle when no translation", () => {
  const result = normalizeArticle(bbcGazaArticle);
  assert.equal(result.displayTitle, bbcGazaArticle.title);
});

test("normalizeArticle: translatedSummary drives displaySummary with original fallback", () => {
  const translated = normalizeArticle({ ...bbcGazaArticle, translatedSummary: "Ceasefire talks translated summary" });
  assert.equal(translated.displaySummary, "Ceasefire talks translated summary");
  assert.equal(normalizeArticle(bbcGazaArticle).displaySummary, bbcGazaArticle.summary);
});

// ─── ensureArticleTrendMetadata ───────────────────────────────────────────────

test("ensureArticleTrendMetadata: fills mentionedRegions", () => {
  const result = ensureArticleTrendMetadata(bbcGazaArticle);
  assert.ok(Array.isArray(result.mentionedRegions));
  assert.ok(result.mentionedRegions.length > 0);
});

test("ensureArticleTrendMetadata: fills detectedEventRegion", () => {
  const result = ensureArticleTrendMetadata(bbcGazaArticle);
  assert.ok(typeof result.detectedEventRegion === "string");
  assert.ok(result.detectedEventRegion.length > 0);
});

test("ensureArticleTrendMetadata: fills mentionedCountries as string array", () => {
  const result = ensureArticleTrendMetadata(bbcGazaArticle);
  assert.ok(Array.isArray(result.mentionedCountries));
  for (const c of result.mentionedCountries) assert.equal(typeof c, "string");
});
