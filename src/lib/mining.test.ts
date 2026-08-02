import { describe, expect, it } from "vitest";
import { extractorKindFor, formatRate, nodeExtractRate } from "@/lib/mining";
import type { ResourceNode } from "@/types";

function n(
  partial: Partial<ResourceNode> & Pick<ResourceNode, "resource" | "nodeType" | "purity">,
): ResourceNode {
  return {
    id: "t",
    x: 0,
    y: 0,
    z: 0,
    ...partial,
  };
}

const mk3 = { minerMk: 3 as const, clockPercent: 100 };
const mk1 = { minerMk: 1 as const, clockPercent: 100 };

describe("extractor hardware vs miner Mk", () => {
  it("uses miner Mk for solid ore nodes", () => {
    const iron = n({ resource: "Desc_OreIron_C", nodeType: "node", purity: "normal" });
    expect(extractorKindFor(iron)).toBe("miner");
    expect(nodeExtractRate(iron, mk1)).toBe(60);
    expect(nodeExtractRate(iron, mk3)).toBe(240);
    expect(nodeExtractRate({ ...iron, purity: "pure" }, mk3)).toBe(480);
  });

  it("oil nodes use Oil Extractor rates — miner Mk ignored", () => {
    const oil = n({ resource: "Desc_LiquidOil_C", nodeType: "node", purity: "normal" });
    expect(extractorKindFor(oil)).toBe("oil_extractor");
    expect(nodeExtractRate(oil, mk1)).toBe(120);
    expect(nodeExtractRate(oil, mk3)).toBe(120); // Mk does not apply
    expect(nodeExtractRate({ ...oil, purity: "pure" }, mk3)).toBe(240);
    expect(nodeExtractRate({ ...oil, purity: "impure" }, mk1)).toBe(60);
  });

  it("resource well satellites use well extractors — miner Mk ignored", () => {
    const sat = n({
      resource: "Desc_NitrogenGas_C",
      nodeType: "frackingSatellite",
      purity: "pure",
    });
    expect(extractorKindFor(sat)).toBe("resource_well");
    expect(nodeExtractRate(sat, mk1)).toBe(120); // 60 * pure
    expect(nodeExtractRate(sat, mk3)).toBe(120);
    expect(nodeExtractRate({ ...sat, purity: "impure" }, mk3)).toBe(30);
  });

  it("fracking cores have no rate (pressurizer only)", () => {
    const core = n({
      resource: "Desc_LiquidOil_C",
      nodeType: "frackingCore",
      purity: "normal",
    });
    expect(extractorKindFor(core)).toBe("none");
    expect(nodeExtractRate(core, mk3)).toBe(0);
  });

  it("applies clock % to oil extractors", () => {
    const oil = n({ resource: "Desc_LiquidOil_C", nodeType: "node", purity: "normal" });
    expect(nodeExtractRate(oil, { minerMk: 1, clockPercent: 250 })).toBe(300);
  });
});

describe("formatRate", () => {
  it("drops trailing zeros", () => {
    expect(formatRate(90)).toBe("90");
    expect(formatRate(30)).toBe("30");
    expect(formatRate(3)).toBe("3");
    expect(formatRate(100)).toBe("100");
  });

  it("keeps meaningful decimals", () => {
    expect(formatRate(12.5)).toBe("12.5");
    expect(formatRate(0.33)).toBe("0.33");
    expect(formatRate(1.5)).toBe("1.5");
  });
});
