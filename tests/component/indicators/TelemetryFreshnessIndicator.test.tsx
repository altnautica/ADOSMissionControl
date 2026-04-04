import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '../../helpers/intl-wrapper';
import { TelemetryFreshnessIndicator } from '@/components/indicators/TelemetryFreshnessIndicator';

// Mock the Tooltip to just render children
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock the hook to control freshness state
const mockGetFreshness = vi.fn();
vi.mock('@/hooks/use-telemetry-freshness', () => ({
  useTelemetryFreshness: () => ({
    getFreshness: mockGetFreshness,
  }),
}));

describe('TelemetryFreshnessIndicator', () => {
  it('renders all channel labels', () => {
    mockGetFreshness.mockReturnValue('none');

    renderWithIntl(<TelemetryFreshnessIndicator />);

    // Check short labels are rendered
    expect(screen.getByText('ATT')).toBeDefined();
    expect(screen.getByText('POS')).toBeDefined();
    expect(screen.getByText('BAT')).toBeDefined();
    expect(screen.getByText('GPS')).toBeDefined();
    expect(screen.getByText('RC')).toBeDefined();
    expect(screen.getByText('RAD')).toBeDefined();
    expect(screen.getByText('VFR')).toBeDefined();
    expect(screen.getByText('SYS')).toBeDefined();
    expect(screen.getByText('EKF')).toBeDefined();
    expect(screen.getByText('WND')).toBeDefined();
    expect(screen.getByText('NAV')).toBeDefined();
  });

  it('renders 11 channel dots', () => {
    mockGetFreshness.mockReturnValue('fresh');

    const { container } = renderWithIntl(<TelemetryFreshnessIndicator />);

    // Each channel has a colored dot (w-1.5 h-1.5 rounded-full)
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots.length).toBe(11);
  });
});
