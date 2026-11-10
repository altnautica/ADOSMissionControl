/**
 * MockFlightEngine : Core simulation loop for demo mode.
 *
 * Writes directly to Zustand stores at configurable tick rate.
 * Components consume store data identically whether mock or real.
 *
 * Also creates a MockProtocol + MockTransport per flying drone and
 * registers them in DroneManager via addDrone(). This enables the
 * Configure tab, Flight Logs, sensor health, and all panels that
 * depend on getSelectedProtocol() returning a real protocol.
 */

import { DEMO_DRONES, type DemoDroneConfig } from "./drones";
import { FLIGHT_PATHS, interpolatePath } from "./flight-paths";
import { generateAlert } from "./alerts";
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
import { tickGroundedDrone } from "./engine-grounded";
import { seedDemoNodes } from "./engine-seed";
import { DemoMissionLoader, holdsHomeSlot, missionSeqForTarget, pathMissionItems } from "./engine-mission";
import { RETURN_SPEED_MPS, demoFlightPhase, stepHome, type DemoFix } from "./engine-modes";
import { setDemoNavStreamBlocked, setDemoTelemetryFrozen } from "./demo-link";
import { DEMO_PX4_EVENT_FRAMES } from "./px4-demo-events";
import { mockCanBus } from "./mock-can-bus";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore, resolveNodeId } from "@/stores/node-registry";
import { clearDemoVehicles, markDemoVehicles } from "@/lib/demo/demo-vehicles";
import type { FleetDrone } from "@/lib/types";
import { haversineDistance } from "@/lib/geo/distance";

/** Demo node id for a config id (the canonical `node:<id>`). */
const nid = (id: string): string => resolveNodeId(id);

/** Elevation of the demo flying site above mean sea level, metres. */
const DEMO_SITE_ELEVATION_M = 920;

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
  /** MISSION_CURRENT seq for each loop point as the target, and the mission's
   * item count without home: what the vehicle reports flying its loop. */
  missionSeqs: number[];
  missionTotal: number;
  /** Where the vehicle is while off its loop (a hold or the flight home);
   * null while it flies the loop. */
  offPath: DemoFix | null;
}

class MockFlightEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private states: DroneSimState[] = [];
  private tickRate = 200;
  /** Loads the selected flying drone's mission into the planner (see engine-mission). */
  private missionLoader = new DemoMissionLoader();
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
      // The loop this drone flies is the mission it holds onboard, and it
      // boots airborne in its configured arm state and mode.
      const missionSeqs: number[] = [];
      let missionTotal = 0;
      if (path && path.length >= 2 && protocol instanceof MockProtocol) {
        const homeSlot = holdsHomeSlot(protocol);
        const items = pathMissionItems(path, homeSlot);
        protocol.loadMission(items);
        protocol.flight.init({ armed: cfg.status === "in_mission", airborne: true, mode: cfg.flightMode });
        for (let i = 0; i < path.length; i++) missionSeqs.push(missionSeqForTarget(path, i, homeSlot));
        missionTotal = items.length - (homeSlot ? 1 : 0);
        protocol.flight.missionProgress = { seq: missionSeqs[1], total: missionTotal };
      }

      return {
        config: cfg, pathProgress: 0, currentWaypointIdx: 0,
        battery: cfg.batteryStart, tickCount: 0, lastAlertTick: 0,
        protocol,
        transport: new MockTransport(),
        bootMessageIndex: 0, statusMessageTick: 0, segmentDistances,
        loopStartTick: 0, loopMaxAlt: 0, loopMaxSpeed: 0, loopDistance: 0,
        loopBatteryStart: cfg.batteryStart, loopTrail: [], loopCount: 0,
        inavTicking: false, missionSeqs, missionTotal, offPath: null,
      };
    });
  }

  start(intervalMs = 200): void {
    if (this.running) return;
    this.tickRate = intervalMs;
    this.running = true;

    // Seed the node registry (presence, attached FC, first telemetry sample)
    // and the drone metadata profiles; the tick loop then keeps it live.
    seedDemoNodes(Date.now());
    this.missionLoader = new DemoMissionLoader();

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
        { ownsFleetRow: false, autoSelect: false });
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
          const selected = nid(st.config.id) === useDroneManager.getState().selectedDroneId;
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
    markDemoVehicles([DEMO_DIRECT_FC_ID]);

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
   * Stop and resume telemetry without tearing the demo down, so the
   * freshness-gated surfaces can be exercised without hardware.
   *
   * The cockpit safety band, the HUD attitude flag, the proximity radar and
   * the LINK STALE badge all key off a sample's age, and every one of those
   * paths shipped broken precisely because nothing in demo mode could produce
   * a stale reading: the ring buffers were always being fed, so the bug only
   * appeared on a real link loss in the field. Freezing the tick leaves the
   * last samples in place and lets the clock age them, which is exactly what
   * a dead radio looks like from the GCS. The demo pilot publisher stops with
   * it, so the flight-state chip dims to LINK as on a real link loss.
   *
   * `stop()` remains the full teardown; this is deliberately narrower.
   */
  freezeTelemetry(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    setDemoTelemetryFrozen(true);
  }

  /** Resume the tick after {@link freezeTelemetry}. */
  resumeTelemetry(): void {
    setDemoTelemetryFrozen(false);
    if (!this.running || this.intervalId) return;
    this.intervalId = setInterval(() => this.tick(), this.tickRate);
  }

  /**
   * Make the demo nav feed behave as if `/api/v1/nav/stream` cannot be
   * reached (true) or restore it (false). Blocked, the feed goes quiet for the
   * bridge's fallback delay and then arrives through the reduced-rate
   * `nav/status` poll, as it does behind a ground-station radio relay.
   */
  blockNavStream(blocked: boolean): void {
    setDemoNavStreamBlocked(blocked);
  }

  /** Whether telemetry is currently flowing (false while frozen). */
  get telemetryFlowing(): boolean {
    return this.running && this.intervalId !== null;
  }

  stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    // Tear down every protocol so no interval/timer leaks across stop: the
    // MAVLink mock's telemetry tick and cal timers and the iNav mock's
    // self-driven tick are all cleared by disconnect/stop. This holds even
    // when the engine stops without an explicit disconnect.
    for (const state of this.states) {
      const p = state.protocol;
      if (p instanceof INavMockProtocol) {
        p.stopMockTelemetryTick();
        state.inavTicking = false;
      }
      void p.disconnect();
    }
    this.running = false;
    setDemoTelemetryFrozen(false);
    setDemoNavStreamBlocked(false);
    clearDemoVehicles();
  }

  tick(): void {
    const registry = useNodeRegistryStore.getState();
    // The fleet store owns alerts (the registry holds identity + FC
    // telemetry); keep a reference for addAlert.
    const fleetStore = useFleetStore.getState();
    const selectedId = useDroneManager.getState().selectedDroneId;
    const now = Date.now();

    // A newly selected flying drone's onboard mission goes into the planner
    // through the download an operator runs (see engine-mission).
    const selectedFlying = this.states.find(
      (s) => s.config.pathIndex >= 0 && nid(s.config.id) === selectedId,
    )?.protocol;
    void this.missionLoader.onSelection(
      selectedId,
      selectedFlying instanceof MockProtocol ? selectedFlying : null,
    );

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

      if (cfg.pathIndex < 0) {
        // A parked demo FC still heartbeats; without this its seeded arm state
        // ages past the staleness window and projects as a lost link.
        registry.updateFcTelemetry(nid(cfg.id), { lastHeartbeat: now });
        continue;
      }

      const path = FLIGHT_PATHS[cfg.pathIndex];
      if (!path || path.length < 2) continue;

      const flight = state.protocol instanceof MockProtocol ? state.protocol.flight : null;
      // LAND set as a mode (the mode bar, a pilot land) touches down the way
      // the Land command does.
      if (flight?.airborne && flight.mode === "LAND") flight.land();

      // A drone that landed (Land command, a kill, the end of an RTL) holds
      // its touchdown point and flies no path until it takes off again.
      if (state.protocol instanceof MockProtocol && !state.protocol.flight.airborne) {
        tickGroundedDrone(nid(cfg.id), state.protocol, state.tickCount, nid(cfg.id) === selectedId, now);
        continue;
      }

      const wp = path[state.currentWaypointIdx];
      const nextIdx = (state.currentWaypointIdx + 1) % path.length;
      const nextWp = path[nextIdx];
      const segmentDist = state.segmentDistances[state.currentWaypointIdx] ?? 0;
      const phase = flight ? demoFlightPhase(flight.mode) : "path";

      let pos: DemoFix;
      let speed = 0;
      let climbRate = 0;
      let arrivedHome = false;
      if (phase === "path") {
        state.offPath = null;
        const stepDist = (wp.speed * this.tickRate) / 1000;
        const progressStep = segmentDist > 0 ? stepDist / segmentDist : 0.01;
        state.pathProgress += progressStep;

        if (state.pathProgress >= 1) {
          state.pathProgress = 0;

          if (nextIdx === 0 && state.currentWaypointIdx > 0) {
            // The curated seed in mock/history.ts is the demo History tab; the
            // loop writes no flight records of its own.
            state.loopCount++;
            state.loopStartTick = state.tickCount;
            state.loopMaxAlt = 0; state.loopMaxSpeed = 0; state.loopDistance = 0;
            state.loopBatteryStart = state.battery; state.loopTrail = [];
          }

          state.loopDistance += state.segmentDistances[state.currentWaypointIdx] ?? 0;
          state.currentWaypointIdx = nextIdx;
        }

        pos = interpolatePath(wp, nextWp, state.pathProgress);
        speed = wp.speed;
        // Climb in m/s: the segment's height change over the time it takes to
        // fly at the waypoint's speed.
        climbRate = segmentDist > 0 ? ((nextWp.alt - wp.alt) * wp.speed) / segmentDist : 0;
        if (wp.speed > state.loopMaxSpeed) state.loopMaxSpeed = wp.speed;
      } else {
        // Off the loop: hold where the vehicle is, or fly home. The loop
        // progress stays put, so AUTO carries on from the item it was on.
        const here = state.offPath ?? interpolatePath(wp, nextWp, state.pathProgress);
        if (phase === "return") {
          const step = stepHome(here, path[0], (RETURN_SPEED_MPS * this.tickRate) / 1000);
          state.offPath = step.fix;
          arrivedHome = step.arrived;
          speed = arrivedHome ? 0 : RETURN_SPEED_MPS;
        } else {
          state.offPath = here;
        }
        pos = state.offPath;
      }
      if (flight) {
        flight.missionProgress = {
          seq: state.missionSeqs[(state.currentWaypointIdx + 1) % path.length],
          total: state.missionTotal,
        };
      }

      if (pos.alt > state.loopMaxAlt) state.loopMaxAlt = pos.alt;
      if (state.tickCount % 10 === 0) { state.loopTrail.push([pos.lat, pos.lon]); }

      const jitterLat = (Math.random() - 0.5) * 0.00002;
      const jitterLon = (Math.random() - 0.5) * 0.00002;
      state.battery = Math.max(5, state.battery - (0.044 * this.tickRate) / 1000);

      const prevHeading =
        registry.getEntry(nid(cfg.id))?.fc.position?.heading ?? pos.heading;
      const headingDelta = pos.heading - prevHeading;
      const roll = Math.max(-30, Math.min(30, headingDelta * 0.5));
      const climbSign = phase === "path" ? Math.sign(nextWp.alt - wp.alt) : 0;
      const pitch = phase === "hold" ? 0 : climbSign > 0 ? -5 : climbSign < 0 ? 5 : -2;

      const droneUpdate: Partial<FleetDrone> = {
        lastHeartbeat: now,
        position: {
          timestamp: now, lat: pos.lat + jitterLat, lon: pos.lon + jitterLon,
          alt: DEMO_SITE_ELEVATION_M + pos.alt, relativeAlt: pos.alt, heading: pos.heading,
          groundSpeed: speed, airSpeed: speed * 1.05,
          climbRate,
          // Velocity along the course, NED: the track the drone is flying.
          vn: speed * Math.cos((pos.heading * Math.PI) / 180),
          ve: speed * Math.sin((pos.heading * Math.PI) / 180),
          vd: -climbRate,
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
          lat: pos.lat + jitterLat, lon: pos.lon + jitterLon, alt: DEMO_SITE_ELEVATION_M + pos.alt,
        },
      };
      // Mirror the simulated flight into the registry FC sub-state (the single
      // fleet write target); the fleet projection reads it as the live row.
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
          droneUpdate, pos, roll, pitch, headingDelta, battery: state.battery, speed, climbRate,
          pathIndex: cfg.pathIndex, currentWaypointIdx: state.currentWaypointIdx,
          pathProgress: state.pathProgress, segmentDistances: state.segmentDistances,
          statusMessageTick: state.statusMessageTick, rcChannels,
        });

        // PX4 structured events (msg 410) — cycle a few demo events so the
        // Logs → Events feed renders decoded text in demo mode.
        if (state.protocol.getVehicleInfo().firmwareType === "px4" && state.tickCount % 40 === 5) {
          const idx = Math.floor(state.tickCount / 40) % DEMO_PX4_EVENT_FRAMES.length;
          state.protocol.emitEvent(DEMO_PX4_EVENT_FRAMES[idx]);
        }
      }

      // Home reached on an RTL: the FC touches down and disarms there, and a
      // later AUTO starts the loop from the top.
      if (arrivedHome && flight) {
        flight.touchDown();
        state.currentWaypointIdx = 0;
        state.pathProgress = 0;
        state.offPath = null;
      }

      if (state.tickCount - state.lastAlertTick > 300 && Math.random() < 0.02) {
        fleetStore.addAlert(generateAlert(cfg.id, cfg.name));
        state.lastAlertTick = state.tickCount;
      }
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}

/** Singleton mock engine instance. */
export const mockEngine = new MockFlightEngine();
