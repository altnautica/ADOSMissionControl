/**
 * @module mock/agent/capabilities
 * @description Mock capability snapshot used by the demo agent.
 * Reflects an active follow-target run on a tier-4 drone with a small
 * person-detection model loaded on the NPU, plus a fully-populated
 * vision-nav navigation block so demo-mode renders every Navigation
 * tab surface without hardware. Tests and screenshot fixtures can
 * call ``getMockCapabilities("vio_openvins")`` etc. to render the
 * non-default mode states.
 * @license GPL-3.0-only
 */

import type {
  AgentCapabilities,
  NavigationCapability,
} from "@/lib/agent/feature-types";
import type { CrsfState, RadioState } from "@/lib/api/ground-station/types";
import { jitter } from "./utils";

/** Demo air-side radio snapshot so the Radio / Network Health panel renders
 * its live indicators in `npm run demo`: a US-domain link locked on its home
 * channel (so it reads "pinned"), TX active with a ground decode, an
 * injection-capable adapter, and a healthy link-diagnosis verdict backed by a
 * flowing received-frame count (the honest received-side proof, Rule 44). The
 * normalizer fills any field omitted here. */
const MOCK_RADIO: Partial<RadioState> = {
  state: "connected",
  iface: "wlan1",
  driver: "rtl88x2eu",
  channel: 149,
  freqMhz: 5745,
  homeChannel: 149,
  band: "u-nii-3",
  regDomain: "US",
  monitorActive: true,
  txActive: true,
  peerLink: "linked",
  acquireState: "locked",
  channelLocked: true,
  adapterChipset: "RTL8812EU",
  adapterInjectionOk: true,
  // The demo link decodes on the ground, so the radio's transmit-proof
  // verdict is an explicit false (proven), not an absent reading.
  rfUnverified: false,
  rssiDbm: -44,
  snrDb: 32,
  bitrateKbps: 18500,
  fecRecovered: 1240,
  fecLost: 9,
  lossPercent: 0.4,
  // A healthy link-diagnosis verdict, proven by a flowing received-frame count.
  linkDiag: "healthy",
  packetsAll: 152340,
  validRxPacketsPerS: 312,
  decryptErrors: 0,
  paired: true,
};

/** Demo CRSF / ExpressLRS control-lane snapshot so the RC / ELRS Link tab
 * renders a populated, honest lane in `npm run demo`: a healthy 900 MHz link
 * transmitting handset RC channels through a relay role, with the transmit
 * proven (rfUnverified false) and the RC command path open (fcCommandDownGated
 * false — an RC lane's sticks reach the FC). Read loosely off the caps payload
 * by the normalizer (camelCase), like the radio block. */
const MOCK_CRSF: Partial<CrsfState> = {
  state: "link_ok",
  rssiDbm: -62,
  lqUplink: 98,
  lqDownlink: 95,
  snrDb: 9,
  band: "900 MHz",
  packetRateHz: 150,
  txPowerMw: 250,
  txFramesPerS: 150,
  rxFramesPerS: 50,
  rfUnverified: false,
  flyable: true,
  mode: "crsf_rc",
  fcCommandDownGated: false,
  channelSource: "hid",
  pic: "claimed",
  relayRole: "relay",
};

type MockNavigationMode =
  | "off"
  | "optical_flow"
  | "optical_flow_degraded"
  | "vio_openvins"
  | "vio_vins_fusion"
  | "hybrid_of_plus_vio";

const AVAILABLE_ESTIMATORS: string[] = [
  "off",
  "optical_flow",
  "optical_flow_degraded",
  "vio_openvins",
  "vio_vins_fusion",
  "hybrid_of_plus_vio",
];

function mockNavigationFor(mode: MockNavigationMode): NavigationCapability {
  // Per-mode realism: the values mirror what the agent's HealthPublisher
  // would emit at steady state for that mode. The numbers jitter on each
  // call so the live demo's sparklines have movement.
  const base: NavigationCapability = {
    opticalFlowSupported: true,
    vioSupported: mode.startsWith("vio_") || mode === "hybrid_of_plus_vio",
    rangefinderTopology: mode === "optical_flow_degraded" ? null : "companion",
    recommendedCameraId: "/dev/video0",
    companionState: "active",
    mode,
    availableEstimators: AVAILABLE_ESTIMATORS,
    estimatorState: "converged",
    imuSource: "mavlink-scaled-imu2",
    imuRateHz: 100,
    cameraIntrinsicsLoaded: mode === "off" ? false : true,
    cameraImuSyncOffsetMs: jitter(4.2, 1.0),
  };

  if (mode === "off") {
    return {
      ...base,
      estimatorState: "off",
      flowQuality: undefined,
      flowRateHz: undefined,
      flowDistanceM: undefined,
      flowScaleSource: null,
      estimatorFeatureCount: undefined,
      estimatorDriftEstimateM: undefined,
    };
  }
  if (mode === "optical_flow") {
    return {
      ...base,
      flowQuality: Math.round(jitter(185, 12)),
      flowRateHz: jitter(29.5, 0.5),
      flowDistanceM: jitter(1.25, 0.05),
      flowScaleSource: "rangefinder",
    };
  }
  if (mode === "optical_flow_degraded") {
    return {
      ...base,
      rangefinderTopology: null,
      flowQuality: Math.round(jitter(120, 15)),
      flowRateHz: jitter(29.5, 0.5),
      flowDistanceM: jitter(1.5, 0.1),
      flowScaleSource: "baro",
      estimatorState: "degraded",
    };
  }
  if (mode === "vio_openvins") {
    return {
      ...base,
      flowQuality: undefined,
      flowRateHz: undefined,
      flowDistanceM: null,
      flowScaleSource: null,
      estimatorFeatureCount: Math.round(jitter(78, 8)),
      estimatorDriftEstimateM: jitter(0.18, 0.04),
      vioState: "active",
      vioQuality: Math.round(jitter(220, 10)),
      vioResetCounter: 0,
    };
  }
  if (mode === "vio_vins_fusion") {
    return {
      ...base,
      flowQuality: undefined,
      flowRateHz: undefined,
      flowDistanceM: null,
      flowScaleSource: null,
      estimatorFeatureCount: Math.round(jitter(120, 12)),
      estimatorDriftEstimateM: jitter(0.12, 0.03),
      vioState: "active",
      vioQuality: Math.round(jitter(240, 8)),
      vioResetCounter: 0,
    };
  }
  // hybrid_of_plus_vio: both halves contribute. Slightly higher CPU
  // posture is implied by the fixed compute block above.
  return {
    ...base,
    flowQuality: Math.round(jitter(180, 15)),
    flowRateHz: jitter(29.5, 0.5),
    flowDistanceM: jitter(1.25, 0.05),
    flowScaleSource: "rangefinder",
    estimatorFeatureCount: Math.round(jitter(78, 8)),
    estimatorDriftEstimateM: jitter(0.15, 0.04),
    vioState: "active",
    vioQuality: Math.round(jitter(220, 10)),
    vioResetCounter: 0,
  };
}

/**
 * Per-node perception override so the demo fleet can show BOTH execution tiers
 * honestly: an NPU-bearing drone runs LOCAL (the default below), an NPU-less
 * drone shows OFFLOAD to a workstation. Applied over the canned caps so the
 * cockpit perception chip + the Perception tier card render a plausible tier.
 */
export interface MockPerceptionOverride {
  perceptionTier?: AgentCapabilities["perceptionTier"];
  perceptionOffloadTarget?: string | null;
  npuTops?: number;
  hasAccelerator?: boolean;
  npuAvailable?: boolean;
}

export function getMockCapabilities(
  mode: MockNavigationMode = "optical_flow",
  perception?: MockPerceptionOverride,
): AgentCapabilities {
  // `radio` is read loosely off the raw payload by the capability
  // normalizer (it is not a declared AgentCapabilities field), so attach it
  // alongside the typed block. `radioStackState` + `macStability` ARE
  // declared, so they sit in the typed object directly.
  const caps: AgentCapabilities & {
    radio: Partial<RadioState>;
    crsf: Partial<CrsfState>;
  } = {
    radio: MOCK_RADIO,
    // The agent-relay ELRS control lane a drone can host: read
    // loosely off the payload by the normalizer, alongside radio.
    crsf: MOCK_CRSF,
    radioStackState: "ok",
    macStability: {
      adapters: [
        {
          name: "wlan0",
          vidpid: "a69c:8d81",
          state: "pinned",
          source: "learned",
          pinnedMac: "02:c6:75:83:1a:3e",
          lastSeenMac: "02:c6:75:83:1a:3e",
        },
      ],
    },
    // A degraded link (up but no data path) exercises the amber card path.
    managementLink: {
      state: "degraded",
      iface: "eth0",
      transport: "ethernet",
      backend: "networkd",
      carrier: true,
      hasLease: true,
      gatewayReachable: false,
      repairing: true,
      lastRung: "renew_dhcp",
      lastRepairAt: null,
      repairsInWindow: 1,
    },
    // Power-save held OFF on the managed interface, with a couple of re-asserts,
    // exercises the verified (OFF = good) card path plus the re-assert count.
    wifiPowersave: {
      interfaces: [
        {
          iface: "wlan0",
          powersaveOn: false,
          reasserts: 2,
          lastReassert: "2026-07-04T10:15:00Z",
          signalDbm: -58,
          linkState: "connected",
        },
      ],
    },
    // On the WiFi heartbeat reach-back exercises the amber degraded banner.
    mgmtLinkMode: "wifi_heartbeat",
    mgmtFailoverIface: "wlan0",
    mgmtFailoverReason: "primary_carrier_down",
    // Mid-rehome exercises the USB-rehome indicator.
    usbRehomeState: "rehoming",
    usbRehomeAttempts: 1,
    usbRehomeLastResult: "retry",
    // A wedged USB camera under active self-heal exercises the air-side
    // "No camera" / "Recovering camera…" badge + video overlay.
    cameraState: "missing",
    cameraUsbRecovery: {
      state: "port_cycling",
      case: "present_wedged",
      attempts: 1,
      maxAttempts: 3,
      cameraPresent: false,
      expected: true,
      pppsCapable: true,
      powerContention: true,
      contentionPeer: "1-1.2",
    },
    tier: 4,
    cameras: [
      { name: "USB Camera", type: "usb", device: "/dev/video0", resolution: "1920x1080", fps: 30, streaming: true },
      { name: "CSI Downward", type: "csi", device: "/dev/video1", resolution: "1280x720", fps: 30, streaming: false },
      { name: "Thermal", type: "usb", device: "/dev/video2", resolution: "640x512", fps: 30, streaming: false },
    ],
    // Addressable per-leg WHEP streams (a smart-pod-style multi-stream node), so
    // the demo exercises the concurrent stream switcher (instant flip) + PiP.
    videoStreams: [
      { id: "main", role: "eo", codec: "h264", whepUrl: "http://demo-drone.local:8889/main/whep" },
      { id: "eo_wide", role: "eo_wide", codec: "h264", whepUrl: "http://demo-drone.local:8889/eo_wide/whep" },
      { id: "ir", role: "ir", codec: "h264", whepUrl: "http://demo-drone.local:8889/ir/whep" },
    ],
    compute: {
      npu_available: true,
      npu_runtime: "rknn",
      npu_tops: 6.0,
      npu_utilization_pct: jitter(68, 12),
      gpu_available: false,
    },
    // Perception execution tier: the demo drone has a 6 TOPS NPU, so it runs
    // the detector locally on-edge. Mirrors the accelerator posture the
    // Perception hub reads for the tier rationale.
    perceptionTier: "local",
    perceptionOffloadTarget: null,
    npuTops: 6.0,
    hasAccelerator: true,
    // Top-level availability flag the capabilities store reads to gate the
    // Vision tab (and the `full` ModelPicker surface it hosts). The live
    // path derives this from a real NPU / advertised vision surface via
    // infer-capabilities; the mock advertises both (rknn / 6 TOPS NPU + an
    // active engine below), so this is the honest value — without it the
    // Vision tab is unreachable in `npm run demo`.
    visionAvailable: true,
    vision: {
      engine_state: "active",
      active_behavior: "follow_target",
      behavior_state: "tracking",
      fps: jitter(18, 2),
      inference_ms: jitter(55, 8),
      model_loaded: "person_v1_small",
      track_count: 2,
      target_locked: true,
      target_confidence: 0.94,
      obstacle_mode: "brake",
      nearest_obstacle_m: 8.2,
      threat_level: "green",
    },
    // Live-detection summary mirror the cloud bridge forwards, so the demo's
    // Vision surfaces render the active-model / backend line too.
    visionSummary: {
      activeModel: "person_v1_small",
      backend: "rknn",
      detectionsPerSec: jitter(18, 2),
      fps: jitter(18, 2),
    },
    models: {
      installed: [
        { id: "person_v1", variant: "small", format: "rknn", size_mb: 12, loaded: true },
        { id: "depth_midas_v3", variant: "small", format: "rknn", size_mb: 15, loaded: true },
      ],
      cache_used_mb: 27,
      cache_max_mb: 500,
      registry_url: "https://raw.githubusercontent.com/altnautica/ADOSMissionControl/main/public/models/registry.json",
    },
    navigation: mockNavigationFor(mode),
    // Demo agent reports the native runtime so the RuntimeModeBadge
    // renders in `npm run demo`.
    runtimeMode: "native",
  };

  // Apply the per-node perception override (offload vs local), keeping the
  // accelerator posture internally consistent so the tier rationale reads true.
  if (perception) {
    if (perception.perceptionTier !== undefined)
      caps.perceptionTier = perception.perceptionTier;
    if (perception.perceptionOffloadTarget !== undefined)
      caps.perceptionOffloadTarget = perception.perceptionOffloadTarget;
    if (perception.npuTops !== undefined) {
      caps.npuTops = perception.npuTops;
      caps.compute.npu_tops = perception.npuTops;
    }
    if (perception.hasAccelerator !== undefined)
      caps.hasAccelerator = perception.hasAccelerator;
    if (perception.npuAvailable !== undefined)
      caps.compute.npu_available = perception.npuAvailable;
  }

  return caps;
}

/**
 * Mock capability snapshot for the demo ground-station node: the ground-side
 * WFB radio + the CRSF/ExpressLRS control lane it transmits (so `radioPresent`
 * and `crsfPresent` both gate their tabs on), plus the adapter-stability /
 * WiFi-powersave / management-link health the Network tab surfaces. Leaner than
 * a drone's caps (no NPU / vision / cameras — a ground node does not fly a
 * vision pipeline); the profile + role are set so the capability store reads the
 * relay ground-station honestly.
 */
export function getMockGroundStationCapabilities(): AgentCapabilities & {
  radio: Partial<RadioState>;
  crsf: Partial<CrsfState>;
  profile: string;
  role: string;
} {
  return {
    radio: MOCK_RADIO,
    crsf: MOCK_CRSF,
    radioStackState: "ok",
    // profile / role are read loosely off the payload by deriveProfile /
    // deriveRole (not declared AgentCapabilities fields), so the capability
    // store reads the relay ground-station honestly.
    profile: "ground-station",
    role: "relay",
    macStability: {
      adapters: [
        {
          name: "wlan1",
          vidpid: "0bda:8812",
          state: "pinned",
          source: "learned",
          pinnedMac: "02:c6:75:83:1a:3e",
          lastSeenMac: "02:c6:75:83:1a:3e",
        },
      ],
    },
    wifiPowersave: {
      interfaces: [
        {
          iface: "wlan0",
          powersaveOn: false,
          reasserts: 1,
          lastReassert: "2026-07-04T10:15:00Z",
          signalDbm: -52,
          linkState: "connected",
        },
      ],
    },
    managementLink: {
      state: "healthy",
      iface: "eth0",
      transport: "ethernet",
      backend: "networkd",
      carrier: true,
      hasLease: true,
      gatewayReachable: true,
      repairing: false,
      lastRepairAt: null,
      repairsInWindow: 0,
    },
    tier: 3,
    cameras: [],
    videoStreams: [],
    compute: {
      npu_available: false,
      npu_runtime: null,
      npu_tops: 0,
      npu_utilization_pct: 0,
      gpu_available: false,
    },
    vision: {
      engine_state: "off",
      active_behavior: null,
      behavior_state: null,
      fps: 0,
      inference_ms: 0,
      model_loaded: null,
      track_count: 0,
      target_locked: false,
      target_confidence: 0,
      obstacle_mode: "off",
      nearest_obstacle_m: null,
      threat_level: "green",
    },
    models: {
      installed: [],
      cache_used_mb: 0,
      cache_max_mb: 500,
      registry_url: "",
    },
    runtimeMode: "native",
  };
}
