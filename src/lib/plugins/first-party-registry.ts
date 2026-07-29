/**
 * @module lib/plugins/first-party-registry
 * @description Demo-mode-only fixture for the first-party plugin catalog.
 * `RegistryPluginGrid` renders this (via `DemoRegistryGrid`) only when
 * `isDemoMode()` is true; a live Convex outage outside demo mode falls
 * through to an explicit error state instead (see `RegistryPluginGrid.tsx`'s
 * `!convexAvailable` branch). So this file is **not** an offline/first-party
 * fallback for a missing live registry read — it exists purely so an
 * operator can open the install / detail pop-up against representative
 * manifests with no backend and no auth, exercising the full revamped
 * surface: badges, skills, MCP tools, contributed panels, capability chips,
 * permissions, and screenshots.
 *
 * The manifests mirror the shipped first-party extensions (their
 * contributions are public in the extensions repo); download URLs, digests,
 * and sizes are cross-checked against the real GitHub release assets and
 * against `website/src/content/registry/first-party.json` (the canonical
 * marketing-site mirror of the same catalog). The optical-pod entry is
 * lightly enriched with a top-level icon, screenshots, and MCP tools so the
 * demo exercises every pop-up section. Nothing here reaches an agent — it is
 * display data only.
 *
 * @license GPL-3.0-only
 */

import type { RegistryPluginRow } from "@/components/dashboard/drone-plugins/RegistryPluginCard";

/** A demo registry entry: the catalog row plus the manifest text and the
 * signing/download fields the install pop-up reads. */
export interface DemoRegistryEntry {
  row: RegistryPluginRow;
  manifestYaml: string;
  downloadUrl: string;
  archiveSha256: string;
  /** Published archive size in bytes, cross-checked against the GitHub
   * release asset's Content-Length. */
  archiveSizeBytes: number;
  signerKeyId: string;
  /** Boards the extension's own `manifest.yaml` declares under
   * `compatibility.supported_boards`, mirrored here so the demo catalog can
   * exercise the same board gate a live registry row would. `["*"]` means
   * every board. */
  supportedBoards: readonly string[];
}

/** A labeled placeholder screenshot as an inline SVG data URI (renders offline). */
function shot(label: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='100%' height='100%' fill='%23151a22'/><rect x='8' y='8' width='304' height='164' rx='8' fill='none' stroke='%232b3646'/><text x='20' y='100' fill='%237c8aa0' font-family='sans-serif' font-size='15'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

const SIYI_MANIFEST = `schema_version: 3
id: com.altnautica.siyi-pod
name: "ADOS SIYI Optical Pod"
version: "0.4.0"
icon: "camera"
description: "Native driver for the SIYI optical-pod line with per-model capability negotiation: gimbal, zoom, focus, photo/record, thermal palette and spot temperature, laser rangefinder with subject geolocation, and on-pod AI tracking."
description_long: |
  Speaks the SIYI Gimbal Camera External SDK over UDP, TCP, or a TTL serial
  port directly, so the agent drives the features a stock autopilot mount
  cannot: thermal palettes and temperature, the laser rangefinder, subject
  geolocation, and AI tracking. On start the plugin queries the hardware id,
  resolves the exact model's capability profile, and exposes only the controls
  that model supports.
features:
  - "Auto-detects the pod model and negotiates capabilities"
  - "Gimbal aim, rate, recenter, and lock/follow/FPV modes"
  - "Optical and absolute zoom, autofocus (zoom models)"
  - "Thermal palette, gain, and spot temperature (thermal models)"
  - "Laser rangefinder with subject geolocation on the map (laser models)"
  - "On-pod AI tracking republished to the cockpit (no accelerator required)"
hardware_requirements:
  cameras: "A SIYI optical pod on the pod network (192.168.144.x) or a TTL serial port"
  boards: ["cm4", "cm5", "rk3588s2", "rk3576", "rpi5", "x86"]
resource_impact:
  cpu_percent_peak: 12
  ram_mb: 96
  pids: 4
  output_rate_hz: 5
  startup_time_seconds: 3
telemetry_fields:
  - "siyi"
documentation_url: "https://docs.altnautica.com/drone-agent/siyi-pod-overview"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/siyi-pod"
author: "Altnautica"
license: "GPL-3.0-or-later"
risk: high
screenshots:
  - url: "${shot("Pod control console")}"
    caption: "Pod control console"
  - url: "${shot("Laser target on the map")}"
    caption: "Laser target on the map"
agent:
  runtime: python
  permissions:
    - id: network.outbound
    - id: hardware.uart
    - id: mavlink.read
    - id: mavlink.write
    - id: mavlink.component.gimbal
    - id: mavlink.component.camera
    - id: sensor.camera.register
    - id: vision.detection.publish
    - id: vision.track.designate
    - id: video.source.set
    - id: event.publish
    - id: mcp.expose
  contributes:
    tools:
      - name: status
        description: "Read the pod's live state (mode, zoom, palette, tracking)."
        safety_class: read
      - name: set_zoom
        description: "Set the optical zoom level."
        safety_class: safe_write
        inputSchema:
          type: object
          properties:
            level:
              type: number
              minimum: 1
              maximum: 30
      - name: set_palette
        description: "Select the thermal colour palette."
        safety_class: safe_write
      - name: capture_photo
        description: "Capture a still to the pod's storage."
        safety_class: safe_write
      - name: geolocate_target
        description: "Fire the rangefinder and resolve the subject latitude and longitude."
        safety_class: safe_write
gcs:
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.cockpit-panel
    - id: ui.slot.video-overlay
    - id: ui.slot.flight-skill
    - id: ui.slot.map-overlay
    - id: ui.slot.notification-channel
    - id: telemetry.subscribe.siyi
    - id: command.send
  contributes:
    tabs:
      - id: siyi-console
        slot: node.detail.tab
        profile: ["drone"]
        title: "SIYI Pod"
        icon: "camera"
        order: 55
    panels:
      - id: siyi-cockpit
        slot: cockpit.panel
        title: "Pod"
        icon: "camera"
        order: 40
      - id: siyi-overlay
        slot: video.overlay
        title: "SIYI pod HUD"
        icon: "crosshair"
      - id: siyi-map
        slot: map.overlay
        title: "Laser target"
        icon: "target"
    notifications:
      - id: siyi-health
        title: "SIYI pod health"
        severity: warning
    skills:
      - id: siyi-track
        label: "skill.track"
        icon: "crosshair"
        category: camera
        toggle: true
        arm_requirement: any
        default_binding: { key: "t" }
        activation: { via: config, config_key: track_active }
        state: { via: event, topic: "siyi.pod.state" }
      - id: siyi-record
        label: "skill.record"
        icon: "video"
        category: camera
        toggle: true
        arm_requirement: any
        default_binding: { key: "r" }
        activation: { via: config, config_key: recording }
        state: { via: event, topic: "siyi.pod.state" }
    target_actions:
      - id: siyi-designate
        label: "Track with pod"
        icon: crosshair
        order: 25
        designate: true
        config_key: track_designate
        config_value: true
        default_key: "t"
    parameters:
      - key: zoom
        binding: plugin.config
        schema: { type: number, minimum: 1, maximum: 30, step: 0.1, default: 1 }
        ui: { widget: range, label: "settings.zoom", order: 10 }
      - key: gimbal_mode
        binding: plugin.config
        schema: { type: string, enum: ["lock", "follow", "fpv"], default: "follow" }
        ui: { widget: enum, label: "settings.gimbalMode", order: 30 }
      - key: palette
        binding: plugin.config
        schema: { type: integer, minimum: 0, maximum: 8, default: 0 }
        ui: { widget: number, label: "settings.palette", order: 40 }
      - key: laser_enabled
        binding: plugin.config
        schema: { type: boolean, default: false }
        ui: { widget: boolean, label: "settings.laser", order: 60 }
`;

const FOLLOW_ME_MANIFEST = `schema_version: 2
id: com.altnautica.follow-me
name: "ADOS Follow-Me"
version: "0.2.5"
icon: "follow"
description: "Lock onto an operator-designated subject and fly a fixed-distance standoff follow from the companion."
description_long: |
  Click a subject in the live video and the drone follows it at a fixed
  distance and height. A generic person/object detector on the companion
  produces detections; the operator designates one; the companion locks onto
  that track and feeds the flight controller guided position setpoints.

  A lock-state safety gate stops commanding the instant the tracker reports the
  subject uncertain or lost, and never silently re-locks onto a different
  subject.
features:
  - "Click a detected subject in the cockpit and pick Follow to designate it"
  - "Fixed-distance, fixed-height standoff follow via guided setpoints"
  - "Lock-state safety gate: stops commanding on uncertain or lost"
  - "Optional gimbal point-at-subject when a gimbal is present"
hardware_requirements:
  cameras: "USB UVC or CSI camera bound to the vision pipeline"
  fc_firmware: "ArduPilot or PX4 in a guided position-hold mode"
  boards: ["cm4", "cm5", "rk3588s2", "rk3576", "rpi5"]
resource_impact:
  output_rate_hz: 6
  cpu_percent_peak: 25
  ram_mb: 128
  pids: 4
  startup_time_seconds: 3
telemetry_fields:
  - "follow.state"
documentation_url: "https://docs.altnautica.com/drone-agent/follow-me-overview"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/follow-me"
author: "Altnautica"
license: "GPL-3.0-or-later"
risk: high
agent:
  runtime: python
  permissions:
    - id: vision.detection.subscribe
    - id: mavlink.read
    - id: mavlink.write
    - id: flight.guided_setpoint
    - id: event.publish
gcs:
  permissions:
    - id: ui.slot.flight-skill
    - id: ui.slot.node-detail-tab
  contributes:
    skills:
      - id: follow-me
        label: "Follow-Me"
        icon: "crosshair"
        category: behavior
        toggle: true
        confirm: true
        arm_requirement: armed
        default_binding: { key: "shift+f" }
        activation: { via: config, config_key: active }
        state: { via: event, topic: "follow.state" }
    target_actions:
      - id: follow
        label: "Follow this target"
        icon: crosshair
        order: 20
        applies_to_class: person
        designate: true
        config_key: active
        config_value: true
        default_key: "f"
      - id: stop-follow
        label: "Stop following"
        icon: circle-stop
        order: 21
        applies_to_class: person
        config_key: active
        config_value: false
        default_key: "x"
    tabs:
      - id: follow-me-tab
        slot: node.detail.tab
        profile: ["drone"]
        title: "Follow-Me"
        icon: "crosshair"
        order: 70
    parameters:
      - key: follow_distance_m
        binding: plugin.config
        schema: { type: number, minimum: 3, maximum: 30, step: 0.5, default: 8 }
        ui: { widget: range, label: "settings.followDistance", order: 10 }
      - key: follow_height_m
        binding: plugin.config
        schema: { type: number, minimum: 0, maximum: 20, step: 0.5, default: 4 }
        ui: { widget: range, label: "settings.followHeight", order: 20 }
      - key: gimbal_point
        binding: plugin.config
        schema: { type: boolean, default: true }
        ui: { widget: boolean, label: "settings.gimbalPoint", order: 30 }
`;

const BATTERY_MANIFEST = `schema_version: 2
id: com.altnautica.battery-health-panel
name: "ADOS Battery Health Panel"
version: "1.2.0"
icon: "battery"
description: "Cell-level battery diagnostics, predictive time-to-min, and anomaly alerts."
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/battery-health-panel"
author: "Altnautica"
license: "GPL-3.0-or-later"
risk: low
gcs:
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.notification-channel
    - id: telemetry.subscribe.battery
    - id: telemetry.subscribe.mavlink
    - id: recording.write
  contributes:
    tabs:
      - id: battery-health-tab
        slot: node.detail.tab
        profile: ["drone"]
        title: "Battery Health"
        icon: "battery"
        order: 30
    notifications:
      - id: battery-anomaly
        title: "Battery anomaly"
        severity: warning
`;

const GIMBAL_MANIFEST = `schema_version: 3
id: com.altnautica.mavlink-gimbal-v2
name: "ADOS MAVLink Gimbal v2 Controller"
version: "1.3.0"
icon: "gimbal"
description: "MAVLink Gimbal v2 control: manual sliders, ROI lock-on-target, and an 'Aim at this target' action that keeps the gimbal on a vision-locked detection."
description_long: |
  Drives a MAVLink gimbal-manager (component 154). Beyond manual pitch/yaw
  control it runs an on-companion visual servo: click a detected subject in
  the cockpit and the gimbal keeps it centred. A lock-state safety gate stops
  commanding the instant the vision engine reports the subject uncertain or
  lost, and it never silently re-locks onto a different subject.
features:
  - "MAVLink gimbal-manager control (component 154)"
  - "Aim-at-target visual servo with a lock-state safety gate"
  - "Angle and rate control modes"
  - "Recenter and nadir one-touch pointing"
hardware_requirements:
  fc_firmware: "ArduPilot or PX4 forwarding the gimbal-manager messages"
  boards: ["*"]
resource_impact:
  cpu_percent_peak: 8
  ram_mb: 48
  pids: 2
  output_rate_hz: 5
  startup_time_seconds: 2
telemetry_fields:
  - "gimbal"
documentation_url: "https://docs.altnautica.com/drone-agent/mavlink-gimbal-v2-overview"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/mavlink-gimbal-v2"
author: "Altnautica"
license: "GPL-3.0-or-later"
risk: medium
agent:
  runtime: python
  permissions:
    - id: mavlink.read
    - id: mavlink.write
    - id: mavlink.component.gimbal
    - id: vision.detection.subscribe
    - id: event.publish
gcs:
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.video-overlay
    - id: ui.slot.flight-skill
    - id: command.send
  contributes:
    tabs:
      - id: gimbal-control
        slot: node.detail.tab
        profile: ["drone"]
        title: "Gimbal"
        icon: "gimbal"
        order: 60
    panels:
      - id: gimbal-reticle
        slot: video.overlay
        title: "Gimbal reticle"
        icon: "crosshair"
    target_actions:
      - id: aim
        label: "Aim at this target"
        icon: crosshair
        order: 30
        designate: true
        config_key: aim
        config_value: true
        default_key: "g"
    skills:
      - id: aim
        label: "Aim"
        icon: crosshair
        category: camera
        toggle: true
        confirm: false
        arm_requirement: any
        default_binding: { key: "g" }
        activation: { via: config, config_key: aim }
        state: { via: event, topic: "sensor.gimbal.aim" }
      - id: recenter
        label: "Recenter"
        icon: locate-fixed
        category: camera
        toggle: false
        confirm: false
        arm_requirement: any
        default_binding: { key: "c" }
        activation: { via: config, config_key: recenter }
        state: { via: event, topic: "sensor.gimbal.recenter" }
    parameters:
      - key: designate_camera
        binding: agent.config
        schema: { type: string, default: "auto" }
        ui: { widget: text, label: "settings.title", order: 10 }
`;

const THERMAL_MANIFEST = `schema_version: 2
id: com.altnautica.thermal-flir-lepton-usb
name: "ADOS Thermal Camera FLIR Lepton USB UVC"
version: "1.2.0"
icon: "thermal"
description: "FLIR Lepton 3.5 radiometric thermal imaging via PureThermal 2 USB UVC dongle. Adds video overlay, FC config tab, and a MAVLink camera component."
description_long: |
  Drives a FLIR Lepton 3.5 over a PureThermal 2 USB UVC dongle. The plugin
  opens the device, colorizes the radiometric Y16 feed with a selectable
  palette, and exposes controls for high and low gain and a one-touch flat
  field correction. Cockpit Skills cycle the palette and trigger an FFC; the
  same palette and gain render on the video overlay, which reads a live spot
  temperature under the reticle.
features:
  - "Radiometric Y16 thermal imaging with selectable colour palettes"
  - "High / low gain (temperature sensitivity vs range)"
  - "One-touch flat field correction"
  - "Cockpit Skills to cycle the palette and run an FFC"
  - "Video overlay with a live spot temperature"
hardware_requirements:
  cameras: "FLIR Lepton 3.5 on a PureThermal 2 USB UVC dongle (firmware 1.2.2 or newer)"
  boards: ["cm4", "cm5", "rk3582", "rk3576", "rk3566", "x86"]
resource_impact:
  cpu_percent_peak: 30
  ram_mb: 160
  pids: 4
  output_rate_hz: 9
  startup_time_seconds: 3
telemetry_fields:
  - "thermal"
documentation_url: "https://docs.altnautica.com/drone-agent/thermal-camera-overview"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/thermal-camera-flir-lepton-usb"
author: "Altnautica"
license: "GPL-3.0-or-later"
risk: medium
agent:
  runtime: python
  permissions:
    - id: hardware.usb.uvc
    - id: video.source.set
    - id: telemetry.extend
    - id: event.publish
gcs:
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.video-overlay
    - id: ui.slot.settings-section
    - id: ui.slot.flight-skill
  contributes:
    tabs:
      - id: thermal-config
        slot: node.detail.tab
        profile: ["drone"]
        title: "Thermal Camera"
        icon: "camera"
        order: 50
    panels:
      - id: thermal-overlay
        slot: video.overlay
        title: "Thermal"
        icon: "thermometer"
    notifications:
      - id: thermal-alarm
        title: "Thermal alarm"
        severity: warning
    skills:
      - id: cycle-palette
        label: "Cycle palette"
        icon: palette
        category: camera
        toggle: false
        confirm: false
        arm_requirement: any
        default_binding: { key: "p" }
        activation: { via: config, config_key: palette_cycle }
        state: { via: event, topic: "camera.thermal.palette" }
      - id: ffc
        label: "Flat field correction"
        icon: refresh-cw
        category: camera
        toggle: false
        confirm: false
        arm_requirement: any
        default_binding: { key: "shift+f" }
        activation: { via: config, config_key: ffc }
        state: { via: event, topic: "camera.thermal.ffc" }
    parameters:
      - key: palette
        binding: plugin.config
        schema: { type: string, enum: ["ironbow", "rainbow", "grayscale"], default: "ironbow" }
        ui: { widget: enum, label: "settings.palette", order: 10 }
      - key: gain
        binding: plugin.config
        schema: { type: boolean, default: true }
        ui: { widget: boolean, label: "settings.gain", order: 20 }
`;

const VISION_NAV_MANIFEST = `schema_version: 2
id: com.altnautica.vision-nav
name: "ADOS Vision Navigation"
version: "0.3.3"
icon: "navigation"
description: "GPS-denied navigation. Optical flow (downward camera) and visual-inertial odometry (forward or downward camera). Supports ArduPilot, PX4, and iNav 7.0+ on USB UVC or CSI cameras."
description_long: |
  Lets the drone hold position when GPS is unreliable — indoors, under
  bridges, in urban canyons. A camera and the IMU feed the flight controller
  a 30 Hz position estimate over MAVLink, so position-hold, loiter, and
  missions keep working unchanged.

  Six modes: optical flow with a rangefinder, without one, OpenVINS VIO,
  VINS-Fusion VIO, Hybrid (both), or Off. Every 250 ms it checks itself and
  steps down the fallback ladder — VIO → optical flow → barometer hover →
  land — warning the GCS at each step.
features:
  - "Optical flow with or without rangefinder (Lucas-Kanade tracker)"
  - "Monocular VIO via OpenVINS or VINS-Fusion"
  - "Hybrid mode: optical flow and VIO running side by side"
  - "Auto-detect ArduPilot, PX4, or iNav and emit appropriate MAVLink"
  - "Per-mode pre-arm checks with degradation fallback ladder"
  - "Live telemetry: feature count, drift, sync offset, mode state"
hardware_requirements:
  cameras: "USB UVC global-shutter or rolling-shutter, or CSI via V4L2"
  fc_firmware: "ArduPilot 4.5+, PX4 1.14+, iNav 7.0+"
  boards: ["cm4", "cm5", "rk3582", "rk3588s2", "rk3576", "rpi5", "pi-zero-2w"]
resource_impact:
  output_rate_hz: 30
  cpu_percent_peak: 80
  ram_mb: 512
  pids: 24
  startup_time_seconds: 5
telemetry_fields:
  - "navigation.estimator_state"
  - "navigation.feature_count"
  - "navigation.drift_m"
  - "navigation.mode"
documentation_url: "https://docs.altnautica.com/drone-agent/vision-nav-overview"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/vision-nav"
author: "Altnautica"
license: "GPL-3.0-or-later"
risk: high
agent:
  runtime: rust
  permissions:
    - id: vision.frame.read
    - id: mavlink.read
    - id: mavlink.write
    - id: mavlink.component.vio
    - id: estimator.pose.inject
gcs:
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.flight-skill
    - id: ui.slot.notification-channel
    - id: command.send
  contributes:
    tabs:
      - id: vision-nav-tab
        slot: node.detail.tab
        title: "Vision Nav"
        icon: "compass"
        order: 60
        profile: ["drone"]
    notifications:
      - id: vision-nav-degraded
        title: "Vision navigation degraded"
        severity: warning
    skills:
      - id: engage
        label: "Engage"
        icon: navigation
        category: navigation
        toggle: true
        confirm: true
        arm_requirement: any
        default_binding: { key: "shift+n" }
        activation: { via: config, config_key: active }
        state: { via: event, topic: "navigation.engage" }
`;

function row(
  overrides: Partial<RegistryPluginRow> & Pick<RegistryPluginRow, "plugin_id">,
): RegistryPluginRow {
  return {
    _id: `demo-${overrides.plugin_id}`,
    name: overrides.plugin_id,
    description: "",
    category: "drivers",
    license: "GPL-3.0-or-later",
    author_id: "altnautica",
    verified_publisher: true,
    latest_version: "0.0.0",
    tier: "first_party",
    ...overrides,
  };
}

/** The demo registry entries, in display order. */
export const DEMO_REGISTRY_ENTRIES: ReadonlyArray<DemoRegistryEntry> = [
  {
    row: row({
      plugin_id: "com.altnautica.siyi-pod",
      name: "ADOS SIYI Optical Pod",
      description:
        "Native driver for the SIYI optical-pod line: gimbal, zoom, thermal, laser rangefinder, and on-pod AI tracking.",
      category: "drivers",
      latest_version: "0.4.0",
      icon: "camera",
    }),
    manifestYaml: SIYI_MANIFEST,
    downloadUrl:
      "https://github.com/altnautica/ADOSExtensions/releases/download/siyi-pod-v0.4.0/com.altnautica.siyi-pod-0.4.0.signed.adosplug",
    archiveSha256:
      "c88e424ed384d485fe44f49ea0e9c668aa53068b476a11b2b58cda9dc3cbeef2",
    archiveSizeBytes: 15089,
    signerKeyId: "altnautica-2026-A",
    supportedBoards: ["cm4", "cm5", "rk3582", "rk3588s2", "rk3576", "rpi5", "x86"],
  },
  {
    row: row({
      plugin_id: "com.altnautica.follow-me",
      name: "ADOS Follow-Me",
      description:
        "Lock onto an operator-designated subject and fly a fixed-distance standoff follow.",
      category: "ai",
      // Pinned to the last published tag (0.2.5). The extension's own
      // manifest.yaml has moved on to 0.2.6 (board-gate fix for the A733),
      // but no signed 0.2.6 release exists yet — do not point this entry at
      // an unpublished tag/asset. `supportedBoards` below is intentionally
      // ahead of `latest_version`: it mirrors the current manifest so the
      // demo board gate exercises the real check, while the installable
      // asset stays the verified 0.2.5 archive.
      latest_version: "0.2.5",
      icon: "follow",
    }),
    manifestYaml: FOLLOW_ME_MANIFEST,
    downloadUrl:
      "https://github.com/altnautica/ADOSExtensions/releases/download/follow-me-v0.2.5/com.altnautica.follow-me-0.2.5.signed.adosplug",
    archiveSha256:
      "d2b947c4b8a3e3e5290c4b671cf190f9cf63cfab0d7054e2761485deb20baf97",
    archiveSizeBytes: 78229,
    signerKeyId: "altnautica-2026-A",
    supportedBoards: [
      "cm4",
      "cm5",
      "rk3582",
      "rk3588s2",
      "rk3576",
      "rpi5",
      "cubie-a7s",
      "a733",
      "sun60iw2",
    ],
  },
  {
    row: row({
      plugin_id: "com.altnautica.battery-health-panel",
      name: "ADOS Battery Health Panel",
      description:
        "Cell-level battery diagnostics, predictive time-to-min, and anomaly alerts.",
      category: "telemetry",
      latest_version: "1.2.0",
      icon: "battery",
    }),
    manifestYaml: BATTERY_MANIFEST,
    downloadUrl:
      "https://github.com/altnautica/ADOSExtensions/releases/download/battery-health-panel-v1.2.0/com.altnautica.battery-health-panel-1.2.0.signed.adosplug",
    archiveSha256:
      "02bf5e3b530e6e1b7c8516a83bd8b5c24de9c82b18baa6c3a1fd7095b6a93c83",
    archiveSizeBytes: 10485,
    signerKeyId: "altnautica-2026-A",
    supportedBoards: ["*"],
  },
  {
    row: row({
      plugin_id: "com.altnautica.mavlink-gimbal-v2",
      name: "ADOS MAVLink Gimbal v2 Controller",
      description:
        "MAVLink Gimbal v2 control: manual sliders, ROI lock-on-target, and an 'Aim at this target' action.",
      category: "drivers",
      latest_version: "1.3.0",
      icon: "gimbal",
    }),
    manifestYaml: GIMBAL_MANIFEST,
    downloadUrl:
      "https://github.com/altnautica/ADOSExtensions/releases/download/mavlink-gimbal-v2-v1.3.0/com.altnautica.mavlink-gimbal-v2-1.3.0.signed.adosplug",
    archiveSha256:
      "083a7fd17ea2ef6bdecc640450179fa70e22b7646436bfc0078b78378e53f528",
    archiveSizeBytes: 14483,
    signerKeyId: "altnautica-2026-A",
    supportedBoards: ["*"],
  },
  {
    row: row({
      plugin_id: "com.altnautica.thermal-flir-lepton-usb",
      name: "ADOS Thermal Camera FLIR Lepton USB UVC",
      description:
        "FLIR Lepton 3.5 radiometric thermal imaging via PureThermal 2 USB UVC dongle.",
      category: "drivers",
      latest_version: "1.2.0",
      icon: "thermal",
    }),
    manifestYaml: THERMAL_MANIFEST,
    // NOTE: the extension directory is `thermal-camera-flir-lepton-usb`,
    // but its manifest `id` (and therefore the published asset basename) is
    // the shorter `thermal-flir-lepton-usb` — verified against the release's
    // actual asset listing, not guessed from the directory slug.
    downloadUrl:
      "https://github.com/altnautica/ADOSExtensions/releases/download/thermal-camera-flir-lepton-usb-v1.2.0/com.altnautica.thermal-flir-lepton-usb-1.2.0.signed.adosplug",
    archiveSha256:
      "e82ff33dfd35ebe5905c2c409bc0fd75f041d16117d4a7a8d31c7c4aad15daa6",
    archiveSizeBytes: 12891,
    signerKeyId: "altnautica-2026-A",
    supportedBoards: ["cm4", "cm5", "rk3582", "rk3576", "rk3566", "x86"],
  },
  {
    row: row({
      plugin_id: "com.altnautica.vision-nav",
      name: "ADOS Vision Navigation",
      description:
        "GPS-denied navigation via optical flow and visual-inertial odometry on ArduPilot, PX4, and iNav.",
      category: "ai",
      latest_version: "0.3.3",
      icon: "navigation",
    }),
    manifestYaml: VISION_NAV_MANIFEST,
    downloadUrl:
      "https://github.com/altnautica/ADOSExtensions/releases/download/vision-nav-v0.3.3/com.altnautica.vision-nav-0.3.3.signed.adosplug",
    archiveSha256:
      "d255afdb3746abfa81ca98698470bd1e8bf54c73364de209c756d2976444cf57",
    archiveSizeBytes: 1126629,
    signerKeyId: "altnautica-2026-A",
    supportedBoards: ["cm4", "cm5", "rk3582", "rk3588s2", "rk3576", "rpi5", "pi-zero-2w"],
  },
];
