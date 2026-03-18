import { vi } from 'vitest';

export const Viewer = vi.fn();
export const Cartesian3 = { fromDegrees: vi.fn() };
export const Color = { RED: {}, BLUE: {}, GREEN: {}, WHITE: {}, fromCssColorString: vi.fn() };
export const Entity = vi.fn();
export const ScreenSpaceEventHandler = vi.fn();
export const ScreenSpaceEventType = { LEFT_CLICK: 0 };
export const defined = vi.fn();
export const Math = { toRadians: (d: number) => d * 0.0174533 };
