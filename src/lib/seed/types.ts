/**
 * Seed / randomization types.
 *
 * Mode and purity enums mirror Konsl (MIT) for algorithm fidelity; product UI only exposes MapSeed.
 * Copyright (c) 2026 Konsl for algorithm enums — see third_party/konsl-satisfactory-world-generator.md
 */

/** null = Default / vanilla layout. number (incl. 0) = in-game map seed under fixed policy. */
export type MapSeed = number | null;

/** Internal — not exposed in UI. Names match Konsl serde snake_case. */
export type NodeRandomizationMode =
  | "none"
  | "strict"
  | "basic_rich"
  | "advanced_rich"
  | "fossil_fuel_rich";

/** Internal — not exposed in UI. */
export type NodePuritySettings =
  | "no_change"
  | "all_impure"
  | "decrease"
  | "all_normal"
  | "increase"
  | "all_pure"
  | "all_random";

/** Full algorithm config (internal). */
export type WorldSeedConfig = {
  seed: number;
  mode: NodeRandomizationMode;
  purity: NodePuritySettings;
};

export function isDefaultSeed(seed: MapSeed): boolean {
  return seed === null;
}

/**
 * Product policy: Default → identity; any numeric seed (incl. 0) → strict + no_change.
 */
export function configForSeed(seed: MapSeed): WorldSeedConfig {
  if (seed === null) {
    return { seed: 0, mode: "none", purity: "no_change" };
  }
  // Clamp to i32 range for RNG
  const s = seed | 0;
  return { seed: s, mode: "strict", purity: "no_change" };
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
