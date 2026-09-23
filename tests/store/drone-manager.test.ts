import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDroneManager } from '@/stores/drone-manager';
import { useNodeRegistryStore } from '@/stores/node-registry';
import type { DroneProtocol, Transport, VehicleInfo } from '@/lib/protocol/types';

// Mock the bridge and dependent stores to isolate drone-manager
vi.mock('@/stores/drone-manager-bridge', () => ({
  bridgeTelemetry: vi.fn(() => []),
}));
vi.mock('@/stores/telemetry-store', () => ({
  useTelemetryStore: {
    getState: () => ({ clear: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock('@/stores/drone-store', () => ({
  useDroneStore: {
    getState: () => ({
      selectDrone: vi.fn(),
      setConnectionState: vi.fn(),
      setFlightMode: vi.fn(),
      setArmState: vi.fn(),
      setSystemStatus: vi.fn(),
      setFirmwareType: vi.fn(),
      resetForSelection: vi.fn(),
    }),
    setState: vi.fn(),
  },
}));
vi.mock('@/stores/fleet-store', () => ({
  useFleetStore: {
    getState: () => ({ addDrone: vi.fn(), removeDrone: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({ autoRecordOnConnect: false }),
    setState: vi.fn(),
  },
}));
vi.mock('@/stores/diagnostics-store', () => ({
  useDiagnosticsStore: {
    getState: () => ({ logConnection: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock('@/lib/telemetry-recorder', () => ({
  startRecording: vi.fn(),
  getRecordingState: vi.fn(() => ({ state: 'idle' })),
  isRecordingFor: vi.fn(() => false),
  stopRecordingFor: vi.fn(() => Promise.resolve()),
}));

function makeMockProtocol(): DroneProtocol {
  return {
    isConnected: true,
    disconnect: vi.fn(),
    getAllParameters: vi.fn().mockResolvedValue([]),
  } as unknown as DroneProtocol;
}

function makeMockTransport(): Transport {
  const listeners = new Map<string, Set<Function>>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),
    write: vi.fn(),
    close: vi.fn(),
  } as unknown as Transport;
}

function makeMockVehicleInfo(): VehicleInfo {
  return {
    systemId: 1,
    componentId: 1,
    autopilot: 3,
    vehicleType: 2,
    vehicleClass: 'copter',
    firmwareType: 'ardupilot',
    firmwareVersionString: '4.5.0',
  } as unknown as VehicleInfo;
}

describe('drone-manager', () => {
  beforeEach(() => {
    useDroneManager.setState({
      drones: new Map(),
      selectedDroneId: null,
    });
  });

  it('initial state has no drones and no selection', () => {
    const state = useDroneManager.getState();
    expect(state.drones.size).toBe(0);
    expect(state.selectedDroneId).toBeNull();
  });

  it('addDrone() adds a drone entry and auto-selects first drone', () => {
    const protocol = makeMockProtocol();
    const transport = makeMockTransport();
    const vehicleInfo = makeMockVehicleInfo();

    useDroneManager.getState().addDrone('drone-1', 'Test Drone', protocol, transport, vehicleInfo);

    const state = useDroneManager.getState();
    expect(state.drones.size).toBe(1);
    expect(state.drones.has('drone-1')).toBe(true);
    expect(state.drones.get('drone-1')?.name).toBe('Test Drone');
    // First drone is auto-selected
    expect(state.selectedDroneId).toBe('drone-1');
  });

  it('removeDrone() removes by ID', () => {
    const protocol = makeMockProtocol();
    const transport = makeMockTransport();
    const vehicleInfo = makeMockVehicleInfo();

    useDroneManager.getState().addDrone('drone-1', 'Drone A', protocol, transport, vehicleInfo);
    expect(useDroneManager.getState().drones.size).toBe(1);

    useDroneManager.getState().removeDrone('drone-1');
    expect(useDroneManager.getState().drones.size).toBe(0);
  });

  it('selectDrone() sets the selected drone ID', () => {
    useDroneManager.setState({ selectedDroneId: null });

    useDroneManager.getState().selectDrone('drone-2');
    expect(useDroneManager.getState().selectedDroneId).toBe('drone-2');

    useDroneManager.getState().selectDrone(null);
    expect(useDroneManager.getState().selectedDroneId).toBeNull();
  });

  it('getSelectedProtocol returns protocol for selected drone', () => {
    const protocol = makeMockProtocol();
    const transport = makeMockTransport();
    const vehicleInfo = makeMockVehicleInfo();

    // No selection
    expect(useDroneManager.getState().getSelectedProtocol()).toBeNull();

    useDroneManager.getState().addDrone('drone-1', 'Test', protocol, transport, vehicleInfo);
    // Auto-selected
    expect(useDroneManager.getState().getSelectedProtocol()).toBe(protocol);
  });

  it('multiple drones can be managed', () => {
    const transport1 = makeMockTransport();
    const transport2 = makeMockTransport();
    const protocol1 = makeMockProtocol();
    const protocol2 = makeMockProtocol();
    const vehicleInfo = makeMockVehicleInfo();

    useDroneManager.getState().addDrone('drone-1', 'Alpha', protocol1, transport1, vehicleInfo);
    useDroneManager.getState().addDrone('drone-2', 'Bravo', protocol2, transport2, vehicleInfo);

    const state = useDroneManager.getState();
    expect(state.drones.size).toBe(2);
    expect(state.drones.get('drone-1')?.name).toBe('Alpha');
    expect(state.drones.get('drone-2')?.name).toBe('Bravo');
  });

  it('removeDrone() clears selection when selected drone is removed', () => {
    const protocol = makeMockProtocol();
    const transport = makeMockTransport();
    const vehicleInfo = makeMockVehicleInfo();

    useDroneManager.getState().addDrone('drone-1', 'Solo', protocol, transport, vehicleInfo);
    expect(useDroneManager.getState().selectedDroneId).toBe('drone-1');

    useDroneManager.getState().removeDrone('drone-1');
    expect(useDroneManager.getState().selectedDroneId).toBeNull();
  });

  it('getSelectedDrone returns the managed drone object', () => {
    const protocol = makeMockProtocol();
    const transport = makeMockTransport();
    const vehicleInfo = makeMockVehicleInfo();

    expect(useDroneManager.getState().getSelectedDrone()).toBeNull();

    useDroneManager.getState().addDrone('drone-1', 'Test', protocol, transport, vehicleInfo);
    const drone = useDroneManager.getState().getSelectedDrone();
    expect(drone).not.toBeNull();
    expect(drone?.id).toBe('drone-1');
    expect(drone?.name).toBe('Test');
  });

  it('a background session added with autoSelect false never takes the selection', () => {
    useDroneManager
      .getState()
      .addDrone('node:relayed', 'Relayed', makeMockProtocol(), makeMockTransport(), makeMockVehicleInfo(), undefined, {
        ownsFleetRow: false,
        autoSelect: false,
      });
    expect(useDroneManager.getState().drones.has('node:relayed')).toBe(true);
    expect(useDroneManager.getState().selectedDroneId).toBeNull();
  });

  it('removing the session of a node still in the fleet keeps the operator selection', () => {
    const id = 'node:keep-selected';
    useNodeRegistryStore.getState().upsertPresence(id, { deviceId: 'keep-selected', name: 'n' }, 'relayed');
    useDroneManager
      .getState()
      .addDrone(id, 'Kept', makeMockProtocol(), makeMockTransport(), makeMockVehicleInfo(), undefined, {
        ownsFleetRow: false,
      });
    expect(useDroneManager.getState().selectedDroneId).toBe(id);

    useDroneManager.getState().removeDrone(id);
    expect(useDroneManager.getState().drones.has(id)).toBe(false);
    expect(useDroneManager.getState().selectedDroneId).toBe(id);
    useNodeRegistryStore.getState().clear();
  });
});
