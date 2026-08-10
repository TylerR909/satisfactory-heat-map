# Share hash (public wire format)

**Version:** `v1`  
**Codec:** [`src/lib/planHash.ts`](../src/lib/planHash.ts)  
**Catalogs:** `public/data/recipes/itemIds.json`, `recipeIds.json`, `recipePrimaries.json` (also under `src/data/` for the app bundle)  
**Vendoring / Open in Heatmap:** [SHARE_HASH_VENDORING.md](./SHARE_HASH_VENDORING.md)

This document is the open contract for shareable plan links:

```text
https://satisfactory-heatmap.com/#v1.<base64url-payload>
```

The algorithm is intentional open-source surface area: other Satisfactory tools may build **“Open in Heatmap”** links. There is no secret keying or server round-trip.

## Design principles

1. **Single binary blob** + base64url — not pipe-delimited sections. Optional fields are **omitted** when default (seed, extractors, empty lists). That is denser than `seed|plan|config` and one decode path for implementers.
2. **Indices, not names.** Items and recipes are `u8` / `u16` into **append-only** catalogs. ClassName strings never appear on the wire.
3. **Sparse Mode B.** Only top-level targets, off-site marks, and non-default recipe picks are stored. The intermediate tree is **recomputed** from Docs recipes on load.
4. **Mode A first for interop.** Raw demand is fully specified and trivial for calculators to emit. Mode B intent helpers exist; full parity with every planner’s graph is a stretch goal.

## Alphabet

**base64url** (`A–Z a–z 0–9 - _`, no padding). ~6 bits/character. Prefer this over hex (~4 bits/char). Base62 is essentially tied with base64url and not worth a custom alphabet.

## Catalogs (append-only)

| File | Content | Wire width |
|------|---------|------------|
| `itemIds.json` | Ordered item ClassNames | index as **u8** |
| `recipeIds.json` | Ordered recipe ClassNames | index as **u16** LE |
| `recipePrimaries.json` | recipe → primary product (builder helper) | not on wire |

**Stability rule:** existing indices never change. `npm run parse-docs` **appends** new ClassNames only. Do not re-sort the whole table.  
CI pins known ClassName → index slots in `src/lib/planHash.test.ts` (“append-only contract”) so accidental renumber fails loudly.

Raw Mode A resources also use the fixed picker table in `RAW_RESOURCE_OPTIONS` (`src/lib/resources.ts`) — same order as the Raw mode UI (~13 ores/fluids).

## URL shape

```text
v1.<payload>
```

- Prefix `v1.` is required.
- Leading `#` is accepted by the decoder.
- Unknown versions decode as failure (no silent fallback).

## Binary layout

All multi-byte integers are **little-endian**. Rates are `u16` items/min (0…65535).

### Header (5 bytes)

| Offset | Type | Field |
|-------:|------|--------|
| 0 | u8 | **flags** (see below) |
| 1 | u8 | Miner clock % (50–250) |
| 2–3 | u16 | Packed scoring knobs |
| 4 | u8 | Counts: `nRaw` in low nibble, `nProd` in high nibble (0–15 each) |

### Flags (byte 0)

| Bit | Meaning |
|----:|---------|
| 0 | `1` = product mode (Mode B), `0` = raw mode (Mode A) |
| 1 | `1` = weighted scoring, `0` = centered |
| 2 | `1` = flat haul (`includeElevation = false`) |
| 3–4 | Miner Mk: `0`→Mk1, `1`→Mk2, `2`→Mk3 |
| 5 | `FLAG_HAS_SEED` — i32 seed follows demand |
| 6 | `FLAG_HAS_EXTERNAL` — external item list follows |
| 7 | `FLAG_HAS_EXTRACTOR_EXT` — water/well/oil clocks follow (only if non-default) |

### Packed knobs (bytes 2–3)

```text
bits 0–4:   centerPower  quantized 1.00 + q×0.05, q=0…30
bits 5–7:   topN         3 + n, n=0…7  → topN 3…10
bits 8–12:  siteSep      0.04 + q×0.02, q=0…18
bits 13–15: reserved (0)
```

### Demand

**Mode A (raw)** — `nRaw` triples:

```text
rawIndex u8   // index into RAW_RESOURCE_OPTIONS
rate     u16
```

**Mode B (product)** — `nProd` triples:

```text
itemIndex u8  // index into itemIds.json
rate      u16
```

Only the **active** mode’s lines are present (`nRaw` or `nProd` is zero).

### Optional tails (in order)

1. **Seed** (if `FLAG_HAS_SEED`): `i32` map seed. Omitted when Default/vanilla (`null`). Seed `0` is a valid randomized world and **is** encoded.
2. **Externals** (if `FLAG_HAS_EXTERNAL`): `n u8`, then `n` × `itemIndex u8`. Mode B off-site intermediates (and Water). Sorted by ClassName at encode time.
3. **Extractors** (if `FLAG_HAS_EXTRACTOR_EXT`):  
   `waterClock u8`, `wellClock u8`, `wellsEnabled u8` (bit0), `oilClock u8`.  
   Omitted when all match app defaults (Mk clocks 250%, wells on).
4. **Recipe overrides** (if any bytes remain):  
   `n u8`, then `n` × (`itemIndex u8`, `recipeIndex u16`).  
   Only **non-default** Mode B picks. Product → recipe ClassName after catalog lookup.

Display-only fields (heat opacity, paint, node visibility, expansion sort order, …) are **never** encoded.

## What is not in the hash

- Full intermediate / expand trees (recomputed client-side)
- Default recipes (absence = default)
- Default map seed and default extractor extension (omitted)
- Backend storage or content-addressed short ids

## TypeScript API (this repo)

```ts
import {
  encodePlanHash,
  decodePlanHash,
  encodeRawPlanHash,
  encodeProductPlanHash,
} from "@/lib/planHash";

// Full snapshot (app path)
encodePlanHash({ mode, rawDemand, productTargets, miner, scoringMode, scoringOptions, seed, externalItems, recipeOverrides });

// Mode A — preferred external interop
encodeRawPlanHash([
  { resource: "Desc_OreIron_C", itemsPerMinute: 1200 },
  { resource: "Desc_OreCopper_C", itemsPerMinute: 600 },
]);

// Mode B stretch — targets + alternate recipe ClassNames (primary product mapping)
encodeProductPlanHash(
  [{ item: "Desc_ComputerSuper_C", itemsPerMinute: 4 }],
  { alternateRecipes: ["Recipe_Alternate_OCSupercomputer_C"] },
);
```

### Mode A example (conceptual)

After encode, a short link looks like:

```text
#v1.Awr…   // length typically ~20–40 chars for a few raw lines
```

Any tool that has already solved production to **raw ore/fluid rates** can emit Mode A without knowing heatmap expand order.

### Mode B notes (stretch)

- Wire format stores **item index + recipe index**, not recipe display names.
- `encodeProductPlanHash` maps each alternate recipe to its **primary product** via `recipePrimaries.json`. Byproduct-selectable paths should pass explicit `recipeOverrides: { [itemId]: recipeId }`.
- External tools do **not** need to reimplement Intermediates panel BFS order.
- We do not currently define a separate “foreign factory graph” import format.

## Length expectations (v1)

| Plan | Typical `#v1.…` length |
|------|------------------------:|
| Single product, defaults | ~15–25 |
| + seed + few alts | ~35–55 |
| Multi-product + several alts | ~55–80 |
| Soft caps (15 lines / 15 ext / 20 alts) | ≲ ~150 |

## Why not pipes / hex / full tree digits?

| Idea | Why we skipped it |
|------|-------------------|
| `seed\|plan\|config` | Optional tails already drop defaults; pipes add parsing without density |
| Hex | 4 bits/char vs 6 for base64url |
| Digit string of every intermediate | Defaults free today; tree order/length changes when you pick alts (e.g. OC Supercomputer) |
| Crypto short id + storage | Breaks offline pure-static share |

## Versioning

- Increment `PLAN_HASH_VERSION` / URL prefix on breaking layout or catalog renumber (renumber is forbidden; prefer append).
- Beta may hard-cut without reading older prefixes.

## Related docs

- [SHARE_HASH_VENDORING.md](./SHARE_HASH_VENDORING.md) — how other tools should integrate  
- [PRODUCT.md](./PRODUCT.md) — shareable URL as product principle  
- [ARCHITECTURE.md](./ARCHITECTURE.md) — app wiring (`usePlanHash`)  
- [DATA.md](./DATA.md) — Docs extract / `parse-docs`  

