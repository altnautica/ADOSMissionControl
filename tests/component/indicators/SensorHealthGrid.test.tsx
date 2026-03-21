import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '../../helpers/intl-wrapper';
import { SensorHealthGrid } from '@/components/indicators/SensorHealthGrid';

// Mock the Tooltip to just render children
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Check: (props: any) => <span data-testid="icon-check" {...props} />,
  X: (props: any) => <span data-testid="icon-x" {...props} />,
  AlertTriangle: (props: any) => <span data-testid="icon-alert" {...props} />,
  Minus: (props: any) => <span data-testid="icon-minus" {...props} />,
  ChevronDown: (props: any) => <span data-testid="icon-chevron" {...props} />,
}));

// Mock sensor health store
const mockSensors = vi.fn();
const mockHealthyCount = vi.fn();
const mockTotalPresent = vi.fn();
const mockLastUpdate = vi.fn();

vi.mock('@/stores/sensor-health-store', () => ({
  useSensorHealthStore: (selector: any) => {
    // The component calls the store with different selectors
    const state = {
      sensors: mockSensors(),
      getHealthySensorCount: mockHealthyCount,
      getTotalPresentCount: mockTotalPresent,
      lastUpdate: mockLastUpdate(),
    };
    return selector(state);
  },
}));

describe('SensorHealthGrid', () => {
  const sampleSensors = [
    { bit: 0, label: 'Gyro', status: 'healthy' as const, present: true, enabled: true, healthy: true },
    { bit: 1, label: 'Accel', status: 'healthy' as const, present: true, enabled: true, healthy: true },
    { bit: 2, label: 'Baro', status: 'unhealthy' as const, present: true, enabled: true, healthy: false },
    { bit: 3, label: 'GPS', status: 'not_present' as const, present: false, enabled: false, healthy: false },
  ];

  beforeEach(() => {
    mockSensors.mockReturnValue(sampleSensors);
    mockHealthyCount.mockReturnValue(2);
    mockTotalPresent.mockReturnValue(3);
    mockLastUpdate.mockReturnValue(Date.now());
  });

  it('shows "No sensor data" when no sensors are displayed', () => {
    mockSensors.mockReturnValue([]);

    renderWithIntl(<SensorHealthGrid />);
    expect(screen.getByText('No sensor data')).toBeDefined();
  });

  it('renders present sensors by default (not all)', () => {
    renderWithIntl(<SensorHealthGrid />);

    // Present sensors: Gyro, Accel, Baro (3 out of 4)
    expect(screen.getByText('Gyro')).toBeDefined();
    expect(screen.getByText('Accel')).toBeDefined();
    expect(screen.getByText('Baro')).toBeDefined();
    // GPS is not present, should not appear without showAll
    expect(screen.queryByText('GPS')).toBeNull();
  });

  it('renders all sensors when showAll=true', () => {
    renderWithIntl(<SensorHealthGrid showAll={true} />);

    expect(screen.getByText('Gyro')).toBeDefined();
    expect(screen.getByText('Accel')).toBeDefined();
    expect(screen.getByText('Baro')).toBeDefined();
    expect(screen.getByText('GPS')).toBeDefined();
  });

  it('compact mode shows count ratio', () => {
    renderWithIntl(<SensorHealthGrid compact={true} />);
    expect(screen.getByText('2/3')).toBeDefined();
  });

  it('clicking a sensor expands details', () => {
    renderWithIntl(<SensorHealthGrid />);

    // Click on Gyro to expand
    fireEvent.click(screen.getByText('Gyro'));

    // Should show expanded details
    expect(screen.getByText('Status')).toBeDefined();
    expect(screen.getByText('healthy')).toBeDefined();
    expect(screen.getByText('Present')).toBeDefined();
  });
});
