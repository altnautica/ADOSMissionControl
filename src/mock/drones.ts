import type { FleetDrone, DroneStatus, FlightMode } from "@/lib/types";
import type { MockFirmware } from "./mock-protocol";

export interface DemoDroneConfig {
  id: string;
  name: string;
  status: DroneStatus;
  flightMode: FlightMode;
  suiteName?: string;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
  batteryStart: number;
  pathIndex: number; // index into FLIGHT_PATHS
  healthScore: number;
  hasAgent?: boolean;
  /** Firmware + vehicle-class variant; defaults to ardupilot-copter. */
  firmware?: MockFirmware;
}

/**
 * The demo fleet's flight-controller drones — a firmware-flavor lineup so every
 * vehicle-gated configuration panel is reachable in demo. Every drone is a
 * companion (SBC + one FC): an ADOS Drone Agent on an onboard computer bridging
 * to a single flight controller (`hasAgent: true`), so it shows the onboard-
 * computer band (live video / Vision / compute / services).
 * The one exception is Bravo-02, the single ArduPilot Copter kept as the FC-only
 * baseline (a direct MAVLink connection, no companion → the node console's
 * FC-only overview + "add a companion computer" CTA). The airframe/firmware
 * flavors span PX4, PX4-VTOL, ArduPlane and its VTOL / tailsitter / tiltrotor
 * variants, ArduRover, ArduBoat (sailboat), ArduSub, ArduHeli, Betaflight, iNav
 * — each lighting up a different config panel set (the MSP flavors run their FC
 * through the agent as a byte-pipe). The workstation (compute) and ground-station
 * nodes are defined below.
 */
export const DEMO_DRONES: DemoDroneConfig[] = [
  {
    id: "alpha-1", name: "Alpha-01", status: "in_mission", flightMode: "AUTO",
    suiteName: "Sentry : Security Patrol",
    homeLat: 12.950, homeLon: 77.668, homeAlt: 0, batteryStart: 82, pathIndex: 0, healthScore: 95,
    hasAgent: true,
  },
  {
    // FC-only baseline: direct MAVLink, no companion agent → FC-only overview +
    // "add a companion computer" CTA.
    id: "bravo-2", name: "Bravo-02", status: "in_mission", flightMode: "AUTO",
    suiteName: "Survey : Area Mapping",
    homeLat: 12.955, homeLon: 77.673, homeAlt: 0, batteryStart: 67, pathIndex: 1, healthScore: 88,
    hasAgent: false,
  },
  // Companion (SBC + FC) demos across firmware + vehicle classes so the
  // vehicle-gated configuration panels are all reachable in demo.
  {
    id: "charlie-3", name: "Charlie-03", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.946, homeLon: 77.662, homeAlt: 0, batteryStart: 74, pathIndex: 2, healthScore: 90,
    hasAgent: true, firmware: "px4",
  },
  {
    id: "delta-4", name: "Delta-04", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.958, homeLon: 77.676, homeAlt: 0, batteryStart: 71, pathIndex: 0, healthScore: 89,
    hasAgent: true, firmware: "px4-vtol",
  },
  {
    id: "echo-5", name: "Echo-05", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.920, homeLon: 77.595, homeAlt: 0, batteryStart: 84, pathIndex: 4, healthScore: 93,
    hasAgent: true, firmware: "ardupilot-plane",
  },
  {
    id: "foxtrot-6", name: "Foxtrot-06", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.936, homeLon: 77.688, homeAlt: 0, batteryStart: 78, pathIndex: 1, healthScore: 92,
    hasAgent: true, firmware: "ardupilot-plane-vtol",
  },
  {
    id: "golf-7", name: "Golf-07", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.944, homeLon: 77.658, homeAlt: 0, batteryStart: 69, pathIndex: 2, healthScore: 91,
    hasAgent: true, firmware: "ardupilot-plane-tailsitter",
  },
  {
    id: "hotel-8", name: "Hotel-08", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.916, homeLon: 77.600, homeAlt: 0, batteryStart: 76, pathIndex: 4, healthScore: 90,
    hasAgent: true, firmware: "ardupilot-plane-tiltrotor",
  },
  {
    id: "india-9", name: "India-09", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.951, homeLon: 77.666, homeAlt: 0, batteryStart: 63, pathIndex: 5, healthScore: 90,
    hasAgent: true, firmware: "ardupilot-rover",
  },
  {
    id: "juliet-10", name: "Juliet-10", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.930, homeLon: 77.650, homeAlt: 0, batteryStart: 72, pathIndex: 6, healthScore: 90,
    hasAgent: true, firmware: "ardupilot-boat",
  },
  {
    id: "kilo-11", name: "Kilo-11", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.932, homeLon: 77.652, homeAlt: 0, batteryStart: 65, pathIndex: 7, healthScore: 87,
    hasAgent: true, firmware: "ardupilot-sub",
  },
  {
    id: "lima-12", name: "Lima-12", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.958, homeLon: 77.652, homeAlt: 0, batteryStart: 88, pathIndex: 3, healthScore: 93,
    hasAgent: true, firmware: "ardupilot-heli",
  },
  {
    id: "mike-13", name: "Mike-13", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.962, homeLon: 77.670, homeAlt: 0, batteryStart: 76, pathIndex: 0, healthScore: 91,
    hasAgent: true, firmware: "betaflight",
  },
  {
    id: "november-14", name: "November-14", status: "in_mission", flightMode: "AUTO",
    homeLat: 12.925, homeLon: 77.600, homeAlt: 0, batteryStart: 82, pathIndex: 4, healthScore: 90,
    hasAgent: true, firmware: "inav-plane",
  },
];

/**
 * The demo workstation (compute) node. The id is shared by the node-registry
 * presence (seeded in `engine.ts`) and the paired-agent seed (in
 * `DemoProvider`), so `resolveNodeId(deviceId)` and `nodeIdForDevice(deviceId)`
 * collapse to the same `node:<deviceId>` — a fleet card opens a matching
 * profile-aware detail panel. No flight controller: a workstation runs
 * extensions, it does not fly.
 */
export const DEMO_WORKSTATION = {
  deviceId: "forge-1",
  name: "Forge Workstation",
  board: "Workstation",
} as const;

/**
 * The demo ground-station node — id shared like {@link DEMO_WORKSTATION}. A
 * relay role so its mesh + distributed-RX surfaces are exercised.
 */
export const DEMO_GROUND_STATION = {
  deviceId: "groundstation-1",
  name: "Ground Station Alpha",
  board: "Ground Node",
  role: "relay",
} as const;

/**
 * Map a mock firmware variant to the canonical FC firmware family + a short
 * airframe label, so every demo drone badges its firmware/airframe on the fleet
 * card (not just the companion-paired ones).
 */
export function firmwareMeta(fw: MockFirmware | undefined): { fcFirmware: string; frameType: string } {
  switch (fw) {
    case "px4": return { fcFirmware: "px4", frameType: "Copter" };
    case "px4-vtol": return { fcFirmware: "px4", frameType: "VTOL" };
    case "betaflight": return { fcFirmware: "betaflight", frameType: "FPV" };
    case "inav-plane": return { fcFirmware: "inav", frameType: "Wing" };
    case "ardupilot-heli": return { fcFirmware: "ardupilot", frameType: "Heli" };
    case "ardupilot-plane": return { fcFirmware: "ardupilot", frameType: "Plane" };
    case "ardupilot-plane-vtol": return { fcFirmware: "ardupilot", frameType: "VTOL" };
    case "ardupilot-plane-tailsitter": return { fcFirmware: "ardupilot", frameType: "Tailsitter" };
    case "ardupilot-plane-tiltrotor": return { fcFirmware: "ardupilot", frameType: "Tiltrotor" };
    case "ardupilot-rover": return { fcFirmware: "ardupilot", frameType: "Rover" };
    case "ardupilot-boat": return { fcFirmware: "ardupilot", frameType: "Boat" };
    case "ardupilot-sub": return { fcFirmware: "ardupilot", frameType: "Sub" };
    default: return { fcFirmware: "ardupilot", frameType: "Copter" };
  }
}

/** Convert config to initial FleetDrone state. */
export function configToFleetDrone(cfg: DemoDroneConfig): FleetDrone {
  const meta = firmwareMeta(cfg.firmware);
  return {
    id: cfg.id,
    name: cfg.name,
    status: cfg.status,
    suiteName: cfg.suiteName,
    fcFirmware: meta.fcFirmware,
    frameType: meta.frameType,
    connectionState: cfg.status === "maintenance" ? "disconnected" : "connected",
    flightMode: cfg.flightMode,
    armState: cfg.status === "in_mission" ? "armed" : "disarmed",
    lastHeartbeat: 1740600000000,
    healthScore: cfg.healthScore,
    hasAgent: cfg.hasAgent,
    position: {
      timestamp: 1740600000000,
      lat: cfg.homeLat,
      lon: cfg.homeLon,
      alt: cfg.status === "in_mission" ? 50 : 0,
      relativeAlt: cfg.status === "in_mission" ? 50 : 0,
      heading: 0,
      groundSpeed: 0,
      airSpeed: 0,
      climbRate: 0,
    },
    battery: {
      timestamp: 1740600000000,
      voltage: 22.2 * (cfg.batteryStart / 100),
      current: cfg.status === "in_mission" ? 12.5 : 0,
      remaining: cfg.batteryStart,
      consumed: (100 - cfg.batteryStart) * 22,
    },
    gps: {
      timestamp: 1740600000000,
      fixType: cfg.status === "maintenance" ? 0 : 3,
      satellites: cfg.status === "maintenance" ? 0 : 17,
      hdop: 1.0,
      lat: cfg.homeLat,
      lon: cfg.homeLon,
      alt: 10,
    },
  };
}
