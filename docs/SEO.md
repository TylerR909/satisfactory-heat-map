# SEO, social previews & AI crawlers

Static SPA on Cloudflare Workers assets. Most crawl signals ship from the repo; bot policy and Search Console are operator-side.

## What ships in the repo

| Asset | Role |
|-------|------|
| [`index.html`](../index.html) | Title, description, canonical, Open Graph, Twitter Card, JSON-LD, crawlable pitch |
| [`public/robots.txt`](../public/robots.txt) | Allow all well-behaved crawlers; sitemap pointer |
| [`public/sitemap.xml`](../public/sitemap.xml) | Homepage only |
| [`public/llms.txt`](../public/llms.txt) | Optional agent-oriented summary (Google ignores) |
| [`public/og-image.png`](../public/og-image.png) | 1200×630 social card (default HMF 10/min map screenshot + title bar) |
| [`public/_headers`](../public/_headers) | Cache rules for the above |

**Important:** SPA `not_found_handling` returns `index.html` for missing paths. Crawl files must be real files under `public/` (copied to `dist/`) or bots get HTML with a 200.

## Social previews

Crawlers (Discord, Slack, iMessage, X, Reddit) fetch the URL **without** the hash and only read static meta tags. Plan state in `#v1.…` is never available server-side, so every share of the origin shows the same title/description/image.

- **MVP:** static `og-image.png` of the default Heavy Modular Frame 10/min heat.
- **Regenerate image:** with Chromium for Playwright installed:

  ```bash
  npx playwright install chromium   # once
  node scripts/capture-og-image.mjs
  # optional: OG_URL=http://127.0.0.1:5173 node scripts/capture-og-image.mjs
  ```

  Requires ImageMagick (`magick`) for the title banner.

- **Not in scope (yet):** per-plan OG titles or rendering that user’s heat into the card — see [ROADMAP.md](ROADMAP.md) (SEO / discoverability).

## AI crawl stance

Free community tool → prefer **discoverability** (search + answer engines may cite the site).

| Category | Default |
|----------|---------|
| Search crawlers | Allow |
| AI answer / citation crawlers | Allow |
| AI training bots | Allow (little proprietary prose; optional to tighten later) |

`robots.txt` is polite only. Enforcement is Cloudflare AI Crawl Control / WAF.

## Operator checklist (Cloudflare + Search Console)

Do after the SEO PR merges (or post as a **PR comment** while review is open):

1. **AI Crawl Control** — allow Search (and ideally Agent/citation); do not leave “block all AI” on if you want LLM citations.
2. **Managed robots.txt** — if ON, CF prepends AI directives to our file. Prefer one source of truth: turn managed OFF and keep repo `robots.txt`, or leave ON and accept its training opt-out.
3. **Canonical host** — apex `satisfactory-heatmap.com`; 301 `www` → apex (or reverse, but one only).
4. **Post-deploy smoke:**

   ```bash
   curl -sI https://satisfactory-heatmap.com/robots.txt   # text/plain, not HTML
   curl -s  https://satisfactory-heatmap.com/robots.txt
   curl -sI https://satisfactory-heatmap.com/sitemap.xml  # xml
   curl -s  https://satisfactory-heatmap.com/ | grep -E 'og:image|canonical'
   ```

5. **Cache** — if OG/HTML sticky, purge `/`, `/og-image.png`, `/robots.txt`, `/sitemap.xml`.
6. **Google Search Console** — verify property (DNS or HTML file), submit sitemap URL.
7. **Bing Webmaster** — same.
8. **Unfurl smoke** — paste homepage into Discord/Slack or an Open Graph debugger.

## Ranking expectations

- Strong shot at **“satisfactory heatmap”** (domain + title + backlinks).
- Intent queries (“where to put factory satisfactory”) need copy + community mentions.
- Do **not** try to outrank full calculators for “satisfactory calculator.”

Largest on-site levers already in this pass: real `robots.txt`/`sitemap`, rich meta, static OG image, crawlable pitch text. Largest off-site lever: Reddit/Discord/wiki/GitHub links.
