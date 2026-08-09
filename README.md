# Satisfactory Heatmap

**Answers “Where to build” in Satisfactory (v1.2).** Paste raw resource rates or product targets and get capacity-aware factory sites on the map — under your extractor settings and map seed.

> Not a full production calculator or collectible map. Bring ratios from [Satisfactory Calculator](https://www.satisfactory-calculator.com/) (or any planner), or pick products here for a quick default-recipe estimate.

## Try it

- **Hosted:** [satisfactory-heatmap.com](https://satisfactory-heatmap.com)
- **Self-host (Docker):** paste-and-go compose below — no Node install required

```bash
# Save as docker-compose.yml (or copy docker-compose.example.yml from this repo)
# Then:
docker compose up -d
# → http://localhost:18547
```

```yaml
services:
  satisfactory-heatmap:
    image: ghcr.io/tylerr909/satisfactory-heat-map:latest
    ports:
      - "18547:80"
    restart: unless-stopped
```

Image: [`ghcr.io/tylerr909/satisfactory-heat-map`](https://github.com/TylerR909/satisfactory-heat-map/pkgs/container/satisfactory-heat-map).

## What it does

| You bring…                                                         | You get…                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Raw demand** (e.g. 1200 iron / 600 copper /min)                  | A live heatmap of where that demand is easiest to feed                         |
| **Product targets** (e.g. HMF 10/min, multi-product stacks)        | Default-recipe expand → same heat engine; **off-site** intermediate prune; **Send to raw** to hand-tune |
| Extractor settings (Mk + clock, oil/water/wells modeled correctly) | Capacity that matches _your_ extractors                                        |

## Map seeds (1.2+)

Paste your world **Map Seed** via the **Seed** control (chips row). Node types/purities use [Konsl’s MIT randomization](https://github.com/Konsl/satisfactory-world-generator) compiled to **WASM** (`crates/vendored/konsl_randomization` — see `third_party/konsl-satisfactory-world-generator.md`). Default world = vanilla slot layout; numeric seeds assume in-game **Random** + **unchanged** purity. Saved plans are scoped per named saved seed.

## Credits / third-party

OSS notices for redistributed or ported material live under [`third_party/`](third_party/) (Konsl seed algorithm). Node slots are our own FModel extract. In-app: planner **Attributions**. Not affiliated with Coffee Stain Studios.

## Core ideas

**Capacity is not optional.** Sitting next to one impure node at 600/min is a bad site even if the pin is close. Pins get tags from local extract capacity:

- **OK** — solid fit
- **Limited** — meets demand but little room to grow
- **Abundant** — lots of spare nearby (consider leaving these nodes for a larger factory)
- **Shortfall** — can’t fully feed the plan here

**Centered vs Weighted** (under Clustering) changes _what_ “best” means:

- **Centered** — centers the factory at the midpoint between sufficient nodes
- **Weighted** — tugs the midpoint toward the heaviest supply nodes (1200/min iron + 100/min copper shifts closer to the iron)

**Water:** Open-water extractors aren’t discrete game nodes, but the heatmap models them from basemap open-water pockets (plus optional Tier 8 resource wells). In Products mode, mark **Water** off-site under **Intermediates** if you pipe it from elsewhere.

**Share and save plans.** Copy the plan hash from the Products/Raw header, paste to import, or use the plan chips to save/switch builds. The URL hash is the same compact computation payload (display settings stay local).

**Not affiliated** with Coffee Stain Studios. Node positions from our FModel world extract; recipes are a compact extract from official Docs — see in-app **Attributions**.

## Self-hosting tips

- Needs only Docker Compose + pull access to GHCR (public image: no login).
- Reverse-proxy `18547` (or remap the host port) behind your TLS terminator if you expose it.
- Static SPA: no database, no accounts. Plans live in the browser (`localStorage`) unless you share hashes.
- Build from source: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Roadmap and design notes live under [`docs/`](docs/).
