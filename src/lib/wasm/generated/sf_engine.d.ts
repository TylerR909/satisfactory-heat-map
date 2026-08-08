/* tslint:disable */
/* eslint-disable */
export interface HeatmapGrid {
    originX: number;
    originY: number;
    cellW: number;
    cellH: number;
    cols: number;
    rows: number;
    scores: number[];
    satisfiable: boolean[];
}

export interface HeatmapResult {
    grid: HeatmapGrid;
    topSites: SiteScore[];
    elapsedMs: number;
    timings: HeatmapTimings;
    scoredDemand: RawDemand[];
}

export interface HeatmapTimings {
    prepareMs: number;
    coarseMs: number;
    refineMs: number;
    topSitesMs: number;
}

export interface MinerSettings {
    minerMk: number;
    clockPercent: number;
    oilClockPercent?: number;
    waterClockPercent?: number;
    resourceWellsEnabled?: boolean;
    wellClockPercent?: number;
}

export interface NodeAssignment {
    nodeId: string;
    rateUsed: number;
    dist: number;
    x: number;
    y: number;
    z: number;
    purity: string;
    caveRisk: boolean;
}

export interface NodeFlags {
    cave?: boolean | undefined;
}

export interface NodeFlagsDto {
    cave?: boolean | undefined;
}

export interface OpenWaterBody {
    id: string;
    slots: number;
    x: number;
    y: number;
    samples?: [number, number][] | undefined;
}

export interface OpenWaterData {
    bodies?: OpenWaterBody[];
    extractorRateAt100?: number;
}

export interface RawDemand {
    resource: string;
    itemsPerMinute: number;
}

export interface ResourceAssignment {
    resource: string;
    nodes: NodeAssignment[];
    supplied: number;
    demanded: number;
    shortfall: number;
}

export interface ResourceCapacityInfo {
    resource: string;
    demanded: number;
    localCapacity: number;
    utilization: number;
    spare: number;
}

export interface ResourceNode {
    id: string;
    resource: string;
    purity: string;
    nodeType?: string;
    x: number;
    y: number;
    z?: number;
    flags?: NodeFlags | undefined;
}

export interface ResourceNodeDto {
    id: string;
    resource: string;
    purity: string;
    nodeType?: string;
    displayName?: string | undefined;
    x: number;
    y: number;
    z?: number;
    classPath?: string | undefined;
    rotation?: number | undefined;
    /**
     * Opaque optional flags (e.g. cave). Seed shuffle does not read these.
     */
    flags?: NodeFlagsDto | undefined;
}

export interface ScoreGridInput {
    nodes: ResourceNode[];
    openWater?: OpenWaterData | undefined;
    demand: RawDemand[];
    miner: MinerSettings;
    scoringMode?: string;
    options: ScoringOptions;
    bounds: WorldBounds;
    coarseCols: number;
    coarseRows: number;
    refineTopK: number;
    refineSubdiv: number;
    caveDeltaZCm?: number;
}

export interface ScoringOptions {
    centerPower?: number;
    heatContrast?: number;
    topN?: number;
    siteSepFraction?: number;
    includeElevation?: boolean;
}

export interface SiteScore {
    x: number;
    y: number;
    z: number;
    score: number;
    satisfiable: boolean;
    totalHaul: number;
    byResource: ResourceAssignment[];
    caveRiskNotes: string[];
    capacityTag?: string;
    maxUtilization?: number;
    capacityByResource?: ResourceCapacityInfo[];
    limited?: boolean;
}

export interface WorldBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}


/**
 * Apply map seed to fixed base slots.
 *
 * - `is_default` true → identity clone (vanilla layout)
 * - else → strict shuffle + purity no_change at `seed` (i32)
 */
export function apply_map_seed(nodes: ResourceNodeDto[], seed: number, is_default: boolean): ResourceNodeDto[];

/**
 * Crate / glue version for diagnostics.
 */
export function engine_version(): string;

/**
 * Cheap sanity export — worker calls once at boot to warm WASM.
 */
export function ping(): number;

/**
 * Hierarchical heatmap score (typed wire: `ScoreGridInput` → `HeatmapResult`).
 */
export function score_grid(input: ScoreGridInput): HeatmapResult;
