# Contributing

Dev setup, data refresh, and project docs for people working on the codebase. End users: see [README.md](README.md) and [satisfactory-heatmap.com](https://satisfactory-heatmap.com).

## Quick start (Node)

```bash
# Node 24+ and Docker (for WASM compile when rustc/wasm-pack are not on PATH)
npm ci             # also runs prepare → lefthook install (git hooks)
npm start          # wasm:build (Docker or wasm-pack) → basemap ensure → Vite HMR
```

**Never install Rust on the host.** WASM is built via Dev Container (`.devcontainer/`), Docker (`npm run wasm:build`), or CI/CF build VMs. See [docs/TOOLING.md](docs/TOOLING.md).

```bash
npm test           # WASM-backed (auto wasm:build if pkg missing)
npm run lint
npm run build      # map:ensure + wasm:build + typecheck + Vite → dist/ (includes .wasm)
npm run preview    # optional: serve dist/ locally (not how we ship prod)
```

### Git hooks (lefthook)

[`lefthook.yml`](lefthook.yml) installs a **pre-commit** hook via `npm run prepare` / `npm ci`:

| Step | What |
|------|------|
| **biome** | `biome check --write` on **staged** source files only; auto-fixes are re-staged (`stage_fixed`) |
| **typecheck** | full `tsc --noEmit` (`npm run typecheck`) |

```bash
npx lefthook run pre-commit   # run hooks without committing
LEFTHOOK=0 git commit …       # skip hooks once (emergency only)
```

## Docker commands (local)

`docker-compose.yml` **builds from source** (multi-stage: GDAL tiles → open-water → **Rust/WASM** → Vite → nginx). You need Docker Desktop (or Engine) running and network access to pull base images + npm packages. Final image is static assets only (compiled `.wasm` in `dist/`).

```bash
# Build the image (runs npm ci + npm run build inside Linux)
docker compose build

# Build and start (foreground logs)
docker compose up --build

# Detached
docker compose up --build -d

# Open: http://localhost:18547

# Stop / remove container
docker compose down

# Force clean rebuild (no cache)
docker compose build --no-cache
```

**If `npm ci` fails in the image:** host `package.json` and `package-lock.json` are out of sync. Fix on the host, then rebuild:

```bash
npm install          # regenerates package-lock.json to match package.json
npm ci               # should succeed on host
docker compose build --no-cache
```

**Pull-only** (no local build — after GHCR has an image):

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
# http://localhost:18547
```

## Project docs

| Doc | Contents |
|-----|----------|
| [docs/PRODUCT.md](docs/PRODUCT.md) | Goals, principles, modes, non-goals |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Scoring, map stack, workers, deploy |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Cloudflare Workers (static assets) handshake + merge-to-main ship path |
| [docs/TOOLING.md](docs/TOOLING.md) | Stack, scripts, Biome, React Compiler, Docker, WASM policy |
| [docs/DATA.md](docs/DATA.md) | Provenance, basemap, FModel/Docs regeneration |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and backlog |
| [docs/STATUS.md](docs/STATUS.md) | Handoff status for agents/humans |

## Data & attributions

| Asset | Source |
|-------|--------|
| Resource nodes | [rockfactory/satisfactory-logistics](https://github.com/rockfactory/satisfactory-logistics) MIT `WorldResourceNodes.json` |
| Recipes & items | Compact extract from Coffee Stain `CommunityResources/Docs/en-US.json` via `npm run parse-docs` (full Docs **not** shipped) |
| Basemap tiles | Self-hosted `/map/v1/` WebPs. Commit pack `map-tiles/v1.tar.gz`; worktree: `npm run map:ensure` or `map:generate`. Map art © Coffee Stain. See `public/map/v1/README.md` |
| Open water | `public/data/water/open-water.json` from the same `map:generate` pass (Node/sharp blue-pixel extract). Commit when map art/thresholds change. See [docs/DATA.md](docs/DATA.md). |
| Extractor rates | Project tables in `src/lib/mining.ts` (miner / oil / water / well clocks) |

Full policy: [docs/DATA.md](docs/DATA.md). In-app: footer **Attributions**.

### Refresh recipes after a game patch

1. Copy `…/Satisfactory/CommunityResources/Docs/en-US.json` → `data/Docs/en-US.json` (gitignored).
2. `npm run parse-docs`
3. Commit updated `public/data/recipes/*` + bump `meta.json` `gameVersion` if needed.

## CI & deploy

| Path | When | What |
|------|------|------|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | PRs + pushes to `main` | `lint`, `test`, `build`, Docker image **smoke** (no push) |
| [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) | Every push to `main` (+ manual) | Auto-bump `v*`, GHCR push, GitHub Release |
| **Cloudflare** (Git integration) | Every push to `main` (and optional PR previews) | CF installs Rust + wasm-pack, then `npm run build` → `npx wrangler deploy` → [satisfactory-heatmap.com](https://satisfactory-heatmap.com) |

**Merge to `main` ships both surfaces:** Cloudflare (site) and GHCR (same commit as a container). Full handshake: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

| CF setting | Value |
|------------|--------|
| Production branch | `main` |
| Build command | rustup + wasm-pack + `npm run build` (see [DEPLOY.md](docs/DEPLOY.md) — **not** bare `npm run build`) |
| Deploy command | `npx wrangler deploy` |
| Assets | `wrangler.jsonc` → `./dist` |
| Non-production branch builds | On (PR previews) |
| Node | `.nvmrc` → `24` |

## Releases & GHCR (automatic)

You do **not** hand-version. On each push to `main`, **Release · GHCR** will:

1. Pick the next **patch** semver (`v0.1.0` from `package.json` on first run, then `v0.1.1`, … from existing tags).
2. Build and push `ghcr.io/tylerr909/satisfactory-heat-map` as:
   - `:latest`
   - `:vX.Y.Z` and `:X.Y.Z`
   - `:sha-<7-char>` (matches the commit CF deployed)
3. Create a **GitHub Release** with auto-generated notes (commits since previous tag) plus pull commands.

**No extra secrets** — `GITHUB_TOKEN` with `contents: write` + `packages: write`.

**One manual step after the first successful image push:** package → **Package settings** → **Change visibility** → **Public** (anonymous `docker pull` / compose). Until then the package may be private.

**Settings → Actions → General → Workflow permissions** → **Read and write** (required for tags, Releases, and GHCR).

## License

[MIT](LICENSE).
