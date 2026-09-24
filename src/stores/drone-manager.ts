import { create } from "zustand";
import type {
  DroneProtocol,
  Transport,
  VehicleInfo,
} from "@/lib/protocol/types";
import type { ConnectionMeta } from "@/lib/connection-meta";
import { useTelemetryStore } from "./telemetry-store";
import { useDroneStore } from "./drone-store";
import { useSettingsStore } from "./settings-store";
import { useVideoStore } from "./video-store";
import { useVideoStreamsStore } from "./video-streams-store";
import { useAgentCapabilitiesStore } from "./agent-capabilities-store";
import { useTrailStore } from "./trail-store";
import { usePrearmBufferStore } from "./prearm-buffer-store";
import { useGroundStationStore } from "./ground-station-store";
import { useGeofenceStore } from "./geofence-store";
import { useDiagnosticsStore } from "./diagnostics-store";
import { usePanelCacheStore } from "./panel-cache-store";
import { useUploadReceiptsStore } from "./upload-receipts-store";
import { useMissionStore } from "./mission-store";
import { useChecklistStore } from "./checklist-store";
import {
  startRecordingFor,
  stopRecordingFor,
  isRecordingFor,
} from "@/lib/telemetry-recorder";
import { bridgeTelemetry } from "./drone-manager-bridge";
import { bindSigning } from "@/lib/protocol/signing-binding";
import { useNodeRegistryStore } from "./node-registry";
import { invalidateParamList } from "./param-list-cache";
import { bindInavConfigStores, forgetInavConfigStores } from "./inav-config-binding";
import { bindDroneSelection } from "./drone-selection";

export interface ManagedDrone {
  id: string;
  name: string;
  protocol: DroneProtocol;
  transport: Transport;
  vehicleInfo: VehicleInfo;
  unsubscribers: (() => void)[];
  connectedAt: number;
  connectionMeta?: ConnectionMeta;
  /**
   * Whether this managed drone owns its Fleet-view row. A direct connection
   * (USB serial, or a standalone agent with no device identity) owns the row
   * and removes it on disconnect. An FC attached through an already-paired
   * agent does NOT own the row — the presence bridge (Local/Cloud) owns it —
   * so detaching the FC leaves the card in place, reverting to "flight
   * controller not connected" instead of vanishing. Either way the session
   * attaches its FC to the registry row on add and detaches it on remove.
   */
  ownsFleetRow: boolean;
  /** Why the drone was disconnected. `null` while connected. */
  _disconnectReason: "intentional" | "unexpected" | null;
}

/** Listeners for unexpected disconnect events (used by auto-reconnect). */
type DisconnectListener = (droneId: string, droneName: string, meta: ConnectionMeta | undefined) => void;
const unexpectedDisconnectListeners = new Set<DisconnectListener>();

export interface DroneManagerState {
  drones: Map<string, ManagedDrone>;
  selectedDroneId: string | null;

  addDrone: (
    id: string,
    name: string,
    protocol: DroneProtocol,
    transport: Transport,
    vehicleInfo: VehicleInfo,
    connectionMeta?: ConnectionMeta,
    /** `ownsFleetRow`: the session creates its own registry row (a direct
     * FC). `autoSelect` (default true): select the drone when it is the only
     * managed session; a background bridge passes false so a session it opens
     * never moves the operator's selection. */
    options?: { ownsFleetRow?: boolean; autoSelect?: boolean },
  ) => void;
  removeDrone: (id: string) => void;
  /** Intentional disconnect — marks drone as intentional, then removes. */
  disconnectDrone: (id: string) => void;
  /**
   * Swap the transport associated with a ManagedDrone in place. Used by the
   * SLCAN flash arbiter to survive a tear-down and re-open of the same USB
   * port without triggering the unexpected-disconnect path. The caller is
   * responsible for opening the new transport first and re-attaching it to
   * the protocol; this action only re-binds the close handler and refreshes
   * the stored transport reference. If the drone no longer exists in the
   * store (already removed by an earlier close handler) this is a no-op.
   */
  swapTransport: (id: string, nextTransport: Transport) => void;
  /**
   * Mark a drone's next transport close as intentional. The SLCAN arbiter
   * sets this before calling `protocol.disconnect()` so the close handler
   * does not fire the unexpected-disconnect cleanup path.
   */
  markIntentionalDisconnect: (id: string) => void;
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

  addDrone: (id, name, protocol, transport, vehicleInfo, connectionMeta, options) => {
    // Idempotency guard: a re-add under an existing id replaces the prior
    // entry rather than stacking a second managed drone. removeDrone detaches
    // the FC (a presence-anchored card survives, and is re-attached below) and
    // self-guards against re-entry, so this never double-tears-down.
    if (get().drones.get(id)) {
      get().removeDrone(id);
    }

    const ownsFleetRow = options?.ownsFleetRow ?? true;

    // Every managed session is keyed by its node id, so the drone manager is
    // the one place that attaches the FC to the node registry and binds the
    // connection; no bridge has to remember to. A session that owns its row
    // (a direct USB/serial/BLE FC) creates the row here; a session behind a
    // paired or relayed agent attaches onto the presence row. Attach BEFORE
    // bridgeTelemetry so the row exists when the first telemetry mirror
    // (updateFcTelemetry, which no-ops on a missing row) lands.
    const registry = useNodeRegistryStore.getState();
    registry.attachFc(id, id);
    const metaType = connectionMeta?.type;
    registry.updateConnection(id, {
      ...(metaType === "websocket" || metaType === "mqtt-mavlink"
        ? { transport: metaType, mavlinkUrl: connectionMeta?.url }
        : {}),
      fcConnected: true,
      // Recorded from the transport rather than assumed from the fact that a
      // connection was established: on the relay the FC can be attached and
      // talking while the send lane is refused.
      canCommand: transport.canCommand,
    });

    const unsubscribers = bridgeTelemetry(id, name, protocol);
    // Outbound frames carry the drone's signature whenever a key is stored.
    unsubscribers.push(bindSigning(id, protocol));

    // Stamp the vehicle the link answered as, so a reconnect can tell the same
    // aircraft from another one that happens to answer on the re-dialled link.
    const meta: ConnectionMeta | undefined = connectionMeta && {
      ...connectionMeta,
      vehicle: {
        systemId: vehicleInfo.systemId,
        firmwareType: vehicleInfo.firmwareType,
        vehicleType: vehicleInfo.vehicleType,
        boardId: vehicleInfo.boardId,
      },
    };

    const drone: ManagedDrone = {
      id,
      name,
      protocol,
      transport,
      vehicleInfo,
      unsubscribers,
      connectedAt: Date.now(),
      connectionMeta: meta,
      ownsFleetRow,
      _disconnectReason: null,
    };

    // Listen for transport close to detect unexpected disconnects
    const closeHandler = () => {
      const current = get().drones.get(id);
      if (!current || current._disconnectReason === "intentional") return;
      // Mark as unexpected and trigger listeners
      current._disconnectReason = "unexpected";
      for (const listener of unexpectedDisconnectListeners) {
        listener(id, name, meta);
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

    // The node registry is the single fleet-identity write target;
    // FleetProjectionBridge projects it into the fleet store. The FC was
    // attached to the registry above; no bare fleet-store row is written here —
    // that was the source of the FC bare-row race that locked the agent tabs.

    // Background bulk param download — seeds paramCache for instant panel reads
    protocol.getAllParameters().catch(() => {});

    // Auto-select if this is the first drone, unless a background session
    // opted out: the selection is the operator's, not the bridge's.
    if ((options?.autoSelect ?? true) && get().drones.size === 1) {
      get().selectDrone(id);
    }

    // Auto-start recording if enabled in settings. Use the per-drone slot so
    // captured frames (written via recordFrameFor(id, ...)) land in the same
    // slot the stop call later reads from.
    if (useSettingsStore.getState().autoRecordOnConnect && !isRecordingFor(id)) {
      startRecordingFor(id, name);
    }
  },

  removeDrone: (id) => {
    const drone = get().drones.get(id);
    if (drone) {
      useDiagnosticsStore.getState().logConnection("disconnect", drone.name + " disconnected");
      // Disconnect the transport BEFORE tearing down the close-handler
      // subscription. A transport that closes synchronously inside
      // disconnect() must still be observed by the close handler; running
      // the unsubscribers first would remove that handler and swallow the
      // close. If the close handler fires here and recursively removes this
      // drone, the entry is already gone by the time we resume — bail out so
      // the teardown below does not run twice.
      if (drone.protocol.isConnected) {
        drone.protocol.disconnect();
      }
      if (!get().drones.has(id)) return;
      drone.unsubscribers.forEach((unsub) => unsub());
    }

    // Persist any per-drone recording that was running for this drone so the
    // captured frames are saved rather than orphaned in the recorder slot.
    if (isRecordingFor(id)) {
      stopRecordingFor(id).catch(() => {});
    }

    // Detach the FC from the node registry for every session. A row with no
    // presence anchor (a direct USB/serial/BLE FC) is then GC'd and its fleet
    // card disappears; a presence-anchored row stays and reverts to "flight
    // controller not connected". detachFc and updateConnection guard a missing
    // row, so this is safe if the registry row is already gone.
    const registry = useNodeRegistryStore.getState();
    registry.updateConnection(id, { fcConnected: false });
    registry.detachFc(id);

    // The singleton telemetry ring only ever holds the SELECTED drone's
    // history (the bridge gates pushes on selection), so only wipe it when
    // the drone being removed is the selected one — removing a background
    // drone must not blow away the drone the operator is watching. The trail
    // and the latched fence breach are the same single-slot state under the
    // same gate: left behind, the map keeps a track with no vehicle on it and
    // the breach alarm stays lit for an aircraft the GCS no longer hears.
    // FC params are per-drone, so always clear the removed drone's slot.
    if (get().selectedDroneId === id) {
      useTelemetryStore.getState().clear();
      useTrailStore.getState().clear();
      useGeofenceStore.getState().clearBreachState();
    }
    usePanelCacheStore.getState().clearForDrone(id);

    // The selection is a UI id (the node the operator has open), not a session
    // id. While the node is still in the fleet (a presence-anchored row that
    // outlives its FC session) the selection stays, so a background teardown
    // never closes the operator's open panel. A node that left the fleet with
    // its session (a direct FC) is deselected.
    const stillFleetNode = useNodeRegistryStore.getState().getEntry(id) !== undefined;
    set((state) => {
      const newMap = new Map(state.drones);
      newMap.delete(id);
      const selectedId =
        state.selectedDroneId === id && !stillFleetNode ? null : state.selectedDroneId;
      return { drones: newMap, selectedDroneId: selectedId };
    });

    // If the selected node has no session any more, reset the downstream
    // single-slot flight state.
    const selected = get().selectedDroneId;
    if (selected === null || selected === id) {
      useDroneStore.getState().setConnectionState("disconnected");
      // The heartbeat age is a claim about the selected link; with no session
      // on the selected node there is no link to call stale.
      useDroneStore.setState({ lastHeartbeat: 0 });
    }
    // Its downloaded parameter list described the link that just went away.
    invalidateParamList(id);
    // The removed drone's prearm STATUSTEXT buffer is keyed by droneId and only
    // otherwise drains on arm, so a drone that connects and leaves without
    // arming would pin its lines for the session.
    usePrearmBufferStore.getState().clearForDrone(id);
    // After a disconnect the GCS no longer knows what the FC holds (another
    // GCS or a reflash may change it before the next link), so it stops
    // vouching for any mission, fence or rally upload to this drone.
    useUploadReceiptsStore.getState().clearForDrone(id);
    // Its iNav mixer, geozone, safehome and programming tables go with it.
    forgetInavConfigStores(id);
  },

  disconnectDrone: (id) => {
    const drone = get().drones.get(id);
    if (drone) {
      drone._disconnectReason = "intentional";
    }
    get().removeDrone(id);
  },

  markIntentionalDisconnect: (id) => {
    const drone = get().drones.get(id);
    if (drone) {
      drone._disconnectReason = "intentional";
    }
  },

  swapTransport: (id, nextTransport) => {
    const drone = get().drones.get(id);
    if (!drone) return;
    // Re-arm the close handler on the new transport. The original handler
    // was installed in addDrone() against the old transport, which is now
    // closed and gone; install an equivalent one here so an unexpected
    // close on the new transport still fires the auto-reconnect path.
    const closeHandler = () => {
      const current = get().drones.get(id);
      if (!current || current._disconnectReason === "intentional") return;
      current._disconnectReason = "unexpected";
      for (const listener of unexpectedDisconnectListeners) {
        listener(id, drone.name, drone.connectionMeta);
      }
      get().removeDrone(id);
    };
    nextTransport.on("close", closeHandler as (data: void) => void);
    drone.unsubscribers.push(() =>
      nextTransport.off("close", closeHandler as (data: void) => void),
    );
    drone.transport = nextTransport;
    drone._disconnectReason = null;
    // Force a re-render of consumers reading from the drones map.
    set((state) => {
      const newMap = new Map(state.drones);
      return { drones: newMap };
    });
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
    const previousId = get().selectedDroneId;
    set({ selectedDroneId: id });

    // Switching to a different drone: clear cross-drone singleton state so the
    // newly selected drone never shows the previous one's data before its first
    // frame arrives. The telemetry buffers, the flight-state fields, and the
    // previous drone's cached FC params are all single-slot and would otherwise
    // bleed across the selection.
    if (id !== previousId) {
      useTelemetryStore.getState().clear();
      // The trail ring is the same shape of single-slot global state as the
      // telemetry rings and the bridge writes it under the same selection
      // gate, so it has to be cleared on the same transition — otherwise the
      // newly selected drone inherits the previous one's track and its "home"
      // fix.
      useTrailStore.getState().clear();
      // The checklist session is per drone, so the leaving drone's ticks and
      // verdicts must not read as the new drone's readiness. (Sensor health
      // derives from the SYS_STATUS ring cleared above.)
      useChecklistStore.getState().resetSession();
      // Nothing has been measured for the drone just selected: its arm state
      // and mode read unknown and the previous drone's heartbeat must not age
      // into a LINK STALE (or back a live mode/arm reading) for it.
      useDroneStore.getState().resetForSelection();
      // FENCE_STATUS is a latched single slot: the FC stops sending it once a
      // breach clears, so nothing else ever lowers the alarm. Without this,
      // a breach raised on the previous drone kept the breach alerts
      // (`CornerAlerts`) lit over the newly selected aircraft.
      useGeofenceStore.getState().clearBreachState();
      // Mission progress is the previous drone's MISSION_CURRENT; the new
      // selection's arrives with its own next frame.
      useMissionStore.setState({ currentWaypoint: null, progress: 0 });
      if (previousId) {
        usePanelCacheStore.getState().clearForDrone(previousId);
      }
      // Reset the GLOBAL single-value stores that otherwise bleed the previous
      // drone's data onto the newly selected one before its first frame: the
      // video pipeline (stream URL + agent video status + poll/latency scratch),
      // the per-agent capabilities (gate the radio/vision tabs + video feed),
      // and the ground-station snapshot.
      useVideoStore.getState().clearForSelection();
      useAgentCapabilitiesStore.getState().clear();
      useGroundStationStore.getState().resetAll();
      // The per-drone stream switcher state (active leg / PiP) is keyed by drone
      // id, but the global video-store override it drives was just cleared by
      // clearForSelection(). Drop the leaving drone's switcher state too, so a
      // return re-populates fresh at its primary leg instead of showing a stale
      // leg as active while the video falls back to the default URL.
      if (previousId) {
        useVideoStreamsStore.getState().clearForDevice(previousId);
      }
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
    const registry = useNodeRegistryStore.getState();
    drones.forEach((drone) => {
      drone._disconnectReason = "intentional";
      drone.unsubscribers.forEach((unsub) => unsub());
      if (drone.protocol.isConnected) {
        drone.protocol.disconnect();
      }
      // Same registry contract as removeDrone: no session, no attached FC.
      registry.updateConnection(drone.id, { fcConnected: false });
      registry.detachFc(drone.id);
      useUploadReceiptsStore.getState().clearForDrone(drone.id);
      forgetInavConfigStores(drone.id);
    });
    invalidateParamList();
    set({ drones: new Map(), selectedDroneId: null });
    useDroneStore.getState().resetForSelection();
    useTelemetryStore.getState().clear();
    // Same single-slot global state as the telemetry rings; clearing one
    // without the other leaves a track on the map with no vehicle behind it.
    useTrailStore.getState().clear();
    usePrearmBufferStore.getState().clearAll();
    useChecklistStore.getState().resetSession();
    // Latched breach state: nothing else lowers it once the FC stops sending
    // FENCE_STATUS, so a teardown that leaves it set keeps the alarm lit with
    // no vehicle behind it.
    useGeofenceStore.getState().clearBreachState();
  },
}));

bindDroneSelection(() => useDroneManager.getState());

/**
 * The selected node's managed FC session, or null. Use as a selector:
 * `getSelectedDrone` is a stable action, so selecting it subscribes to nothing
 * and a component built on it never re-renders on a drone switch, connect or
 * disconnect. The entry this returns changes identity on each of those.
 */
export function selectSelectedDrone(s: DroneManagerState): ManagedDrone | null {
  return s.selectedDroneId ? s.drones.get(s.selectedDroneId) ?? null : null;
}

/** The selected node's protocol, or null. Reactive, like {@link selectSelectedDrone}. */
export function selectSelectedProtocol(s: DroneManagerState): DroneProtocol | null {
  return selectSelectedDrone(s)?.protocol ?? null;
}

/** Subscribe to unexpected disconnect events. Returns unsubscribe function. */
export function onUnexpectedDisconnect(listener: DisconnectListener): () => void {
  unexpectedDisconnectListeners.add(listener);
  return () => unexpectedDisconnectListeners.delete(listener);
}

// The iNav config stores always show the selected drone's tables, whichever
// path changes the selection.
useDroneManager.subscribe((state, prev) => {
  if (state.selectedDroneId !== prev.selectedDroneId) bindInavConfigStores(state.selectedDroneId);
});
