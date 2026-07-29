/**
 * @module mock/agent/config
 * @description Rich mock node configuration for demo mode. Backs the
 * `MockAgentClient.getConfig` / `setConfigValue` surface so every node-Settings
 * page (`src/components/command/settings/*`) renders populated fields instead of
 * "not set", and a write reads back the updated value (optimistic + read-back,
 * the same posture the real `/api/config` surface has).
 *
 * The block set matches the dot-paths the settings sections read: identity
 * (`agent.*`), network (`network.*`), MAVLink routing, swarm, video + WFB,
 * perception offload, Atlas, discovery, cloud/remote, and security. A single
 * config carries every block; the settings-nav gates hide the pages that do not
 * apply to a profile (a ground station has no MAVLink router, a workstation no
 * radio), so the config stays profile-agnostic apart from `agent.profile`.
 * @license GPL-3.0-only
 */

// Exempt from 300 LOC soft rule: mock config data file.

export type MockConfigProfile = "drone" | "ground-station" | "workstation";

type ConfigObject = Record<string, unknown>;

/** Build the demo config tree for a profile. Generic values only (no real
 * infrastructure hostnames) since this ships in the public repo. */
function buildConfig(profile: MockConfigProfile): ConfigObject {
  return {
    agent: { profile, board_override: "" },
    logging: { level: "info" },
    network: {
      hotspot: {
        enabled: true,
        ssid: "ADOS-Node-AP",
        password: "altnautica",
        channel: 6,
      },
      cellular: { enabled: false, apn: "internet" },
      mac_pin: { enabled: true, apply_live_allowed: false },
      wifi_selfheal: { enabled: true },
    },
    mavlink: {
      source: "serial",
      serial_port: "/dev/ttyACM0",
      baud_rate: 115200,
      system_id: 1,
      component_id: 191,
      ws_proxy_enforce_auth: false,
      endpoints: [
        { type: "udp", host: "127.0.0.1", port: 14550 },
        { type: "tcp", host: "0.0.0.0", port: 5760 },
      ],
    },
    swarm: {
      enabled: true,
      role: "member",
      mode: "formation",
      default_formation: "column",
      default_spacing: 25,
      flock: {
        cohesion: 40,
        alignment: 60,
        separation_gain: 150,
        radius_m: 30,
        neighbors: 7,
      },
      separation: { radius_m: 8, hard_m: 4 },
      // Assignment fields are agent-written in the field; the demo carries a
      // plausible pair so the read-only readout is exercisable offline.
      tasks: { enabled: true, assigned_task_id: "survey-cell-12", bundle_position: 2 },
    },
    video: {
      camera: {
        source: "/dev/video0",
        codec: "h264",
        codec_preference: "h264",
        fps: 30,
        width: 1920,
        height: 1080,
        bitrate_kbps: 6000,
      },
      cameras: [{ id: "main", source: "/dev/video0", role: "eo" }],
      wfb: {
        fleet_id: 1,
        fleet_slot: profile === "ground-station" ? 0 : 3,
        channel: 149,
        band: "u-nii-3",
        tx_power_dbm: 20,
        mcs_index: 1,
        wfb_link_preset: "balanced",
        auto_hop_enabled: true,
        adaptive_bitrate_enabled: true,
        adaptive_mcs_max: 3,
      },
      usb_recovery: { enabled: true },
    },
    perception: {
      offload: { enabled: "auto", compute_node_addr: "" },
      serving: { enabled: "auto", detector_model: "yolov8n" },
    },
    atlas: {
      capture_profile: "balanced",
      pose_tier: "vio",
      reconstruct_steps: 30000,
    },
    discovery: { mdns_enabled: true, service_type: "_ados._tcp" },
    security: {
      setup_token_required: true,
      api: { api_key: "demo-node-key" },
    },
    remote_access: {
      provider: "cloudflare",
      cloudflare: {
        enabled: false,
        api_url: "",
        setup_url: "",
        mavlink_ws_url: "",
        video_whep_url: "",
      },
    },
    server: {
      mode: "self_hosted",
      cloud: { url: "https://convex.example.com" },
      self_hosted: { url: "https://convex.example.com" },
      heartbeat_interval: 30,
      telemetry_rate: 4,
    },
    api: {
      mission_control_url: "https://command.altnautica.com",
      rest: { host: "0.0.0.0", port: 8080 },
    },
  };
}

/** The live mutable demo config. Persists writes across reads so a change made
 * on a settings page reads back (the surface confirms the round-trip). */
let mockConfig: ConfigObject = buildConfig("drone");

/** Point the demo config at the focused node's profile so the identity page
 * reads the right profile. Only `agent.profile` changes; the operator's edits
 * to every other block survive a node switch. */
export function setMockConfigProfile(profile: MockConfigProfile): void {
  const agent = mockConfig.agent as ConfigObject | undefined;
  if (agent && agent.profile !== profile) agent.profile = profile;
}

/** A deep clone of the current demo config. A fresh reference each call so the
 * settings hook's React state re-renders on a read-back after a write. */
export function getMockConfig(): ConfigObject {
  return JSON.parse(JSON.stringify(mockConfig)) as ConfigObject;
}

/** Coerce the incoming string write to the type the stored value already has so
 * a toggle reads back a real boolean and an int field a real number (the real
 * agent parses per its Pydantic schema; the mock preserves the leaf type). */
function coerce(existing: unknown, value: string): unknown {
  if (typeof existing === "boolean") return value === "true";
  if (typeof existing === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : existing;
  }
  return value;
}

/** Write one dot-path key into the live demo config, type-preserving. Returns
 * the persisted value so `getMockConfig` reads it back on the next call. */
export function setMockConfigValue(key: string, value: string): unknown {
  const segments = key.split(".");
  let cursor = mockConfig;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = cursor[seg];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as ConfigObject;
  }
  const leaf = segments[segments.length - 1];
  cursor[leaf] = coerce(cursor[leaf], value);
  return cursor[leaf];
}
