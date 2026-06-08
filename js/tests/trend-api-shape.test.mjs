import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { computeTrendGroupsFrom } from "../services/trendService.js";

const articles = [
  { id: "a", title: "Virus outbreak health alert", sourceName: "NHK", sourceRegion: "asia", sourceCountry: "Japan", publishedAt: "2026-06-01T08:00:00Z" },
  { id: "b", title: "Virus outbreak health alert update", sourceName: "BBC", sourceRegion: "europe", sourceCountry: "UK", publishedAt: "2026-06-01T10:00:00Z" }
];

test("trend output exposes the API shape", () => {
  const trend = computeTrendGroupsFrom(articles)[0];
  assert.ok(trend);
  for (const field of [
    "id", "title", "representativeArticle", "articles", "sourceCount", "sources",
    "regions", "countries", "firstSeenAt", "firstSeenRegion", "firstSeenCountry",
    "propagationPath", "growthSeries", "growthSpeed", "trendStatus", "confidenceScore"
  ]) assert.ok(field in trend, `Missing trend field: ${field}`);
});

test("trend service does not generate fake propagation or growth with Math.random", () => {
  const source = fs.readFileSync(new URL("../services/trendService.js", import.meta.url), "utf8");
  const suspicious = source.split(/\r?\n/).filter((line) =>
    /Math\.random/.test(line) && /(growth|sparkline|trend|region|propagation)/i.test(line)
  );
  assert.deepEqual(suspicious, []);
});
