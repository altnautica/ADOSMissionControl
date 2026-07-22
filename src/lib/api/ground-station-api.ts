/**
 * @module GroundStationApi
 * @description Typed REST client for the ADOS Ground Agent HTTP surface.
 * Thin orchestrator that delegates to per-domain modules under './ground-station/'.
 * @license GPL-3.0-only
 */
// Exempt from 300 LOC soft rule: barrel re-export aggregator over per-domain HTTP modules
import type { WfbConfig } from "@/stores/ground-station-store";
import type {
  ApUpdate, DisplayUpdate, EthernetConfigUpdate, GroundStationRole,
  MeshConfigUpdate, MeshEvent, MeshGatewayPreferenceUpdate, ModemUpdate,
  OledUpdate, PairJoinRequest, PicEvent, ScreensUpdate, UplinkEvent,
} from "./ground-station/types";
export type * from "./ground-station/types";
import { GroundStationApiError, type RequestContext } from "./ground-station/request";
import { getStatus } from "./ground-station/status";
import * as wfb from "./ground-station/wfb";
import * as net from "./ground-station/network";
import * as ui from "./ground-station/ui";
import * as p from "./ground-station/peripherals";
import * as pic from "./ground-station/pic";
import * as mesh from "./ground-station/mesh";
import * as atlas from "./ground-station/atlas";

export { GroundStationApiError };
export type { AtlasRelayStatus } from "./ground-station/atlas";

export class GroundStationApi {
  private ctx: RequestContext;
  constructor(baseUrl: string, apiKey?: string | null) {
    this.ctx = { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey: apiKey ?? null };
  }
  getStatus = () => getStatus(this.ctx);
  getWfb = () => wfb.getWfb(this.ctx);
  setWfb = (partial: Partial<WfbConfig>) => wfb.setWfb(this.ctx, partial);
  setTxPower = (dbm: number) => wfb.setTxPower(this.ctx, dbm);
  setFec = (fecK: number, fecN: number) => wfb.setFec(this.ctx, fecK, fecN);
  setMcs = (mcs: number) => wfb.setMcs(this.ctx, mcs);
  setPreset = (preset: wfb.LinkPreset) => wfb.setPreset(this.ctx, preset);
  setAdaptive = (enabled: boolean) => wfb.setAdaptive(this.ctx, enabled);
  pairDrone = (pairKey: string, droneId?: string) => wfb.pairDrone(this.ctx, pairKey, droneId);
  unpairDrone = () => wfb.unpairDrone(this.ctx);
  getWfbRelayStatus = () => wfb.getWfbRelayStatus(this.ctx);
  getWfbReceiverRelays = () => wfb.getWfbReceiverRelays(this.ctx);
  getWfbReceiverCombined = () => wfb.getWfbReceiverCombined(this.ctx);
  getNetwork = () => net.getNetwork(this.ctx);
  setAp = (update: ApUpdate) => net.setAp(this.ctx, update);
  getEthernetConfig = () => net.getEthernetConfig(this.ctx);
  setEthernetConfig = (update: EthernetConfigUpdate) => net.setEthernetConfig(this.ctx, update);
  scanWifiClient = (timeoutS = 10) => net.scanWifiClient(this.ctx, timeoutS);
  joinWifiClient = (ssid: string, passphrase?: string, force?: boolean) => net.joinWifiClient(this.ctx, ssid, passphrase, force);
  leaveWifiClient = () => net.leaveWifiClient(this.ctx);
  getModem = () => net.getModem(this.ctx);
  setModem = (update: ModemUpdate) => net.setModem(this.ctx, update);
  getModemDetail = () => net.getModemDetail(this.ctx);
  getPriority = () => net.getPriority(this.ctx);
  setPriority = (priority: string[]) => net.setPriority(this.ctx, priority);
  setShareUplink = (enabled: boolean) => net.setShareUplink(this.ctx, enabled);
  subscribeUplinkEvents = (onEvent: (e: UplinkEvent) => void) => net.subscribeUplinkEvents(this.ctx, onEvent);
  getUi = () => ui.getUi(this.ctx);
  setOled = (update: OledUpdate) => ui.setOled(this.ctx, update);
  setButtons = (mapping: Record<string, unknown>) => ui.setButtons(this.ctx, mapping);
  setScreens = (update: ScreensUpdate) => ui.setScreens(this.ctx, update);
  factoryReset = (confirmToken: string) => ui.factoryReset(this.ctx, confirmToken);
  getDisplay = () => p.getDisplay(this.ctx);
  setDisplay = (update: DisplayUpdate) => p.setDisplay(this.ctx, update);
  scanBluetooth = (durationS = 10) => p.scanBluetooth(this.ctx, durationS);
  pairBluetooth = (mac: string) => p.pairBluetooth(this.ctx, mac);
  forgetBluetooth = (mac: string) => p.forgetBluetooth(this.ctx, mac);
  getPairedBluetooth = () => p.getPairedBluetooth(this.ctx);
  listGamepads = () => p.listGamepads(this.ctx);
  setPrimaryGamepad = (deviceId: string | null) => p.setPrimaryGamepad(this.ctx, deviceId);
  listPeripherals = () => p.listPeripherals(this.ctx);
  getPeripheral = (id: string) => p.getPeripheral(this.ctx, id);
  configurePeripheral = (id: string, config: Record<string, unknown>) => p.configurePeripheral(this.ctx, id, config);
  invokePeripheralAction = (id: string, actionId: string, body?: Record<string, unknown>) => p.invokePeripheralAction(this.ctx, id, actionId, body);
  getPicState = () => pic.getPicState(this.ctx);
  claimPic = (clientId: string, confirmToken?: string, force?: boolean) => pic.claimPic(this.ctx, clientId, confirmToken, force);
  releasePic = (clientId: string) => pic.releasePic(this.ctx, clientId);
  heartbeatPic = (clientId: string) => pic.heartbeatPic(this.ctx, clientId);
  createPicConfirmToken = (clientId: string) => pic.createPicConfirmToken(this.ctx, clientId);
  subscribePicEvents = (onEvent: (e: PicEvent) => void) => pic.subscribePicEvents(this.ctx, onEvent);
  getRole = () => mesh.getRole(this.ctx);
  setRole = (role: GroundStationRole) => mesh.setRole(this.ctx, role);
  getMeshHealth = () => mesh.getMeshHealth(this.ctx);
  getMeshNeighbors = () => mesh.getMeshNeighbors(this.ctx);
  getMeshRoutes = () => mesh.getMeshRoutes(this.ctx);
  getMeshGateways = () => mesh.getMeshGateways(this.ctx);
  setMeshGatewayPreference = (update: MeshGatewayPreferenceUpdate) => mesh.setMeshGatewayPreference(this.ctx, update);
  getMeshConfig = () => mesh.getMeshConfig(this.ctx);
  setMeshConfig = (update: MeshConfigUpdate) => mesh.setMeshConfig(this.ctx, update);
  openPairingWindow = (duration_s = 60) => mesh.openPairingWindow(this.ctx, duration_s);
  closePairingWindow = () => mesh.closePairingWindow(this.ctx);
  getPairingPending = () => mesh.getPairingPending(this.ctx);
  approvePairing = (device_id: string) => mesh.approvePairing(this.ctx, device_id);
  revokeRelay = (device_id: string) => mesh.revokeRelay(this.ctx, device_id);
  requestJoin = (req: PairJoinRequest = {}) => mesh.requestJoin(this.ctx, req);
  subscribeMeshEvents = (onEvent: (e: MeshEvent) => void, onState?: (state: "connected" | "reconnecting" | "closed") => void) => mesh.subscribeMeshEvents(this.ctx, onEvent, onState);
  getAtlasRelayStatus = () => atlas.getAtlasRelayStatus(this.ctx);
}

/** Build a GroundStationApi client from the current agent connection, if any. */
export function groundStationApiFromAgent(agentUrl: string | null, apiKey: string | null): GroundStationApi | null {
  if (!agentUrl) return null;
  return new GroundStationApi(agentUrl, apiKey);
}
