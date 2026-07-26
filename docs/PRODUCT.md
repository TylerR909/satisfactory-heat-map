# Product

## One-line pitch

**Where should I build this factory?** A capacity-aware heatmap for Satisfactory — not another full calculator or interactive map clone.

## Problem

- Community tools excel at **production ratios** (satisfactorytools.com, KirkMcDonald) and **browsing nodes/collectibles** (SCIM, th.gl, Konsl seed viewer).
- Almost nothing answers: *given this shopping list of raw throughput (or target products), where on the map is the best place to plant the factory?*
- Update **1.2+ resource randomization** makes location choice 10× more valuable: same fixed node *slots*, shuffled types/purities per seed.

## Product principles

1. **Heatmap is the product.** Planner UI and map exist to feed and display scores.
2. **Capacity matters as much as distance.** 600 copper/min next to one impure node is a bad site.
3. **Honest data.** Bootstrap labeled; regenerate path in `docs/DATA.md`. Never treat satisfactory-calculator.com assets as ours.
4. **Static-first + Docker.** Same `vite build` → Cloudflare/GitHub Pages *and* home-lab Compose (nginx).
5. **Offline-capable PWA.** No accounts; localStorage / export plan JSON / **shareable URL hash** (full plan + knobs).
6. **Host tools = Node/npm only.** Optional Rust/WASM only inside Docker — never install Rust on the laptop.
7. **React Compiler by default.** Minimal hand `useMemo` / `useCallback`.
8. **Live recompute.** Changing demand, extractors, or knobs updates the heat without a separate “Compute” click.

## Two first-class input modes

| Mode | User intent | Behavior |
|------|-------------|----------|
| **A. Raw demand** | “I need 1200 Iron, 600 Copper, 200 Sulfur /min” from another calculator | Multi-row resource + rate editor → demand vector is the input |
| **B. Products** | “Best place for Steel Pipe 60 + Steel Beam 30 (and maybe more)” | Thin default-recipe expand; **multiple products stack** intermediates → same demand vector |

Both share extractors, site preference, capacity intent, heatmap engine, map, and top-N breakdown.

Mode A is **not** a secondary escape hatch — power users who already solved ratios live there permanently. Mode B can **Send to Raw** to hand-tune the expanded rates.

In Raw mode the “Active raw demand” summary is omitted (the editor *is* the demand). In Products mode it shows the expanded raw list.

## Site preference (haul combine)

| Mode | Intent |
|------|--------|
| **Centered** | Each demanded resource weighs equally (Lₚ of per-resource mean hauls). Prefers multi-resource midpoints — a little sulfur still pulls the hotspot. |
| **Weighted** | Haul cost scales with rate × distance. High-throughput feeds dominate (oil-rich coasts stay hot even if sulfur is farther). |

**Center strength** (Centered only) controls how harshly one long resource leg is punished.

## Capacity tags (inferred — no mode toggle)

Heat and ranking always use the **exact rates you typed**. Capacity is **not** a separate button group; it is inferred per top site from local extract capacity (~1.5 km radius under current extractors):

| Tag | Meaning |
|-----|---------|
| **shortfall** | Cannot meet demand |
| **Limited** | Meets demand, but local supply is nearly maxed (~≥75% utilization) — thin pocket |
| **OK** | Solid fit with moderate spare |
| **Abundant** | Meets demand with lots of nearby spare (and absolute spare is meaningful) — maybe leave the hub for a bigger plant |

Large plans (e.g. multi-thousand oil/min) rarely get **Abundant** because absolute spare thresholds scale with demand and pure-node rates. Impurity only matters via lower extract rates — not a hard-coded purity rule.

Breakdown shows per resource: assignment + `Local ~X/min · using Y% · spare Z`.

## What we optimize for

- **Proximity + aggregate extract capacity** under user miner Mk + clock % (and correct oil/water/well buildings).
- **Rate-invariant haul quality** so a small factory and a large one that use the same nearby nodes paint similarly; capacity shortfall still matters.
- Clear **shortfall** when the region cannot supply demand.
- Diverse **top-N** candidate sites with per-resource node assignment and haul cost.
- Peak-emphasized heat paint (display only) so the whole map does not wash yellow.
- Seed-aware worlds later (fixed slots, reassigned types/purities).

## Explicit non-goals

| Non-goal | Better tool |
|----------|-------------|
| Full production planner / LP / alt optimizer | satisfactorytools.com, KirkMcDonald |
| Logistics network / belt graph / power sim | Rockfactory logistics, etc. |
| Rich collectible map / save editor | SCIM, th.gl, Konsl viewer |
| Accounts, multiplayer sync, cloud save | Out of identity |
| PR into satisfactory-calculator.com | Not open source; inspiration only |
| Permanent SC-scraped data | Temporary basemap CDN only; see `docs/DATA.md` |
| Navmesh / true cave pathfinding | Soft cave/elevation *warnings* only |

## Success criteria (current)

- Mode A: multi-resource raw rates + extractors → live heatmap without recipes.
- Mode B: multi-product rates → stacked derived raw list + same heatmap path; Send to Raw.
- Unsatisfiable regions render cold / shortfall labels.
- Satisfiable clusters light up; top sites show assigned nodes + rates.
- Centered vs Weighted change haul ranking meaningfully.
- Capacity tags: Limited / Abundant inferred; huge plans are not all Abundant.
- Changing miner Mk / clock visibly changes which regions work.
- Map: pan, zoom, basemap tiles, heat overlay, demand-filtered nodes, top pins + assignment lines.
- `npm start`, `lint`, `test`, `build`, `clean`; Docker → nginx static; PWA-ready.
- Docs explain data provenance and regeneration.

## Positioning copy (UI)

*Live heatmap — changes recompute automatically. Bring ratios from Tools / Kirk, or pick a product for a quick default-recipe estimate.*
