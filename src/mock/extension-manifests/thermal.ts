// Exempt from 300 LOC soft rule: verbatim published manifest.
/**
 * @module mock/extension-manifests/thermal
 * @description The published thermal camera release the demo mirrors.
 * @license GPL-3.0-only
 */

import type { DemoExtensionRelease } from "./types";

export const THERMAL: DemoExtensionRelease = {
  tag: "thermal-camera-flir-lepton-usb-v1.2.0",
  downloadUrl:
    "https://github.com/altnautica/ADOSExtensions/releases/download/thermal-camera-flir-lepton-usb-v1.2.0/com.altnautica.thermal-flir-lepton-usb-1.2.0.signed.adosplug",
  archiveSha256: "e82ff33dfd35ebe5905c2c409bc0fd75f041d16117d4a7a8d31c7c4aad15daa6",
  archiveSizeBytes: 12891,
  manifestYaml: `schema_version: 2
id: com.altnautica.thermal-flir-lepton-usb
name: "ADOS Thermal Camera FLIR Lepton USB UVC"
version: "1.2.0"
description: "FLIR Lepton 3.5 radiometric thermal imaging via PureThermal 2 USB UVC dongle. Adds video overlay, FC config tab, and a MAVLink camera component."
description_long: |
  Drives a FLIR Lepton 3.5 over a PureThermal 2 USB UVC dongle. The plugin
  opens the device, colorizes the radiometric Y16 feed with a selectable
  palette, and exposes controls for high and low gain and a one-touch flat
  field correction. Cockpit Skills cycle the palette and trigger an FFC; the
  same palette and gain render on the video overlay, which reads a live spot
  temperature under the reticle. When a colorized stream endpoint is available
  the thermal feed is offered to the video pipeline as its own selectable
  stream leg.
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
author: "Altnautica"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/thermal-camera-flir-lepton-usb"
license: "GPL-3.0-or-later"
risk: medium

compatibility:
  ados_version: ">=0.99.125"
  gcs_version: ">=0.56.0"
  supported_boards: ["cm4", "cm5", "rk3582", "rk3576", "rk3566", "x86"]

agent:
  runtime: python
  entrypoint: "altnautica_thermal_camera.plugin:ThermalUsbPlugin"
  isolation: subprocess
  per_drone_config: true
  permissions:
    - id: hardware.usb.uvc
    - id: video.source.set
    - id: telemetry.extend
    - id: event.publish
    - id: event.subscribe
    - id: recording.write
    - id: mavlink.component.camera
  resources:
    max_ram_mb: 192
    max_cpu_percent: 35
    max_pids: 16
  mavlink_components:
    - component_id: 100
      component_kind: camera
      sub_id: 1

gcs:
  entrypoint: "gcs/plugin.bundle.js"
  isolation: iframe
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.video-overlay
    - id: ui.slot.notification-channel
    - id: ui.slot.settings-section
    - id: ui.slot.flight-skill
    - id: telemetry.subscribe.camera.thermal.frame
    - id: mission.read
    - id: mission.write
    - id: recording.write
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
    # One-shot cockpit Skills the agent fires on the rising edge and then
    # clears: advance the colour palette and trigger a flat field correction.
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
    # Native settings the agent reads live each control tick.
    parameters:
      - key: palette
        binding: plugin.config
        schema: { type: string, enum: ["ironbow", "rainbow", "grayscale"], default: "ironbow" }
        ui: { widget: enum, label: "settings.palette", group: "settings.title", order: 10 }
      - key: gain
        binding: plugin.config
        schema: { type: boolean, default: true }
        ui: { widget: boolean, label: "settings.gain", help: "settings.gainHelp", group: "settings.title", order: 20 }
  locales:
    - en
`,
};
