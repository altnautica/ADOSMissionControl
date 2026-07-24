/**
 * MockFlightEngine : Core simulation loop for demo mode.
 *
 * Writes directly to Zustand stores at configurable tick rate.
 * Components consume store data identically whether mock or real.
 *
 * Also creates a MockProtocol + MockTransport per flying drone and
 * registers them in DroneManager via addDrone(). This enables the
 * Configure tab, Flight Logs, SensorHealthBar, and all panels that
 * depend on getSelectedProtocol() returning a real protocol.
 */

import {
  DEMO_DRONES,
  DEMO_WORKSTATION,
  DEMO_GROUND_STATION,
  type DemoDroneConfig,
} from "./drones";
import { FLIGHT_PATHS, interpolatePath } from "./flight-paths";
import { generateAlert, batteryAlert } from "./alerts";
import { MockProtocol } from "./mock-protocol";
import { INavMockProtocol } from "./inav-mock-protocol";

/** A demo protocol: the MAVLink mock for most firmwares, or the dedicated iNav
 * MSP mock (name-based settings round-trip) for an iNav vehicle. */
type DemoProtocol = MockProtocol | INavMockProtocol;

function createDemoProtocol(firmware: string | undefined): DemoProtocol {
  if (firmware === "inav-plane") return new INavMockProtocol({ vehicleClass: "plane" });
  return new MockProtocol((firmware as ConstructorParameters<typeof MockProtocol>[0]) ?? "ardupilot-copter");
}
import { MockTransport } from "./mock-transport";
import { BOOT_MESSAGES } from "./status-messages";
import { emitSelectedDroneTelemetry } from "./engine-telemetry";
import { DEMO_PX4_EVENT_FRAMES } from "./px4-demo-events";
import { mockCanBus } from "./mock-can-bus";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import {
  useNodeRegistryStore,
  resolveNodeId,
} from "@/stores/node-registry";
import { haversineDistance } from "@/lib/telemetry-utils";
import { randomId } from "@/lib/utils";
import type { FleetDrone, FlightRecord } from "@/lib/types";

/** Demo node id for a config id (the canonical `node:<id>`). */
const nid = (id: string): string => resolveNodeId(id);

/**
 * A directly-connected flight controller (a USB/serial FC plugged into this
 * laptop, no companion agent behind it): it owns its own fleet row and has no
 * paired identity, so the Nodes board resolves it to the `direct-fc` reach kind
 * and it is commanded through its own live protocol. Its id is a plain string
 * (NOT `node:<id>`) so `adaptDirectFc` keeps it as the reach lookup key.
 */
const DEMO_DIRECT_FC_ID = "sierra-19-usb";
const DEMO_DIRECT_FC_NAME = "Sierra-19 (USB FC)";

interface DroneSimState {
  config: DemoDroneConfig;
  pathProgress: number;
  currentWaypointIdx: number;
  battery: number;
  tickCount: number;
  lastAlertTick: number;
  batteryAlertSent: boolean;
  protocol: DemoProtocol;
  transport: MockTransport;
  bootMessageIndex: number;
  statusMessageTick: number;
  segmentDistances: number[];
  loopStartTick: number;
  loopMaxAlt: number;
  loopMaxSpeed: number;
  loopDistance: number;
  loopBatteryStart: number;
  loopTrail: [number, number][];
  loopCount: number;
  /** Whether an iNav mock's self-driven telemetry tick is currently running.
   * The tick writes GLOBAL telemetry-store state (nav/arming/adsb), so it must
   * only run while this drone is selected — the tick loop gates it. */
  inavTicking: boolean;
}

class MockFlightEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private states: DroneSimState[] = [];
  private tickRate = 200;
  private running = false;

  constructor() {
    this.states = DEMO_DRONES.map((cfg) => {
      const path = cfg.pathIndex >= 0 ? FLIGHT_PATHS[cfg.pathIndex] : null;
      const segmentDistances: number[] = [];
      if (path && path.length >= 2) {
        for (let i = 0; i < path.length; i++) {
          const next = (i + 1) % path.length;
          segmentDistances.push(haversineDistance(path[i].lat, path[i].lon, path[next].lat, path[next].lon));
        }
      }
      const protocol = createDemoProtocol(cfg.firmware);

      return {
        config: cfg, pathProgress: 0, currentWaypointIdx: 0,
        battery: cfg.batteryStart, tickCount: 0, lastAlertTick: 0,
        batteryAlertSent: false,
        protocol,
        transport: new MockTransport(),
        bootMessageIndex: 0, statusMessageTick: 0, segmentDistances,
        loopStartTick: 0, loopMaxAlt: 0, loopMaxSpeed: 0, loopDistance: 0,
        loopBatteryStart: cfg.batteryStart, loopTrail: [], loopCount: 0,
        inavTicking: false,
      };
    });
  }

  start(intervalMs = 200): void {
    if (this.running) return;
    this.tickRate = intervalMs;
    this.running = true;

    // Seed the canonical node registry (the single fleet-identity write
    // target) instead of writing the fleet store directly — the
    // FleetProjectionBridge projects the registry into the fleet list, so a
    // direct fleet write would be clobbered. Each demo drone gets `"local"`
    // presence + an attached FC + an initial telemetry seed so it renders once
    // with its configured arm/mode/battery/position. The flying drones then
    // receive live telemetry through `bridgeTelemetry` (also into the registry).
    const registry = useNodeRegistryStore.getState();
    const now = Date.now();
    for (const cfg of DEMO_DRONES) {
      const id = nid(cfg.id);
      // An FC-only drone (`hasAgent === false`) is a direct MAVLink connection
      // with no companion agent. Seed its presence WITHOUT deviceId/cloudDeviceId
      // so the fleet projection yields `cloudDeviceId: undefined` → the node
      // console's `agentDeviceId` is null → it renders the FC-only overview (FC
      // band + "add a companion computer" CTA, no companion band). A full drone
      // carries both ids. The FC is attached and telemetry flows for both, so the
      // FC band populates identically once the drone is selected.
      const fcOnly = cfg.hasAgent === false;
      registry.upsertPresence(
        id,
        {
          ...(fcOnly ? {} : { deviceId: cfg.id, cloudDeviceId: cfg.id }),
          name: cfg.name,
          profile: "drone",
          cloudPosture: "local",
          lastHeartbeat: now,
        },
        "local",
      );
      registry.attachFc(id, id);
      registry.updateFcTelemetry(id, this.seedTelemetry(cfg, now));
    }

    // The non-flying demo nodes: a workstation (compute) node and a ground
    // station. Presence only, no attached FC — the projection then renders each
    // with its own profile (workstation / ground-station) and hides the
    // FC-gated battery/GPS telemetry. Their liveness rides the command-fleet
    // status `updatedAt` (refreshed by DemoProvider), the same path a real
    // cloud-only node uses. The profile-specific stores (compute cluster/GPU,
    // ground-station link/uplink/mesh) are seeded in DemoProvider.
    registry.upsertPresence(
      nid(DEMO_WORKSTATION.deviceId),
      {
        deviceId: DEMO_WORKSTATION.deviceId,
        name: DEMO_WORKSTATION.name,
        profile: "workstation",
        cloudPosture: "local",
        cloudDeviceId: DEMO_WORKSTATION.deviceId,
        lastHeartbeat: now,
      },
      "local",
    );
    registry.upsertPresence(
      nid(DEMO_GROUND_STATION.deviceId),
      {
        deviceId: DEMO_GROUND_STATION.deviceId,
        name: DEMO_GROUND_STATION.name,
        profile: "ground-station",
        role: DEMO_GROUND_STATION.role,
        cloudPosture: "local",
        cloudDeviceId: DEMO_GROUND_STATION.deviceId,
        lastHeartbeat: now,
      },
      "local",
    );

    const metadataStore = useDroneMetadataStore.getState();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const cfg of DEMO_DRONES) {
      // Metadata is keyed by the fleet row id (the node id), so the drone card's
      // `profiles[drone.id]` display-name lookup resolves.
      metadataStore.ensureProfile(nid(cfg.id), {
        displayName: cfg.name, serial: `ALT-${cfg.id.toUpperCase()}`,
        computeModule: "RPi CM4", weightClass: "Micro",
        totalFlights: cfg.pathIndex >= 0 ? 47 : 12,
        totalHours: cfg.pathIndex >= 0 ? 23.4 : 5.1,
        enrolledAt: thirtyDaysAgo,
      });
    }

    // Demo boots with NO drone pre-selected so the dashboard lands on the Agent
    // Overview grid (the whole fleet), not a single drone's detail panel.
    const droneManager = useDroneManager.getState();
    for (const state of this.states) {
      const cfg = state.config;
      if (cfg.pathIndex < 0) continue;
      const vehicleInfo = state.protocol.getVehicleInfo();
      // These are node:<deviceId> agent nodes, already represented by their
      // DEMO_AGENTS paired rows, so they must NOT own a fleet row (else the
      // sidebar synthesizes a second, duplicate "direct-FC" entry for each).
      droneManager.addDrone(nid(cfg.id), cfg.name, state.protocol, state.transport, vehicleInfo,
        { type: "websocket", url: "mock://demo" },
        { ownsFleetRow: false });
      // The iNav mock drives its own MSP settings + telemetry. connect() marks
      // it connected (so FC panels load) and, after a short delay, auto-starts
      // its self-tick. That tick writes GLOBAL telemetry state (nav/arming/adsb)
      // directly (not through the selection-gated bridge), so hand tick control
      // to the selection-gated tick loop below: stop the auto-started tick
      // unless this drone is the selected one.
      if (state.protocol instanceof INavMockProtocol) {
        const p = state.protocol;
        const st = state;
        void p.connect(st.transport).then(() => {
          const selected = nid(st.config.id) === useDroneStore.getState().selectedId;
          if (!selected) p.stopMockTelemetryTick();
          st.inavTicking = selected;
        });
      }
    }

    // A directly-connected flight controller: ownsFleetRow=true + no matching
    // paired row, so `mergeFleetWithDirectFcs` synthesizes a `direct-fc` fleet
    // node for it. It flies no path — it is just a live protocol the board can
    // command through its own link (the reach kind a plugged-in FC resolves to).
    const directFcProtocol = new MockProtocol("ardupilot-copter");
    droneManager.addDrone(
      DEMO_DIRECT_FC_ID,
      DEMO_DIRECT_FC_NAME,
      directFcProtocol,
      new MockTransport(),
      directFcProtocol.getVehicleInfo(),
      { type: "websocket", url: "mock://demo" },
      { ownsFleetRow: true },
    );

    // Emit Alpha-01's boot messages so its Status tab is populated when opened
    // (no drone is auto-selected — the dashboard lands on the grid).
    const selectedState = this.states.find((s) => s.config.id === "alpha-1");
    if (selectedState && selectedState.protocol instanceof MockProtocol) {
      for (const msg of BOOT_MESSAGES) {
        selectedState.protocol.emitStatusText(msg.severity, msg.text);
      }
      selectedState.bootMessageIndex = BOOT_MESSAGES.length;
    }

    this.intervalId = setInterval(() => this.tick(), this.tickRate);
  }

  /**
   * Initial FC telemetry for a demo drone, derived from its config. Used to
   * seed the registry so each drone renders with its configured
   * arm/mode/battery/position before the live tick loop takes over.
   */
  private seedTelemetry(cfg: DemoDroneConfig, now: number): Parameters<
    ReturnType<typeof useNodeRegistryStore.getState>["updateFcTelemetry"]
  >[1] {
    const flying = cfg.pathIndex >= 0;
    const armed = cfg.status === "in_mission";
    const alt = flying ? 50 : 0;
    return {
      status: cfg.status,
      flightMode: cfg.flightMode,
      armState: armed ? "armed" : "disarmed",
      healthScore: cfg.healthScore,
      lastHeartbeat: now,
      position: {
        timestamp: now,
        lat: cfg.homeLat,
        lon: cfg.homeLon,
        alt,
        relativeAlt: alt,
        heading: 0,
        groundSpeed: 0,
        airSpeed: 0,
        climbRate: 0,
      },
      battery: {
        timestamp: now,
        voltage: 22.2 * (cfg.batteryStart / 100),
        current: armed ? 12.5 : 0,
        remaining: cfg.batteryStart,
        consumed: (100 - cfg.batteryStart) * 22,
      },
      gps: {
        timestamp: now,
        fixType: cfg.status === "maintenance" ? 0 : 3,
        satellites: cfg.status === "maintenance" ? 0 : 17,
        hdop: 1.0,
        lat: cfg.homeLat,
        lon: cfg.homeLon,
        alt: 10,
      },
    };
  }

  stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    // The iNav mock owns a self-driven telemetry interval — tear it down too.
    for (const state of this.states) {
      if (state.protocol instanceof INavMockProtocol) {
        state.protocol.stopMockTelemetryTick();
        state.inavTicking = false;
      }
    }
    this.running = false;
  }

  tick(): void {
    const registry = useNodeRegistryStore.getState();
    // The fleet store still owns alerts (registry holds only identity + FC
    // telemetry); keep a reference for addAlert / touch.
    const fleetStore = useFleetStore.getState();
    const selectedId = useDroneStore.getState().selectedId;
    const now = Date.now();

    for (const state of this.states) {
      state.tickCount++;
      const cfg = state.config;

      // Selection-gate the iNav mock's self-tick: it writes GLOBAL telemetry
      // state (nav/arming/adsb), so it may only run while selected, or it would
      // clobber the selected drone's telemetry.
      if (state.protocol instanceof INavMockProtocol && state.protocol.isConnected) {
        const sel = nid(cfg.id) === selectedId;
        if (sel && !state.inavTicking) {
          state.protocol.startMockTelemetryTick();
          state.inavTicking = true;
        } else if (!sel && state.inavTicking) {
          state.protocol.stopMockTelemetryTick();
          state.inavTicking = false;
        }
      }

      if (cfg.pathIndex < 0) continue;

      const path = FLIGHT_PATHS[cfg.pathIndex];
      if (!path || path.length < 2) continue;

      const wp = path[state.currentWaypointIdx];
      const nextIdx = (state.currentWaypointIdx + 1) % path.length;
      const nextWp = path[nextIdx];

      const segmentDist = state.segmentDistances[state.currentWaypointIdx] ?? 0;
      const stepDist = (wp.speed * this.tickRate) / 1000;
      const progressStep = segmentDist > 0 ? stepDist / segmentDist : 0.01;
      state.pathProgress += progressStep;

      if (state.pathProgress >= 1) {
        state.pathProgress = 0;

        if (nextIdx === 0 && state.currentWaypointIdx > 0) {
          state.loopCount++;
          if (state.loopCount >= 2) {
            const duration = Math.round((state.tickCount - state.loopStartTick) * this.tickRate / 1000);
            const now = Date.now();
            const record: FlightRecord = {
              id: randomId(), droneId: cfg.id, droneName: cfg.name,
              date: now,
              startTime: now - duration * 1000,
              endTime: now,
              duration,
              distance: Math.round(state.loopDistance),
              maxAlt: Math.round(state.loopMaxAlt),
              maxSpeed: Math.round(state.loopMaxSpeed * 10) / 10,
              batteryUsed: Math.round(state.loopBatteryStart - state.battery),
              waypointCount: path.length, status: "completed",
              path: state.loopTrail.length > 0 ? [...state.loopTrail] : undefined,
              updatedAt: now,
            };
            // In demo mode the curated seed in mock/history.ts is the source
            // of truth for the History tab. Skip live engine records here to
            // avoid stuck IN_PROGRESS / 0-duration stubs piling up in IDB.
            void record;
          }
          state.loopStartTick = state.tickCount;
          state.loopMaxAlt = 0; state.loopMaxSpeed = 0; state.loopDistance = 0;
          state.loopBatteryStart = state.battery; state.loopTrail = [];
        }

        state.loopDistance += state.segmentDistances[state.currentWaypointIdx] ?? 0;
        state.currentWaypointIdx = nextIdx;
      }

      const pos = interpolatePath(wp, nextWp, state.pathProgress);

      if (pos.alt > state.loopMaxAlt) state.loopMaxAlt = pos.alt;
      if (wp.speed > state.loopMaxSpeed) state.loopMaxSpeed = wp.speed;
      if (state.tickCount % 10 === 0) { state.loopTrail.push([pos.lat, pos.lon]); }

      const jitterLat = (Math.random() - 0.5) * 0.00002;
      const jitterLon = (Math.random() - 0.5) * 0.00002;
      state.battery = Math.max(5, state.battery - (0.044 * this.tickRate) / 1000);

      const prevHeading =
        registry.getEntry(nid(cfg.id))?.fc.position?.heading ?? pos.heading;
      const headingDelta = pos.heading - prevHeading;
      const roll = Math.max(-30, Math.min(30, headingDelta * 0.5));
      const pitch = (nextWp.alt - wp.alt) > 0 ? -5 : (nextWp.alt - wp.alt) < 0 ? 5 : -2;

      const droneUpdate: Partial<FleetDrone> = {
        lastHeartbeat: now,
        position: {
          timestamp: now, lat: pos.lat + jitterLat, lon: pos.lon + jitterLon,
          alt: pos.alt, relativeAlt: pos.alt, heading: pos.heading,
          groundSpeed: wp.speed, airSpeed: wp.speed * 1.05,
          climbRate: (nextWp.alt - wp.alt) * progressStep,
        },
        battery: (() => {
          const cellBase = (22.2 * (state.battery / 100)) / 6;
          return {
            timestamp: now, voltage: 22.2 * (state.battery / 100),
            current: 10 + Math.random() * 5, remaining: state.battery,
            consumed: (100 - state.battery) * 22, temperature: 32 + Math.random() * 8,
            cellVoltages: Array.from({ length: 6 }, (_, i) =>
              cellBase + (i === 2 ? 0.04 : 0) + (Math.random() - 0.5) * 0.02),
          };
        })(),
        gps: {
          timestamp: now, fixType: 3,
          satellites: 14 + Math.floor(Math.random() * 6),
          hdop: 0.8 + Math.random() * 0.4,
          lat: pos.lat + jitterLat, lon: pos.lon + jitterLon, alt: 920 + pos.alt,
        },
      };
      // Mirror the simulated flight into the registry FC sub-state (the single
      // fleet write target); FleetProjectionBridge turns it into the live row.
      registry.updateFcTelemetry(nid(cfg.id), {
        lastHeartbeat: droneUpdate.lastHeartbeat,
        position: droneUpdate.position,
        battery: droneUpdate.battery,
        gps: droneUpdate.gps,
      });

      if (nid(cfg.id) === selectedId && state.protocol instanceof MockProtocol) {
        // DroneCAN bus simulation : feeds CAN_FRAME events into the
        // selected drone's protocol so the CAN Monitor panel lights up.
        mockCanBus.tick(state.protocol, now);

        const modePhase = Math.floor(state.tickCount / 25) % 6;
        const modePwmTable = [1000, 1295, 1425, 1555, 1685, 1875];
        const ch5Pwm = modePwmTable[modePhase];
        const stickJitter = () => Math.round((Math.random() - 0.5) * 40);
        const rcChannels = [
          1500 + stickJitter(), 1538 + stickJitter(),
          1500 + stickJitter(), 1500 + stickJitter(),
          ch5Pwm, 1000, 1000, 1000,
          1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500,
        ];

        state.statusMessageTick = emitSelectedDroneTelemetry({
          tickCount: state.tickCount, protocol: state.protocol,
          droneUpdate, pos, roll, pitch, headingDelta, battery: state.battery,
          pathIndex: cfg.pathIndex, currentWaypointIdx: state.currentWaypointIdx,
          pathProgress: state.pathProgress, segmentDistances: state.segmentDistances,
          status: cfg.status, flightMode: cfg.flightMode,
          statusMessageTick: state.statusMessageTick, rcChannels,
        });

        // PX4 structured events (msg 410) — cycle a few demo events so the
        // Logs → Events feed renders decoded text in demo mode.
        if (state.protocol.getVehicleInfo().firmwareType === "px4" && state.tickCount % 40 === 5) {
          const idx = Math.floor(state.tickCount / 40) % DEMO_PX4_EVENT_FRAMES.length;
          state.protocol.emitEvent(DEMO_PX4_EVENT_FRAMES[idx]);
        }
      }

      if (state.battery <= 30 && !state.batteryAlertSent) {
        fleetStore.addAlert(batteryAlert(cfg.id, cfg.name, state.battery));
        state.batteryAlertSent = true;
      }

      if (state.tickCount - state.lastAlertTick > 300 && Math.random() < 0.02) {
        fleetStore.addAlert(generateAlert(cfg.id, cfg.name));
        state.lastAlertTick = state.tickCount;
      }
    }

    fleetStore.touch();
  }

  isRunning(): boolean {
    return this.running;
  }
}

/** Singleton mock engine instance. */
export const mockEngine = new MockFlightEngine();
