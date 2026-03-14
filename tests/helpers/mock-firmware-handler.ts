/**
 * Reusable mock FirmwareHandler for protocol testing.
 * Configurable stubs for decodeFlightMode, getCapabilities, mapParameterName, etc.
 */

import { vi } from 'vitest';
import type { FirmwareHandler, FirmwareType, VehicleClass, UnifiedFlightMode, ProtocolCapabilities } from '@/lib/protocol/types';

const DEFAULT_CAPABILITIES: ProtocolCapabilities = {
  supportsParameters: true,
  supportsMission: true,
  supportsManualControl: true,
  supportsFlightModes: true,
  supportsCalibration: true,
  supportsSerialPassthrough: false,
  supportsLogDownload: true,
  supportsFence: true,
  supportsRally: true,
  supportsMotorTest: true,
  supportsVtol: false,
  supportsBetaflightOsd: false,
};

export function createMockFirmwareHandler(overrides?: Partial<FirmwareHandler>): FirmwareHandler {
  return {
    firmwareType: 'ardupilot-copter' as FirmwareType,
    vehicleClass: 'copter' as VehicleClass,
    decodeFlightMode: vi.fn((mode: number) => {
      const modes: Record<number, UnifiedFlightMode> = {
        0: 'STABILIZE', 1: 'ACRO', 2: 'ALT_HOLD', 3: 'AUTO', 4: 'GUIDED',
        5: 'LOITER', 6: 'RTL', 7: 'CIRCLE', 9: 'LAND',
      };
      return modes[mode] ?? 'UNKNOWN';
    }),
    encodeFlightMode: vi.fn((mode: UnifiedFlightMode) => ({ baseMode: 1, customMode: 0 })),
    getAvailableModes: vi.fn(() => ['STABILIZE', 'ACRO', 'ALT_HOLD', 'AUTO', 'GUIDED', 'LOITER', 'RTL'] as UnifiedFlightMode[]),
    getDefaultMode: vi.fn(() => 'STABILIZE' as UnifiedFlightMode),
    getCapabilities: vi.fn(() => DEFAULT_CAPABILITIES),
    getFirmwareVersion: vi.fn(() => 'ArduCopter 4.5.0'),
    mapParameterName: vi.fn((canonical: string) => canonical),
    reverseMapParameterName: vi.fn((firmwareName: string) => firmwareName),
    ...overrides,
  };
}
