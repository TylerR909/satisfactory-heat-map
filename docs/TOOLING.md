# Tooling & technology

## Host machine requirements

| Required | Notes |
|----------|--------|
| **Node.js 24 LTS** | Pin via `.nvmrc` / `engines.node >= 24` |
| **npm** | Lockfile committed |
| **Docker** | Required for Compose deploy; on hosts **without** a Dev Container, also for `wasm:build` |

**Never install on the host:** Rust, rustup, cargo, or wasm-pack. The toolchain lives **only** in:

1. **Dev Container** (`.devcontainer/`) — everyday Node + Rust + `wasm-pack` for Vite HMR  
2. **Published Dockerfile** rust stage — compile-on-build  
3. **CI / Cloudflare build VM** — ephemeral rustup for `npm run build`  

`npm run wasm:build` uses wasm-pack when present, otherwise Docker (`rust:1-bookworm`). It does **not** install Rust on the host.

## Stack (locked for MVP)

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node **24** LTS | Current LTS |
| Language | TypeScript **~6.0** | Latest stable toolchain; **avoid TS 7.0** until 7.1 + ecosystem catch up |
| App | React **19** + Vite **8** | SPA |
| Optimizing compile | **React Compiler** (`babel-plugin-react-compiler` + `@rolldown/plugin-babel` / `reactCompilerPreset`) | Auto-memo; **minimal manual `useMemo`/`useCallback`** |
| Lint + format | **Biome** | Includes hooks rules (see below) |
| State | Zustand + persist | Lightweight + localStorage |
| Map | Leaflet + react-leaflet + CRS.Simple | Game image maps; pan/zoom free |
| Workers | Vite worker (`heatmap.worker.ts`) | Scoring off main thread |
| CSS | Tailwind **v4** (`@tailwindcss/vite`) | Fast UI |
| Tests | Vitest | WASM-backed scorer/seed + unit/integration (solver, mining, plan hash, …) |
| Scorer / seed | Rust → WASM (`crates/`) | Hierarchical score + Konsl seed; UI stays TS |
| PWA | vite-plugin-pwa | Offline cache |
| Container | `node:24-alpine` build → `nginx:alpine` | Static serve |

## Biome & React hooks

Biome **does** implement rules-of-hooks equivalents:

| ESLint | Biome |
|--------|--------|
| `react-hooks/rules-of-hooks` | `lint/correctness/useHookAtTopLevel` |
| `react-hooks/exhaustive-deps` | `lint/correctness/useExhaustiveDependencies` |

Config: `biome.json` with React domain recommended + those rules as error.

`useExhaustiveDependencies` still matters for **`useEffect`**. Do **not** add `useMemo`/`useCallback` just to silence deps — prefer React Compiler.

## Canonical npm scripts

| Script | Behavior |
|--------|----------|
| **`npm start`** | `wasm:build` (if crates) → basemap ensure → **Vite HMR** |
| **`npm run dev`** | Vite only (expects `crates/engine/pkg` already built for WASM) |
| **`npm run build`** | map:ensure → **wasm:build --release** → typecheck → Vite → `dist/` (incl. `.wasm`) |
| **`npm run preview`** | `vite preview` of `dist/` — optional local smoke only (not CF Workers / not Docker) |
| **`npm test`** | `vitest run` — **WASM required** (globalSetup runs `wasm:build` if `pkg/` missing) |
| **`npm run test:watch`** | Vitest watch |
| **`npm run lint`** | `biome check .` |
| **`npm run lint:fix`** | `biome check --write .` |
| **`npm run clean`** | Remove `dist/`, caches, `crates/**/pkg`, `target` |
| **`npm run map:generate`** | Docker: wiki Map.jpg → WebP tiles **+** `public/data/water/open-water.json` (GDAL then Node/sharp). Rare offline tooling. |
| **`npm run map:pack`** | Pack WebPs → committed `map-tiles/v1.tar.gz` (~1.4 MB) for CF Git builds |
| **`npm run map:ensure`** | Unpack pack into `public/map/v1/` if tiles missing (used by `npm run build`) |
| **`npm run map:clean`** | Remove generated map tiles / scratch dirs; keep README + pack |
| **`npm run wasm:build`** | Compile `crates/engine` → `pkg/` if sources changed (skip when up to date). Local: Docker + named volumes `sf-heatmap-cargo-cache` / `sf-heatmap-rustup-cache`. CI/CF: native rustup. `FORCE_WASM_BUILD=1` or `--force` always rebuilds. **Never commit pkg.** |

### Production Docker (idiomatic)

- **Tiles stage:** OSGeo GDAL image runs `scripts/map-generate-inner.sh` (wiki → WebP pyramid)
- **WASM stage:** `rust` image + wasm-pack → `crates/engine/pkg`
- **Build stage:** `npm ci` + copy tiles + copy wasm pkg + Vite (ships compiled `.wasm` in `dist/`)
- **Runtime:** nginx copies `dist/` only — **no Node, no Rust**
- Do **not** use `npm run preview` as container CMD or as “production”

```bash
docker compose up --build   # serves on :8080
```

## React Compiler verification

1. DevTools → components show **Memo ✨** when optimized.
2. Escape hatch: `"use no memo"` on a misbehaving component only if needed.

Vite wiring lives in `vite.config.ts` (`react()` + babel `reactCompilerPreset()`).

## Path aliases

- `@/*` → `src/*` (Vite + `tsconfig.app.json`)

## WASM strategy (current)

| Piece | Detail |
|-------|--------|
| Layout | `crates/` workspace: `engine` (cdylib + wasm-bindgen), `vendored/konsl_randomization` (rlib) |
| Compile | Part of `npm start` / `npm run build` / Conductor `setup` — same class as TS transpile, **not** a committed artifact |
| Artifacts | `crates/engine/pkg/` **gitignored**; release profile by default (`WASM_DEV=1` for debug) |
| Vite | `vite-plugin-wasm` + `wasmPackWatch` (release rebuild when wasm-pack on PATH) |
| Load | App boot + worker: `loadWasmEngine()` — **WASM required** for `score_grid` and `apply_map_seed` (no TS algorithm fallback) |
| TS types | Rust wire structs use **`tsify`** → wasm-pack `.d.ts`; copied to `src/lib/wasm/generated/sf_engine.d.ts` on each `wasm:build`. Façade maps wire ↔ `@/types` (no `any`) |
| Host Rust | **Forbidden** — Dev Container or Docker only (current stable rustc) |
| CF Git | Build command `npm run build` only — `wasm-build` bootstraps rustup on the CF VM (no Docker) |
| Map | Leaflet only — never a WASM map engine |

### Dev Container

Open the repo in a Dev Container (`.devcontainer/`). Then `npm start` has wasm-pack for true Rust rebuild + Vite.

## Related open-source references (legal use)

| Project | Use |
|---------|-----|
| Own FModel pipeline | `npm run extract-world-nodes` — `data/Persistent_Level.json` → `public/data/nodes/*` |
| [Konsl/satisfactory-world-generator](https://github.com/Konsl/satisfactory-world-generator) | Randomization **MIT** (`src/*.rs`, `scripts/`); viewer is GPL — do not copy GPL app code lightly |
| [greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools) | Docs.json parse patterns |
| Official `CommunityResources/Docs/*.json` | Items/recipes (Coffee Stain community dump) |

**Do not** reuse satisfactory-calculator.com code or data assets (educational / no-reuse).

## Editor / CI suggestions

- Format + lint on save via Biome.
- CI: `npm ci && npm run lint && npm test && npm run build`
- Website deploy: Cloudflare Workers static assets via Git (`npm run build` → `npx wrangler deploy`) — see [DEPLOY.md](DEPLOY.md)
- Static headers: `public/_headers` (Vite copies into `dist/`; honored by Workers assets)

## Docs map

| File | When to update |
|------|----------------|
| `docs/PRODUCT.md` | User-facing modes, knobs, non-goals |
| `docs/ARCHITECTURE.md` | Scoring, map, worker, persist keys |
| `docs/DATA.md` | Node/recipe/basemap provenance |
| `docs/ROADMAP.md` | Done vs next phases |
| `docs/STATUS.md` | Handoff snapshot after meaningful pushes |
| `public/map/v1/README.md` | Basemap generate/runtime runbooks |
| `map-tiles/README.md` | Committed tile pack for CF Git builds |
