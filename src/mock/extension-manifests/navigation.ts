// Exempt from 300 LOC soft rule: verbatim manifest.
/**
 * @module mock/extension-manifests/navigation
 * @description The Navigation extension's manifest at the head of its repository,
 * which the demo install mirrors. It has no published release yet, so the
 * demo catalog carries no row for it.
 * @license GPL-3.0-only
 */

import type { DemoExtensionManifest } from "./types";

export const NAVIGATION: DemoExtensionManifest = {
  manifestYaml: `schema_version: 3
id: com.altnautica.navigation
name: "ADOS Navigation"
version: "1.0.0"
description: "GNSS-denied navigation: optical flow, LiDAR SLAM and VIO poses, a live occupancy map, and the external-navigation bridge to the flight controller."
description_long: |
  Lets the drone hold position when GPS is unreliable — indoors, under bridges, in urban canyons. A downward camera and the flight controller's gyro feed a 30 Hz angular-flow measurement over MAVLink, so position-hold, loiter, and missions keep working unchanged.

  Four modes: optical flow with a rangefinder (low altitude on textured ground), optical flow without one (barometer height for scale, or GPS height in outdoor mode; drifts above 5 m), external navigation, or Off.

  The lidar-slam service runs a pose of its own when the rig carries the sensors for one: planar scan matching on a 2D LiDAR, KISS-ICP on a 3D LiDAR, or stereo visual-inertial odometry on a Visor. It builds a live occupancy map and sweep cloud from that pose and publishes the pose, the binned scans, the map and the LiDAR link on shared topics.

  External navigation (ArduPilot) takes that pose, or one another plugin publishes, and sends it to the flight controller as ODOMETRY at up to 30 Hz. The plugin switches the EKF source set: to the external pose while it tracks, to the flight controller's own fallback set (optical flow) after a second of lost tracking, or, with GPS as primary, to the external pose only while the GPS fix is lost. It sets the EKF origin when the flight controller has none. An optional obstacle feed turns the planar scan into OBSTACLE_DISTANCE for the flight controller's proximity avoidance.

  Every tick it checks itself. If flow quality drops or the scale source goes unhealthy it steps down the scale ladder and warns the GCS at each step; a sustained degraded streak flips the companion node to CRITICAL.

  Works with ArduPilot 4.5+, PX4 1.14+, and iNav 7.0+. Rolling-shutter USB or CSI cameras are fine. Watch flow quality, the pose provider and the LiDAR link on the Navigation page; the cockpit's Navigation panel shows the source set, tracking, pose age and nearest obstacle in flight.
features:
  - "Optical flow with or without rangefinder (Lucas-Kanade tracker)"
  - "Rangefinder-free scale ladder (baro, GPS altitude in outdoor mode, then a static fallback)"
  - "Firmware selected in the plugin config (ArduPilot, PX4, iNav)"
  - "Per-mode pre-arm checks with degradation fallback ladder"
  - "Live telemetry: flow quality, flow rate, scale source, sync offset, mode state"
  - "LiDAR SLAM (planar scan matching, KISS-ICP) and stereo VIO poses in a north-aligned map frame"
  - "Live occupancy map and sweep cloud, built on board or streamed to a reconstruction node"
  - "External navigation: shared pose topic to ODOMETRY, EKF source-set switching, EKF origin"
  - "Planar-scan obstacle feed (OBSTACLE_DISTANCE, 72 sectors)"
  - "Live nav.state: active source set, tracking health, ODOMETRY and obstacle rates, nearest obstacle"
hardware_requirements:
  cameras: "USB UVC global-shutter or rolling-shutter, or CSI via V4L2"
  fc_firmware: "ArduPilot 4.5+, PX4 1.14+, iNav 7.0+"
  boards: ["cm4", "cm5", "rock-5c-lite", "rk3588s2", "rk3576", "rpi5"]
  optional:
    - "Rangefinder for the optical-flow mode: a TF-Luna on a companion serial port, or any rangefinder the flight controller publishes as DISTANCE_SENSOR"
    - "A planar LiDAR on this extension's lidar-slam service (an RPLIDAR on a serial port), or a 3D LiDAR (Livox) on a Visor, declared in the rig"
    - "A front stereo pair and an IMU on a Visor for the VIO pose"
resource_impact:
  output_rate_hz: 30
  cpu_percent_peak: 80
  ram_mb: 320
  pids: 64
  startup_time_seconds: 5
required_fc_parameters:
  ardupilot:
    - param: "FLOW_TYPE"
      value: "5"
      note: "Accept OPTICAL_FLOW over MAVLink. External navigation fuses the flow velocity too (EK3_SRC1_VELXY 5)."
    - param: "RNGFND1_TYPE"
      note: "A downward rangefinder (orientation 25): the EKF scales flow by the height above the ground. 10 (MAVLink) when a combined flow-and-range module such as the MTF-01P sends both over MAVLink; otherwise the type of the rangefinder wired to the flight controller."
    - param: "EK3_SRC_OPTIONS"
      note: "Select the optical-flow velocity source for the active EKF lane"
    - param: "VISO_TYPE"
      value: "1"
      note: "External navigation: accept ODOMETRY over MAVLink"
    - param: "EK3_SRC1_POSXY"
      value: "6"
      note: "External navigation: the external-nav source set takes position from the pose"
    - param: "EK3_SRC1_VELXY"
      value: "5"
      note: "External navigation: velocity from the optical-flow sensor, measured rather than differenced from late poses, so the EKF holds velocity between poses (0 without a flow sensor). Never 6: ArduPilot ignores the ODOMETRY velocity covariance, and a pose-difference velocity is far worse than VISO_VEL_M_NSE claims in fast manoeuvres; 6 blocks the pre-arm."
    - param: "EK3_SRC1_YAW"
      value: "1"
      note: "External navigation: compass yaw. 6 (yaw from the pose) only when the pose provider declares a north it holds itself (Navigation's navigation.takeoff_heading_deg); a map north that follows the flight controller's heading blocks the pre-arm."
    - param: "VISO_DELAY_MS"
      note: "External navigation: the typical (median) age of a pose when its ODOMETRY reaches the flight controller, at most 250. EKF3 fuses every pose at its arrival minus this delay (its jitter correction anchors to the youngest arrival and its IMU buffer reaches back this far), so each millisecond off is a position error of speed times that millisecond; poses older than 250 ms cannot be placed and make the vehicle sway."
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
documentation_url: "https://docs.altnautica.com/drone-agent/navigation-overview"
author: "Altnautica"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/navigation"
license: "GPL-3.0-or-later"
risk: high

compatibility:
  ados_version: ">=0.104.0"
  gcs_version: ">=0.66.0"
  supported_boards: ["*"]

agent:
  # Two compiled Rust processes, shipped per architecture as release
  # payloads: the entrypoint (\`navigation\`: optical flow, the
  # external-navigation bridge and the obstacle feed; the only process that
  # writes MAVLink) and the \`lidar-slam\` service (the LiDAR and VIO pose, the
  # live map and the shared navigation topics).
  runtime: rust
  isolation: subprocess
  entrypoint: "bin:navigation"
  target_profiles: [drone, visor]
  # lidar-slam serves /navigation/{config,status,sweep} on the host-created
  # socket.
  http: true
  resources:
    class: heavy
    max_ram_mb: 768
    max_cpu_percent: 200
    max_pids: 512
  # navigation.memory_budget_mb defaults to 80 % of the running profile's cap.
  resources_by_profile:
    drone:
      class: heavy
      max_ram_mb: 320
      max_cpu_percent: 80
      max_pids: 64
    visor:
      class: heavy
      max_ram_mb: 768
      max_cpu_percent: 200
      max_pids: 512
  binaries:
    navigation:
      aarch64-linux: bin/aarch64-linux/navigation
      x86_64-linux: bin/x86_64-linux/navigation
    navigation-lidar-slam:
      aarch64-linux: bin/aarch64-linux/navigation-lidar-slam
      x86_64-linux: bin/x86_64-linux/navigation-lidar-slam
  # Fetched at install, verified against sha256 and size, and covered by the
  # archive signature because they are declared here. Only the entries that
  # apply to the node's profile and architecture are downloaded. The release
  # workflow writes the real source, sha256 and size_bytes.
  payloads:
    - path: bin/aarch64-linux/navigation
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
    - path: bin/x86_64-linux/navigation
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
    - path: bin/aarch64-linux/navigation-lidar-slam
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-lidar-slam-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
    - path: bin/x86_64-linux/navigation-lidar-slam
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-lidar-slam-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
    # Native helpers (x86_64-linux; aarch64-linux is a manual release step,
    # see lidar-slam/basalt/README.md) with their licence texts, and uv for
    # the on-device KISS-ICP environment sync.
    - path: bin/x86_64-linux/basalt-ados
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-basalt-ados-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
    - path: bin/x86_64-linux/LICENSE-basalt-ados.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-basalt-ados-LICENSES-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
    - path: lib/x86_64-linux/liblivox_lidar_sdk_shared.so
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-livox-sdk2-x86_64-linux.so"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
    - path: lib/x86_64-linux/LICENSE-livox-sdk2.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-livox-sdk2-LICENSE-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
    - path: bin/aarch64-linux/uv
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-uv-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
      profiles: [visor]
    - path: bin/x86_64-linux/uv
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-uv-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
    - path: bin/aarch64-linux/LICENSE-uv.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-uv-LICENSE-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
      profiles: [visor]
    - path: bin/x86_64-linux/LICENSE-uv.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/navigation-v1.0.0/navigation-uv-LICENSE-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
  permissions:
    # navigation (entrypoint): flow from the vision frame bus, the companion
    # rangefinder, the FC bridge. lidar-slam: the stereo frames VIO tracks
    # on, the LiDAR and IMU from the sensor bus, the FC messages the map
    # reads, the capture state it streams raw scans for.
    - id: vision.frame.read
    - id: hardware.uart
      required: false
      degraded_behavior: "No companion serial rangefinder and no serial LiDAR: optical flow takes its height from the flight controller's rangefinder or the barometer, and the LiDAR pose needs a LiDAR on the sensor bus."
    - id: telemetry.extend
    - id: event.publish
    - id: event.subscribe
    - id: telemetry.read
    - id: node.info.read
    - id: mavlink.read
    # OPTICAL_FLOW, OPTICAL_FLOW_RAD, DISTANCE_SENSOR, OBSTACLE_DISTANCE,
    # COMMAND_LONG (MAV_CMD_SET_EKF_SOURCE_SET, MAV_CMD_REQUEST_MESSAGE,
    # MAV_CMD_SET_MESSAGE_INTERVAL) and PARAM_REQUEST_READ.
    - id: mavlink.write
    # ODOMETRY (#331) and SET_GPS_GLOBAL_ORIGIN (#48) reach the flight
    # controller's state estimator.
    - id: estimator.pose.inject
    - id: mavlink.component.vio
    - id: sensor.stream.read
    # A network LiDAR: an RPLIDAR over TCP and the Livox command channel.
    - id: network.outbound
      required: false
      degraded_behavior: "No network LiDAR: the LiDAR pose needs a serial LiDAR or one on the sensor bus."
  mavlink_components:
    - component_id: 198
      component_kind: vio
      sub_id: 1
    # ODOMETRY and OBSTACLE_DISTANCE (MAV_COMP_ID_VISUAL_INERTIAL_ODOMETRY).
    - component_id: 197
      component_kind: vio
      sub_id: 2
  declared_capabilities:
    - id: plugin.navigation.map.read
      risk: low
      description: "Read the live occupancy tiles and the full LiDAR scans this aircraft's navigation builds."
  contributes:
    services:
      - name: lidar-slam
        command: "bin:navigation-lidar-slam com.altnautica.navigation"
        profiles: [drone, visor]
    shared_topics:
      - { topic: plugin.navigation.pose, subscribe_capability: telemetry.read }
      - { topic: plugin.navigation.scan, subscribe_capability: telemetry.read }
      - { topic: plugin.navigation.map_status, subscribe_capability: telemetry.read }
      - { topic: plugin.navigation.lidar, subscribe_capability: telemetry.read }
      - { topic: plugin.navigation.occupancy, subscribe_capability: plugin.navigation.map.read }
      - { topic: plugin.navigation.scan_polar, subscribe_capability: plugin.navigation.map.read }
      - { topic: plugin.navigation.scan_raw, subscribe_capability: plugin.navigation.map.read }
      - { topic: plugin.navigation.pose_track, subscribe_capability: plugin.navigation.map.read }

gcs:
  entrypoint: "gcs/plugin.bundle.js"
  isolation: iframe
  permissions:
    - id: ui.slot.cockpit-panel
    - id: ui.slot.node-agent-page
    - id: ui.slot.flight-skill
    - id: telemetry.subscribe.navigation
  contributes:
    # One bundle serves both; it routes on the contribution it is mounted as.
    panels:
      - id: navigation-health
        slot: cockpit.panel
        title: "Navigation"
        icon: "compass"
        order: 40
        profile: ["drone"]
    agent_pages:
      - { id: navigation, title: "Navigation", section: videoVision, after: vision, order: 20, profile: [drone, visor] }
    # A cockpit Skill that engages / disengages the estimator. Arming it feeds
    # the flight controller a flow measurement over MAVLink, so the toggle
    # confirms before it engages rather than firing on a single keypress. The
    # agent polls the \`active\` per-drone key every second and restarts on a
    # change, idling navigation (effective mode off, nothing emitted)
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
