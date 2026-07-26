import { canonicalizeProductId } from "@/lib/productIdAliases";
import { RAW_RESOURCE_OPTIONS } from "@/lib/resources";
import type {
  InputMode,
  MinerMk,
  MinerSettings,
  ProductTargetLine,
  RawDemandLine,
  ScoringMode,
  ScoringOptions,
} from "@/types";
import { DEFAULT_MINER_SETTINGS, DEFAULT_SCORING_OPTIONS } from "@/types";

/**
 * Compact binary plan hash — **computation only**.
 * Format: `v1.<base64url(bytes)>`
 *
 * Encodes: mode, demand lines, miner, Centered/Weighted, centerPower, topN, site spread.
 * Does **not** encode: heat opacity, paint knobs, show-nodes, peak emphasis.
 */
export const PLAN_HASH_VERSION = 1 as const;

export const PLAN_PRODUCT_IDS = [
  "Desc_AILimiter_C",
  "Desc_AlcladAluminumSheet_C",
  "Desc_AluminaSolution_C",
  "Desc_AluminumCasing_C",
  "Desc_AluminumIngot_C",
  "Desc_AluminumScrap_C",
  "Desc_BlackPowder_C",
  "Desc_Cable_C",
  "Desc_CircuitBoard_C",
  "Desc_CompactedCoal_C",
  "Desc_Computer_C",
  "Desc_Cement_C", // Concrete
  "Desc_CopperIngot_C",
  "Desc_CopperSheet_C",
  "Desc_CrystalOscillator_C",
  "Desc_SteelPlateReinforced_C", // Encased Industrial Beam
  "Desc_Fuel_C",
  "Desc_GoldIngot_C",
  "Desc_ModularFrameHeavy_C", // Heavy Modular Frame
  "Desc_HeavyOilResidue_C",
  "Desc_HighSpeedConnector_C",
  "Desc_IronIngot_C",
  "Desc_IronPlate_C",
  "Desc_IronRod_C",
  "Desc_ModularFrame_C",
  "Desc_Motor_C",
  "Desc_Plastic_C",
  "Desc_PolymerResin_C",
  "Desc_QuartzCrystal_C",
  "Desc_Quickwire_C",
  "Desc_RadioControlUnit_C",
  "Desc_IronPlateReinforced_C", // Reinforced Iron Plate
  "Desc_Rotor_C",
  "Desc_Rubber_C",
  "Desc_IronScrew_C", // Screws
  "Desc_Silica_C",
  "Desc_Stator_C",
  "Desc_SteelPlate_C", // Steel Beam (Docs ClassName)
  "Desc_SteelIngot_C",
  "Desc_SteelPipe_C",
  "Desc_Supercomputer_C",
  "Desc_LiquidTurboFuel_C",
  "Desc_Wire_C",
] as const;

const RAW_IDS: readonly string[] = RAW_RESOURCE_OPTIONS;
const PRODUCT_IDS: readonly string[] = PLAN_PRODUCT_IDS;
const MAX_LINES = 15;
const MAX_RATE = 65_535;

/** Fields applied from a shared link (scoring display knobs stay local). */
export type PlanSnapshot = {
  mode: InputMode;
  rawDemand: Array<{ resource: string; itemsPerMinute: number }>;
  productTargets: Array<{ productId: string; itemsPerMinute: number }>;
  miner: MinerSettings;
  scoringMode: ScoringMode;
  /** Only centerPower / topN / siteSepFraction are meaningful from the hash. */
  scoringOptions: Pick<ScoringOptions, "centerPower" | "topN" | "siteSepFraction">;
};

export type PlanHashSource = {
  mode: InputMode;
  rawDemand: RawDemandLine[];
  productTargets: ProductTargetLine[];
  miner: MinerSettings;
  scoringMode: ScoringMode;
  scoringOptions: ScoringOptions;
};

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function quantize(value: number, min: number, step: number, maxSteps: number): number {
  const q = Math.round((value - min) / step);
  return Math.min(maxSteps, Math.max(0, q));
}

function dequantize(q: number, min: number, step: number): number {
  return min + q * step;
}

export function toSnapshot(source: PlanHashSource): PlanSnapshot {
  return {
    mode: source.mode === "product" ? "product" : "raw",
    rawDemand: source.rawDemand
      .filter((l) => l.resource)
      .slice(0, MAX_LINES)
      .map((l) => ({
        resource: l.resource,
        itemsPerMinute: Math.min(MAX_RATE, Math.max(0, Math.round(Number(l.itemsPerMinute) || 0))),
      })),
    productTargets: source.productTargets
      .filter((l) => l.productId)
      .slice(0, MAX_LINES)
      .map((l) => ({
        productId: canonicalizeProductId(l.productId),
        itemsPerMinute: Math.min(MAX_RATE, Math.max(0, Math.round(Number(l.itemsPerMinute) || 0))),
      })),
    miner: {
      minerMk: ([1, 2, 3].includes(source.miner.minerMk)
        ? source.miner.minerMk
        : DEFAULT_MINER_SETTINGS.minerMk) as MinerMk,
      clockPercent: clamp(source.miner.clockPercent, 1, 250, DEFAULT_MINER_SETTINGS.clockPercent),
    },
    scoringMode: source.scoringMode === "weighted" ? "weighted" : "centered",
    scoringOptions: {
      centerPower: clamp(
        source.scoringOptions.centerPower,
        1,
        2.5,
        DEFAULT_SCORING_OPTIONS.centerPower,
      ),
      topN: Math.round(clamp(source.scoringOptions.topN, 3, 10, DEFAULT_SCORING_OPTIONS.topN)),
      siteSepFraction: clamp(
        source.scoringOptions.siteSepFraction,
        0.04,
        0.4,
        DEFAULT_SCORING_OPTIONS.siteSepFraction,
      ),
    },
  };
}

function indexOfId(list: readonly string[], id: string): number {
  const i = list.indexOf(id);
  return i >= 0 ? i : -1;
}

export function encodePlanBytes(snap: PlanSnapshot): Uint8Array {
  const raw = snap.rawDemand.filter((d) => indexOfId(RAW_IDS, d.resource) >= 0).slice(0, MAX_LINES);
  const products = snap.productTargets
    .filter((d) => indexOfId(PRODUCT_IDS, d.productId) >= 0)
    .slice(0, MAX_LINES);

  const activeRaw = snap.mode === "raw" ? raw : [];
  const activeProducts = snap.mode === "product" ? products : [];

  const out: number[] = [];

  // flags: mode | scoring | mk(2) | reserved
  const mkBits = Math.min(2, Math.max(0, snap.miner.minerMk - 1));
  let flags = 0;
  if (snap.mode === "product") flags |= 1;
  if (snap.scoringMode === "weighted") flags |= 2;
  flags |= (mkBits & 3) << 3;
  out.push(flags);

  out.push(Math.min(250, Math.max(1, Math.round(snap.miner.clockPercent))));

  // Computation knobs only (2 bytes):
  // centerPower 5 | topN 3 | siteSep 5  → 13 bits
  const cp = quantize(snap.scoringOptions.centerPower, 1, 0.05, 30);
  const tn = Math.min(7, Math.max(0, snap.scoringOptions.topN - 3));
  // 0.04 + i*0.02, i=0..18 → 0.04 … 0.40 (5-bit field)
  const ss = quantize(snap.scoringOptions.siteSepFraction, 0.04, 0.02, 18);
  const packed = (cp & 31) | ((tn & 7) << 5) | ((ss & 31) << 8);
  out.push(packed & 0xff);
  out.push((packed >>> 8) & 0xff);

  out.push((activeRaw.length & 15) | ((activeProducts.length & 15) << 4));

  for (const d of activeRaw) {
    out.push(indexOfId(RAW_IDS, d.resource) & 0xff);
    const rate = Math.min(MAX_RATE, Math.max(0, Math.round(d.itemsPerMinute)));
    out.push(rate & 0xff);
    out.push((rate >>> 8) & 0xff);
  }
  for (const d of activeProducts) {
    out.push(indexOfId(PRODUCT_IDS, d.productId) & 0xff);
    const rate = Math.min(MAX_RATE, Math.max(0, Math.round(d.itemsPerMinute)));
    out.push(rate & 0xff);
    out.push((rate >>> 8) & 0xff);
  }

  return new Uint8Array(out);
}

export function decodePlanBytes(bytes: Uint8Array): PlanSnapshot | null {
  if (bytes.length < 4) return null;
  let i = 0;
  const flags = bytes[i++] ?? 0;
  const mode: InputMode = flags & 1 ? "product" : "raw";
  const scoringMode: ScoringMode = flags & 2 ? "weighted" : "centered";
  const minerMk = (Math.min(2, (flags >>> 3) & 3) + 1) as MinerMk;
  const clockPercent = clamp(bytes[i++] ?? 100, 1, 250, 100);

  const b0 = bytes[i++] ?? 0;
  const b1 = bytes[i++] ?? 0;
  const packed = b0 | (b1 << 8);
  const centerPower = dequantize(packed & 31, 1, 0.05);
  const topN = 3 + ((packed >>> 5) & 7);
  const siteSepFraction = dequantize((packed >>> 8) & 31, 0.04, 0.02);

  const counts = bytes[i++] ?? 0;
  const nRaw = counts & 15;
  const nProd = (counts >>> 4) & 15;
  if (i + nRaw * 3 + nProd * 3 > bytes.length) return null;

  const rawDemand: PlanSnapshot["rawDemand"] = [];
  for (let k = 0; k < nRaw; k++) {
    const idx = bytes[i++] ?? 0;
    const lo = bytes[i++] ?? 0;
    const hi = bytes[i++] ?? 0;
    const resource = RAW_IDS[idx];
    if (!resource) continue;
    rawDemand.push({ resource, itemsPerMinute: lo | (hi << 8) });
  }
  const productTargets: PlanSnapshot["productTargets"] = [];
  for (let k = 0; k < nProd; k++) {
    const idx = bytes[i++] ?? 0;
    const lo = bytes[i++] ?? 0;
    const hi = bytes[i++] ?? 0;
    const productId = PRODUCT_IDS[idx];
    if (!productId) continue;
    productTargets.push({ productId, itemsPerMinute: lo | (hi << 8) });
  }

  return toSnapshot({
    mode,
    rawDemand: rawDemand.map((d, j) => ({ id: `h${j}`, ...d })),
    productTargets: productTargets.map((d, j) => ({ id: `h${j}`, ...d })),
    miner: { minerMk, clockPercent },
    scoringMode,
    scoringOptions: {
      ...DEFAULT_SCORING_OPTIONS,
      centerPower,
      topN,
      siteSepFraction,
    },
  });
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(b64url: string): Uint8Array | null {
  try {
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
    return bytes;
  } catch {
    return null;
  }
}

export function encodePlanHash(source: PlanHashSource): string {
  const snap = toSnapshot(source);
  return `v${PLAN_HASH_VERSION}.${bytesToBase64Url(encodePlanBytes(snap))}`;
}

export function decodePlanHash(hash: string): PlanSnapshot | null {
  let raw = hash.trim();
  if (raw.startsWith("#")) raw = raw.slice(1);
  if (!raw) return null;

  const m = /^v(\d+)\.([A-Za-z0-9_-]+)$/.exec(raw);
  if (!m) return null;
  const version = Number(m[1]);
  const payload = m[2];
  if (!payload || version !== PLAN_HASH_VERSION) return null;

  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;
  return decodePlanBytes(bytes);
}

export function planHashEquals(a: PlanHashSource, b: PlanHashSource): boolean {
  return encodePlanHash(a) === encodePlanHash(b);
}
