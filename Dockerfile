# Multi-stage: basemap tiles (GDAL) → open-water (Node/sharp) → Vite → nginx.
# Tiles are build artifacts (not in git). Open-water JSON is also regenerated
# here so the image matches the wiki map; committed open-water.json is the
# CF/npm path when map:generate is not run.

ARG GDAL_IMAGE=osgeo/gdal:ubuntu-small-3.6.3
ARG NODE_IMAGE=node:24-bookworm-slim

# ── 1) Wiki Map.jpg → public/map/v1 WebP pyramid + Map-{SIZE}.png ───────────
FROM ${GDAL_IMAGE} AS tiles
WORKDIR /work
COPY scripts/map-generate-inner.sh /work/scripts/map-generate-inner.sh
RUN chmod +x /work/scripts/map-generate-inner.sh \
  && mkdir -p /work/public/map/v1 \
  && bash /work/scripts/map-generate-inner.sh

# ── 1b) Open-water bodies from the same source PNG ─────────────────────────
FROM ${NODE_IMAGE} AS water
WORKDIR /work
COPY --from=tiles /work/map-source/ /work/map-source/
COPY scripts/map-extract-water.mjs /work/scripts/map-extract-water.mjs
RUN npm install --no-save --no-fund --no-audit sharp@0.33.5 \
  && mkdir -p /work/public/data/water \
  && node scripts/map-extract-water.mjs \
  && test -f /work/public/data/water/open-water.json

# ── 2) Node production build ────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: skip prepare/lefthook (needs git + full tree; not useful in the image)
RUN npm ci --ignore-scripts
COPY . .
# Inject GDAL-generated tiles (not stored in git)
COPY --from=tiles /work/public/map/v1/ /app/public/map/v1/
# Prefer freshly extracted open-water over any committed copy
COPY --from=water /work/public/data/water/open-water.json /app/public/data/water/open-water.json
RUN npm run build \
  && test -f dist/map/v1/0/0/0.webp \
  && test -f dist/data/water/open-water.json

# ── 3) nginx static ─────────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
