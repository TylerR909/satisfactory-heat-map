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
- [x] Inferred capacity tags (Limited / OK / Abundant / Shortfall) from local utilization — no capacity mode toggle
- [x] Multi-product Mode B with intermediate stacking + **Send to raw**
- [x] Live debounced recompute (no manual compute button)
- [x] Extractor model: miner Mk + separate clocks for miner / oil / water / well pressurizer (50–250%)
- [x] Web Worker engine façade
- [x] Planner knobs: Clustering (above Map settings), Map settings, Extractors; resets
- [x] Map: community-calibrated CRS, self-hosted basemap tiles, heat overlay, nodes, pins, assignment lines, correct panes
- [x] **Hash settings into the URL** (compact `#v1.<binary>` — mode, active demand, extractors, scoring, knobs)
- [x] **Save & swap heatmaps** (abbrev chips; localStorage + plan hash; import paste hash; copy hash)
- [x] Open-water capacity (basemap blue → bodies) + wells toggle (N₂ forces wells on) + blue water haul lines
- [x] Mode B: **Water** listed under Intermediates for off-site import (other ores stay via intermediates)
- [x] Site spread: strict separation, wider range (4–40% diag)
- [x] **Attributions** footer control (viewport-clamped tooltip) + Leaflet basemap ©
- [x] Lint / test / build green end-to-end (lint may still have pre-existing format noise)
- [x] Heatmap worker loop / clear-demand race / attributions tooltip / savedPlans localStorage guards

## Phase 1.5 — Seeds (high value)

- [x] Konsl MIT randomization (WASM: `crates/vendored/konsl_randomization` → `apply_map_seed`; see `third_party/konsl-…`)
- [x] UI: Seed button + popover (paste / random / named saved seeds) — mode/purity fixed to Random + unchanged
- [x] Re-assign node types/purities on fixed slots → cached nodes → heatmap
- [x] Share URL includes seed (omitted for Default; seed `0` valid randomized world)

## Phase 2 — Depth without becoming a calculator

- [x] Mode B **Resource Toggle** — mark intermediates off-site / imported (stop expand); Empty Canister + Empty Fluid Tank default off-site; **Water** also off-site-able; share-hash + Intermediates UI
- [x] Mode B **alternate recipes** (**Intermediates & Alternates**) — done as a shippable slice:
  - [x] Squarish picker + popover (default + alts; Residual / non-HD paths selectable)
  - [x] Live re-expand + share-hash / persist `recipeOverrides`
  - [x] Deterministic badges (Removes / Skips / Pure / Alloy / Screw-Free / RE / High Throughput / machine via Docs `producedIn` / unavoidable Adds / …)
  - [x] Quick selects (Defaults, All Pure, No Screws, RE, Polymer, Recycled, Oil→recycled, Al packs, …)
  - [x] **Minimize Input Types** (greedy unique-raw expand; not blind Removes badges)
  - [x] List sort (ingredients-first ↔ products-first; display-only local pref)
  - [x] Recipe-control hover: violet predicates + emerald consumers
- [ ] **Blueprint paste** — paste a Satisfactory blueprint string; derive raw demand (and/or product targets) for the heatmap without becoming a full planner
- [ ] “These alts unlock hotter regions” comparison (nice-to-have — not required for alt MVP)
- [ ] Cave node flags / better elevation heuristics
- [ ] Clearer per-resource breakdown (smell-test / trust) — water haul lines already colored

## Phase 3 — Data maturity & ship

- [x] `scripts/parse-docs.mjs` from official Docs (en-US.json)
- [x] `scripts/extract-world-nodes` — own FModel `Persistent_Level` → `default-nodes.json`
- [x] Basemap tiles under `public/map/v1/` (wiki → Docker GDAL; committed `map-tiles/v1.tar.gz` + `map:ensure` for CF Git)
- [x] Cloudflare Workers static-asset deploy docs + `wrangler.jsonc` + `public/_headers` ([docs/DEPLOY.md](DEPLOY.md)); Git connect + domain is operator one-time
- [x] Docker image + `.dockerignore` + GHCR on merge-to-main + auto Releases + `docker-compose.example.yml` (:18547)
- [x] CI on PR/`main`: lint · test · build · Docker smoke build (`.github/workflows/ci.yml`)
- [ ] First intentional PR → `main` + CF project linked + satisfactory-heatmap.com Active + GHCR Public

## SEO / discoverability

Full notes: [docs/SEO.md](SEO.md). Code owns crawl files + meta; CF owns bot policy / DNS; Search Console is operator.

### Phase 1 — Baseline (static SPA)

- [x] `public/robots.txt` + `sitemap.xml` + optional `llms.txt` (real files so SPA fallback is not HTML-200)
- [x] Open Graph / Twitter Card / canonical / JSON-LD in `index.html`
- [x] Static `og-image.png` (1200×630) — production screenshot of default **HMF 10/min** heat + title bar (`scripts/capture-og-image.mjs` to regenerate)
- [x] Crawlable pitch copy in the HTML shell
- [ ] Operator: CF AI Crawl Control + managed robots stance; www↔apex; Search Console / Bing; post-merge unfurl smoke

### Phase 2 — Share-aware unfurls (optional; only if Phase 1 feels insufficient)

- [ ] Path or query share routes (hash can remain primary for app state)
- [ ] Small Cloudflare Worker that, for bot UAs or `/s/*`, returns HTML with plan-derived `og:title` / description (product, rate, seed)
- [ ] Image still the static OG card unless Phase 3 lands
- [ ] Dual share formats + Worker tests; Docker remains pure static unless Worker is CF-only

### Phase 3 — Dynamic heatmap cards (aspirational — probably never)

- [ ] Edge render: run scorer + canvas/PNG in a Worker, or Browser Rendering API
- [ ] Cache by plan hash
- [ ] Revisit only if social virality depends on “see *my* heat in the embed”

## Later / maybe

- [ ] Save-file upload (actual world extraction)
- [x] WASM hierarchical scorer (`score_grid`) + performance badge stage timings
- [ ] Dense interactive brush scoring (further grid/worker split if needed)
- [ ] CI: scheduled node refresh from MIT source
- [ ] Stronger hierarchical seed diversity if users want more “new” pin regions under fixed demand

## Explicitly not on roadmap

- Competing with full factory planners or SCIM feature lists
- Backend, accounts, multiplayer
- Host-installed Rust toolchain
- Shipping full 10MB Docs.json to browsers
- SSR / Next rewrite solely for SEO
- Indexing every shared `#v1.…` plan as its own SEO page
