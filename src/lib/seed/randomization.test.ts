import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clearNodeSeedCache, getNodesForSeed } from "@/lib/seed/nodeCache";
import { applyWorldSeed } from "@/lib/seed/randomization";
import { configForSeed } from "@/lib/seed/types";
import type { ResourceNode } from "@/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadBaseNodes(): ResourceNode[] {
  const raw = readFileSync(join(root, "public/data/nodes/default-nodes.json"), "utf8");
  return JSON.parse(raw) as ResourceNode[];
}

function compareCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

describe("applyWorldSeed (WASM / Konsl)", () => {
  it("identity (none + no_change) preserves all resource/purity", () => {
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

  it("updates displayName to match shuffled resource", () => {
    const base = loadBaseNodes();
    const node = base.find((n) => n.nodeType === "node" && n.resource === "Desc_OreIron_C");
    expect(node).toBeDefined();
    if (!node) return;
    const out = applyWorldSeed(base, configForSeed(42));
    const shuffled = out.find((n) => n.id === node.id);
    expect(shuffled).toBeDefined();
    if (!shuffled) return;
    expect(shuffled.displayName).toBeTruthy();
    if (shuffled.resource !== "Desc_OreIron_C") {
      expect(shuffled.displayName).not.toMatch(/iron/i);
    }
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

  it("getNodesForSeed caches", () => {
    clearNodeSeedCache();
    const base = loadBaseNodes();
    const a = getNodesForSeed(base, 42);
    const b = getNodesForSeed(base, 42);
    expect(a).toBe(b);
  });
});
