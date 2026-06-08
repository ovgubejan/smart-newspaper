import assert from "node:assert/strict";
import test from "node:test";

import { REGIONAL_SOURCE_CATALOG } from "../data/regionalSources.js";

const REGIONS = ["global", "europe", "asia", "africa", "north-america", "south-america", "oceania", "middle-east", "turkey"];
const REQUIRED_FIELDS = ["id", "sourceName", "country", "countryCode", "region", "language", "trustLevel", "sourceType", "enabled"];

test("regional source catalog has valid canonical metadata", () => {
  assert.ok(Array.isArray(REGIONAL_SOURCE_CATALOG));
  assert.ok(REGIONAL_SOURCE_CATALOG.length > 0);
  const ids = new Set();
  for (const source of REGIONAL_SOURCE_CATALOG) {
    REQUIRED_FIELDS.forEach((field) => assert.ok(field in source, `${source.id || "source"} missing ${field}`));
    assert.ok(REGIONS.includes(source.region), `Invalid region: ${source.region}`);
    assert.ok(["high", "medium", "low"].includes(source.trustLevel), `Invalid trustLevel: ${source.trustLevel}`);
    assert.ok(["rss", "api", "official", "agency"].includes(source.sourceType), `Invalid sourceType: ${source.sourceType}`);
    assert.equal(ids.has(source.id), false, `Duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
});

test("every canonical region has at least three enabled sources", () => {
  for (const region of REGIONS) {
    const enabled = REGIONAL_SOURCE_CATALOG.filter((source) => source.region === region && source.enabled);
    assert.ok(enabled.length >= 3, `${region} has only ${enabled.length} enabled sources`);
  }
});
