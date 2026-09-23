import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '../../helpers/intl-wrapper';
import { SensorHealthGrid } from '@/components/indicators/SensorHealthGrid';
import { useTelemetryStore } from '@/stores/telemetry-store';

// Mock the Tooltip to just render children
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const GYRO = 1 << 0;
const ACCEL = 1 << 1;
const BARO = 1 << 3;

/** Gyro and accel healthy; baro present and enabled but unhealthy; no GPS. */
function pushSysStatus(): void {
  act(() => {
    useTelemetryStore.getState().pushSysStatus({
      timestamp: Date.now(),
      cpuLoad: 100,
      sensorsPresent: GYRO | ACCEL | BARO,
      sensorsEnabled: GYRO | ACCEL | BARO,
      sensorsHealthy: GYRO | ACCEL,
      batteryRemaining: -1,
      dropRateComm: 0,
      errorsComm: 0,
    });
  });
}

describe('SensorHealthGrid', () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
  });

  it('shows "No sensor data" before any SYS_STATUS', () => {
    renderWithIntl(<SensorHealthGrid />);
    expect(screen.getByText('No sensor data')).toBeDefined();
  });

  it('renders present sensors by default (not all)', () => {
    pushSysStatus();
    renderWithIntl(<SensorHealthGrid />);

    expect(screen.getByText('3D Gyro')).toBeDefined();
    expect(screen.getByText('3D Accel')).toBeDefined();
    expect(screen.getByText('Abs Pressure')).toBeDefined();
    expect(screen.queryByText('GPS')).toBeNull();
  });

  it('renders all sensors when showAll=true', () => {
    pushSysStatus();
    renderWithIntl(<SensorHealthGrid showAll={true} />);
    expect(screen.getByText('GPS')).toBeDefined();
  });

  it('marks an enabled but unhealthy sensor as an error', () => {
    pushSysStatus();
    const { container } = renderWithIntl(<SensorHealthGrid />);
    expect(screen.getByText('Abs Pressure').className).toContain('text-status-error');
    expect(container.querySelectorAll('.text-status-success').length).toBeGreaterThan(0);
  });

  it('compact mode shows count ratio', () => {
    pushSysStatus();
    renderWithIntl(<SensorHealthGrid compact={true} />);
    expect(screen.getByText('2/3')).toBeDefined();
  });

  it('shows no sensor claims when the surface knows no FC is attached', () => {
    pushSysStatus();
    const { container } = renderWithIntl(<SensorHealthGrid compact fcLive={false} />);
    expect(screen.getByText('No sensor data')).toBeDefined();
    expect(container.querySelectorAll('.bg-status-success')).toHaveLength(0);
  });

  it('clicking a sensor expands details', () => {
    pushSysStatus();
    renderWithIntl(<SensorHealthGrid />);
    fireEvent.click(screen.getByText('3D Gyro'));
    expect(screen.getByText('Status')).toBeDefined();
    expect(screen.getByText('healthy')).toBeDefined();
    expect(screen.getByText('Present')).toBeDefined();
  });
});
