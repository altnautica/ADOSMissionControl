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

export const useLinkSlice = <T,>(selector: (slice: LinkSlice) => T): T =>
  useGroundStationStore((s) =>
    selector({
      linkHealth: s.linkHealth,
      wfbConfig: s.wfbConfig,
      status: s.status,
      loading: s.loading,
      lastError: s.lastError,
      lastFetchedAt: s.lastFetchedAt,
      statusFetchedAt: s.statusFetchedAt,
      linkHealthAt: s.linkHealthAt,
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
      uiFor: s.uiFor,
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
      uplinkFor: s.uplinkFor,
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
