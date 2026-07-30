export type Purity = "impure" | "normal" | "pure";

export type NodeType = "node" | "deposit" | "frackingCore" | "frackingSatellite" | "geyser";

export type ResourceNode = {
  id: string;
  resource: string;
  purity: Purity;
  classPath?: string;
  nodeType: NodeType;
  displayName?: string;
  x: number;
  y: number;
  z: number;
  rotation?: number;
  flags?: { cave?: boolean };
};

export type MinerMk = 1 | 2 | 3;

export type MinerSettings = {
  minerMk: MinerMk;
  clockPercent: number;
};

/**
 * How multi-resource haul cost is combined after capacity is assigned.
 * - centered: each resource weighs equally (mean haul^power) — prefers multi-resource midpoints
 * - weighted: haul ∝ rate × distance — high-throughput feeds dominate
 *
 * Legacy persisted values: "balanced" → centered, "volume" → weighted.
 */
export type ScoringMode = "centered" | "weighted";

/**
 * Inferred from exact demand vs local extract capacity (no user capacity mode).
 * - shortfall: cannot meet demand
 * - limited: meets demand but local supply is nearly exhausted
 * - ok: solid fit with moderate spare
 * - abundant: meets demand with lots of nearby spare (maybe leave for a bigger plant)
 */
export type CapacityTag = "shortfall" | "limited" | "ok" | "abundant";

/** User-tunable knobs for scoring + site picking + heat display. */
export type ScoringOptions = {
  /** Centered only: exponent on per-resource mean distance (1 = soft, 2 = harsh). Default ~1.35 */
  centerPower: number;
  /**
   * Peak emphasis for heat *field* exclusivity (display normalize, not paint color).
   * Higher = only strongest cells survive; lower = more secondary hubs paint.
   * Display-only — not in URL hash.
   */
  heatContrast: number;
  /** How many ideal sites to force-list (algorithm relaxes separation if needed). */
  topN: number;
  /** Min pin separation as fraction of map diagonal (≈0.04–0.40). Wider → fewer pins. */
  siteSepFraction: number;
  /**
   * When true (default), haul uses 3D distance with factory Z = median assigned elevation.
   * When false, plan-view XY only (cliffs/caves do not stretch haul).
   */
  includeElevation: boolean;
};

export type RawDemand = {
  resource: string;
  itemsPerMinute: number;
};

/** UI row for Mode A (stable React key via id). */
export type RawDemandLine = RawDemand & { id: string };

/** UI row for Mode B — multi-product co-location targets. */
export type ProductTargetLine = {
  id: string;
  productId: string;
  itemsPerMinute: number;
};

export type InputMode = "raw" | "product";

export type ItemDef = {
  id: string;
  name: string;
  raw: boolean;
  /**
   * True when a default (non-alternate) factory recipe produces this item.
   * Used for the Products dropdown — excludes world pickups, enemy drops,
   * and Equipment Workshop-only gear.
   */
  automatable?: boolean;
};

export type RecipeIO = { item: string; amount: number };

export type Recipe = {
  id: string;
  name: string;
  durationSec: number;
  ingredients: RecipeIO[];
  products: RecipeIO[];
  alternate: boolean;
};

export type MapMeta = {
  gameVersion: string;
  dataNote?: string;
  worldBounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  leaflet: {
    latIsY: boolean;
    flipY: boolean;
  };
  basemap?: {
    kind: "tiles" | "image" | "none";
    tilesUrl?: string;
    imageUrl?: string;
    attribution?: string;
    source?: string;
    notes?: string;
  };
  heatmapDefaults: {
    coarseCols: number;
    coarseRows: number;
    refineTopK: number;
    refineSubdiv: number;
    topN: number;
    caveDeltaZCm: number;
  };
};

export type NodeAssignment = {
  nodeId: string;
  rateUsed: number;
  /** Haul distance used for scoring (XY or 3D depending on includeElevation). */
  dist: number;
  x: number;
  y: number;
  z: number;
  purity: Purity;
  /**
   * Node is flagged as cave in world data (display: non-solid haul line).
   * Not a score penalty — elevation is modeled in distance when enabled.
   */
  caveRisk: boolean;
};

export type ResourceAssignment = {
  resource: string;
  nodes: NodeAssignment[];
  supplied: number;
  demanded: number;
  shortfall: number;
};

/** Per-resource local capacity vs demand (for breakdown UI). */
export type ResourceCapacityInfo = {
  resource: string;
  demanded: number;
  /** Sum of extract rates of nodes within the local radius of the site. */
  localCapacity: number;
  /** demanded / localCapacity (capped for display when capacity is 0). */
  utilization: number;
  spare: number;
};

export type SiteScore = {
  x: number;
  y: number;
  /**
   * Estimated factory elevation (cm): median Z of assigned nodes.
   * Used for 3D haul and for elevation-offset haul-line styling.
   */
  z: number;
  score: number;
  satisfiable: boolean;
  totalHaul: number;
  byResource: ResourceAssignment[];
  /** Informational only (e.g. cave-flagged nodes) — does not change score. */
  caveRiskNotes: string[];
  /** Inferred capacity story for this site at the user's exact demand. */
  capacityTag?: CapacityTag;
  /** Bottleneck utilization across resources (0–∞). */
  maxUtilization?: number;
  /** Per-resource local supply snapshot. */
  capacityByResource?: ResourceCapacityInfo[];
  /**
   * @deprecated Prefer capacityTag === "limited". Kept for older UI checks.
   */
  limited?: boolean;
};

export type HeatmapGrid = {
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  scores: number[];
  satisfiable: boolean[];
};

export type HeatmapResult = {
  grid: HeatmapGrid;
  topSites: SiteScore[];
  elapsedMs: number;
  /** Demand rates scored (always the user's exact plan). */
  scoredDemand: RawDemand[];
};

export type ScoreGridInput = {
  nodes: ResourceNode[];
  demand: RawDemand[];
  miner: MinerSettings;
  scoringMode: ScoringMode;
  options: ScoringOptions;
  bounds: MapMeta["worldBounds"];
  coarseCols: number;
  coarseRows: number;
  refineTopK: number;
  refineSubdiv: number;
  caveDeltaZCm: number;
};

export const DEFAULT_SCORING_OPTIONS: ScoringOptions = {
  centerPower: 1.35,
  /**
   * Peak emphasis: how exclusive the heat field is (display normalize).
   * Higher = only true peaks survive; lower = more secondary hubs.
   * Default biased toward sparse peaks (not whole-map wash).
   */
  heatContrast: 2.35,
  topN: 5,
  siteSepFraction: 0.1,
  /** 3D haul on by default so cliffs cost real distance. */
  includeElevation: true,
};

export const DEFAULT_MINER_SETTINGS = {
  minerMk: 2 as const,
  clockPercent: 250,
};

/** Global ImageOverlay opacity — moderate so basemap stays readable. */
export const DEFAULT_HEAT_OPACITY = 0.58;
