/**
 * Seed / randomization types.
 *
 * Mode and purity enums mirror Konsl (MIT) for algorithm fidelity.
 * Copyright (c) 2026 Konsl for algorithm enums — see third_party/konsl-satisfactory-world-generator.md
 *
 * In-game 1.2 world gen is the triple (randomization mode, purity mode, seed).
 * The seed is only the PRNG key for the randomizable parts.
 */

/** null = no seed entered. number (incl. 0) = signed i32 world seed. */
export type MapSeed = number | null;

/** Names match Konsl serde snake_case. */
export type NodeRandomizationMode =
  | "none"
  | "strict"
  | "basic_rich"
  | "advanced_rich"
  | "fossil_fuel_rich";

export type NodePuritySettings =
  | "no_change"
  | "all_impure"
  | "decrease"
  | "all_normal"
  | "increase"
  | "all_pure"
  | "all_random";

/** Wire order (u8 indices in the share hash). */
export const NODE_RANDOMIZATION_MODES = [
  "none",
  "strict",
  "basic_rich",
  "advanced_rich",
  "fossil_fuel_rich",
] as const satisfies readonly NodeRandomizationMode[];

export const NODE_PURITY_SETTINGS = [
  "no_change",
  "all_impure",
  "decrease",
  "all_normal",
  "increase",
  "all_pure",
  "all_random",
] as const satisfies readonly NodePuritySettings[];

/** In-game Resource Node Purity menu order (not the share-hash u8 table). */
export const NODE_PURITY_SETTINGS_UI = [
  "no_change",
  "all_pure",
  "increase",
  "all_normal",
  "decrease",
  "all_impure",
  "all_random",
] as const satisfies readonly NodePuritySettings[];

/** In-game Resource Node Randomization labels. */
export const RANDOMIZATION_MODE_LABELS: Record<NodeRandomizationMode, string> = {
  none: "Default",
  strict: "Random",
  basic_rich: "Basic Resource Rich",
  advanced_rich: "Advanced Resource Rich",
  fossil_fuel_rich: "Fossil Fuel Rich",
};

/** In-game Resource Node Purity labels. */
export const PURITY_SETTING_LABELS: Record<NodePuritySettings, string> = {
  no_change: "Default",
  all_pure: "All Pure",
  increase: "Mostly Pure",
  all_normal: "Average",
  decrease: "Mostly Impure",
  all_impure: "All Impure",
  all_random: "Random",
};

/** Algorithm input: seed is always an i32 (null world seed → 0). */
export type WorldSeedConfig = {
  seed: number;
  mode: NodeRandomizationMode;
  purity: NodePuritySettings;
};

/** Full 1.2 world-gen triple as the app stores / shares it. */
export type WorldGenSettings = {
  seed: MapSeed;
  mode: NodeRandomizationMode;
  purity: NodePuritySettings;
};

export const VANILLA_WORLD: WorldGenSettings = {
  seed: null,
  mode: "none",
  purity: "no_change",
};

export function isDefaultSeed(seed: MapSeed): boolean {
  return seed === null;
}

/** Vanilla Default triple (no seed, Default randomization, Default purity). */
export function isDefaultWorld(world: WorldGenSettings): boolean {
  return world.seed === null && world.mode === "none" && world.purity === "no_change";
}

/**
 * Wiki: World Seed does NOT affect Resource Node Randomization Default, or any
 * purity option other than Random. Seed still drives type shuffle on Random / Rich.
 */
export function seedAffectsGeneration(world: Pick<WorldGenSettings, "mode" | "purity">): boolean {
  return world.mode !== "none" || world.purity === "all_random";
}

export function mapSeedsEqual(a: MapSeed, b: MapSeed): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (a | 0) === (b | 0);
}

export function worldGensEqual(a: WorldGenSettings, b: WorldGenSettings): boolean {
  return mapSeedsEqual(a.seed, b.seed) && a.mode === b.mode && a.purity === b.purity;
}

export function parseRandomizationMode(raw: unknown): NodeRandomizationMode | null {
  if (typeof raw !== "string") return null;
  return (NODE_RANDOMIZATION_MODES as readonly string[]).includes(raw)
    ? (raw as NodeRandomizationMode)
    : null;
}

export function parsePuritySetting(raw: unknown): NodePuritySettings | null {
  if (typeof raw !== "string") return null;
  return (NODE_PURITY_SETTINGS as readonly string[]).includes(raw)
    ? (raw as NodePuritySettings)
    : null;
}

/**
 * Legacy product policy (pre-mode UI): Default → identity; any numeric seed →
 * in-game Random + unchanged purity.
 */
export function impliedWorldFromSeed(seed: MapSeed): WorldGenSettings {
  if (seed === null) return { ...VANILLA_WORLD };
  return { seed: seed | 0, mode: "strict", purity: "no_change" };
}

/**
 * Resolve a stored/shared triple. Missing mode+purity fall back to the legacy
 * seed-only policy so old localStorage / v1 hashes keep their maps.
 */
export function normalizeWorldGen(partial: {
  seed?: MapSeed;
  mode?: unknown;
  purity?: unknown;
  seedMode?: unknown;
  seedPurity?: unknown;
}): WorldGenSettings {
  const seed: MapSeed =
    partial.seed === null || partial.seed === undefined
      ? null
      : typeof partial.seed === "number" && Number.isFinite(partial.seed)
        ? partial.seed | 0
        : null;
  const mode = parseRandomizationMode(partial.mode ?? partial.seedMode);
  const purity = parsePuritySetting(partial.purity ?? partial.seedPurity);
  if (mode && purity) return { seed, mode, purity };
  return impliedWorldFromSeed(seed);
}

/** Product policy used when only a seed is known. */
export function configForSeed(seed: MapSeed): WorldSeedConfig {
  return configForWorld(impliedWorldFromSeed(seed));
}

export function configForWorld(world: WorldGenSettings): WorldSeedConfig {
  return {
    seed: world.seed === null ? 0 : world.seed | 0,
    mode: world.mode,
    purity: world.purity,
  };
}

/** True when mode+purity match what a v1 seed-only hash would imply. */
export function worldIsLegacyImplied(world: WorldGenSettings): boolean {
  const implied = impliedWorldFromSeed(world.seed);
  return implied.mode === world.mode && implied.purity === world.purity;
}

/** Parse user paste into i32 seed, or null if empty/invalid for “clear to default”. */
export function parseSeedInput(
  raw: string,
): { ok: true; seed: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === "") return { ok: false, error: "Enter a seed number" };
  // Accept integers only (optional leading + / -)
  if (!/^[+-]?\d+$/.test(t)) return { ok: false, error: "Seed must be an integer" };
  // BigInt then clamp to i32
  let n: number;
  try {
    const bi = BigInt(t);
    const min = -2147483648n;
    const max = 2147483647n;
    if (bi < min || bi > max) return { ok: false, error: "Seed out of 32-bit range" };
    n = Number(bi);
  } catch {
    return { ok: false, error: "Invalid seed" };
  }
  return { ok: true, seed: n | 0 };
}

/** Random i32 for the Random button (uniform over full i32 range). */
export function randomMapSeed(): number {
  const u = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  // Map to signed i32
  return u | 0;
}

export function formatSeedNumber(seed: MapSeed): string {
  if (seed === null) return "Default";
  return String(seed);
}

/** Compact triple for UI: "Default", "12345", or "12345 · Random · All Pure". */
export function formatWorldLabel(world: WorldGenSettings): string {
  if (isDefaultWorld(world)) return "Default";
  if (worldIsLegacyImplied(world) && world.seed !== null) return String(world.seed);
  const parts = [formatSeedNumber(world.seed)];
  if (world.mode !== "none") parts.push(RANDOMIZATION_MODE_LABELS[world.mode]);
  if (world.purity !== "no_change") parts.push(PURITY_SETTING_LABELS[world.purity]);
  return parts.join(" · ");
}
