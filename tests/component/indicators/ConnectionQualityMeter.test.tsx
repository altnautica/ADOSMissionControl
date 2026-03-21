import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '../../helpers/intl-wrapper';
import { ConnectionQualityMeter } from '@/components/indicators/ConnectionQualityMeter';

// Mock the hook with controllable return values
const mockQuality = vi.fn();
vi.mock('@/hooks/use-connection-quality', () => ({
  useConnectionQuality: () => mockQuality(),
}));

describe('ConnectionQualityMeter', () => {
  it('returns null when quality is unknown', () => {
    mockQuality.mockReturnValue({
      quality: 'unknown',
      signalStrength: 0,
      latencyMs: 0,
      rssi: 0,
    });

    const { container } = renderWithIntl(<ConnectionQualityMeter />);
    expect(container.innerHTML).toBe('');
  });

  it('renders 4 signal bars for excellent quality', () => {
    mockQuality.mockReturnValue({
      quality: 'excellent',
      signalStrength: 100,
      latencyMs: 20,
      rssi: -50,
    });

    const { container } = renderWithIntl(<ConnectionQualityMeter />);

    // Should show 4 bars, all with success color
    const bars = container.querySelectorAll('.bg-status-success');
    expect(bars.length).toBe(4);
  });

  it('renders 1 bar for poor quality with error color', () => {
    mockQuality.mockReturnValue({
      quality: 'poor',
      signalStrength: 20,
      latencyMs: 800,
      rssi: -90,
    });

    const { container } = renderWithIntl(<ConnectionQualityMeter />);

    const errorBars = container.querySelectorAll('.bg-status-error');
    expect(errorBars.length).toBe(1);
  });

  it('shows latency badge when latencyMs > 0', () => {
    mockQuality.mockReturnValue({
      quality: 'good',
      signalStrength: 80,
      latencyMs: 45,
      rssi: -60,
    });

    renderWithIntl(<ConnectionQualityMeter />);
    expect(screen.getByText('45ms')).toBeDefined();
  });

  it('does not show latency badge when latencyMs is 0', () => {
    mockQuality.mockReturnValue({
      quality: 'good',
      signalStrength: 80,
      latencyMs: 0,
      rssi: -60,
    });

    renderWithIntl(<ConnectionQualityMeter />);
    expect(screen.queryByText(/ms$/)).toBeNull();
  });

  it('shows warning color for fair quality', () => {
    mockQuality.mockReturnValue({
      quality: 'fair',
      signalStrength: 50,
      latencyMs: 200,
      rssi: -75,
    });

    const { container } = renderWithIntl(<ConnectionQualityMeter />);

    const warningBars = container.querySelectorAll('.bg-status-warning');
    expect(warningBars.length).toBe(2); // bars 1 and 2
  });

  it('renders title attribute with signal info', () => {
    mockQuality.mockReturnValue({
      quality: 'good',
      signalStrength: 80,
      latencyMs: 30,
      rssi: -55,
    });

    const { container } = renderWithIntl(<ConnectionQualityMeter />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('title')).toContain('Signal: 80%');
    expect(root.getAttribute('title')).toContain('Latency: 30ms');
  });
});
