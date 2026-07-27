# Basemap tiles (`/map/v1/`)

XYZ WebP tile pyramid for the Leaflet basemap (`CRS.Simple`, 256×256 tiles, no Y flip).

**Generated `.webp` files are not committed.** Only this README lives in git.

---

## Runtime (default)

| Environment | Tile URL |
|-------------|----------|
| **Production** (Cloudflare / Docker image) | Same-origin `/map/v1/{z}/{x}/{y}.webp` (must be in `dist` at deploy) |
| **Localhost** (`npm start`) | Same-origin `/map/v1/{z}/{x}/{y}.webp` from Vite `public/` |

**Per worktree** (extracted/generated WebPs are gitignored):

```bash
# With Docker (regenerate from wiki):
npm run map:generate
npm start

# Without Docker (unpack the committed ~1.4MB pack — same as Cloudflare builds):
npm run map:ensure
npm start
```

You do **not** need `VITE_MAP_TILES_BASE_URL=/map/v1` — that is already the default.

### Optional: point at production tiles

Only after prod actually serves WebPs (not SPA `index.html`):

```bash
VITE_MAP_TILES_BASE_URL=https://satisfactory-heatmap.com/map/v1 npm start
```

If prod is missing tiles, Cloudflare returns HTML for `/map/v1/*.webp`. Cross-origin that shows up as **`net::ERR_BLOCKED_BY_ORB`** in Chrome — use local generate instead.

---

## Generate from the community wiki map (1.0 path)

**Source:** [satisfactory.wiki.gg Map.jpg](https://satisfactory.wiki.gg/images/Map.jpg) (5000×5000).  
Map artwork © Coffee Stain Studios — used as a public fair-use community reference basemap.  
**Known quirk:** solid white rectangle in the NW / top-left of the wiki image.

**Requirements:** Docker (image `osgeo/gdal:ubuntu-small-3.6.3` — includes `gdal2tiles.py`). No host GDAL install.

```bash
npm run map:generate   # wiki → 4096² → WebP z0–4 → public/map/v1/  (needs Docker)
npm run map:pack       # → map-tiles/v1.tar.gz  (commit this for Cloudflare Git builds)
npm run map:ensure     # unpack pack → public/map/v1/ if WebPs missing (no Docker)
npm run map:clean      # remove generated webps + scratch dirs; keeps this README + pack
```

**Cloudflare:** build runs `map:ensure` automatically via `npm run build`. Keep `map-tiles/v1.tar.gz` in git so previews/production get real `image/webp` (not SPA HTML). No wrangler tokens required.

What `map:generate` does inside Docker:

1. `curl` the wiki JPEG (or use `MAP_INPUT=…` local file)
2. `gdal_translate` resize to 4096×4096 (Lanczos)
3. `gdal2tiles.py --profile=raster --xyz --tiledriver=WEBP … -z 0-4`
4. Copy zoom dirs into `public/map/v1/{z}/{x}/{y}.webp`

Optional env:

| Env | Default | Meaning |
|-----|---------|---------|
| `MAP_SOURCE_URL` | wiki Map.jpg URL | Download source |
| `MAP_INPUT` | _(empty)_ | Local image path instead of download |
| `MAP_TARGET_SIZE` | `4096` | Square resize |
| `MAP_MAX_ZOOM` | `4` | `log2(size/256)` for 4096 |
| `MAP_WEBP_QUALITY` | `80` | WebP quality |
| `MAP_GDAL_IMAGE` | `osgeo/gdal:ubuntu-small-3.6.3` | Docker image pin |

CI and the production Docker image run the same generator so `dist` / nginx always ship tiles.

---

## Higher quality: FModel / Mapareatexture (future)

Not required for 1.0. Use when you want a cleaner ~8k base (less wiki NW artifact).

### 1. Windows hand extract

1. Install [FModel](https://fmodel.app); configure Satisfactory per [Extracting Game Files](https://docs.ficsit.app/satisfactory-modding/latest/Development/ExtractGameFiles.html) (`FactoryGame.usmap`, `CustomVersions.json`, correct UE version).
2. Search packages for: `MapArea`, `MapTexture`, `Mapareatexture`, `Minimap`, `SlicedMap`, or UI map assets under PersistentLevel / GameLevel01.
3. Either:
   - **Save Texture** → PNG, or  
   - **Save Properties (.json)** for `MapareatexturePersistentLevel` (or equivalent).
4. Copy the file to a **gitignored** path, e.g. `data/map/MapareatexturePersistentLevel.json` or `map-source/world-map.png`.

### 2. JSON → PNG (community parser)

[satisfactory-dev/MapareatexturePersistentLevel.json-parser](https://github.com/satisfactory-dev/MapareatexturePersistentLevel.json-parser) (Docker/devcontainer; `make install`, put JSON in `data/`, `make png`).

Yes, a Dockerfile can `git clone` that repo (pin a **commit SHA**), mount your JSON, run `make png`, then feed the PNG into the same `gdal2tiles` stage as the wiki path. Prefer multi-stage: Node parser stage → `osgeo/gdal` tile stage. Do not commit the game JSON.

### 3. Tile the PNG

```bash
MAP_INPUT=map-source/world-map.png MAP_TARGET_SIZE=8192 MAP_MAX_ZOOM=5 npm run map:generate
```

If framing/resolution changes, publish under **`/map/v2/`**, update `meta.json` / `MAX_ZOOM` / dev default URL, and re-deploy.

Optional AI upscale only after you own a clean native extract — not part of the default pipeline.

---

## Attribution

- Map artwork © Coffee Stain Studios.  
- Not affiliated with or endorsed by Coffee Stain Studios.  
- App map corner: thin “Map art © Coffee Stain Studios”.  
- Full credits: planner **Attributions** control + `docs/DATA.md` + `third_party/`.

---

## Versioning

| Prefix | When |
|--------|------|
| `v1` | Wiki 5k → 4096 pyramid (current) |
| `v2+` | New source extract / framing change |

Long cache is safe on versioned paths (`public/_headers` → `/map/v1/*` immutable).
