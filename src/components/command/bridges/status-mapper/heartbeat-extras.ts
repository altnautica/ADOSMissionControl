/**
 * @module command/bridges/status-mapper/heartbeat-extras
 * @description Pulls every heartbeat-derived extra field out of the
 * Convex row into a forward-permissive shape the capability store can
 * merge. Each field is coerced/clamped here; the store keeps the prior
 * value on a sparse tick that omits a field. Pure.
 * @license GPL-3.0-only
 */

import type { CameraUsbRecovery } from "@/lib/agent/types";
import { normalizeCameraUsbRecovery } from "@/lib/agent/camera-recovery";
import type { AgentCapabilities } from "@/lib/agent/feature-types";
import type { inferCapabilities } from "@/lib/agent/infer-capabilities";

export interface HeartbeatExtras {
  videoRestartAttempts: number;
  pairingCodeExpiresAt: number | null;
  mavlinkWsUrlPrev: string | null;
  wfbFailoverState: "local" | "cloud_relay" | "failed";
  manualConnectionUrls:
    | {
        mavlinkTcp: string | null;
        mavlinkWs: string | null;
        videoViewer: string | null;
        videoWhep: string | null;
      }
    | null;
  cloudRelayUrl: string | null;
  cloudflareUrl: string | null;
  inferOverrides: Parameters<typeof inferCapabilities>[2];
  radioRaw: unknown;
  /** Raw CRSF/ExpressLRS control-lane block off the Convex row (camelCase,
   * already remapped by the cloud HTTP action). The capability-store
   * normalizer folds it onto CrsfState; undefined when the heartbeat omits it
   * (the lane is down or its sidecar is stale) so the store clears the field. */
  crsfRaw: unknown;
  setupState: string | undefined;
  profileSource: string | undefined;
  profile: string | undefined;
  role: string | null | undefined;
  runtimeMode: string | undefined;
  radioStackState: string | undefined;
  macStability: AgentCapabilities["macStability"];
  managementLink: AgentCapabilities["managementLink"];
  wifiPowersave: AgentCapabilities["wifiPowersave"];
  mgmtLinkMode: string | undefined;
  mgmtFailoverIface: string | null;
  mgmtFailoverReason: string | null;
  usbRehomeState: string | undefined;
  usbRehomeAttempts: number | null;
  usbRehomeLastResult: string | null;
  peerDeviceId: string | null;
  peerRole: string | null;
  peerChannel: number | null;
  peerRssiDbm: number | null;
  peerSeenAtUnix: number | null;
  cameraState: string | null;
  cameraUsbRecovery: CameraUsbRecovery | undefined;
  canBuses: AgentCapabilities["canBuses"];
  /** Resolved perception execution tier (raw string; the capability-store
   * normalizer clamps it to the known union, else undefined). Forwarded from
   * the heartbeat so a cloud-connected drone's tier surfaces (was previously
   * dropped, so the Perception hub + cockpit read "unknown" over cloud). */
  perceptionTier: string | undefined;
  /** The workstation the drone offloads perception to (host / device id), null
   * when it runs locally, undefined when the heartbeat omits the field. */
  perceptionOffloadTarget: string | null | undefined;
}

const FAILOVER_STATES = ["local", "cloud_relay", "failed"] as const;

const pickStringOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/**
 * Pull every heartbeat-derived extra field out of the Convex row.
 * Returned shape is forward-permissive: the bridge can hand each
 * field to the capability store and rely on the store's own merge to
 * preserve the prior value when a tick omits a field.
 */
export function buildHeartbeatExtras(
  cloudStatus: Record<string, unknown>,
): HeartbeatExtras {
  const videoRestart = cloudStatus.videoRestartAttempts;
  const videoRestartAttempts =
    typeof videoRestart === "number" &&
    Number.isFinite(videoRestart) &&
    videoRestart >= 0
      ? Math.floor(videoRestart)
      : 0;
  const pairingCodeExpiresAtRaw = cloudStatus.pairingCodeExpiresAt;
  const pairingCodeExpiresAt =
    typeof pairingCodeExpiresAtRaw === "number" &&
    Number.isFinite(pairingCodeExpiresAtRaw) &&
    pairingCodeExpiresAtRaw > 0
      ? pairingCodeExpiresAtRaw
      : null;
  const mavlinkWsUrlPrevRaw = cloudStatus.mavlinkWsUrlPrev;
  const mavlinkWsUrlPrev =
    typeof mavlinkWsUrlPrevRaw === "string" && mavlinkWsUrlPrevRaw.length > 0
      ? mavlinkWsUrlPrevRaw
      : null;
  const wfbFailoverRaw = cloudStatus.wfbFailoverState as string | undefined;
  const wfbFailoverState: "local" | "cloud_relay" | "failed" = (
    FAILOVER_STATES as readonly string[]
  ).includes(wfbFailoverRaw ?? "")
    ? (wfbFailoverRaw as "local" | "cloud_relay" | "failed")
    : "local";

  const rawManual = cloudStatus.manualConnectionUrls;
  const manualConnectionUrls =
    rawManual && typeof rawManual === "object"
      ? {
          mavlinkTcp: pickStringOrNull(
            (rawManual as Record<string, unknown>).mavlinkTcp,
          ),
          mavlinkWs: pickStringOrNull(
            (rawManual as Record<string, unknown>).mavlinkWs,
          ),
          videoViewer: pickStringOrNull(
            (rawManual as Record<string, unknown>).videoViewer,
          ),
          videoWhep: pickStringOrNull(
            (rawManual as Record<string, unknown>).videoWhep,
          ),
        }
      : null;

  // Local-display + UI-theme + navigation overrides the agent forwards on
  // the cloud heartbeat. The LCD/HDMI display-pipeline, local-decoder,
  // video-recording, display-type, and vision-summary fields are NOT on the
  // cloud wire — no agent path emits them today — so they are not read here
  // (forwarding always-undefined fields makes the contract lie). They return
  // through the store's merge as a sparse tick when a producer eventually
  // ships them on the wire.
  const inferOverrides: Parameters<typeof inferCapabilities>[2] = {
    lcdTouchCalibrated: cloudStatus.lcdTouchCalibrated as
      | boolean
      | null
      | undefined,
    lcdSnapshotUrl: cloudStatus.lcdSnapshotUrl as string | null | undefined,
    lcdLastTouchAt: cloudStatus.lcdLastTouchAt as number | null | undefined,
    lcdLastGesture: cloudStatus.lcdLastGesture as string | null | undefined,
    uiTheme: cloudStatus.uiTheme as string | null | undefined,
    navigation: cloudStatus.navigation,
  };

  const setupState =
    typeof cloudStatus.setupState === "string"
      ? cloudStatus.setupState
      : undefined;
  const profileSource =
    typeof cloudStatus.profileSource === "string"
      ? cloudStatus.profileSource
      : undefined;
  const profile =
    typeof cloudStatus.profile === "string"
      ? cloudStatus.profile
      : undefined;
  const role =
    typeof cloudStatus.role === "string"
      ? cloudStatus.role
      : cloudStatus.role === null
        ? null
        : undefined;
  // Forward the raw runtime-mode string verbatim; the capability-store
  // normalizer clamps it to the known union (else undefined), so a
  // future variant or an absent field both round-trip cleanly.
  const runtimeMode =
    typeof cloudStatus.runtimeMode === "string"
      ? cloudStatus.runtimeMode
      : undefined;
  // Forward the raw radio-stack health string verbatim; the
  // capability-store normalizer clamps it to the known union (else
  // undefined), so a future variant or an absent field both round-trip
  // cleanly.
  const radioStackState =
    typeof cloudStatus.radioStackState === "string"
      ? cloudStatus.radioStackState
      : undefined;
  // Stable-MAC pin verdicts (an object {version, adapters:[...]}). Forwarded
  // when the agent sends a well-formed object; the store keeps the prior value
  // on a sparse tick that omits it.
  const macRaw = cloudStatus.macStability;
  const macStability: AgentCapabilities["macStability"] =
    typeof macRaw === "object" &&
    macRaw !== null &&
    Array.isArray((macRaw as { adapters?: unknown }).adapters)
      ? (macRaw as AgentCapabilities["macStability"])
      : undefined;
  // Management-link health (an object {state, ...}). Forwarded when the agent
  // sends an object with a string state; the normalizer clamps the state to the
  // known set and the store keeps the prior value on a sparse tick.
  const mgmtRaw = cloudStatus.managementLink;
  const managementLink: AgentCapabilities["managementLink"] =
    typeof mgmtRaw === "object" &&
    mgmtRaw !== null &&
    typeof (mgmtRaw as { state?: unknown }).state === "string"
      ? (mgmtRaw as AgentCapabilities["managementLink"])
      : undefined;
  // WiFi power-save reconciler verdicts (an object {interfaces:[...]}). Forwarded
  // when the agent sends a well-formed object with an interfaces array; the store
  // keeps the prior value on a sparse tick that omits it.
  const wpRaw = cloudStatus.wifiPowersave;
  const wifiPowersave: AgentCapabilities["wifiPowersave"] =
    typeof wpRaw === "object" &&
    wpRaw !== null &&
    Array.isArray((wpRaw as { interfaces?: unknown }).interfaces)
      ? (wpRaw as AgentCapabilities["wifiPowersave"])
      : undefined;
  // Management-link reach-back mode (clamped to the known set in the
  // normalizer); the failover interface + reason are plain nullable strings.
  const mgmtLinkMode =
    typeof cloudStatus.mgmtLinkMode === "string"
      ? cloudStatus.mgmtLinkMode
      : undefined;
  // USB-rehome state (clamped to the known set in the normalizer); the attempt
  // count + last result are a plain number / nullable string.
  const usbRehomeState =
    typeof cloudStatus.usbRehomeState === "string"
      ? cloudStatus.usbRehomeState
      : undefined;
  const usbRehomeAttemptsRaw = cloudStatus.usbRehomeAttempts;
  const usbRehomeAttempts =
    typeof usbRehomeAttemptsRaw === "number" &&
    Number.isFinite(usbRehomeAttemptsRaw)
      ? usbRehomeAttemptsRaw
      : null;

  const peerSeenRaw = cloudStatus.peerSeenAtUnix;
  const peerSeenAtUnix =
    typeof peerSeenRaw === "number" && Number.isFinite(peerSeenRaw)
      ? peerSeenRaw
      : null;
  const peerChannelRaw = cloudStatus.peerChannel;
  const peerChannel =
    typeof peerChannelRaw === "number" && Number.isFinite(peerChannelRaw)
      ? peerChannelRaw
      : null;
  const peerRssiRaw = cloudStatus.peerRssiDbm;
  const peerRssiDbm =
    typeof peerRssiRaw === "number" && Number.isFinite(peerRssiRaw)
      ? peerRssiRaw
      : null;

  return {
    videoRestartAttempts,
    pairingCodeExpiresAt,
    mavlinkWsUrlPrev,
    wfbFailoverState,
    manualConnectionUrls,
    cloudRelayUrl: pickStringOrNull(cloudStatus.cloudRelayUrl),
    cloudflareUrl: pickStringOrNull(cloudStatus.cloudflareUrl),
    // The air-side in-process video-pipeline identity (flavor / encoder /
    // camera-source / state) and the FC CAN-bus inventory are not on the
    // cloud heartbeat wire — no agent path emits them — so they are always
    // undefined. The store's merge keeps the prior value through the sparse
    // tick. Kept on the shape so the capability bridge stays type-stable for
    // when a producer ships these on the wire.
    inferOverrides,
    radioRaw: cloudStatus.radio,
    crsfRaw: cloudStatus.crsf,
    setupState,
    profileSource,
    profile,
    role,
    runtimeMode,
    radioStackState,
    macStability,
    managementLink,
    wifiPowersave,
    mgmtLinkMode,
    mgmtFailoverIface: pickStringOrNull(cloudStatus.mgmtFailoverIface),
    mgmtFailoverReason: pickStringOrNull(cloudStatus.mgmtFailoverReason),
    usbRehomeState,
    usbRehomeAttempts,
    usbRehomeLastResult: pickStringOrNull(cloudStatus.usbRehomeLastResult),
    peerDeviceId: pickStringOrNull(cloudStatus.peerDeviceId),
    peerRole: pickStringOrNull(cloudStatus.peerRole),
    peerChannel,
    peerRssiDbm,
    peerSeenAtUnix,
    cameraState: (() => {
      const raw = cloudStatus.cameraState;
      if (typeof raw === "string" && (raw === "ready" || raw === "missing" || raw === "error")) {
        return raw;
      }
      return null;
    })(),
    // Camera-recovery block: validated through the shared parser. The
    // store keeps the prior value on a sparse tick that omits it.
    cameraUsbRecovery: normalizeCameraUsbRecovery(cloudStatus.cameraUsbRecovery),
    // canBuses is not on the cloud heartbeat wire — no agent path emits the
    // FC CAN-bus inventory there — so it is always undefined and the store's
    // merge keeps the prior value through the sparse tick.
    canBuses: undefined,
    // Perception execution tier + offload target. The two fields travel
    // together: the Rust beacon sends `perceptionTier` whenever perception is
    // active but OMITS `perceptionOffloadTarget` (skip_serializing_if) when
    // there is no target. So when the tier IS present but the target is absent,
    // the drone is NOT offloading — treat the target as CLEARED (null), never
    // keep-prior, or PerceptionTierCard would keep naming the workstation the
    // drone already stopped offloading to (Rule 44 — a stale reading is a bug).
    // Only when the tier itself is absent (a sparse tick with no perception
    // fields at all) does an absent target keep prior (undefined). The
    // capability-store normalizer clamps the tier to the known union; a null
    // target means "runs locally", undefined means "field absent → keep prior".
    perceptionTier:
      typeof cloudStatus.perceptionTier === "string"
        ? cloudStatus.perceptionTier
        : undefined,
    perceptionOffloadTarget:
      typeof cloudStatus.perceptionOffloadTarget === "string"
        ? cloudStatus.perceptionOffloadTarget
        : cloudStatus.perceptionOffloadTarget === null
          ? null
          : typeof cloudStatus.perceptionTier === "string"
            ? // Tier travelled but the target field was omitted → cleared.
              null
            : undefined,
  };
}
