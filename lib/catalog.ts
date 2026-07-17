export type WatchDraft = {
  referenceNumber: string;
  modelName: string;
  nickname: string;
  retailPriceUsd: number | null;
  discontinued: boolean;
  photoSourceUrl: string | null;
  specs: { caseSizeMm?: number; dial?: string; bezel?: string; bracelet?: string; movement?: string; material?: string };
  source: { name: string; url: string; note: string };
};

export type CatalogSuggestion = Pick<WatchDraft, "referenceNumber" | "modelName" | "nickname">;
type CatalogEntry = Omit<WatchDraft, "referenceNumber"> & { aliases: string[] };

const official = "https://www.rolex.com/watches";
const indexSource = { name: "Crown Tracker reference index", url: official, note: "Identity match from Crown Tracker's local reference index. Confirm the variant, specifications, and current MSRP before saving." };
const indexed = (modelName: string, nickname: string, aliases: string[], discontinued = false): CatalogEntry => ({ modelName, nickname, aliases, retailPriceUsd: null, discontinued, photoSourceUrl: null, specs: {}, source: indexSource });

// This intentionally stores identity hints separately from market facts. The
// small set of complete entries below can prefill details; index-only entries
// make more references discoverable without inventing a dial, MSRP, or spec.
const catalog: Record<string, CatalogEntry> = {
  "126500LN": { modelName: "Oyster Perpetual Cosmograph Daytona", nickname: "Panda", aliases: ["daytona", "white daytona", "ceramic daytona"], retailPriceUsd: 16700, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 40, dial: "White", bezel: "Black Cerachrom", bracelet: "Oyster", movement: "Calibre 4131", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
  "126610LN": { modelName: "Oyster Perpetual Submariner Date", nickname: "Black Sub Date", aliases: ["sub", "submariner", "black sub"], retailPriceUsd: 11100, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 41, dial: "Black", bezel: "Black Cerachrom", bracelet: "Oyster", movement: "Calibre 3235", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
  "126710BLRO": { modelName: "Oyster Perpetual GMT-Master II", nickname: "Pepsi", aliases: ["gmt", "gmt master", "red blue bezel"], retailPriceUsd: 12100, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 40, dial: "Black", bezel: "Red and blue Cerachrom", bracelet: "Jubilee", movement: "Calibre 3285", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
  "124060": { modelName: "Oyster Perpetual Submariner", nickname: "No Date", aliases: ["sub", "submariner", "no date sub"], retailPriceUsd: 9950, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 41, dial: "Black", bezel: "Black Cerachrom", bracelet: "Oyster", movement: "Calibre 3230", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
  "116500LN": indexed("Oyster Perpetual Cosmograph Daytona", "Ceramic Daytona", ["daytona", "panda", "116500"], true),
  "126508": indexed("Oyster Perpetual Cosmograph Daytona", "Yellow Gold Daytona", ["daytona", "yellow gold daytona"]),
  "126509": indexed("Oyster Perpetual Cosmograph Daytona", "White Gold Daytona", ["daytona", "white gold daytona"]),
  "126518LN": indexed("Oyster Perpetual Cosmograph Daytona", "Yellow Gold Oysterflex Daytona", ["daytona", "oysterflex"]),
  "126610LV": indexed("Oyster Perpetual Submariner Date", "Starbucks", ["sub", "submariner", "green bezel", "kermit"]),
  "126613LN": indexed("Oyster Perpetual Submariner Date", "Bluesy", ["sub", "submariner", "two tone sub", "blue dial"]),
  "126619LB": indexed("Oyster Perpetual Submariner Date", "White Gold Submariner", ["sub", "submariner", "blue bezel", "cookie monster"]),
  "126710BLNR": indexed("Oyster Perpetual GMT-Master II", "Batman", ["gmt", "batgirl", "black blue bezel"]),
  "126720VTNR": indexed("Oyster Perpetual GMT-Master II", "Sprite", ["gmt", "left handed", "destro", "green black bezel"]),
  "126711CHNR": indexed("Oyster Perpetual GMT-Master II", "Root Beer", ["gmt", "rootbeer", "two tone gmt"]),
  "126715CHNR": indexed("Oyster Perpetual GMT-Master II", "Everose Root Beer", ["gmt", "rootbeer", "rose gold gmt"]),
  "126334": indexed("Oyster Perpetual Datejust 41", "Datejust 41", ["datejust", "dj", "fluted bezel"]),
  "126300": indexed("Oyster Perpetual Datejust 41", "Smooth Bezel Datejust", ["datejust", "dj", "smooth bezel"]),
  "126333": indexed("Oyster Perpetual Datejust 41", "Two-Tone Datejust", ["datejust", "dj", "two tone"]),
  "124300": indexed("Oyster Perpetual 41", "Oyster Perpetual 41", ["op", "oyster perpetual", "celebration dial"]),
  "126000": indexed("Oyster Perpetual 36", "Oyster Perpetual 36", ["op", "oyster perpetual"]),
  "124270": indexed("Oyster Perpetual Explorer", "Explorer 36", ["explorer", "explorer 1"]),
  "224270": indexed("Oyster Perpetual Explorer", "Explorer 40", ["explorer", "explorer 1"]),
  "226570": indexed("Oyster Perpetual Explorer II", "Explorer II", ["explorer 2", "polar explorer", "black explorer"]),
  "126600": indexed("Oyster Perpetual Sea-Dweller", "Sea-Dweller", ["sea dweller", "sd43"]),
  "136660": indexed("Oyster Perpetual Deepsea", "Deepsea", ["sea dweller", "deep sea", "d blue"]),
  "126622": indexed("Oyster Perpetual Yacht-Master 40", "Yacht-Master Rhodium", ["yachtmaster", "ym", "rhodium dial"]),
  "226627": indexed("Oyster Perpetual Yacht-Master 42", "Titanium Yacht-Master", ["yachtmaster", "ym", "titanium"]),
  "336934": indexed("Oyster Perpetual Sky-Dweller", "Steel Sky-Dweller", ["sky dweller", "skydweller", "blue dial"]),
  "336935": indexed("Oyster Perpetual Sky-Dweller", "Everose Sky-Dweller", ["sky dweller", "skydweller", "rose gold"]),
  "228238": indexed("Oyster Perpetual Day-Date 40", "Yellow Gold Day-Date", ["day date", "daydate", "president"]),
  "228236": indexed("Oyster Perpetual Day-Date 40", "Platinum Day-Date", ["day date", "daydate", "ice blue"]),
  "126900": indexed("Oyster Perpetual Air-King", "Air-King", ["air king"]),
  "116400GV": indexed("Oyster Perpetual Milgauss", "Green Crystal Milgauss", ["milgauss", "lightning bolt"], true),
  "114270": indexed("Oyster Perpetual Explorer", "Explorer 36", ["explorer", "explorer 1"], true),
};

export function normalizeReference(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function lookupReference(reference: string): WatchDraft {
  const referenceNumber = normalizeReference(reference);
  const found = catalog[referenceNumber];
  if (found) {
    const { aliases: _aliases, ...draft } = found;
    return { referenceNumber, ...draft };
  }
  return {
    referenceNumber,
    modelName: "",
    nickname: "",
    retailPriceUsd: null,
    discontinued: false,
    photoSourceUrl: null,
    specs: {},
    source: { name: "WatchBase fallback", url: "https://watchbase.com/", note: "No local index match. Confirm the reference against Rolex, or WatchBase for discontinued models, then complete the fields manually." },
  };
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchCatalog(query: string): CatalogSuggestion[] {
  const needle = normalizeSearch(query);
  const tokens = needle.split(" ").filter(Boolean);
  return Object.entries(catalog)
    .map(([referenceNumber, watch]) => {
      const searchable = normalizeSearch([referenceNumber, watch.modelName, watch.nickname, ...watch.aliases].join(" "));
      const exact = normalizeSearch(referenceNumber) === needle || watch.aliases.some((alias) => normalizeSearch(alias) === needle);
      const score = !needle ? (watch.retailPriceUsd === null ? 0 : 100) : exact ? 100 : tokens.reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0);
      return { referenceNumber, modelName: watch.modelName, nickname: watch.nickname, score, matches: !needle || tokens.every((token) => searchable.includes(token)) };
    })
    .filter((watch) => watch.matches)
    .sort((left, right) => right.score - left.score || left.referenceNumber.localeCompare(right.referenceNumber))
    .slice(0, 8)
    .map(({ score: _score, matches: _matches, ...watch }) => watch);
}
