import { clampClockPercent } from "@/lib/mining";
import { canonicalizeProductId } from "@/lib/productIdAliases";
import { RAW_RESOURCE_OPTIONS } from "@/lib/resources";
import type { MapSeed } from "@/lib/seed";
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
 * Encodes: mode, demand lines, miner Mk + miner clock, Centered/Weighted,
 * centerPower, topN, site spread, includeElevation (flat-haul flag), optional world
 * seed (has-seed flag + i32; omitted when Default/null for short hashes), optional
 * external items (has-external flag + ClassName tokens — intermediates **and** Water),
 * extractor extension when present (water clock, well pressurizer clock, wells-enabled,
 * optional trailing oil clock), optional **recipe overrides** after oil
 * (product itemId → alternate recipe ClassName; only non-default picks).
 *
 * **Products:** ClassNames are stored inline (no product allowlist). If the Products
 * dropdown can select it, the hash can encode it. Raw resources still use the fixed
 * raw-picker table (`RAW_RESOURCE_OPTIONS`) — same set as the Raw mode dropdown.
 *
 * Does **not** encode: heat opacity, paint knobs (incl. elev dash threshold), show-nodes,
 * peak emphasis, mode/purity (product policy fixes strict + no_change for any
 * numeric seed).
 */
export const PLAN_HASH_VERSION = 1 as const;

/** flags bit 2: haul is plan-view only (includeElevation = false) */
const FLAG_FLAT_HAUL = 1 << 2;
/** flags bit 5: world seed present after demand payload */
const FLAG_HAS_SEED = 1 << 5;
/** flags bit 6: external item list after optional seed */
const FLAG_HAS_EXTERNAL = 1 << 6;
/**
 * flags bit 7: trailing extractor extension present
 * Layout: waterClock u8, wellClock u8, wellFlags u8 (bit0 = resourceWellsEnabled),
 * optional oilClock u8 (appended when present).
 */
const FLAG_HAS_EXTRACTOR_EXT = 1 << 7;

const RAW_IDS: readonly string[] = RAW_RESOURCE_OPTIONS;
const MAX_LINES = 15;
const MAX_RATE = 65_535;
/** Max external intermediate ids encoded in the share hash. */
const MAX_EXTERNAL = 15;
/** Max Mode B recipe overrides (product → alternate recipe) in the share hash. */
const MAX_RECIPE_OVERRIDES = 20;
/** Max UTF-8 bytes for a compact product token (ClassName without Desc_/_C). */
const MAX_PRODUCT_TOKEN_BYTES = 120;
/** Max UTF-8 bytes for a compact recipe token (ClassName without Recipe_/_C). */
const MAX_RECIPE_TOKEN_BYTES = 120;

/** Fields applied from a shared link (scoring display knobs stay local). */
export type PlanSnapshot = {
  mode: InputMode;
  rawDemand: Array<{ resource: string; itemsPerMinute: number }>;
  productTargets: Array<{ productId: string; itemsPerMinute: number }>;
  miner: MinerSettings;
  scoringMode: ScoringMode;
  /** Computation knobs from the hash (display knobs stay local). */
  scoringOptions: Pick<
    ScoringOptions,
    "centerPower" | "topN" | "siteSepFraction" | "includeElevation"
  >;
  /** null = Default / vanilla layout; number (incl. 0) = randomized map seed. */
  seed: MapSeed;
  /**
   * Mode B: crafted item ids treated as off-site (not expanded into map raws).
   * Empty when absent from older hashes.
   */
  externalItems: string[];
  /**
   * Mode B: product itemId → recipe ClassName (non-default picks only).
   * Empty when absent from older hashes.
   */
  recipeOverrides: Record<string, string>;
};

export type PlanHashSource = {
  mode: InputMode;
  rawDemand: RawDemandLine[];
  productTargets: ProductTargetLine[];
  miner: MinerSettings;
  scoringMode: ScoringMode;
  scoringOptions: ScoringOptions;
  seed: MapSeed;
  /** Mode B off-site intermediates (optional; omitted from hash when empty). */
  externalItems?: string[];
  /** Mode B alternate recipe picks (optional; omitted when empty). */
  recipeOverrides?: Record<string, string>;
};

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Normalize miner/extractor settings with defaults for older snapshots. */
export function normalizeMinerSettings(partial: Partial<MinerSettings> | undefined): MinerSettings {
  const m = partial ?? {};
  const minerMk = (
    [1, 2, 3].includes(m.minerMk as number) ? m.minerMk : DEFAULT_MINER_SETTINGS.minerMk
  ) as MinerMk;
  return {
    minerMk,
    clockPercent: clampClockPercent(m.clockPercent as number, DEFAULT_MINER_SETTINGS.clockPercent),
    oilClockPercent: clampClockPercent(
      m.oilClockPercent as number,
      DEFAULT_MINER_SETTINGS.oilClockPercent,
    ),
    waterClockPercent: clampClockPercent(
      m.waterClockPercent as number,
      DEFAULT_MINER_SETTINGS.waterClockPercent,
    ),
    resourceWellsEnabled:
      typeof m.resourceWellsEnabled === "boolean"
        ? m.resourceWellsEnabled
        : DEFAULT_MINER_SETTINGS.resourceWellsEnabled,
    wellClockPercent: clampClockPercent(
      m.wellClockPercent as number,
      DEFAULT_MINER_SETTINGS.wellClockPercent,
    ),
  };
}

function quantize(value: number, min: number, step: number, maxSteps: number): number {
  const q = Math.round((value - min) / step);
  return Math.min(maxSteps, Math.max(0, q));
}

function dequantize(q: number, min: number, step: number): number {
  return min + q * step;
}

function normalizeExternalItems(ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (!raw) continue;
    const id = canonicalizeProductId(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_EXTERNAL) break;
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** Compact recipe ClassName: strip Recipe_ … _C when present. */
export function compactRecipeToken(recipeId: string): string {
  const id = recipeId.trim();
  const m = /^Recipe_(.+)_C$/.exec(id);
  return m?.[1] ?? id;
}

export function expandRecipeToken(token: string): string {
  if (token.startsWith("Recipe_")) return token;
  return `Recipe_${token}_C`;
}

/**
 * Normalize recipe overrides: product itemId → recipe ClassName.
 * Sorted by product id for stable hashes; capped at {@link MAX_RECIPE_OVERRIDES}.
 */
export function normalizeRecipeOverrides(
  overrides: Record<string, string> | undefined | null,
): Record<string, string> {
  if (!overrides) return {};
  const entries: Array<[string, string]> = [];
  for (const [rawProduct, rawRecipe] of Object.entries(overrides)) {
    if (!rawProduct || !rawRecipe) continue;
    const productId = canonicalizeProductId(rawProduct);
    const recipeId = rawRecipe.trim();
    if (!productId || !recipeId) continue;
    entries.push([productId, recipeId]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const out: Record<string, string> = {};
  for (const [p, r] of entries.slice(0, MAX_RECIPE_OVERRIDES)) {
    out[p] = r;
  }
  return out;
}

export function toSnapshot(source: PlanHashSource): PlanSnapshot {
  const seed: MapSeed =
    source.seed === null || source.seed === undefined ? null : Number(source.seed) | 0;
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
    miner: normalizeMinerSettings(source.miner),
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
      includeElevation: source.scoringOptions.includeElevation !== false,
    },
    seed,
    externalItems: normalizeExternalItems(source.externalItems),
    recipeOverrides: normalizeRecipeOverrides(source.recipeOverrides),
  };
}

function indexOfRaw(id: string): number {
  return RAW_IDS.indexOf(id);
}

/** Compact token for hash: strip Desc_ … _C when present (round-trips for Docs ClassNames). */
export function compactProductToken(productId: string): string {
  const id = canonicalizeProductId(productId);
  const m = /^Desc_(.+)_C$/.exec(id);
  return m?.[1] ?? id;
}

export function expandProductToken(token: string): string {
  if (token.startsWith("Desc_")) return canonicalizeProductId(token);
  return canonicalizeProductId(`Desc_${token}_C`);
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

type EncodedProduct = {
  tokBytes: Uint8Array;
  rate: number;
};

/** Encodeable products only — count byte must match payloads actually written. */
function productsToEncode(products: PlanSnapshot["productTargets"]): EncodedProduct[] {
  const out: EncodedProduct[] = [];
  for (const d of products) {
    if (!d.productId) continue;
    const token = compactProductToken(d.productId);
    const tokBytes = utf8Encode(token);
    if (tokBytes.length === 0 || tokBytes.length > MAX_PRODUCT_TOKEN_BYTES) continue;
    out.push({
      tokBytes,
      rate: Math.min(MAX_RATE, Math.max(0, Math.round(d.itemsPerMinute))),
    });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

/** External item tokens only — ids with encodeable ClassName tokens. */
function externalToEncode(ids: string[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const id of normalizeExternalItems(ids)) {
    const token = compactProductToken(id);
    const tokBytes = utf8Encode(token);
    if (tokBytes.length === 0 || tokBytes.length > MAX_PRODUCT_TOKEN_BYTES) continue;
    out.push(tokBytes);
    if (out.length >= MAX_EXTERNAL) break;
  }
  return out;
}

type EncodedOverride = {
  productTok: Uint8Array;
  recipeTok: Uint8Array;
};

function recipeOverridesToEncode(overrides: Record<string, string> | undefined): EncodedOverride[] {
  const norm = normalizeRecipeOverrides(overrides);
  const out: EncodedOverride[] = [];
  for (const [productId, recipeId] of Object.entries(norm)) {
    const productTok = utf8Encode(compactProductToken(productId));
    const recipeTok = utf8Encode(compactRecipeToken(recipeId));
    if (
      productTok.length === 0 ||
      productTok.length > MAX_PRODUCT_TOKEN_BYTES ||
      recipeTok.length === 0 ||
      recipeTok.length > MAX_RECIPE_TOKEN_BYTES
    ) {
      continue;
    }
    out.push({ productTok, recipeTok });
    if (out.length >= MAX_RECIPE_OVERRIDES) break;
  }
  return out;
}

export function encodePlanBytes(snap: PlanSnapshot): Uint8Array {
  const raw = snap.rawDemand.filter((d) => indexOfRaw(d.resource) >= 0).slice(0, MAX_LINES);
  // Any product id is allowed — same universe as the Products dropdown (no allowlist).
  // Pre-filter so the count nibble matches only rows we actually write (no encode/decode desync).
  const activeRaw = snap.mode === "raw" ? raw : [];
  const activeProducts = snap.mode === "product" ? productsToEncode(snap.productTargets) : [];
  // Externals only meaningful in product mode (Mode B expand prune)
  const activeExternal = snap.mode === "product" ? externalToEncode(snap.externalItems ?? []) : [];
  // Recipe overrides only in product mode (Mode B alternate picks)
  const activeOverrides =
    snap.mode === "product" ? recipeOverridesToEncode(snap.recipeOverrides) : [];

  const out: number[] = [];

  // flags: mode | scoring | flatHaul(2) | mk(3–4) | hasSeed(5) | hasExternal(6) | extractorExt(7)
  const mkBits = Math.min(2, Math.max(0, snap.miner.minerMk - 1));
  let flags = 0;
  if (snap.mode === "product") flags |= 1;
  if (snap.scoringMode === "weighted") flags |= 2;
  if (snap.scoringOptions.includeElevation === false) flags |= FLAG_FLAT_HAUL;
  flags |= (mkBits & 3) << 3;
  const hasSeed = snap.seed !== null && snap.seed !== undefined;
  if (hasSeed) flags |= FLAG_HAS_SEED;
  const hasExternal = activeExternal.length > 0;
  if (hasExternal) flags |= FLAG_HAS_EXTERNAL;
  // Always write extractor extension so water/well clocks round-trip
  flags |= FLAG_HAS_EXTRACTOR_EXT;
  out.push(flags);

  out.push(clampClockPercent(snap.miner.clockPercent, DEFAULT_MINER_SETTINGS.clockPercent));

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
    out.push(indexOfRaw(d.resource) & 0xff);
    const rate = Math.min(MAX_RATE, Math.max(0, Math.round(d.itemsPerMinute)));
    out.push(rate & 0xff);
    out.push((rate >>> 8) & 0xff);
  }
  for (const d of activeProducts) {
    out.push(d.tokBytes.length & 0xff);
    for (let b = 0; b < d.tokBytes.length; b++) {
      const byte = d.tokBytes[b];
      if (byte !== undefined) out.push(byte);
    }
    out.push(d.rate & 0xff);
    out.push((d.rate >>> 8) & 0xff);
  }

  // Optional seed tail: i32 little-endian (seed 0 is valid when hasSeed is set)
  if (hasSeed && snap.seed !== null) {
    const s = snap.seed | 0;
    out.push(s & 0xff);
    out.push((s >>> 8) & 0xff);
    out.push((s >>> 16) & 0xff);
    out.push((s >>> 24) & 0xff);
  }

  // Optional external intermediates: count + length-prefixed ClassName tokens
  if (hasExternal) {
    out.push(activeExternal.length & 0xff);
    for (const tokBytes of activeExternal) {
      out.push(tokBytes.length & 0xff);
      for (let b = 0; b < tokBytes.length; b++) {
        const byte = tokBytes[b];
        if (byte !== undefined) out.push(byte);
      }
    }
  }

  // Extractor extension: water, well pressurizer, wells-enabled, then optional oil (v2 tail)
  out.push(
    clampClockPercent(snap.miner.waterClockPercent, DEFAULT_MINER_SETTINGS.waterClockPercent),
  );
  out.push(clampClockPercent(snap.miner.wellClockPercent, DEFAULT_MINER_SETTINGS.wellClockPercent));
  out.push(snap.miner.resourceWellsEnabled ? 1 : 0);
  out.push(clampClockPercent(snap.miner.oilClockPercent, DEFAULT_MINER_SETTINGS.oilClockPercent));

  // Optional recipe overrides (after oil): count + (productTok, recipeTok) pairs
  if (activeOverrides.length > 0) {
    out.push(activeOverrides.length & 0xff);
    for (const o of activeOverrides) {
      out.push(o.productTok.length & 0xff);
      for (let b = 0; b < o.productTok.length; b++) {
        const byte = o.productTok[b];
        if (byte !== undefined) out.push(byte);
      }
      out.push(o.recipeTok.length & 0xff);
      for (let b = 0; b < o.recipeTok.length; b++) {
        const byte = o.recipeTok[b];
        if (byte !== undefined) out.push(byte);
      }
    }
  }

  return new Uint8Array(out);
}

export function decodePlanBytes(bytes: Uint8Array): PlanSnapshot | null {
  if (bytes.length < 4) return null;
  let i = 0;
  const flags = bytes[i++] ?? 0;
  const mode: InputMode = flags & 1 ? "product" : "raw";
  const scoringMode: ScoringMode = flags & 2 ? "weighted" : "centered";
  const includeElevation = (flags & FLAG_FLAT_HAUL) === 0;
  const minerMk = (Math.min(2, (flags >>> 3) & 3) + 1) as MinerMk;
  const hasSeed = (flags & FLAG_HAS_SEED) !== 0;
  const clockPercent = clampClockPercent(bytes[i++] ?? 100, DEFAULT_MINER_SETTINGS.clockPercent);

  const b0 = bytes[i++] ?? 0;
  const b1 = bytes[i++] ?? 0;
  const packed = b0 | (b1 << 8);
  const centerPower = dequantize(packed & 31, 1, 0.05);
  const topN = 3 + ((packed >>> 5) & 7);
  const siteSepFraction = dequantize((packed >>> 8) & 31, 0.04, 0.02);

  const counts = bytes[i++] ?? 0;
  const nRaw = counts & 15;
  const nProd = (counts >>> 4) & 15;

  // Raw lines are fixed 3 bytes each; products are variable — parse carefully.
  if (i + nRaw * 3 > bytes.length) return null;

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
    if (i >= bytes.length) return null;
    const tokLen = bytes[i++] ?? 0;
    if (tokLen === 0 || tokLen > MAX_PRODUCT_TOKEN_BYTES) return null;
    if (i + tokLen + 2 > bytes.length) return null;
    const tokBytes = bytes.subarray(i, i + tokLen);
    i += tokLen;
    const lo = bytes[i++] ?? 0;
    const hi = bytes[i++] ?? 0;
    const token = utf8Decode(tokBytes);
    if (!token) continue;
    productTargets.push({
      productId: expandProductToken(token),
      itemsPerMinute: lo | (hi << 8),
    });
  }

  let seed: MapSeed = null;
  if (hasSeed) {
    if (i + 4 > bytes.length) return null;
    const b0s = bytes[i++] ?? 0;
    const b1s = bytes[i++] ?? 0;
    const b2s = bytes[i++] ?? 0;
    const b3s = bytes[i++] ?? 0;
    // i32 LE
    seed = b0s | (b1s << 8) | (b2s << 16) | (b3s << 24) | 0;
  }

  const hasExternal = (flags & FLAG_HAS_EXTERNAL) !== 0;
  const externalItems: string[] = [];
  if (hasExternal) {
    if (i >= bytes.length) return null;
    const nExt = bytes[i++] ?? 0;
    if (nExt > MAX_EXTERNAL) return null;
    for (let k = 0; k < nExt; k++) {
      if (i >= bytes.length) return null;
      const tokLen = bytes[i++] ?? 0;
      if (tokLen === 0 || tokLen > MAX_PRODUCT_TOKEN_BYTES) return null;
      if (i + tokLen > bytes.length) return null;
      const tokBytes = bytes.subarray(i, i + tokLen);
      i += tokLen;
      const token = utf8Decode(tokBytes);
      if (!token) continue;
      externalItems.push(expandProductToken(token));
    }
  }

  const hasExtractorExt = (flags & FLAG_HAS_EXTRACTOR_EXT) !== 0;
  let waterClockPercent = DEFAULT_MINER_SETTINGS.waterClockPercent;
  let wellClockPercent = DEFAULT_MINER_SETTINGS.wellClockPercent;
  let oilClockPercent = DEFAULT_MINER_SETTINGS.oilClockPercent;
  let resourceWellsEnabled = DEFAULT_MINER_SETTINGS.resourceWellsEnabled;
  if (hasExtractorExt) {
    if (i + 3 > bytes.length) return null;
    waterClockPercent = clampClockPercent(
      bytes[i++] ?? 250,
      DEFAULT_MINER_SETTINGS.waterClockPercent,
    );
    wellClockPercent = clampClockPercent(
      bytes[i++] ?? 250,
      DEFAULT_MINER_SETTINGS.wellClockPercent,
    );
    resourceWellsEnabled = ((bytes[i++] ?? 0) & 1) !== 0;
    // Optional oil clock (appended after the original 3-byte extension)
    if (i < bytes.length) {
      oilClockPercent = clampClockPercent(
        bytes[i++] ?? 250,
        DEFAULT_MINER_SETTINGS.oilClockPercent,
      );
    }
  }

  // Optional recipe overrides after oil
  const recipeOverrides: Record<string, string> = {};
  if (i < bytes.length) {
    const nOv = bytes[i++] ?? 0;
    if (nOv > MAX_RECIPE_OVERRIDES) return null;
    for (let k = 0; k < nOv; k++) {
      if (i >= bytes.length) return null;
      const pLen = bytes[i++] ?? 0;
      if (pLen === 0 || pLen > MAX_PRODUCT_TOKEN_BYTES) return null;
      if (i + pLen > bytes.length) return null;
      const pTok = utf8Decode(bytes.subarray(i, i + pLen));
      i += pLen;
      if (i >= bytes.length) return null;
      const rLen = bytes[i++] ?? 0;
      if (rLen === 0 || rLen > MAX_RECIPE_TOKEN_BYTES) return null;
      if (i + rLen > bytes.length) return null;
      const rTok = utf8Decode(bytes.subarray(i, i + rLen));
      i += rLen;
      if (!pTok || !rTok) continue;
      recipeOverrides[expandProductToken(pTok)] = expandRecipeToken(rTok);
    }
  }

  return toSnapshot({
    mode,
    rawDemand: rawDemand.map((d, j) => ({ id: `h${j}`, ...d })),
    productTargets: productTargets.map((d, j) => ({ id: `h${j}`, ...d })),
    miner: {
      minerMk,
      clockPercent,
      oilClockPercent,
      waterClockPercent,
      wellClockPercent,
      resourceWellsEnabled,
    },
    scoringMode,
    scoringOptions: {
      ...DEFAULT_SCORING_OPTIONS,
      centerPower,
      topN,
      siteSepFraction,
      includeElevation,
    },
    seed,
    externalItems,
    recipeOverrides,
  });
}

/** True when two map seeds refer to the same world (both Default or same number). */
export function mapSeedsEqual(a: MapSeed, b: MapSeed): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (a | 0) === (b | 0);
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
