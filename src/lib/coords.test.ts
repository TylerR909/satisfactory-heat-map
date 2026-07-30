import { describe, expect, it } from "vitest";
import {
  distXY,
  distXYZ,
  haulDist,
  leafletToWorld,
  median,
  WORLD_X_MAX,
  WORLD_X_MIN,
  WORLD_Y_MAX,
  WORLD_Y_MIN,
  worldToLeaflet,
} from "@/lib/coords";

describe("haul distance", () => {
  it("distXYZ includes elevation", () => {
    expect(distXY(0, 0, 300, 400)).toBeCloseTo(500, 5);
    expect(distXYZ(0, 0, 0, 300, 400, 0)).toBeCloseTo(500, 5);
    expect(distXYZ(0, 0, 0, 0, 0, 1200)).toBeCloseTo(1200, 5);
    expect(distXYZ(0, 0, 0, 300, 400, 1200)).toBeCloseTo(Math.hypot(500, 1200), 5);
  });

  it("haulDist ignores Z when elevation is off", () => {
    expect(haulDist(0, 0, 0, 0, 0, 5000, false)).toBe(0);
    expect(haulDist(0, 0, 0, 0, 0, 5000, true)).toBeCloseTo(5000, 5);
  });

  it("median is order-independent", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("rockfactory-compatible game → leaflet mapping", () => {
  it("round-trips game ↔ leaflet", () => {
    const samples = [
      [0, 0],
      [-100_000, -200_000],
      [300_000, -172_000],
      [WORLD_X_MIN, WORLD_Y_MIN],
      [WORLD_X_MAX, WORLD_Y_MAX],
    ] as const;
    for (const [x, y] of samples) {
      const [lat, lng] = worldToLeaflet(x, y);
      const back = leafletToWorld(lat, lng);
      expect(back.x).toBeCloseTo(x, 5);
      expect(back.y).toBeCloseTo(y, 5);
    }
  });

  it("maps west < east in lng", () => {
    const w = worldToLeaflet(WORLD_X_MIN, 0);
    const e = worldToLeaflet(WORLD_X_MAX, 0);
    expect(w[1]).toBeLessThan(e[1]);
  });
});
