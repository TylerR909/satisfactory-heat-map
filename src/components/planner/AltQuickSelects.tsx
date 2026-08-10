import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { recipeBadgeClassName } from "@/lib/production/badges";
import {
  applicableQuickSelects,
  isQuickSelectSelected,
  type QuickSelect,
  type QuickSelectChip,
  type QuickSelectContext,
} from "@/lib/production/quickSelects";
import type { Recipe } from "@/types";

const PAD = 8;
const PANEL_W = 280;
const GAP = 6;

/** Pin beside the button (prefer right → over the map), height-capped for scroll. */
type Pos = { left: number; maxHeight: number; top?: number; bottom?: number };

function clampPanelBeside(anchor: DOMRect, w: number, vw: number, vh: number): Pos {
  const width = Math.min(w, vw - PAD * 2);
  const spaceRight = vw - anchor.right - PAD - GAP;
  const spaceLeft = anchor.left - PAD - GAP;
  const placeRight = spaceRight >= Math.min(width, 160) || spaceRight >= spaceLeft;

  let left = placeRight ? anchor.right + GAP : anchor.left - GAP - width;
  left = Math.min(vw - PAD - width, Math.max(PAD, left));

  // Align top with button; if little room below, pin bottom to button bottom
  const spaceBelowTop = vh - anchor.top - PAD;
  if (spaceBelowTop >= 120) {
    return { left, top: anchor.top, maxHeight: Math.max(100, spaceBelowTop) };
  }
  return {
    left,
    bottom: vh - anchor.bottom,
    maxHeight: Math.max(100, anchor.bottom - PAD),
  };
}

type Props = {
  recipes: Recipe[];
  items: Record<string, import("@/types").ItemDef>;
  expansionItemIds: string[];
  productTargetIds: string[];
  /** Rates for expand-based presets (Minimize Input Types). */
  productTargets?: Array<{ productId: string; itemsPerMinute: number }>;
  externalItems?: string[];
  /** Live Mode B recipe picks — used for Selected / Partial affordances. */
  recipeOverrides?: Record<string, string>;
  onApply: (opts: {
    clear?: boolean;
    replace?: boolean;
    overrides?: Record<string, string>;
  }) => void;
};

/**
 * Popover of alternate quick-selects (Defaults, All Pure, harmonies, No Screws, …).
 * Only lists presets that match the current expand / products.
 */
/** Content fingerprint so parent `.map()` identity churn does not re-run expand solvers. */
function sortedIdKey(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  return [...ids].sort().join("\0");
}

function productTargetsKey(
  targets: ReadonlyArray<{ productId: string; itemsPerMinute: number }> | undefined,
): string {
  if (!targets || targets.length === 0) return "";
  return targets
    .map((t) => `${t.productId}:${t.itemsPerMinute}`)
    .sort()
    .join("|");
}

/** Keep last array whose content fingerprint matches `key`. */
function useContentStableArray<T>(arr: T[] | undefined, key: string): T[] | undefined {
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity intentionally ignored; `key` is content
  return useMemo(() => arr, [key]);
}

export function AltQuickSelects({
  recipes,
  items,
  expansionItemIds,
  productTargetIds,
  productTargets,
  externalItems,
  recipeOverrides = {},
  onApply,
}: Props) {
  // Stabilize against fresh `.map()` arrays each parent render (rate keystrokes, heat, …).
  const expansionIds = useContentStableArray(expansionItemIds, sortedIdKey(expansionItemIds));
  const productIds = useContentStableArray(productTargetIds, sortedIdKey(productTargetIds));
  const targets = useContentStableArray(productTargets, productTargetsKey(productTargets));
  const externals = useContentStableArray(externalItems, sortedIdKey(externalItems ?? []));

  const ctx: QuickSelectContext = useMemo(
    () => ({
      recipes,
      items,
      expansionItemIds: new Set(expansionIds ?? []),
      productTargetIds: new Set(productIds ?? []),
      productTargets: targets,
      externalItems: externals,
    }),
    [recipes, items, expansionIds, productIds, targets, externals],
  );

  const options = useMemo(() => applicableQuickSelects(ctx), [ctx]);
  // Always at least Defaults
  const hasMoreThanDefaults = options.some((q) => q.id !== "defaults");

  const [open, setOpen] = useState(false);

  // Selected only while open — resolve() for RE / Minimize is non-trivial
  const selectedById = useMemo(() => {
    const m = new Map<string, boolean>();
    if (!open) return m;
    for (const q of options) {
      m.set(q.id, isQuickSelectSelected(q, ctx, recipeOverrides));
    }
    return m;
  }, [open, options, ctx, recipeOverrides]);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const w = panelRef.current?.offsetWidth ?? PANEL_W;
      setPos(clampPanelBeside(r, w, window.innerWidth, window.innerHeight));
    };
    place();
    requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  function run(q: QuickSelect) {
    const result = q.resolve(ctx);
    if (result.kind === "clear") {
      onApply({ clear: true });
    } else if (result.kind === "replace") {
      onApply({ replace: true, overrides: result.overrides });
    } else {
      onApply({ overrides: result.overrides });
    }
    // Stay open so packs can stack without re-opening
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1 rounded border border-slate-700 bg-slate-900/80 px-2 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-slate-100"
        title="Apply groups of alternate recipes to in-play intermediates"
      >
        Quick selects
        <span className="text-slate-500" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
        {hasMoreThanDefaults && (
          <span className="rounded bg-slate-800 px-1 text-[10px] tabular-nums text-slate-500">
            {options.length}
          </span>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-labelledby={titleId}
            className="fixed z-[6000] flex w-[min(280px,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/50"
            style={{
              left: pos.left,
              maxHeight: Math.min(pos.maxHeight, window.innerHeight * 0.7, 22 * 16),
              ...(pos.top != null ? { top: pos.top } : {}),
              ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            }}
          >
            <div className="shrink-0 border-b border-slate-800/80 bg-slate-950/90 px-3 py-2">
              <p
                id={titleId}
                className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase"
              >
                Quick selects
              </p>
              <p className="mt-1 text-[10px] leading-snug text-slate-500">
                Packs merge — stack Screw-Free, Resource Efficient, and Pure (and more) as you like.
              </p>
            </div>
            <ul className="min-h-0 max-h-[min(55vh,18rem)] flex-1 space-y-0.5 overflow-y-auto p-1.5 pt-1">
              {options.map((q) => {
                const selected = selectedById.get(q.id) === true;
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => run(q)}
                      aria-pressed={selected}
                      className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                        selected ? "bg-sky-500/15 ring-1 ring-sky-500/40" : "hover:bg-slate-800/90"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {q.chip && <QuickSelectChipView chip={q.chip} />}
                          <span
                            className={`text-xs font-medium ${
                              selected ? "text-sky-200" : "text-slate-200"
                            }`}
                          >
                            {q.label}
                          </span>
                        </span>
                        {selected && (
                          <span className="shrink-0 text-[10px] font-medium text-sky-400">
                            Selected
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] leading-snug text-slate-500">
                        {q.description}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Pill / diamond aligned with Intermediates alt badges and empty alt buttons. */
function QuickSelectChipView({ chip }: { chip: QuickSelectChip }) {
  if (chip.kind === "diamond") {
    return (
      <span
        aria-hidden
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-slate-600 text-[10px] leading-none text-slate-500"
        title="Default recipes"
      >
        ◇
      </span>
    );
  }
  return (
    <span
      className={`shrink-0 rounded border px-1 py-px text-[9px] font-medium ${recipeBadgeClassName(chip.badgeKind)}`}
      style={{ cursor: "default" }}
    >
      {chip.text}
    </span>
  );
}
