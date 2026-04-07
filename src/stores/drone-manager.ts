import { create } from "zustand";
import type {
  DroneProtocol,
  Transport,
  VehicleInfo,
} from "@/lib/protocol/types";
import { useTelemetryStore } from "./telemetry-store";
import { useDroneStore } from "./drone-store";
import { useFleetStore } from "./fleet-store";
import { useSettingsStore } from "./settings-store";
import { useDiagnosticsStore } from "./diagnostics-store";
import { startRecording, getRecordingState } from "@/lib/telemetry-recorder";
import { bridgeTelemetry } from "./drone-manager-bridge";
import { invalidateParamCache } from "@/components/fc/parameters/ParametersPanel";

export interface ConnectionMeta {
  type: "serial" | "websocket" | "mqtt-mavlink";
  baudRate?: number;
  url?: string;
  portVendorId?: number;
  portProductId?: number;
  presetId?: string;
}

export interface ManagedDrone {
  id: string;
  name: string;
  protocol: DroneProtocol;
  transport: Transport;
  vehicleInfo: VehicleInfo;
  unsubscribers: (() => void)[];
  connectedAt: number;
  connectionMeta?: ConnectionMeta;
  /** Why the drone was disconnected. `null` while connected. */
  _disconnectReason: "intentional" | "unexpected" | null;
}

/** Listeners for unexpected disconnect events (used by auto-reconnect). */
type DisconnectListener = (droneId: string, droneName: string, meta: ConnectionMeta | undefined) => void;
const unexpectedDisconnectListeners = new Set<DisconnectListener>();

interface DroneManagerState {
  drones: Map<string, ManagedDrone>;
  selectedDroneId: string | null;

  addDrone: (
    id: string,
    name: string,
    protocol: DroneProtocol,
    transport: Transport,
    vehicleInfo: VehicleInfo,
    connectionMeta?: ConnectionMeta,
  ) => void;
  removeDrone: (id: string) => void;
  /** Intentional disconnect — marks drone as intentional, then removes. */
  disconnectDrone: (id: string) => void;
  /**
   * Add a secondary transport as a link to an existing drone.
   * The protocol validates that the new transport reaches the same MAVLink sysid.
   * Returns success/error from the protocol.
   */
  attachLinkToDrone: (
    droneId: string,
    transport: Transport,
  ) => Promise<{ ok: true; linkId: string } | { ok: false; error: string }>;
  /** Remove a secondary link by id. If it's the last remaining link, the drone is removed. */
  detachLinkFromDrone: (droneId: string, linkId: string) => Promise<void>;
  selectDrone: (id: string | null) => void;
  getSelectedProtocol: () => DroneProtocol | null;
  getSelectedDrone: () => ManagedDrone | null;
  clear: () => void;
}

export const useDroneManager = create<DroneManagerState>((set, get) => ({
  drones: new Map(),
  selectedDroneId: null,

  addDrone: (id, name, protocol, transport, vehicleInfo, connectionMeta) => {
    const unsubscribers = bridgeTelemetry(id, protocol);

    const drone: ManagedDrone = {
      id,
      name,
      protocol,
      transport,
      vehicleInfo,
      unsubscribers,
      connectedAt: Date.now(),
      connectionMeta,
      _disconnectReason: null,
    };

    // Listen for transport close to detect unexpected disconnects
    const closeHandler = () => {
      const current = get().drones.get(id);
      if (!current || current._disconnectReason === "intentional") return;
      // Mark as unexpected and trigger listeners
      current._disconnectReason = "unexpected";
      for (const listener of unexpectedDisconnectListeners) {
        listener(id, name, connectionMeta);
      }
      // Clean up the drone from the store
      get().removeDrone(id);
    };
    transport.on("close", closeHandler as (data: void) => void);
    unsubscribers.push(() => transport.off("close", closeHandler as (data: void) => void));

    set((state) => {
      const newMap = new Map(state.drones);
      newMap.set(id, drone);
      return { drones: newMap };
    });

    useDiagnosticsStore.getState().logConnection("connect", name + " connected");

    // Insert into fleet store so the drone appears in Fleet view
    useFleetStore.getState().addDrone({
      id,
      name,
      status: "online",
      connectionState: "connected",
      flightMode: "STABILIZE",
      armState: "disarmed",
      lastHeartbeat: Date.now(),
      healthScore: 100,
      firmwareVersion: vehicleInfo.firmwareVersionString,
      frameType: vehicleInfo.vehicleClass,
    });

    // Background bulk param download — seeds paramCache for instant panel reads
    protocol.getAllParameters().catch(() => {});

    // Auto-select if this is the first drone
    if (get().drones.size === 1) {
      get().selectDrone(id);
    }

    // Auto-start recording if enabled in settings
    if (useSettingsStore.getState().autoRecordOnConnect) {
      const recState = getRecordingState();
      if (recState.state !== "recording") {
        startRecording(id, name);
      }
    }
  },

  removeDrone: (id) => {
    const drone = get().drones.get(id);
    if (drone) {
      useDiagnosticsStore.getState().logConnection("disconnect", drone.name + " disconnected");
      drone.unsubscribers.forEach((unsub) => unsub());
      if (drone.protocol.isConnected) {
        drone.protocol.disconnect();
      }
    }

    // Remove from fleet store
    useFleetStore.getState().removeDrone(id);

    set((state) => {
      const newMap = new Map(state.drones);
      newMap.delete(id);
      const selectedId =
        state.selectedDroneId === id ? null : state.selectedDroneId;
      return { drones: newMap, selectedDroneId: selectedId };
    });

    // If we just deselected, reset downstream stores
    if (get().selectedDroneId === null) {
      useDroneStore.getState().selectDrone(null);
      useDroneStore.getState().setConnectionState("disconnected");
      useTelemetryStore.getState().clear();
      invalidateParamCache();
    }
  },

  disconnectDrone: (id) => {
    const drone = get().drones.get(id);
    if (drone) {
      drone._disconnectReason = "intentional";
    }
    get().removeDrone(id);
  },

  attachLinkToDrone: async (droneId, transport) => {
    const drone = get().drones.get(droneId);
    if (!drone) {
      return { ok: false, error: "Drone not found" };
    }
    if (!drone.protocol.addLink) {
      return { ok: false, error: "This drone's protocol does not support multi-link" };
    }
    const result = await drone.protocol.addLink(transport);
    if (result.ok) {
      useDiagnosticsStore.getState().logConnection(
        "connect",
        `${drone.name} added link (${transport.type})`,
      );
      // Force a re-render of the drones map by replacing it
      set((state) => {
        const newMap = new Map(state.drones);
        return { drones: newMap };
      });
    }
    return result;
  },

  detachLinkFromDrone: async (droneId, linkId) => {
    const drone = get().drones.get(droneId);
    if (!drone || !drone.protocol.removeLink) return;
    await drone.protocol.removeLink(linkId);
    useDiagnosticsStore.getState().logConnection(
      "disconnect",
      `${drone.name} removed link ${linkId}`,
    );
    // Force a re-render
    set((state) => {
      const newMap = new Map(state.drones);
      return { drones: newMap };
    });
  },

  selectDrone: (id) => {
    set({ selectedDroneId: id });
    if (id) {
      useDroneStore.getState().selectDrone(id);
    }
  },

  getSelectedProtocol: () => {
    const { drones, selectedDroneId } = get();
    if (!selectedDroneId) return null;
    return drones.get(selectedDroneId)?.protocol ?? null;
  },

  getSelectedDrone: () => {
    const { drones, selectedDroneId } = get();
    if (!selectedDroneId) return null;
    return drones.get(selectedDroneId) ?? null;
  },

  clear: () => {
    const { drones } = get();
    drones.forEach((drone) => {
      drone._disconnectReason = "intentional";
      drone.unsubscribers.forEach((unsub) => unsub());
      if (drone.protocol.isConnected) {
        drone.protocol.disconnect();
      }
    });
    set({ drones: new Map(), selectedDroneId: null });
    useDroneStore.getState().setConnectionState("disconnected");
    useTelemetryStore.getState().clear();
  },
}));

/** Subscribe to unexpected disconnect events. Returns unsubscribe function. */
export function onUnexpectedDisconnect(listener: DisconnectListener): () => void {
  unexpectedDisconnectListeners.add(listener);
  return () => unexpectedDisconnectListeners.delete(listener);
}
