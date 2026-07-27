# Multi-stage: basemap tiles (GDAL) → Vite build → nginx static.
# Tiles are build artifacts (not in git).

ARG GDAL_IMAGE=osgeo/gdal:ubuntu-small-3.6.3

# ── 1) Wiki Map.jpg → public/map/v1 WebP pyramid ───────────────────────────
FROM ${GDAL_IMAGE} AS tiles
WORKDIR /work
COPY scripts/map-generate-inner.sh /work/scripts/map-generate-inner.sh
RUN chmod +x /work/scripts/map-generate-inner.sh \
  && mkdir -p /work/public/map/v1 \
  && bash /work/scripts/map-generate-inner.sh

# ── 2) Node production build ────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Inject GDAL-generated tiles (not stored in git)
COPY --from=tiles /work/public/map/v1/ /app/public/map/v1/
RUN npm run build \
  && test -f dist/map/v1/0/0/0.webp

# ── 3) nginx static ─────────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
