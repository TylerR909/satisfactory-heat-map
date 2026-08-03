import { describe, expect, it } from "vitest";
import {
  clampClockPercent,
  extractorKindFor,
  formatRate,
  minerClockRateLabel,
  nodeExtractRate,
  oilClockRateLabel,
  softSnapClockPercent,
  waterClockRateLabel,
  wellClockRateLabel,
} from "@/lib/mining";
import type { ResourceNode } from "@/types";
import { DEFAULT_MINER_SETTINGS } from "@/types";

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

const mk3 = {
  ...DEFAULT_MINER_SETTINGS,
  minerMk: 3 as const,
  clockPercent: 100,
  oilClockPercent: 100,
  waterClockPercent: 100,
  wellClockPercent: 100,
  resourceWellsEnabled: true,
};
const mk1 = {
  ...DEFAULT_MINER_SETTINGS,
  minerMk: 1 as const,
  clockPercent: 100,
  oilClockPercent: 100,
  waterClockPercent: 100,
  wellClockPercent: 100,
  resourceWellsEnabled: true,
};

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

  it("resource well satellites use pressurizer clock — miner Mk ignored", () => {
    const sat = n({
      resource: "Desc_NitrogenGas_C",
      nodeType: "frackingSatellite",
      purity: "pure",
    });
    expect(extractorKindFor(sat)).toBe("resource_well");
    expect(nodeExtractRate(sat, mk1)).toBe(120); // 60 * pure @ 100%
    expect(nodeExtractRate(sat, { ...mk3, wellClockPercent: 250 })).toBe(300);
    expect(nodeExtractRate({ ...sat, purity: "impure" }, mk3)).toBe(30);
  });

  it("resource wells contribute 0 when disabled", () => {
    const sat = n({
      resource: "Desc_Water_C",
      nodeType: "frackingSatellite",
      purity: "pure",
    });
    expect(
      nodeExtractRate(sat, {
        ...mk3,
        resourceWellsEnabled: false,
        wellClockPercent: 250,
      }),
    ).toBe(0);
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

  it("applies oil clock % to oil extractors (not miner clock)", () => {
    const oil = n({ resource: "Desc_LiquidOil_C", nodeType: "node", purity: "normal" });
    expect(nodeExtractRate(oil, { ...mk1, clockPercent: 100, oilClockPercent: 250 })).toBe(300);
    expect(nodeExtractRate(oil, { ...mk1, clockPercent: 250, oilClockPercent: 100 })).toBe(120);
  });

  it("applies water clock % to open water extractors", () => {
    const water = n({ resource: "Desc_Water_C", nodeType: "node", purity: "normal" });
    expect(extractorKindFor(water)).toBe("water_extractor");
    expect(nodeExtractRate(water, { ...mk1, waterClockPercent: 100 })).toBe(120);
    expect(nodeExtractRate(water, { ...mk1, waterClockPercent: 250 })).toBe(300);
    // Miner clock must not affect water extractors
    expect(nodeExtractRate(water, { ...mk1, clockPercent: 100, waterClockPercent: 250 })).toBe(300);
  });
});

describe("clock percent soft snap", () => {
  it("clamps to 50–250 without forcing 50% steps", () => {
    expect(clampClockPercent(175, 100)).toBe(175);
    expect(clampClockPercent(40, 100)).toBe(50);
    expect(clampClockPercent(300, 100)).toBe(250);
  });

  it("soft-snaps near 50% marks but leaves mid values free", () => {
    expect(softSnapClockPercent(102, 100)).toBe(100);
    expect(softSnapClockPercent(98, 100)).toBe(100);
    expect(softSnapClockPercent(104, 100)).toBe(104); // outside ±3
    expect(softSnapClockPercent(175, 100)).toBe(175);
    expect(softSnapClockPercent(211, 100)).toBe(211); // was sticky at ±8
    expect(softSnapClockPercent(247, 100)).toBe(250);
  });
});

describe("clock rate labels", () => {
  it("formats miner impure/normal/pure at clock", () => {
    expect(minerClockRateLabel(1, 250)).toBe("75/150/300/min");
    expect(oilClockRateLabel(250)).toBe("150/300/600/min");
    expect(waterClockRateLabel(250)).toBe("300/min");
    expect(wellClockRateLabel(250)).toBe("75/150/300/min");
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
