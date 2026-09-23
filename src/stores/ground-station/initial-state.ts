/**
 * Initial-state constants and internal helpers for the ground-station store.
 * Lifted out of the main store to keep the file focused on actions.
 *
 * @module stores/ground-station/initial-state
 */

import type { GroundStationLinkHealth, GroundStationStatus } from "@/lib/api/ground-station-api";
import type {
  BluetoothSlice,
  DistributedRxSlice,
  GamepadsSlice,
  MeshSlice,
  PairSlice,
  PeripheralsSlice,
  PicSlice,
  RoleSlice,
  UplinkSlice,
  WifiScanCache,
} from "./types";

export const INITIAL_LINK_HEALTH: GroundStationLinkHealth = {
  rssi_dbm: null,
  bitrate_mbps: null,
  fec_rec: 0,
  fec_lost: 0,
  channel: null,
};

export const INITIAL_STATUS: GroundStationStatus = {
  paired_drone: null,
  profile: "unconfigured",
  uplink_active: null,
};

export const INITIAL_PAIR: PairSlice = {
  loading: false,
  result: null,
  error: null,
  errorStatus: null,
};

export const INITIAL_PIC: PicSlice = {
  state: "idle",
  claimed_by: null,
  claim_counter: 0,
  primary_gamepad_id: null,
  loading: false,
  error: null,
};

export const INITIAL_GAMEPADS: GamepadsSlice = {
  devices: [],
  primary_id: null,
  loading: false,
};

export const INITIAL_BLUETOOTH: BluetoothSlice = {
  scanning: false,
  scan_results: [],
  paired: [],
  pairedFor: null,
  pairing_mac: null,
  error: null,
};

export const INITIAL_WIFI_SCAN: WifiScanCache = {
  results: [],
  scanning: false,
  scannedAt: null,
  error: null,
};

export const INITIAL_UPLINK: UplinkSlice = {
  active: null,
  priority: [],
  health: null,
  failover_log: [],
  data_cap: null,
  cloud_relay: null,
  shareUplinkApplied: null,
  shareUplinkAppliedReason: null,
  loading: false,
  error: null,
  fetchedAt: null,
};

export const INITIAL_PERIPHERALS: PeripheralsSlice = {
  list: [],
  detail: {},
  loading: false,
  error: null,
};

export const INITIAL_ROLE: RoleSlice = {
  info: null,
  loading: false,
  switching: false,
  error: null,
  fetchedAt: null,
};

export const INITIAL_DISTRIBUTED_RX: DistributedRxSlice = {
  receiverRelays: [],
  combined: null,
  relayStatus: null,
  pairingWindowOpen: false,
  pairingWindowExpiresAt: null,
  pairingCode: null,
  pendingRequests: [],
  loading: false,
  error: null,
};

export const INITIAL_MESH: MeshSlice = {
  health: null,
  neighbors: [],
  routes: [],
  gateways: [],
  selectedGateway: null,
  lastTransientEvent: null,
  wsState: "idle",
  wsDisconnectedAt: null,
  loading: false,
  error: null,
  fetchedAt: null,
};

export const FAILOVER_LOG_CAP = 20;

/**
 * Snapshot of every slice in its initial-load shape. Used by the store's
 * `resetAll` action so the aggregator does not need to import every
 * initial-state constant by name.
 */
export const INITIAL_STORE_SLICE = {
  linkHealth: INITIAL_LINK_HEALTH,
  wfbConfig: null,
  status: INITIAL_STATUS,
  loading: false,
  lastError: null,
  lastFetchedAt: null,
  statusFetchedAt: null,
  linkHealthAt: null,
  network: null,
  ap: null,
  pair: INITIAL_PAIR,
  ui: null,
  uiFor: null,
  pic: INITIAL_PIC,
  gamepads: INITIAL_GAMEPADS,
  bluetooth: INITIAL_BLUETOOTH,
  display: null,
  wifiScan: INITIAL_WIFI_SCAN,
  modem: null,
  uplink: INITIAL_UPLINK,
  ethernetConfig: null,
  uplinkFor: null,
  peripherals: INITIAL_PERIPHERALS,
  role: INITIAL_ROLE,
  distributedRx: INITIAL_DISTRIBUTED_RX,
  mesh: INITIAL_MESH,
} as const;
