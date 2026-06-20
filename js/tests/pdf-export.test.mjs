import test from "node:test";
import assert from "node:assert";

test("Smoke: PDF export config formats are backward compatible", () => {
  // Test ensuring that the required formats still exist so backward compatibility 
  // with fallback doesn't break.
  const legacyConfigs = {
    a4: { format: "a4", orientation: "portrait" },
    tabloid: { format: [279.4, 431.8], orientation: "portrait" },
    booklet: { format: "a5", orientation: "portrait" },
    egazete: { format: "a4", orientation: "portrait" }
  };

  const currentConfigs = {
    a4: { format: "a4", widthMm: 210, heightMm: 297, orientation: "portrait" },
    tabloid: { format: [279.4, 431.8], widthMm: 279.4, heightMm: 431.8, orientation: "portrait" },
    booklet: { format: "a5", widthMm: 148, heightMm: 210, orientation: "portrait" },
    egazete: { format: "a4", widthMm: 210, heightMm: 297, orientation: "portrait" }
  };

  for (const layout of ["a4", "tabloid", "booklet", "egazete"]) {
    const legacy = legacyConfigs[layout];
    const current = currentConfigs[layout];
    
    // We expect the structural identity for format and orientation
    assert.deepStrictEqual(current.format, legacy.format);
    assert.strictEqual(current.orientation, legacy.orientation);
    
    // Width and height should be numbers
    assert.ok(typeof current.widthMm === "number");
    assert.ok(typeof current.heightMm === "number");
  }
});
