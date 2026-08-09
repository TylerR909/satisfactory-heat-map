/**
 * Named saved-seed library — each shelf has its own map seed + heatmap chips.
 * Primary key for the user is `name` (unique); the numeric map seed may repeat.
 */

import type { SavedPlan } from "@/lib/savedPlans";
import type { MapSeed } from "@/lib/seed";

const STORAGE_KEY = "sf-heatmap-saved-seeds-v1";
const LEGACY_PLAYTHROUGHS_KEY = "sf-heatmap-playthroughs-v1";
const LEGACY_PLANS_KEY = "sf-heatmap-saved-plans-v1";

/** A named library entry: one map seed + its heatmap plan shelf. */
export type SavedSeed = {
  id: string;
  name: string;
  /** null = Default / vanilla layout; number (incl. 0) = randomized world seed. */
  seed: MapSeed;
  plans: SavedPlan[];
  activePlanId: string | null;
  /** True when auto-created from paste (eligible for GC when empty). */
  autoNamed: boolean;
  updatedAt: number;
};

export type SeedLibrary = {
  seeds: SavedSeed[];
  /**
   * Active named shelf. `null` = detached from the library (shared-link plan
   * for a seed you don't have saved, or a temporary Random world before Save).
   * Normal Default usage should always have an active shelf — see
   * {@link ensureDefaultSavedSeed}.
   */
  activeId: string | null;
};

/** Listeners notified after {@link persistSeedLibrary} (same-tab sync). */
const libraryListeners = new Set<() => void>();

/** Subscribe to local seed-library writes (e.g. from hash sync). */
export function subscribeSeedLibrary(listener: () => void): () => void {
  libraryListeners.add(listener);
  return () => {
    libraryListeners.delete(listener);
  };
}

function newId(): string {
  return `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptySeedLibrary(): SeedLibrary {
  return { seeds: [], activeId: null };
}

export function loadSeedLibrary(): SeedLibrary {
  try {
    try {
      localStorage.removeItem(LEGACY_PLANS_KEY);
      localStorage.removeItem(LEGACY_PLAYTHROUGHS_KEY);
    } catch {
      /* ignore */
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySeedLibrary();
    const parsed = JSON.parse(raw) as SeedLibrary & { playthroughs?: SavedSeed[] };
    // Accept either `seeds` or legacy `playthroughs` key if present in memory
    const list = Array.isArray(parsed.seeds)
      ? parsed.seeds
      : Array.isArray(parsed.playthroughs)
        ? parsed.playthroughs
        : null;
    if (!list) return emptySeedLibrary();
    return {
      seeds: list.map(normalizeSavedSeed).filter(Boolean) as SavedSeed[],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return emptySeedLibrary();
  }
}

function normalizeSavedSeed(p: Partial<SavedSeed>): SavedSeed | null {
  if (!p || typeof p.id !== "string" || typeof p.name !== "string") return null;
  const seed: MapSeed =
    p.seed === null || p.seed === undefined
      ? null
      : typeof p.seed === "number" && Number.isFinite(p.seed)
        ? p.seed | 0
        : null;
  return {
    id: p.id,
    name: p.name,
    seed,
    plans: Array.isArray(p.plans) ? p.plans : [],
    activePlanId: typeof p.activePlanId === "string" ? p.activePlanId : null,
    autoNamed: Boolean(p.autoNamed),
    updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
  };
}

export function persistSeedLibrary(lib: SeedLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    // Private mode / quota — best-effort
  }
  for (const listener of libraryListeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/**
 * Find or create the vanilla Default shelf (`seed: null`) and make it active.
 * Used so everyday Default-map work is never "ephemeral".
 */
export function ensureDefaultSavedSeed(lib: SeedLibrary): SeedLibrary {
  const existing = lib.seeds.find((p) => p.seed === null);
  if (existing) {
    return { ...lib, activeId: existing.id };
  }
  const pt = createSavedSeed({
    name: uniqueSeedName(lib, "Default"),
    seed: null,
    autoNamed: false,
  });
  return upsertSavedSeed(lib, pt);
}

/** First library entry whose map seed matches (null = Default). */
export function findSavedSeedByMapSeed(lib: SeedLibrary, seed: MapSeed): SavedSeed | null {
  return lib.seeds.find((p) => p.seed === seed) ?? null;
}

/** True when some named shelf already owns this map seed (incl. Default / null). */
export function isMapSeedSaved(lib: SeedLibrary, seed: MapSeed): boolean {
  return findSavedSeedByMapSeed(lib, seed) !== null;
}

export function defaultNameForSeed(seed: MapSeed): string {
  if (seed === null) return "Default";
  return `Seed ${seed}`;
}

export function isAutoSeedName(name: string): boolean {
  return /^Seed -?\d+$/.test(name) || name === "Default";
}

/** Ensure unique name; append " (2)", " (3)", … if needed. */
export function uniqueSeedName(lib: SeedLibrary, desired: string, exceptId?: string): string {
  const base = desired.trim() || "Seed";
  const taken = new Set(
    lib.seeds.filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export function getActiveSavedSeed(lib: SeedLibrary): SavedSeed | null {
  if (!lib.activeId) return null;
  return lib.seeds.find((p) => p.id === lib.activeId) ?? null;
}

export function upsertSavedSeed(lib: SeedLibrary, entry: SavedSeed): SeedLibrary {
  const idx = lib.seeds.findIndex((p) => p.id === entry.id);
  const seeds = idx >= 0 ? lib.seeds.map((p, i) => (i === idx ? entry : p)) : [...lib.seeds, entry];
  return { seeds, activeId: entry.id };
}

/**
 * Remove a saved seed; activate next remaining (or null).
 * Returns { library, next } where next is the entry to load after delete.
 */
export function removeSavedSeed(
  lib: SeedLibrary,
  id: string,
): { library: SeedLibrary; next: SavedSeed | null } {
  const seeds = lib.seeds.filter((p) => p.id !== id);
  let activeId = lib.activeId;
  let next: SavedSeed | null = null;
  if (activeId === id) {
    next = seeds[0] ?? null;
    activeId = next?.id ?? null;
  } else {
    next = seeds.find((p) => p.id === activeId) ?? null;
  }
  return { library: { seeds, activeId }, next };
}

/** GC auto-named empty seeds except keepId. */
export function gcEmptyAutoNamed(lib: SeedLibrary, keepId?: string | null): SeedLibrary {
  const seeds = lib.seeds.filter((p) => {
    if (p.id === keepId) return true;
    if (!p.autoNamed) return true;
    if (p.plans.length > 0) return true;
    return false;
  });
  let activeId = lib.activeId;
  if (activeId && !seeds.some((p) => p.id === activeId)) {
    activeId = null;
  }
  return { seeds, activeId };
}

export function createSavedSeed(opts: {
  name: string;
  seed: MapSeed;
  autoNamed?: boolean;
  plans?: SavedPlan[];
  activePlanId?: string | null;
}): SavedSeed {
  return {
    id: newId(),
    name: opts.name,
    seed: opts.seed,
    plans: opts.plans ?? [],
    activePlanId: opts.activePlanId ?? null,
    autoNamed: opts.autoNamed ?? false,
    updatedAt: Date.now(),
  };
}

export function formatSeedLabel(seed: MapSeed): string {
  if (seed === null) return "Default";
  return String(seed);
}
