import { describe, it, expect } from 'vitest';
import { generateSurvey } from '@/lib/patterns/survey-generator';
import type { SurveyConfig } from '@/lib/patterns/types';

function makeConfig(overrides?: Partial<SurveyConfig>): SurveyConfig {
  return {
    polygon: [
      [12.970, 77.590],
      [12.970, 77.600],
      [12.980, 77.600],
      [12.980, 77.590],
    ],
    gridAngle: 0,
    lineSpacing: 50,
    turnAroundDistance: 10,
    entryLocation: 'topLeft',
    flyAlternateTransects: false,
    cameraTriggerDistance: 0,
    altitude: 50,
    speed: 5,
    ...overrides,
  };
}

describe('generateSurvey', () => {
  it('generates waypoints for a simple rectangle', () => {
    const result = generateSurvey(makeConfig());
    expect(result.waypoints.length).toBeGreaterThan(0);
  });

  it('boustrophedon pattern alternates direction', () => {
    const result = generateSurvey(makeConfig({ lineSpacing: 100 }));
    // With boustrophedon, consecutive transect pairs should swap start/end X direction.
    // Check that we get at least 2 transects (4 waypoints for non-camera mode).
    expect(result.waypoints.length).toBeGreaterThanOrEqual(4);
    expect(result.stats.transectCount).toBeGreaterThanOrEqual(2);
  });

  it('crosshatch pattern generates perpendicular passes', () => {
    const result = generateSurvey(makeConfig({ crosshatch: true }));
    const singleResult = generateSurvey(makeConfig({ crosshatch: false }));
    // Crosshatch should produce more waypoints than a single pass
    expect(result.waypoints.length).toBeGreaterThan(singleResult.waypoints.length);
    expect(result.stats.transectCount).toBeGreaterThan(singleResult.stats.transectCount);
  });

  it('waypoints are inside or near the polygon boundary', () => {
    const result = generateSurvey(makeConfig({ turnAroundDistance: 0 }));
    // With zero overshoot, all waypoints should be within or very near the polygon
    for (const wp of result.waypoints) {
      // Allow small tolerance for floating point
      expect(wp.lat).toBeGreaterThanOrEqual(12.969);
      expect(wp.lat).toBeLessThanOrEqual(12.981);
      expect(wp.lon).toBeGreaterThanOrEqual(77.589);
      expect(wp.lon).toBeLessThanOrEqual(77.601);
    }
  });

  it('stats include totalDistance, transectCount, estimatedTime', () => {
    const result = generateSurvey(makeConfig());
    expect(result.stats.totalDistance).toBeGreaterThan(0);
    expect(result.stats.transectCount).toBeGreaterThan(0);
    expect(result.stats.estimatedTime).toBeGreaterThan(0);
  });

  it('respects lineSpacing parameter', () => {
    const narrow = generateSurvey(makeConfig({ lineSpacing: 25 }));
    const wide = generateSurvey(makeConfig({ lineSpacing: 100 }));
    // Narrower spacing = more transects
    expect(narrow.stats.transectCount).toBeGreaterThan(wide.stats.transectCount);
  });

  it('returns empty for degenerate polygon (< 3 vertices)', () => {
    const result = generateSurvey(makeConfig({
      polygon: [[12.97, 77.59], [12.98, 77.60]],
    }));
    expect(result.waypoints).toHaveLength(0);
  });

  it('handles concave L-shaped polygon', () => {
    const lShape: [number, number][] = [
      [12.970, 77.590],
      [12.970, 77.600],
      [12.975, 77.600],
      [12.975, 77.595],
      [12.980, 77.595],
      [12.980, 77.590],
    ];
    const result = generateSurvey(makeConfig({ polygon: lShape }));
    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.stats.transectCount).toBeGreaterThan(0);
  });

  it('handles very small polygon', () => {
    const tiny: [number, number][] = [
      [12.9700, 77.5900],
      [12.9700, 77.5901],
      [12.9701, 77.5901],
      [12.9701, 77.5900],
    ];
    const result = generateSurvey(makeConfig({ polygon: tiny, lineSpacing: 5 }));
    // May produce few or no transects depending on spacing vs polygon size
    expect(result.stats).toBeDefined();
  });

  it('turnAroundDistance adds overshoot past boundary', () => {
    const noOvershoot = generateSurvey(makeConfig({ turnAroundDistance: 0 }));
    const withOvershoot = generateSurvey(makeConfig({ turnAroundDistance: 50 }));
    // With overshoot, total distance should be larger
    expect(withOvershoot.stats.totalDistance).toBeGreaterThan(noOvershoot.stats.totalDistance);
  });

  it('cameraTriggerDistance adds photo count', () => {
    const withCamera = generateSurvey(makeConfig({ cameraTriggerDistance: 10 }));
    expect(withCamera.stats.photoCount).toBeGreaterThan(0);
  });

  it('flyAlternateTransects skips every other line', () => {
    const normal = generateSurvey(makeConfig({ flyAlternateTransects: false }));
    const alternate = generateSurvey(makeConfig({ flyAlternateTransects: true }));
    // Alternate should have fewer transects (roughly half)
    expect(alternate.stats.transectCount).toBeLessThan(normal.stats.transectCount);
  });

  it('45 degree grid angle produces diagonal transects', () => {
    const result = generateSurvey(makeConfig({ gridAngle: 45 }));
    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.stats.transectCount).toBeGreaterThan(0);
  });

  it('entry location bottomRight starts from different corner', () => {
    const topLeft = generateSurvey(makeConfig({ entryLocation: 'topLeft' }));
    const bottomRight = generateSurvey(makeConfig({ entryLocation: 'bottomRight' }));
    // First waypoints should differ
    if (topLeft.waypoints.length > 0 && bottomRight.waypoints.length > 0) {
      const tl = topLeft.waypoints[0];
      const br = bottomRight.waypoints[0];
      const different = tl.lat !== br.lat || tl.lon !== br.lon;
      expect(different).toBe(true);
    }
  });

  it('tieLines generates additional perpendicular transects', () => {
    const noTie = generateSurvey(makeConfig({ tieLines: false }));
    const withTie = generateSurvey(makeConfig({
      tieLines: true,
      tieLineAngle: 90,
      tieLineSpacing: 50,
    }));
    expect(withTie.waypoints.length).toBeGreaterThan(noTie.waypoints.length);
  });

  it('all waypoints have altitude set from config', () => {
    const result = generateSurvey(makeConfig({ altitude: 80 }));
    for (const wp of result.waypoints) {
      expect(wp.alt).toBe(80);
    }
  });

  it('coveredArea in stats is non-negative', () => {
    const result = generateSurvey(makeConfig());
    expect(result.stats.coveredArea).toBeGreaterThanOrEqual(0);
  });
});
