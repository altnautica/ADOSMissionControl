/**
 * Shared full-state shape for the ground-station store. Sub-slice creators
 * type their `set`/`get` against this shape so cross-slice reads and writes
 * keep their existing semantics.
 *
 * @license GPL-3.0-only
 */

import type {
  ApStatus,
  ApUpdate,
  DisplayConfig,
  DisplayUpdate,
  EthernetConfig,
  EthernetConfigUpdate,
  GroundStationApi,
  GroundStationRole,
  MeshGatewayPreferenceUpdate,
  ModemStatus,
  ModemUpdate,
  NetworkStatus,
  OledUpdate,
  PeripheralDetail,
  RoleInfo,
  ScreensUpdate,
  UiConfig,
  WifiScanResult,
} from "@/lib/api/ground-station-api";
import type {
  BluetoothSlice,
  DistributedRxSlice,
  GamepadsSlice,
  GroundStationLinkHealth,
  GroundStationStatus,
  MeshSlice,
  PairSlice,
  PeripheralsSlice,
  PicSlice,
  RoleSlice,
  UplinkSlice,
  WfbConfig,
  WifiScanCache,
} from "./types";

export interface GroundStationState {
  // link slice
  linkHealth: GroundStationLinkHealth;
  wfbConfig: WfbConfig | null;
  status: GroundStationStatus;
  loading: boolean;
  lastError: string | null;
  lastFetchedAt: number | null;

  // pair / network slice
  network: NetworkStatus | null;
  ap: ApStatus | null;
  pair: PairSlice;
  ui: UiConfig | null;

  // peripherals slice (PIC, gamepads, bluetooth, display, peripheral manager)
  pic: PicSlice;
  gamepads: GamepadsSlice;
  bluetooth: BluetoothSlice;
  display: DisplayConfig | null;
  peripherals: PeripheralsSlice;

  // uplink slice (wifi client, modem, priority, ethernet)
  wifiScan: WifiScanCache;
  modem: ModemStatus | null;
  uplink: UplinkSlice;
  ethernetConfig: EthernetConfig | null;

  // mesh slice (role, distributed rx, batman-adv mesh, gateways)
  role: RoleSlice;
  distributedRx: DistributedRxSlice;
  mesh: MeshSlice;

  // link actions
  loadStatus: (
    status: GroundStationStatus,
    linkHealth?: Partial<GroundStationLinkHealth>,
  ) => void;
  loadWfb: (wfb: WfbConfig) => void;
  setWfbConfig: (partial: Partial<WfbConfig>) => void;
  setLoading: (loading: boolean) => void;
  setError: (message: string | null) => void;
  /** Drop the link-health snapshot after a failed poll (see link-store). */
  invalidateLinkHealth: (message: string | null) => void;
  reset: () => void;

  // pair / network actions
  loadNetwork: (api: GroundStationApi) => Promise<void>;
  applyAp: (api: GroundStationApi, update: ApUpdate) => Promise<ApStatus | null>;
  loadUi: (api: GroundStationApi) => Promise<void>;
  applyOled: (api: GroundStationApi, update: OledUpdate) => Promise<UiConfig | null>;
  applyScreens: (
    api: GroundStationApi,
    update: ScreensUpdate,
  ) => Promise<UiConfig | null>;
  startPair: (
    api: GroundStationApi,
    pairKey: string,
    droneId?: string,
  ) => Promise<void>;
  unpair: (api: GroundStationApi) => Promise<void>;
  clearPair: () => void;

  // peripherals actions
  loadPic: (api: GroundStationApi) => Promise<void>;
  claimPic: (
    api: GroundStationApi,
    clientId: string,
    opts?: { confirmToken?: string; force?: boolean },
  ) => Promise<boolean>;
  releasePic: (api: GroundStationApi, clientId: string) => Promise<boolean>;
  pollPicHeartbeat: (api: GroundStationApi, clientId: string) => () => void;
  subscribePicWs: (api: GroundStationApi) => () => void;
  loadGamepads: (api: GroundStationApi) => Promise<void>;
  applyPrimaryGamepad: (
    api: GroundStationApi,
    deviceId: string | null,
  ) => Promise<boolean>;
  scanBluetooth: (api: GroundStationApi, durationS?: number) => Promise<void>;
  pairBluetooth: (api: GroundStationApi, mac: string) => Promise<boolean>;
  forgetBluetooth: (api: GroundStationApi, mac: string) => Promise<boolean>;
  loadPairedBluetooth: (api: GroundStationApi) => Promise<void>;
  loadDisplay: (api: GroundStationApi) => Promise<void>;
  applyDisplay: (
    api: GroundStationApi,
    update: DisplayUpdate,
  ) => Promise<DisplayConfig | null>;
  loadPeripherals: (api: GroundStationApi) => Promise<void>;
  loadPeripheralDetail: (
    api: GroundStationApi,
    id: string,
  ) => Promise<PeripheralDetail | null>;
  configurePeripheral: (
    api: GroundStationApi,
    id: string,
    config: Record<string, unknown>,
  ) => Promise<boolean>;
  invokePeripheralAction: (
    api: GroundStationApi,
    id: string,
    actionId: string,
    body?: Record<string, unknown>,
  ) => Promise<{ queued: boolean; result?: unknown } | null>;

  // uplink actions
  scanWifiNetworks: (
    api: GroundStationApi,
    timeoutS?: number,
  ) => Promise<WifiScanResult[]>;
  joinWifi: (
    api: GroundStationApi,
    ssid: string,
    passphrase?: string,
    force?: boolean,
  ) => Promise<{ joined: boolean; needsForce: boolean; error: string | null }>;
  leaveWifi: (api: GroundStationApi) => Promise<boolean>;
  loadModem: (api: GroundStationApi) => Promise<void>;
  applyModem: (
    api: GroundStationApi,
    update: ModemUpdate,
  ) => Promise<ModemStatus | null>;
  loadPriority: (api: GroundStationApi) => Promise<void>;
  applyPriority: (
    api: GroundStationApi,
    priority: string[],
  ) => Promise<string[] | null>;
  toggleShareUplink: (
    api: GroundStationApi,
    enabled: boolean,
  ) => Promise<boolean | null>;
  subscribeUplinkWs: (api: GroundStationApi) => () => void;
  loadEthernetConfig: (
    api: GroundStationApi,
  ) => Promise<EthernetConfig | null>;
  applyEthernetConfig: (
    api: GroundStationApi,
    update: EthernetConfigUpdate,
  ) => Promise<{
    config: EthernetConfig | null;
    error: string | null;
    backendPending: boolean;
  }>;

  // mesh actions
  loadRole: (api: GroundStationApi) => Promise<void>;
  applyRole: (
    api: GroundStationApi,
    role: GroundStationRole,
  ) => Promise<RoleInfo | null>;
  loadDistributedRx: (api: GroundStationApi) => Promise<void>;
  loadMesh: (api: GroundStationApi) => Promise<void>;
  pinMeshGateway: (
    api: GroundStationApi,
    update: MeshGatewayPreferenceUpdate,
  ) => Promise<boolean>;
  openPairingWindow: (
    api: GroundStationApi,
    duration_s?: number,
  ) => Promise<boolean>;
  closePairingWindow: (api: GroundStationApi) => Promise<boolean>;
  approvePairing: (
    api: GroundStationApi,
    device_id: string,
  ) => Promise<boolean>;
  revokeRelay: (api: GroundStationApi, device_id: string) => Promise<boolean>;
  loadPairingPending: (api: GroundStationApi) => Promise<void>;
  subscribeMeshWs: (api: GroundStationApi) => () => void;

  resetAll: () => void;
}

/**
 * Slice creator signature shared by every ground-station slice file. Each
 * slice receives the full `set`/`get` so cross-slice reads and writes keep
 * their existing semantics.
 */
export type GroundStationSliceCreator<TSlice extends Partial<GroundStationState>> =
  (
    set: (
      partial:
        | Partial<GroundStationState>
        | ((state: GroundStationState) => Partial<GroundStationState>),
    ) => void,
    get: () => GroundStationState,
  ) => TSlice;
