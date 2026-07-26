import { describe, expect, it } from "vitest";
import {
  leafletToWorld,
  WORLD_X_MAX,
  WORLD_X_MIN,
  WORLD_Y_MAX,
  WORLD_Y_MIN,
  worldToLeaflet,
} from "@/lib/coords";

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
