import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '../../helpers/intl-wrapper';
import { EkfStatusBars } from '@/components/indicators/EkfStatusBars';
import { useTelemetryStore } from '@/stores/telemetry-store';
import { RingBuffer } from '@/lib/ring-buffer';

// Mock the Tooltip to just render children
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock lucide-react (not used by EkfStatusBars but may be transitive)
vi.mock('lucide-react', () => new Proxy({}, {
  get: (_target, name) => {
    if (name === '__esModule') return false;
    return (props: any) => <span data-testid={`icon-${String(name)}`} {...props} />;
  },
}));

describe('EkfStatusBars', () => {
  beforeEach(() => {
    // Reset telemetry store with fresh ring buffers
    useTelemetryStore.setState({
      ekf: new RingBuffer(60),
      estimatorStatus: new RingBuffer(60),
    });
  });

  it('shows "No EKF data" when ring buffer is empty', () => {
    renderWithIntl(<EkfStatusBars />);
    expect(screen.getByText('No EKF data')).toBeDefined();
  });

  it('renders all 5 EKF variance bars when data is present', () => {
    const ekfBuffer = new RingBuffer<any>(60);
    ekfBuffer.push({
      velocityVariance: 0.3,
      posHorizVariance: 0.6,
      posVertVariance: 0.1,
      compassVariance: 0.9,
      terrainAltVariance: 0.4,
      flags: 0,
      timestamp: Date.now(),
    });

    useTelemetryStore.setState({ ekf: ekfBuffer });

    renderWithIntl(<EkfStatusBars />);

    // Check that variance values are displayed (formatted to 2 decimal places)
    expect(screen.getByText('0.30')).toBeDefined();
    expect(screen.getByText('0.60')).toBeDefined();
    expect(screen.getByText('0.10')).toBeDefined();
    expect(screen.getByText('0.90')).toBeDefined();
    expect(screen.getByText('0.40')).toBeDefined();
  });

  it('renders estimator flags when estimator data is present', () => {
    const ekfBuffer = new RingBuffer<any>(60);
    ekfBuffer.push({
      velocityVariance: 0.2,
      posHorizVariance: 0.2,
      posVertVariance: 0.2,
      compassVariance: 0.2,
      terrainAltVariance: 0.2,
      flags: 0,
      timestamp: Date.now(),
    });

    const estimatorBuffer = new RingBuffer<any>(60);
    estimatorBuffer.push({
      flags: 0x000F, // ATT + VH + VV + PHR
      timestamp: Date.now(),
    });

    useTelemetryStore.setState({
      ekf: ekfBuffer,
      estimatorStatus: estimatorBuffer,
    });

    renderWithIntl(<EkfStatusBars />);

    // Estimator flags section should render flag abbreviations
    expect(screen.getByText('ATT')).toBeDefined();
    expect(screen.getByText('VH')).toBeDefined();
    expect(screen.getByText('VV')).toBeDefined();
  });
});
