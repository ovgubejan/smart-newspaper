import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSingleSourceAnalysis,
  cleanBulletText,
  extractKeyFacts,
  isValidSentence
} from "../utils/comparisonInsight.js";

test("comparison bullets reject clipped sentence fragments", () => {
  assert.equal(isValidSentence("an. Atatürk'ün tarihe kazınan sözü haberin merkezinde yer aldı."), false);
  assert.equal(isValidSentence("ü, Kurtuluş Savaşı'nın başlangıcı olarak anlatılan sürece işaret ediyor."), false);
  assert.equal(isValidSentence("emal Paşa, İstanbuldan ayrılarak Samsun'a doğru yola çıktı."), false);
  assert.equal(cleanBulletText("  - Mustafa Kemal Paşa, Samsun'a çıkarak sürecin merkezinde yer aldı.").startsWith("Mustafa"), true);
});

test("key facts use full clean sentences instead of mid-word context slices", () => {
  const article = {
    id: "history-1",
    source: "Tarih Servisi",
    category: "Politika",
    title: "19 Mayıs'ın tarihsel önemi anlatıldı",
    summary: "Mustafa Kemal Paşa, İstanbul'dan ayrılarak Samsun'a doğru yola çıktı. Bu süreç 19 Mayıs 1919 tarihinde milli mücadele açısından dönüm noktası oldu.",
    fullText: "Düşman işgali altındaki ülkede karar alma süreci halkın direniş fikrini güçlendirdi."
  };
  const facts = extractKeyFacts(article);

  assert.ok(facts.some((fact) => fact.startsWith("Bu süreç")));
  assert.ok(!facts.some((fact) => /^(an\.|ü,|emal\s)/iu.test(fact)));
});

test("politics actor section does not render clipped fact fragments as actors", () => {
  const article = {
    id: "history-2",
    source: "Tarih Servisi",
    category: "Politika",
    title: "Mustafa Kemal Paşa'nın Samsun yolculuğu anlatıldı",
    summary: "Mustafa Kemal Paşa, Bandırma Vapuru ile Samsun'a doğru yola çıktı. Bu süreç 19 Mayıs 1919 tarihinde Kurtuluş Savaşı'nın başlangıcı olarak değerlendirildi.",
    fullText: "Türk halkı, milli mücadele bağlamında haberde öne çıkan toplumsal aktör olarak anlatıldı."
  };
  const insight = buildSingleSourceAnalysis(article, [article]);
  const actorSection = insight.sections.find((section) => section.title.includes("Akt"));

  assert.ok(actorSection.items.length >= 1);
  assert.ok(actorSection.items.every((item) => !/^(an\.|ü,|emal\s)/iu.test(item)));
  assert.ok(actorSection.items.some((item) => item.includes(":")));
});
