import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/patterns/survey-generator', () => ({
  generateSurvey: vi.fn(() => ({
    waypoints: [{ lat: 12, lon: 77, alt: 50 }],
    previewLines: [],
    stats: { totalDistance: 100, estimatedTime: 20, photoCount: 5, coveredArea: 1000, transectCount: 4 },
  })),
}));
vi.mock('@/lib/patterns/orbit-generator', () => ({
  generateOrbit: vi.fn(() => ({
    waypoints: [{ lat: 12, lon: 77, alt: 50 }],
    previewLines: [],
    stats: { totalDistance: 314, estimatedTime: 63, photoCount: 0, coveredArea: 0, transectCount: 0 },
  })),
}));
vi.mock('@/lib/patterns/corridor-generator', () => ({
  generateCorridor: vi.fn(() => ({
    waypoints: [],
    previewLines: [],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  })),
}));
vi.mock('@/lib/patterns/sar-generators', () => ({
  generateExpandingSquare: vi.fn(() => ({
    waypoints: [{ lat: 12, lon: 77, alt: 50 }],
    previewLines: [],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  })),
  generateSectorSearch: vi.fn(() => ({
    waypoints: [{ lat: 12, lon: 77, alt: 50 }],
    previewLines: [],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  })),
  generateParallelTrack: vi.fn(() => ({
    waypoints: [{ lat: 12, lon: 77, alt: 50 }],
    previewLines: [],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  })),
}));
vi.mock('@/lib/patterns/structure-scan-generator', () => ({
  generateStructureScan: vi.fn(() => ({
    waypoints: [{ lat: 12, lon: 77, alt: 50 }],
    previewLines: [],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  })),
}));
vi.mock('@/stores/drawing-store', () => ({
  useDrawingStore: {
    getState: vi.fn(() => ({
      polygons: [{ id: 'p1', vertices: [[12.97, 77.59], [12.97, 77.60], [12.98, 77.60], [12.98, 77.59]] }],
      selectedPolygonIds: [],
    })),
  },
}));

import { usePatternStore } from '@/stores/pattern-store';
import { generateSurvey } from '@/lib/patterns/survey-generator';
import { generateOrbit } from '@/lib/patterns/orbit-generator';
import { generateCorridor } from '@/lib/patterns/corridor-generator';
import { generateExpandingSquare, generateSectorSearch, generateParallelTrack } from '@/lib/patterns/sar-generators';
import { generateStructureScan } from '@/lib/patterns/structure-scan-generator';

describe('pattern-store', () => {
  beforeEach(() => {
    usePatternStore.getState().clear();
    vi.clearAllMocks();
  });

  // ------- Initial state -------
  it('has correct initial state', () => {
    const s = usePatternStore.getState();
    expect(s.activePatternType).toBeNull();
    expect(s.isGenerating).toBe(false);
    expect(s.error).toBeNull();
    expect(s.patternResult).toBeNull();
  });

  // ------- setPatternType -------
  it('setPatternType changes type and clears result and error', () => {
    usePatternStore.setState({ patternResult: { waypoints: [], previewLines: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } }, error: 'old error' });
    usePatternStore.getState().setPatternType('survey');
    const s = usePatternStore.getState();
    expect(s.activePatternType).toBe('survey');
    expect(s.patternResult).toBeNull();
    expect(s.error).toBeNull();
  });

  // ------- Config updates -------
  it('updateSurveyConfig merges partial config', () => {
    usePatternStore.getState().updateSurveyConfig({ lineSpacing: 50 });
    expect(usePatternStore.getState().surveyConfig.lineSpacing).toBe(50);
    // Other defaults preserved
    expect(usePatternStore.getState().surveyConfig.gridAngle).toBe(0);
  });

  it('updateOrbitConfig merges partial config', () => {
    usePatternStore.getState().updateOrbitConfig({ radius: 100 });
    expect(usePatternStore.getState().orbitConfig.radius).toBe(100);
    expect(usePatternStore.getState().orbitConfig.direction).toBe('cw');
  });

  it('updateCorridorConfig merges partial config', () => {
    usePatternStore.getState().updateCorridorConfig({ corridorWidth: 80 });
    expect(usePatternStore.getState().corridorConfig.corridorWidth).toBe(80);
  });

  it('updateSarExpandingSquareConfig merges partial config', () => {
    usePatternStore.getState().updateSarExpandingSquareConfig({ legSpacing: 100 });
    expect(usePatternStore.getState().sarExpandingSquareConfig.legSpacing).toBe(100);
  });

  it('updateSarSectorSearchConfig merges partial config', () => {
    usePatternStore.getState().updateSarSectorSearchConfig({ radius: 500 });
    expect(usePatternStore.getState().sarSectorSearchConfig.radius).toBe(500);
  });

  it('updateSarParallelTrackConfig merges partial config', () => {
    usePatternStore.getState().updateSarParallelTrackConfig({ trackLength: 1000 });
    expect(usePatternStore.getState().sarParallelTrackConfig.trackLength).toBe(1000);
  });

  it('updateStructureScanConfig merges partial config', () => {
    usePatternStore.getState().updateStructureScanConfig({ topAlt: 100 });
    expect(usePatternStore.getState().structureScanConfig.topAlt).toBe(100);
  });

  // ------- generate() -------
  it('generate() with null type does nothing', () => {
    usePatternStore.getState().generate();
    expect(usePatternStore.getState().patternResult).toBeNull();
    expect(usePatternStore.getState().isGenerating).toBe(false);
  });

  it('generate() survey calls generateSurvey when polygon available', () => {
    usePatternStore.getState().setPatternType('survey');
    usePatternStore.getState().generate();
    expect(generateSurvey).toHaveBeenCalled();
    expect(usePatternStore.getState().patternResult).not.toBeNull();
    expect(usePatternStore.getState().isGenerating).toBe(false);
  });

  it('generate() orbit calls generateOrbit when center exists', () => {
    usePatternStore.getState().setPatternType('orbit');
    usePatternStore.getState().updateOrbitConfig({ center: [12.97, 77.59] });
    usePatternStore.getState().generate();
    expect(generateOrbit).toHaveBeenCalled();
    expect(usePatternStore.getState().patternResult).not.toBeNull();
  });

  it('generate() corridor calls generateCorridor when pathPoints >= 2', () => {
    usePatternStore.getState().setPatternType('corridor');
    usePatternStore.getState().updateCorridorConfig({ pathPoints: [[12.97, 77.59], [12.98, 77.60]] });
    usePatternStore.getState().generate();
    expect(generateCorridor).toHaveBeenCalled();
  });

  it('generate() expandingSquare calls generateExpandingSquare when center exists', () => {
    usePatternStore.getState().setPatternType('expandingSquare');
    usePatternStore.getState().updateSarExpandingSquareConfig({ center: [12.97, 77.59] });
    usePatternStore.getState().generate();
    expect(generateExpandingSquare).toHaveBeenCalled();
  });

  it('generate() sectorSearch calls generateSectorSearch when center exists', () => {
    usePatternStore.getState().setPatternType('sectorSearch');
    usePatternStore.getState().updateSarSectorSearchConfig({ center: [12.97, 77.59] });
    usePatternStore.getState().generate();
    expect(generateSectorSearch).toHaveBeenCalled();
  });

  it('generate() parallelTrack calls generateParallelTrack when startPoint exists', () => {
    usePatternStore.getState().setPatternType('parallelTrack');
    usePatternStore.getState().updateSarParallelTrackConfig({ startPoint: [12.97, 77.59] });
    usePatternStore.getState().generate();
    expect(generateParallelTrack).toHaveBeenCalled();
  });

  it('generate() structureScan calls generateStructureScan when polygon >= 3', () => {
    usePatternStore.getState().setPatternType('structureScan');
    usePatternStore.getState().updateStructureScanConfig({
      structurePolygon: [[12.97, 77.59], [12.97, 77.60], [12.98, 77.60]],
    });
    usePatternStore.getState().generate();
    expect(generateStructureScan).toHaveBeenCalled();
  });

  it('generate() stores result', () => {
    usePatternStore.getState().setPatternType('orbit');
    usePatternStore.getState().updateOrbitConfig({ center: [12.97, 77.59] });
    usePatternStore.getState().generate();
    const r = usePatternStore.getState().patternResult;
    expect(r).not.toBeNull();
    expect(r!.stats.totalDistance).toBe(314);
  });

  it('generate() on error sets error and clears result', () => {
    vi.mocked(generateSurvey).mockImplementationOnce(() => {
      throw new Error('Generation failed');
    });
    usePatternStore.getState().setPatternType('survey');
    usePatternStore.getState().generate();
    const s = usePatternStore.getState();
    expect(s.error).toBe('Generation failed');
    expect(s.patternResult).toBeNull();
    expect(s.isGenerating).toBe(false);
  });

  // ------- clear() -------
  it('clear() resets everything to defaults', () => {
    usePatternStore.getState().setPatternType('survey');
    usePatternStore.getState().updateSurveyConfig({ lineSpacing: 999 });
    usePatternStore.getState().clear();
    const s = usePatternStore.getState();
    expect(s.activePatternType).toBeNull();
    expect(s.surveyConfig.lineSpacing).toBe(25);
    expect(s.patternResult).toBeNull();
    expect(s.isGenerating).toBe(false);
    expect(s.error).toBeNull();
  });

  // ------- Config defaults -------
  it('survey config defaults match expected values', () => {
    const s = usePatternStore.getState().surveyConfig;
    expect(s.gridAngle).toBe(0);
    expect(s.lineSpacing).toBe(25);
    expect(s.altitude).toBe(50);
    expect(s.speed).toBe(5);
  });

  it('orbit config defaults match expected values', () => {
    const s = usePatternStore.getState().orbitConfig;
    expect(s.radius).toBe(50);
    expect(s.direction).toBe('cw');
    expect(s.turns).toBe(1);
  });
});
