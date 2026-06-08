import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSingleSourceAnalysis,
  extractKeyFacts,
  generateComparisonInsight,
  normalizeComparisonArticles
} from "../utils/comparisonInsight.js";

const economyArticle = {
  id: "oil-1",
  source: "Piyasa Ajansı",
  category: "Ekonomi",
  title: "Petrol fiyatları İran gerilimi sonrası geriledi",
  summary: "Brent petrol 77 dolar seviyesine inerken WTI 74 dolara geriledi. Piyasa, yaptırım muafiyetleri ve diplomatik açıklamaları izliyor.",
  fullText: "Analistler fiyat hareketinin kalıcı olup olmayacağının henüz netleşmediğini belirtiyor."
};

test("single source insight does not fall back to a generic no-comparison sentence", () => {
  const insight = buildSingleSourceAnalysis(economyArticle, [economyArticle]);

  assert.equal(insight.mode, "single_source");
  assert.ok(insight.sections.length >= 4);
  assert.ok(insight.summary.includes("tek kaynak"));
  assert.ok(!insight.summary.includes("karşılaştırmalı analiz yapmak mümkün değildir"));
});

test("key facts are extracted from visible article text only", () => {
  const facts = extractKeyFacts(economyArticle);

  assert.ok(facts.some((fact) => fact.includes("77 dolar")));
  assert.ok(facts.some((fact) => fact.includes("74 dolara")));
});

test("multi source insight creates common, difference, facts and tone sections", () => {
  const second = {
    id: "oil-2",
    source: "Enerji Bülteni",
    category: "Ekonomi",
    title: "Enerji piyasasında petrol gerilimi fiyatlara yansıdı",
    summary: "Kaynaklar Brent ve WTI fiyatlarında düşüşe işaret ederken diplomatik trafiğin piyasayı rahatlattığını aktarıyor."
  };
  const third = {
    id: "oil-3",
    source: "Küresel Piyasa",
    category: "Ekonomi",
    title: "Yaptırım beklentisi ve İran açıklamaları petrol piyasasını etkiledi",
    summary: "Haberde yaptırım muafiyeti, diplomatik açıklamalar ve kısa vadeli fiyatlama öne çıkıyor."
  };

  const insight = generateComparisonInsight(economyArticle, [economyArticle, second, third]);
  const sectionKeys = insight.sections.map((section) => section.key);

  assert.equal(insight.mode, "limited_multi_source");
  assert.equal(insight.sourceCount, 3);
  assert.ok(sectionKeys.includes("common"));
  assert.ok(sectionKeys.includes("difference"));
  assert.ok(sectionKeys.includes("facts"));
  assert.ok(sectionKeys.includes("tone"));
});

test("normalization deduplicates the main article and related list", () => {
  const normalized = normalizeComparisonArticles(economyArticle, [{ ...economyArticle }], [
    { id: "oil-2", source: "Enerji Bülteni", title: "Aynı konuda ikinci haber" }
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].internalId, "main_0");
  assert.equal(normalized[1].internalId, "rel_1");
});

test("politics insight surfaces actor and political impact sections", () => {
  const article = {
    id: "pol-1",
    source: "Siyaset Servisi",
    category: "Politika",
    title: "Bakan Ankara'da yeni diplomasi turunu açıkladı",
    summary: "Bakan Mehmet Kaya, Ankara'da yaptığı açıklamada görüşmelerin gelecek hafta süreceğini söyledi."
  };
  const insight = buildSingleSourceAnalysis(article, [article]);
  const titles = insight.sections.map((section) => section.title);

  assert.ok(titles.includes("Ana Aktörler"));
  assert.ok(titles.includes("Siyasi / Diplomatik Etki"));
});

test("low-data article still returns honest useful sections", () => {
  const article = {
    id: "low-1",
    source: "Kısa Haber",
    category: "Gündem",
    title: "Kısa açıklama gündeme geldi"
  };
  const insight = generateComparisonInsight(article, [article]);
  const uncertainty = insight.sections.find((section) => section.key === "uncertainty");

  assert.equal(insight.mode, "single_source");
  assert.ok(uncertainty.items.some((item) => item.includes("Bağımsız ikinci kaynak")));
  assert.ok(insight.editorialConclusion.includes("mevcut metindeki açık bilgiler"));
});
