#!/usr/bin/env node
/**
 * Parse Coffee Stain CommunityResources Docs (en-US.json, UTF-16) into compact
 * runtime assets under public/data/recipes/.
 *
 * Input (not shipped):
 *   data/Docs/en-US.json   — or pass path as argv[2]
 *
 * Output (committed, small):
 *   public/data/recipes/items.json
 *   public/data/recipes/recipes.json
 *   public/data/recipes/docs-meta.json  — source stamp only
 *
 * Does NOT ship the 10MB Docs file. Runtime loads only the compact JSON.
 *
 * Usage:
 *   node scripts/parse-docs.mjs [path/to/en-US.json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DEFAULT_DOCS = path.join(root, "data/Docs/en-US.json");
const OUT_DIR = path.join(root, "public/data/recipes");

/**
 * Automated factory buildings we keep recipes for (Mode B / production expand).
 * Equipment Workshop / Workbench-only recipes are excluded.
 */
const FACTORY_RE =
  /Constructor|Assembler|Manufacturer|Smelter|Foundry|OilRefinery|Blender|HadronCollider|Converter|Packager|QuantumEncoder|ParticleAccelerator/i;

function readUtf16Json(filePath) {
  const buf = fs.readFileSync(filePath);
  // UTF-16 LE BOM FF FE
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString("utf16le");
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    // BE — rare
    text = buf.swap16().toString("utf16le");
  } else {
    text = buf.toString("utf8");
  }
  // Strip BOM char if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

function parseDisplayName(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.startsWith("NSLOCTEXT")) {
    const parts = [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    return parts[parts.length - 1] ?? s;
  }
  return s;
}

/**
 * Docs store solid counts as integers, but **fluids/gases as milliliters**
 * (1000 = 1 m³). We normalize to m³ / item counts so Mode B rates match the game UI.
 */
const FLUID_AMOUNT_SCALE = 1000;

/** Extract Desc_*_C ids + amounts from UE property dump strings. */
function parseItemAmounts(blob, fluidIds) {
  if (!blob || typeof blob !== "string") return [];
  const out = [];
  // ItemClass=".../Desc_Foo.Desc_Foo_C'",Amount=3
  const re = /\.([A-Za-z][A-Za-z0-9_]*_C)'"?,Amount=(\d+(?:\.\d+)?)/g;
  for (const m of blob.matchAll(re)) {
    const item = m[1];
    let amount = Number(m[2]);
    if (fluidIds.has(item) && amount >= FLUID_AMOUNT_SCALE) {
      amount = amount / FLUID_AMOUNT_SCALE;
    }
    out.push({ item, amount });
  }
  return out;
}

/** ClassNames with mForm RF_LIQUID or RF_GAS. */
function buildFluidIdSet(docs) {
  /** @type {Set<string>} */
  const fluids = new Set();
  for (const group of docs) {
    for (const c of group.Classes ?? []) {
      const form = c.mForm;
      if ((form === "RF_LIQUID" || form === "RF_GAS") && c.ClassName) {
        fluids.add(c.ClassName);
      }
    }
  }
  return fluids;
}

function isFactoryProduced(producedIn) {
  if (!producedIn || typeof producedIn !== "string") return false;
  // Must list at least one automated factory machine.
  // Workshop-only (Hoverpack, Xeno-Zapper, …) and build-gun recipes fail this.
  // Dual workshop+Manufacturer (e.g. Explosive Rebar) still pass.
  return FACTORY_RE.test(producedIn);
}

function isAlternate(className, displayName) {
  if (/Alternate/i.test(className)) return true;
  if (/^Alternate:/i.test(displayName)) return true;
  return false;
}

function collectClasses(docs, pred) {
  const out = [];
  for (const group of docs) {
    const nc = group.NativeClass ?? "";
    if (!pred(nc)) continue;
    for (const c of group.Classes ?? []) out.push(c);
  }
  return out;
}

/** All descriptor ClassName → display name (for labeling IO, not the product list). */
function buildNameIndex(docs) {
  /** @type {Record<string, string>} */
  const names = {};
  for (const group of docs) {
    for (const c of group.Classes ?? []) {
      const id = c.ClassName;
      if (!id || names[id]) continue;
      const name = parseDisplayName(c.mDisplayName);
      if (name) names[id] = name;
    }
  }
  return names;
}

function buildRecipes(docs) {
  const fluidIds = buildFluidIdSet(docs);
  const rawRecipes = collectClasses(
    docs,
    (nc) => nc.includes(".FGRecipe'") || nc.endsWith("FGRecipe'"),
  );

  /** @type {Array<{
   *   id: string;
   *   name: string;
   *   durationSec: number;
   *   ingredients: { item: string; amount: number }[];
   *   products: { item: string; amount: number }[];
   *   alternate: boolean;
   * }>} */
  const recipes = [];

  for (const c of rawRecipes) {
    const id = c.ClassName;
    if (!id) continue;
    if (!isFactoryProduced(c.mProducedIn ?? "")) continue;

    const ingredients = parseItemAmounts(c.mIngredients ?? "", fluidIds);
    const products = parseItemAmounts(c.mProduct ?? "", fluidIds);
    if (ingredients.length === 0 || products.length === 0) continue;

    // Skip pure build/empty junk that slipped through
    if (products.every((p) => p.amount <= 0)) continue;

    const name = parseDisplayName(c.mDisplayName) || id;
    const durationSec = Number(c.mManufactoringDuration) || 0;
    if (durationSec <= 0) continue;

    recipes.push({
      id,
      name,
      durationSec,
      ingredients,
      products,
      alternate: isAlternate(id, name),
    });
  }

  recipes.sort((a, b) => a.id.localeCompare(b.id));
  return recipes;
}

/**
 * Compact item catalog:
 * - Raw map resources (always)
 * - Every item that appears in a kept factory recipe (ingredient or product)
 * - `automatable: true` only for products of a **default** (non-alt) factory recipe
 *
 * Excludes world pickups / enemy drops / workshop-only gear from the Products
 * dropdown (they never get automatable:true). They may still exist as recipe
 * ingredients (e.g. Hog Remains → Alien Protein) with automatable:false.
 */
function buildItems(docs, recipes) {
  const names = buildNameIndex(docs);

  /** @type {Record<string, { id: string; name: string; raw: boolean; automatable: boolean }>} */
  const items = {};

  const resources = collectClasses(docs, (nc) => nc.includes("FGResourceDescriptor"));
  for (const c of resources) {
    const id = c.ClassName;
    if (!id) continue;
    items[id] = {
      id,
      name: names[id] || parseDisplayName(c.mDisplayName) || id,
      raw: true,
      automatable: false,
    };
  }

  /** @type {Set<string>} */
  const automatableProducts = new Set();
  for (const r of recipes) {
    if (r.alternate) continue;
    for (const p of r.products) automatableProducts.add(p.item);
  }

  function ensureItem(id, { raw = false, automatable = false } = {}) {
    if (!id) return;
    const existing = items[id];
    if (existing) {
      // Never mark map raws as Products-list targets (even if a converter recipe outputs them)
      if (automatable && !existing.raw) existing.automatable = true;
      return;
    }
    items[id] = {
      id,
      name:
        names[id] ||
        id
          .replace(/^Desc_/, "")
          .replace(/^BP_/, "")
          .replace(/_C$/, "")
          .replace(/_/g, " "),
      raw,
      automatable: raw ? false : automatable,
    };
  }

  for (const r of recipes) {
    for (const io of r.ingredients) ensureItem(io.item, { automatable: false });
    for (const io of r.products) {
      ensureItem(io.item, { automatable: automatableProducts.has(io.item) });
    }
  }

  // Final pass: mark every default-recipe product automatable (even if also raw — shouldn't happen)
  for (const id of automatableProducts) {
    if (items[id] && !items[id].raw) items[id].automatable = true;
  }

  return items;
}

function main() {
  const docsPath = path.resolve(process.argv[2] ?? DEFAULT_DOCS);
  if (!fs.existsSync(docsPath)) {
    console.error(`Docs file not found: ${docsPath}`);
    console.error("Copy game CommunityResources/Docs/en-US.json to data/Docs/en-US.json");
    process.exit(1);
  }

  console.log(`Reading ${docsPath}…`);
  const docs = readUtf16Json(docsPath);
  if (!Array.isArray(docs)) {
    console.error("Expected Docs root to be an array of { NativeClass, Classes }");
    process.exit(1);
  }

  const recipes = buildRecipes(docs);
  const items = buildItems(docs, recipes);

  const defaults = recipes.filter((r) => !r.alternate).length;
  const alts = recipes.filter((r) => r.alternate).length;
  const automatable = Object.values(items).filter((i) => i.automatable).length;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const itemsPath = path.join(OUT_DIR, "items.json");
  const recipesPath = path.join(OUT_DIR, "recipes.json");
  const metaPath = path.join(OUT_DIR, "docs-meta.json");

  fs.writeFileSync(itemsPath, `${JSON.stringify(items, null, 2)}\n`);
  fs.writeFileSync(recipesPath, `${JSON.stringify(recipes, null, 2)}\n`);
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify(
      {
        source: "Coffee Stain CommunityResources/Docs/en-US.json",
        note: "Derived compact extract only — full Docs not shipped. Re-run: npm run parse-docs",
        filter:
          "Factory-building recipes only (not Equipment Workshop-only). Products list uses automatable=default factory product.",
        generatedAt: new Date().toISOString(),
        itemCount: Object.keys(items).length,
        automatableProductCount: automatable,
        recipeCount: recipes.length,
        defaultRecipes: defaults,
        alternateRecipes: alts,
      },
      null,
      2,
    )}\n`,
  );

  const itemsKb = (fs.statSync(itemsPath).size / 1024).toFixed(1);
  const recipesKb = (fs.statSync(recipesPath).size / 1024).toFixed(1);
  console.log(
    `Wrote ${itemsPath} (${itemsKb} KB, ${Object.keys(items).length} items, ${automatable} automatable products)`,
  );
  console.log(
    `Wrote ${recipesPath} (${recipesKb} KB, ${recipes.length} recipes: ${defaults} default + ${alts} alt)`,
  );
  console.log(`Wrote ${metaPath}`);
}

main();
