import { afterEach, describe, expect, it } from "vitest";
import { buildSavedPlan, type SavedPlan } from "@/lib/savedPlans";
import {
  copyPlanToSavedSeed,
  createSavedSeed,
  emptySeedLibrary,
  ensureDefaultSavedSeed,
  findSavedSeedByMapSeed,
  findSavedSeedByWorld,
  isMapSeedSaved,
  isWorldSaved,
  persistSeedLibrary,
  seedHasPlanHash,
  subscribeSeedLibrary,
} from "@/lib/savedSeeds";
import { VANILLA_WORLD } from "@/lib/seed/types";
import { DEFAULT_MINER_SETTINGS, DEFAULT_SCORING_OPTIONS } from "@/types";

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
      seedMode: "strict" as const,
      seedPurity: "no_change" as const,
      plans: [],
      activePlanId: null,
      autoNamed: true,
      updatedAt: 1,
    };
    lib = { seeds: [...lib.seeds, numeric], activeId: numeric.id };
    expect(findSavedSeedByMapSeed(lib, 42)?.id).toBe("seed-x");
    expect(isMapSeedSaved(lib, 42)).toBe(true);
  });

  it("does not treat Default + All Pure as the vanilla Default shelf", () => {
    const lib = ensureDefaultSavedSeed(emptySeedLibrary());
    expect(isWorldSaved(lib, VANILLA_WORLD)).toBe(true);
    expect(findSavedSeedByWorld(lib, { seed: null, mode: "none", purity: "all_pure" })).toBeNull();
  });
});

describe("copyPlanToSavedSeed", () => {
  it("copies a plan onto dest, activates dest, and keeps dest's existing chips", () => {
    const source = createSavedSeed({
      name: "Default",
      world: VANILLA_WORLD,
    });
    const dest = createSavedSeed({
      name: "Seed 42",
      world: { seed: 42, mode: "strict", purity: "no_change" },
    });
    const existing = buildSavedPlan(
      null,
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_IronPlate_C", itemsPerMinute: 60 }],
        miner: { ...DEFAULT_MINER_SETTINGS },
        scoringMode: "centered",
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
        seed: 42,
        seedMode: "strict",
        seedPurity: "no_change",
      },
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_IronPlate_C", itemsPerMinute: 60 }],
        items: { Desc_IronPlate_C: { id: "Desc_IronPlate_C", name: "Iron Plate", raw: false } },
        recipes: [],
      },
    );
    dest.plans = [existing];
    dest.activePlanId = existing.id;

    const sent = buildSavedPlan(
      null,
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        miner: { ...DEFAULT_MINER_SETTINGS },
        scoringMode: "centered",
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
        seed: 42,
        seedMode: "strict",
        seedPurity: "no_change",
      },
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        items: { Desc_Motor_C: { id: "Desc_Motor_C", name: "Motor", raw: false } },
        recipes: [],
      },
    );

    const result = copyPlanToSavedSeed(
      { seeds: [source, dest], activeId: source.id },
      dest.id,
      sent,
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.library.activeId).toBe(dest.id);
    expect(result.plan.id).toBe(sent.id);
    const destNow = result.library.seeds.find((s) => s.id === dest.id);
    expect(destNow?.plans).toHaveLength(2);
    expect(destNow?.plans.map((p) => p.id)).toContain(existing.id);
    expect(destNow?.plans.map((p) => p.id)).toContain(sent.id);
    expect(destNow?.activePlanId).toBe(sent.id);
    expect(result.library.seeds.find((s) => s.id === source.id)?.plans).toHaveLength(0);
  });

  it("selects the copy on dest when dest has no chips yet", () => {
    const source = createSavedSeed({ name: "Default", world: VANILLA_WORLD });
    const dest = createSavedSeed({
      name: "Seed 42",
      world: { seed: 42, mode: "strict", purity: "no_change" },
    });
    const copied = buildSavedPlan(
      null,
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        miner: { ...DEFAULT_MINER_SETTINGS },
        scoringMode: "centered",
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
        seed: 42,
        seedMode: "strict",
        seedPurity: "no_change",
      },
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        items: { Desc_Motor_C: { id: "Desc_Motor_C", name: "Motor", raw: false } },
        recipes: [],
      },
    );
    const result = copyPlanToSavedSeed(
      { seeds: [source, dest], activeId: source.id },
      dest.id,
      copied,
    );
    expect(result?.library.activeId).toBe(dest.id);
    expect(result?.plan.id).toBe(copied.id);
    expect(result?.library.seeds.find((s) => s.id === dest.id)?.activePlanId).toBe(copied.id);
  });

  it("reuses dest's existing chip when the hash already matches", () => {
    const source = createSavedSeed({ name: "Default", world: VANILLA_WORLD });
    const dest = createSavedSeed({
      name: "Seed 42",
      world: { seed: 42, mode: "strict", purity: "no_change" },
    });
    const first = buildSavedPlan(
      null,
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        miner: { ...DEFAULT_MINER_SETTINGS },
        scoringMode: "centered",
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
        seed: 42,
        seedMode: "strict",
        seedPurity: "no_change",
      },
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        items: { Desc_Motor_C: { id: "Desc_Motor_C", name: "Motor", raw: false } },
        recipes: [],
      },
    );
    dest.plans = [first];
    dest.activePlanId = first.id;

    const again = buildSavedPlan(
      null,
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        miner: { ...DEFAULT_MINER_SETTINGS },
        scoringMode: "centered",
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
        seed: 42,
        seedMode: "strict",
        seedPurity: "no_change",
      },
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        items: { Desc_Motor_C: { id: "Desc_Motor_C", name: "Motor", raw: false } },
        recipes: [],
      },
    );
    expect(again.hash).toBe(first.hash);
    expect(again.id).not.toBe(first.id);

    const result = copyPlanToSavedSeed(
      { seeds: [source, dest], activeId: source.id },
      dest.id,
      again,
    );
    expect(result?.library.activeId).toBe(dest.id);
    expect(result?.plan.id).toBe(first.id);
    expect(result?.library.seeds.find((s) => s.id === dest.id)?.plans).toHaveLength(1);
  });

  it("returns null when dest is missing", () => {
    expect(copyPlanToSavedSeed(emptySeedLibrary(), "missing", { id: "x" } as SavedPlan)).toBeNull();
  });
});

describe("seedHasPlanHash", () => {
  it("is true only when dest already has that plan hash", () => {
    const dest = createSavedSeed({
      name: "Seed 42",
      world: { seed: 42, mode: "strict", purity: "no_change" },
    });
    const plan = buildSavedPlan(
      null,
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        miner: { ...DEFAULT_MINER_SETTINGS },
        scoringMode: "centered",
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
        seed: 42,
        seedMode: "strict",
        seedPurity: "no_change",
      },
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_Motor_C", itemsPerMinute: 10 }],
        items: { Desc_Motor_C: { id: "Desc_Motor_C", name: "Motor", raw: false } },
        recipes: [],
      },
    );
    expect(seedHasPlanHash(dest, plan.hash)).toBe(false);
    dest.plans = [plan];
    expect(seedHasPlanHash(dest, plan.hash)).toBe(true);
    expect(seedHasPlanHash(dest, "v1.nope")).toBe(false);
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
