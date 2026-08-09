# Product

## One-line pitch

**Where should I build this factory?** A capacity-aware heatmap for Satisfactory — not another full calculator or interactive map clone.

## Problem

- Community tools excel at **production ratios** (satisfactorytools.com, KirkMcDonald) and **browsing nodes/collectibles** (SCIM, th.gl, Konsl seed viewer).
- Almost nothing answers: *given this raw throughput demand (or target products), where on the map is the best place to plant the factory?*
- Update **1.2+ resource randomization** makes location choice 10× more valuable: same fixed node *slots*, shuffled types/purities per seed.

## Product principles

1. **Heatmap is the product.** Planner UI and map exist to feed and display scores.
2. **Capacity matters as much as distance.** 600 copper/min next to one impure node is a bad site.
3. **Honest data.** Bootstrap labeled; regenerate path in `docs/DATA.md`. Never treat satisfactory-calculator.com assets as ours.
4. **Static-first + Docker.** Same `vite build` → Cloudflare Workers static assets *and* home-lab Compose (nginx).
5. **Offline-capable PWA.** No accounts; localStorage / export plan JSON / **shareable URL hash** (full plan + knobs).
6. **Host tools = Node/npm only.** Rust/WASM toolchain only in Dev Container, Docker builds, or CI/CF VMs — never install rustc on the laptop.
7. **React Compiler by default.** Minimal hand `useMemo` / `useCallback`.
8. **Live recompute.** Changing demand, extractors, or knobs updates the heat without a separate “Compute” click.

## Two first-class input modes

| Mode | User intent | Behavior |
|------|-------------|----------|
| **A. Raw demand** | “I need 1200 Iron, 600 Copper, 200 Sulfur /min” from another calculator | Multi-row resource + rate editor → demand vector is the input |
| **B. Products** | “Best place for Steel Pipe 60 + Steel Beam 30 (and maybe more)” | Thin recipe expand (defaults + optional alts); **multiple products stack** intermediates → same demand vector |

Both share extractors, site preference, capacity intent, heatmap engine, map, and top-N breakdown.

Mode A is **not** a secondary escape hatch — power users who already solved ratios live there permanently. Mode B can **Send to raw** to hand-tune the expanded rates.

Mode B **off-site inputs** (Resource Toggle): mark a crafted intermediate as imported / recycled / handled elsewhere so its ingredient subtree never becomes map raw demand. Packaging vessels (Empty Canister, Empty Fluid Tank) default off-site. **Water** is the one map raw also listed under **Intermediates** so it can be imported off-site (piped extractors); other ores stay heatmap-only (off-site via their intermediate, e.g. Ingots).

Mode B **alternate recipes** (**Intermediates & Alternates**): each row has a squarish control (empty = default recipe). Open it to pick an alternate for that step; the expand re-runs so precursors and Raw demand update. Picks are encoded in the share hash (and local persist). Alternates are auto-badged by comparing expand-with-alt vs all-defaults (unavoidable **Adds** only; also Removes, Skips, Pure, Alloy, Screw-Free, High Throughput, Resource Efficient, real Docs **`producedIn`** machine swaps — Foundry / Refinery / Assembler / …). Hovering the recipe control highlights **predicates** (self + direct inputs, violet) and **consumers** (downstream steps that use this item, emerald). List order can flip ingredients-first ↔ products-first (display-only pref). **Quick selects** apply known packs to in-play steps only (Defaults, All Pure, Minimize Input Types, Polymer plastics, Recycled loop, Oil→recycled, Sloppy+Pure Al, Iron+Copper Alloy, No Screws, Resource Efficient). **Minimize Input Types** greedily re-expands the plan and keeps only picks that **strictly cut distinct map raws** (not tonnage-only swaps). Plastic/Rubber default is the game crude-oil recipe; **Polymer plastics** picks Residual Plastic/Rubber. Recycled Plastic↔Rubber cycles seed via Residual when expanding.

This is *not* a full recipe planner — only “what counts toward site selection.”

In Raw mode the “Raw demand” summary is omitted (the editor *is* the demand). In Products mode it shows the expanded raw list.

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
| **Shortfall** | Cannot meet demand |
| **Limited** | Meets demand, but local supply is nearly maxed (~≥75% utilization) — thin pocket |
| **OK** | Solid fit with moderate spare |
| **Abundant** | Meets demand with lots of nearby spare (and absolute spare is meaningful) — maybe leave the hub for a bigger plant |

Large plans (e.g. multi-thousand oil/min) rarely get **Abundant** because absolute spare thresholds scale with demand and pure-node rates. Impurity only matters via lower extract rates — not a hard-coded purity rule.

Breakdown shows per resource: assignment + `Local ~X/min · using Y% · spare Z`.

## What we optimize for

- **Proximity + aggregate extract capacity** under extractor settings (miner Mk + miner/oil/water/well clocks; open water + optional resource wells).
- **Rate-invariant haul quality** so a small factory and a large one that use the same nearby nodes paint similarly; capacity shortfall still matters.
- Clear **Shortfall** when the region cannot supply demand.
- Diverse **top-N** candidate sites with per-resource node assignment and haul cost.
- Peak-emphasized heat paint (display only) so the whole map does not wash yellow.
- Seed-aware worlds: paste Map Seed → fixed slots, reassigned types/purities (Konsl MIT algorithm).

## Explicit non-goals

| Non-goal | Better tool |
|----------|-------------|
| Full production planner / LP / alt optimizer | satisfactorytools.com, KirkMcDonald |
| Logistics network / belt graph / power sim | Rockfactory logistics, etc. |
| Rich collectible map / save editor | SCIM, th.gl, Konsl viewer |
| Accounts, multiplayer sync, cloud save | Out of identity |
| PR into satisfactory-calculator.com | Not open source; inspiration only |
| Permanent SC-scraped data | No — see `docs/DATA.md` |
| Navmesh / true cave pathfinding | Soft cave/elevation *warnings* only |

## Success criteria (current)

- Mode A: multi-resource raw rates + extractors → live heatmap without recipes.
- Mode B: multi-product rates → stacked derived raw list + same heatmap path; Send to raw.
- Mode B: off-site intermediates (+ Water); alternate picks with live re-expand, share hash, badges, quick selects.
- Unsatisfiable regions render cold / Shortfall labels.
- Satisfiable clusters light up; top sites show assigned nodes + rates.
- Centered vs Weighted change haul ranking meaningfully.
- Capacity tags: Limited / Abundant inferred; huge plans are not all Abundant.
- Changing miner Mk / clock visibly changes which regions work.
- Map: pan, zoom, basemap tiles, heat overlay, demand-filtered nodes, top pins + assignment lines.
- Map seed paste / random / saved seeds → reassigned nodes → heat.
- `npm start`, `lint`, `test`, `build`, `clean`; Docker → nginx static; PWA-ready.
- Docs explain data provenance and regeneration.

## Positioning copy

**SERP / meta description** (what Google often shows under the title):

*Answers "Where to build" in Satisfactory. Enter raw rates or product targets (e.g. Heavy Modular Frames) and find the best factory sites — for v1.2.*

**UI subtitle** (planner header; not the primary SEO signal):

*Bring raw rates from another tool, or pick products and alternates for a quick site estimate.*

**Version badge:** greyed `v1.2` next to the title (Satisfactory Update 1.2).
