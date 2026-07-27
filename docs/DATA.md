# Data provenance & regeneration

## Policy

1. **Ship honest, attributed data** under `public/data/` and (later) `public/map/`.
2. **`public/scraped/`** documents temporary basemap CDN use — no SC-derived node blobs. Prefer never committing proprietary calculator assets.
3. **Do not** copy code or data from satisfactory-calculator.com (`en-Stable.json`, proprietary map tiles, etc.).
4. Prefer **MIT community extraction** (rockfactory) or **your own FModel export** for node slots.
5. Prefer **official Docs.json** for recipes when available.

## Shipped assets

| Path | Contents | Provenance |
|------|----------|------------|
| `public/data/nodes/default-nodes.json` | **626** resource nodes / deposits / wells / geysers | Bootstrap from [rockfactory/satisfactory-logistics](https://github.com/rockfactory/satisfactory-logistics) `WorldResourceNodes.json` (**MIT** — notice in `third_party/rockfactory-satisfactory-logistics.LICENSE`). Attribute & replace with own FModel extract when possible. |
| `public/data/recipes/items.json` | Compact item catalog (~194) | Derived from Coffee Stain Docs via `npm run parse-docs` |
| `public/data/recipes/recipes.json` | Factory recipes (~290: defaults + alts) | Same; **not** the 10MB Docs file |
| `public/data/recipes/docs-meta.json` | Parse stamp / counts | Generated; safe to commit |
| `public/data/meta.json` | Bounds, leaflet flags, basemap URL, heatmap grid defaults | Project-owned |
| `public/map/` | Reserved for self-hosted tiles later | Empty; runtime basemap is remote CDN |
| `public/scraped/README.md` | Temporary basemap provenance | No committed tile binaries |

## Node record shape

```json
{
  "id": "BP_ResourceNode122",
  "resource": "Desc_Coal_C",
  "purity": "normal",
  "classPath": "BP_ResourceNode_C",
  "nodeType": "node",
  "displayName": "Coal",
  "x": -99604,
  "y": -146823,
  "z": -1631,
  "rotation": 87.82
}
```

- Coordinates: Unreal **cm**.
- `nodeType`: `node` | `deposit` | `frackingCore` | `frackingSatellite` | `geyser`.
- Slot **positions** are fixed even under 1.2 randomization; seed only reassigns resource/purity (and well distributions).
- **Deposits** (`BP_ResourceDeposit_*`) are **not** in the shuffle pool (Konsl extracts only `BP_ResourceNode_C`); they stay vanilla under all seeds.
- **Seed algorithm:** TypeScript port of [Konsl/satisfactory-world-generator](https://github.com/Konsl/satisfactory-world-generator) MIT core (`src/lib/seed/`). Product policy: Default = `seed: null` (identity); any numeric seed uses in-game **Random** mode + **unchanged** purity. Full MIT notice: `third_party/konsl-satisfactory-world-generator.md`.

## Honest regeneration: resource nodes (FModel)

After a game update (adapt rockfactory’s workflow):

1. Install [FModel](https://fmodel.app); load Satisfactory (see [modding extract docs](https://docs.ficsit.app/satisfactory-modding/latest/Development/ExtractGameFiles.html)).
2. Open `FactoryGame/Content/FactoryGame/Map/GameLevel01/Persistent_Level.umap`.
3. Right-click → **Save Properties (.json)** (~100MB).
4. Place as `data/Persistent_Level.json` (gitignored raw dump).
5. Run extract script (to be adapted into `scripts/extract-world-nodes.ts` from rockfactory MIT sources):

   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run extract-world-nodes
   ```

6. Emits sorted `public/data/nodes/default-nodes.json`. Review diff; commit.

Actors of interest: `BP_ResourceNode_C`, `BP_ResourceDeposit_C`, `BP_FrackingCore_C`, `BP_FrackingSatellite_C`, `BP_ResourceNodeGeyser_C`.

## Honest regeneration: recipes / items (Docs.json)

1. From game install:  
   `…/Satisfactory/CommunityResources/Docs/en-US.json` (UTF-16, ~10MB).
2. Copy to `data/Docs/en-US.json` (**gitignored** — never commit full Docs).
3. `npm run parse-docs` → `scripts/parse-docs.mjs`  
   - Keeps recipes produced in **automated factory buildings** (constructor / assembler / smelter / manufacturer / …).  
   - Drops Equipment Workshop-only recipes (Hoverpack, Xeno-Zapper, …). Dual workshop+factory (e.g. Explosive Rebar) stay.  
   - Marks `alternate` from ClassName / display name.  
   - **Fluids/gases:** Docs amounts are milliliters (`1000` = 1 m³). Parser divides by 1000 so rates match the in-game UI (avoids 112 500 crude bugs on packaging chains).  
   - Items: raw map resources + recipe IO only. **`automatable: true`** = product of a default factory recipe → Products dropdown. World pickups (Power Slugs, Mercer Spheres), enemy drops (Hog Remains), and workshop-only gear never get `automatable`.  
   - Writes compact `items.json` + `recipes.json` (~150KB total, not 10MB).
4. Runtime loads **only** the compact files once at startup (same as nodes). Heat calcs never re-parse Docs.
5. **Mining/pumping rates** are incomplete in Docs — keep hard-coded tables in `src/lib/mining.ts`.

Docs ClassNames differ from some wiki nicknames (e.g. HMF → `Desc_ModularFrameHeavy_C`).  
`src/lib/productIdAliases.ts` maps old hand-curated ids on rehydrate.

### Rockfactory basemap CDN

Their **app / node JSON** is MIT. The **tile pyramid** on DigitalOcean is a convenience host for map **artwork** (Coffee Stain IP). Short-term hotlink for development is common and we attribute it, but:

- It is **not** a license to freeload their bandwidth forever.
- Prefer self-hosting tiles before public launch at scale.
- Do not scrape or re-host without respecting map art ownership.

## Map basemap

### Temporary (current)

Hot-linked WebP XYZ tiles from the public **satisfactory-logistics** CDN (same pyramid their MIT map view uses):

```
https://satisfactory-logistics-maps.fra1.cdn.digitaloceanspaces.com/map/v2/{z}/{x}/{y}.webp
```

- Config: `public/data/meta.json` → `basemap.tilesUrl`
- Coord math: `src/lib/coords.ts` — **same transform as rockfactory** so markers lock to their XYZ tiles.
- **Do not invert tile `y`** in `TileLayer` (causes strip seams on zoom).
- Provenance / replace steps: `public/scraped/README.md`

Map **artwork** is Coffee Stain IP; we only consume a community-hosted tile mirror for development until you host your own.

### Long-term (your extract)

1. Capture / FModel a square orthographic map PNG  
2. `gdal2tiles.py` → WebP pyramid (rockfactory’s `generate-map-tiles` script is a good template)  
3. Host under your CDN or `public/map/tiles/`  
4. Point `basemap.tilesUrl` at it; keep or re-tune world bounds if framing changes

## Randomization (1.2+) — later

- Slot positions from our node file.
- Assignment algorithm: Konsl **MIT** code (`src/*.rs`, `scripts/`) — port TS or Docker WASM.
- Inputs: seed, node randomization mode, purity settings.
- Viewer app under Konsl is **GPL** — only reuse MIT algorithm + extraction scripts, not the GPL UI, unless license is intentionally accepted for the whole project.

## Water (open extractors vs wells)

### What our node file actually has

| Kind | In `default-nodes.json`? | Count (shipped) | Notes |
|------|--------------------------|-----------------|-------|
| **Water resource wells** (fracking core + satellites) | Yes | 8 cores + 55 satellites | Late-game pressurizer + well extractors |
| **Open water** (coasts, lakes, rivers for Water Extractor) | **No** | — | Not discrete “nodes” in the game data model |

Water Extractors are placed freely on **deep water surfaces** (wiki: shallow rivers often fail). There is no permanent impure/normal/pure water *node* for open water — only wells are map entities with fixed coordinates. MIT rockfactory-style extracts mirror that: wells yes, free water no.

Community interactive maps (e.g. satisfactory-calculator) sometimes draw water *overlays*, but that is map art / placement hints, not a redistributable capacity grid we can honestly ship as “nodes.”

### Implications for heatmaps

Scoring water against wells alone **pulls hotspots toward a handful of well clusters** and ignores almost every coastal / lake factory people actually build early–mid game. That is a data gap, not a scorer bug.

### Practical product options (current app)

1. **Banner** when demand includes water — explain wells vs open extractors.  
2. **Omit water from scoring** (user toggle, local preference) — heat/pins use every other raw; user places extractors on nearby deep water.  
3. **Future:** approximate open-water capacity (see below) — not shipped yet.

### Future: building open-water data ourselves

| Approach | Pros | Cons |
|----------|------|------|
| **Blue-pixel / basemap mask** from orthographic map tiles | Uses art we already display; coasts/lakes light up | Shallow vs deep unknown; rivers over-count; tile art ≠ navigable depth; calibration work |
| **FModel landscape / water volumes** from game packages | Authoritative geometry if extractable | Heavy pipeline; depth rules still approximate; version churn |
| **Hand-drawn / community water polygons** (MIT-friendly) | Tunable “deep water” regions | Maintenance; not free capacity infinity without density rules |
| **Synthetic coastal buffer** from world bounds + known biomes | Fast heuristic | Inaccurate inland lakes |

A honest v1 open-water model would be something like: raster of “deep water?” cells → infinite or soft capacity within a radius (coasts scale more easily than ponds). Until then, **omit water + banner** is the trustworthy UX.

## Extraction rates (code, not Docs)

See `src/lib/mining.ts` — **miner Mk only affects solid ores**:

| Map entity | Building | Rate @ 100% |
|------------|----------|-------------|
| Solid ore node | Miner Mk.1 / 2 / 3 | 60 / 120 / 240 × purity (0.5 / 1 / 2) |
| Crude oil node | Oil Extractor (one rank) | 60 / 120 / 240 by purity — **not** miner Mk |
| Open water | Water Extractor (one rank) | 120 — no purity |
| Well satellite (oil/water/N₂) | Resource Well Extractor | 30 / 60 / 120 by purity — pressurizer on core |
| Well core | Pressurizer only | 0 throughput |
| Resource deposit | Portable miner (approx.) | 20 / 40 / 80 by purity |
| Geyser | Geothermal (not raw feed) | 0 for factory heatmap |

Clock % multiplies all continuous extractors.

Adaptive scale / Limited checks use a **pure permanent node** of each demanded resource under current settings as the headroom unit (see `docs/ARCHITECTURE.md`).

## Attribution snippet (README / about)

> Resource nodes: [satisfactory-logistics](https://github.com/rockfactory/satisfactory-logistics) MIT extract. Recipes/items: compact Coffee Stain Docs extract (`npm run parse-docs`). Temporary basemap tiles via satisfactory-logistics CDN (map art © Coffee Stain). Not affiliated with Coffee Stain or satisfactory-calculator.com.

## After each game patch checklist

- [ ] Re-export Persistent_Level / re-run node extract  
- [ ] Re-parse Docs → recipes/items  
- [ ] Diff Konsl/default-world tables if randomization changed  
- [ ] Bump `meta.json` `gameVersion`  
- [ ] Smoke: Mode A multi-resource, Mode B multi-product + Send to Raw, capacity tags (Limited/Abundant), seed mode when present  
