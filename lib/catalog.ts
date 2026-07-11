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

const official = "https://www.rolex.com/watches";

const catalog: Record<string, Omit<WatchDraft, "referenceNumber">> = {
  "126500LN": { modelName: "Oyster Perpetual Cosmograph Daytona", nickname: "Panda", retailPriceUsd: 16700, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 40, dial: "White", bezel: "Black Cerachrom", bracelet: "Oyster", movement: "Calibre 4131", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
  "126610LN": { modelName: "Oyster Perpetual Submariner Date", nickname: "", retailPriceUsd: 11100, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 41, dial: "Black", bezel: "Black Cerachrom", bracelet: "Oyster", movement: "Calibre 3235", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
  "126710BLRO": { modelName: "Oyster Perpetual GMT-Master II", nickname: "Pepsi", retailPriceUsd: 12100, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 40, dial: "Black", bezel: "Red and blue Cerachrom", bracelet: "Jubilee", movement: "Calibre 3285", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
  "124060": { modelName: "Oyster Perpetual Submariner", nickname: "No Date", retailPriceUsd: 9950, discontinued: false, photoSourceUrl: null, specs: { caseSizeMm: 41, dial: "Black", bezel: "Black Cerachrom", bracelet: "Oyster", movement: "Calibre 3230", material: "Oystersteel" }, source: { name: "Rolex", url: official, note: "Official Rolex product information; confirm current MSRP before purchase." } },
};

export function normalizeReference(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function lookupReference(reference: string): WatchDraft {
  const referenceNumber = normalizeReference(reference);
  const found = catalog[referenceNumber];
  if (found) return { referenceNumber, ...found };
  return {
    referenceNumber,
    modelName: "",
    nickname: "",
    retailPriceUsd: null,
    discontinued: false,
    photoSourceUrl: null,
    specs: {},
    source: { name: "WatchBase fallback", url: "https://watchbase.com/", note: "No Phase 0 catalog match. Confirm the reference against Rolex, or WatchBase for discontinued models, then complete the fields manually." },
  };
}
