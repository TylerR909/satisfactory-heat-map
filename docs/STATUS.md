# Implementation status (handoff)

**Last true-up:** 2026-07-26 — dual-mode live heatmap SPA, multi-plan hash shelf, Docker/GHCR, CI, Cloudflare Pages deploy path documented (`docs/DEPLOY.md`). Lint/test/build green.

## Repo layout

```
adelaide/
├── docs/                 PRODUCT, ARCHITECTURE, TOOLING, DATA, DEPLOY, ROADMAP, STATUS
├── deploy/nginx.conf
├── docker-compose.yml
├── Dockerfile
├── scripts/              dev-start, clean, wasm-build
├── public/_headers       Cloudflare Pages cache/security
├── public/data/          nodes, recipes, meta
├── public/scraped/       basemap CDN provenance (no committed binaries)
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
8. **Basemap:** temporary public XYZ WebP CDN (see `public/scraped/README.md`).
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

- Basemap is a **temporary third-party CDN** (not self-hosted art).
- Mode B recipes are a hand subset (not full Docs.json); no alternate-recipe toggles.
- No seed randomization UI yet.
- Cave/elevation is soft notes only (no navmesh).
- Shareable URL sync not wired (export JSON exists; import not yet).
- Peak emphasis / heat knobs are **display-only**; they do not invent new top sites.

## Sensible next coding priorities

1. Save & Swap Plans (reuse plan hash snapshots); import plan JSON.
2. Seeds (Konsl MIT / Docker WASM).
3. Docs.json + FModel extract scripts; self-hosted basemap tiles.
4. Optional Mode B alternate recipe toggles (still thin).
