# Implementation status (handoff)

**Last true-up:** 2026-08-10 — Indexed share hash `#v1.…` (item/recipe catalogs, open wire spec + vendoring guide); Mode B **Intermediates & Alternates** ship-ready.

## Repo layout

```
satisfactory-heat-map/
├── docs/                 PRODUCT, ARCHITECTURE, TOOLING, DATA, DEPLOY, ROADMAP, STATUS, SHARE_HASH*
├── .devcontainer/        Node 24 + Rust + wasm-pack (no host rustc)
├── crates/               engine (WASM) + vendored/konsl_randomization
├── deploy/nginx.conf
├── docker-compose.yml
├── Dockerfile            # GDAL → open-water → Rust/WASM → Vite → nginx
├── scripts/              map-*, parse-docs, dev-start, wasm-build, …
├── public/_headers       Cloudflare static-asset cache/security
├── public/data/          nodes, recipes, meta, water/open-water.json
├── public/map/v1/        basemap README (+ gitignored WebPs)
├── map-tiles/            committed v1.tar.gz pack for CF / npm build
├── src/
│   ├── components/map|planner
│   ├── hooks/            useAutoHeatmap, useHeatmapWorker, usePlanHash
│   ├── lib/…|engine|wasm|seed | heatmap (rasterize only)
│   │   └── production/   solve, badges, quickSelects, minimizeInputTypes, expansionLinks, …
│   ├── workers/heatmap.worker.ts
│   ├── store/useAppStore.ts
│   └── types/
└── package.json          engines.node >= 24
```

## Working design decisions encoded in code

1. **Dual modes** share `activeDemand` in Zustand; Mode B multi-product + Intermediates off-site prune (`solveProductsToRaw`).
2. **Live heatmap** via `useAutoHeatmap` → worker → `HeatmapResult`.
3. **Scoring** is capacity-first in **WASM** (`crates/engine`) with rate-invariant haul quality; hierarchical multi-pass + diverse top-N.
4. **Capacity tags** inferred per top site (Limited / OK / Abundant / Shortfall).
5. **Extractors:** miner Mk + independent clocks for miner / oil / water / well pressurizer; wells toggle (forced on if plan needs Nitrogen).
6. **Water supply** = basemap open-water bodies (`open-water.json`) ∪ well satellites when wells enabled.
7. **Mode B Water** can be marked off-site under Intermediates (only map raw treated that way).
8. **Mode B alternates:** per-step `recipeOverrides` (share hash + persist); UI popover + deterministic badges; quick-select packs incl. **Removes Types** (greedy unique map-raws, water ignored, type-colored cut list) and **Recycled loop** (HOR + Diluted Fuel + Recycled Plastic/Rubber); list sort (deep/shallow) is display-only local pref; expand-aware hover links with rate slices (`expansionLinks`); off-site × still highlights consumers; disabled ghost consumers use the **default** recipe only; Raw demand lists net **byproducts**.
9. **Leaflet CRS.Simple** community-calibrated; self-hosted basemap tiles; heat `ImageOverlay`.
10. **Nodes** own FModel extract (~626 via `extract-world-nodes`); **recipes** Docs compact extract with **`producedIn`** building ClassNames.
11. **Persist** `sf-heatmap-v9` (plan + extractors + recipeOverrides + UI prefs incl. expansion sort; display knobs local).
12. **Share hash** `#v1.<base64url>`: append-only `itemIds` / `recipeIds` catalogs; sparse Mode B overrides; Mode A `encodeRawPlanHash` for external tools ([SHARE_HASH.md](./SHARE_HASH.md), [SHARE_HASH_VENDORING.md](./SHARE_HASH_VENDORING.md)).

## Verified

```bash
npm test          # WASM-backed scorer + seed + unit/integration (requires wasm:build)
npm run lint      # Biome clean
npm run typecheck
npm run build     # map:ensure + tsc + Vite + PWA (needs map-tiles pack or generated tiles)
npm start         # Vite HMR
```

## Known limits

- Open water is **basemap-approximated** (not game depth); shallow rivers may over-count.
- Individual basemap WebPs are not in git; CF uses **`map-tiles/v1.tar.gz`** + `map:ensure`.
- Mode B alts are for **site selection**, not a full factory planner (no LP / belt graph / “best alt globally”).
- **Removes Types** is greedy unique-raw search (not exhaustive optimal); water is not a type win.
- Cave/elevation is soft notes only (no navmesh).
- Peak emphasis / heat knobs are **display-only**.

## WASM / performance (2026-08)

- **Badge tooltip:** score stage breakdown (`prepare` / `coarse` / `refine` / `topSites`) + separate rasterize ms.
- **Rust crate:** `crates/engine` — `score_grid` + `apply_map_seed` (no TS algorithm fallback).
- **Toolchain:** Dev Container + Docker only — **never host rustc**. Conductor `setup` prebuilds WASM.
- **Seed:** Full Konsl MIT algorithm in `konsl_randomization`; TS is thin cache/wrapper only.

## Sensible next priorities (post-alts)

1. **PR phase** — first intentional PR → `main` + CF project / domain / GHCR public as needed ([DEPLOY.md](DEPLOY.md), [ROADMAP.md](ROADMAP.md) Phase 3).
2. Operator CF build command = rustup + wasm-pack + `npm run build` if not already set.
3. Re-run `extract-world-nodes` / `parse-docs` after game patches (FModel + Docs).
4. Optional later (not alt blockers): blueprint paste, “alts unlock hotter regions” compare, cave flags, clearer per-resource breakdown.
