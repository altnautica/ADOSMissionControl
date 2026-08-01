/**
 * Reusable mock FirmwareHandler for protocol testing.
 * Configurable stubs for decodeFlightMode, getCapabilities, mapParameterName, etc.
 */

import { vi } from 'vitest';
import type { FirmwareHandler, FirmwareType, VehicleClass, UnifiedFlightMode, ProtocolCapabilities } from '@/lib/protocol/types';

const DEFAULT_CAPABILITIES: ProtocolCapabilities = {
  supportsArming: true,
  supportsFlightModes: true,
  supportsAutonomousNav: true,
  supportsMissionUpload: true,
  supportsMissionDownload: true,
  supportsManualControl: true,
  supportsParameters: true,
  supportsCalibration: true,
  supportsSerialPassthrough: false,
  supportsMotorTest: true,
  supportsGeoFence: true,
  supportsRally: true,
  supportsLogDownload: true,
  supportsOsd: true,
  supportsDisplayPort: false,
  supportsPidTuning: true,
  supportsPorts: true,
  supportsFailsafe: true,
  supportsPowerConfig: true,
  supportsReceiver: true,
  supportsFirmwareFlash: true,
  supportsCliShell: false,
  supportsMavlinkInspector: true,
  supportsGimbal: true,
  supportsCamera: true,
  supportsLed: true,
  supportsBattery2: true,
  supportsRangefinder: true,
  supportsOpticalFlow: false,
  supportsObstacleAvoidance: false,
  supportsDebugValues: true,
  supportsCanFrame: true,
  supportsAuxModes: false,
  supportsVtx: false,
  supportsBlackbox: false,
  supportsBetaflightConfig: false,
  supportsMspMotors: false,
  supportsGpsConfig: false,
  supportsEkfConfig: false,
  supportsStreamRates: false,
  supportsVtolConfig: false,
  supportsTecsConfig: false,
  supportsSubConfig: false,
  supportsPx4Tuning: false,
  supportsRateProfiles: false,
  supportsAdjustments: false,
  supportsMavlinkSigning: false,
  supportsMultiMission: false,
  supportsSafehome: false,
  supportsGeozone: false,
  supportsLogicConditions: false,
  supportsGlobalVariables: false,
  supportsProgrammingPid: false,
  supportsEzTune: false,
  supportsFwApproach: false,
  supportsCustomOsd: false,
  supportsMixerProfile: false,
  supportsBatteryProfile: false,
  supportsTempSensors: false,
  supportsServoMixer: false,
  supportsOutputMappingExt: false,
  supportsRateDynamics: false,
  supportsMcBraking: false,
  supportsSettings: false,
  supportsCliSettings: false,
  manualControlHz: 50,
  parameterCount: 200,
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
