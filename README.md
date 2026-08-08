# Satisfactory Heatmap

**Heatmap-first web tool:** given raw resource rates (or stacked product targets), find ideal factory locations on the Satisfactory map — with **capacity-aware** scoring, site-preference modes, and user-selectable extractors.

> Not a full production calculator or collectible map. Bring ratios from [Satisfactory Tools](https://www.satisfactorytools.com/) / KirkMcDonald, or pick products for a quick default-recipe estimate. We answer _where to build_.

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
| **Raw demand** (e.g. 1200 iron / 600 copper /min)                  | A live heatmap of _where that shopping list is easiest to feed_                |
| **Product targets** (e.g. HMF 10/min, multi-product stacks)        | Default-recipe expand → same heat engine; **off-site** intermediate prune; **Send to Raw** to hand-tune |
| Extractor settings (Mk + clock, oil/water/wells modeled correctly) | Capacity that matches _your_ extractors                                        |

## Map seeds (1.2+)

Paste your world **Map Seed** via the **Seed** control (chips row). Node types/purities use [Konsl’s MIT randomization](https://github.com/Konsl/satisfactory-world-generator) compiled to **WASM** (`crates/vendored/konsl_randomization` — see `third_party/konsl-satisfactory-world-generator.md`). Default world = vanilla slot layout; numeric seeds assume in-game **Random** + **unchanged** purity. Saved heatmaps are scoped per named saved seed.

## Credits / third-party

OSS notices for redistributed or ported material live under [`third_party/`](third_party/) (Konsl seed algorithm; rockfactory node slots). In-app: planner **Attributions**. Not affiliated with Coffee Stain Studios.

## Core ideas

**Capacity is not optional.** Sitting next to one impure node at 600/min is a bad site even if the pin is close. Pins get tags from local extract capacity:

- **OK** — solid fit
- **Limited** — meets demand but limited room for growth if you want to scale up
- **Abundant** — lots of spare resources nearby (lots of room for growth; consider NOT building here to save these noders for larger factories)
- **shortfall** — can’t fully feed the plan here

**Centered vs Weighted** (under Clustering) changes _what_ “best” means:

- **Centered** — centers the factory at the midpoint between sufficient nodes
- **Weighted** — tugs the midpoint towards heaviest supply nodes (1200/min iron + 100/min copper would shift the factory much closer to the iron nodes)

**Water:** Open extractors aren’t game “nodes,” but the heatmap models them from basemap open-water pockets (plus optional Tier 8 resource wells). In Products mode, mark **Water** off-site in Expansion if you pipe it from elsewhere.

**Share & shelf plans.** Copy the plan hash from the Products/Raw header, paste to import, or use the heatmap chips to save/switch builds. The URL hash is the same compact computation payload (display knobs stay local).

**Not affiliated** with Coffee Stain Studios or satisfactory-calculator.com. Node positions bootstrap from community MIT data; recipes are a compact extract from official Docs — see in-app **Attributions**.

## Self-hosting tips

- Needs only Docker Compose + pull access to GHCR (public image: no login).
- Reverse-proxy `18547` (or remap the host port) behind your TLS terminator if you expose it.
- Static SPA: no database, no accounts. Plans live in the browser (`localStorage`) unless you share hashes.
- Build from source: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Roadmap and design notes live under [`docs/`](docs/).
