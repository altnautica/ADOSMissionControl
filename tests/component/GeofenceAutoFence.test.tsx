/**
 * @module GeofenceAutoFence.test
 * @description Component tests for the GeofenceEditor auto-fence control:
 * it wraps the current pattern/mission boundary, and toasts when none exists.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

const toastFn = vi.fn();
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: toastFn }),
}));

let patternState: {
  surveyConfig: { polygon?: [number, number][] };
  structureScanConfig: { structurePolygon?: [number, number][] };
  corridorConfig: { pathPoints?: [number, number][] };
};
vi.mock('@/stores/pattern-store', () => ({
  usePatternStore: { getState: () => patternState },
}));

let missionWaypoints: { lat: number; lon: number }[];
vi.mock('@/stores/mission-store', () => ({
  useMissionStore: { getState: () => ({ waypoints: missionWaypoints }) },
}));

vi.mock('@/stores/drone-manager', () => ({
  useDroneManager: { getState: () => ({ getSelectedProtocol: () => null }) },
}));
vi.mock('@/hooks/use-upload-status', () => ({
  useFenceUploadStatus: () => 'unknown',
}));

import { GeofenceEditor } from '@/components/planner/GeofenceEditor';
import { useGeofenceStore } from '@/stores/geofence-store';

describe('GeofenceEditor auto-fence control', () => {
  beforeEach(() => {
    useGeofenceStore.getState().clearFence();
    useGeofenceStore.getState().setEnabled(false);
    useGeofenceStore.getState().setFenceType('circle');
    patternState = { surveyConfig: {}, structureScanConfig: {}, corridorConfig: {} };
    missionWaypoints = [];
    toastFn.mockClear();
  });

  it('toasts when there is no boundary and no waypoints', () => {
    render(<GeofenceEditor />);
    fireEvent.click(screen.getByText('autoFence'));
    expect(toastFn).toHaveBeenCalledWith('autoFenceNoBoundary', 'info');
    expect(useGeofenceStore.getState().enabled).toBe(false);
  });

  it('builds a polygon fence from the survey boundary', () => {
    patternState.surveyConfig.polygon = [
      [12.97, 77.59],
      [12.97, 77.60],
      [12.98, 77.60],
      [12.98, 77.59],
    ];
    render(<GeofenceEditor />);
    fireEvent.click(screen.getByText('autoFence'));
    const s = useGeofenceStore.getState();
    expect(s.enabled).toBe(true);
    expect(s.fenceType).toBe('polygon');
    expect(s.polygonPoints.length).toBeGreaterThanOrEqual(3);
    expect(toastFn).not.toHaveBeenCalled();
  });

  it('falls back to the mission waypoint bounding box', () => {
    missionWaypoints = [
      { lat: 12.97, lon: 77.59 },
      { lat: 12.98, lon: 77.60 },
      { lat: 12.99, lon: 77.58 },
    ];
    render(<GeofenceEditor />);
    fireEvent.click(screen.getByText('autoFence'));
    const s = useGeofenceStore.getState();
    expect(s.enabled).toBe(true);
    expect(s.fenceType).toBe('polygon');
    expect(toastFn).not.toHaveBeenCalled();
  });
});
