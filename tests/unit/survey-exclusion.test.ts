import { describe, it, expect } from 'vitest';
import { generateSurvey } from '@/lib/patterns/survey-generator';
import { polygonArea } from '@/lib/drawing/geo-utils';
import type { SurveyConfig } from '@/lib/patterns/types';
import { pointInPolygon } from "@/lib/geo/distance";

// A ~660 m boundary square. gridAngle 0 + turnAroundDistance 0 keeps transect
// endpoints on the exact scan-line crossings, so exclusion clipping is easy to
// reason about.
function makeConfig(overrides?: Partial<SurveyConfig>): SurveyConfig {
  return {
    polygon: [
      [12.970, 77.590],
      [12.970, 77.596],
      [12.976, 77.596],
      [12.976, 77.590],
    ],
    gridAngle: 0,
    lineSpacing: 50,
    turnAroundDistance: 0,
    entryLocation: 'topLeft',
    flyAlternateTransects: false,
    cameraTriggerDistance: 0,
    altitude: 50,
    speed: 5,
    ...overrides,
  };
}

// A keep-out square fully inside the boundary, centered on the survey.
const HOLE: [number, number][] = [
  [12.972, 77.592],
  [12.972, 77.594],
  [12.974, 77.594],
  [12.974, 77.592],
];

/** Shrink a ring toward its centroid so exact edge points fall outside it. */
function insetRing(ring: [number, number][], frac: number): [number, number][] {
  const n = ring.length;
  const cLat = ring.reduce((s, p) => s + p[0], 0) / n;
  const cLon = ring.reduce((s, p) => s + p[1], 0) / n;
  return ring.map(([lat, lon]) => [lat + (cLat - lat) * frac, lon + (cLon - lon) * frac]);
}

/** Sample interior points along a preview transect line. */
function sampleInterior(line: [[number, number], [number, number]]): [number, number][] {
  const [a, b] = line;
  const out: [number, number][] = [];
  for (let t = 0.1; t <= 0.9 + 1e-9; t += 0.1) {
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

describe('generateSurvey exclusions', () => {
  it('empty / undefined exclusion list is a no-op', () => {
    const base = generateSurvey(makeConfig());
    const withEmpty = generateSurvey({ ...makeConfig(), exclusions: [] });
    const withUndef = generateSurvey({ ...makeConfig(), exclusions: undefined });

    expect(withEmpty.waypoints).toEqual(base.waypoints);
    expect(withEmpty.stats).toEqual(base.stats);
    expect(withEmpty.previewLines).toEqual(base.previewLines);
    expect(withUndef.waypoints).toEqual(base.waypoints);
  });

  it('a degenerate (<3 vertex) exclusion is ignored', () => {
    const base = generateSurvey(makeConfig());
    const withStub = generateSurvey({
      ...makeConfig(),
      exclusions: [[[12.973, 77.593]]],
    });
    expect(withStub.waypoints).toEqual(base.waypoints);
  });

  it('removes waypoints and breaks lines inside an exclusion', () => {
    const baseline = generateSurvey(makeConfig());
    const withHole = generateSurvey({ ...makeConfig(), exclusions: [HOLE] });

    // Splitting each transect that crosses the hole yields more segments.
    expect(withHole.stats.transectCount).toBeGreaterThan(baseline.stats.transectCount);

    // No nav waypoint lands strictly inside the hole (shrunk to avoid edge points).
    const shrunk = insetRing(HOLE, 0.15);
    const nav = withHole.waypoints.filter((w) => w.command === 'WAYPOINT');
    expect(nav.length).toBeGreaterThan(0);
    for (const w of nav) {
      expect(pointInPolygon([w.lat, w.lon], shrunk)).toBe(false);
    }

    // No transect line passes through the hole interior after clipping...
    const crossesHole = (r: ReturnType<typeof generateSurvey>) =>
      (r.previewLines ?? []).some((line) =>
        sampleInterior(line).some((p) => pointInPolygon(p, shrunk))
      );
    expect(crossesHole(withHole)).toBe(false);
    // ...whereas the un-clipped baseline lines DO cross it (test is meaningful).
    expect(crossesHole(baseline)).toBe(true);
  });

  it('an exclusion outside the boundary changes nothing', () => {
    const base = generateSurvey(makeConfig());
    const farHole: [number, number][] = [
      [12.980, 77.600],
      [12.980, 77.601],
      [12.981, 77.601],
      [12.981, 77.600],
    ];
    const withFar = generateSurvey({ ...makeConfig(), exclusions: [farHole] });
    expect(withFar.waypoints).toEqual(base.waypoints);
    expect(withFar.stats.transectCount).toBe(base.stats.transectCount);
  });

  it('coveredArea subtracts an interior exclusion hole', () => {
    const base = generateSurvey(makeConfig());
    const withHole = generateSurvey({ ...makeConfig(), exclusions: [HOLE] });
    // The reported covered area drops by roughly the hole's own area.
    expect(withHole.stats.coveredArea).toBeLessThan(base.stats.coveredArea);
    expect(base.stats.coveredArea - withHole.stats.coveredArea).toBeCloseTo(polygonArea(HOLE), -1);
  });

  it('coveredArea ignores an exclusion drawn outside the boundary', () => {
    const base = generateSurvey(makeConfig());
    const farHole: [number, number][] = [
      [12.980, 77.600], [12.980, 77.601], [12.981, 77.601], [12.981, 77.600],
    ];
    const withFar = generateSurvey({ ...makeConfig(), exclusions: [farHole] });
    expect(withFar.stats.coveredArea).toBeCloseTo(base.stats.coveredArea, 5);
  });

  it('flyAlternateTransects with a hole keeps whole scan lines, not split segments', () => {
    // A hole that splits the middle scan line into two segments, with alternate
    // transects on. The fix groups by scan-line y, so the result stays valid and
    // strictly smaller than the full survey rather than mixing half-lines.
    const full = generateSurvey({ ...makeConfig(), exclusions: [HOLE] });
    const alt = generateSurvey({ ...makeConfig(), flyAlternateTransects: true, exclusions: [HOLE] });
    expect(alt.stats.transectCount).toBeGreaterThan(0);
    expect(alt.stats.transectCount).toBeLessThan(full.stats.transectCount);
  });
});
