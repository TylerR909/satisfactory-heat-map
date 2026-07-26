# Tooling & technology

## Host machine requirements

| Required | Notes |
|----------|--------|
| **Node.js 24 LTS** | Pin via `.nvmrc` / `engines.node >= 24` |
| **npm** | Lockfile committed |
| **Docker** (optional for daily UI) | Required for Compose deploy and any WASM build |

**Do not install on the host:** Rust, rustup, cargo, wasm-pack. WASM builds go through Docker only (`npm run wasm:build`).

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
| Tests | Vitest | Unit + hierarchical + integration tests (solver, scorer, adaptive scale, real nodes) |
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
| **`npm start`** | `scripts/dev-start.mjs`: optional WASM via Docker if `crates/` exists → **Vite HMR** |
| **`npm run dev`** | Vite only (skip wasm step) |
| **`npm run build`** | `tsc -b` + Vite production (tree-shake, minify, hashed assets) → `dist/` |
| **`npm run preview`** | `vite preview` of `dist/` — optional local smoke only (not CF Workers / not Docker) |
| **`npm test`** | `vitest run` |
| **`npm run test:watch`** | Vitest watch |
| **`npm run lint`** | `biome check .` |
| **`npm run lint:fix`** | `biome check --write .` |
| **`npm run clean`** | Remove `dist/`, caches, coverage |
| **`npm run wasm:build`** | Docker Compose `wasm-builder` only; no-op without `crates/` |

### Production Docker (idiomatic)

- **Build stage:** `npm ci` + `npm run build`
- **Runtime:** nginx copies `dist/` — **no Node in runtime image**
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

## WASM strategy (future, Docker-only)

- Optional crates under `crates/`
- `Dockerfile.wasm` / compose service `wasm-builder` with rust + wasm-pack
- Commit generated glue under `src/wasm/` so `npm start` works without Docker for pure UI
- First WASM candidate: **Konsl seed randomization** (MIT algorithm). Scorer only if TS profiling demands it.
- Map rendering stays Leaflet — never WASM map engine.

## Related open-source references (legal use)

| Project | Use |
|---------|-----|
| [rockfactory/satisfactory-logistics](https://github.com/rockfactory/satisfactory-logistics) MIT | Node extract scripts + `WorldResourceNodes.json` bootstrap |
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
| `public/scraped/README.md` | Temporary basemap CDN only |
