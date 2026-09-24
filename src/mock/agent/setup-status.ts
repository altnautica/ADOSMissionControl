// Exempt from 300 LOC soft rule: pure mock fixture data.
/**
 * @module mock/agent/setup-status
 * @description Mock setup-wizard payloads. Builds the per-profile
 * SetupStatus + HardwareCheckStatus shapes the demo agent serves so
 * the Hardware tab + setup webapp render without first walking a
 * physical wizard.
 * @license GPL-3.0-only
 */

import type {
  HardwareCheckStatus,
  SetupStatus,
} from "@/lib/agent/types";

export type MockProfile = "drone" | "ground_station";
export type MockGroundRole = "direct" | "relay" | "receiver";

export interface MockSetupContext {
  profile: MockProfile;
  groundRole: MockGroundRole;
  profileConfirmed: boolean;
}

export function buildMockSetupStatus(ctx: MockSetupContext): SetupStatus {
  const { profile, groundRole, profileConfirmed } = ctx;
  const groundRoleField = profile === "ground_station" ? groundRole : "";
  const isDrone = profile === "drone";
  return {
    version: "0.10.1",
    device_id: "demo-0001",
    device_name: "Demo Drone",
    profile,
    ground_role: groundRoleField,
    setup_complete: true,
    setup_finalized: true,
    completion_percent: 100,
    next_action: "Open Mission Control or revisit any setup step.",
    steps: [
      { id: "welcome", label: "Welcome", state: "complete", detail: "Device identity available", action_label: "", href: "" },
      { id: "profile", label: "Profile", state: "complete", detail: `Confirmed as ${profile}`, action_label: "Choose profile", href: "/setup.html?step=profile" },
      { id: "network", label: "Network", state: "complete", detail: "Local access is available", action_label: "Open Network", href: "/network.html" },
      { id: "hardware_check", label: "Hardware check", state: "complete", detail: "All required components detected.", action_label: "Open hardware check", href: "/setup.html?step=hardware_check" },
      { id: "cloud_choice", label: "Cloud posture", state: "complete", detail: "Connected to https://demo.altnautica.com", action_label: "Choose cloud posture", href: "/setup.html?step=cloud_choice" },
      { id: "pair", label: "Pair with Mission Control", state: "complete", detail: "Device is paired.", action_label: "Enter pairing code", href: "/setup.html?step=pair" },
      ...(isDrone ? [{ id: "mavlink", label: "Flight controller", state: "complete" as const, detail: "MAVLink telemetry is live", action_label: "Open MAVLink", href: "/mavlink.html" }] : []),
      { id: "video", label: "Video", state: "complete", detail: "WHEP video is available", action_label: "Open Video", href: "/video.html" },
      ...(!isDrone ? [{ id: "ground_receiver", label: "Ground receiver", state: "complete" as const, detail: "WFB receiver and mesh role configuration", action_label: "Open Ground station", href: "/ground.html" }] : []),
      { id: "remote_access", label: "Remote access", state: "optional", detail: "Optional cloud or tunnel link", action_label: "Open Remote access", href: "/remote.html" },
      { id: "finish", label: "Finish", state: "complete", detail: "Open Mission Control when local telemetry or video is ready", action_label: "Open Mission Control", href: "" },
    ],
    access_urls: [
      { kind: "setup", label: "Setup webapp", url: "http://demo-drone.local", source: "local", primary: true },
      { kind: "api", label: "Local API", url: "http://demo-drone.local/api", source: "local", primary: false },
    ],
    network: {
      hostname: "demo-drone",
      mdns_host: "ados-demo-0001.local",
      api_port: 8080,
      hotspot_enabled: false,
      hotspot_ssid: "",
      local_ips: ["192.168.4.1"],
    },
    mavlink: {
      connected: isDrone,
      port: isDrone ? "/dev/ttyAMA0" : null,
      baud: isDrone ? 921600 : null,
      websocket_url: "ws://demo-drone.local:8765/",
      public_websocket_url: null,
    },
    video: {
      state: "running",
      whep_url: "http://demo-drone.local:8889/main/whep",
      public_whep_url: null,
      recording: false,
    },
    remote_access: {
      provider: "none",
      enabled: false,
      configured: false,
      status: "disabled",
      public_urls: [],
      error: "",
    },
    cloud_choice: {
      mode: "cloud",
      paired: true,
      pair_code_required: true,
      backend_url: "https://demo.altnautica.com",
      backend_reachable: true,
      last_checked: new Date().toISOString(),
    },
    profile_suggestion: {
      detected: profile,
      ground_role_hint: groundRoleField === "" ? "direct" : (groundRoleField as MockGroundRole),
      ground_score: profile === "ground_station" ? 7 : 0,
      air_score: isDrone ? 5 : 0,
      mesh_capable: false,
      signals: isDrone
        ? { mavlink_serial: true, oled_i2c: false, buttons_gpio: false, rtl8812: false, uplink: true }
        : { mavlink_serial: false, oled_i2c: true, buttons_gpio: true, rtl8812: true, uplink: true },
      confirmed: profileConfirmed,
      detected_at: new Date().toISOString(),
    },
    hardware_check: buildMockHardwareCheck(profile, groundRoleField),
    skipped_steps: [],
  };
}

export function buildMockHardwareCheck(
  profile: MockProfile,
  groundRole: string,
): HardwareCheckStatus {
  const lastRun = new Date().toISOString();
  if (profile === "drone") {
    return {
      profile: "drone",
      ground_role: "",
      items: [
        { id: "board", label: "Companion compute", required: true, state: "ok", detail: "Raspberry Pi CM4 (CM4104032). 4 cores, 4096 MB RAM, tier 3.", fix_hint: "" },
        { id: "fc", label: "Flight controller (MAVLink)", required: true, state: "ok", detail: "ArduPilot 4.5.7 on /dev/ttyAMA0 @ 921600 baud", fix_hint: "" },
        { id: "camera", label: "Camera", required: true, state: "ok", detail: "1 detected (1 csi). Primary: Pi Camera v3 at /dev/video0", fix_hint: "" },
        { id: "radio_wfb", label: "WFB radio adapter", required: false, state: "ok", detail: "1 adapter(s) detected: RTL8812EU WiFi (Video Link)", fix_hint: "" },
        { id: "radio_4g", label: "4G LTE modem", required: false, state: "missing", detail: "No cellular modem detected by ModemManager.", fix_hint: "Optional. Plug in a USB LTE modem if you need cellular fallback." },
        { id: "gps", label: "GPS receiver", required: false, state: "warning", detail: "GPS auto-detection is best-effort. Trust MAVLink GPS_RAW once FC is connected.", fix_hint: "" },
      ],
      last_run: lastRun,
    };
  }
  const isMesh = groundRole === "relay" || groundRole === "receiver";
  return {
    profile: "ground_station",
    ground_role: groundRole,
    items: [
      { id: "board", label: "Companion compute", required: true, state: "ok", detail: "Raspberry Pi 4B. 4 cores, 4096 MB RAM, tier 3.", fix_hint: "" },
      { id: "radio_wfb", label: "WFB radio adapter", required: true, state: "ok", detail: "1 adapter(s) detected: RTL8812EU WiFi (Video Link)", fix_hint: "" },
      { id: "mesh_dongle", label: "Mesh second-radio dongle", required: isMesh, state: isMesh ? "missing" : "warning", detail: "No second USB wireless adapter detected.", fix_hint: "Mesh roles need a second USB WiFi adapter for batman-adv carrier." },
      { id: "oled", label: "OLED display", required: false, state: "ok", detail: "SSD1306/SH1106 detected on I2C bus 1.", fix_hint: "" },
      { id: "buttons", label: "Front-panel buttons", required: false, state: "ok", detail: "Four buttons read idle-high on default GPIOs.", fix_hint: "" },
      { id: "hdmi", label: "HDMI output", required: false, state: "warning", detail: "HDMI port present but no display connected.", fix_hint: "Optional. Plug in an HDMI display for the kiosk view." },
      { id: "joystick", label: "Joystick / gamepad", required: false, state: "warning", detail: "No /dev/input/js* devices detected.", fix_hint: "Optional. Plug in a USB gamepad or RC controller." },
      { id: "uplink", label: "Uplink to internet", required: false, state: "ok", detail: "Active via ethernet/USB.", fix_hint: "" },
    ],
    last_run: lastRun,
  };
}
