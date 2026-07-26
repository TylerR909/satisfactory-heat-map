# Deploy

Two ship paths, intentionally separate:

| Surface | What users get | How it ships |
|---------|----------------|--------------|
| **Website** | [satisfactory-heatmap.com](https://satisfactory-heatmap.com) | Cloudflare Pages builds `dist/` on every push to `main` |
| **Docker image** | `ghcr.io/tylerr909/satisfactory-heat-map` | GitHub Actions on `v*` tags or manual **workflow_dispatch** |

This doc is the **website** path. Container details: [CONTRIBUTING.md](../CONTRIBUTING.md#publishing-the-container-ghcr).

---

## Pipeline (merge → live)

```
PR → GitHub Actions CI (lint · test · build · Docker smoke)
  ↓ merge to main
  ├─ GitHub Actions CI again (same checks on main)
  └─ Cloudflare Pages (Git integration)
        npm install (from package-lock)
        npm run build          → dist/
        publish dist/ + public/_headers
        → *.pages.dev  and  custom domain
```

**There is no Wrangler / upload-from-Actions deploy.** Cloudflare pulls the repo, builds, and publishes. GitHub CI validates; CF deploys.

| Trigger | Website | GHCR image |
|---------|---------|------------|
| Open / update PR | preview deploy *if* enabled in CF | no |
| Merge to `main` | **production** Pages deploy | no |
| Tag `v*` / manual Docker workflow | no | yes |

---

## Cloudflare ↔ GitHub handshake (one-time)

Do this **before or right after** the first merge to `main`. Until the Pages project exists and is linked, merges only run GitHub CI.

### 0. Domain already on Cloudflare

You bought **satisfactory-heatmap.com**. Ensure the zone is active in Cloudflare (nameservers at the registrar point at CF, or the domain was registered through CF).

### 1. Create the Pages project (Git)

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorize the **Cloudflare Pages** GitHub App on account **TylerR909** (or the org that owns the repo).
3. Grant access to **`TylerR909/satisfactory-heat-map`** (only this repo is fine).
4. Select that repository.

### 2. Build settings (must match the repo)

| Setting | Value |
|---------|--------|
| **Project name** | `satisfactory-heat-map` (or similar; becomes `*.pages.dev`) |
| **Production branch** | `main` |
| **Framework preset** | Vite (optional; settings below matter more) |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | *(leave empty)* |
| **Build system version** | **v3** (current default) |

**Node version:** repo root [`.nvmrc`](../.nvmrc) is `24`. Pages reads `.nvmrc` / `.node-version` (or `NODE_VERSION` env). No dashboard Node pin is required if `.nvmrc` is present.

Optional env vars (Settings → Environment variables → **Production**):

| Variable | Value | When |
|----------|-------|------|
| `NODE_VERSION` | `24` | Only if a build log shows the wrong Node despite `.nvmrc` |
| `SKIP_DEPENDENCY_INSTALL` | *(unset)* | Leave unset so Pages runs its install from the lockfile |

Save / **Save and Deploy**. The first deploy may fail until `main` has the app (not only the initial empty commit) — that is expected if you connect before merging this PR.

### 3. Custom domain

1. Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter `satisfactory-heatmap.com` (and optionally `www.satisfactory-heatmap.com`).
3. Cloudflare will add the DNS record(s) in the same zone (usually a CNAME to the Pages project, or apex handling via CF).
4. Wait for **Active**. SSL is automatic once DNS is correct.

Recommended: apex `satisfactory-heatmap.com` as the canonical host; redirect `www` → apex (or the reverse) in Custom domains / Redirect Rules.

### 4. Preview deploys (optional but useful)

Under Pages **Settings** → **Builds & deployments**:

- **Preview deployments:** enable for non-`main` branches / PRs if you want a unique `*.pages.dev` URL per PR.
- Production always tracks **`main`**.

---

## What the repo already provides

| Piece | Role |
|-------|------|
| `.nvmrc` → `24` | Node pin for CF Pages + GitHub Actions |
| `package.json` `engines.node` ≥ 24 | Local / CI consistency |
| `npm run build` | `tsc` typecheck + `vite build` → `dist/` |
| `public/_headers` | Cache + basic security headers on Pages |
| `.github/workflows/ci.yml` | Gate: lint, test, build, Docker smoke on PR + `main` |
| `.github/workflows/docker-publish.yml` | **Not** the website — GHCR only |

No `_redirects` catch-all: the app is a single-route SPA (plan state lives in the URL **hash**). A `/* → /index.html` proxy on Pages would also rewrite real `/assets/*` files; we do not use one.

---

## Operator checklist after each merge

1. GitHub → PR green (CI).
2. Merge to `main`.
3. GitHub Actions: **CI** on `main` green.
4. Cloudflare → Pages project → **Deployments**: latest commit SHA matches `main`, status **Success**.
5. Smoke: open https://satisfactory-heatmap.com — map loads, pick a product, heat updates.
6. Hard-refresh once if an old service worker is sticky (`sw.js` is no-cache).

If CF build fails:

1. Open the failed deployment log in Pages.
2. Confirm Node is 24 (`node -v` in the log).
3. Confirm install used the lockfile and `npm run build` produced `dist/index.html`.
4. Reproduce locally: `npm ci && npm run build`.

---

## What you do **not** need

- Manual `wrangler pages deploy` for day-to-day ship
- Storing Cloudflare API tokens in GitHub for the website path
- Uploading `dist/` by hand (Direct Upload) — Git integration replaces that
- Changing Docker / GHCR for the public site (that image is self-host only)

---

## First-ship sequence (this release)

1. **You:** finish CF steps 1–3 above (connect Git, build settings, domain). Connecting before merge is fine.
2. **This PR:** merges the full app onto `main`.
3. **Automatic:** CF builds that commit and publishes to `*.pages.dev` + custom domain once DNS is Active.
4. **You:** smoke the live domain; if GHCR is needed, run **Docker publish** once and set the package **Public**.
