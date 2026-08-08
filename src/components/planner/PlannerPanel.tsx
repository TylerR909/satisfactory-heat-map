import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Attributions } from "@/components/Attributions";
import { SavedPlansBar } from "@/components/planner/SavedPlansBar";
import { useAutoHeatmap } from "@/hooks/useAutoHeatmap";
import { formatDistCm } from "@/lib/coords";
import {
  DEFAULT_HEAT_RENDER,
  ELEV_DASH_SLIDER_OFF_M,
  elevDashSliderMToThresholdCm,
  elevDashThresholdToSliderM,
  formatHeatRenderCode,
} from "@/lib/heatmap/heatRender";
import {
  CLOCK_PERCENT_MAX,
  CLOCK_PERCENT_MIN,
  formatRate,
  minerClockRateLabel,
  oilClockRateLabel,
  softSnapClockPercent,
  waterClockRateLabel,
  wellClockRateLabel,
} from "@/lib/mining";
import { encodePlanHash } from "@/lib/planHash";
import {
  RAW_RESOURCE_OPTIONS,
  resourceLabel,
  WATER_RESOURCE_ID,
  WELL_ONLY_RESOURCE_IDS,
} from "@/lib/resources";
import { useAppStore } from "@/store/useAppStore";
import type { CapacityTag, HeatmapResult, MinerMk, ScoringMode, SiteScore } from "@/types";
import { DEFAULT_HEAT_OPACITY } from "@/types";

/**
 * Overclock control — same layout as Heat settings sliders:
 *   [label extras…]                    250% (rate)
 *   ==============O===================
 *   50                               250
 *
 * Drag updates local draft only; commit on pointer/keyboard release.
 */
function ClockPercentSlider({
  label,
  value,
  onChange,
  "aria-label": ariaLabel,
  /** Live rate readout, e.g. "300/min" or "75/150/300/min" (impure/normal/pure). */
  rateLabel,
}: {
  /** Left side of the header row (section name, Mk group, checkbox, tip…). */
  label: ReactNode;
  value: number;
  onChange: (n: number) => void;
  "aria-label": string;
  rateLabel?: (clockPercent: number) => string;
}) {
  const id = useId();
  const dragging = useRef(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!dragging.current) setDraft(value);
  }, [value]);

  const applyLocal = (raw: number) => {
    const v = softSnapClockPercent(raw, draft);
    setDraft(v);
    return v;
  };

  const commit = (raw: number) => {
    const v = applyLocal(raw);
    onChange(v);
  };

  const endDrag = (raw: number) => {
    dragging.current = false;
    commit(raw);
  };

  const rateHint = rateLabel?.(draft);
  const valueText = rateHint ? `${draft}% (${rateHint})` : `${draft}%`;

  return (
    <div className="block space-y-1 text-xs text-slate-400">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">{label}</span>
        <span className="shrink-0 font-mono text-slate-300">{valueText}</span>
      </div>
      <input
        id={id}
        type="range"
        min={CLOCK_PERCENT_MIN}
        max={CLOCK_PERCENT_MAX}
        step={1}
        value={draft}
        aria-label={ariaLabel}
        aria-valuetext={valueText}
        className="sf-clock-range w-full"
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={(e) => endDrag(Number((e.target as HTMLInputElement).value))}
        onPointerCancel={(e) => endDrag(Number((e.target as HTMLInputElement).value))}
        onBlur={(e) => {
          if (dragging.current) endDrag(Number(e.currentTarget.value));
        }}
        onChange={(e) => {
          const raw = Number(e.target.value);
          if (dragging.current) applyLocal(raw);
          else commit(raw);
        }}
      />
      <span className="flex justify-between text-[10px] text-slate-600">
        <span>{CLOCK_PERCENT_MIN}</span>
        <span>{CLOCK_PERCENT_MAX}</span>
      </span>
    </div>
  );
}

function MinerMkGroup({ value, onChange }: { value: MinerMk; onChange: (mk: MinerMk) => void }) {
  return (
    <fieldset className="m-0 inline-flex overflow-hidden rounded border border-slate-700 p-0">
      <legend className="absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]">
        Miner Mk
      </legend>
      {([1, 2, 3] as const).map((mk) => {
        const on = value === mk;
        return (
          <button
            key={mk}
            type="button"
            className={
              on
                ? "bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-100"
                : "px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800/80 hover:text-slate-300"
            }
            onClick={() => onChange(mk)}
            aria-pressed={on}
          >
            Mk{mk}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Single UI continuum for site preference:
 * 0 = Centered + harsh (centerPower 2.0) … N-1 = Centered + soft (1.0) … N = Weighted.
 * Center strength is folded into the left side of the slider.
 */
const BALANCE_WEIGHTED = 21; // slider max; 0..20 = centered power steps

function balanceFromState(mode: ScoringMode, centerPower: number): number {
  if (mode === "weighted") return BALANCE_WEIGHTED;
  const p = Math.min(2, Math.max(1, centerPower));
  return Math.round((2 - p) / 0.05);
}

function balanceToMode(value: number): { mode: ScoringMode; centerPower?: number } {
  if (value >= BALANCE_WEIGHTED) return { mode: "weighted" };
  return { mode: "centered", centerPower: 2 - value * 0.05 };
}

function capacityLabel(
  tag: CapacityTag | undefined,
  satisfiable: boolean,
): {
  text: string;
  className: string;
} {
  const t = tag ?? (satisfiable ? "ok" : "shortfall");
  switch (t) {
    case "abundant":
      return { text: "Abundant", className: "text-sky-400" };
    case "limited":
      return { text: "Limited", className: "text-amber-400" };
    case "shortfall":
      return { text: "shortfall", className: "text-red-400" };
    default:
      return { text: "OK", className: "text-emerald-400" };
  }
}

/**
 * maxUtilization = demand / nearby extract capacity for the bottleneck resource.
 * Plain language so it doesn’t read like a mystery “% local” metric.
 *
 * Prefer naming shortfall resources (e.g. Nitrogen with wells off) over a
 * mysterious “999% of nearby supply” when local capacity is zero.
 */
function siteSupplySummary(
  site: SiteScore,
  items: Record<string, { name?: string } | undefined>,
): string | null {
  const short = site.byResource.filter((r) => r.shortfall > 1e-3);
  if (short.length > 0) {
    const names = short.map((r) => resourceLabel(r.resource, items)).join(", ");
    return `missing ${names}`;
  }
  const maxUtilization = site.maxUtilization;
  if (maxUtilization == null || !Number.isFinite(maxUtilization)) return null;
  const pct = Math.min(999, Math.round(maxUtilization * 100));
  if (pct > 100) return `needs ${pct}% of nearby supply`;
  return `uses ${pct}% of nearby supply`;
}

/** Cap for rate fields (matches plan-hash u16 ceiling). */
const RATE_INPUT_MAX = 65_535;

/** True for "", "3", "3.", ".5", "3.5" — one optional fractional part. */
function isRateDraft(s: string): boolean {
  return s === "" || /^\d*\.?\d*$/.test(s);
}

/**
 * Items/min field: empty while 0 (clear + retype works), decimals allowed (e.g. 3.5).
 * Draft string while focused so trailing "." is not eaten by controlled numeric value.
 */
function RateInput({
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  "aria-label": string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft !== null ? draft : value === 0 ? "" : String(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      className={className}
      value={display}
      onFocus={() => setDraft(value === 0 ? "" : String(value))}
      onBlur={() => {
        setDraft(null);
        // Normalize e.g. "3." → 3, ".5" → 0.5 already applied via onChange
        if (Number.isFinite(value) && value > 0) {
          const clamped = Math.min(RATE_INPUT_MAX, Math.max(0, value));
          if (clamped !== value) onChange(clamped);
        }
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!isRateDraft(raw)) return;
        setDraft(raw);
        if (raw === "" || raw === ".") {
          onChange(0);
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        onChange(Math.min(RATE_INPUT_MAX, Math.max(0, n)));
      }}
    />
  );
}

export function PlannerPanel() {
  useAutoHeatmap(160);

  const {
    mode,
    setMode,
    rawDemand,
    updateRawLine,
    addRawLine,
    removeRawLine,
    productTargets,
    updateProductLine,
    addProductLine,
    removeProductLine,
    externalItems,
    expansionRows,
    setItemExternal,
    miner,
    setMiner,
    scoringMode,
    setScoringMode,
    scoringOptions,
    setScoringOptions,
    heatRender,
    setHeatRender,
    heatPaintOpen,
    setHeatPaintOpen,
    resetKnobs,
    resetAllDefaults,
    sendProductsToRaw,
    extractorsOpen,
    setExtractorsOpen,
    advancedOpen,
    setAdvancedOpen,
    expansionOpen,
    setExpansionOpen,
    activeDemand,
    items,
    computing,
    error,
    heatmap,
    lastRasterizeMs,
    heatOpacity,
    setHeatOpacity,
    showNodes,
    setShowNodes,
    openWater,
    selectedSiteIndex,
    setSelectedSiteIndex,
  } = useAppStore();

  const waterInDemand = activeDemand.some((d) => d.resource === WATER_RESOURCE_ID);
  /** Raws that cannot be met with wells off (today: Nitrogen Gas only). */
  const wellOnlyInDemand = activeDemand.filter(
    (d) => d.itemsPerMinute > 0 && WELL_ONLY_RESOURCE_IDS.includes(d.resource),
  );
  const wellsRequiredForPlan = wellOnlyInDemand.length > 0;
  const openWaterBodyCount = openWater?.bodies?.length ?? 0;

  // Plans that need Nitrogen (wells-only) force pressurizers on for scoring.
  useEffect(() => {
    if (wellsRequiredForPlan && !miner.resourceWellsEnabled) {
      setMiner({ resourceWellsEnabled: true });
    }
  }, [wellsRequiredForPlan, miner.resourceWellsEnabled, setMiner]);

  // Factory-automatable products only (see parse-docs: ItemDef.automatable)
  const craftable = Object.values(items)
    .filter((i) => !i.raw && i.automatable)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seed = useAppStore((s) => s.seed);

  async function copyPlanHash() {
    const hash = encodePlanHash({
      mode,
      rawDemand,
      productTargets,
      miner,
      scoringMode,
      scoringOptions,
      seed,
      externalItems,
    });
    try {
      await navigator.clipboard.writeText(hash);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("idle"), 1600);
  }

  const selected =
    heatmap && selectedSiteIndex != null ? heatmap.topSites[selectedSiteIndex] : null;

  return (
    <aside className="flex h-full w-full flex-col gap-4 overflow-y-auto overscroll-contain border-slate-800 bg-slate-950/95 p-4 text-slate-100 [-webkit-overflow-scrolling:touch] md:border-r">
      <header>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-white">Satisfactory Heatmap</h1>
          {computing && (
            <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              Updating…
            </span>
          )}
          {!computing && heatmap && (
            <HeatmapTimingBadge heatmap={heatmap} rasterizeMs={lastRasterizeMs} />
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Live heatmap — changes recompute automatically. Bring ratios from Tools / Kirk, or pick a
          product for a quick default-recipe estimate.
        </p>
      </header>

      <SavedPlansBar />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">Input mode</h2>
        <div className="flex gap-2">
          <ModeButton active={mode === "raw"} onClick={() => setMode("raw")}>
            Raw resources
          </ModeButton>
          <ModeButton active={mode === "product"} onClick={() => setMode("product")}>
            Products
          </ModeButton>
        </div>
      </section>

      {mode === "raw" ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-300">Raw demand (items/min)</h2>
            <CopyHashButton state={copyState} onClick={() => void copyPlanHash()} />
          </div>
          {rawDemand.map((line) => {
            const takenByOthers = new Set(
              rawDemand.filter((r) => r.id !== line.id).map((r) => r.resource),
            );
            const options = RAW_RESOURCE_OPTIONS.filter(
              (id) => id === line.resource || !takenByOthers.has(id),
            );
            return (
              <div key={line.id} className="flex gap-2">
                <select
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  value={line.resource}
                  onChange={(e) => updateRawLine(line.id, { resource: e.target.value })}
                >
                  {options.map((id) => (
                    <option key={id} value={id}>
                      {resourceLabel(id)}
                    </option>
                  ))}
                </select>
                <div className="relative shrink-0">
                  <RateInput
                    aria-label={`${resourceLabel(line.resource)} items per minute`}
                    className="w-[6.5rem] rounded border border-slate-700 bg-slate-900 py-1.5 pr-9 pl-2 text-sm"
                    value={line.itemsPerMinute}
                    onChange={(n) => updateRawLine(line.id, { itemsPerMinute: n })}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-500">
                    /min
                  </span>
                </div>
                <button
                  type="button"
                  className="rounded border border-slate-700 px-2 text-slate-400 hover:bg-slate-800"
                  onClick={() => removeRawLine(line.id)}
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="text-sm text-sky-400 hover:text-sky-300 disabled:cursor-not-allowed disabled:text-slate-600"
            onClick={addRawLine}
            disabled={rawDemand.length >= RAW_RESOURCE_OPTIONS.length}
          >
            + Add resource
          </button>
        </section>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-300">
              Products{" "}
              <span className="font-normal text-slate-500">
                (co-located · {craftable.length} factory products)
              </span>
            </h2>
            <CopyHashButton state={copyState} onClick={() => void copyPlanHash()} />
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Add multiple outputs — intermediate demand stacks (e.g. Pipe + Beam + Steel Ingot 200
            all share ore/coal for total ingots).
          </p>
          {productTargets.map((line) => (
            <div key={line.id} className="flex gap-2">
              <select
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                size={1}
                value={line.productId}
                onChange={(e) => updateProductLine(line.id, { productId: e.target.value })}
              >
                {craftable.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
              <div className="relative shrink-0">
                <RateInput
                  aria-label="Product items per minute"
                  className="w-[6.5rem] rounded border border-slate-700 bg-slate-900 py-1.5 pr-9 pl-2 text-sm"
                  value={line.itemsPerMinute}
                  onChange={(n) => updateProductLine(line.id, { itemsPerMinute: n })}
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-500">
                  /min
                </span>
              </div>
              <button
                type="button"
                className="rounded border border-slate-700 px-2 text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                onClick={() => removeProductLine(line.id)}
                disabled={productTargets.length <= 1}
                aria-label="Remove product"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-sky-400 hover:text-sky-300"
            onClick={addProductLine}
          >
            + Add product
          </button>
        </section>
      )}

      {mode === "product" && expansionRows.length > 0 && (
        <section className="rounded-lg border border-slate-800">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-900/80"
            onClick={() => setExpansionOpen(!expansionOpen)}
            aria-expanded={expansionOpen}
          >
            <span className="font-medium">
              Expansion
              <span className="ml-2 font-normal text-slate-500">
                {expansionRows.length} item{expansionRows.length === 1 ? "" : "s"}
                {externalItems.length > 0
                  ? ` · ${expansionRows.filter((r) => externalItems.includes(r.itemId)).length} off-site`
                  : ""}
              </span>
            </span>
            <span className="text-slate-500">{expansionOpen ? "▾" : "▸"}</span>
          </button>
          {expansionOpen && (
            <div className="space-y-2 border-t border-slate-800 px-3 py-3">
              <p className="text-[11px] leading-snug text-slate-500">
                Mark anything you import as <span className="text-slate-400">off-site</span> so it
                doesn’t pull into the heatmap (e.g. Empty Canisters recycled elsewhere, Modular
                Frames from another factory, or <span className="text-slate-400">Water</span> piped
                in from off-site extractors).
              </p>
              <ul className="space-y-1.5 text-sm">
                {expansionRows.map((row) => {
                  const isTarget = productTargets.some((t) => t.productId === row.itemId);
                  const offSite = externalItems.includes(row.itemId);
                  const label = resourceLabel(row.itemId, items);
                  return (
                    <li
                      key={row.itemId}
                      className={`flex items-center justify-between gap-2 ${
                        offSite ? "text-slate-500" : "text-slate-200"
                      }`}
                    >
                      <span
                        className={`min-w-0 truncate ${offSite ? "line-through decoration-slate-600" : ""}`}
                      >
                        {label}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={`font-mono text-xs ${offSite ? "text-slate-500" : "text-slate-300"}`}
                        >
                          {formatRate(row.itemsPerMinute)}/min
                        </span>
                        {isTarget ? (
                          <span className="w-[4.5rem] text-right text-[10px] text-slate-600">
                            target
                          </span>
                        ) : (
                          <label className="flex w-[4.5rem] cursor-pointer items-center justify-end gap-1 text-[10px] text-slate-400">
                            <input
                              type="checkbox"
                              className="rounded border-slate-600"
                              checked={offSite}
                              onChange={(e) => setItemExternal(row.itemId, e.target.checked)}
                            />
                            <span>Off-site</span>
                          </label>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Only useful when products expand to raw — raw mode already shows the same lines */}
      {mode === "product" && (
        <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-300">Active raw demand</h2>
            {activeDemand.length > 0 && (
              <button
                type="button"
                className="text-[11px] text-amber-400 hover:text-amber-300"
                onClick={sendProductsToRaw}
              >
                Send to Raw →
              </button>
            )}
          </div>
          {activeDemand.length === 0 ? (
            <p className="text-xs text-slate-500">None yet — heat waits for demand.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {activeDemand.map((d) => (
                <li key={d.resource} className="flex justify-between gap-2">
                  <span>{resourceLabel(d.resource, items)}</span>
                  <span className="font-mono text-slate-300">
                    {formatRate(d.itemsPerMinute)}/min
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Clustering — site balance, pins, peak emphasis (above heat paint) */}
      <section className="rounded-lg border border-slate-800">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-900/80"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          aria-expanded={advancedOpen}
        >
          <span className="font-medium">Clustering</span>
          <span className="text-slate-500">{advancedOpen ? "▾" : "▸"}</span>
        </button>
        {advancedOpen && (
          <div className="space-y-3 border-t border-slate-800 px-3 py-3">
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Centered / Weighted
                  <InfoTip text="Centered: each resource counts equally — prefers multi-resource midpoints (e.g. a little sulfur with lots of oil/coal). Sliding right softens that equal-resource push, then switches to Weighted: haul cost scales with rate × distance so high-throughput feeds dominate." />
                </span>
                <span className="font-mono text-slate-300">
                  {scoringMode === "weighted"
                    ? "Weighted"
                    : `Centered · ${scoringOptions.centerPower.toFixed(2)}`}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={BALANCE_WEIGHTED}
                step={1}
                className="w-full"
                value={balanceFromState(scoringMode, scoringOptions.centerPower)}
                onChange={(e) => {
                  const next = balanceToMode(Number(e.target.value));
                  setScoringMode(next.mode);
                  if (next.centerPower != null) {
                    setScoringOptions({ centerPower: next.centerPower });
                  }
                }}
              />
              <span className="flex justify-between text-[10px] text-slate-600">
                <span>Centered</span>
                <span>Weighted</span>
              </span>
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Top sites
                  <InfoTip text="How many hotspot pins to place. Separation may yield fewer if Site spread is wide." />
                </span>
                <span className="font-mono text-slate-300">{scoringOptions.topN}</span>
              </span>
              <input
                type="range"
                min={3}
                max={10}
                step={1}
                className="w-full"
                value={scoringOptions.topN}
                onChange={(e) => setScoringOptions({ topN: Number(e.target.value) })}
              />
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Site spread
                  <InfoTip text="Minimum gap between hotspot pins, as % of map diagonal. Wider forces pins farther apart and may show fewer than Top sites — it never squeezes them together to fill the list." />
                </span>
                <span className="font-mono text-slate-300">
                  {(scoringOptions.siteSepFraction * 100).toFixed(0)}% diag
                </span>
              </span>
              <input
                type="range"
                min={0.04}
                max={0.4}
                step={0.02}
                className="w-full"
                value={scoringOptions.siteSepFraction}
                onChange={(e) => setScoringOptions({ siteSepFraction: Number(e.target.value) })}
              />
              <span className="flex justify-between text-[10px] text-slate-600">
                <span>Clustered</span>
                <span>Map-wide</span>
              </span>
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Peak emphasis
                  <InfoTip text="How exclusive the heat field is (recomputes). Primary control for map sparseness — kills mid-map so only strong hubs remain. Heat settings only color what’s left. Lower = more secondary hubs; higher = narrow peaks only." />
                </span>
                <span className="font-mono text-slate-300">
                  {scoringOptions.heatContrast.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                min={1.1}
                max={3.2}
                step={0.05}
                className="w-full"
                value={scoringOptions.heatContrast}
                onChange={(e) => setScoringOptions({ heatContrast: Number(e.target.value) })}
              />
              <span className="flex justify-between text-[10px] text-slate-600">
                <span>More hubs</span>
                <span>Peaks only</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={scoringOptions.includeElevation}
                onChange={(e) => setScoringOptions({ includeElevation: e.target.checked })}
              />
              <span>
                <span className="inline-flex items-center gap-1 font-medium text-slate-300">
                  Elevation in distance
                  <InfoTip text="On (default): distance includes elevation. Factory height is the median Z of assigned nodes — a high plateau is free; cliffs between hub and node stretch the route. Off: plan-view XY only (same as older builds)." />
                </span>
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  {scoringOptions.includeElevation
                    ? "3D · cliffs cost real distance"
                    : "2D · vertical ignored"}
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={showNodes}
                onChange={(e) => setShowNodes(e.target.checked)}
              />
              Show demand nodes
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={resetKnobs}
                className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Reset knobs
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Reset extractors, site preference, and all knobs? Your products and raw inputs are kept.",
                    )
                  ) {
                    resetAllDefaults();
                  }
                }}
                className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Reset all defaults
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Heat settings — display only, localStorage, not URL hash */}
      <section className="rounded-lg border border-slate-800">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-900/80"
          onClick={() => setHeatPaintOpen(!heatPaintOpen)}
          aria-expanded={heatPaintOpen}
        >
          <span className="font-medium">Heat settings</span>
          <span className="text-slate-500">{heatPaintOpen ? "▾" : "▸"}</span>
        </button>
        {heatPaintOpen && (
          <div className="space-y-3 border-t border-slate-800 px-3 py-3">
            <p className="text-[11px] leading-snug text-slate-500">
              Color and opacity of heat that already passed Peak emphasis (under Clustering). Does
              not change rankings or pins. Saved in this browser — not in the share URL.
            </p>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Elev. dash threshold
                  <InfoTip text="Haul lines only (display). Left = dash on any elevation difference. Sliding right raises the bar (only larger Δz dashes). Far right = Off (never dash for elevation). Cave-flagged nodes always dash (lilac)." />
                </span>
                <span className="font-mono text-slate-300">
                  {heatRender.elevDashThresholdCm < 0
                    ? "Off"
                    : heatRender.elevDashThresholdCm === 0
                      ? "Any Δz"
                      : `${(heatRender.elevDashThresholdCm / 100).toFixed(0)} m`}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={ELEV_DASH_SLIDER_OFF_M}
                step={5}
                className="w-full"
                // Left 0 m (any Δz) → 150 m (harder) → Off
                value={elevDashThresholdToSliderM(heatRender.elevDashThresholdCm)}
                onChange={(e) =>
                  setHeatRender({
                    elevDashThresholdCm: elevDashSliderMToThresholdCm(Number(e.target.value)),
                  })
                }
              />
              <span className="flex justify-between text-[10px] text-slate-600">
                <span>0 · any Δz</span>
                <span>Off</span>
              </span>
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Fade start
                  <InfoTip text="Normalized heat ≤ this is fully clear. Raise to kill more fringe between hubs (max 0.85)." />
                </span>
                <span className="font-mono text-slate-300">{heatRender.fadeDead.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={0.85}
                step={0.01}
                className="w-full"
                value={heatRender.fadeDead}
                onChange={(e) => setHeatRender({ fadeDead: Number(e.target.value) })}
              />
              <span className="flex justify-between text-[10px] text-slate-600">
                <span>More map</span>
                <span>Fringe dies</span>
              </span>
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Fade end
                  <InfoTip text="Heat ≥ this is full paint opacity. Higher softens edges; lower makes solid cores." />
                </span>
                <span className="font-mono text-slate-300">{heatRender.fadeFull.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0.35}
                max={1}
                step={0.01}
                className="w-full"
                value={heatRender.fadeFull}
                onChange={(e) => setHeatRender({ fadeFull: Number(e.target.value) })}
              />
              <span className="flex justify-between text-[10px] text-slate-600">
                <span>Solid cores</span>
                <span>Soft edges</span>
              </span>
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Fade ease
                  <InfoTip text="Shape of the opacity ramp. Higher fills each hotspot body more." />
                </span>
                <span className="font-mono text-slate-300">{heatRender.fadeEase.toFixed(1)}</span>
              </span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                className="w-full"
                value={heatRender.fadeEase}
                onChange={(e) => setHeatRender({ fadeEase: Number(e.target.value) })}
              />
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Max alpha
                  <InfoTip text="Peak strength of the heat raster (before overlay opacity)." />
                </span>
                <span className="font-mono text-slate-300">{heatRender.maxAlpha.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.02}
                className="w-full"
                value={heatRender.maxAlpha}
                onChange={(e) => setHeatRender({ maxAlpha: Number(e.target.value) })}
              />
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Overlay opacity
                  <InfoTip text="Global strength of the heat layer on the map." />
                </span>
                <span className="font-mono text-slate-300">{heatOpacity.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                className="w-full"
                value={heatOpacity}
                onChange={(e) => setHeatOpacity(Number(e.target.value))}
              />
            </label>
            <div className="border-t border-slate-800 pt-2 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
              Color · green → yellow body → orange core
            </div>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Green band
                  <InfoTip text="How far soft green/lime holds before yellow. Higher = longer cool falloff." />
                </span>
                <span className="font-mono text-slate-300">{heatRender.stopYellow.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0.08}
                max={0.6}
                step={0.01}
                className="w-full"
                value={heatRender.stopYellow}
                onChange={(e) => setHeatRender({ stopYellow: Number(e.target.value) })}
              />
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Yellow band
                  <InfoTip text="Where yellow gives way toward orange. Higher = more yellow body, orange only near the peak." />
                </span>
                <span className="font-mono text-slate-300">{heatRender.stopOrange.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0.25}
                max={0.95}
                step={0.01}
                className="w-full"
                value={heatRender.stopOrange}
                onChange={(e) => setHeatRender({ stopOrange: Number(e.target.value) })}
              />
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  Into orange peak
                  <InfoTip text="Where the ramp hits the orange hotspot core. Keep high (~0.97) for narrow orange tips." />
                </span>
                <span className="font-mono text-slate-300">{heatRender.stopRed.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0.5}
                max={0.99}
                step={0.01}
                className="w-full"
                value={heatRender.stopRed}
                onChange={(e) => setHeatRender({ stopRed: Number(e.target.value) })}
              />
            </label>
            <p className="font-mono text-[10px] text-slate-600">
              {formatHeatRenderCode(heatRender)}
            </p>
            <button
              type="button"
              onClick={() => {
                setHeatRender({ ...DEFAULT_HEAT_RENDER });
                setHeatOpacity(DEFAULT_HEAT_OPACITY);
              }}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              Reset heat defaults
            </button>
          </div>
        )}
      </section>

      {/* Extractors accordion — default closed; Mk2@250%, water 250%, wells on@250% */}
      <section className="rounded-lg border border-slate-800">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-900/80"
          onClick={() => setExtractorsOpen(!extractorsOpen)}
          aria-expanded={extractorsOpen}
        >
          <span>
            <span className="font-medium">Extractors</span>
            <span className="ml-2 text-xs text-slate-500">
              Mk.{miner.minerMk}@{miner.clockPercent}% · Oil {miner.oilClockPercent}% · Water{" "}
              {miner.waterClockPercent}% · Wells{" "}
              {miner.resourceWellsEnabled || wellsRequiredForPlan
                ? `${miner.wellClockPercent}%`
                : "off"}
            </span>
          </span>
          <span className="text-slate-500">{extractorsOpen ? "▾" : "▸"}</span>
        </button>
        {extractorsOpen && (
          <div className="space-y-3 border-t border-slate-800 px-3 py-3">
            <ClockPercentSlider
              label={
                <>
                  <span className="text-slate-400">Miner</span>
                  <MinerMkGroup
                    value={miner.minerMk}
                    onChange={(mk) => setMiner({ minerMk: mk })}
                  />
                </>
              }
              value={miner.clockPercent}
              onChange={(n) => setMiner({ clockPercent: n })}
              aria-label="Miner clock percent"
              rateLabel={(c) => minerClockRateLabel(miner.minerMk, c)}
            />

            <ClockPercentSlider
              label={<span className="text-slate-400">Oil Extractor</span>}
              value={miner.oilClockPercent}
              onChange={(n) => setMiner({ oilClockPercent: n })}
              aria-label="Oil Extractor clock percent"
              rateLabel={oilClockRateLabel}
            />

            <ClockPercentSlider
              label={<span className="text-slate-400">Water Extractor</span>}
              value={miner.waterClockPercent}
              onChange={(n) => setMiner({ waterClockPercent: n })}
              aria-label="Water Extractor clock percent"
              rateLabel={waterClockRateLabel}
            />

            {miner.resourceWellsEnabled || wellsRequiredForPlan ? (
              <ClockPercentSlider
                label={
                  <>
                    <input
                      type="checkbox"
                      className="disabled:opacity-60"
                      checked
                      disabled={wellsRequiredForPlan}
                      onChange={(e) => {
                        if (wellsRequiredForPlan) return;
                        setMiner({ resourceWellsEnabled: e.target.checked });
                      }}
                      aria-label="Pressurized Resource Wells"
                    />
                    <span className="text-slate-400">Resource wells</span>
                    <InfoTip text="Tier 8 pressurizer + extractors on oil, water, and nitrogen satellites. Open water still supplies Water when this is off. Nitrogen has no other map source." />
                    {wellsRequiredForPlan && (
                      <span className="truncate text-[10px] font-normal text-amber-400/90">
                        — Required for{" "}
                        {wellOnlyInDemand.map((d) => resourceLabel(d.resource, items)).join(", ")}
                      </span>
                    )}
                  </>
                }
                value={miner.wellClockPercent}
                onChange={(n) => setMiner({ wellClockPercent: n })}
                aria-label="Resource Well Pressurizer clock percent"
                rateLabel={wellClockRateLabel}
              />
            ) : (
              <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={(e) => setMiner({ resourceWellsEnabled: e.target.checked })}
                    aria-label="Pressurized Resource Wells"
                  />
                  <span>Resource wells</span>
                  <InfoTip text="Tier 8 pressurizer + extractors on oil, water, and nitrogen satellites. Open water still supplies Water when this is off. Nitrogen has no other map source." />
                </span>
                <span className="shrink-0 font-mono text-slate-500">off</span>
              </div>
            )}
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!miner.resourceWellsEnabled &&
        !wellsRequiredForPlan &&
        waterInDemand &&
        openWaterBodyCount === 0 && (
          <section className="space-y-1 rounded-lg border border-amber-800/50 bg-amber-950/30 p-3">
            <h2 className="text-sm font-medium text-amber-200">No open-water map data</h2>
            <p className="text-[11px] leading-snug text-amber-100/85">
              Wells are off and open-water bodies did not load, so Water has no capacity on the map.
              Run <span className="font-mono text-amber-100">npm run map:generate</span> (or ensure{" "}
              <span className="font-mono text-amber-100">public/data/water/open-water.json</span> is
              present) and reload.
            </p>
          </section>
        )}

      {heatmap && heatmap.topSites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">
            Top sites{" "}
            <span className="font-normal text-slate-500">({heatmap.topSites.length})</span>
          </h2>
          <p className="text-[11px] leading-snug text-slate-500">
            Hotspot pins are tagged from your rates vs nearby extract capacity:{" "}
            <span className="text-emerald-400">OK</span>,{" "}
            <span className="text-amber-400">Limited</span> (thin local supply), or{" "}
            <span className="text-sky-400">Abundant</span> (lots of spare nearby — maybe leave for a
            bigger plant). Ranking prefers sites that fully meet demand, so shortfall pins only show
            if the plan can’t be fully fed anywhere useful on the map.
          </p>
          <ul className="space-y-1">
            {heatmap.topSites.map((site, i) => {
              const rank = i + 1;
              const siteKey = `${Math.round(site.x)}:${Math.round(site.y)}:${site.score.toFixed(6)}`;
              return (
                <li key={siteKey}>
                  <button
                    type="button"
                    onClick={() => setSelectedSiteIndex(i)}
                    className={`w-full rounded border px-2 py-1.5 text-left text-sm ${
                      selectedSiteIndex === i
                        ? "border-amber-500 bg-slate-800"
                        : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                    }`}
                  >
                    <span className="font-medium">#{rank}</span> {(() => {
                      const cap = capacityLabel(site.capacityTag, site.satisfiable);
                      return <span className={cap.className}>{cap.text}</span>;
                    })()}
                    <span className="block text-xs text-slate-500">
                      <span className="font-mono">
                        ({Math.round(site.x)}, {Math.round(site.y)})
                      </span>
                      {(() => {
                        const supply = siteSupplySummary(site, items);
                        return supply ? <span> · {supply}</span> : null;
                      })()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {selected && (
        <section className="space-y-2 rounded-lg border border-slate-800 p-3 text-xs">
          <h3 className="text-sm font-medium text-slate-300">Selected site breakdown</h3>
          {selected.capacityTag === "shortfall" && (
            <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] leading-snug text-red-200">
              <span className="font-semibold">Shortfall</span> — this site cannot fully meet the
              plan.
              {selected.byResource.some((r) => r.shortfall > 1e-3) && (
                <>
                  {" "}
                  Unmet:{" "}
                  {selected.byResource
                    .filter((r) => r.shortfall > 1e-3)
                    .map((r) => resourceLabel(r.resource, items))
                    .join(", ")}
                  .
                </>
              )}
              {selected.byResource.some(
                (r) => r.resource === WATER_RESOURCE_ID && r.shortfall <= 1e-3 && r.supplied > 0,
              ) &&
                selected.byResource.some((r) => r.shortfall > 1e-3) && (
                  <span className="mt-1 block text-red-100/80">
                    Water may still show haul lines (open water is fine); another raw is the
                    bottleneck.
                  </span>
                )}
            </p>
          )}
          {selected.capacityTag === "limited" && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
              <span className="font-semibold">Limited</span> — this hotspot meets your rates, but
              nearby extract capacity is nearly maxed. Growth here means longer hauls or another
              biome.
            </p>
          )}
          {selected.capacityTag === "abundant" && (
            <p className="rounded border border-sky-500/25 bg-sky-500/10 px-2 py-1.5 text-[11px] leading-snug text-sky-200">
              <span className="font-semibold">Abundant</span> — your plan fits easily; local nodes
              could feed a much larger factory. Consider a thinner site if you want to save this
              hub.
            </p>
          )}
          {selected.byResource.map((ra) => {
            const cap = selected.capacityByResource?.find((c) => c.resource === ra.resource);
            const utilPct =
              cap && Number.isFinite(cap.utilization) ? Math.min(999, cap.utilization * 100) : null;
            const isOpenWaterAssign = ra.nodes.some((n) => n.nodeId.startsWith("ow_"));
            const wellOnly =
              !miner.resourceWellsEnabled && WELL_ONLY_RESOURCE_IDS.includes(ra.resource);
            return (
              <div key={ra.resource} className="border-t border-slate-800 pt-2">
                <div className="flex justify-between font-medium">
                  <span>{resourceLabel(ra.resource, items)}</span>
                  <span>
                    {formatRate(ra.supplied)}/{formatRate(ra.demanded)}
                    {ra.shortfall > 0 && (
                      <span className="text-red-400"> (−{formatRate(ra.shortfall)})</span>
                    )}
                  </span>
                </div>
                {wellOnly && ra.shortfall > 0 && (
                  <p className="mt-0.5 text-[11px] text-amber-300/90">
                    Wells-only resource — enable Pressurized Resource Wells to supply this.
                  </p>
                )}
                {cap && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Nearby supply ~{formatRate(cap.localCapacity)}/min
                    {utilPct != null &&
                      (utilPct > 100
                        ? ` · plan needs ${utilPct.toFixed(0)}% of that`
                        : ` · plan uses ${utilPct.toFixed(0)}%`)}
                    {cap.spare > 0 && ` · spare ${formatRate(cap.spare)}/min`}
                    {cap.localCapacity <= 1e-9 &&
                      ra.demanded > 0 &&
                      " · no extractors in local radius"}
                  </p>
                )}
                <ul className="mt-1 text-slate-500">
                  {ra.nodes.map((n) => (
                    <li key={n.nodeId}>
                      {n.nodeId.startsWith("ow_") ? "open water" : n.purity} ·{" "}
                      {formatRate(n.rateUsed)}/min · {(n.dist / 100).toFixed(0)} m
                      {n.caveRisk ? " · cave" : ""}
                      {selected.z != null && Math.abs(n.z - selected.z) >= 1
                        ? ` · Δz ${formatDistCm(Math.abs(n.z - selected.z))}`
                        : ""}
                    </li>
                  ))}
                  {ra.nodes.length === 0 && ra.demanded > 0 && (
                    <li className="text-red-400/90">no sources assigned</li>
                  )}
                </ul>
                {isOpenWaterAssign && ra.shortfall <= 1e-3 && (
                  <p className="mt-0.5 text-[10px] text-sky-500/80">
                    Supplied from open water (not wells)
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-800 pt-3 text-xs text-slate-500">
        <Attributions />
        <span className="text-slate-700" aria-hidden>
          ·
        </span>
        <a
          href="https://github.com/TylerR909/satisfactory-heat-map"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
        >
          GitHub
        </a>
        <span className="text-slate-700" aria-hidden>
          ·
        </span>
        <a
          href="https://github.com/TylerR909/satisfactory-heat-map/issues/new?template=bug_report.yml"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
        >
          Report an issue
        </a>
        <span className="text-slate-700" aria-hidden>
          ·
        </span>
        <a
          href="https://buymeacoffee.com/tylerr909"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
        >
          Buy me a coffee
        </a>
      </section>
    </aside>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-1.5 text-sm ${
        active
          ? "bg-slate-100 font-medium text-slate-900"
          : "bg-slate-900 text-slate-400 ring-1 ring-slate-700 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function CopyHashButton({
  state,
  onClick,
}: {
  state: "idle" | "copied" | "failed";
  onClick: () => void;
}) {
  const label = state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy";
  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy plan hash to clipboard"
      className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-slate-500 hover:bg-slate-800 hover:text-slate-200"
    >
      {label}
    </button>
  );
}

const TIP_WIDTH = 224; // w-56
const TIP_PAD = 8;

function fmtMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : ms.toFixed(0);
}

/**
 * Score wall-time badge (worker hierarchical total). Hover shows stage breakdown
 * plus main-thread rasterize (not included in the badge sum).
 */
function HeatmapTimingBadge({
  heatmap,
  rasterizeMs,
}: {
  heatmap: HeatmapResult;
  rasterizeMs: number | null;
}) {
  const { elapsedMs, timings } = heatmap;
  const t = timings;
  return (
    <span className="group relative shrink-0">
      <span className="cursor-default rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        {elapsedMs.toFixed(0)} ms
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 hidden w-[11.5rem] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-[10px] font-normal text-slate-300 shadow-lg group-hover:block"
      >
        <div className="mb-1.5 flex justify-between gap-3 font-medium text-emerald-300">
          <span>Score</span>
          <span className="tabular-nums">{fmtMs(elapsedMs)} ms</span>
        </div>
        <ul className="space-y-0.5 text-slate-400">
          <li className="flex justify-between gap-3">
            <span>Prepare</span>
            <span className="tabular-nums text-slate-300">{fmtMs(t.prepareMs)}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span>Coarse grid</span>
            <span className="tabular-nums text-slate-300">{fmtMs(t.coarseMs)}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span>Refine</span>
            <span className="tabular-nums text-slate-300">{fmtMs(t.refineMs)}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span>Top sites</span>
            <span className="tabular-nums text-slate-300">{fmtMs(t.topSitesMs)}</span>
          </li>
        </ul>
        {rasterizeMs != null && (
          <>
            <div className="my-1.5 border-t border-slate-700" />
            <div className="flex justify-between gap-3 text-slate-500">
              <span>Rasterize</span>
              <span className="tabular-nums">{fmtMs(rasterizeMs)} ms</span>
            </div>
            <p className="mt-1 text-[9px] leading-snug text-slate-600">
              Rasterize is main-thread paint, not in the badge total.
            </p>
          </>
        )}
      </span>
    </span>
  );
}

type TipPos = { left: number; top: number; place: "above" | "below" };

/**
 * Fixed-position tooltip via portal (avoids panel overflow clipping).
 * Clamped to the viewport so tips near the left/right/top edges stay on-screen.
 * Place next to the label it explains (not floated to the far right of a segment).
 */
function InfoTip({ text, onLight = false }: { text: string; onLight?: boolean }) {
  const tipId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<TipPos | null>(null);

  function show(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer centered on the icon, then clamp so the box stays in view
    let left = r.left + r.width / 2;
    const half = TIP_WIDTH / 2;
    left = Math.min(vw - TIP_PAD - half, Math.max(TIP_PAD + half, left));

    // Prefer above; flip below if not enough room (height measured next frame)
    const place: "above" | "below" = r.top < 96 ? "below" : "above";
    const top = place === "above" ? r.top - TIP_PAD : r.bottom + TIP_PAD;
    setPos({ left, top, place });

    // Refine after paint with real tip height / width
    requestAnimationFrame(() => {
      const tip = tipRef.current;
      if (!tip) return;
      const tr = tip.getBoundingClientRect();
      let nextLeft = r.left + r.width / 2;
      nextLeft = Math.min(vw - TIP_PAD - tr.width / 2, Math.max(TIP_PAD + tr.width / 2, nextLeft));
      let nextPlace = place;
      let nextTop = top;
      if (place === "above" && r.top - TIP_PAD - tr.height < TIP_PAD) {
        nextPlace = "below";
        nextTop = r.bottom + TIP_PAD;
      } else if (place === "below" && r.bottom + TIP_PAD + tr.height > vh - TIP_PAD) {
        nextPlace = "above";
        nextTop = r.top - TIP_PAD;
      }
      setPos({ left: nextLeft, top: nextTop, place: nextPlace });
    });
  }

  function hide() {
    setPos(null);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border text-[9px] leading-none ${
          onLight
            ? "border-slate-800/45 text-slate-800/80 hover:border-slate-900 hover:text-slate-950"
            : "border-slate-500 text-slate-400 hover:border-slate-300 hover:text-slate-200"
        }`}
        aria-describedby={pos ? tipId : undefined}
        aria-label="More info"
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (pos) hide();
          else show(e.currentTarget);
        }}
      >
        i
      </button>
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="pointer-events-none fixed z-[10000] w-56 rounded-md border border-slate-600 bg-slate-900 px-2.5 py-2 text-left text-[11px] leading-snug text-slate-200 shadow-xl"
            style={{
              left: pos.left,
              top: pos.top,
              transform: pos.place === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              maxWidth: `min(${TIP_WIDTH}px, calc(100vw - ${TIP_PAD * 2}px))`,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
