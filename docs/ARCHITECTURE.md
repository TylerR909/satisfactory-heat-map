# Architecture

## High-level

```
┌────────────────────────────────────────────────────────────────────┐
│  React 19 + TS + Vite  ·  React Compiler  ·  PWA                   │
│  ┌─────────────────────┐  ┌───────────────────┐  ┌──────────────┐  │
│  │ Mode A: raw rates   │  │ Leaflet map       │  │ Zustand      │  │
│  │ Mode B: products[]  │──│ tiles · heat ★    │  │ persist v4   │  │
│  │ → RawDemand[]       │  │ nodes · pins      │  └──────┬───────┘  │
│  │ Extractors · knobs  │  └────────▲──────────┘         │          │
│  │ Centered/Weighted   │           │                    │          │
│  │ Capacity tags infer │           │                    │          │
│  └──────────┬──────────┘           │                    │          │
│             └──────────► Web Worker (TS engine) ◄───────┘          │
│                          exact demand + hierarchical score         │
└────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  CF Workers (static assets)     Docker: build → nginx:dist
  (npm run build)                (not vite preview in container)
```

## Key modules (`src/`)

| Path | Role |
|------|------|
| `types/` | Domain types (`ResourceNode`, `RawDemand`, `CapacityTag`, `HeatmapResult`, knobs, …) |
| `lib/mining.ts` | Purity + miner Mk + oil/water/well/deposit rate tables |
| `lib/coords.ts` | Game cm ↔ Leaflet CRS.Simple (rockfactory-compatible; no tile Y flip) |
| `lib/production/solve.ts` | Mode B: multi-product → stacked raw demand (default recipes + optional externalItems prune) |
| `lib/heatmap/score.ts` | Capacity greedy assignment, haul combine, adaptive scale, display norm |
| `lib/heatmap/hierarchical.ts` | Coarse grid → refine seeds → diverse top-N + Limited flags |
| `lib/heatmap/rasterize.ts` | Grid → PNG data URL for `ImageOverlay` |
| `lib/engine.ts` | Engine façade (`createEngine()`); TS now, WASM later |
| `workers/heatmap.worker.ts` | Off-main-thread scoring |
| `hooks/useAutoHeatmap.ts` | Debounced live recompute from store deps |
| `hooks/useHeatmapWorker.ts` | Worker client |
| `lib/seed/*` | Konsl MIT node randomization port + seed→nodes cache |
| `lib/savedSeeds.ts` | Named saved-seed library (map seed + plan shelf) |
| `store/useAppStore.ts` | Mode, demand, products, knobs, `seed` / `baseSlots` / `nodes`, heatmap, persist |
| `components/map/*` | Leaflet layers, panes, fit-world |
| `components/planner/*` | Side panel, Seed popover, saved plans |

## Data flow

1. User edits **Mode A** lines or **Mode B** product targets (multi-product stacks) and optional **off-site** intermediates.
2. Store derives **`activeDemand: RawDemand[]`** (Mode B via `solveProductsToRaw` + `externalItems`) and **`expansionRows`** for the Expansion UI.
3. **`useAutoHeatmap`** (debounced) posts `ScoreGridInput` to the worker whenever demand, miner, scoring mode, or knobs change.
4. Worker runs `createEngine().scoreGrid(input)` → `HeatmapResult` (grid + topSites with capacity tags).
5. Map paints heat via `ImageOverlay` from the coarse grid; pins/lines from `topSites` / selection.

**Send to Raw:** expands current product targets into `rawDemand` lines and switches to Mode A.

## Scoring algorithm

### Capacity-aware assignment (per candidate point \(p\))

For each demanded resource \(r\) with rate \(D_r\):

1. Filter nodes of type \(r\); compute extract `rate(n)` from extractor settings.
2. Sort by horizontal Euclidean distance `dist_xy(p, n)`.
3. Greedily take capacity until demand met or nodes exhausted.
4. Shortfall → site **unsatisfiable** (capped partial score).
5. Else quality from **rate-invariant** haul distance (see below).

Assignment is **greedy nearest capacity** per resource (closest nodes until demand is met), not a score over every nearby node.

### Haul quality (rate-invariant)

Effective haul distance (cm) is combined across resources, then:

\[
\text{quality} = \frac{1}{1 + d / d_{\mathrm{ref}}}, \quad d_{\mathrm{ref}} \approx 1\,\mathrm{km}
\]

Doubling every demand rate does **not** change quality when the same nearest nodes still cover the plan. Large plans that must reach farther nodes still look worse. Soft cave/elevation notes add a small penalty.

### Scoring modes (`ScoringMode`)

| Mode | UI name | Effective haul |
|------|---------|----------------|
| `centered` | **Centered** | Lₚ mean of per-resource mean hauls (`centerPower`, default ~1.35) — equal resources, multi-resource midpoints |
| `weighted` | **Weighted** | Throughput-weighted mean distance (rate × dist) — high-throughput feeds dominate |

Legacy persisted values: `balanced` → centered, `volume` → weighted.

### Capacity tags (inferred on top sites)

Always score **exact demand**. After top-N pick, `annotateSiteCapacity`:

1. For each demanded resource, sum extract rates of nodes within **`LOCAL_CAPACITY_RADIUS_CM`** (~1.5 km) of the site.
2. Utilization \(U_r = D_r / C_{\mathrm{local},r}\); bottleneck \(U^* = \max U_r\).
3. Tag:
   - **shortfall** if assignment unsatisfiable
   - **limited** if \(U^* \ge 0.75\)
   - **abundant** if \(U^* \le 0.30\) **and** each resource has absolute spare \(\ge \max(0.5 \times \text{pureRate}, 0.5 \times D_r)\)
   - **ok** otherwise

Site score fields: `capacityTag`, `maxUtilization`, `capacityByResource[]`.  
Heat paint does **not** change for tags (display-only annotation on pins/list).

### Hierarchical scan

1. Score **coarseCols × coarseRows** cell centers (default **64×64** from `meta.json`).
2. Diversify coarse seeds → subdivide each (**refineSubdiv**, default 8).
3. Pool refined + top coarse; **`pickDiverseSites`** forces top-N with separation that relaxes if needed (`siteSepFraction` of map diagonal).
4. Annotate top sites with capacity tags; normalize grid for **display only**.

User knobs (`ScoringOptions`): `centerPower`, `heatContrast`, `topN`, `siteSepFraction`.

### Distance & caves

- Primary distance: **X/Y** only (Unreal cm). Elevation **Z** is not haul distance.
- Large |Z| or `flags.cave` → soft penalty + UI notes.
- **No** navmesh / cave-entrance pathing.

### Extractor rates

See `src/lib/mining.ts` and `docs/DATA.md`. **Miner Mk only affects solid ores**; oil extractors, water extractors, and well satellites have their own purity/base tables. Clock % multiplies continuous extractors.

## Map rendering

### Coordinate system

- Game world: Unreal **centimeters**. **X, Y** horizontal; **Z** elevation.
- Leaflet **`L.CRS.Simple`** in 0…256 image space (community-calibrated).
- `worldToLeaflet` in `src/lib/coords.ts` maps game cm onto the self-hosted `/map/v1` pyramid.
- **Do not flip tile Y** in `TileLayer` — causes horizontal strip seams that worsen with zoom.
- Basemap: same-origin `/map/v1/` WebPs. CF/`npm run build` unpacks committed `map-tiles/v1.tar.gz` (`map:ensure`); Docker multi-stage still GDAL-generates from wiki.

Approximate bounds (`meta.worldBounds`):

- X ≈ -324700 … 425300  
- Y ≈ -375000 … 375000  

### Layer stack (bottom → top)

1. **Basemap** — self-hosted XYZ WebP tiles (`tilePane` ~200)
2. **Heatmap** `ImageOverlay` — `heatmapPane` 350
3. **Haul lines** — `haulLinePane` 400
4. **Demand nodes** — `nodePane` 520
5. **Site / hotspot pins** — `sitePinPane` 600
6. **Tooltips** — default `tooltipPane` 650

Panes are created **synchronously** before path layers attach (avoids Leaflet `_removePath` crashes).

### Heat display

- `normalizeScoresForDisplay`: peak-relative with contrast-driven floor (default `heatContrast` ~2.35) so only near-best cells go yellow.
- Does **not** change rankings or top sites.
- Opacity is a separate UI slider.

## Engine façade (WASM-ready)

```ts
interface HeatmapEngine {
  scoreGrid(input: ScoreGridInput): HeatmapResult;
}
// createEngine() → pure TS hierarchical scorer today
// later: WasmHeatmapEngine after Docker wasm-pack
```

UI never imports WASM directly; worker uses the façade.

## Performance expectations

| Rank | Bottleneck | Mitigation |
|------|------------|------------|
| 1 | Capacity scoring dense grid | Hierarchical scan; worker; diverse top-K seeds |
| 2 | Live recompute | Debounce (~160 ms); generation token drops stale results |
| 3 | Canvas/PNG bake | Once per result; Leaflet transforms the overlay |
| 4 | Many DOM markers | Filter to demanded resources |
| 5 | Basemap | Self-hosted WebP `/map/v1/`; pack for CF, GDAL for Docker |

64×64 + refine is typically **tens–hundreds of ms** in pure TS on full node data.

## Persistence & PWA

- Zustand `persist` → localStorage key **`sf-heatmap-v5`**: mode, raw lines, product targets, miner, scoring mode, knobs, UI prefs.
- Merge migrates legacy scoring mode names; ignores removed capacity-mode / scaleHeadroom fields.
- **URL plan hash** (`src/lib/planHash.ts`, `usePlanHash`): compact `#v1.<base64url(binary)>` — typically **~20–35 chars**. Binary packs flags, quantized knobs, and catalog-index demand lines for the **active mode only** (raw *or* products). Catalogs are append-only. On load, hash wins over localStorage after rehydrate. Writes use `history.replaceState` (debounced).
- **Reset knobs** → scoring options + heat opacity + show nodes.
- **Reset all defaults** → extractors, scoring mode, knobs — **keeps** mode, raw demand, and products.
- Export plan JSON from planner.
- `vite-plugin-pwa` precaches shell + JSON.

## Deploy

| Target | Mechanism |
|--------|-----------|
| **Website** (Cloudflare Workers static assets) | Git integration on `main`: `npm run build` → `npx wrangler deploy` (`wrangler.jsonc` → `./dist`, + `_headers`). See [DEPLOY.md](DEPLOY.md). |
| Home Docker | Multi-stage Dockerfile: Node 24 build → **nginx** serves `dist/` |
| Local dist smoke | `npm run build && npm run preview` (`vite preview`) — optional; prod is Workers or nginx |
