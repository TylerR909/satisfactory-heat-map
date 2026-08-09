import {
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { addsBadgeTint } from "@/lib/production/addsBadgeTint";
import {
  badgeAlternate,
  badgeTooltip,
  formatRecipeSummary,
  type RecipeBadge,
  recipeBadgeClassName,
} from "@/lib/production/badges";
import {
  listAlternateRecipes,
  listProductionRecipes,
  recipeButtonLabel,
  recipeShortName,
  resolveProductionRecipe,
} from "@/lib/production/solve";
import type { ItemDef, Recipe } from "@/types";

const PAD = 8;
const PANEL_W = 300;
/** Recipe-control (◇ / −) summary tip — delayed so it doesn't fight link-highlight scanning. */
const RECIPE_BUTTON_TIP_MS = 500;

type Pos = { left: number; top: number };

function clampPanel(anchor: DOMRect, w: number, h: number, vw: number, vh: number): Pos {
  const width = Math.min(w, vw - PAD * 2);
  // Prefer align to button right (column sits on the right edge of the row)
  let left = anchor.right - width;
  left = Math.min(vw - PAD - width, Math.max(PAD, left));
  const spaceBelow = vh - anchor.bottom - PAD;
  const spaceAbove = anchor.top - PAD;
  const placeBelow = spaceBelow >= Math.min(h, 200) || spaceBelow >= spaceAbove;
  let top = placeBelow ? anchor.bottom + 6 : anchor.top - 6 - h;
  top = Math.min(vh - PAD - h, Math.max(PAD, top));
  return { left, top };
}

type Props = {
  itemId: string;
  recipes: Recipe[];
  items: Record<string, ItemDef>;
  /** Selected recipe ClassName, or null/undefined for default. */
  selectedRecipeId: string | null | undefined;
  onSelect: (recipeId: string | null) => void;
  /** When true, row is off-site — selector disabled (no hover/menu). */
  dimmed?: boolean;
  /**
   * Fired when the recipe control is hovered (true) or left (false).
   * Parent highlights this item + direct inputs (upstream) and consumers (downstream).
   */
  onHighlightChange?: (active: boolean) => void;
};

/**
 * Squarish alternate-recipe control for an Intermediates row.
 * Empty/dashed = default recipe; filled = alternate selected.
 * Always reserves a fixed slot so rows stay aligned.
 */
export function RecipeAltPicker({
  itemId,
  recipes,
  items,
  selectedRecipeId,
  onSelect,
  dimmed,
  onHighlightChange,
}: Props) {
  const alts = useMemo(() => listAlternateRecipes(recipes, itemId), [recipes, itemId]);
  const all = useMemo(() => listProductionRecipes(recipes, itemId), [recipes, itemId]);
  const defaultRecipe = all[0];
  const hasAlts = alts.length > 0;

  const selected =
    selectedRecipeId != null
      ? resolveProductionRecipe(itemId, recipes, undefined, undefined, selectedRecipeId)
      : defaultRecipe;
  // Any non-default pick (hard-drive alt OR Residual / other non-HD path)
  const isAlt = selected != null && defaultRecipe != null && selected.id !== defaultRecipe.id;

  const [open, setOpen] = useState(false);
  /** Hover tip for the currently selected recipe (default or alt). */
  const [recipeTipOpen, setRecipeTipOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(false);
  /** Stable callback — parent passes a new function each render; must not re-fire effects. */
  const onHighlightChangeRef = useRef(onHighlightChange);
  onHighlightChangeRef.current = onHighlightChange;
  const [pos, setPos] = useState<Pos | null>(null);
  const titleId = useId();

  const setHighlight = (active: boolean) => {
    onHighlightChangeRef.current?.(active);
  };

  const recipeTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearRecipeTipTimer() {
    if (recipeTipTimer.current) {
      clearTimeout(recipeTipTimer.current);
      recipeTipTimer.current = null;
    }
  }

  // Close when item changes (list reorders after pick)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset open when row identity changes
  useEffect(() => {
    setOpen(false);
    setRecipeTipOpen(false);
    clearRecipeTipTimer();
    hoveringRef.current = false;
    setHighlight(false);
  }, [itemId]);

  // Off-site: force-close menu and clear hover state
  useEffect(() => {
    if (!dimmed) return;
    setOpen(false);
    setRecipeTipOpen(false);
    if (recipeTipTimer.current) {
      clearTimeout(recipeTipTimer.current);
      recipeTipTimer.current = null;
    }
    hoveringRef.current = false;
    onHighlightChangeRef.current?.(false);
  }, [dimmed]);

  useEffect(() => {
    return () => {
      if (recipeTipTimer.current) clearTimeout(recipeTipTimer.current);
    };
  }, []);

  // Menu open (incl. mobile tap) holds input-link highlight; close clears unless still hovering.
  // Only depend on `open` — sibling pickers must not re-fire clear on parent re-render.
  useEffect(() => {
    if (dimmed) return;
    if (open) onHighlightChangeRef.current?.(true);
    else if (!hoveringRef.current) onHighlightChangeRef.current?.(false);
  }, [open, dimmed]);

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
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = panel?.offsetHeight ?? 280;
      const w = panel?.offsetWidth ?? PANEL_W;
      setPos(clampPanel(r, w, h, vw, vh));
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

  // Off-site: inert glyph only (no menu / hover / tips)
  if (dimmed) {
    return <OffsiteRecipeSlot />;
  }

  // No alts (or no production recipe): still show a fixed slot — hover for recipe summary
  if (!hasAlts) {
    const summary = defaultRecipe
      ? formatRecipeSummary(defaultRecipe, items)
      : "Map resource — no factory recipe";
    return (
      <RecipePreviewButton
        summary={summary}
        ariaLabel={
          defaultRecipe ? `Only recipe: ${recipeShortName(defaultRecipe)}. ${summary}` : summary
        }
        onHighlightChange={onHighlightChange}
      />
    );
  }

  if (!defaultRecipe) {
    return (
      <RecipePreviewButton
        summary="No production recipe"
        ariaLabel="No production recipe"
        onHighlightChange={onHighlightChange}
      />
    );
  }

  const buttonLabel = isAlt && selected ? recipeButtonLabel(selected, alts) : "";
  const activeRecipe = selected ?? defaultRecipe;
  const recipeSummary = activeRecipe ? formatRecipeSummary(activeRecipe, items) : "";
  const recipeName = activeRecipe ? (isAlt ? recipeShortName(activeRecipe) : "Default") : "Recipe";
  const recipeTip = activeRecipe ? `${recipeName}: ${recipeSummary}` : "";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          isAlt && selected
            ? `Alternate recipe: ${recipeShortName(selected)}. ${recipeSummary}`
            : `Default recipe. ${recipeSummary}. Click to pick an alternate`
        }
        onClick={() => {
          clearRecipeTipTimer();
          setRecipeTipOpen(false);
          setOpen((v) => !v);
        }}
        onMouseEnter={() => {
          hoveringRef.current = true;
          setHighlight(true); // instant — not delayed with the tip
          if (!open && recipeTip) {
            clearRecipeTipTimer();
            recipeTipTimer.current = setTimeout(() => setRecipeTipOpen(true), RECIPE_BUTTON_TIP_MS);
          }
        }}
        onMouseLeave={() => {
          hoveringRef.current = false;
          // Hold while menu open (popover / touch path)
          if (!open) setHighlight(false);
          clearRecipeTipTimer();
          setRecipeTipOpen(false);
        }}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border text-[9px] font-semibold leading-none tracking-tight transition-colors ${
          isAlt
            ? "border-sky-500/50 bg-sky-500/20 text-sky-200 hover:border-sky-400 hover:bg-sky-500/35 hover:text-sky-100"
            : "border-dashed border-slate-600 bg-transparent text-slate-500 hover:border-solid hover:border-slate-400 hover:bg-slate-800 hover:text-slate-200"
        }`}
      >
        {isAlt ? <span className="px-0.5">{buttonLabel}</span> : <span aria-hidden>◇</span>}
      </button>

      {recipeTipOpen &&
        !open &&
        recipeTip &&
        createPortal(<RecipeHoverTip anchorRef={anchorRef} text={recipeTip} />, document.body)}

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-labelledby={titleId}
            className="fixed z-[6000] max-h-[min(70vh,28rem)] w-[min(300px,calc(100vw-1rem))] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/50"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="border-b border-slate-800 px-3 py-2">
              <h3 id={titleId} className="text-xs font-medium text-slate-200">
                Recipe for{" "}
                <strong className="font-semibold text-white">
                  {items[itemId]?.name ?? itemId}
                </strong>
              </h3>
            </div>
            <ul className="max-h-[min(55vh,22rem)] space-y-0.5 overflow-y-auto p-1.5">
              <li>
                <RecipeOption
                  active={!isAlt}
                  name="Default"
                  summary={formatRecipeSummary(defaultRecipe, items)}
                  badges={[]}
                  onClick={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                />
              </li>
              {alts.map((alt) => {
                const badges = badgeAlternate(alt, recipes, items);
                const active = selectedRecipeId === alt.id;
                return (
                  <li key={alt.id}>
                    <RecipeOption
                      active={active}
                      name={recipeShortName(alt)}
                      summary={formatRecipeSummary(alt, items)}
                      badges={badges}
                      onClick={() => {
                        // Toggle off if re-selecting the same alt
                        onSelect(active ? null : alt.id);
                        setOpen(false);
                      }}
                    />
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

/** Portal hover tip anchored to a control (selected recipe IO summary). */
function RecipeHoverTip({
  anchorRef,
  text,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  text: string;
}) {
  const [pos, setPos] = useState<{ left: number; top: number; place: "above" | "below" } | null>(
    null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: remount with new `text` repositions tip
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 8, Math.max(8, r.left + r.width / 2));
    const place: "above" | "below" = r.top > 48 ? "above" : "below";
    const top = place === "above" ? r.top - 6 : r.bottom + 6;
    setPos({ left, top, place });
  }, [anchorRef, text]);

  if (!pos) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none fixed z-[7000] max-w-[16rem] rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-[10px] leading-snug text-slate-200 shadow-lg"
      style={{
        left: pos.left,
        top: pos.top,
        transform: pos.place === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      {text}
    </span>
  );
}

/** Off-site row: inert “×” — no menu, tips, highlight, or hover affordance. */
function OffsiteRecipeSlot() {
  return (
    <span
      aria-hidden
      className="pointer-events-none inline-flex h-7 w-7 shrink-0 select-none items-center justify-center rounded border border-dashed border-slate-800/70 bg-transparent text-[11px] font-medium leading-none text-slate-700"
      style={{ cursor: "default" }}
    >
      ×
    </span>
  );
}

/**
 * Fixed-size control for rows with no alternates — hover shows the only recipe
 * (or map-raw note). Not a menu; keeps column alignment with diamond buttons.
 */
function RecipePreviewButton({
  summary,
  ariaLabel,
  onHighlightChange,
}: {
  summary: string;
  ariaLabel: string;
  onHighlightChange?: (active: boolean) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [tipOpen, setTipOpen] = useState(false);
  /** Sticky on tap (mobile) until second tap or outside click */
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function showDelayed() {
    clearTimer();
    timer.current = setTimeout(() => setTipOpen(true), RECIPE_BUTTON_TIP_MS);
  }

  function hide() {
    clearTimer();
    setTipOpen(false);
  }

  function clearAll() {
    setPinned(false);
    hide();
    onHighlightChange?.(false);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Outside tap dismisses sticky preview (mobile)
  // biome-ignore lint/correctness/useExhaustiveDependencies: pin session only
  useEffect(() => {
    if (!pinned) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      clearAll();
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [pinned]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={pinned}
        // Explicit cursor: UA stylesheet makes <button> pointer even with Tailwind cursor-default
        style={{ cursor: "default" }}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-slate-800/90 bg-slate-950/50 text-[11px] font-medium leading-none text-slate-600 ${
          pinned ? "border-slate-700 text-slate-500" : ""
        }`}
        onMouseEnter={() => {
          if (!pinned) {
            onHighlightChange?.(true);
            showDelayed();
          }
        }}
        onMouseLeave={() => {
          if (!pinned) {
            onHighlightChange?.(false);
            hide();
          }
        }}
        onClick={(e) => {
          e.preventDefault();
          // Toggle sticky tip + highlight (works without hover on touch devices)
          if (pinned) {
            clearAll();
          } else {
            setPinned(true);
            onHighlightChange?.(true);
            clearTimer();
            setTipOpen(true);
          }
        }}
      >
        <span aria-hidden>−</span>
      </button>
      {tipOpen && createPortal(<RecipeHoverTip anchorRef={ref} text={summary} />, document.body)}
    </>
  );
}

function RecipeOption({
  active,
  name,
  summary,
  badges,
  onClick,
}: {
  active: boolean;
  name: string;
  summary: string;
  badges: RecipeBadge[];
  onClick: () => void;
}) {
  // One hit target for the whole row (name, summary, badge strip, padding).
  // Div+role (not <button>) so badge hover tips stay non-nested interactive content.
  return (
    // biome-ignore lint/a11y/useSemanticElements: whole-row hit target; badges need non-button children
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer rounded-md px-2.5 py-2 text-left transition-colors ${
        active ? "bg-sky-500/15 ring-1 ring-sky-500/40" : "hover:bg-slate-800/90"
      }`}
    >
      <div className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span className={`text-xs font-medium ${active ? "text-sky-200" : "text-slate-200"}`}>
            {name}
          </span>
          {active && <span className="text-[10px] font-medium text-sky-400">Selected</span>}
        </span>
        <span className="text-[10px] leading-snug text-slate-500">{summary}</span>
      </div>
      {badges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {badges.map((b) => (
            <BadgeChip key={`${b.kind}-${b.itemId ?? b.label}`} badge={b} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Badge pill inside a recipe option row. Tips are instant; cursor inherits the
 * row’s pointer (no I-beam, still clickable as part of the row).
 */
function BadgeChip({ badge }: { badge: RecipeBadge }) {
  const tip = badgeTooltip(badge);
  const addsTint = badge.kind === "introduces" ? addsBadgeTint(badge.itemId, badge.label) : null;
  const chipClass = `rounded border px-1 py-px text-[9px] font-medium ${
    addsTint?.className ?? recipeBadgeClassName(badge.kind)
  }`;
  const ref = useRef<HTMLSpanElement>(null);
  const [tipOpen, setTipOpen] = useState(false);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover tip only; click selects parent row */}
      <span
        ref={ref}
        className={chipClass}
        style={{ cursor: "inherit" }}
        onMouseEnter={() => {
          if (tip) setTipOpen(true);
        }}
        onMouseLeave={() => setTipOpen(false)}
      >
        {addsTint?.split ? (
          <>
            {addsTint.split.prefix}
            <span style={{ ...addsTint.split.nameStyle, cursor: "inherit" }}>
              {addsTint.split.name}
            </span>
          </>
        ) : (
          badge.label
        )}
      </span>
      {tipOpen && tip && createPortal(<RecipeHoverTip anchorRef={ref} text={tip} />, document.body)}
    </>
  );
}
