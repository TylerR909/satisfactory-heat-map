# Deploy

Both ship paths fire on **merge to `main`** (same git commit):

| Surface | What users get | How it ships |
|---------|----------------|--------------|
| **Website** | [satisfactory-heatmap.com](https://satisfactory-heatmap.com) | Cloudflare Git: `npm run build` → `npx wrangler deploy` |
| **Docker + Releases** | `ghcr.io/tylerr909/satisfactory-heat-map` + GitHub **Releases** | Actions **Release · GHCR**: auto patch tag, image push, release notes |

Container / version details: [CONTRIBUTING.md](../CONTRIBUTING.md#releases--ghcr-automatic).

---

## Pipeline (merge → live)

```
PR → GitHub Actions CI (lint · test · build · Docker smoke)
  ↓ merge to main
  ├─ GitHub Actions CI again (validate only)
  ├─ GitHub Actions Release · GHCR
  │     auto-bump vX.Y.Z (patch)
  │     docker build → push :latest :vX.Y.Z :sha-…
  │     gh release create --generate-notes
  └─ Cloudflare (Git integration)
        npm run build → dist/
        npx wrangler deploy (wrangler.jsonc → ./dist)
        → production URL / custom domain
```

| Trigger | Website | GHCR + GitHub Release |
|---------|---------|------------------------|
| Open / update PR | preview if non-prod builds on | no |
| Merge / push to `main` | **production** | **yes** (auto version) |
| Manual **workflow_dispatch** on Release · GHCR | no | re-run publish for current `main` |

---

## Cloudflare ↔ GitHub handshake (one-time)

Do this **before or right after** the first merge to `main`. Until the project exists and is linked, merges only run GitHub CI.

### 0. Domain already on Cloudflare

You bought **satisfactory-heatmap.com**. Ensure the zone is active in Cloudflare (nameservers at the registrar point at CF, or the domain was registered through CF).

### 1. Create project (Connect to Git)

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → connect **Git**  
   (create a **Worker** / Workers Builds project — **not** a classic **Pages** project. This repo uses `npx wrangler deploy` + `wrangler.jsonc` `assets`, which Pages ignores.)
2. Authorize the Cloudflare GitHub App on **TylerR909**.
3. Grant access to **`TylerR909/satisfactory-heat-map`**.
4. Select that repository.

### 2. Build / deploy settings

| Setting | Value |
|---------|--------|
| **Project / Worker name** | `satisfactory-heat-map` (must match [`wrangler.jsonc`](../wrangler.jsonc) `"name"`) |
| **Production branch** | `main` |
| **Build command** | `npm run build` (runs `map:ensure` → unpacks `map-tiles/v1.tar.gz` when needed) |
| **Deploy command** | `npx wrangler deploy` (dashboard default — keep it) |
| **Root directory** | *(leave empty)* |
| **Builds for non-production branches** | **On** (recommended — PR/preview URLs). Off = only `main` builds. |

**Do not** put `npm run build` in the Deploy command. Build produces `dist/`; deploy publishes it via Wrangler.

**Node version:** [`.nvmrc`](../.nvmrc) is `24`. Optional env: `NODE_VERSION=24` if the build log uses the wrong Node.

### Basemap tiles on Cloudflare

Individual WebPs under `public/map/v1/` are **gitignored**. Cloudflare Git VMs have **no Docker/GDAL**, so the build cannot run `map:generate`.

**MVP approach (keeps CF → Git pull/build — no wrangler login, no GHA secrets):**

1. Commit a ~1.4 MB pack: [`map-tiles/v1.tar.gz`](../map-tiles/v1.tar.gz).
2. `npm run build` always runs `map:ensure` first — unpacks the pack into `public/map/v1/` when WebPs are missing, then Vite copies them into `dist/`.
3. CF dashboard build stays: `npm run build` → `npx wrangler deploy`.

Refresh tiles + open-water only when the basemap source (or water thresholds) change (from a machine with Docker):

```bash
npm run map:generate   # wiki → public/map/v1 WebPs + public/data/water/open-water.json
npm run map:pack       # → map-tiles/v1.tar.gz
git add map-tiles/v1.tar.gz public/data/water/open-water.json
git commit -m "Update basemap tile pack and open-water extract"
# merge to main → CF rebuilds with new tiles + water
```

Open water is a normal committed JSON under `public/data/water/` (not the tile pack). CF Git does not need Docker for it.

After deploy, confirm real WebPs (not SPA HTML):

```bash
curl -sI "https://satisfactory-heatmap.com/map/v1/0/0/0.webp"
# content-type: image/webp
```

If an old deploy cached HTML under `/map/v1/*` (`Cache-Control: immutable`), purge that path or bump to `/map/v2/` after a pack change.

| Other paths | When |
|-------------|------|
| **Docker / GHCR** | Multi-stage image still **generates** tiles with GDAL (does not need the pack) |
| **Optional laptop wrangler** | `npm run map:generate && npm run build && npx wrangler login && npx wrangler deploy` — works once, but the **next CF Git deploy without a committed pack** would drop tiles again. Prefer the pack. |

**Localhost:** `npm run map:generate` once per worktree, **or** `npm run map:ensure` to unpack the committed pack without Docker.

Full runbooks: [`public/map/v1/README.md`](../public/map/v1/README.md).

There is **no** separate “build output directory” field when Deploy is `wrangler deploy` — output is defined in Wrangler:

```jsonc
"assets": { "directory": "./dist" }
```

### 3. When to click **Deploy**

| Situation | What to do |
|-----------|------------|
| `main` is still the empty initial commit | **Skip / cancel** — nothing useful to ship |
| PR has the app + `wrangler.jsonc`, not merged yet | Optional: turn on non-prod builds and deploy the **branch** for a preview URL |
| After merge to `main` | Auto-deploy on push is enough; manual **Deploy** only if you need a re-run |

You do **not** need a successful empty-`main` deploy to “prove” the hook. Linking Git + production branch `main` is enough; the first real production deploy is the merge of this app.

### 4. Custom domain

1. Project → **Custom domains** → **Set up a custom domain**.
2. Enter `satisfactory-heatmap.com` (and optionally `www`).
3. Wait for **Active**. SSL is automatic once DNS is correct.

Recommended: apex as canonical; redirect `www` → apex (or the reverse).

### 5. SEO / AI crawlers (operator)

Crawl files and Open Graph meta ship from the repo (`public/robots.txt`, `sitemap.xml`, `og-image.png`, `index.html`). Cloudflare still owns bot policy and DNS. Full checklist: **[docs/SEO.md](SEO.md)** (AI Crawl Control, managed robots.txt, Search Console, post-deploy smoke curls).

When opening an SEO PR, paste that checklist as a **separate PR comment** so it is not lost in the description.

---

## What the repo provides

| Piece | Role |
|-------|------|
| `.nvmrc` → `24` | Node pin for CF + GitHub Actions |
| `npm run build` | `tsc` + `vite build` → `dist/` |
| `wrangler.jsonc` | Static assets from `./dist`; SPA not-found handling |
| `public/_headers` | Cache + security headers (copied into `dist/`) |
| `public/robots.txt` · `sitemap.xml` · `llms.txt` · `og-image.png` | Crawl + social preview assets ([SEO.md](SEO.md)) |
| `.github/workflows/ci.yml` | Gate on PR + `main` |
| `.github/workflows/docker-publish.yml` | GHCR only — **not** the website |

---

## Operator checklist after each merge

1. GitHub → PR green (CI).
2. Merge to `main`.
3. GitHub Actions: **CI** on `main` green.
4. Cloudflare → **Deployments**: latest commit SHA matches `main`, status **Success**.
5. Smoke: https://satisfactory-heatmap.com — map loads, product heat updates.
6. Hard-refresh once if an old service worker is sticky.

If CF deploy fails:

1. Open the failed deployment log.
2. Confirm Node is 24 and `npm run build` produced `dist/index.html`.
3. Confirm Wrangler step sees `wrangler.jsonc` and uploads `./dist`.
4. Reproduce locally: `npm ci && npm run build && npx wrangler deploy --dry-run` (or full deploy with auth).

---

## What you do **not** need

- Manual upload of `dist/` for day-to-day ship
- Cloudflare API tokens in GitHub for the website path
- Changing Docker / GHCR for the public site

---

## First-ship sequence

1. **GitHub:** Actions workflow permissions **Read and write** (tags + GHCR + Releases).
2. **CF:** connect Git, settings above, domain (optional until first real deploy).
3. **Do not** require a green deploy of empty `main`.
4. **Merge** the app PR to `main` (includes `wrangler.jsonc` + release workflow).
5. CF auto-builds that commit → production URL when DNS is Active.
6. Actions **Release · GHCR** → first image + `v0.1.0` (from `package.json`) Release.
7. GHCR package → **Public** (once).
8. Smoke site + `docker pull ghcr.io/tylerr909/satisfactory-heat-map:latest`.
