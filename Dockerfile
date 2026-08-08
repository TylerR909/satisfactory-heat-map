# Multi-stage: basemap tiles (GDAL) → open-water → Rust/WASM → Vite → nginx.
# Final image is static assets only (compiled .wasm in dist/) — no rustc at runtime.
# Never install Rust on the developer host; this image and the Dev Container own the toolchain.

ARG GDAL_IMAGE=osgeo/gdal:ubuntu-small-3.6.3
ARG NODE_IMAGE=node:24-bookworm-slim
ARG RUST_IMAGE=rust:1-bookworm

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

# ── 1c) Rust → WASM (compile-on-build; not committed) ───────────────────────
FROM ${RUST_IMAGE} AS wasm
WORKDIR /workspace
ENV CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:$PATH
RUN rustup target add wasm32-unknown-unknown \
  && curl -fsSL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
COPY crates ./crates
RUN wasm-pack build crates/engine --target bundler --out-dir pkg --release \
  && test -f crates/engine/pkg/sf_engine_bg.wasm \
  && ls -la crates/engine/pkg/sf_engine_bg.wasm

# ── 2) Node production build ────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: skip prepare/lefthook (needs git + full tree; not useful in the image)
RUN npm ci --ignore-scripts
COPY . .
# Prebuilt WASM from rust stage (skip host/docker wasm-build inside Node image)
COPY --from=wasm /workspace/crates/engine/pkg/ /app/crates/engine/pkg/
# Inject GDAL-generated tiles (not stored in git)
COPY --from=tiles /work/public/map/v1/ /app/public/map/v1/
# Prefer freshly extracted open-water over any committed copy
COPY --from=water /work/public/data/water/open-water.json /app/public/data/water/open-water.json
# Skip wasm-build script (already have pkg); map:ensure + tsc + vite
ENV SKIP_WASM_BUILD=1
RUN node scripts/map-ensure-tiles.mjs \
  && npx tsc -p tsconfig.app.json --noEmit \
  && npx vite build \
  && test -f dist/map/v1/0/0/0.webp \
  && test -f dist/data/water/open-water.json

# ── 3) nginx static ─────────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
