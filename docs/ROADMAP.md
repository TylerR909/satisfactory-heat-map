# Roadmap

## Done (MVP + polish)

- [x] Product identity: heatmap-first, dual input modes, capacity scoring
- [x] Vite + React 19 + TS + Biome + Tailwind 4 + Zustand + Leaflet
- [x] React Compiler + PWA plugin wiring
- [x] Docker multi-stage → nginx + Compose
- [x] Canonical npm scripts (`start`, `build`, `preview`, `test`, `lint`, `typecheck`, `parse-docs`, …)
- [x] MIT node bootstrap (`default-nodes.json`, ~626 nodes)
- [x] **Docs-derived recipes & items** (`npm run parse-docs` → compact `items.json` / `recipes.json`; full en-US.json not shipped)
- [x] Products list = **automatable** factory outputs only (no workshop-only gear, world pickups, or enemy drops)
- [x] Capacity-aware scorer + hierarchical grid + diverse top-N + Vitest
- [x] Rate-invariant haul quality + peak-emphasized heat display (normalize rewrite + paint defaults)
- [x] Centered / Weighted as **single Clustering slider** (center strength folded in)
- [x] Inferred capacity tags (Limited / OK / Abundant / shortfall) from local utilization — no capacity mode toggle
- [x] Multi-product Mode B with intermediate stacking + **Send to Raw**
- [x] Live debounced recompute (no manual compute button)
- [x] Extractor model: miner Mk/clock (solids only, clock max 250%); oil / water / wells
- [x] Web Worker engine façade
- [x] Planner knobs: Clustering (above Heat settings), Heat settings, Extractors; resets
- [x] Map: rockfactory-compatible CRS, temporary CDN basemap tiles, heat overlay, nodes, pins, assignment lines, correct panes
- [x] **Hash settings into the URL** (compact `#v1.<binary>` — mode, active demand, extractors, scoring, knobs)
- [x] **Save & swap heatmaps** (abbrev chips; localStorage + plan hash; import paste hash; copy hash)
- [x] Water caveat banner + omit-from-scoring toggle + Active raw demand strikethrough
- [x] Site spread: strict separation, wider range (4–40% diag)
- [x] **Attributions** footer control (viewport-clamped tooltip) + Leaflet basemap ©
- [x] Lint / test / build green end-to-end (lint may still have pre-existing format noise)
- [x] Heatmap worker loop / clear-demand race / attributions tooltip / savedPlans localStorage guards

## Phase 1.5 — Seeds (high value)

- [ ] Konsl MIT randomization (TS port **or** Docker WASM)
- [ ] UI: seed + mode + purity settings
- [ ] Re-assign node types/purities on fixed slots → recompute heatmap
- [ ] Share URL includes seed params

## Phase 2 — Depth without becoming a calculator

- [ ] Mode B **alternate recipe toggles** (alts now in data; UI still default-only)
- [ ] **Blueprint paste** — paste a Satisfactory blueprint string; derive raw demand (and/or product targets) for the heatmap without becoming a full planner
- [ ] “These alts unlock hotter regions” comparison (nice-to-have)
- [ ] Cave node flags / better elevation heuristics
- [ ] Resource-colored haul lines + clearer per-resource breakdown (smell-test / trust)

## Phase 3 — Data maturity & ship

- [x] `scripts/parse-docs.mjs` from official Docs (en-US.json)
- [ ] `scripts/extract-world-nodes` (or CI pull) from rockfactory MIT / FModel
- [ ] Self-hosted basemap tiles under `public/map/` (replace temporary CDN) — **required before leaning on their bandwidth long-term**
- [ ] Drop temporary CDN notes from `meta.json` / scraped README when done
- [x] Cloudflare Pages deploy docs + `public/_headers` ([docs/DEPLOY.md](DEPLOY.md)); Git connect + domain is operator one-time
- [x] Docker image + `.dockerignore` + GHCR on merge-to-main + auto Releases + `docker-compose.example.yml` (:18547)
- [x] CI on PR/`main`: lint · test · build · Docker smoke build (`.github/workflows/ci.yml`)
- [ ] First intentional PR → `main` + CF project linked + satisfactory-heatmap.com Active + GHCR Public

## Later / maybe

- [ ] Save-file upload (actual world extraction)
- [ ] Dense interactive brush scoring (WASM scorer if needed)
- [ ] Open-water capacity model (wells-only is honest for now)
- [ ] CI: scheduled node refresh from MIT source
- [ ] Stronger hierarchical seed diversity if users want more “new” pin regions under fixed demand

## Explicitly not on roadmap

- Competing with full factory planners or SCIM feature lists
- Backend, accounts, multiplayer
- Host-installed Rust toolchain
- Shipping full 10MB Docs.json to browsers
