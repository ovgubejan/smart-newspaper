export const REGION_OPTIONS = [
  { value: "global", label: "Global", icon: "fa-globe", country: "" },
  { value: "europe", label: "Avrupa", icon: "fa-landmark-dome", country: "" },
  { value: "asia", label: "Asya", icon: "fa-mountain-sun", country: "" },
  { value: "africa", label: "Afrika", icon: "fa-sun", country: "" },
  { value: "north-america", label: "Kuzey Amerika", icon: "fa-city", country: "United States" },
  { value: "south-america", label: "G\u00fcney Amerika", icon: "fa-seedling", country: "" },
  { value: "oceania", label: "Okyanusya", icon: "fa-water", country: "" },
  { value: "middle-east", label: "Orta Do\u011fu", icon: "fa-mosque", country: "" },
  { value: "turkey", label: "T\u00fcrkiye", icon: "fa-star-and-crescent", country: "Turkiye" }
];

export const REGION_KEYWORDS = {
  "north-america": [
    "abd", "amerika", "usa", "united states", "us", "trump", "biden",
    "washington", "white house", "new york", "california", "texas",
    "canada", "kanada", "mexico", "meksika"
  ],
  europe: [
    "avrupa", "eu", "european union", "avrupa birligi", "almanya", "germany",
    "fransa", "france", "ingiltere", "uk", "britain", "united kingdom",
    "italy", "italya", "spain", "ispanya", "ukraine", "ukrayna", "russia",
    "rusya", "nato", "brussels", "bruksel"
  ],
  asia: [
    "\u00e7in", "cin", "china", "japonya", "japan", "hindistan", "india",
    "south korea", "guney kore", "north korea", "kuzey kore", "pakistan",
    "singapore", "singapur"
  ],
  "middle-east": [
    "orta dogu", "ortadogu", "israil", "israel", "filistin", "palestine",
    "gaza", "gazze", "l\u00fcbnan", "lubnan", "lebanon", "syria", "suriye",
    "iraq", "irak", "iran", "saudi arabia", "suudi arabistan", "yemen",
    "qatar", "katar", "uae", "bae"
  ],
  africa: [
    "afrika", "africa", "egypt", "misir", "south africa", "guney afrika",
    "nigeria", "kenya", "morocco", "fas", "sudan", "ethiopia", "etiyopya"
  ],
  "south-america": [
    "brazil", "brezilya", "argentina", "arjantin", "chile", "sili",
    "colombia", "kolombiya", "venezuela", "peru"
  ],
  oceania: [
    "australia", "avustralya", "new zealand", "yeni zelanda", "fiji", "okyanusya"
  ],
  turkey: [
    "t\u00fcrkiye", "turkiye", "turkey", "ankara", "istanbul", "izmir",
    "t\u00fcrk", "turkish", "trt", "anadolu ajansi", "erdo\u011fan", "erdogan", "tbmm", "chp", "akp", "mhp"
  ],
  global: ["world", "global", "international", "dunya", "kuresel", "uluslararasi"]
};

export const REGION_ALIASES = {
  // --- global ---
  global: "global",
  Global: "global",
  world: "global",
  worldwide: "global",
  D\u00fcnya: "global",
  dunya: "global",
  World: "global",
  // --- europe ---
  Avrupa: "europe",
  Europe: "europe",
  europe: "europe",
  // --- asia ---
  Asya: "asia",
  Asia: "asia",
  asia: "asia",
  // --- africa ---
  Afrika: "africa",
  Africa: "africa",
  africa: "africa",
  // --- north-america (hyphen = canonical, underscore = backward compat) ---
  "Kuzey Amerika": "north-america",
  "North America": "north-america",
  "north america": "north-america",
  "north_america": "north-america",
  "north-america": "north-america",
  Amerika: "north-america",
  America: "north-america",
  // --- south-america ---
  "G\u00fcney Amerika": "south-america",
  "Guney Amerika": "south-america",
  "South America": "south-america",
  "south america": "south-america",
  "south_america": "south-america",
  "south-america": "south-america",
  // --- oceania ---
  Okyanusya: "oceania",
  Oceania: "oceania",
  Australia: "oceania",
  oceania: "oceania",
  // --- middle-east ---
  "Orta Do\u011fu": "middle-east",
  "Orta Dogu": "middle-east",
  "Middle East": "middle-east",
  "middle east": "middle-east",
  "middle_east": "middle-east",
  "middle-east": "middle-east",
  // --- turkey ---
  "T\u00fcrkiye": "turkey",
  Turkiye: "turkey",
  Turkey: "turkey",
  turkey: "turkey",
  TR: "turkey",
  tr: "turkey"
};
