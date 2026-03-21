import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '../helpers/intl-wrapper';
import { PanelHeader } from '@/components/fc/shared/PanelHeader';

// Mock lucide-react icons to simple spans
vi.mock('lucide-react', () => ({
  RefreshCw: (props: any) => <span data-testid="icon-refresh" {...props} />,
  Download: (props: any) => <span data-testid="icon-download" {...props} />,
  Loader2: (props: any) => <span data-testid="icon-loader" {...props} />,
  AlertCircle: (props: any) => <span data-testid="icon-alert-circle" {...props} />,
  AlertTriangle: (props: any) => <span data-testid="icon-alert-triangle" {...props} />,
}));

describe('PanelHeader', () => {
  const defaultProps = {
    title: 'Test Panel',
    loading: false,
    loadProgress: null,
    hasLoaded: false,
    onRead: vi.fn(),
    connected: true,
    error: null,
  };

  it('renders title text', () => {
    renderWithIntl(<PanelHeader {...defaultProps} />);
    expect(screen.getByText('Test Panel')).toBeDefined();
  });

  it('renders subtitle when provided', () => {
    renderWithIntl(<PanelHeader {...defaultProps} subtitle="Panel description" />);
    expect(screen.getByText('Panel description')).toBeDefined();
  });

  it('shows loading spinner when loading=true with progress', () => {
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        loading={true}
        loadProgress={{ loaded: 5, total: 20 }}
      />
    );
    expect(screen.getByTestId('icon-loader')).toBeDefined();
    expect(screen.getByText('5/20')).toBeDefined();
  });

  it('shows error message when error is provided', () => {
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        error="Failed to read parameters"
      />
    );
    expect(screen.getByText('Failed to read parameters')).toBeDefined();
    expect(screen.getByTestId('icon-alert-circle')).toBeDefined();
  });

  it('does not show error while loading', () => {
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        loading={true}
        loadProgress={{ loaded: 1, total: 10 }}
        error="Some error"
      />
    );
    // Error badge is hidden during loading
    expect(screen.queryByText('Some error')).toBeNull();
  });

  it('calls onRead when Read from FC button is clicked', () => {
    const onRead = vi.fn();
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        onRead={onRead}
        connected={true}
        hasLoaded={false}
      />
    );

    const button = screen.getByText('Read from FC');
    fireEvent.click(button);
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('shows Retry button when there is an error and not yet loaded', () => {
    const onRead = vi.fn();
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        onRead={onRead}
        error="Timeout"
        hasLoaded={false}
      />
    );
    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('shows Refresh button when already loaded', () => {
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        hasLoaded={true}
      />
    );
    expect(screen.getByText('Refresh')).toBeDefined();
  });

  it('shows progress indicator when loadProgress provided', () => {
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        loading={true}
        loadProgress={{ loaded: 15, total: 30 }}
      />
    );
    expect(screen.getByText('15/30')).toBeDefined();
  });

  it('shows missing optional params warning', () => {
    const missing = new Set(['CAM1_TYPE', 'MNT1_TYPE']);
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        hasLoaded={true}
        missingOptional={missing}
      />
    );
    expect(screen.getByText('Some optional parameters are not available on this firmware')).toBeDefined();
    expect(screen.getByTestId('icon-alert-triangle')).toBeDefined();
  });

  it('hides all buttons when not connected', () => {
    renderWithIntl(
      <PanelHeader
        {...defaultProps}
        connected={false}
        hasLoaded={false}
      />
    );
    expect(screen.queryByText('Read from FC')).toBeNull();
    expect(screen.queryByText('Refresh')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
