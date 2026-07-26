import { type ReactNode, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Attributions } from "@/components/Attributions";
import { SavedPlansBar } from "@/components/planner/SavedPlansBar";
import { useAutoHeatmap } from "@/hooks/useAutoHeatmap";
import { DEFAULT_HEAT_RENDER, formatHeatRenderCode } from "@/lib/heatmap/heatRender";
import { formatRate } from "@/lib/mining";
import { encodePlanHash } from "@/lib/planHash";
import { RAW_RESOURCE_OPTIONS, resourceLabel, WATER_RESOURCE_ID } from "@/lib/resources";
import { useAppStore } from "@/store/useAppStore";
import type { CapacityTag, MinerMk, ScoringMode } from "@/types";
import { DEFAULT_HEAT_OPACITY } from "@/types";

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
 */
function nearbySupplySummary(maxUtilization: number | undefined): string | null {
  if (maxUtilization == null || !Number.isFinite(maxUtilization)) return null;
  const pct = Math.min(999, Math.round(maxUtilization * 100));
  if (pct > 100) return `needs ${pct}% of nearby supply`;
  return `uses ${pct}% of nearby supply`;
}

/** Cap for rate fields (matches plan-hash u16). */
const RATE_INPUT_MAX = 65_535;

/**
 * Integer items/min field: empty while 0 (so clear + retype works),
 * digits only, leading zeros stripped via parseInt ("030" → 30).
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
  const display = value === 0 ? "" : String(value);

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      className={className}
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        if (digits === "") {
          onChange(0);
          return;
        }
        const n = Number.parseInt(digits, 10);
        if (!Number.isFinite(n)) return;
        onChange(Math.min(RATE_INPUT_MAX, n));
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
    activeDemand,
    items,
    computing,
    error,
    heatmap,
    heatOpacity,
    setHeatOpacity,
    showNodes,
    setShowNodes,
    omitWaterFromScoring,
    setOmitWaterFromScoring,
    selectedSiteIndex,
    setSelectedSiteIndex,
  } = useAppStore();

  const waterInDemand = activeDemand.some((d) => d.resource === WATER_RESOURCE_ID);
  const waterDemandRate =
    activeDemand.find((d) => d.resource === WATER_RESOURCE_ID)?.itemsPerMinute ?? 0;

  // Factory-automatable products only (see parse-docs: ItemDef.automatable)
  const craftable = Object.values(items)
    .filter((i) => !i.raw && i.automatable)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copyPlanHash() {
    const hash = encodePlanHash({
      mode,
      rawDemand,
      productTargets,
      miner,
      scoringMode,
      scoringOptions,
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
    <aside className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-r border-slate-800 bg-slate-950/95 p-4 text-slate-100">
      <header>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Satisfactory Factory Heatmap
          </h1>
          {computing && (
            <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              Updating…
            </span>
          )}
          {!computing && heatmap && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              {heatmap.elapsedMs.toFixed(0)} ms
            </span>
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

      {waterInDemand && (
        <section className="space-y-2 rounded-lg border border-sky-800/60 bg-sky-950/30 p-3">
          <h2 className="text-sm font-medium text-sky-200">Water data caveat</h2>
          <p className="text-[11px] leading-snug text-sky-100/80">
            Your plan needs{" "}
            <span className="font-mono text-sky-100">{formatRate(waterDemandRate)}/min</span> water.
            Node data only includes <strong>resource wells</strong> (late-game pressurizer +
            extractors) — not free placement of Water Extractors on coasts, lakes, or rivers. Heat
            and pins will pull toward those few wells and under-represent normal open-water sites.
          </p>
          <label className="flex items-start gap-2 text-xs text-sky-100/90">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={omitWaterFromScoring}
              onChange={(e) => setOmitWaterFromScoring(e.target.checked)}
            />
            <span>
              <span className="font-medium">Omit water from scoring</span>
              <span className="mt-0.5 block text-[11px] text-sky-200/70">
                Heatmap uses every other raw only. Place Water Extractors yourself on deep water
                near the hotspot. Wells remain on the map if “Show demand nodes” is on.
              </span>
            </span>
          </label>
          {omitWaterFromScoring && (
            <p className="text-[11px] text-sky-300/80">
              Scoring ignores water for now — hotspots reflect non-water resources only.
            </p>
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
              {activeDemand.map((d) => {
                const omittedWater = omitWaterFromScoring && d.resource === WATER_RESOURCE_ID;
                return (
                  <li
                    key={d.resource}
                    className={`flex justify-between gap-2 ${
                      omittedWater ? "text-slate-500 line-through decoration-slate-500" : ""
                    }`}
                  >
                    <span>{resourceLabel(d.resource, items)}</span>
                    <span
                      className={`font-mono ${omittedWater ? "text-slate-500" : "text-slate-300"}`}
                    >
                      {formatRate(d.itemsPerMinute)}/min
                    </span>
                  </li>
                );
              })}
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

      {/* Extractors accordion — default closed, Mk2@250% */}
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
              Miner Mk.{miner.minerMk} @ {miner.clockPercent}%
            </span>
          </span>
          <span className="text-slate-500">{extractorsOpen ? "▾" : "▸"}</span>
        </button>
        {extractorsOpen && (
          <div className="space-y-2 border-t border-slate-800 px-3 py-3">
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
                Miner (solids only)
                <select
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                  value={miner.minerMk}
                  onChange={(e) => setMiner({ minerMk: Number(e.target.value) as MinerMk })}
                >
                  <option value={1}>Mk.1 (60 base)</option>
                  <option value={2}>Mk.2 (120 base)</option>
                  <option value={3}>Mk.3 (240 base)</option>
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
                Clock %
                <input
                  type="number"
                  min={1}
                  max={250}
                  step={1}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                  value={miner.clockPercent}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) {
                      setMiner({ clockPercent: 100 });
                      return;
                    }
                    setMiner({ clockPercent: Math.min(250, Math.max(1, Math.round(n))) });
                  }}
                />
              </label>
            </div>
            <p className="text-[11px] leading-snug text-slate-500">
              Miner Mk: solid ores only. Oil extractors 60/120/240 by purity. Water extractors
              120/min. Well satellites 30/60/120. Clock % applies to all. Default assumes Mk.2 @
              250%.
            </p>
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}

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
                        const supply = nearbySupplySummary(site.maxUtilization);
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
                {cap && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Nearby nodes can supply ~{formatRate(cap.localCapacity)}/min
                    {utilPct != null &&
                      (utilPct > 100
                        ? ` · plan needs ${utilPct.toFixed(0)}% of that`
                        : ` · plan uses ${utilPct.toFixed(0)}%`)}
                    {cap.spare > 0 && ` · spare ${formatRate(cap.spare)}/min`}
                  </p>
                )}
                <ul className="mt-1 text-slate-500">
                  {ra.nodes.map((n) => (
                    <li key={n.nodeId}>
                      {n.purity} · {formatRate(n.rateUsed)}/min · {(n.dist / 100).toFixed(0)} m
                      {n.caveRisk ? " · elev risk" : ""}
                    </li>
                  ))}
                </ul>
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
