/**
 * @module mock/demo-seed/ground-station
 * @description Seeds every ground-station store slice the node-detail tabs read in demo mode.
 * @license GPL-3.0-only
 */

import { useGroundStationStore } from "@/stores/ground-station-store";
import type { PhoneInvite } from "@/lib/api/ground-station/types";
import type { GroundStationApi } from "@/lib/api/ground-station-api";
import { setDemoMeshApi } from "@/lib/api/ground-station/mesh-source";
import { setDemoPairApi } from "@/lib/api/ground-station/pair-source";
import { demoGroundStationPair } from "@/mock/ground-station-wfb-pair";
import {
  DEMO_GS_ROLE,
  DEMO_MESH_BASE_URL,
  DEMO_MESH_GATEWAYS,
  DEMO_MESH_HEALTH,
  DEMO_MESH_ROUTES,
  DEMO_RECEIVER_COMBINED,
  demoGroundStationMesh,
  demoMeshNeighbors,
  demoReceiverRelays,
} from "@/mock/ground-station-mesh";
import { seedGroundStationLanes } from "./ground-station-lanes";
import { INITIAL_MESH } from "@/stores/ground-station/initial-state";
import { useDroneManager } from "@/stores/drone-manager";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { DEMO_GROUND_STATION_DIRECT } from "@/mock/drones";
import type { GroundStationRole } from "@/lib/api/ground-station/types";

/** The role of the demo ground station in focus: the direct-role station when
 * it is selected, else the receiver. The demo shares one mesh client and one
 * ground-station store, so the seed follows the focused station. */
function focusedDemoRole(): GroundStationRole {
  const sel = useDroneManager.getState().selectedDroneId;
  const dev = sel ? (deviceIdFromNodeId(sel) ?? sel) : null;
  return dev === DEMO_GROUND_STATION_DIRECT.deviceId ? DEMO_GROUND_STATION_DIRECT.role : DEMO_GS_ROLE;
}

/** Phone receivers waiting for approval on the demo ground station. The expiry
 * is a far-future constant: the demo has no agent to lapse it. */
export const DEMO_PHONE_INVITES: readonly PhoneInvite[] = [
  {
    invite_id: "demo-invite-1",
    label: "Pilot tablet",
    phone_fingerprint: "6668-7AAD-F862-BD77",
    expires_at_ms: 4_102_444_800_000,
  },
  {
    invite_id: "demo-invite-2",
    label: "Observer phone",
    phone_fingerprint: "3B9C-01E4-A7D2-5F60",
    expires_at_ms: 4_102_444_800_000,
  },
];

/** Seed every ground-station store slice the node-detail GS tabs read — the
 * Overview cards (link health, uplink, paired drone, mesh role/health) plus the
 * Radio / Network / Mesh / Distributed-RX / Display / Physical-UI / Peripherals
 * tables. In demo the GS REST client is null (groundStationApiFromAgent), so the
 * tabs' load-on-mount polls no-op and this seeded data renders untouched.
 *
 * The Mesh & RX surface is the exception: it resolves the in-memory demo mesh
 * client (mock/ground-station-mesh), reset and installed here, and the mesh
 * slices are tagged with that client's origin (`meshFor`) so the surface
 * reads them as this node's own. */
export function seedGroundStationStore(): void {
  const role = focusedDemoRole();
  const receiver = role === "receiver";
  demoGroundStationMesh.reset(role);
  setDemoMeshApi(demoGroundStationMesh as unknown as GroundStationApi);
  demoGroundStationPair.reset();
  setDemoPairApi(demoGroundStationPair as unknown as GroundStationApi);
  seedGroundStationLanes();
  useGroundStationStore.setState({
    meshFor: DEMO_MESH_BASE_URL,
    status: {
      paired_drone: "alpha-1",
      profile: "ground_station",
      uplink_active: "ethernet",
    },
    statusFetchedAt: Date.now(),
    linkHealth: {
      rssi_dbm: -58,
      bitrate_mbps: 18.5,
      fec_rec: 1240,
      fec_lost: 9,
      channel: 149,
    },
    // WiFi access point + full uplink matrix (WiFi client / Ethernet / 4G) for
    // the Network tab's per-uplink sections.
    ap: {
      enabled: true,
      ssid: "ADOS-GS-AP",
      passphrase: "altnautica",
      channel: 6,
      connected_clients: 1,
    },
    network: {
      ap: {
        enabled: true,
        ssid: "ADOS-GS-AP",
        passphrase: "altnautica",
        channel: 6,
        connected_clients: 1,
      },
      wifi_client: {
        available: true,
        connected: false,
        ssid: null,
        rssi_dbm: null,
        ip: null,
      },
      ethernet: {
        available: true,
        link: true,
        speed_mbps: 1000,
        ip: "192.168.1.60",
        gateway: "192.168.1.1",
        iface: "eth0",
      },
      modem_4g: {
        enabled: false,
        apn: "internet",
        cap_mb: null,
        connected: null,
        iface: null,
        ip: null,
        signal_quality: null,
        technology: null,
        operator: null,
        state: null,
        data_used_mb: null,
        percent: null,
      },
      active_uplink: "ethernet",
      priority: ["ethernet", "wifi", "modem"],
      share_uplink: false,
    },
    modem: {
      enabled: false,
      apn: "internet",
      cap_mb: null,
      connected: null,
      iface: null,
      ip: null,
      signal_quality: null,
      technology: null,
      operator: null,
      state: null,
      data_used_mb: null,
      percent: null,
    },
    ethernetConfig: { mode: "dhcp" },
    uplink: {
      active: "ethernet",
      priority: ["ethernet", "wifi", "modem"],
      health: "ok",
      failover_log: [],
      data_cap: null,
      cloud_relay: {
        mqtt_connected: true,
        throttle_state: "ok",
        forwarding_video: true,
        forwarding_telemetry: true,
      },
      routeApplied: true,
      shareUplinkApplied: null,
      shareUplinkAppliedReason: null,
      loading: false,
      error: null,
      fetchedAt: Date.now(),
    },
    // The focused station's role: the receiver combines the streams its
    // relays forward (relay list, combined stats, pairing window); the direct
    // station carries its own link and has none of those.
    role: {
      info: {
        current: role,
        configured: role,
        supported: ["direct", "relay", "receiver"],
        mesh_capable: true,
      },
      loading: false,
      switching: false,
      error: null,
      fetchedAt: Date.now(),
    },
    // batman-adv mesh: neighbors, routes, and the elected cloud gateway for the
    // Mesh tab's neighbor / gateway tables + health card.
    // A direct station joins no mesh, so it reads as one with nothing heard.
    mesh: receiver
      ? {
          health: { ...DEMO_MESH_HEALTH },
          neighbors: demoMeshNeighbors(Date.now()),
          routes: DEMO_MESH_ROUTES.map((r) => ({ ...r })),
          gateways: DEMO_MESH_GATEWAYS.map((g) => ({ ...g })),
          selectedGateway: DEMO_MESH_HEALTH.selected_gateway,
          lastTransientEvent: null,
          wsState: "connected",
          wsDisconnectedAt: null,
          loading: false,
          error: null,
          fetchedAt: Date.now(),
        }
      : { ...INITIAL_MESH, fetchedAt: Date.now() },
    // Distributed-RX receiver state: the relays feeding this node and the
    // combined stream, with the pairing window closed until the operator
    // opens it.
    distributedRx: {
      // Only a receiver combines relayed streams; a direct station has none.
      receiverRelays: receiver ? demoReceiverRelays(Date.now()) : [],
      combined: receiver ? { ...DEMO_RECEIVER_COMBINED } : null,
      relayStatus: null,
      pairingWindowOpen: false,
      pairingWindowExpiresAt: null,
      pairingCode: null,
      pendingRequests: [],
      loading: false,
      error: null,
    },
    // Physical UI (OLED brightness + button bindings + screen order) for the
    // Physical UI tab, plus a paired gamepad for its Bluetooth section.
    ui: {
      oled: { brightness: 180 },
      buttons: {
        mapping: {
          B1_short: "cycle_screen",
          B1_long: "toggle_backlight",
          B2_short: "show_network",
          B2_long: "show_qr",
          B3_short: "confirm",
          B3_long: "pair_drone",
          B4_short: "back",
          B4_long: "shutdown_prompt",
        },
      },
      screens: {
        order: ["link", "uplink", "mesh", "pair"],
        enabled: ["link", "uplink", "mesh", "pair"],
      },
    },
    bluetooth: {
      scanning: false,
      scan_results: [],
      paired: [
        {
          mac: "44:55:66:77:88:99",
          name: "Wireless Gamepad",
          rssi_dbm: -52,
          paired: true,
          connected: true,
        },
      ],
      // Demo has no ground-station REST client, so the list belongs to no node URL.
      pairedFor: null,
      pairing_mac: null,
      error: null,
    },
    // Local HDMI/LCD display config for the Display tab.
    display: { resolution: "480x320", kiosk_enabled: false },
    // Attached peripherals for the Peripherals tab.
    peripherals: {
      list: [
        {
          id: "oled-0",
          display_name: "OLED 128x64 (SSD1306)",
          transport: "serial",
          connected: true,
          capabilities: ["display"],
        },
        {
          id: "gamepad-0",
          display_name: "USB Gamepad",
          transport: "usb",
          connected: true,
          capabilities: ["joystick", "buttons"],
        },
        {
          id: "gnss-0",
          display_name: "u-blox GNSS Receiver",
          transport: "usb",
          connected: true,
          capabilities: ["gnss"],
        },
      ],
      detail: {},
      loading: false,
      error: null,
    },
  });
}
