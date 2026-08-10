import { afterEach, describe, expect, it } from "vitest";
import {
  emptySeedLibrary,
  ensureDefaultSavedSeed,
  findSavedSeedByMapSeed,
  isMapSeedSaved,
  persistSeedLibrary,
  subscribeSeedLibrary,
} from "@/lib/savedSeeds";

describe("ensureDefaultSavedSeed", () => {
  it("creates a Default shelf when the library is empty", () => {
    const next = ensureDefaultSavedSeed(emptySeedLibrary());
    expect(next.seeds).toHaveLength(1);
    expect(next.seeds[0]?.seed).toBeNull();
    expect(next.seeds[0]?.name).toBe("Default");
    expect(next.activeId).toBe(next.seeds[0]?.id);
  });

  it("reuses an existing seed:null entry without duplicating", () => {
    const first = ensureDefaultSavedSeed(emptySeedLibrary());
    const second = ensureDefaultSavedSeed({ ...first, activeId: null });
    expect(second.seeds).toHaveLength(1);
    expect(second.activeId).toBe(first.seeds[0]?.id);
  });
});

describe("findSavedSeedByMapSeed / isMapSeedSaved", () => {
  it("matches Default (null) and numeric seeds", () => {
    let lib = ensureDefaultSavedSeed(emptySeedLibrary());
    const def = lib.seeds[0];
    expect(def).toBeDefined();
    expect(findSavedSeedByMapSeed(lib, null)?.id).toBe(def?.id);
    expect(isMapSeedSaved(lib, null)).toBe(true);
    expect(findSavedSeedByMapSeed(lib, 42)).toBeNull();
    expect(isMapSeedSaved(lib, 42)).toBe(false);

    const numeric = {
      id: "seed-x",
      name: "Seed 42",
      seed: 42,
      plans: [],
      activePlanId: null,
      autoNamed: true,
      updatedAt: 1,
    };
    lib = { seeds: [...lib.seeds, numeric], activeId: numeric.id };
    expect(findSavedSeedByMapSeed(lib, 42)?.id).toBe("seed-x");
    expect(isMapSeedSaved(lib, 42)).toBe(true);
  });
});

describe("subscribeSeedLibrary", () => {
  afterEach(() => {
    try {
      localStorage.removeItem("sf-heatmap-saved-seeds-v1");
    } catch {
      /* ignore */
    }
  });

  it("notifies listeners on persist", () => {
    let hits = 0;
    const unsub = subscribeSeedLibrary(() => {
      hits += 1;
    });
    persistSeedLibrary(ensureDefaultSavedSeed(emptySeedLibrary()));
    expect(hits).toBe(1);
    unsub();
    persistSeedLibrary(emptySeedLibrary());
    expect(hits).toBe(1);
  });
});
