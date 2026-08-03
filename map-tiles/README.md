# Committed basemap pack

`v1.tar.gz` (~1.4 MB) holds the XYZ WebP pyramid (zoom dirs only).

- **Why:** Cloudflare Git builds cannot run Docker/GDAL. `npm run build` → `map:ensure` unpacks this into `public/map/v1/` so `dist` ships real `image/webp` files.
- **Refresh:** `npm run map:generate && npm run map:pack`, then commit `v1.tar.gz`.
- **Open water** is a separate committed artifact: `public/data/water/open-water.json` (also produced by `map:generate`). Commit it when basemap art or water thresholds change.
- **Do not** commit individual WebPs under `public/map/v1/` (gitignored).

See `public/map/v1/README.md` and `docs/DEPLOY.md`.
