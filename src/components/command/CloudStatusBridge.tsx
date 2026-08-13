"use client";

/**
 * @module CloudStatusBridge
 * @description Bridges Convex cloud drone status into the agent Zustand stores.
 * Mounted when cloudMode is true. Reactively queries cmd_droneStatus and maps
 * to AgentStatus shape that the rest of the UI consumes.
 * Includes heartbeat staleness detection: dims as stale past
 * STALE_THRESHOLD_MS and marks the agent offline past OFFLINE_THRESHOLD_MS.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { unstable_batchedUpdates } from "react-dom";
import { useMutation, useConvexAuth } from "convex/react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import {
  useAgentPluginInventoryStore,
  type AgentPluginInventoryEntry,
} from "@/stores/agent-plugin-inventory-store";
import { useFleetNetworkStore } from "@/stores/fleet-network-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useVideoStore } from "@/stores/video-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useComputeStore } from "@/stores/compute-store";
import { useAtlasStore } from "@/stores/atlas-store";
import { usePluginCloudStateStore } from "@/stores/plugin-cloud-state-store";
import { cmdDroneStatusApi, cmdDroneCommandsApi } from "@/lib/community-api-drones";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { STALE_THRESHOLD_MS, OFFLINE_THRESHOLD_MS } from "@/lib/agent/freshness";
import { describeMissingCloudStatus } from "@/lib/agent/cloud-status-diagnosis";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";
import type {
  MeshNetEnrollment,
  NetworkPeer,
  PeripheralInfo,
} from "@/lib/agent/types";
import {
  buildAtlasPatch,
  buildComputePatch,
  buildGroundStationPatch,
  buildHeartbeatExtras,
  buildSystemUpdate,
  mapCloudStatus,
  resolveMavlinkUrl,
  resolveVideoUrls,
  resolveVideoStreams,
} from "./bridges/status-mapper";

const STALE_CHECK_INTERVAL_MS = 5_000; // Check every 5s so the 1Hz UI label stays close to reality

export function CloudStatusBridge() {
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const setCloudStatus = useAgentConnectionStore((s) => s.setCloudStatus);
  const convexAvailable = useConvexAvailable();
  const initialLoadDone = useRef(false);

  const cloudStatus = useConvexSkipQuery(cmdDroneStatusApi.getCloudStatus, {
    args: { deviceId: cloudDeviceId! },
    enabled: !!cloudDeviceId,
  });

  const { isAuthenticated } = useConvexAuth();
  const enqueueCommand = useMutation(cmdDroneCommandsApi.enqueueCommand);

  // Reset the single-slice focused-node stores on a device switch. Their
  // mappers only write when the new device's heartbeat carries their fields
  // (a non-compute / non-capturing node sends none), so without this the
  // previous device's compute cluster / Atlas capture stats would bleed under
  // the newly-focused node. The next matching heartbeat repopulates the slice.
  useEffect(() => {
    useAtlasStore.getState().clear();
    useComputeStore.getState().clear();
  }, [cloudDeviceId]);

  // Heartbeat monitoring: initial timeout (15s) + staleness detection (10s interval)
  useEffect(() => {
    if (!cloudDeviceId || !convexAvailable) return;

    // Surface the reason if no cloud status has arrived within 15s. Silence on
    // the relay has several causes and only one of them is an offline agent: a
    // LAN-only node publishes nothing to the relay by design, and an agent with
    // its relay switched off never will either. Naming the wrong one sends the
    // operator to check power on a node that was never expected to report here.
    const timer = setTimeout(() => {
      const current = useAgentConnectionStore.getState();
      if (current.cloudMode && !useAgentSystemStore.getState().status) {
        useAgentConnectionStore.setState({
          connectionError: describeMissingCloudStatus(cloudDeviceId),
        });
      }
    }, 15000);

    // Ongoing staleness check: two thresholds.
    //   > STALE_THRESHOLD_MS  (45s) → mark system store stale, dim the UI,
    //                                 keep last-known data visible.
    //   > OFFLINE_THRESHOLD_MS (60s) → mark connection offline, clear MAVLink
    //                                  URL so dependent UIs stop trying.
    const tick = () => {
      const state = useAgentConnectionStore.getState();
      if (!state.cloudMode || !state.lastCloudUpdate) return;

      const elapsed = Date.now() - state.lastCloudUpdate;

      if (elapsed > STALE_THRESHOLD_MS) {
        const sys = useAgentSystemStore.getState();
        const patch: Record<string, unknown> = {};
        if (!sys.stale) patch.stale = true;
        // Keep the freshness clock in sync with the watchdog. If the user
        // hit Reconnect (which clears lastUpdatedAt to null) and no heartbeat
        // arrived before the grace period elapsed, seed lastUpdatedAt from
        // lastCloudUpdate so useFreshness() starts reporting the correct
        // stale/offline state instead of staying stuck at "unknown".
        if (sys.lastUpdatedAt == null && state.lastCloudUpdate != null) {
          patch.lastUpdatedAt = state.lastCloudUpdate;
        }
        if (Object.keys(patch).length > 0) {
          useAgentSystemStore.setState(patch);
        }
      }

      if (elapsed > OFFLINE_THRESHOLD_MS) {
        const seconds = Math.round(elapsed / 1000);
        const patch: Record<string, unknown> = {
          connectionError: `Agent offline (last seen ${seconds}s ago)`,
        };
        if (state.connected) patch.connected = false;
        if (state.mavlinkUrl) patch.mavlinkUrl = null;
        useAgentConnectionStore.setState(patch);
      }
    };

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, STALE_CHECK_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        tick();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(timer);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cloudDeviceId, convexAvailable]);

  // Map Convex status to AgentStatus
  useEffect(() => {
    if (!cloudStatus) return;

    const cloudRecord = cloudStatus as Record<string, unknown>;
    const mapped = mapCloudStatus(cloudRecord);

    // One heartbeat fans out across the connection, system, peripherals,
    // fleet-network, ground-station, video and capabilities stores. Each Zustand
    // setState notifies its own subscribers synchronously, so without an
    // explicit batch a component reading two of these stores can render an
    // intermediate mix (new health, stale whepUrl). Coalesce every store
    // write below into a single flush so subscribers see one consistent
    // snapshot per heartbeat.
    unstable_batchedUpdates(() => {

    // Check if the data from Convex is actually fresh by comparing the
    // agent's last heartbeat timestamp against staleness thresholds.
    // The Convex reactive query returns the stored row regardless of age,
    // so we must check the data's own timestamp, not treat every query
    // response as proof the agent is alive.
    const dataAge = Date.now() - (cloudRecord.updatedAt as number);
    const isDataFresh = dataAge < STALE_THRESHOLD_MS;
    const isDataOffline = dataAge >= OFFLINE_THRESHOLD_MS;

    if (isDataFresh) {
      // Agent heartbeat is genuinely recent
      useAgentConnectionStore.setState({
        connected: true,
        connectionError: null,
      });
    } else if (isDataOffline) {
      // Data is older than the offline threshold
      const seconds = Math.round(dataAge / 1000);
      const label = seconds < 60
        ? `${seconds}s`
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m`
          : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
      useAgentConnectionStore.setState({
        connected: false,
        connectionError: `Agent offline (last heartbeat ${label} ago)`,
        mavlinkUrl: null,
      });
    }

    setCloudStatus(mapped, cloudRecord.updatedAt as number);

    // Single atomic update to system store — avoids multiple setState calls
    // that can cause React batching issues with stale intermediate states
    const systemUpdate = buildSystemUpdate(mapped, cloudRecord, isDataFresh);
    useAgentSystemStore.setState(systemUpdate as unknown as Record<string, unknown>);

    // Map extended status fields to their respective stores
    const peripherals = cloudRecord.peripherals;
    if (Array.isArray(peripherals)) {
      useAgentPeripheralsStore.setState({
        peripherals: peripherals as PeripheralInfo[],
      });
    }
    const peers = cloudRecord.peers;
    if (Array.isArray(peers)) {
      useFleetNetworkStore.setState({ peers: peers as NetworkPeer[] });
    }
    const enrollment = cloudRecord.enrollment;
    if (enrollment && typeof enrollment === "object") {
      useFleetNetworkStore.setState({ enrollment: enrollment as MeshNetEnrollment });
    }
    // Webapp-side plugin installs reported by the agent. Convex's
    // cmdPlugins:listForDevice stays authoritative; the inventory
    // store fills in installs the operator made directly from the
    // agent's local dashboard at port 8080.
    const inventory = cloudRecord.pluginInventory;
    if (Array.isArray(inventory) && cloudDeviceId) {
      useAgentPluginInventoryStore.getState().setForDevice(
        cloudDeviceId,
        inventory as AgentPluginInventoryEntry[],
      );
    }

    // Ground-station fan-out. Only writes when the corresponding heartbeat
    // field is present — LAN polls keep their authority on every other field.
    const gsState = useGroundStationStore.getState();
    const gsPatch = buildGroundStationPatch(cloudRecord, {
      linkHealth: gsState.linkHealth,
      status: gsState.status,
      role: gsState.role,
      uplink: gsState.uplink,
      peripherals: gsState.peripherals,
    });
    if (gsPatch) {
      useGroundStationStore.setState(gsPatch);
    }

    // Compute fan-out. Mirrors the ground-station fan-out: writes only when the
    // heartbeat carries compute fields, so a future LAN poll keeps authority on
    // every other field. Absent on a drone / ground-station heartbeat.
    const computeState = useComputeStore.getState();
    const computePatch = buildComputePatch(
      cloudRecord,
      { cluster: computeState.cluster },
      (cloudRecord.updatedAt as number) ?? 0,
    );
    if (computePatch) {
      useComputeStore.getState().setCluster(computePatch.cluster);
    }

    // Generic plugin-state fan-out: ferry each plugin's opaque slice
    // (pluginState[pluginId]) to the per-plugin cloud store, so ANY plugin's GCS
    // half reads its own cloud telemetry without a per-plugin core column.
    const pluginState = cloudRecord.pluginState;
    if (
      cloudDeviceId &&
      typeof pluginState === "object" &&
      pluginState !== null &&
      !Array.isArray(pluginState)
    ) {
      usePluginCloudStateStore
        .getState()
        .setForDevice(
          cloudDeviceId,
          pluginState as Record<string, Record<string, unknown>>,
        );
    }

    // Atlas fan-out (the Atlas plugin reads its own pluginState.atlas slice).
    // Writes only when the heartbeat carries the atlas slice, so a non-capturing
    // drone's heartbeat leaves the live state untouched.
    const atlasState = useAtlasStore.getState();
    const atlasPatch = buildAtlasPatch(
      cloudRecord,
      { live: atlasState.live },
      (cloudRecord.updatedAt as number) ?? 0,
    );
    if (atlasPatch) {
      useAtlasStore.getState().setLive(atlasPatch.live);
    }

    // Map video status from cloud heartbeat to video store
    // LAN fallback: when the agent's cloud heartbeat lags (or is broken
    // outright) the Convex row may not yet carry videoWhepUrl/lastIp. If
    // the cached pair record has an mDNS host (browser-local for LAN-only
    // pairings, Convex-mediated when signed in), we can still synthesize
    // a WHEP URL the cascade can attempt on the LAN. Prefers the
    // Convex-published URL when present (lets future out-of-LAN setups
    // still work).
    //
    // Gated on HTTP origin: on HTTPS the browser blocks plain-HTTP
    // fetches to a private LAN host (mixed content) so the synthesized
    // URLs would just produce confusing "Failed to fetch" errors. The
    // cascade prefers p2p-mqtt on HTTPS anyway, so skipping the LAN
    // synthesis is the right behaviour for HTTPS-served GCS pages.
    const allowLanSynthesis =
      typeof window === "undefined" ||
      window.location.protocol !== "https:";
    const localNode = allowLanSynthesis
      ? useLocalNodesStore
          .getState()
          .nodes.find((n) => n.deviceId === cloudDeviceId)
      : null;
    const pairedDrone = allowLanSynthesis
      ? usePairingStore
          .getState()
          .pairedDrones.find((d) => d.deviceId === cloudDeviceId)
      : null;
    const lastIp = cloudRecord.lastIp as string | undefined;
    // Prefer the agent's IPv4 over its `.local` mDNS name. Resolving a `.local`
    // host in the browser does IPv6/AAAA first and hangs ~5s when the box has
    // no usable IPv6, which blows the video-transport + MAVLink-WS connect
    // timeouts ("All transports failed"). The IPv4 connects instantly. mDNS is
    // kept only as a last resort for the rare case no IPv4 was captured.
    const lanHost =
      localNode?.ipv4 ||
      pairedDrone?.lastIp ||
      lastIp ||
      localNode?.mdnsHost ||
      pairedDrone?.mdnsHost ||
      null;

    const { state: videoState, whepUrl } = resolveVideoUrls(cloudRecord, lanHost);
    // Per-leg video streams (host-resolved) for the cockpit stream switcher.
    const videoStreams = resolveVideoStreams(cloudRecord, lanHost);
    if (videoState) {
      useVideoStore.getState().setAgentVideoStatus(videoState, whepUrl);
    } else if (lanHost) {
      // Convex doesn't yet know the video state (heartbeat hasn't landed,
      // or the field is missing). Assume "running" so the cascade has a
      // URL to attempt; if the agent rejects the WHEP POST the cascade
      // surfaces a normal failure and falls through to the next mode.
      useVideoStore
        .getState()
        .setAgentVideoStatus("running", `http://${lanHost}:8889/main/whep`);
    }

    // MAVLink WebSocket URL from agent heartbeat. The cascade dials this raw
    // proxy URL for any profile and attaches a ticket when a pairing key is
    // held, so there is no separate authenticated endpoint to resolve.
    const { url: mavlinkUrl } = resolveMavlinkUrl(cloudRecord, lanHost);
    if (mavlinkUrl) {
      useAgentConnectionStore.getState().setMavlinkUrl(mavlinkUrl);
    }

    // Infer capabilities from cloud status (board SoC → NPU, peripherals → cameras).
    const capState = useAgentCapabilitiesStore.getState();
    const extras = buildHeartbeatExtras(cloudRecord);

    if (!capState.loaded || capState.cameras.length === 0) {
      const periphList = useAgentPeripheralsStore.getState().peripherals;
      const inferred = inferCapabilities(
        mapped,
        periphList,
        extras.inferOverrides,
        extras.profile,
      );
      if (inferred) {
        const payload: Record<string, unknown> = {
          ...inferred,
          videoRestartAttempts: extras.videoRestartAttempts,
          pairingCodeExpiresAt: extras.pairingCodeExpiresAt,
          mavlinkWsUrlPrev: extras.mavlinkWsUrlPrev,
          wfbFailoverState: extras.wfbFailoverState,
          manualConnectionUrls: extras.manualConnectionUrls,
          cloudRelayUrl: extras.cloudRelayUrl,
          cloudflareUrl: extras.cloudflareUrl,
        };
        if (extras.setupState !== undefined) payload.setupState = extras.setupState;
        if (extras.profileSource !== undefined) payload.profileSource = extras.profileSource;
        if (extras.profile !== undefined) payload.profile = extras.profile;
        if (extras.role !== undefined) payload.role = extras.role;
        if (extras.runtimeMode !== undefined) payload.runtimeMode = extras.runtimeMode;
        if (extras.radioStackState !== undefined)
          payload.radioStackState = extras.radioStackState;
        if (extras.macStability !== undefined)
          payload.macStability = extras.macStability;
        if (extras.managementLink !== undefined)
          payload.managementLink = extras.managementLink;
        if (extras.wifiPowersave !== undefined)
          payload.wifiPowersave = extras.wifiPowersave;
        if (extras.mgmtLinkMode !== undefined) {
          payload.mgmtLinkMode = extras.mgmtLinkMode;
          payload.mgmtFailoverIface = extras.mgmtFailoverIface;
          payload.mgmtFailoverReason = extras.mgmtFailoverReason;
        }
        if (extras.usbRehomeState !== undefined) {
          payload.usbRehomeState = extras.usbRehomeState;
          payload.usbRehomeAttempts = extras.usbRehomeAttempts;
          payload.usbRehomeLastResult = extras.usbRehomeLastResult;
        }
        if (extras.radioRaw !== undefined) payload.radio = extras.radioRaw;
        if (extras.crsfRaw !== undefined) payload.crsf = extras.crsfRaw;
        payload.peerDeviceId = extras.peerDeviceId;
        payload.peerRole = extras.peerRole;
        payload.peerChannel = extras.peerChannel;
        payload.peerRssiDbm = extras.peerRssiDbm;
        payload.peerSeenAtUnix = extras.peerSeenAtUnix;
        payload.cameraState = extras.cameraState;
        if (extras.cameraUsbRecovery !== undefined)
          payload.cameraUsbRecovery = extras.cameraUsbRecovery;
        payload.videoStreams = videoStreams;
        if (extras.canBuses !== undefined) payload.canBuses = extras.canBuses;
        // Perception tier + offload target from the heartbeat (the normalizer
        // clamps the tier; null target = runs locally, undefined = keep prior).
        payload.perceptionTier = extras.perceptionTier;
        payload.perceptionOffloadTarget = extras.perceptionOffloadTarget;
        useAgentCapabilitiesStore.getState().setCapabilities(payload);
      }
    } else {
      // Capabilities are already loaded but several heartbeat-derived
      // fields change every tick: the radio block (TX power, RSSI,
      // FEC counters), the LCD live state (active page, last touch,
      // snapshot URL), and the local video tap (decoder fps,
      // recording flag). Re-merge the heartbeat-derived view of
      // those fields into the existing capability snapshot so the
      // normalizer fires without losing the deeper fields the agent
      // doesn't repeat every tick (cameras, compute, models).
      const periphList = useAgentPeripheralsStore.getState().peripherals;
      const reInferred = inferCapabilities(
        mapped,
        periphList,
        extras.inferOverrides,
        extras.profile,
      );
      const reInferredDisplay = reInferred?.display;
      const mergedDisplay = reInferredDisplay ?? capState.display;
      // Profile is exempt from the forward-permissive merge other fields
      // use. A profile is part of the node's identity, not a noisy live
      // metric: whenever the heartbeat carries the field at all we honor it
      // verbatim so a post-reboot profile change flips the tab tree on the
      // very next tick instead of being masked for a cycle by the cached
      // value. Only a heartbeat that omits the field entirely falls back to
      // what the store already had (so a sparse delta tick doesn't blank it).
      const profilePresent =
        Object.prototype.hasOwnProperty.call(cloudRecord, "profile");
      const reMergedProfile = profilePresent
        ? extras.profile
        : capState.profile;
      const rolePresent =
        Object.prototype.hasOwnProperty.call(cloudRecord, "role");
      const reMergedRole = rolePresent ? extras.role : capState.role;
      const reMergedRuntimeMode =
        extras.runtimeMode !== undefined
          ? extras.runtimeMode
          : capState.runtimeMode;
      const reMergedRadioStackState =
        extras.radioStackState !== undefined
          ? extras.radioStackState
          : capState.radioStackState;
      const reMergedMacStability =
        extras.macStability !== undefined
          ? extras.macStability
          : capState.macStability;
      const reMergedManagementLink =
        extras.managementLink !== undefined
          ? extras.managementLink
          : capState.managementLink;
      const reMergedWifiPowersave =
        extras.wifiPowersave !== undefined
          ? extras.wifiPowersave
          : capState.wifiPowersave;
      // The reach-back trio updates as a unit when the agent reports the mode;
      // a tick that omits it (stale sidecar) keeps the prior state.
      const reMergedMgmtLinkMode =
        extras.mgmtLinkMode !== undefined
          ? extras.mgmtLinkMode
          : capState.mgmtLinkMode;
      const reMergedMgmtFailoverIface =
        extras.mgmtLinkMode !== undefined
          ? extras.mgmtFailoverIface
          : capState.mgmtFailoverIface;
      const reMergedMgmtFailoverReason =
        extras.mgmtLinkMode !== undefined
          ? extras.mgmtFailoverReason
          : capState.mgmtFailoverReason;
      // The rehome trio updates as a unit when the agent reports the state.
      const reMergedUsbRehomeState =
        extras.usbRehomeState !== undefined
          ? extras.usbRehomeState
          : capState.usbRehomeState;
      const reMergedUsbRehomeAttempts =
        extras.usbRehomeState !== undefined
          ? extras.usbRehomeAttempts
          : capState.usbRehomeAttempts;
      const reMergedUsbRehomeLastResult =
        extras.usbRehomeState !== undefined
          ? extras.usbRehomeLastResult
          : capState.usbRehomeLastResult;
      useAgentCapabilitiesStore.getState().setCapabilities({
        tier: capState.tier,
        cameras: capState.cameras,
        // Latest heartbeat wins for the per-leg streams; a sparse tick that
        // resolves no legs keeps the prior set so the switcher doesn't flicker.
        videoStreams: videoStreams.length > 0 ? videoStreams : capState.videoStreams,
        compute: capState.compute,
        vision: capState.vision,
        models: capState.models,
        setupState: capState.setupState,
        profileSource: capState.profileSource,
        profile: reMergedProfile,
        role: reMergedRole,
        runtimeMode: reMergedRuntimeMode,
        radioStackState: reMergedRadioStackState,
        macStability: reMergedMacStability,
        managementLink: reMergedManagementLink,
        wifiPowersave: reMergedWifiPowersave,
        mgmtLinkMode: reMergedMgmtLinkMode,
        mgmtFailoverIface: reMergedMgmtFailoverIface,
        mgmtFailoverReason: reMergedMgmtFailoverReason,
        usbRehomeState: reMergedUsbRehomeState,
        usbRehomeAttempts: reMergedUsbRehomeAttempts,
        usbRehomeLastResult: reMergedUsbRehomeLastResult,
        display: mergedDisplay,
        // Effective primary local-display path. Latest heartbeat wins;
        // a sparse tick falls back to whatever the store already had so
        // the picker doesn't flicker to "Auto-detecting…" on every
        // heartbeat that omits the field.
        displayType: reInferred?.displayType ?? capState.displayType,
        videoLocalTap: reInferred?.videoLocalTap ?? capState.videoLocalTap,
        videoRecording: reInferred?.videoRecording ?? capState.videoRecording,
        uiTheme: reInferred?.uiTheme ?? capState.uiTheme,
        // Latest heartbeat wins for the air-side pipeline identity; if
        // the current tick omits it, fall back to whatever the store
        // already had so a sparse heartbeat doesn't blank the pill.
        // Latest heartbeat wins for the navigation block; sparse
        // heartbeats keep the prior value so flow / VIO indicators
        // don't flicker.
        navigation: reInferred?.navigation ?? capState.navigation,
        // Vision availability + live-detection summary. Latest
        // heartbeat wins; a sparse tick that omits the surface keeps
        // the prior value so the Vision tab and overlay don't flicker.
        visionAvailable: reInferred?.visionAvailable ?? capState.visionAvailable,
        visionSummary: reInferred?.visionSummary ?? capState.visionSummary,
        videoRestartAttempts: extras.videoRestartAttempts,
        pairingCodeExpiresAt: extras.pairingCodeExpiresAt,
        mavlinkWsUrlPrev: extras.mavlinkWsUrlPrev,
        wfbFailoverState: extras.wfbFailoverState,
        manualConnectionUrls: extras.manualConnectionUrls,
        cloudRelayUrl: extras.cloudRelayUrl,
        cloudflareUrl: extras.cloudflareUrl,
        peerDeviceId: extras.peerDeviceId,
        peerRole: extras.peerRole,
        peerChannel: extras.peerChannel,
        peerRssiDbm: extras.peerRssiDbm,
        peerSeenAtUnix: extras.peerSeenAtUnix,
        cameraState: extras.cameraState,
        // Forward-permissive: undefined keeps whatever the store had so a
        // sparse tick that omits the recovery block doesn't blank it.
        cameraUsbRecovery: extras.cameraUsbRecovery,
        // Forward-permissive: undefined keeps whatever the store had,
        // matching the agent's "warmup window" semantics. Once the
        // FC param cache populates, every tick carries the latest
        // CAN bus snapshot.
        canBuses: extras.canBuses,
        // Perception tier + offload target: latest heartbeat wins; a tick that
        // omits them keeps the prior value (undefined) so the chip / tier card
        // don't flicker to "unknown" on a sparse tick.
        perceptionTier: extras.perceptionTier,
        perceptionOffloadTarget: extras.perceptionOffloadTarget,
        ...(extras.radioRaw !== undefined ? { radio: extras.radioRaw } : {}),
        ...(extras.crsfRaw !== undefined ? { crsf: extras.crsfRaw } : {}),
      } as Record<string, unknown>);
      }
    });

    initialLoadDone.current = true;
  }, [cloudStatus, cloudDeviceId, setCloudStatus]);

  // Listen for cloud command events from the store
  useEffect(() => {
    if (!convexAvailable || !cloudDeviceId || !isAuthenticated) return;

    function handleCloudCommand(e: Event) {
      const detail = (e as CustomEvent).detail;
      enqueueCommand({
        deviceId: detail.deviceId,
        command: detail.command,
        args: detail.args,
      }).catch((err) => {
        console.warn("Cloud command enqueue failed:", err);
      });
    }

    window.addEventListener("cloud-command", handleCloudCommand);
    return () => window.removeEventListener("cloud-command", handleCloudCommand);
  }, [enqueueCommand, cloudDeviceId, convexAvailable, isAuthenticated]);

  return null; // Pure bridge, no UI
}
