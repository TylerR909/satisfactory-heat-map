import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clearNodeSeedCache, getNodesForSeed } from "@/lib/seed/nodeCache";
import { applyWorldSeed, distributeThroughput } from "@/lib/seed/randomization";
import { RandomStream, shuffle } from "@/lib/seed/randomStream";
import { compareCodeUnit, PURITY_ORDINAL } from "@/lib/seed/resources";
import { configForSeed } from "@/lib/seed/types";
import { coreThroughput, nodesToAlgoWorld, sortByName } from "@/lib/seed/worldFromNodes";
import type { ResourceNode } from "@/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadBaseNodes(): ResourceNode[] {
  const raw = readFileSync(join(root, "public/data/nodes/default-nodes.json"), "utf8");
  return JSON.parse(raw) as ResourceNode[];
}

describe("RandomStream (Konsl / UE LCG)", () => {
  it("produces deterministic frand sequence for seed 0", () => {
    const rng = new RandomStream(0);
    const a = [rng.frand(), rng.frand(), rng.frand(), rng.frand(), rng.frand()];
    const rng2 = new RandomStream(0);
    const b = [rng2.frand(), rng2.frand(), rng2.frand(), rng2.frand(), rng2.frand()];
    expect(b).toEqual(a);
    // Values in [0, 1)
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("bit-casts negative i32 seeds", () => {
    const rng = new RandomStream(-1);
    const v = rng.frand();
    expect(Number.isFinite(v)).toBe(true);
    const rng2 = new RandomStream(-1);
    expect(rng2.frand()).toBe(v);
  });

  it("shuffle is deterministic", () => {
    const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const b = [...a];
    shuffle(new RandomStream(42), a);
    shuffle(new RandomStream(42), b);
    expect(a).toEqual(b);
    expect(a).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("code-unit sort", () => {
  it("matches byte-wise order (not localeCompare)", () => {
    const names = ["BP_ResourceNode9", "BP_ResourceNode10", "BP_ResourceNode2"];
    const sorted = [...names].sort(compareCodeUnit);
    // Code-unit: "10" < "2" < "9" because '1' < '2' < '9'
    expect(sorted).toEqual(["BP_ResourceNode10", "BP_ResourceNode2", "BP_ResourceNode9"]);
  });

  it("sortByName uses code-unit order", () => {
    const items = [{ name: "b" }, { name: "a" }, { name: "a0" }];
    sortByName(items);
    expect(items.map((i) => i.name)).toEqual(["a", "a0", "b"]);
  });
});

describe("worldFromNodes / deposit membership", () => {
  it("excludes deposits from resource_nodes pool (Konsl only extracts BP_ResourceNode_C)", () => {
    const base = loadBaseNodes();
    const world = nodesToAlgoWorld(base);
    const deposit = base.find((n) => n.nodeType === "deposit");
    expect(deposit).toBeDefined();
    if (!deposit) return;
    expect(world.resourceNodes.some((n) => n.name === deposit.id)).toBe(false);
    expect(world.passthroughIndices.some((i) => base[i]?.id === deposit.id)).toBe(true);
  });

  it("associates all satellites to cores (17 cores, 118 sats)", () => {
    const base = loadBaseNodes();
    const world = nodesToAlgoWorld(base);
    expect(world.frackingCores).toHaveLength(17);
    const satCount = world.frackingCores.reduce((s, c) => s + c.satellites.length, 0);
    expect(satCount).toBe(118);
    expect(world.resourceNodes.length).toBe(base.filter((n) => n.nodeType === "node").length);
  });

  it("synthesizes fracking throughput from purity ordinals", () => {
    const base = loadBaseNodes();
    const world = nodesToAlgoWorld(base);
    for (const c of world.frackingCores) {
      const expected = c.satellites.reduce((s, sat) => s + PURITY_ORDINAL[sat.purity], 0);
      expect(coreThroughput(c)).toBe(expected);
      expect(expected).toBeGreaterThan(0);
    }
  });
});

describe("distributeThroughput", () => {
  it("preserves approximate total when demoting pures", () => {
    const core = {
      name: "c",
      resource: "Desc_Water_C",
      baseIndex: 0,
      satellites: [
        { name: "s0", purity: "impure" as const, baseIndex: 1 },
        { name: "s1", purity: "impure" as const, baseIndex: 2 },
        { name: "s2", purity: "impure" as const, baseIndex: 3 },
        { name: "s3", purity: "impure" as const, baseIndex: 4 },
      ],
    };
    // target throughput 8 (e.g. 2 pure = 8, or 4 normal = 8)
    distributeThroughput(core, 8);
    const total = core.satellites.reduce((s, sat) => s + PURITY_ORDINAL[sat.purity], 0);
    expect(total).toBe(8);
  });
});

describe("applyWorldSeed", () => {
  it("identity (none + no_change) preserves all resource/purity for any seed field", () => {
    const base = loadBaseNodes();
    const a = applyWorldSeed(base, { seed: 0, mode: "none", purity: "no_change" });
    const b = applyWorldSeed(base, { seed: 12345, mode: "none", purity: "no_change" });
    expect(a).toHaveLength(base.length);
    for (let i = 0; i < base.length; i++) {
      const bi = base[i];
      const ai = a[i];
      const bbi = b[i];
      expect(bi && ai && bbi).toBeTruthy();
      if (!bi || !ai || !bbi) continue;
      expect(ai.resource).toBe(bi.resource);
      expect(ai.purity).toBe(bi.purity);
      expect(ai.x).toBe(bi.x);
      expect(bbi.resource).toBe(bi.resource);
      expect(bbi.purity).toBe(bi.purity);
    }
  });

  it("configForSeed(null) is identity; seed 0 strict is NOT identity", () => {
    const base = loadBaseNodes();
    const def = applyWorldSeed(base, configForSeed(null));
    const seed0 = applyWorldSeed(base, configForSeed(0));
    let same = 0;
    let diff = 0;
    for (let i = 0; i < base.length; i++) {
      const bi = base[i];
      const di = def[i];
      const si = seed0[i];
      if (!bi || !di || !si || bi.nodeType !== "node") continue;
      if (di.resource === bi.resource && di.purity === bi.purity) same++;
      if (si.resource !== bi.resource || si.purity !== bi.purity) diff++;
    }
    expect(same).toBeGreaterThan(400);
    expect(diff).toBeGreaterThan(0);
  });

  it("strict shuffle is deterministic", () => {
    const base = loadBaseNodes();
    const cfg = configForSeed(42);
    const a = applyWorldSeed(base, cfg);
    const b = applyWorldSeed(base, cfg);
    expect(a.map((n) => `${n.id}:${n.resource}:${n.purity}`)).toEqual(
      b.map((n) => `${n.id}:${n.resource}:${n.purity}`),
    );
  });

  it("does not mutate baseSlots", () => {
    const base = loadBaseNodes();
    const snap = base.map((n) => ({ ...n }));
    applyWorldSeed(base, configForSeed(99));
    expect(base).toEqual(snap);
  });

  it("leaves deposit resource/purity unchanged under strict", () => {
    const base = loadBaseNodes();
    const dep = base.find((n) => n.nodeType === "deposit");
    expect(dep).toBeDefined();
    if (!dep) return;
    const out = applyWorldSeed(base, configForSeed(7));
    const depOut = out.find((n) => n.id === dep.id);
    expect(depOut).toBeDefined();
    if (!depOut) return;
    expect(depOut.resource).toBe(dep.resource);
    expect(depOut.purity).toBe(dep.purity);
  });

  it("preserves multiset of resources on shuffled nodes (strict + no_change)", () => {
    const base = loadBaseNodes();
    const nodeIds = new Set(base.filter((n) => n.nodeType === "node").map((n) => n.id));
    const before = base
      .filter((n) => nodeIds.has(n.id))
      .map((n) => n.resource)
      .sort(compareCodeUnit);
    const after = applyWorldSeed(base, configForSeed(123))
      .filter((n) => nodeIds.has(n.id))
      .map((n) => n.resource)
      .sort(compareCodeUnit);
    expect(after).toEqual(before);
  });
});

describe("nodeCache", () => {
  it("returns same reference on second call", () => {
    clearNodeSeedCache();
    const base = loadBaseNodes();
    const a = getNodesForSeed(base, 55);
    const b = getNodesForSeed(base, 55);
    expect(a).toBe(b);
    const c = getNodesForSeed(base, 56);
    expect(c).not.toBe(a);
  });

  it("clears when baseSlots identity changes", () => {
    clearNodeSeedCache();
    const base = loadBaseNodes();
    const a = getNodesForSeed(base, 1);
    const base2 = base.map((n) => ({ ...n }));
    const b = getNodesForSeed(base2, 1);
    expect(b).not.toBe(a);
    expect(b.map((n) => n.resource)).toEqual(a.map((n) => n.resource));
  });
});
