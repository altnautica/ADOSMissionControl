/**
 * @module mock/agent/fleet
 * @description Mock fleet modules, peers, and the outbound network summary
 * the demo agent advertises.
 * @license GPL-3.0-only
 */

import type { NetworkPeer } from "@/lib/agent/types";

export interface MockModule {
  name: string;
  version: string;
  installed: boolean;
  description: string;
}

export const MOCK_MODULES: MockModule[] = [
  { name: "mavlink-proxy", version: "1.0.0", installed: true, description: "MAVLink message forwarding and multiplexing" },
  { name: "video-pipeline", version: "1.0.0", installed: true, description: "WFB-ng video stream management" },
  { name: "mqtt-gateway", version: "1.0.0", installed: true, description: "MQTT telemetry bridge to cloud" },
  { name: "suite-runtime", version: "1.0.0", installed: true, description: "Suite YAML manifest loader and executor" },
  { name: "script-executor", version: "1.0.0", installed: true, description: "Python and text command execution engine" },
  { name: "sensor-manager", version: "1.0.0", installed: true, description: "Sensor discovery, configuration, and data routing" },
  { name: "obstacle-avoidance", version: "0.9.0", installed: false, description: "Depth camera obstacle detection and path replanning" },
  { name: "precision-landing", version: "0.8.0", installed: false, description: "ArUco marker and IR beacon precision landing" },
  { name: "swarm-coordinator", version: "0.7.0", installed: false, description: "Multi-drone formation and task distribution" },
];

export const MOCK_PEERS: NetworkPeer[] = [
  { id: "bravo-2", name: "Bravo-02", signal_dbm: -62, last_seen: "2s ago", battery_percent: 78, distance_m: 142, tier: 3, link_type: "WiFi Direct" },
  { id: "echo-5", name: "Echo-05", signal_dbm: -78, last_seen: "5s ago", battery_percent: 45, distance_m: 380, tier: 2, link_type: "LoRa" },
  { id: "delta-3", name: "Delta-3", signal_dbm: -71, last_seen: "3s ago", battery_percent: 92, distance_m: 210, tier: 3, link_type: "WiFi Direct" },
];

export interface MockNetwork {
  mqtt: { connected: boolean; broker: string; messages_sent: number; messages_received: number };
  mesh: { lora: { installed: boolean }; wifi_direct: { enabled: boolean } };
  peers: NetworkPeer[];
}

export const MOCK_NETWORK: MockNetwork = {
  mqtt: { connected: true, broker: "mqtt://fleet.altnautica.com:8883", messages_sent: 14832, messages_received: 9217 },
  mesh: { lora: { installed: false }, wifi_direct: { enabled: false } },
  peers: MOCK_PEERS,
};
