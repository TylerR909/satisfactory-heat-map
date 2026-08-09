# Implementation status (handoff)

**Last true-up:** 2026-08-04 — WASM hierarchical scorer + Konsl seed (`score_grid` / `apply_map_seed`); TS algorithms removed; timing badge breakdown; Dev Container / Docker-only rustc.

## Repo layout

```
satisfactory-heat-map/
├── docs/                 PRODUCT, ARCHITECTURE, TOOLING, DATA, DEPLOY, ROADMAP, STATUS
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
│   ├── hooks/            useAutoHeatmap, useHeatmapWorker
│   ├── lib/…|engine|wasm|seed (thin wrappers) | heatmap (rasterize only)
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
8. **Leaflet CRS.Simple** community-calibrated; self-hosted basemap tiles; heat `ImageOverlay`.
9. **Nodes** own FModel extract (~626 via `extract-world-nodes`); **recipes** Docs compact extract.
10. **Persist** `sf-heatmap-v9` (plan shelf + extractors; display knobs local).

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
- Mode B alternate-recipe toggles still incomplete in UI (alts in data).
- Cave/elevation is soft notes only (no navmesh).
- Peak emphasis / heat knobs are **display-only**.

## WASM / performance (2026-08)

- **Badge tooltip:** score stage breakdown (`prepare` / `coarse` / `refine` / `topSites`) + separate rasterize ms.
- **Rust crate:** `crates/engine` — `score_grid` + `apply_map_seed` (no TS algorithm fallback).
- **Toolchain:** Dev Container + Docker only — **never host rustc**. Conductor `setup` prebuilds WASM.
- **Seed:** Full Konsl MIT algorithm in `konsl_randomization`; TS is thin cache/wrapper only.

## Sensible next coding priorities

1. Operator: CF dashboard build command = rustup + wasm-pack + `npm run build` ([DEPLOY.md](DEPLOY.md)).
2. Optional Mode B alternate recipe toggles on Intermediates rows.
3. Basemap v2 ~8k FModel extract — `public/map/v1/README.md`.
4. Re-run `extract-world-nodes` after game patches (FModel re-export).
