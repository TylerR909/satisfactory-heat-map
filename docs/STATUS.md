# Implementation status (handoff)

**Last true-up:** 2026-07-27 — dual-mode live heatmap SPA, multi-plan hash shelf, Docker/GHCR, CI, Cloudflare Workers static assets; basemap via committed `map-tiles/v1.tar.gz` + `map:ensure` on build.

## Repo layout

```
adelaide/
├── docs/                 PRODUCT, ARCHITECTURE, TOOLING, DATA, DEPLOY, ROADMAP, STATUS
├── deploy/nginx.conf
├── docker-compose.yml
├── Dockerfile
├── scripts/              dev-start, clean, wasm-build
├── public/_headers       Cloudflare static-asset cache/security
├── public/data/          nodes, recipes, meta
├── public/map/v1/        basemap README (+ gitignored WebPs)
├── map-tiles/            committed v1.tar.gz pack for CF / npm build
├── src/
│   ├── components/map|planner
│   ├── hooks/            useAutoHeatmap, useHeatmapWorker
│   ├── lib/coords|mining|production|heatmap|engine
│   ├── workers/heatmap.worker.ts
│   ├── store/useAppStore.ts
│   └── types/
└── package.json          engines.node >= 24
```

## Working design decisions encoded in code

1. **Dual modes** share `activeDemand` in Zustand; Mode B supports **multiple product targets** with stacked intermediates (`solveProductsToRaw`).
2. **Live heatmap** via `useAutoHeatmap` → worker → `HeatmapResult`.
3. **Scoring** is capacity-first (`score.ts`) with rate-invariant haul quality; hierarchical multi-pass + diverse top-N (`hierarchical.ts`).
4. **Site preference:** Centered vs Weighted. **Capacity tags** on top sites from local utilization (Limited / Abundant / OK / shortfall).
5. **Extractor model** distinguishes miner Mk (solids), oil extractors, water, wells, deposits (`mining.ts`).
6. **Engine façade** (`createEngine`) isolates future WASM.
7. **Leaflet CRS.Simple** rockfactory-compatible coords; heat is `ImageOverlay` PNG (no rescore on pan/zoom).
8. **Basemap:** self-hosted `/map/v1/` WebP pyramid. Committed pack `map-tiles/v1.tar.gz`; `npm run build` unpacks via `map:ensure`. Docker image still GDAL-generates. Same-origin in dev and prod.
9. **Nodes** bootstrapped from rockfactory MIT JSON (**626** entries).
10. **Recipes** are a minimal hand set — Mode B is intentionally thin.
11. **Persist** `sf-heatmap-v5`; reset-all keeps products/inputs.

## Verified

```bash
npm test          # 28 tests (unit + hierarchical + integration on real nodes)
npm run lint      # Biome clean
npm run build     # tsc + Vite + PWA
npm start         # Vite HMR (no crates → TS engine)
```

## Known limits

- Individual basemap WebPs are not in git; CF relies on committed **`map-tiles/v1.tar.gz`** + `map:ensure` (see `docs/DEPLOY.md`).
- Mode B alternate-recipe toggles still incomplete in UI (alts in data; Expansion rows ready for recipe pickers later).
- Cave/elevation is soft notes only (no navmesh).
- Peak emphasis / heat knobs are **display-only**; they do not invent new top sites.

## Sensible next coding priorities

1. Optional Mode B alternate recipe toggles on Expansion rows (alts already in data).
2. Own FModel node extract when desired (`extract-world-nodes`).
3. Basemap v2 ~8k FModel extract (board: Ready) — `public/map/v1/README.md`.
