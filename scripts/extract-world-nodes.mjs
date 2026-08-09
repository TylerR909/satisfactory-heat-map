#!/usr/bin/env node
/**
 * Extract resource node slots from an FModel Persistent_Level properties JSON
 * into the compact runtime file we ship.
 *
 * Input (not committed — gitignored):
 *   data/Persistent_Level.json
 *   — FModel: FactoryGame/.../Map/GameLevel01/Persistent_Level → Save Properties (.json)
 *   — or the top-level Persistent_Level.json inside a GameLevel01 export zip
 *
 * Output (committed):
 *   public/data/nodes/default-nodes.json
 *   public/data/nodes/nodes-meta.json
 *
 * You do **not** need Persistent_Level/_Generated_/*.json for this project —
 * all resource actors we care about live in the single Persistent_Level.json.
 *
 * Usage:
 *   npm run extract-world-nodes
 *   node scripts/extract-world-nodes.mjs [path/to/Persistent_Level.json]
 *
 * Memory: the dump is ~100MB; Node default heap is fine on modern machines.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DEFAULT_INPUT = path.join(root, "data/Persistent_Level.json");
const OUT_NODES = path.join(root, "public/data/nodes/default-nodes.json");
const OUT_META = path.join(root, "public/data/nodes/nodes-meta.json");

/** Actor Type → our nodeType */
const TARGET_TYPES = {
  BP_ResourceNode_C: "node",
  BP_ResourceDeposit_C: "deposit",
  BP_FrackingCore_C: "frackingCore",
  BP_FrackingSatellite_C: "frackingSatellite",
  BP_ResourceNodeGeyser_C: "geyser",
};

/** Geysers have no mResourceClass in the dump — match in-game / prior bootstrap. */
const GEYSER_RESOURCE = "Desc_GeothermalEnergy_C";

/** Human labels for displayName (fallback if items.json missing a raw). */
const DISPLAY_NAMES = {
  Desc_OreIron_C: "Iron Ore",
  Desc_OreCopper_C: "Copper Ore",
  Desc_Stone_C: "Limestone",
  Desc_Coal_C: "Coal",
  Desc_OreGold_C: "Caterium Ore",
  Desc_RawQuartz_C: "Raw Quartz",
  Desc_Sulfur_C: "Sulfur",
  Desc_OreBauxite_C: "Bauxite",
  Desc_OreUranium_C: "Uranium",
  Desc_SAM_C: "S.A.M. Ore",
  Desc_LiquidOil_C: "Crude Oil",
  Desc_Water_C: "Water",
  Desc_NitrogenGas_C: "Nitrogen Gas",
  Desc_GeothermalEnergy_C: "Geyser",
};

function loadDisplayNames() {
  const itemsPath = path.join(root, "public/data/recipes/items.json");
  const map = { ...DISPLAY_NAMES };
  try {
    const items = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
    for (const [id, it] of Object.entries(items)) {
      if (it?.name) map[id] = it.name;
    }
  } catch {
    /* items.json optional for extract */
  }
  return map;
}

function outerStr(obj) {
  const outer = obj?.Outer;
  if (outer && typeof outer === "object") {
    return String(outer.ObjectName || outer.ObjectPath || "");
  }
  return String(outer || "");
}

/** BlueprintGeneratedClass'Desc_OreIron_C' → Desc_OreIron_C */
function parseResourceClass(val) {
  if (!val) return null;
  const name = typeof val === "object" ? String(val.ObjectName || "") : String(val);
  const m = name.match(/(Desc_[A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

function parsePurity(val) {
  if (val == null || val === "") return "normal";
  const v = String(val);
  // Game typo: RP_Inpure
  if (/Inpure|Impure/i.test(v)) return "impure";
  if (/Pure/i.test(v)) return "pure";
  if (/Normal/i.test(v)) return "normal";
  return "normal";
}

function actorNameFromOuter(outer) {
  // BP_ResourceNode_C'Persistent_Level:PersistentLevel.BP_ResourceNode100'
  if (outer.includes("PersistentLevel.")) {
    return outer.split("PersistentLevel.").pop().replace(/'$/, "");
  }
  return null;
}

/**
 * Prefer RootComponent path (BoxComponent / DepositMesh) for world placement.
 */
function buildLocationIndex(data) {
  /** @type {Map<string, { x: number, y: number, z: number, yaw: number, component: string }>} */
  const byActor = new Map();

  for (const obj of data) {
    const props = obj.Properties;
    if (!props || props.RelativeLocation == null) continue;
    const outer = outerStr(obj);
    const actor = actorNameFromOuter(outer);
    if (!actor) continue;

    const name = String(obj.Name || "");
    const isPreferred = name.startsWith("Box") || name === "DepositMesh";
    const existing = byActor.get(actor);
    if (existing && !isPreferred) continue;

    const loc = props.RelativeLocation;
    const rot = props.RelativeRotation || {};
    byActor.set(actor, {
      x: Number(loc.X) || 0,
      y: Number(loc.Y) || 0,
      z: Number(loc.Z) || 0,
      yaw: Number(rot.Yaw) || 0,
      component: name,
    });
  }
  return byActor;
}

function extractNodes(data, displayNames) {
  const locations = buildLocationIndex(data);
  const nodes = [];
  const warnings = [];

  for (const obj of data) {
    const type = obj.Type;
    const nodeType = TARGET_TYPES[type];
    if (!nodeType) continue;

    const id = String(obj.Name || "");
    if (!id) continue;

    const props = obj.Properties || {};
    let resource = parseResourceClass(props.mResourceClass || props.mOverrideResourceClass);
    if (nodeType === "geyser") {
      resource = GEYSER_RESOURCE;
    }
    if (!resource) {
      warnings.push(`no resource class: ${id} (${type})`);
      continue;
    }

    const loc = locations.get(id);
    if (!loc) {
      warnings.push(`no RelativeLocation: ${id}`);
      continue;
    }

    const purity = parsePurity(props.mPurity);
    const displayName = displayNames[resource] || resource.replace(/^Desc_/, "").replace(/_C$/, "");

    nodes.push({
      id,
      resource,
      purity,
      classPath: type,
      nodeType,
      displayName,
      x: Math.round(loc.x),
      y: Math.round(loc.y),
      z: Math.round(loc.z),
      rotation: Math.round(loc.yaw * 100) / 100,
    });
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, warnings };
}

function main() {
  const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT);
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing input: ${inputPath}`);
    console.error(`
Export from FModel (Windows):
  1. Configure Satisfactory in FModel (usmap / UE version — see docs.ficsit.app).
  2. Browse to FactoryGame/Content/FactoryGame/Map/GameLevel01/
  3. Right-click Persistent_Level → Packages → Save Properties (.json)
     (or export the folder and use the top-level Persistent_Level.json ~100MB)
  4. Copy that file to data/Persistent_Level.json (gitignored)
  5. npm run extract-world-nodes

You do NOT need Persistent_Level/_Generated_/*.json for node slots.
`);
    process.exit(1);
  }

  console.log(`Reading ${inputPath} …`);
  const raw = fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    console.error("Expected a JSON array of UObject dumps from FModel Save Properties.");
    process.exit(1);
  }
  console.log(`  ${data.length} objects`);

  const displayNames = loadDisplayNames();
  const { nodes, warnings } = extractNodes(data, displayNames);

  const byType = {};
  const byResource = {};
  for (const n of nodes) {
    byType[n.nodeType] = (byType[n.nodeType] || 0) + 1;
    byResource[n.resource] = (byResource[n.resource] || 0) + 1;
  }

  fs.mkdirSync(path.dirname(OUT_NODES), { recursive: true });
  fs.writeFileSync(OUT_NODES, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");

  const meta = {
    generatedAt: new Date().toISOString(),
    source: path.relative(root, inputPath),
    sourceBytes: fs.statSync(inputPath).size,
    objectCount: data.length,
    nodeCount: nodes.length,
    byType,
    byResource,
    tool: "scripts/extract-world-nodes.mjs",
    notes:
      "Own FModel Persistent_Level export. Geysers forced to Desc_GeothermalEnergy_C (no mResourceClass in dump).",
  };
  fs.writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  console.log(`Wrote ${OUT_NODES} (${nodes.length} nodes)`);
  console.log(`Wrote ${OUT_META}`);
  console.log("  byType", byType);
  if (warnings.length) {
    console.warn(`  ${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 20)) console.warn(`    - ${w}`);
    if (warnings.length > 20) console.warn(`    … +${warnings.length - 20} more`);
  }
}

main();
