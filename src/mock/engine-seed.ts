/**
 * The demo fleet's starting state, written once when the mock engine starts:
 * every node's presence in the canonical node registry, each demo drone's
 * attached FC and first telemetry sample, and the drone metadata profiles.
 *
 * Split from engine.ts, which owns the live tick that follows.
 *
 * @license GPL-3.0-only
 */

import {
  DEMO_DRONES,
  DEMO_WORKSTATION,
  DEMO_GROUND_STATION,
  DEMO_GROUND_STATION_DIRECT,
  type DemoDroneConfig,
} from "./drones";
import { DEMO_VISOR } from "./demo-seed/visor";
import { markDemoVehicles } from "@/lib/demo/demo-vehicles";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import {
  useNodeRegistryStore,
  resolveNodeId,
  type NodeFc,
} from "@/stores/node-registry";

/**
 * Seed the canonical node registry: it is the fleet's single write target and
 * the fleet projection reads it. Each demo drone gets `"local"` presence + an
 * attached FC + an initial telemetry seed so it renders once with its
 * configured arm/mode/battery/position. The flying drones then receive live
 * telemetry through `bridgeTelemetry` (also into the registry).
 */
export function seedDemoNodes(now: number): void {
  const registry = useNodeRegistryStore.getState();
  // Demo vehicles boot armed in their missions; the operator's own armed
  // vehicles are what the shell's modals wait for.
  markDemoVehicles(DEMO_DRONES.map((cfg) => resolveNodeId(cfg.id)));
  for (const cfg of DEMO_DRONES) {
    const id = resolveNodeId(cfg.id);
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
    registry.updateFcTelemetry(id, seedTelemetry(cfg, now));
  }

  // The non-flying demo nodes: a workstation (compute) node and a ground
  // station. Presence only, no attached FC — the projection then renders each
  // with its own profile (workstation / ground-station) and hides the
  // FC-gated battery/GPS telemetry. Their liveness rides the command-fleet
  // status `updatedAt` (refreshed by DemoProvider), the same path a real
  // cloud-only node uses. The ground-station store (link/uplink/mesh) is seeded
  // in DemoProvider.
  registry.upsertPresence(
    resolveNodeId(DEMO_WORKSTATION.deviceId),
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
  for (const gs of [DEMO_GROUND_STATION, DEMO_GROUND_STATION_DIRECT]) {
    registry.upsertPresence(
      resolveNodeId(gs.deviceId),
      {
        deviceId: gs.deviceId,
        name: gs.name,
        profile: "ground-station",
        role: gs.role,
        cloudPosture: "local",
        cloudDeviceId: gs.deviceId,
        lastHeartbeat: now,
      },
      "local",
    );
  }

  // The demo Visor: a handheld capture rig, presence only like the two above
  // (its sensor hub is not a MAVLink FC). Its sensor/clock/storage readings
  // are seeded in DemoProvider.
  registry.upsertPresence(
    resolveNodeId(DEMO_VISOR.deviceId),
    {
      deviceId: DEMO_VISOR.deviceId,
      name: DEMO_VISOR.name,
      profile: "visor",
      cloudPosture: "local",
      cloudDeviceId: DEMO_VISOR.deviceId,
      lastHeartbeat: now,
    },
    "local",
  );

  const metadataStore = useDroneMetadataStore.getState();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  for (const cfg of DEMO_DRONES) {
    // Metadata is keyed by the fleet row id (the node id), so the drone card's
    // `profiles[drone.id]` display-name lookup resolves.
    metadataStore.ensureProfile(resolveNodeId(cfg.id), {
      displayName: cfg.name, serial: `ALT-${cfg.id.toUpperCase()}`,
      computeModule: "RPi CM4", weightClass: "Micro",
      totalFlights: cfg.pathIndex >= 0 ? 47 : 12,
      totalHours: cfg.pathIndex >= 0 ? 23.4 : 5.1,
      enrolledAt: thirtyDaysAgo,
    });
  }
}

/**
 * Initial FC telemetry for a demo drone, derived from its config, so each
 * drone renders with its configured arm/mode/battery/position before the live
 * tick loop takes over.
 */
function seedTelemetry(cfg: DemoDroneConfig, now: number): Partial<NodeFc> {
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
