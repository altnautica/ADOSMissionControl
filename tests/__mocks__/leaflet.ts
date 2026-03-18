import { vi } from 'vitest';

export default {
  map: vi.fn(),
  tileLayer: vi.fn(),
  marker: vi.fn(),
  polyline: vi.fn(),
  polygon: vi.fn(),
  circle: vi.fn(),
  latLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
  latLngBounds: vi.fn(),
  icon: vi.fn(),
  divIcon: vi.fn(),
  DomUtil: { create: vi.fn(), remove: vi.fn() },
  DomEvent: { on: vi.fn(), off: vi.fn(), stop: vi.fn() },
  Util: { extend: vi.fn() },
};
