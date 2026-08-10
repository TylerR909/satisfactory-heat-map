# Vendoring the share-hash algorithm (“Open in Heatmap”)

**Audience:** Authors of Satisfactory calculators, planners, and modelers who want an **Open in Satisfactory Heatmap** link.

**Wire format (bytes + flags):** [SHARE_HASH.md](./SHARE_HASH.md)  
**Reference implementation:** [`src/lib/planHash.ts`](../src/lib/planHash.ts)  
**Catalogs (pin these):** `public/data/recipes/itemIds.json`, `recipeIds.json`, `recipePrimaries.json`

This guide is intentionally short. Prefer **copying catalogs + calling the documented builders** over re-deriving expand order.

---

## What you can ship without our UI

| Integration | Difficulty | API / path |
|-------------|------------|------------|
| **Mode A — raw demand** | Easy (recommended) | `encodeRawPlanHash(lines)` or hand-pack Mode A bytes per [SHARE_HASH.md](./SHARE_HASH.md) |
| **Mode B — targets + alts** | Medium (stretch) | `encodeProductPlanHash(targets, { alternateRecipes })` or explicit `recipeOverrides` |
| Full Intermediates BFS / badges / quick-selects | **Out of scope** | Do not reimplement; we re-expand on open |

If your tool already solved production to **ores/fluids per minute**, use Mode A. That is the first-class external contract.

---

## Minimal Mode A (preferred)

### Inputs

Docs ClassNames for map resources, e.g.:

- `Desc_OreIron_C`, `Desc_OreCopper_C`, `Desc_Coal_C`, `Desc_LiquidOil_C`, …
- Full picker list = `RAW_RESOURCE_OPTIONS` in [`src/lib/resources.ts`](../src/lib/resources.ts) (same order as wire `rawIndex`)

### TypeScript (this repo)

```ts
import { encodeRawPlanHash } from "./planHash"; // or vendored copy

const hash = encodeRawPlanHash([
  { resource: "Desc_OreIron_C", itemsPerMinute: 1200 },
  { resource: "Desc_OreCopper_C", itemsPerMinute: 600 },
  { resource: "Desc_Sulfur_C", itemsPerMinute: 200 },
]);
// → "v1.<base64url…>"

const url = `https://satisfactory-heatmap.com/#${hash}`;
```

Optional: `seed`, miner clocks, scoring knobs (see builder opts on `encodeRawPlanHash`). **Defaults are fine** for most “open heatmap” buttons.

### Hand-rolled (any language)

1. Pinning `itemIds.json` is **not** required for Mode A raw lines — use the fixed raw table order from `RAW_RESOURCE_OPTIONS` / [SHARE_HASH.md](./SHARE_HASH.md).
2. Pack header + raw triples as documented.
3. base64url-encode (no padding).
4. Prefix `v1.` and put in the URL fragment.

Golden behavior: same demand + defaults → **identical** hash string (deterministic).

---

## Mode B stretch (targets + alternates)

### Friendly shape

```ts
import { encodeProductPlanHash } from "./planHash";

const hash = encodeProductPlanHash(
  [{ item: "Desc_ComputerSuper_C", itemsPerMinute: 4 }],
  {
    alternateRecipes: ["Recipe_Alternate_OCSupercomputer_C"],
    // externalItems: ["Desc_Water_C"],
    // seed: 12345,
  },
);
```

- Prefer **canonical Docs ClassNames** (`Desc_*_C`, `Recipe_*_C`) as used in Coffee Stain Docs / our catalogs.
- Each alternate is applied to its **primary product** via `recipePrimaries.json`.
- Byproduct-selectable paths: pass explicit  
  `recipeOverrides: { Desc_HeavyOilResidue_C: "Recipe_…_C" }` instead of guessing.

### ClassName aliases (Mode B hand-rolls)

Our encoder runs product ids through `canonicalizeProductId` ([`src/lib/productIdAliases.ts`](../src/lib/productIdAliases.ts)) so wiki-ish / legacy names (e.g. `Desc_Supercomputer_C` → `Desc_ComputerSuper_C`) still resolve.

- **Vendoring our TS module:** you get this for free.
- **Hand-rolled Mode B in another language:** if inputs might use aliased ClassNames, **replicate that map** (or normalize to Docs ids yourself) before index lookup. Missed aliases silently drop items from the hash.

Mode A raw lines use the fixed raw table only — aliases are rarely relevant there.

### What you do **not** encode

- The full intermediate tree (12 / 23 / 47 steps…)
- Default recipes (omitted = default)
- Our panel’s BFS order

We recompute expand when the link opens.

---

## Files to vendor (checklist)

Copy from a **tagged commit** or release of this repo:

| Path | Why |
|------|-----|
| `docs/SHARE_HASH.md` | Byte layout, flags, quantize rules |
| `docs/SHARE_HASH_VENDORING.md` | This guide |
| `public/data/recipes/itemIds.json` | Item index table (**append-only**) |
| `public/data/recipes/recipeIds.json` | Recipe index table (**append-only**) |
| `public/data/recipes/recipePrimaries.json` | Mode B builder helper |
| `public/data/recipes/docs-meta.json` | Source stamp / counts — **revision marker** for the cut you pinned (`generatedAt`, item/recipe counts) |
| `src/lib/planHash.ts` (+ its small deps) **or** reimplement from SHARE_HASH.md | Encoder |
| `src/lib/productIdAliases.ts` | Required for Mode B if inputs may use legacy/wiki ClassNames |

Catalog JSON files do **not** embed a revision field themselves. Record the git tag / commit **and** copy `docs-meta.json` so a vendored tree can self-identify which Docs cut it was built from.

**Do not renumber** catalog entries. When Coffee Stain adds items/recipes, new ids are **appended** by `npm run parse-docs`. Old links keep working only if indices stay stable. CI in this repo pins known ClassName → index slots so accidental reordering fails tests.

Other deps if you vendor the TS module as-is:

- `RAW_RESOURCE_OPTIONS` (`src/lib/resources.ts`) — Mode A raw indices  
- `DEFAULT_MINER_SETTINGS` / scoring defaults (`src/types`) — “omit when default” tails  

For a minimal foreign encoder, **Mode A only** + SHARE_HASH.md is enough.

---

## URL shape

```text
https://satisfactory-heatmap.com/#v1.<payload>
```

- Fragment only (`#…`); crawlers never see plan state (see [SEO.md](./SEO.md)).
- Local / self-host: same `#v1.…` on your origin.

Suggested link text: **Open in Heatmap** / **View sites on map**.

---

## Versioning & support

| Rule | Detail |
|------|--------|
| Prefix | `v1.` is the public format (beta may hard-cut older private layouts) |
| Catalogs | Append-only; pin git tag/commit + ship `docs-meta.json` as the revision stamp |
| Breaking wire changes | New prefix (`v2.`) + doc bump — rare |
| Questions | Prefer issues on this repo with a sample hash + intended demand |

---

## Non-goals (for integrators)

- Encrypting or signing share links  
- Server-side short URLs required for open  
- Replicating heatmap scoring in your tool  
- Perfect Mode B parity with every planner’s internal recipe graph  

**Mode A raw rates in → short `#v1.` link out** is the success bar for v1 interop.

---

## Related

- [SHARE_HASH.md](./SHARE_HASH.md) — canonical wire spec  
- [PRODUCT.md](./PRODUCT.md) — product intent  
- [DATA.md](./DATA.md) — how catalogs are generated  
