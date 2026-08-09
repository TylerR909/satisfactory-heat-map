import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { recipeBadgeClassName } from "@/lib/production/badges";
import {
  applicableQuickSelects,
  type QuickSelect,
  type QuickSelectChip,
  type QuickSelectContext,
} from "@/lib/production/quickSelects";
import type { Recipe } from "@/types";

const PAD = 8;
const PANEL_W = 280;

type Pos = { left: number; top: number };

function clampPanel(anchor: DOMRect, w: number, h: number, vw: number, vh: number): Pos {
  const width = Math.min(w, vw - PAD * 2);
  let left = anchor.left;
  left = Math.min(vw - PAD - width, Math.max(PAD, left));
  const spaceBelow = vh - anchor.bottom - PAD;
  const spaceAbove = anchor.top - PAD;
  const placeBelow = spaceBelow >= Math.min(h, 160) || spaceBelow >= spaceAbove;
  let top = placeBelow ? anchor.bottom + 6 : anchor.top - 6 - h;
  top = Math.min(vh - PAD - h, Math.max(PAD, top));
  return { left, top };
}

type Props = {
  recipes: Recipe[];
  items: Record<string, import("@/types").ItemDef>;
  expansionItemIds: string[];
  productTargetIds: string[];
  /** Rates for expand-based presets (Minimize Input Types). */
  productTargets?: Array<{ productId: string; itemsPerMinute: number }>;
  externalItems?: string[];
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
export function AltQuickSelects({
  recipes,
  items,
  expansionItemIds,
  productTargetIds,
  productTargets,
  externalItems,
  onApply,
}: Props) {
  const ctx: QuickSelectContext = useMemo(
    () => ({
      recipes,
      items,
      expansionItemIds: new Set(expansionItemIds),
      productTargetIds: new Set(productTargetIds),
      productTargets,
      externalItems,
    }),
    [recipes, items, expansionItemIds, productTargetIds, productTargets, externalItems],
  );

  const options = useMemo(() => applicableQuickSelects(ctx), [ctx]);
  // Always at least Defaults
  const hasMoreThanDefaults = options.some((q) => q.id !== "defaults");

  const [open, setOpen] = useState(false);
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
      const panel = panelRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const h = panel?.offsetHeight ?? 240;
      const w = panel?.offsetWidth ?? PANEL_W;
      setPos(clampPanel(r, w, h, window.innerWidth, window.innerHeight));
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
    setOpen(false);
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
            className="fixed z-[6000] max-h-[min(70vh,22rem)] w-[min(280px,calc(100vw-1rem))] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/50"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="border-b border-slate-800/80 bg-slate-950/90 px-3 py-2">
              <p
                id={titleId}
                className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase"
              >
                Quick selects
              </p>
            </div>
            <ul className="max-h-[min(55vh,18rem)] space-y-0.5 overflow-y-auto p-1.5 pt-1">
              {options.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => run(q)}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-slate-800/90"
                  >
                    <span className="flex items-center gap-2">
                      {q.chip && <QuickSelectChipView chip={q.chip} />}
                      <span className="text-xs font-medium text-slate-200">{q.label}</span>
                    </span>
                    <span className="text-[10px] leading-snug text-slate-500">{q.description}</span>
                  </button>
                </li>
              ))}
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
