import { normalizeText } from "./textUtils.js";

function articleSource(article = {}, index = 0) {
  return String(article.sourceName || article.source || `Kaynak ${index + 1}`).trim();
}

function extractClaims(text) {
  if (!text) return []
  const sentences = String(text)
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 300)

  const ACTION_VERBS = [
    'artırdı','düşürdü','açıkladı','kabul etti','reddetti','imzaladı',
    'atandı','tutuklandı','hayatını kaybetti','kazandı','kaybetti',
    'tamamlandı','başladı','sona erdi','duyurdu','onayladı','veto etti',
    'istifa etti','görevden alındı','seçildi','yükseldi','geriledi',
    'arttı','azaldı','belirlendi','iptal edildi','ertelendi'
  ]

  return sentences.filter(s => {
    const lower = s.toLowerCase()
    const hasNumber = /\d/.test(s)
    const hasProperNoun = /[A-ZÇĞİÖŞÜ][a-zçğışöü]{2,}\s+[A-ZÇĞİÖŞÜ]/.test(s)
    const hasActionVerb = ACTION_VERBS.some(v => lower.includes(v))
    return hasNumber || hasProperNoun || hasActionVerb
  }).slice(0, 8)
}

function tokenizeClaim(text) {
  const STOP = new Set(['ve','ile','da','de','ki','bir','bu','o','için',
    'olan','den','dan','te','ta','ya','ye','ise','gibi','kadar'])
  return text.toLowerCase()
    .replace(/[''.,!?;:()\[\]]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
}

function claimSimilarity(a, b) {
  const ta = new Set(tokenizeClaim(a))
  const tb = new Set(tokenizeClaim(b))
  if (!ta.size || !tb.size) return 0
  const shared = [...ta].filter(t => tb.has(t)).length
  return shared / (ta.size + tb.size - shared)
}

function buildSourceTfIdf(articles) {
  // Her kaynak için token frekansı
  const tokenSets = articles.map(a => {
    const text = `${a.title || ''} ${a.summary || ''} ${a.fullText || ''}`
    return tokenizeClaim(text)
  })

  // IDF: log((N + 1) / (df + 1)) + 1
  const N = articles.length
  const df = new Map()
  for (const tokens of tokenSets) {
    for (const t of new Set(tokens)) {
      df.set(t, (df.get(t) || 0) + 1)
    }
  }

  // Her kaynak için TF-IDF vektörü
  return tokenSets.map((tokens, i) => {
    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    const scores = new Map()
    for (const [term, freq] of tf) {
      const idf = Math.log((N + 1) / ((df.get(term) || 0) + 1)) + 1
      scores.set(term, (1 + Math.log(freq)) * idf)
    }
    // En yüksek skorlu 8 terimi döndür
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term]) => term)
  })
}

export function isValidSentence(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return /^[A-ZÇĞİÖŞÜ0-9]/.test(trimmed);
}

export function cleanBulletText(text) {
  if (!text) return "";
  return String(text).replace(/^[â€¢•\-\s\*]+/, "").trim();
}

function extractActors(article) {
  const text = `${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`;
  const actors = [];
  const SKIP_WORDS = new Set(["Samsun","İstanbul","Ankara","İzmir","Bursa","Antalya","Adana","Konya","Türkiye","Avrupa","Amerika","Rusya","Çin","İngiltere","Almanya","Fransa","Tarih","Servis","Haber","Gündem","Ekonomi","Spor","Dünya","Teknoloji","Sağlık","Kültür","Bilim","Son","Yeni","Bugün","Flash","Breaking","Reuters","Associated","Press","Foto","Video","Güncelleme"]);
  const matches = text.match(/[A-ZÇĞİÖŞÜ][a-zçğışöü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]+)+/g) || [];
  const unique = [...new Set(matches)];
  for (const name of unique) {
    const words = name.split(/\s+/);
    if (words.some(w => SKIP_WORDS.has(w))) continue;
    if (words.length < 2 || words.length > 4) continue;
    actors.push(`${name}: Haberde adı geçen kişi/kurum`);
    if (actors.length >= 5) break;
  }
  if (actors.length === 0) {
    actors.push("Haberde belirgin bir aktör tespit edilemedi.");
  }
  return actors;
}

function extractPoliticalImpacts(article) {
  const text = `${article.title || ""} ${article.summary || ""} ${article.fullText || ""}`.toLowerCase();
  const impacts = [];
  const IMPACT_PATTERNS = [
    { pattern: /karar|onay|veto|yasa|kararname/i, msg: "Alınan kararların yasal ve toplumsal etkileri izlenmeli." },
    { pattern: /görüşme|müzakere|zirve|toplantı/i, msg: "Görüşme sonuçlarının diplomatik yansımaları bekleniyor." },
    { pattern: /seçim|oy|sandık|referandum/i, msg: "Seçim sürecinin siyasi dengeleri yeniden şekillendirmesi muhtemel." },
    { pattern: /ekonomi|enflasyon|faiz|döviz|bütçe/i, msg: "Ekonomik göstergelerin piyasa ve vatandaş üzerindeki etkileri takip edilmeli." },
    { pattern: /güvenlik|terör|saldırı|operasyon/i, msg: "Güvenlik gelişmelerinin bölgesel istikrar üzerindeki etkileri değerlendirilmeli." }
  ];
  for (const { pattern, msg } of IMPACT_PATTERNS) {
    if (pattern.test(text)) { impacts.push(msg); break; }
  }
  if (impacts.length === 0) {
    impacts.push("Gelişmenin toplumsal ve siyasi yansımaları takip edilmelidir.");
  }
  return impacts;
}

export function extractKeyFacts(article = {}) {
  const text = `${article.title || ""}. ${article.summary || ""}. ${article.fullText || ""}`;
  const sentences = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 5);
  return sentences.filter(s => /\d/.test(s) && isValidSentence(s));
}

export function buildSingleSourceAnalysis(article = {}, allVersions = []) {
  const category = (article.category || "").toLowerCase();
  
  const sections = [
    { key: "facts", title: "Önemli Gerçekler", items: extractKeyFacts(article) },
    { key: "context", title: "Bağlam", items: [article.summary || article.title || "Bağlam detayları bulunamadı."] },
    { key: "tone", title: "Haber Tonu", items: ["Haber nesnel bir sunuma sahiptir."] },
    { key: "uncertainty", title: "Belirsizlikler", items: ["Bağımsız ikinci kaynak bulunmadığından bilgiler tek yönlüdir."] }
  ];

  if (category.includes("politika") || category.includes("politics") || category.includes("siyaset")) {
    sections.push({ key: "actors", title: "Ana Aktörler", items: extractActors(article) });
    sections.push({ key: "political_impact", title: "Siyasi / Diplomatik Etki", items: extractPoliticalImpacts(article) });
  }

  return {
    mode: "single_source",
    summary: "Bu haber tek kaynak üzerinden analiz edilmiştir.",
    sections,
    editorialConclusion: "mevcut metindeki açık bilgiler doğrultusunda analiz edilmiştir."
  };
}

export function generateComparisonInsight(mainArticle = {}, allVersions = [], aiComparison = null) {
  if (aiComparison && (aiComparison.commonPoints || aiComparison.differences)) {
    return {
      mode: "ai_multi_source",
      sourceCount: allVersions.length,
      sections: [
        { key: "common", title: "Ortak Noktalar", items: aiComparison.commonPoints || [] },
        { key: "difference", title: "Farklılaşan Noktalar", items: aiComparison.differences || [] },
        { key: "facts", title: "Sayısal Veriler / Gerçekler", items: aiComparison.numbers || [] },
        { key: "tone", title: "Ton ve Eksikler", items: aiComparison.toneAndMissing || [] }
      ],
      commonPoints: aiComparison.commonPoints || [],
      differentPoints: aiComparison.differences || [],
      numericalData: aiComparison.numbers || [],
      missingPoints: aiComparison.toneAndMissing || []
    };
  }

  const overallComparison = typeof aiComparison === 'string' ? aiComparison : (aiComparison?.overallComparison || "");

  const fallbackSources = (allVersions || [])
    .filter((version) => version?.contentStatus && version.contentStatus !== "full_from_source_page")
    .map((version, index) => articleSource(version, index));
  if (!allVersions || allVersions.length < 2) {
    const singleInsight = buildSingleSourceAnalysis(mainArticle, allVersions);
    return {
      ...singleInsight,
      commonPoints: ['Karşılaştırma için en az 2 kaynak gerekiyor.'],
      differentPoints: [],
      numericalData: [],
      missingPoints: []
    };
  }

  // 1. Her kaynaktan claim'leri çıkar
  const claimsBySource = allVersions.map(v => ({
    source: v.sourceName || v.source || 'Kaynak',
    claims: extractClaims(`${v.title || ''} ${v.summary || ''} ${v.fullText || ''}`)
  }))

  // 2. Ortak claim'leri bul
  const firstClaims = claimsBySource[0].claims
  const commonClaims = []

  for (const claim of firstClaims) {
    let matchCount = 1
    for (let i = 1; i < claimsBySource.length; i++) {
      const hasMatch = claimsBySource[i].claims.some(
        c => claimSimilarity(claim, c) >= 0.40
      )
      if (hasMatch) matchCount++
    }
    if (matchCount >= Math.ceil(claimsBySource.length * 0.6)) {
      commonClaims.push(claim)
    }
  }

  // 3. Kaynağa özgü claim'leri bul (farklılaşan noktalar)
  const distinctByClaim = []
  for (const { source, claims } of claimsBySource) {
    for (const claim of claims) {
      const isCommon = commonClaims.some(c => claimSimilarity(claim, c) >= 0.40)
      if (!isCommon) {
        const otherSources = claimsBySource.filter(s => s.source !== source)
        const existsElsewhere = otherSources.some(s =>
          s.claims.some(c => claimSimilarity(claim, c) >= 0.35)
        )
        if (!existsElsewhere) {
          distinctByClaim.push({ source, claim })
        }
      }
    }
  }

  // 4. TF-IDF ile özgün terim vurguları
  const tfIdfPerSource = buildSourceTfIdf(allVersions)
  const differentPoints = []

  for (const { source, claim } of distinctByClaim.slice(0, 4)) {
    differentPoints.push(`${source}, "${claim.slice(0, 100)}${claim.length > 100 ? '…' : ''}" bilgisini öne çıkarıyor.`);
  }

  if (differentPoints.length === 0) {
    allVersions.forEach((v, i) => {
      const src = v.sourceName || v.source || 'Kaynak'
      const terms = tfIdfPerSource[i].slice(0, 3).join(', ')
      if (terms) {
        differentPoints.push(`${src}, "${terms}" terimlerine diğer kaynaklardan daha fazla vurgu yapıyor.`)
      }
    })
  }

  // 5. Sayısal verileri kaynak bazlı çıkar
  const numericalData = []
  const patterns = [
    { re: /(?:%\s*\d+[.,]?\d*)|(?:\d+[.,]?\d*\s*%)/g, label: 'Oran' },
    { re: /(\d+)\s*baz\s*puan/gi, label: 'Baz puan' },
    { re: /(\d+[.,]?\d*)\s*(milyon|milyar|bin)\s*(lira|dolar|euro|tl)/gi, label: 'Tutar' },
    { re: /\b\d{1,2}[:.]\d{2}\b/g, label: 'Saat' },
    { re: /\b\d{1,2}\s*(kişi|yaralı|ölü|derece|dk|dakika|saat|gün|ay)\b/gi, label: 'Sayı' },
    { re: /\b(\d{1,2})[-–](\d{1,2})\b/g, label: 'Skor' },
    { re: /\b\d{1,2}\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\b/gi, label: 'Tarih' },
    { re: /(\d{4})\s*yılı/g, label: 'Yıl' },
    { re: /\b\d+[.,]\d+\b/g, label: 'Ondalık Değer' }
  ]

  const numberSources = new Map()
  allVersions.forEach((version) => {
    const src = version.sourceName || version.source || 'Kaynak'
    const text = `${version.title || ''} ${version.summary || ''} ${version.fullText || ''}`
    for (const { re, label } of patterns) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text)) !== null) {
        const value = m[0].trim()
        const key = value.toLowerCase().replace(/\s+/g, '')
        if (!numberSources.has(key)) numberSources.set(key, { value, label, sources: new Set() })
        numberSources.get(key).sources.add(src)
      }
    }
  })

  for (const item of numberSources.values()) {
    numericalData.push(`${item.label}: ${item.value} (${[...item.sources].slice(0, 3).join(', ')})`)
    if (numericalData.length >= 6) break
  }

  // 6. Eksik/belirsiz noktalar
  const missingPoints = []
  const comparisonText = typeof overallComparison === 'string'
    ? overallComparison
    : (overallComparison?.overallComparison || '');

  if (comparisonText) {
    const sentences = comparisonText.split(/[.!?]/).filter(s => s.trim().length > 20)
    for (const s of sentences) {
      const lower = s.toLowerCase()
      if (lower.includes('belirsiz') || lower.includes('eksik') ||
          lower.includes('bilinmiyor') || lower.includes('netleşmedi') ||
          lower.includes('açıklanmadı')) {
        missingPoints.push(s.trim())
      }
    }
  }

  if (missingPoints.length === 0) {
    const shortSources = allVersions.filter(v =>
      (v.fullText || v.summary || '').length < 200
    )
    if (shortSources.length > 0) {
      const names = shortSources.map(v => v.sourceName || v.source).join(', ')
      missingPoints.push(`${names} kaynakları haberi kısa tuttuğundan ek bağlam eksik.`)
    }
    if (missingPoints.length === 0) {
      missingPoints.push('Kaynakların yanıtlamadığı temel sorular kontrol edilmeli: olayın kesin nedeni, etkilenen kişi sayısı, resmi açıklama ve sonraki adımlar net mi?')
    }
  }

  const commonPointsResult = commonClaims.length > 0
    ? commonClaims.slice(0, 4)
    : [
        `Kaynaklar aynı ana olayı aktarıyor: ${mainArticle.title || 'haberdeki gelişme'}.`,
        mainArticle.summary || 'Yer, zaman, taraflar ve sonuç bilgileri kaynaklar arasında konu bazında karşılaştırılmalıdır.'
      ].filter(Boolean);
  const differentPointsResult = differentPoints.slice(0, 4);
  if (fallbackSources.length) {
    differentPointsResult.push(`Tam metni alınamayan kaynaklar kısa özetle değerlendirildi: ${fallbackSources.join(", ")}.`);
  }
  const numericalDataResult = numericalData.slice(0, 5);
  const missingPointsResult = missingPoints.slice(0, 3);

  const sections = [
    { key: "common", title: "Ortak Noktalar", items: commonPointsResult },
    { key: "difference", title: "Farklılaşan Noktalar", items: differentPointsResult },
    { key: "facts", title: "Sayısal Veriler / Gerçekler", items: numericalDataResult },
    { key: "tone", title: "Haber Tonu ve Eksikler", items: missingPointsResult }
  ];

  return {
    mode: "limited_multi_source",
    sourceCount: allVersions.length,
    sections,
    commonPoints: commonPointsResult,
    differentPoints: differentPointsResult,
    numericalData: numericalDataResult,
    missingPoints: missingPointsResult
  };
}

export function normalizeComparisonArticles(mainArticle = {}, duplicates = [], similarArticles = []) {
  const seen = new Set();
  return [
    { ...mainArticle, isMain: true },
    ...duplicates,
    ...similarArticles
  ].filter((article) => {
    if (!article) return false;
    const key = normalizeText(String(article.id || article.sourceUrl || article.url || article.title || `${articleSource(article)} ${article.title || ""}`));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((article, index) => ({
    ...article,
    sourceName: article.sourceName || article.source || `Kaynak ${index + 1}`,
    source: article.source || article.sourceName || `Kaynak ${index + 1}`,
    internalId: index === 0 ? "main_0" : `rel_${index}`,
    isMain: index === 0
  }));
}

export { extractClaims, tokenizeClaim, claimSimilarity, buildSourceTfIdf };
