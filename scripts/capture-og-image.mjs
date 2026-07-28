/**
 * Capture production default HMF heatmap → public/og-image.png (1200×630).
 *
 * Usage:
 *   npx playwright install chromium   # once
 *   node scripts/capture-og-image.mjs
 *
 * Optional: OG_URL=https://… node scripts/capture-og-image.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawOut = join(root, "public", "og-image-raw.png");
const out = join(root, "public", "og-image.png");
mkdirSync(dirname(out), { recursive: true });

// Showcase hash from SavedPlansBar (Mode B HMF 10)
const hash = "v1.CfpHAxARTW9kdWxhckZyYW1lSGVhdnkKAA";
const base = process.env.OG_URL ?? "https://satisfactory-heatmap.com";
const url = `${base.replace(/\/$/, "")}/#${hash}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector(".leaflet-container", { timeout: 60_000 });

// Wait until heat overlay image has a non-empty src / natural size
await page
  .waitForFunction(
    () => {
      const pane = document.querySelector(".leaflet-overlay-pane");
      if (!pane) return false;
      const imgs = pane.querySelectorAll("img");
      return [...imgs].some((img) => img.naturalWidth > 0);
    },
    { timeout: 60_000 },
  )
  .catch(() => console.warn("Heat overlay wait timed out; capturing anyway"));

// Raise heat opacity in the live store if exposed; else localStorage + soft reload path skipped
await page.evaluate(() => {
  // Direct DOM: bump opacity on heat image layers
  for (const img of document.querySelectorAll(".leaflet-overlay-pane img, .sf-heatmap-overlay")) {
    img.style.opacity = "0.9";
  }
});

await page.waitForTimeout(2000);

// Map-forward chrome strip
await page.addStyleTag({
  content: `
    .seo-pitch { display: none !important; }
    #root > div > div:first-child { display: none !important; }
    #root > div {
      display: flex !important;
      height: 100vh !important;
      width: 100vw !important;
    }
    #root > div > main {
      width: 100% !important;
      max-height: none !important;
      flex: 1 1 auto !important;
    }
    .leaflet-control-container { display: none !important; }
  `,
});
await page.waitForTimeout(500);
await page.screenshot({ path: rawOut, type: "png" });
await browser.close();

const fontCandidates = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/SFNS.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "DejaVu-Sans",
];
const font = fontCandidates.find((f) => !f.includes("/") || existsSync(f)) ?? "Helvetica";

execFileSync(
  "magick",
  [
    rawOut,
    "-fill",
    "rgba(2,6,23,0.82)",
    "-draw",
    "rectangle 0,0 1200,100",
    "-fill",
    "#f8fafc",
    "-font",
    font,
    "-pointsize",
    "34",
    "-gravity",
    "NorthWest",
    "-annotate",
    "+28+26",
    "Satisfactory Factory Heatmap",
    "-fill",
    "#94a3b8",
    "-font",
    font,
    "-pointsize",
    "17",
    "-annotate",
    "+28+66",
    "Where to build · capacity-aware · Heavy Modular Frame 10/min",
    out,
  ],
  { stdio: "inherit" },
);

try {
  unlinkSync(rawOut);
} catch {
  /* ignore */
}
console.log("Wrote", out);
