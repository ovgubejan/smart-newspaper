import assert from "node:assert/strict";
import test from "node:test";

import { matchesRegion, normalizeSelectedRegions } from "../utils/regionFilter.js";
import { matchesTrendRegion } from "../services/trendService.js";

test("normalizes aliases, Sets, duplicates and invalid values", () => {
  assert.deepEqual(normalizeSelectedRegions(["Avrupa", "europe"]), ["europe"]);
  assert.deepEqual(normalizeSelectedRegions(new Set(["T\u00fcrkiye", "TR", "turkey"])), ["turkey"]);
  assert.deepEqual(normalizeSelectedRegions(["Kuzey Amerika", "north-america"]), ["north-america"]);
  assert.deepEqual(normalizeSelectedRegions(["Orta Do\u011fu", "middle-east"]), ["middle-east"]);
  assert.deepEqual(normalizeSelectedRegions(["invalid"]), []);
  assert.deepEqual(normalizeSelectedRegions(null), []);
});

test("matches country text fallback regions", () => {
  assert.equal(matchesRegion({ title: "Almanya se\u00e7ime gidiyor" }, "europe"), true);
  assert.equal(matchesRegion({ title: "Japonya ekonomisi b\u00fcy\u00fcd\u00fc" }, "asia"), true);
  assert.equal(matchesRegion({ title: "ABD yeni karar\u0131 a\u00e7\u0131klad\u0131" }, "north-america"), true);
  assert.equal(matchesRegion({ title: "Brezilya zirveye ev sahipli\u011fi yapacak" }, "south-america"), true);
  assert.equal(matchesRegion({ title: "Suudi Arabistan a\u00e7\u0131klama yapt\u0131" }, "middle-east"), true);
  assert.equal(matchesRegion({ title: "M\u0131s\u0131r heyeti topland\u0131" }, "africa"), true);
});

test("matches turkey signals and metadata", () => {
  assert.equal(matchesRegion({ sourceCountryCode: "TR" }, "turkey"), true);
  assert.equal(matchesRegion({ title: "Anadolu Ajans\u0131 Ankara geli\u015fmesini duyurdu" }, "turkey"), true);
});

test("matches direct source, event, mentioned region and country metadata", () => {
  assert.equal(matchesRegion({ sourceRegion: "europe" }, "europe"), true);
  assert.equal(matchesRegion({ detectedEventRegion: "asia" }, "asia"), true);
  assert.equal(matchesRegion({ mentionedRegions: ["africa"] }, "africa"), true);
  assert.equal(matchesRegion({ sourceCountry: "Brazil" }, "south-america"), true);
  assert.equal(matchesRegion({ mentionedCountries: ["Saudi Arabia"] }, "middle-east"), true);
});

test("event metadata overrides a global source for asia filtering", () => {
  const article = { sourceRegion: "global", detectedEventRegion: "asia", title: "BBC: China update" };
  assert.equal(matchesRegion(article, "asia"), true);
});

test("global matches global sources and multi-region articles", () => {
  assert.equal(matchesRegion({ isGlobalSource: true }, "global"), true);
  assert.equal(matchesRegion({ mentionedRegions: ["europe", "asia"] }, "global"), true);
});

test("trend matching uses regions, first seen region and propagation path", () => {
  assert.equal(matchesTrendRegion({ regions: ["asia"] }, "asia"), true);
  assert.equal(matchesTrendRegion({ firstSeenRegion: "europe" }, "europe"), true);
  assert.equal(matchesTrendRegion({ propagationPath: [{ region: "north-america" }] }, "north-america"), true);
});
