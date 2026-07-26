# Deploy

Two ship paths, intentionally separate:

| Surface | What users get | How it ships |
|---------|----------------|--------------|
| **Website** | [satisfactory-heatmap.com](https://satisfactory-heatmap.com) | Cloudflare Git build on every push to `main` |
| **Docker image** | `ghcr.io/tylerr909/satisfactory-heat-map` | GitHub Actions on `v*` tags or manual **workflow_dispatch** |

This doc is the **website** path. Container details: [CONTRIBUTING.md](../CONTRIBUTING.md#publishing-the-container-ghcr).

---

## Pipeline (merge → live)

```
PR → GitHub Actions CI (lint · test · build · Docker smoke)
  ↓ merge to main
  ├─ GitHub Actions CI again (same checks on main)
  └─ Cloudflare Workers Builds (Git integration)
        npm install (from package-lock)
        Build:  npm run build          → dist/
        Deploy: npx wrangler deploy    → assets from dist/ (wrangler.jsonc)
        → *.workers.dev / custom domain
```

GitHub CI **validates** only. Cloudflare **builds and deploys**. Config for deploy lives in [`wrangler.jsonc`](../wrangler.jsonc) (`assets.directory` = `./dist`).

| Trigger | Website | GHCR image |
|---------|---------|------------|
| Open / update PR (non-`main` builds on) | preview URL | no |
| Merge / push to `main` | **production** deploy | no |
| Tag `v*` / manual Docker workflow | no | yes |

---

## Cloudflare ↔ GitHub handshake (one-time)

Do this **before or right after** the first merge to `main`. Until the project exists and is linked, merges only run GitHub CI.

### 0. Domain already on Cloudflare

You bought **satisfactory-heatmap.com**. Ensure the zone is active in Cloudflare (nameservers at the registrar point at CF, or the domain was registered through CF).

### 1. Create project (Connect to Git)

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → connect **Git**.
2. Authorize the Cloudflare GitHub App on **TylerR909**.
3. Grant access to **`TylerR909/satisfactory-heat-map`**.
4. Select that repository.

### 2. Build / deploy settings

| Setting | Value |
|---------|--------|
| **Project / Worker name** | `satisfactory-heat-map` (must match [`wrangler.jsonc`](../wrangler.jsonc) `"name"`) |
| **Production branch** | `main` |
| **Build command** | `npm run build` |
| **Deploy command** | `npx wrangler deploy` (dashboard default — keep it) |
| **Root directory** | *(leave empty)* |
| **Builds for non-production branches** | **On** (recommended — PR/preview URLs). Off = only `main` builds. |

**Do not** put `npm run build` in the Deploy command. Build produces `dist/`; deploy publishes it via Wrangler.

**Node version:** [`.nvmrc`](../.nvmrc) is `24`. Optional env: `NODE_VERSION=24` if the build log uses the wrong Node.

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

---

## What the repo provides

| Piece | Role |
|-------|------|
| `.nvmrc` → `24` | Node pin for CF + GitHub Actions |
| `npm run build` | `tsc` + `vite build` → `dist/` |
| `wrangler.jsonc` | Static assets from `./dist`; SPA not-found handling |
| `public/_headers` | Cache + security headers (copied into `dist/`) |
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

1. **CF:** connect Git, settings above, domain (optional until first real deploy).
2. **Do not** require a green deploy of empty `main`.
3. **Merge** the app PR to `main` (includes `wrangler.jsonc`).
4. CF auto-builds that commit → production URL + custom domain when DNS is Active.
5. Smoke the live site; optional **Docker publish** for GHCR.
