import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { computeTrendGroupsFrom, matchesTrendRegion } from "../services/trendService.js";

test("trend metadata exposes real propagation and growth data", () => {
  const trends = computeTrendGroupsFrom([
    {
      id: "asia-first",
      title: "Ortak salg\u0131n haberi yeni geli\u015fme",
      sourceName: "Tokyo News",
      sourceRegion: "asia",
      sourceCountry: "Japan",
      publishedAt: "2026-06-01T08:00:00.000Z"
    },
    {
      id: "europe-next",
      title: "Ortak salg\u0131n haberi yeni geli\u015fme",
      sourceName: "Berlin News",
      sourceRegion: "europe",
      sourceCountry: "Germany",
      publishedAt: "2026-06-01T10:00:00.000Z"
    }
  ]);

  assert.equal(trends.length, 1);
  const meta = trends[0].trendMeta;
  assert.equal(meta.firstSeenRegion, "asia");
  assert.equal(meta.firstSeenCountry, "Japan");
  assert.deepEqual(meta.propagationPath.map((step) => step.region), ["asia", "europe"]);
  assert.ok(meta.growthSeries.every((point) => Number.isFinite(point.sourceCount)));
  assert.ok(["rising", "stable", "fading"].includes(meta.trendStatus));
  assert.equal(matchesTrendRegion(trends[0], "europe"), true);
});

test("same event propagates from asia to europe and north america", () => {
  const articles = [
    ["nhk", "NHK", "Japan", "asia", "2026-06-01T08:00:00Z"],
    ["scmp", "South China Morning Post", "China", "asia", "2026-06-01T09:00:00Z"],
    ["bbc", "BBC", "United Kingdom", "europe", "2026-06-01T11:00:00Z"],
    ["dw", "Deutsche Welle", "Germany", "europe", "2026-06-01T12:00:00Z"],
    ["cnn", "CNN", "United States", "north-america", "2026-06-01T15:00:00Z"]
  ].map(([id, sourceName, sourceCountry, sourceRegion, publishedAt]) => ({
    id,
    title: "Respiratory virus outbreak spreads internationally",
    originalTitle: "Respiratory virus outbreak spreads internationally",
    summary: "Health authorities monitor the same respiratory virus event.",
    sourceName,
    sourceCountry,
    sourceRegion,
    mentionedCountries: [sourceCountry],
    category: "health",
    publishedAt
  }));

  const trend = computeTrendGroupsFrom(articles)[0];
  assert.ok(trend);
  assert.equal(trend.sourceCount, 5);
  assert.equal(trend.firstSeenRegion, "asia");
  assert.equal(trend.firstSeenCountry, "Japan");
  assert.deepEqual(trend.propagationPath.map((step) => step.region), ["asia", "europe", "north-america"]);
  assert.ok(trend.growthSeries.every((point, index, series) => index === 0 || point.sourceCount >= series[index - 1].sourceCount));
  assert.equal(typeof trend.growthSpeed, "number");
  assert.ok(["rising", "stable", "fading"].includes(trend.trendStatus));
  assert.ok(["asia", "europe", "north-america"].every((region) => trend.regions.includes(region)));
  assert.ok(["Japan", "China", "Germany", "United States"].every((country) => trend.countries.includes(country)));
  assert.ok(trend.representativeArticle);
});

test("unrelated health, football and economy articles are not forced into one trend", () => {
  const trends = computeTrendGroupsFrom([
    { id: "health", title: "Respiratory virus outbreak spreads", sourceName: "NHK", sourceRegion: "asia" },
    { id: "football", title: "Football team wins championship final", sourceName: "Sports", sourceRegion: "europe" },
    { id: "economy", title: "Central bank changes interest rate", sourceName: "Finance", sourceRegion: "north-america" }
  ]);
  assert.equal(trends.length, 0);
});

test("presentation demo produces one rising asia to europe to north america trend", () => {
  const articles = JSON.parse(fs.readFileSync(new URL("../../db/demo-regional-pandemic.json", import.meta.url), "utf8"))
    .map((article) => ({
      ...article,
      title: article.title || article.translatedTitle || article.originalTitle,
      summary: article.summary || article.translatedSummary || "Regional respiratory virus outbreak health officials monitor cases"
    }));
  const trends = computeTrendGroupsFrom(articles);
  assert.equal(trends.length, 1);
  const trend = trends[0];
  assert.equal(trend.sourceCount, 9);
  assert.equal(trend.firstSeenRegion, "asia");
  assert.deepEqual(trend.propagationPath.map((step) => step.region), ["asia", "europe", "north-america"]);
  assert.equal(trend.trendStatus, "rising");
  assert.ok(trend.growthSeries.every((point, index, series) => index === 0 || point.sourceCount >= series[index - 1].sourceCount));
  assert.equal(matchesTrendRegion(trend, "asia"), true);
  assert.equal(matchesTrendRegion(trend, "europe"), true);
  assert.equal(matchesTrendRegion(trend, "north-america"), true);
  assert.equal(matchesTrendRegion(trend, "global"), true);
});
