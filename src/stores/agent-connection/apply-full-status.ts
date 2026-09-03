/**
 * @module AgentConnection/apply-full-status
 * @description Fan a consolidated `/api/status/full` response out to every
 * dependent store.
 *
 * Split out of `client-manager.ts`, where it was ~260 lines inline inside the
 * poll closure. It is the payload→store mapping and nothing else: no polling,
 * no scheduling, no retry. The only piece of connection state it needs is
 * `agentUrl`, which several WHEP fields are re-pointed at (the agent bakes its
 * own hostname from the request Host header, which may be an mDNS name the
 * browser's WebRTC layer cannot reach; the host we are polling successfully is
 * proven reachable).
 *
 * Ordering here is load-bearing and is documented at each site. In particular
 * the camera / video-leg / reconciler / CRSF siblings are folded INTO the
 * object handed to `setCapabilities` rather than written afterwards, so one
 * `setState` carries the whole snapshot and no dependent tab sees a
 * null-then-real flicker.
 *
 * @license GPL-3.0-only
 */

import { normaliseSystemResources } from "@/lib/agent/client";
import type {
  AgentStatus,
  FullStatusResponse,
  ServiceInfo,
} from "@/lib/agent/types";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";
import { resolveAgentWhepUrl } from "@/lib/video/rewrite-whep-host";
import { useAgentCapabilitiesStore } from "../agent-capabilities-store";
import { useAgentPeripheralsStore } from "../agent-peripherals-store";
import { useAgentSystemStore } from "../agent-system-store";
import { useVideoStore } from "../video-store";
import { normalizeRadio } from "../agent-capabilities/normalizer";

/**
 * Project the consolidated response's top-level fields onto the canonical
 * {@link AgentStatus} shape.
 *
 * Every optional field is spread-conditionally so an absent key stays absent
 * rather than landing as `undefined` — `AgentStatusCard` distinguishes the two
 * and falls back to `fc_connected` when the gated MAVLink fields are missing.
 */
export function fullStatusToAgentStatus(full: FullStatusResponse): AgentStatus {
  const status = {
    version: full.version,
    uptime_seconds: full.uptime_seconds,
    board: full.board,
    health: full.health,
    fc_connected: full.fc_connected,
    fc_port: full.fc_port,
    fc_baud: full.fc_baud,
    // Gated MAVLink truth + the diagnostic hint so the LAN-direct path
    // renders the same honest FC state and actionable remediation the
    // cloud path does. getFullStatus already normalised the agent's
    // camelCase wire to these snake-case fields at the fetch boundary;
    // spread-undefined keeps absent fields off the object so
    // AgentStatusCard falls back to fc_connected.
    ...(typeof full.transport_open === "boolean" && {
      transport_open: full.transport_open,
    }),
    ...(typeof full.mavlink_alive === "boolean" && {
      mavlink_alive: full.mavlink_alive,
    }),
    ...(typeof full.heartbeat_age_s !== "undefined" && {
      heartbeat_age_s: full.heartbeat_age_s,
    }),
    ...(typeof full.fc_source === "string" && {
      fc_source: full.fc_source,
    }),
    ...(typeof full.fc_link_hint === "string" && {
      fc_link_hint: full.fc_link_hint,
    }),
    // The FC firmware identity the agent derived from the USB
    // descriptor. Carried so the LAN-direct path can (a) pick the MSP
    // adapter for a Betaflight/iNav FC and (b) treat a reachable MSP FC
    // as connectable even though it never emits a MAVLink heartbeat
    // (fc_connected stays false for MSP). Without these the LAN status
    // dropped the variant, so an MSP FC fell back to the MAVLink adapter
    // and never auto-connected.
    ...(typeof full.fc_variant === "string" && {
      fc_variant: full.fc_variant,
    }),
    ...(typeof full.fc_firmware === "string" && {
      fc_firmware: full.fc_firmware,
    }),
  };
  return status as AgentStatus;
}

/**
 * Write a consolidated status response into every dependent store.
 *
 * `agentUrl` is the base URL currently being polled successfully; WHEP URLs are
 * re-pointed at its host.
 */
export function applyFullStatus(
  full: FullStatusResponse,
  agentUrl: string | null,
): void {
  const status = fullStatusToAgentStatus(full);
  useAgentSystemStore.getState().setStatus(status as AgentStatus);
  if (full.services) {
    // Map the consolidated service shape (`state` + camelCase
    // metric fields) into the canonical ServiceInfo the rest
    // of the GCS consumes (`status` + snake_case fields).
    // Defensive on each field so a partial agent response
    // never produces NaN.toFixed() crashes downstream.
    type RawService = {
      name?: unknown;
      state?: unknown;
      pid?: unknown;
      cpu_percent?: unknown;
      cpuPercent?: unknown;
      memory_mb?: unknown;
      memoryMb?: unknown;
      uptime_seconds?: unknown;
      uptimeSeconds?: unknown;
      category?: unknown;
    };
    const mapped: ServiceInfo[] = (full.services as RawService[]).map((s) => ({
      name: typeof s.name === "string" ? s.name : "unknown",
      status: (typeof s.state === "string"
        ? s.state
        : "stopped") as ServiceInfo["status"],
      pid: typeof s.pid === "number" ? s.pid : null,
      cpu_percent:
        typeof s.cpu_percent === "number"
          ? s.cpu_percent
          : typeof s.cpuPercent === "number"
            ? s.cpuPercent
            : 0,
      memory_mb:
        typeof s.memory_mb === "number"
          ? s.memory_mb
          : typeof s.memoryMb === "number"
            ? s.memoryMb
            : 0,
      uptime_seconds:
        typeof s.uptime_seconds === "number"
          ? s.uptime_seconds
          : typeof s.uptimeSeconds === "number"
            ? s.uptimeSeconds
            : 0,
      category:
        typeof s.category === "string"
          ? (s.category as ServiceInfo["category"])
          : undefined,
    }));
    useAgentSystemStore.setState({ services: mapped });
  }
  if (full.resources) {
    // /api/status/full returns ONLY percentages (no
    // memory_used_mb / disk_used_gb / etc.) on current
    // agents. Normalise via the same helper the per-endpoint
    // path uses so consumers always see the full shape with
    // 0-defaulted fields instead of `undefined`.
    useAgentSystemStore.setState({
      resources: normaliseSystemResources(
        full.resources as Record<string, unknown>,
      ),
      lastUpdatedAt: Date.now(),
      stale: false,
    });
  }
  if (full.video && typeof full.video.state === "string") {
    // The agent bakes whep_url from the request Host header (may be
    // an mDNS name the browser's WebRTC layer can't reach) and the
    // drone-profile block omits it entirely while mediamtx readiness
    // is transient. Re-point a supplied URL, or synthesize one, from
    // the host we are already polling successfully (proven reachable)
    // so LAN-direct video connects instead of an empty cascade.
    const whep = resolveAgentWhepUrl(
      full.video.whep_url,
      full.video.state,
      agentUrl,
    );
    useVideoStore
      .getState()
      .setAgentVideoStatus(full.video.state, whep);
  }
  // Populate capabilities from consolidated response or infer from legacy data.
  // FullStatusResponse.capabilities is optional (older agents omit it).
  // Several air-side status fields (camera discovery/recovery, per-leg
  // video streams, the CRSF control lane) are SIBLINGS of `capabilities`
  // in the consolidated status rather than nested inside it, so fold them
  // into the object handed to setCapabilities. Folding them in (rather
  // than a follow-up setState) means setCapabilities' single setState
  // carries them, so each reaches the store atomically with the rest of
  // the snapshot — no null-then-real write that flickers a dependent tab.
  const statusExtras: Record<string, unknown> = {};
  if (typeof full.cameraState !== "undefined") {
    statusExtras.cameraState = full.cameraState;
  }
  if (typeof full.cameraUsbRecovery !== "undefined") {
    statusExtras.cameraUsbRecovery = full.cameraUsbRecovery;
  }
  // Reconciler verdicts the agent folds in beside the camera keys:
  // management-link health, reach-back mode, USB rehome, WiFi
  // power-save. Each has a normalizer clamp and a card already; the
  // agent never produced them on either transport, so all four rendered
  // empty. This pick list is explicit, so an unpicked sibling silently
  // never reaches the store.
  const reconcilerKeys = [
    "managementLink",
    "mgmtLinkMode",
    "mgmtFailoverIface",
    "mgmtFailoverReason",
    "usbRehomeState",
    "usbRehomeAttempts",
    "usbRehomeMaxAttempts",
    "usbRehomeLastResult",
    "wifiPowersave",
    // Per-adapter stable-MAC verdicts. Six readers and three cards
    // consumed this key while no transport produced it.
    "macStability",
  ] as const;
  for (const key of reconcilerKeys) {
    const value = full[key];
    if (typeof value !== "undefined") {
      statusExtras[key] = value;
    }
  }
  // Per-leg video streams: re-point each leg's WHEP host to the one we
  // poll successfully (proven reachable, dodging an unreachable mDNS
  // name), so the cockpit stream switcher connects LAN-direct.
  if (full.video?.streams?.length) {
    statusExtras.videoStreams = full.video.streams
      .map((leg) => ({
        id: leg.id,
        role: leg.role,
        codec: leg.codec,
        live: leg.live,
        whepUrl: resolveAgentWhepUrl(leg.whep, "running", agentUrl),
      }))
      .filter((leg) => leg.id && leg.whepUrl);
  }
  // CRSF / ExpressLRS control-lane snapshot. The agent folds the lane's
  // crsf-stats sidecar into /api/status/full verbatim (raw snake_case),
  // PROFILE-AGNOSTIC — a drone running the ELRS relay lane carries it
  // exactly like a ground station — and omits the key when the lane is
  // down or its sidecar is stale. Folding the raw block in here (rather
  // than the old dedicated ground-station-only fetch that ran AFTER the
  // main set, gated on the ground-station profile) means setCapabilities'
  // single setState resolves crsf atomically: a drone relay now surfaces
  // the lane over the local-first LAN path, and there is no null-then-real
  // window between the capability write and a follow-up crsf fetch. An
  // absent key normalizes to null inside setCapabilities, so a node with
  // no lane clears the field rather than pinning a stale reading (Rule 44).
  if (full.crsf && typeof full.crsf === "object") {
    statusExtras.crsf = full.crsf;
  }
  if (full.capabilities) {
    // Agent has capabilities API; normalize and store (handles shape differences).
    useAgentCapabilitiesStore.getState().setCapabilities({
      ...(full.capabilities as Record<string, unknown>),
      ...statusExtras,
    });
  } else {
    // Agent doesn't have capabilities API; infer from board SoC + peripherals.
    const peripherals = useAgentPeripheralsStore.getState().peripherals;
    const inferred = inferCapabilities(
      status as AgentStatus,
      peripherals,
      undefined,
      full.profile,
    );
    if (inferred) {
      useAgentCapabilitiesStore.getState().setCapabilities({
        ...(inferred as unknown as Record<string, unknown>),
        ...statusExtras,
      });
    } else if (Object.keys(statusExtras).length > 0) {
      useAgentCapabilitiesStore.getState().setCapabilities(statusExtras);
    }
  }
  // Fallback: if capabilities store still has no cameras but we know board SoC,
  // re-infer on every poll to pick up peripherals that loaded after first poll.
  const capState = useAgentCapabilitiesStore.getState();
  if (capState.cameras.length === 0 && (status as AgentStatus)?.board?.soc) {
    const peripherals = useAgentPeripheralsStore.getState().peripherals;
    if (peripherals.length > 0) {
      const inferred = inferCapabilities(
        status as AgentStatus,
        peripherals,
        undefined,
        full.profile,
      );
      if (inferred && inferred.cameras.length > 0) {
        useAgentCapabilitiesStore.getState().setCapabilities(inferred);
      }
    }
  }
  // Radio snapshot over the LAN-direct path. The consolidated
  // status carries the same camelCase radio block the cloud
  // heartbeat does (RSSI/SNR/noise/loss/MCS/FEC + receive-
  // liveness). Shallow-merge only the radio field so this never
  // clobbers profile/cameras set by setCapabilities above.
  if (full.radio && typeof full.radio === "object") {
    useAgentCapabilitiesStore.setState({
      radio: normalizeRadio(full.radio),
    });
  }
  // Native-vs-packaged runtime mode over the LAN-direct path.
  // The consolidated status carries the same aggregate the
  // cloud heartbeat does. Clamp to the known union and merge
  // only this field so it never clobbers the deeper capability
  // shape set above.
  if (
    full.runtimeMode === "native" ||
    full.runtimeMode === "hybrid" ||
    full.runtimeMode === "packaged"
  ) {
    useAgentCapabilitiesStore.setState({
      runtimeMode: full.runtimeMode,
    });
  }
}
