# Implementation status (handoff)

**Last true-up:** 2026-08-02 — open-water capacity + extractor clocks + Mode B Water off-site; dual-mode SPA, multi-plan hash shelf, Docker/GHCR, CF static assets.

## Repo layout

```
satisfactory-heat-map/
├── docs/                 PRODUCT, ARCHITECTURE, TOOLING, DATA, DEPLOY, ROADMAP, STATUS
├── deploy/nginx.conf
├── docker-compose.yml
├── Dockerfile            # GDAL tiles → Node/sharp open-water → Vite → nginx
├── scripts/              map-generate, map-extract-water, parse-docs, dev-start, …
├── public/_headers       Cloudflare static-asset cache/security
├── public/data/          nodes, recipes, meta, water/open-water.json
├── public/map/v1/        basemap README (+ gitignored WebPs)
├── map-tiles/            committed v1.tar.gz pack for CF / npm build
├── src/
│   ├── components/map|planner
│   ├── hooks/            useAutoHeatmap, useHeatmapWorker
│   ├── lib/coords|mining|production|heatmap|engine|seed
│   ├── workers/heatmap.worker.ts
│   ├── store/useAppStore.ts
│   └── types/
└── package.json          engines.node >= 24
```

## Working design decisions encoded in code

1. **Dual modes** share `activeDemand` in Zustand; Mode B multi-product + Expansion off-site prune (`solveProductsToRaw`).
2. **Live heatmap** via `useAutoHeatmap` → worker → `HeatmapResult`.
3. **Scoring** is capacity-first (`score.ts`) with rate-invariant haul quality; hierarchical multi-pass + diverse top-N.
4. **Capacity tags** inferred per top site (Limited / OK / Abundant / shortfall).
5. **Extractors:** miner Mk + independent clocks for miner / oil / water / well pressurizer; wells toggle (forced on if plan needs Nitrogen).
6. **Water supply** = basemap open-water bodies (`open-water.json`) ∪ well satellites when wells enabled.
7. **Mode B Water** can be marked off-site in Expansion (only map raw treated that way).
8. **Leaflet CRS.Simple** community-calibrated; self-hosted basemap tiles; heat `ImageOverlay`.
9. **Nodes** rockfactory MIT bootstrap (~626); **recipes** Docs compact extract.
10. **Persist** `sf-heatmap-v9` (plan shelf + extractors; display knobs local).

## Verified

```bash
npm test          # 100+ tests (unit + hierarchical + integration + open-water)
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

## Sensible next coding priorities

1. Optional Mode B alternate recipe toggles on Expansion rows.
2. Own FModel node extract when desired (`extract-world-nodes`).
3. Basemap v2 ~8k FModel extract — `public/map/v1/README.md`.
