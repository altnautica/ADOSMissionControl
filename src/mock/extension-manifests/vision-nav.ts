// Exempt from 300 LOC soft rule: verbatim published manifest.
/**
 * @module mock/extension-manifests/vision-nav
 * @description The published Vision Navigation release the demo mirrors.
 * @license GPL-3.0-only
 */

import type { DemoExtensionRelease } from "./types";

export const VISION_NAV: DemoExtensionRelease = {
  tag: "vision-nav-v0.6.7",
  downloadUrl:
    "https://github.com/altnautica/ADOSExtensions/releases/download/vision-nav-v0.6.7/com.altnautica.vision-nav-0.6.7.signed.adosplug",
  archiveSha256: "3d11a32b74771d4f8bca4a64a02d4288b3d633bcea17c817652a5af9569c5501",
  archiveSizeBytes: 870697,
  manifestYaml: `schema_version: 2
id: com.altnautica.vision-nav
name: "ADOS Vision Navigation"
version: "0.6.7"
description: "GPS-denied navigation. Optical flow from a downward camera, or an external pose (for example a lidar SLAM) sent as ODOMETRY with EKF source-set switching, plus a planar-scan obstacle feed. Supports ArduPilot, PX4, and iNav 7.0+."
description_long: |
  Lets the drone hold position when GPS is unreliable — indoors, under bridges, in urban canyons. A downward camera and the flight controller's gyro feed a 30 Hz angular-flow measurement over MAVLink, so position-hold, loiter, and missions keep working unchanged.

  Four modes: optical flow with a rangefinder (low altitude on textured ground), optical flow without one (barometer height for scale, or GPS height in outdoor mode; drifts above 5 m), external navigation, or Off.

  External navigation (ArduPilot) takes the pose another installed plugin publishes on a shared topic, such as a planar lidar SLAM, and sends it to the flight controller as ODOMETRY at up to 30 Hz. The plugin switches the EKF source set: to the external pose while it tracks, to the flight controller's own fallback set (optical flow) after a second of lost tracking, or, with GPS as primary, to the external pose only while the GPS fix is lost. It sets the EKF origin when the flight controller has none. An optional obstacle feed turns a shared planar scan into OBSTACLE_DISTANCE for the flight controller's proximity avoidance.

  Every tick it checks itself. If flow quality drops or the scale source goes unhealthy it steps down the scale ladder and warns the GCS at each step; a sustained degraded streak flips the companion node to CRITICAL.

  Works with ArduPilot 4.5+, PX4 1.14+, and iNav 7.0+. Rolling-shutter USB or CSI cameras are fine. Watch flow quality and the camera-IMU sync offset on the Vision Nav panel.
features:
  - "Optical flow with or without rangefinder (Lucas-Kanade tracker)"
  - "Rangefinder-free scale ladder (baro, GPS altitude in outdoor mode, then a static fallback)"
  - "Firmware selected in the plugin config (ArduPilot, PX4, iNav)"
  - "Per-mode pre-arm checks with degradation fallback ladder"
  - "Live telemetry: flow quality, flow rate, scale source, sync offset, mode state"
  - "External navigation: shared pose topic to ODOMETRY, EKF source-set switching, EKF origin"
  - "Planar-scan obstacle feed (OBSTACLE_DISTANCE, 72 sectors)"
  - "Live nav.state: active source set, tracking health, ODOMETRY and obstacle rates, nearest obstacle"
hardware_requirements:
  cameras: "USB UVC global-shutter or rolling-shutter, or CSI via V4L2"
  fc_firmware: "ArduPilot 4.5+, PX4 1.14+, iNav 7.0+"
  boards: ["cm4", "cm5", "rock-5c-lite", "rk3588s2", "rk3576", "rpi5"]
  optional:
    - "Rangefinder for the optical-flow mode: a TF-Luna on a companion serial port, or any rangefinder the flight controller publishes as DISTANCE_SENSOR"
    - "External navigation and the obstacle feed: a plugin publishing the shared pose and planar-scan topics (for example the World Engine extension with a planar lidar)"
resource_impact:
  output_rate_hz: 30
  cpu_percent_peak: 80
  ram_mb: 512
  pids: 24
  startup_time_seconds: 5
required_fc_parameters:
  ardupilot:
    - param: "FLOW_TYPE"
      value: "5"
      note: "Accept OPTICAL_FLOW over MAVLink"
    - param: "EK3_SRC_OPTIONS"
      note: "Select the optical-flow velocity source for the active EKF lane"
    - param: "VISO_TYPE"
      value: "1"
      note: "External navigation: accept ODOMETRY over MAVLink"
    - param: "EK3_SRC1_POSXY"
      value: "6"
      note: "External navigation: the external-nav source set (with EK3_SRC1_VELXY 6 and EK3_SRC1_YAW 1, compass)"
    - param: "VISO_DELAY_MS"
      note: "External navigation: the least age of a pose when its ODOMETRY reaches the flight controller (ODOMETRY carries the time the pose describes; a 10 Hz planar lidar pose is at least one 100 ms revolution old)"
    - param: "AHRS_OPTIONS"
      value: "16"
      note: "GNSS-denied: the flight controller sets the EKF origin at boot from AHRS_ORIGIN_LAT/LON/ALT (ArduPilot 4.7+)."
    - param: "AHRS_ORIGIN_LAT"
      note: "GNSS-denied: the take-off site; the same as external_nav.origin_lla"
    - param: "AHRS_ORIGIN_LON"
      note: "GNSS-denied: the take-off site; the same as external_nav.origin_lla"
    - param: "AHRS_ORIGIN_ALT"
      note: "GNSS-denied: the take-off site; the same as external_nav.origin_lla"
    - param: "COMPASS_AUTODEC"
      value: "0"
      note: "Before ArduPilot 4.7: 0, with COMPASS_DEC set to the site's declination."
    - param: "EK3_MAG_EF_LIM"
      note: "GNSS-denied with COMPASS_AUTODEC on: above 0 (default 50), so EKF3 takes the declination from its own table at the origin and the compass library's later update cannot step the yaw."
    - param: "ARMING_SKIPCHK"
      value: "8"
      note: "GNSS-denied: skip the GPS pre-arm check."
    - param: "PRX1_TYPE"
      value: "2"
      note: "Obstacle feed: accept OBSTACLE_DISTANCE over MAVLink"
  px4:
    - param: "EKF2_OF_CTRL"
      note: "Enable optical-flow fusion"
  inav:
    - param: "opflow_hardware"
      value: "MAVLINK"
    - param: "nav_use_optflow_for_poshold"
      value: "ON"
telemetry_fields:
  - "navigation.mode"
  - "navigation.estimatorState"
  - "navigation.companionState"
  - "navigation.flowQuality"
  - "navigation.flowRateHz"
  - "navigation.flowDistanceM"
  - "navigation.flowScaleSource"
  - "navigation.rangefinderTopology"
  - "navigation.imuSource"
  - "navigation.imuRateHz"
  - "navigation.cameraIntrinsicsLoaded"
  - "navigation.cameraImuSyncOffsetMs"
  - "navigation.preArmReport"
  - "navigation.emitErrors"
  - "navigation.rangefinderError"
  - "navigation.degradedReasons"
  - "navigation.fcParams"
  - "navigation.poseAgeMs"
  - "nav.state"
documentation_url: "https://docs.altnautica.com/drone-agent/vision-nav-overview"
author: "Altnautica"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/vision-nav"
license: "GPL-3.0-or-later"
risk: high

compatibility:
  ados_version: ">=0.99.125"
  gcs_version: ">=0.56.0"
  supported_boards: ["cm4", "cm5", "rock-5c-lite", "rk3588s2", "rk3576", "rpi5"]

agent:
  # The agent half is a compiled Rust binary. The plugin host execs it
  # directly under systemd (not through the Python runner), passing the
  # per-plugin socket on the command line and the capability token +
  # agent id through the unit environment. The pack step places the
  # cross-compiled aarch64 binary at the entrypoint path in the archive.
  runtime: rust
  entrypoint: "bin/vision-nav"
  isolation: subprocess
  permissions:
    # Every grant below has a call site in agent/src; a grant with no
    # call site is not requested. The plugin does not open a camera: it
    # reads normalized frames from the shared vision frame bus, so
    # vision.frame.read replaces the camera / UVC / CSI / depth grants.
    - id: vision.frame.read
    - id: hardware.uart
    - id: telemetry.extend
    - id: event.publish
    # Subscribes to the shared pose and planar-scan topics; both owners
    # gate them on telemetry.read.
    - id: event.subscribe
    - id: telemetry.read
    - id: mavlink.read
    # OPTICAL_FLOW, OPTICAL_FLOW_RAD, DISTANCE_SENSOR, OBSTACLE_DISTANCE,
    # COMMAND_LONG (MAV_CMD_SET_EKF_SOURCE_SET, MAV_CMD_REQUEST_MESSAGE,
    # MAV_CMD_SET_MESSAGE_INTERVAL) and PARAM_REQUEST_READ.
    - id: mavlink.write
    # ODOMETRY (#331) and SET_GPS_GLOBAL_ORIGIN (#48) reach the flight
    # controller's state estimator.
    - id: estimator.pose.inject
    - id: mavlink.component.vio
  resources:
    max_ram_mb: 512
    max_cpu_percent: 80
    max_pids: 24
  mavlink_components:
    - component_id: 198
      component_kind: vio
      sub_id: 1
    # ODOMETRY and OBSTACLE_DISTANCE (MAV_COMP_ID_VISUAL_INERTIAL_ODOMETRY).
    - component_id: 197
      component_kind: vio
      sub_id: 2

gcs:
  entrypoint: "gcs/plugin.bundle.js"
  isolation: iframe
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.flight-skill
    - id: telemetry.subscribe.navigation
  contributes:
    tabs:
      - id: vision-nav-tab
        slot: node.detail.tab
        title: "Vision Nav"
        icon: "compass"
        order: 60
        profile: ["drone"]
    # A cockpit Skill that engages / disengages the estimator. Arming it feeds
    # the flight controller a flow measurement over MAVLink, so the toggle
    # confirms before it engages rather than firing on a single keypress. The
    # agent polls the \`active\` per-drone key every second and restarts on a
    # change, idling vision navigation (effective mode off, nothing emitted)
    # when disengaged.
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
  locales:
    - en
`,
};
