/**
 * MockFlightEngine — Core simulation loop for demo mode.
 *
 * Writes directly to Zustand stores at configurable tick rate.
 * Components consume store data identically whether mock or real.
 *
 * Also creates a MockProtocol + MockTransport per flying drone and
 * registers them in DroneManager via addDrone(). This enables the
 * Configure tab, Flight Logs, SensorHealthBar, and all panels that
 * depend on getSelectedProtocol() returning a real protocol.
 */

import { DEMO_DRONES, configToFleetDrone, type DemoDroneConfig } from "./drones";
import { FLIGHT_PATHS, interpolatePath } from "./flight-paths";
import { generateAlert, batteryAlert } from "./alerts";
import { MockProtocol } from "./mock-protocol";
import { MockTransport } from "./mock-transport";
import { BOOT_MESSAGES } from "./status-messages";
import { emitSelectedDroneTelemetry } from "./engine-telemetry";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { haversineDistance } from "@/lib/telemetry-utils";
import { randomId } from "@/lib/utils";
import type { FleetDrone, FlightRecord } from "@/lib/types";

interface DroneSimState {
  config: DemoDroneConfig;
  pathProgress: number;
  currentWaypointIdx: number;
  battery: number;
  tickCount: number;
  lastAlertTick: number;
  batteryAlertSent: boolean;
  protocol: MockProtocol;
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
      return {
        config: cfg, pathProgress: 0, currentWaypointIdx: 0,
        battery: cfg.batteryStart, tickCount: 0, lastAlertTick: 0,
        batteryAlertSent: false,
        protocol: new MockProtocol(cfg.id === 'delta' ? 'px4' : 'ardupilot-copter'),
        transport: new MockTransport(),
        bootMessageIndex: 0, statusMessageTick: 0, segmentDistances,
        loopStartTick: 0, loopMaxAlt: 0, loopMaxSpeed: 0, loopDistance: 0,
        loopBatteryStart: cfg.batteryStart, loopTrail: [], loopCount: 0,
      };
    });
  }

  start(intervalMs = 200): void {
    if (this.running) return;
    this.tickRate = intervalMs;
    this.running = true;

    const initialDrones = DEMO_DRONES.map(configToFleetDrone);
    useFleetStore.getState().setDrones(initialDrones);

    const metadataStore = useDroneMetadataStore.getState();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const cfg of DEMO_DRONES) {
      metadataStore.ensureProfile(cfg.id, {
        displayName: cfg.name, serial: `ALT-${cfg.id.toUpperCase()}`,
        computeModule: "RPi CM4", weightClass: "Micro",
        suiteType: cfg.suiteType ?? null,
        totalFlights: cfg.pathIndex >= 0 ? 47 : 12,
        totalHours: cfg.pathIndex >= 0 ? 23.4 : 5.1,
        enrolledAt: thirtyDaysAgo,
      });
    }

    useDroneStore.getState().selectDrone("alpha-1");

    const droneManager = useDroneManager.getState();
    for (const state of this.states) {
      const cfg = state.config;
      if (cfg.pathIndex < 0 && cfg.id !== 'delta') continue;
      const vehicleInfo = state.protocol.getVehicleInfo();
      droneManager.addDrone(cfg.id, cfg.name, state.protocol, state.transport, vehicleInfo,
        { type: "websocket", url: "mock://demo" });
    }

    droneManager.selectDrone("alpha-1");

    const selectedState = this.states.find((s) => s.config.id === "alpha-1");
    if (selectedState) {
      for (const msg of BOOT_MESSAGES) {
        selectedState.protocol.emitStatusText(msg.severity, msg.text);
      }
      selectedState.bootMessageIndex = BOOT_MESSAGES.length;
    }

    this.intervalId = setInterval(() => this.tick(), this.tickRate);
  }

  stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.running = false;
  }

  tick(): void {
    const fleetStore = useFleetStore.getState();
    const selectedId = useDroneStore.getState().selectedId;
    const now = Date.now();

    for (const state of this.states) {
      state.tickCount++;
      const cfg = state.config;
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
              suiteType: cfg.suiteType, date: now,
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

      const headingDelta = pos.heading - (fleetStore.drones.find(d => d.id === cfg.id)?.position?.heading ?? pos.heading);
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
      fleetStore.updateDrone(cfg.id, droneUpdate);

      if (cfg.id === selectedId) {
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
