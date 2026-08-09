/**
 * “Adds X” badges: neutral chip, resource name in map node color.
 */
import type { CSSProperties } from "react";
import { RESOURCE_COLORS } from "@/lib/resources";

export type AddsBadgeTint = {
  className: string;
  /** When set, render `prefix` + colored `name` instead of plain label */
  split?: { prefix: string; name: string; nameStyle: CSSProperties };
};

const NEUTRAL = "cursor-default select-none border-slate-600/50 bg-slate-900/60 text-slate-400";

/**
 * Styles for an “Adds {resource}” badge.
 * Unknown / unmapped resources fall back to a fully neutral chip.
 */
export function addsBadgeTint(resourceId: string | undefined, label: string): AddsBadgeTint {
  if (!resourceId) return { className: NEUTRAL };

  const color = RESOURCE_COLORS[resourceId];
  if (!color) return { className: NEUTRAL };

  const m = /^(Adds\s+)(.+)$/i.exec(label);
  const prefix = m?.[1] ?? "Adds ";
  const name = m?.[2] ?? label;

  return {
    className: NEUTRAL,
    split: {
      prefix,
      name,
      nameStyle: { color, fontWeight: 600 },
    },
  };
}
