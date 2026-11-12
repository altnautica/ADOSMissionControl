/**
 * @module GeozoneMapEditor.test
 * @description Unit tests for the GeozoneMapEditor component.
 * Leaflet internals are mocked; tests focus on component contract.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl as render } from "../helpers/intl-wrapper";
import { GeozoneMapEditor } from '@/components/fc/inav/GeozoneMapEditor';
import type { INavGeozoneVertex } from '@/lib/protocol/types/inav';

// ── Mock Leaflet ──────────────────────────────────────────────
//
// Leaflet relies on a real DOM with layout APIs that jsdom does not implement.
// We replace the parts the component calls with minimal stubs.

const mockMapRemove = vi.fn();
const mockLayerAdd = vi.fn();
const mockLayerRemove = vi.fn();
const mockTileLayerAddTo = vi.fn();

const mockFeatureGroup = {
  addTo: vi.fn().mockReturnThis(),
  clearLayers: vi.fn(),
  removeLayer: vi.fn(),
};

const mockMap = {
  remove: mockMapRemove,
  on: vi.fn(),
  off: vi.fn(),
  doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
  dragging: { disable: vi.fn(), enable: vi.fn() },
  latLngToContainerPoint: vi.fn(() => ({ distanceTo: vi.fn(() => 100) })),
  getContainer: vi.fn(() => ({ getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0 })) })),
  addLayer: mockLayerAdd,
  removeLayer: mockLayerRemove,
};

vi.mock('leaflet', () => {
  const L = {
    map: vi.fn(() => mockMap),
    tileLayer: vi.fn(() => ({ addTo: mockTileLayerAddTo })),
    featureGroup: vi.fn(() => mockFeatureGroup),
    marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    polygon: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    polyline: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    circleMarker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    circle: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn(), setRadius: vi.fn() })),
    latLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
    DomEvent: { stop: vi.fn() },
  };
  return { default: L };
});

// ── Helpers ───────────────────────────────────────────────────

function makeVerts(count: number): INavGeozoneVertex[] {
  return Array.from({ length: count }, (_, i) => ({
    geozoneId: 0,
    vertexIdx: i,
    lat: i * 0.001,
    lon: i * 0.001,
  }));
}

const defaultProps = {
  zoneId: 0,
  shape: 1, // POLYGON
  currentVertices: [] as INavGeozoneVertex[],
  onCommit: vi.fn(),
  onCancel: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────

describe('GeozoneMapEditor', () => {
  it('renders a map container div', () => {
    const { container } = render(<GeozoneMapEditor {...defaultProps} />);
    // The map container div has inline style height:400
    const mapDiv = container.querySelector('[style*="height: 400"]') ??
      container.querySelector('[style*="height:400"]');
    expect(mapDiv).not.toBeNull();
  });

  it('shows empty state when polygon mode has no vertices', () => {
    render(<GeozoneMapEditor {...defaultProps} currentVertices={[]} />);
    expect(screen.getByText(/No vertices yet/i)).toBeDefined();
  });

  it('shows vertex count badge when 3 existing vertices are provided', () => {
    render(
      <GeozoneMapEditor
        {...defaultProps}
        currentVertices={makeVerts(3)}
      />,
    );
    // Badge shows "3 / 10"
    expect(screen.getByText(/3 \/ 10/i)).toBeDefined();
  });

  it('fires onCommit with existing vertices when committed without drawing', () => {
    const onCommit = vi.fn();
    render(
      <GeozoneMapEditor
        {...defaultProps}
        currentVertices={makeVerts(3)}
        onCommit={onCommit}
      />,
    );
    const commitBtn = screen.getByText(/Commit to zone/i);
    fireEvent.click(commitBtn);
    expect(onCommit).toHaveBeenCalledOnce();
    const result: INavGeozoneVertex[] = onCommit.mock.calls[0][0];
    expect(result).toHaveLength(3);
    expect(result[0].geozoneId).toBe(0);
  });

  it('renders circular-mode fallback message when shape is 0', () => {
    render(<GeozoneMapEditor {...defaultProps} shape={0} />);
    expect(screen.getByText(/Circular zones use the form editor above/i)).toBeDefined();
  });

  it('calls map.remove on unmount', () => {
    const { unmount } = render(<GeozoneMapEditor {...defaultProps} />);
    unmount();
    expect(mockMapRemove).toHaveBeenCalled();
  });
});
