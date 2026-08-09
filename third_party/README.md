# Third-party notices

MIT and other redistributed notices for material this project ships or ports.  
In-app credits: **Attributions** control in the planner footer.

| Dependency | License | What we use | Files |
|------------|---------|-------------|--------|
| [Konsl/satisfactory-world-generator](https://github.com/Konsl/satisfactory-world-generator) | MIT (`src/*.rs` only; **not** GPL viewer) | 1.2+ node randomization (Rust/WASM) | `konsl-satisfactory-world-generator.LICENSE`, `.md`; crate `crates/vendored/konsl_randomization` |

## Not third-party OSS (still credited in-app)

| Material | Notes |
|----------|--------|
| Map art | © Coffee Stain Studios — community wiki basemap → self-hosted WebP tiles |
| Resource node slots | Our FModel extract of `Persistent_Level` → `public/data/nodes/default-nodes.json` (`npm run extract-world-nodes`) |
| Recipes / items | Compact extract from Coffee Stain Docs (`npm run parse-docs`) |

## History

Early development bootstrapped node coordinates from [rockfactory/satisfactory-logistics](https://github.com/rockfactory/satisfactory-logistics) MIT `WorldResourceNodes.json`. That data is **no longer shipped**; slots are regenerated from an own FModel export. See `docs/DATA.md`.
