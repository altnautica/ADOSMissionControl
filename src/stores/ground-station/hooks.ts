/**
 * Narrower selector hooks for the ground-station store. Each hook returns
 * only the fields and actions belonging to one slice so consumers can
 * subscribe to a tighter surface than the full store.
 *
 * @license GPL-3.0-only
 */

import { useGroundStationStore } from "../ground-station-store";
import type { LinkSlice } from "./link-store";
import type { PairSlice } from "./pair-store";
import type { UplinkSlice } from "./uplink-store";
import type { MeshSlice } from "./mesh-store";
import type { PeripheralsSlice } from "./peripherals-store";

export const useLinkSlice = <T,>(selector: (slice: LinkSlice) => T): T =>
  useGroundStationStore((s) =>
    selector({
      linkHealth: s.linkHealth,
      wfbConfig: s.wfbConfig,
      status: s.status,
      loading: s.loading,
      lastError: s.lastError,
      lastFetchedAt: s.lastFetchedAt,
      loadStatus: s.loadStatus,
      loadWfb: s.loadWfb,
      setWfbConfig: s.setWfbConfig,
      setLoading: s.setLoading,
      setError: s.setError,
      invalidateLinkHealth: s.invalidateLinkHealth,
      reset: s.reset,
    }),
  );

export const usePairSlice = <T,>(selector: (slice: PairSlice) => T): T =>
  useGroundStationStore((s) =>
    selector({
      network: s.network,
      ap: s.ap,
      pair: s.pair,
      ui: s.ui,
      loadNetwork: s.loadNetwork,
      applyAp: s.applyAp,
      loadUi: s.loadUi,
      applyOled: s.applyOled,
      applyScreens: s.applyScreens,
      startPair: s.startPair,
      unpair: s.unpair,
      clearPair: s.clearPair,
    }),
  );

export const useUplinkSlice = <T,>(selector: (slice: UplinkSlice) => T): T =>
  useGroundStationStore((s) =>
    selector({
      wifiScan: s.wifiScan,
      modem: s.modem,
      uplink: s.uplink,
      ethernetConfig: s.ethernetConfig,
      scanWifiNetworks: s.scanWifiNetworks,
      joinWifi: s.joinWifi,
      leaveWifi: s.leaveWifi,
      loadModem: s.loadModem,
      applyModem: s.applyModem,
      loadPriority: s.loadPriority,
      applyPriority: s.applyPriority,
      toggleShareUplink: s.toggleShareUplink,
      subscribeUplinkWs: s.subscribeUplinkWs,
      loadEthernetConfig: s.loadEthernetConfig,
      applyEthernetConfig: s.applyEthernetConfig,
    }),
  );

export const useMeshSlice = <T,>(selector: (slice: MeshSlice) => T): T =>
  useGroundStationStore((s) =>
    selector({
      role: s.role,
      distributedRx: s.distributedRx,
      mesh: s.mesh,
      loadRole: s.loadRole,
      applyRole: s.applyRole,
      loadDistributedRx: s.loadDistributedRx,
      loadMesh: s.loadMesh,
      pinMeshGateway: s.pinMeshGateway,
      openPairingWindow: s.openPairingWindow,
      closePairingWindow: s.closePairingWindow,
      approvePairing: s.approvePairing,
      revokeRelay: s.revokeRelay,
      loadPairingPending: s.loadPairingPending,
      subscribeMeshWs: s.subscribeMeshWs,
    }),
  );

export const usePeripheralsSlice = <T,>(
  selector: (slice: PeripheralsSlice) => T,
): T =>
  useGroundStationStore((s) =>
    selector({
      pic: s.pic,
      gamepads: s.gamepads,
      bluetooth: s.bluetooth,
      display: s.display,
      peripherals: s.peripherals,
      loadPic: s.loadPic,
      claimPic: s.claimPic,
      releasePic: s.releasePic,
      pollPicHeartbeat: s.pollPicHeartbeat,
      subscribePicWs: s.subscribePicWs,
      loadGamepads: s.loadGamepads,
      applyPrimaryGamepad: s.applyPrimaryGamepad,
      scanBluetooth: s.scanBluetooth,
      pairBluetooth: s.pairBluetooth,
      forgetBluetooth: s.forgetBluetooth,
      loadPairedBluetooth: s.loadPairedBluetooth,
      loadDisplay: s.loadDisplay,
      applyDisplay: s.applyDisplay,
      loadPeripherals: s.loadPeripherals,
      loadPeripheralDetail: s.loadPeripheralDetail,
      configurePeripheral: s.configurePeripheral,
      invokePeripheralAction: s.invokePeripheralAction,
    }),
  );
