/**
 * @module pattern-store
 * @description Zustand store for flight pattern generation state.
 * Holds config for each pattern type, the generated result, and actions
 * to update config, trigger generation, and clear.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  SurveyConfig,
  OrbitConfig,
  CorridorConfig,
  PatternResult,
} from "@/lib/patterns/types";
import type { ExpandingSquareConfig, SectorSearchConfig, ParallelTrackConfig } from "@/lib/patterns/sar-generators";
import type { StructureScanConfig } from "@/lib/patterns/structure-scan-generator";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { generateOrbit } from "@/lib/patterns/orbit-generator";
import { generateCorridor } from "@/lib/patterns/corridor-generator";
import { generateExpandingSquare, generateSectorSearch, generateParallelTrack } from "@/lib/patterns/sar-generators";
import { generateStructureScan } from "@/lib/patterns/structure-scan-generator";
import { formatErrorMessage } from "@/lib/utils";
import { useDrawingStore } from "./drawing-store";

type PatternType = "survey" | "orbit" | "corridor" | "expandingSquare" | "sectorSearch" | "parallelTrack" | "structureScan" | null;

interface PatternStoreState {
  activePatternType: PatternType;
  surveyConfig: Partial<SurveyConfig>;
  orbitConfig: Partial<OrbitConfig>;
  corridorConfig: Partial<CorridorConfig>;
  sarExpandingSquareConfig: Partial<ExpandingSquareConfig>;
  sarSectorSearchConfig: Partial<SectorSearchConfig>;
  sarParallelTrackConfig: Partial<ParallelTrackConfig>;
  structureScanConfig: Partial<StructureScanConfig>;
  patternResult: PatternResult | null;
  isGenerating: boolean;
  error: string | null;

  setPatternType: (type: PatternType) => void;
  updateSurveyConfig: (update: Partial<SurveyConfig>) => void;
  updateOrbitConfig: (update: Partial<OrbitConfig>) => void;
  updateCorridorConfig: (update: Partial<CorridorConfig>) => void;
  updateSarExpandingSquareConfig: (update: Partial<ExpandingSquareConfig>) => void;
  updateSarSectorSearchConfig: (update: Partial<SectorSearchConfig>) => void;
  updateSarParallelTrackConfig: (update: Partial<ParallelTrackConfig>) => void;
  updateStructureScanConfig: (update: Partial<StructureScanConfig>) => void;
  generate: () => void;
  clear: () => void;
}

const defaultSurvey: Partial<SurveyConfig> = {
  gridAngle: 0,
  lineSpacing: 25,
  turnAroundDistance: 10,
  entryLocation: "topLeft",
  flyAlternateTransects: false,
  cameraTriggerDistance: 0,
  tieLines: false,
  tieLineAngle: 90,
  tieLineSpacing: 25,
  altitude: 50,
  speed: 5,
};

const defaultOrbit: Partial<OrbitConfig> = {
  radius: 50,
  direction: "cw",
  turns: 1,
  startAngle: 0,
  altitude: 50,
  speed: 5,
};

const defaultCorridor: Partial<CorridorConfig> = {
  corridorWidth: 50,
  lineSpacing: 20,
  altitude: 50,
  speed: 5,
};

const defaultExpandingSquare: Partial<ExpandingSquareConfig> = {
  legSpacing: 50,
  maxLegs: 20,
  altitude: 50,
  speed: 5,
  startBearing: 0,
};

const defaultSectorSearch: Partial<SectorSearchConfig> = {
  radius: 200,
  sweeps: 3,
  altitude: 50,
  speed: 5,
  startBearing: 0,
};

const defaultParallelTrack: Partial<ParallelTrackConfig> = {
  trackLength: 500,
  trackSpacing: 50,
  trackCount: 10,
  bearing: 0,
  altitude: 50,
  speed: 5,
};

const defaultStructureScan: Partial<StructureScanConfig> = {
  bottomAlt: 10,
  topAlt: 50,
  layerSpacing: 10,
  scanDistance: 15,
  gimbalPitch: -30,
  pointsPerLayer: 16,
  cameraTriggerDistance: 0,
  speed: 3,
  direction: "bottom-up",
};

/** Merge multiple survey results into one combined result. */
function mergeSurveyResults(results: PatternResult[]): PatternResult {
  return {
    waypoints: results.flatMap((r) => r.waypoints),
    previewLines: results.flatMap((r) => r.previewLines ?? []),
    stats: {
      totalDistance: results.reduce((s, r) => s + r.stats.totalDistance, 0),
      estimatedTime: results.reduce((s, r) => s + r.stats.estimatedTime, 0),
      photoCount: results.reduce((s, r) => s + r.stats.photoCount, 0),
      coveredArea: results.reduce((s, r) => s + r.stats.coveredArea, 0),
      transectCount: results.reduce((s, r) => s + r.stats.transectCount, 0),
    },
  };
}

/** Generate a survey pattern, handling multi-polygon selection from drawing store. */
function generateSurveyPattern(cfg: Partial<SurveyConfig>): PatternResult | null {
  const fullCfg = cfg as SurveyConfig;
  if (fullCfg.polygon && fullCfg.polygon.length >= 3) {
    return generateSurvey(fullCfg);
  }
  const drawState = useDrawingStore.getState();
  const selectedIds = drawState.selectedPolygonIds;
  const polygons = selectedIds.length > 0
    ? drawState.polygons.filter((p) => selectedIds.includes(p.id))
    : drawState.polygons.slice(-1);

  if (polygons.length === 1 && polygons[0].vertices.length >= 3) {
    return generateSurvey({ ...fullCfg, polygon: polygons[0].vertices });
  }
  if (polygons.length > 1) {
    const results = polygons
      .filter((p) => p.vertices.length >= 3)
      .map((p) => generateSurvey({ ...fullCfg, polygon: p.vertices }));
    return results.length > 0 ? mergeSurveyResults(results) : null;
  }
  return null;
}

/** Generate an orbit pattern, falling back to the last drawn circle. */
function generateOrbitPattern(cfg: Partial<OrbitConfig>): PatternResult | null {
  const fullCfg = cfg as OrbitConfig;
  if (fullCfg.center) return generateOrbit(fullCfg);
  const drawState = useDrawingStore.getState();
  if (drawState.circles.length > 0) {
    const lastCircle = drawState.circles[drawState.circles.length - 1];
    return generateOrbit({ ...fullCfg, center: lastCircle.center, radius: lastCircle.radius ?? fullCfg.radius } as OrbitConfig);
  }
  return null;
}

/** Generate a structure scan, falling back to the last drawn polygon. */
function generateStructureScanPattern(cfg: Partial<StructureScanConfig>): PatternResult | null {
  const fullCfg = cfg as StructureScanConfig;
  if (fullCfg.structurePolygon && fullCfg.structurePolygon.length >= 3) {
    return generateStructureScan(fullCfg);
  }
  const drawState = useDrawingStore.getState();
  const lastPoly = drawState.polygons[drawState.polygons.length - 1];
  if (lastPoly && lastPoly.vertices.length >= 3) {
    return generateStructureScan({ ...fullCfg, structurePolygon: lastPoly.vertices } as StructureScanConfig);
  }
  return null;
}

/** Dispatch pattern generation by type. Returns null if input geometry is missing. */
function generatePattern(state: PatternStoreState): PatternResult | null {
  switch (state.activePatternType) {
    case "survey": return generateSurveyPattern(state.surveyConfig);
    case "orbit": return generateOrbitPattern(state.orbitConfig);
    case "corridor": {
      const cfg = state.corridorConfig as CorridorConfig;
      return cfg.pathPoints && cfg.pathPoints.length >= 2 ? generateCorridor(cfg) : null;
    }
    case "expandingSquare": {
      const cfg = state.sarExpandingSquareConfig as ExpandingSquareConfig;
      return cfg.center ? generateExpandingSquare(cfg) : null;
    }
    case "sectorSearch": {
      const cfg = state.sarSectorSearchConfig as SectorSearchConfig;
      return cfg.center ? generateSectorSearch(cfg) : null;
    }
    case "parallelTrack": {
      const cfg = state.sarParallelTrackConfig as ParallelTrackConfig;
      return cfg.startPoint ? generateParallelTrack(cfg) : null;
    }
    case "structureScan": return generateStructureScanPattern(state.structureScanConfig);
    default: return null;
  }
}

const MISSING_GEOMETRY_MESSAGES: Record<string, string> = {
  survey: "Draw a polygon on the map first",
  orbit: "Draw a circle or click to set orbit center",
  corridor: "Set corridor path points (use measure tool)",
  expandingSquare: "Click map to set datum point",
  sectorSearch: "Click map to set datum point",
  parallelTrack: "Click map to set start point",
  structureScan: "Draw structure boundary polygon on map",
};

export const usePatternStore = create<PatternStoreState>()((set, get) => ({
  activePatternType: null,
  surveyConfig: { ...defaultSurvey },
  orbitConfig: { ...defaultOrbit },
  corridorConfig: { ...defaultCorridor },
  sarExpandingSquareConfig: { ...defaultExpandingSquare },
  sarSectorSearchConfig: { ...defaultSectorSearch },
  sarParallelTrackConfig: { ...defaultParallelTrack },
  structureScanConfig: { ...defaultStructureScan },
  patternResult: null,
  isGenerating: false,
  error: null,

  setPatternType: (type) =>
    set({ activePatternType: type, patternResult: null, error: null }),

  updateSurveyConfig: (update) =>
    set((s) => ({ surveyConfig: { ...s.surveyConfig, ...update } })),

  updateOrbitConfig: (update) =>
    set((s) => ({ orbitConfig: { ...s.orbitConfig, ...update } })),

  updateCorridorConfig: (update) =>
    set((s) => ({ corridorConfig: { ...s.corridorConfig, ...update } })),

  updateSarExpandingSquareConfig: (update) =>
    set((s) => ({ sarExpandingSquareConfig: { ...s.sarExpandingSquareConfig, ...update } })),

  updateSarSectorSearchConfig: (update) =>
    set((s) => ({ sarSectorSearchConfig: { ...s.sarSectorSearchConfig, ...update } })),

  updateSarParallelTrackConfig: (update) =>
    set((s) => ({ sarParallelTrackConfig: { ...s.sarParallelTrackConfig, ...update } })),

  updateStructureScanConfig: (update) =>
    set((s) => ({ structureScanConfig: { ...s.structureScanConfig, ...update } })),

  generate: () => {
    const {
      activePatternType, surveyConfig, orbitConfig, corridorConfig,
      sarExpandingSquareConfig, sarSectorSearchConfig, sarParallelTrackConfig,
      structureScanConfig,
    } = get();
    if (!activePatternType) return;

    set({ isGenerating: true, error: null });

    let result: PatternResult | null = null;

    try {
      switch (activePatternType) {
        case "survey": {
          const cfg = surveyConfig as SurveyConfig;
          if (cfg.polygon && cfg.polygon.length >= 3) {
            result = generateSurvey(cfg);
          } else {
            // Multi-polygon: generate per selected polygon and merge
            const drawState = useDrawingStore.getState();
            const selectedIds = drawState.selectedPolygonIds;
            const polygons = selectedIds.length > 0
              ? drawState.polygons.filter((p) => selectedIds.includes(p.id))
              : drawState.polygons.slice(-1); // fallback: last polygon

            if (polygons.length === 1 && polygons[0].vertices.length >= 3) {
              result = generateSurvey({ ...cfg, polygon: polygons[0].vertices });
            } else if (polygons.length > 1) {
              const results = polygons
                .filter((p) => p.vertices.length >= 3)
                .map((p) => generateSurvey({ ...cfg, polygon: p.vertices }));
              if (results.length > 0) {
                result = {
                  waypoints: results.flatMap((r) => r.waypoints),
                  previewLines: results.flatMap((r) => r.previewLines ?? []),
                  stats: {
                    totalDistance: results.reduce((s, r) => s + r.stats.totalDistance, 0),
                    estimatedTime: results.reduce((s, r) => s + r.stats.estimatedTime, 0),
                    photoCount: results.reduce((s, r) => s + r.stats.photoCount, 0),
                    coveredArea: results.reduce((s, r) => s + r.stats.coveredArea, 0),
                    transectCount: results.reduce((s, r) => s + r.stats.transectCount, 0),
                  },
                };
              }
            }
          }
          break;
        }
        case "orbit": {
          const cfg = orbitConfig as OrbitConfig;
          if (cfg.center) {
            result = generateOrbit(cfg);
          } else {
            const drawState = useDrawingStore.getState();
            if (drawState.circles.length > 0) {
              const lastCircle = drawState.circles[drawState.circles.length - 1];
              result = generateOrbit({ ...cfg, center: lastCircle.center, radius: lastCircle.radius ?? cfg.radius } as OrbitConfig);
            }
          }
          break;
        }
        case "corridor": {
          const cfg = corridorConfig as CorridorConfig;
          if (cfg.pathPoints && cfg.pathPoints.length >= 2) {
            result = generateCorridor(cfg);
          }
          break;
        }
        case "expandingSquare": {
          const cfg = sarExpandingSquareConfig as ExpandingSquareConfig;
          if (cfg.center) {
            result = generateExpandingSquare(cfg);
          }
          break;
        }
        case "sectorSearch": {
          const cfg = sarSectorSearchConfig as SectorSearchConfig;
          if (cfg.center) {
            result = generateSectorSearch(cfg);
          }
          break;
        }
        case "parallelTrack": {
          const cfg = sarParallelTrackConfig as ParallelTrackConfig;
          if (cfg.startPoint) {
            result = generateParallelTrack(cfg);
          }
          break;
        }
        case "structureScan": {
          const cfg = structureScanConfig as StructureScanConfig;
          if (cfg.structurePolygon && cfg.structurePolygon.length >= 3) {
            result = generateStructureScan(cfg);
          } else {
            const drawState = useDrawingStore.getState();
            const lastPoly = drawState.polygons[drawState.polygons.length - 1];
            if (lastPoly && lastPoly.vertices.length >= 3) {
              result = generateStructureScan({ ...cfg, structurePolygon: lastPoly.vertices } as StructureScanConfig);
            }
          }
          break;
        }
      }
    } catch (err) {
      result = null;
      set({
        error: err instanceof Error ? err.message : "Pattern generation failed",
        patternResult: null,
        isGenerating: false,
      });
      return;
    }

    if (result === null) {
      const msgs: Record<string, string> = {
        survey: "Draw a polygon on the map first",
        orbit: "Draw a circle or click to set orbit center",
        corridor: "Set corridor path points (use measure tool)",
        expandingSquare: "Click map to set datum point",
        sectorSearch: "Click map to set datum point",
        parallelTrack: "Click map to set start point",
        structureScan: "Draw structure boundary polygon on map",
      };
      set({ patternResult: null, isGenerating: false, error: msgs[activePatternType] ?? "Missing input geometry" });
      return;
    }
    set({ patternResult: result, isGenerating: false, error: null });
  },

  clear: () =>
    set({
      activePatternType: null,
      surveyConfig: { ...defaultSurvey },
      orbitConfig: { ...defaultOrbit },
      corridorConfig: { ...defaultCorridor },
      sarExpandingSquareConfig: { ...defaultExpandingSquare },
      sarSectorSearchConfig: { ...defaultSectorSearch },
      sarParallelTrackConfig: { ...defaultParallelTrack },
      structureScanConfig: { ...defaultStructureScan },
      patternResult: null,
      isGenerating: false,
      error: null,
    }),
}));
