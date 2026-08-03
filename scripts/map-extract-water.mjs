#!/usr/bin/env node
/**
 * Open-water bodies from basemap pixels (no Python).
 *
 * Input:  map-source/Map-{SIZE}.png (produced by map-generate-inner.sh / GDAL)
 * Output: public/data/water/open-water.json
 *
 * Invoked by map:generate (same pipeline as tiles). Uses `sharp` when available
 * (Docker node stage installs it ephemerally; not a runtime app dependency).
 *
 * Calibration: known pond near (-6000, +242000) ≈ 4 Water Extractors @ 100%.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Match src/lib/coords.ts */
const WORLD_X_MIN = -324_700;
const WORLD_X_MAX = 425_300;
const WORLD_Y_MIN = -375_000;
const WORLD_Y_MAX = 375_000;
const X_RANGE = WORLD_X_MAX - WORLD_X_MIN;
const Y_RANGE = WORLD_Y_MAX - WORLD_Y_MIN;

/** Pond that supports ~4 extractors @ 100% (user calibration anchor). */
const ANCHOR = { x: -6000, y: 242_000, slots: 4 };

const TARGET_SIZE = Number(process.env.MAP_TARGET_SIZE || 4096);
const WORK_DIR = process.env.MAP_WORK_DIR || "map-source";
const OUT_PATH =
  process.env.MAP_WATER_OUT || path.join(root, "public", "data", "water", "open-water.json");
const DEBUG_MASK = process.env.MAP_WATER_DEBUG_MASK === "1";

const INPUT_PNG =
  process.env.MAP_WATER_INPUT || path.join(root, WORK_DIR, `Map-${TARGET_SIZE}.png`);

/** Min component area (px) after morphology before it becomes a body. */
const MIN_AREA_PX = Number(process.env.MAP_WATER_MIN_AREA || 40);
/** Erode/dilate radius in px to break thin river bridges (1 keeps ponds). */
const OPEN_RADIUS = Number(process.env.MAP_WATER_OPEN_RADIUS || 1);
/** Max surface samples per body for distance/capacity split. */
const MAX_SAMPLES = Number(process.env.MAP_WATER_MAX_SAMPLES || 24);
/**
 * Soft cap on slots for a single body. Oceans are huge after area×k; a high
 * cap still acts “effectively unlimited” for normal plans while avoiding
 * absurd numbers. Capacity is sampled across surface points for haul.
 */
const MAX_SLOTS = Number(process.env.MAP_WATER_MAX_SLOTS || 2000);

function die(msg) {
  console.error(`[map:water] ${msg}`);
  process.exit(1);
}

async function loadSharp() {
  const require = createRequire(import.meta.url);
  try {
    return require("sharp");
  } catch {
    /* try dynamic import from cwd node_modules */
  }
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch {
    die(
      "sharp is required for water extract. map:generate installs it in Docker; " +
        "or: npm install --no-save sharp && node scripts/map-extract-water.mjs",
    );
  }
}

/** Game cm → pixel (row 0 = north / top of wiki map). */
function worldToPixel(x, y, size) {
  const px = ((x - WORLD_X_MIN) / X_RANGE) * size;
  const py = ((y - WORLD_Y_MIN) / Y_RANGE) * size;
  return { px, py };
}

function pixelToWorld(px, py, size) {
  const x = WORLD_X_MIN + (px / size) * X_RANGE;
  const y = WORLD_Y_MIN + (py / size) * Y_RANGE;
  return { x, y };
}

/**
 * Basemap water is a distinct blue-cyan (ponds ~63,156,180; land is beige/grey).
 * Tuned against wiki Map.jpg + the calibration pond near (-6000, +242000).
 * Not in-game navigable depth — approximate placement capacity only.
 */
function isWaterPixel(r, g, b) {
  // Bright-enough blue channel, not void black / not blown-out
  if (b <= 100 || b >= 220) return false;
  // Red stays low on water fills
  if (r >= 120) return false;
  // Blue leads green and red (cyan/blue lakes & coasts)
  if (b <= g + 15) return false;
  if (b <= r + 30) return false;
  return true;
}

function idx(x, y, w) {
  return y * w + x;
}

/** Binary erode: keep water only if full square neighborhood is water. */
function erode(mask, w, h, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[idx(x, y, w)]) continue;
      let ok = 1;
      for (let dy = -radius; dy <= radius && ok; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[idx(nx, ny, w)]) {
            ok = 0;
            break;
          }
        }
      }
      out[idx(x, y, w)] = ok;
    }
  }
  return out;
}

/** Binary dilate. */
function dilate(mask, w, h, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[idx(x, y, w)]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[idx(nx, ny, w)] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * 4-connected components. Returns array of { id, pixels: [{x,y}], area, cx, cy }.
 */
function connectedComponents(mask, w, h) {
  const seen = new Uint8Array(mask.length);
  const bodies = [];
  let nextId = 0;
  const qx = new Int32Array(mask.length);
  const qy = new Int32Array(mask.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = idx(x, y, w);
      if (!mask[start] || seen[start]) continue;

      let qh = 0;
      let qt = 0;
      qx[qt] = x;
      qy[qt] = y;
      qt++;
      seen[start] = 1;

      const pixels = [];
      let sumX = 0;
      let sumY = 0;

      while (qh < qt) {
        const cx = qx[qh];
        const cy = qy[qh];
        qh++;
        pixels.push({ x: cx, y: cy });
        sumX += cx;
        sumY += cy;

        const nbs = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of nbs) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = idx(nx, ny, w);
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[qt] = nx;
          qy[qt] = ny;
          qt++;
        }
      }

      const area = pixels.length;
      bodies.push({
        id: `ow_${String(nextId++).padStart(4, "0")}`,
        pixels,
        area,
        cx: sumX / area,
        cy: sumY / area,
      });
    }
  }
  return bodies;
}

/**
 * Surface samples for haul distance. Small ponds keep a single centroid so
 * capacity is not shredded across many 20/min stubs; large coasts spread
 * capacity along the shoreline.
 */
function pickSamples(pixels, cx, cy, slots, maxSamples) {
  if (slots <= 6 || pixels.length < 200) {
    return [{ x: cx, y: cy }];
  }
  const n = Math.min(maxSamples, Math.max(4, Math.ceil(slots / 8)));
  if (pixels.length <= n) {
    return pixels.map((p) => ({ x: p.x, y: p.y }));
  }
  const stride = Math.ceil(pixels.length / n);
  const out = [];
  for (let i = 0; i < pixels.length && out.length < n; i += stride) {
    out.push(pixels[i]);
  }
  return out;
}

async function main() {
  if (!existsSync(INPUT_PNG)) {
    die(`missing input PNG: ${INPUT_PNG}\n  Run map:generate (GDAL step) first.`);
  }

  const sharp = await loadSharp();
  const pngBuf = readFileSync(INPUT_PNG);
  const sourceHash = createHash("sha256").update(pngBuf).digest("hex").slice(0, 16);

  const { data, info } = await sharp(pngBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  if (w !== h) {
    console.warn(`[map:water] non-square map ${w}×${h}; using width for world mapping`);
  }
  const size = w;

  console.log(`[map:water] scanning ${w}×${h} (${sourceHash})…`);

  const mask = new Uint8Array(w * h);
  let waterPx = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (isWaterPixel(data[p], data[p + 1], data[p + 2])) {
      mask[i] = 1;
      waterPx++;
    }
  }
  console.log(`[map:water] raw water pixels: ${waterPx}`);

  // Morphological open: break thin river links, drop hairlines
  let cleaned = erode(mask, w, h, OPEN_RADIUS);
  cleaned = dilate(cleaned, w, h, OPEN_RADIUS);

  let cleanedCount = 0;
  for (let i = 0; i < cleaned.length; i++) if (cleaned[i]) cleanedCount++;
  console.log(`[map:water] after open(r=${OPEN_RADIUS}): ${cleanedCount} px`);

  const components = connectedComponents(cleaned, w, h).filter((c) => c.area >= MIN_AREA_PX);
  console.log(`[map:water] components (≥${MIN_AREA_PX} px): ${components.length}`);

  // Locate anchor pond component (pixel may sit on shore; search nearby water)
  const ap = worldToPixel(ANCHOR.x, ANCHOR.y, size);
  const ax = Math.round(ap.px);
  const ay = Math.round(ap.py);
  /** @type {Map<string, typeof components[0]>} */
  const pixelOwner = new Map();
  for (const c of components) {
    for (const p of c.pixels) {
      pixelOwner.set(`${p.x},${p.y}`, c);
    }
  }
  let anchorComp = null;
  outer: for (let rad = 0; rad <= 12; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const hit = pixelOwner.get(`${ax + dx},${ay + dy}`);
        if (hit) {
          anchorComp = hit;
          if (rad > 0) {
            console.log(
              `[map:water] anchor at shore offset (${dx},${dy}) → ${hit.id} area=${hit.area}px`,
            );
          }
          break outer;
        }
      }
    }
  }
  // Fallback: nearest component centroid to anchor
  if (!anchorComp && components.length) {
    let best = components[0];
    let bestD = Infinity;
    for (const c of components) {
      const d = (c.cx - ax) ** 2 + (c.cy - ay) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    anchorComp = best;
    console.warn(
      `[map:water] anchor pixel not in mask; using nearest component ${anchorComp.id} ` +
        `(area=${anchorComp.area}px, d²=${bestD.toFixed(0)})`,
    );
  }

  if (!anchorComp || anchorComp.area <= 0) {
    die("could not find calibration anchor component near pond (-6000, 242000)");
  }

  const k = ANCHOR.slots / anchorComp.area;
  console.log(
    `[map:water] calibration: ${anchorComp.id} area=${anchorComp.area}px → ${ANCHOR.slots} slots (k=${k.toExponential(4)})`,
  );

  const bodies = [];
  for (const c of components) {
    let slots = Math.round(k * c.area);
    if (slots < 1 && c.area >= MIN_AREA_PX) {
      // Keep tiny-but-real puddles only if round would zero them and area is solid
      if (k * c.area >= 0.4) slots = 1;
      else continue;
    }
    if (slots < 1) continue;
    slots = Math.min(MAX_SLOTS, slots);

    const worldC = pixelToWorld(c.cx, c.cy, size);
    const samplePx = pickSamples(c.pixels, c.cx, c.cy, slots, MAX_SAMPLES);
    const samples = samplePx.map((p) => {
      const ww = pixelToWorld(p.x + 0.5, p.y + 0.5, size);
      return [Math.round(ww.x), Math.round(ww.y)];
    });

    const body = {
      id: c.id,
      slots,
      x: Math.round(worldC.x),
      y: Math.round(worldC.y),
      areaPx: c.area,
      ...(c === anchorComp ? { calibrationAnchor: true } : {}),
    };
    // Omit samples when they collapse to the centroid (smaller JSON)
    if (samples.length > 1) {
      body.samples = samples;
    }
    bodies.push(body);
  }

  bodies.sort((a, b) => b.slots - a.slots || a.id.localeCompare(b.id));

  const totalSlots = bodies.reduce((s, b) => s + b.slots, 0);
  const anchorOut = bodies.find((b) => b.calibrationAnchor);
  console.log(
    `[map:water] bodies=${bodies.length} totalSlots=${totalSlots}` +
      (anchorOut ? ` anchorSlots=${anchorOut.slots}` : ""),
  );

  const out = {
    version: 1,
    extractorRateAt100: 120,
    source: {
      path: path.relative(root, INPUT_PNG),
      width: w,
      height: h,
      hash: sourceHash,
    },
    bounds: {
      minX: WORLD_X_MIN,
      maxX: WORLD_X_MAX,
      minY: WORLD_Y_MIN,
      maxY: WORLD_Y_MAX,
    },
    calibration: {
      anchorX: ANCHOR.x,
      anchorY: ANCHOR.y,
      anchorSlots: ANCHOR.slots,
      k,
      openRadius: OPEN_RADIUS,
      minAreaPx: MIN_AREA_PX,
      maxSlots: MAX_SLOTS,
      notes:
        "slots ≈ round(k × areaPx); k from pond near (-6000,+242000) ≈ 4 extractors @ 100%. Approximate from basemap blue, not game depth.",
    },
    bodies: bodies.map(({ id, slots, x, y, areaPx, samples, calibrationAnchor }) => ({
      id,
      slots,
      x,
      y,
      areaPx,
      samples,
      ...(calibrationAnchor ? { calibrationAnchor: true } : {}),
    })),
  };

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[map:water] wrote ${path.relative(root, OUT_PATH)}`);

  if (DEBUG_MASK) {
    const debugPath = path.join(root, WORK_DIR, `water-mask-${size}.png`);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < cleaned.length; i++) {
      const o = i * 4;
      if (cleaned[i]) {
        rgba[o] = 30;
        rgba[o + 1] = 144;
        rgba[o + 2] = 255;
        rgba[o + 3] = 255;
      } else {
        rgba[o + 3] = 0;
      }
    }
    await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toFile(debugPath);
    console.log(`[map:water] debug mask → ${path.relative(root, debugPath)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
