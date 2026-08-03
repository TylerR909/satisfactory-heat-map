#!/usr/bin/env bash
# Runs *inside* the osgeo/gdal container (cwd = repo root mounted at /work).
# Downloads wiki Map.jpg → resizes → XYZ WebP pyramid → public/map/v1/
# Leaves map-source/Map-{SIZE}.png for the open-water extract step (Node).
#
# MAP_SKIP_TILES=1 → only ensure the resized PNG (faster water re-extract).
set -euo pipefail

SOURCE_URL="${MAP_SOURCE_URL:-https://satisfactory.wiki.gg/images/Map.jpg}"
TARGET_SIZE="${MAP_TARGET_SIZE:-4096}"
MAX_ZOOM="${MAP_MAX_ZOOM:-4}"
WEBP_QUALITY="${MAP_WEBP_QUALITY:-80}"
OUT_DIR="${MAP_OUT_DIR:-public/map/v1}"
WORK_DIR="${MAP_WORK_DIR:-map-source}"
TILES_TMP="${MAP_TILES_TMP:-dist-map-tiles}"
SKIP_TILES="${MAP_SKIP_TILES:-0}"

# Optional local override (host path mounted into /work)
INPUT_OVERRIDE="${MAP_INPUT:-}"

mkdir -p "$WORK_DIR" "$OUT_DIR"

SOURCE_JPG="$WORK_DIR/Map.jpg"
SOURCE_PNG="$WORK_DIR/Map-${TARGET_SIZE}.png"

if [[ -n "$INPUT_OVERRIDE" && -f "$INPUT_OVERRIDE" ]]; then
  echo "Using local input: $INPUT_OVERRIDE"
  # Normalize to PNG at target size via gdal
  gdal_translate -q -of PNG -outsize "$TARGET_SIZE" "$TARGET_SIZE" -r lanczos \
    "$INPUT_OVERRIDE" "$SOURCE_PNG"
else
  echo "Downloading $SOURCE_URL …"
  curl -fsSL -o "$SOURCE_JPG" "$SOURCE_URL"
  # Quick sanity: file should be non-trivial
  size=$(wc -c <"$SOURCE_JPG" | tr -d ' ')
  if [[ "$size" -lt 100000 ]]; then
    echo "error: downloaded file looks too small (${size} bytes)" >&2
    exit 1
  fi
  echo "Resizing to ${TARGET_SIZE}×${TARGET_SIZE} …"
  gdal_translate -q -of PNG -outsize "$TARGET_SIZE" "$TARGET_SIZE" -r lanczos \
    "$SOURCE_JPG" "$SOURCE_PNG"
fi

if [[ ! -f "$SOURCE_PNG" ]]; then
  echo "error: expected source PNG at $SOURCE_PNG" >&2
  exit 1
fi
echo "Source map ready: $SOURCE_PNG"

if [[ "$SKIP_TILES" == "1" ]]; then
  echo "MAP_SKIP_TILES=1 — skipping WebP pyramid (PNG kept for water extract)"
  exit 0
fi

echo "Generating WebP XYZ tiles z0–${MAX_ZOOM} …"
rm -rf "$TILES_TMP"
mkdir -p "$TILES_TMP"

gdal2tiles.py \
  --profile=raster \
  --xyz \
  --tiledriver=WEBP \
  --webp-quality="$WEBP_QUALITY" \
  --resampling=lanczos \
  -z "0-${MAX_ZOOM}" \
  --processes="${MAP_PROCESSES:-2}" \
  -q \
  "$SOURCE_PNG" \
  "$TILES_TMP"

# Preserve README; replace only tile tree + drop gdal HTML/XML helpers
find "$OUT_DIR" -type f ! -name 'README.md' -delete 2>/dev/null || true
find "$OUT_DIR" -type d -empty -delete 2>/dev/null || true

# Copy zoom-level dirs only (skip googlemaps.html, leaflet.html, tilemapresource.xml, etc.)
shopt -s nullglob
for zdir in "$TILES_TMP"/[0-9]*; do
  base=$(basename "$zdir")
  mkdir -p "$OUT_DIR/$base"
  cp -a "$zdir"/. "$OUT_DIR/$base/"
done
shopt -u nullglob

# Sanity check
if [[ ! -f "$OUT_DIR/0/0/0.webp" ]]; then
  echo "error: expected $OUT_DIR/0/0/0.webp after generation" >&2
  exit 1
fi

count=$(find "$OUT_DIR" -name '*.webp' | wc -l | tr -d ' ')
echo "Done: ${count} WebP tiles → ${OUT_DIR}/ (z0–${MAX_ZOOM})"
echo "Spot-check: ${OUT_DIR}/0/0/0.webp"
