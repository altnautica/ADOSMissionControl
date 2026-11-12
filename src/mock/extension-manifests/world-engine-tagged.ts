// Exempt from 300 LOC soft rule: verbatim published manifest.
/**
 * @module mock/extension-manifests/world-engine-tagged
 * @description The world-engine manifest at its newest tag, which the demo install mirrors.
 * @license GPL-3.0-only
 */

/** The world-engine manifest at its newest tag (no signed release asset yet). */
export const WORLD_ENGINE_TAGGED_MANIFEST = `schema_version: 3
id: com.altnautica.world-engine
name: "ADOS World Engine"
version: "2.1.17"
description: "3D world model from drone flights, reconstructed on a LAN compute node, plus perception offload for drones without an NPU."
description_long: |
  A drone captures pose-tagged keyframes from one camera up to an all-sides rig and streams them to a compute node on the same network (a workstation or a dedicated compute box). The node reconstructs a Gaussian splat, point cloud, mesh and occupancy grid, and serves them to Mission Control as a live world model you can orbit, measure and replay.

  The same compute node runs perception offload: a drone without an on-board accelerator streams its camera to the node, the node runs the detector, and detections return to the drone's own detection bus, so Follow-Me, the gimbal and the cockpit overlay work unchanged. A stale or link-lost detection is treated as lost, never extrapolated.

  Keyframes ride the LAN first, fall back to the radio link's auxiliary stream through a ground station (pose and status only), then to the cloud relay. The ground station relays the radio lane onto the LAN when no shared network reaches the drone.
features:
  - "Pose-tagged keyframe capture, one camera up to an all-sides rig"
  - "Resumable capture-session upload to a LAN reconstruction node with checksum verification"
  - "Staged reconstruction presets: preview, high fidelity, tour, warehouse and a LiDAR-only planar sweep"
  - "Gaussian splat, mesh, LAZ point cloud and occupancy with placement sidecars"
  - "Indoor products: floorplan, rooms, aisles, measurement, change detection and a static tour bundle"
  - "Live world-model streaming and Rerun recordings in Mission Control"
  - "Perception offload for NPU-less drones with a freshness and link-loss safety gate"
  - "LAN, radio-relay and cloud bearers with automatic failover"
hardware_requirements:
  cameras: "Any camera the vision engine publishes frames for"
  optional:
    - "A workstation or compute node on the drone's LAN; an NVIDIA or Apple Silicon GPU speeds reconstruction"
    - "COLMAP, a splat trainer and the converters pinned in agent/node/tools/tool-pins.json on the compute node"
    - "ffmpeg on the compute node for perception offload"
documentation_url: "https://docs.altnautica.com/drone-agent/extensions/world-engine"
author: "Altnautica"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/world-engine"
license: "GPL-3.0-or-later"
risk: high

compatibility:
  ados_version: ">=0.104.0"
  gcs_version: ">=0.58.0"
  supported_boards: ["*"]

agent:
  # Every process is a compiled Rust binary shipped per architecture as a
  # release payload. The main process (\`world-engine-link\`) runs on every
  # profile and picks its mode from the node profile the host passes in
  # ADOS_NODE_PROFILE; the capture and node services run only where their
  # profile matches.
  runtime: rust
  isolation: subprocess
  entrypoint: "bin:world-engine-link"
  target_profiles: [drone, ground-station, workstation, compute, visor]
  resources:
    class: heavy
    max_ram_mb: 16384
    max_cpu_percent: 800
    max_pids: 1024
  # The cap the host applies on the running node profile; \`resources\` is the
  # ceiling for a profile not listed. A 4 GB drone cannot give a reconstruction
  # node's 16 GB to one plugin, so the drone and visor caps bound the live
  # mapping stores (\`atlas.memory_budget_mb\` defaults to 80 % of this cap).
  resources_by_profile:
    drone:
      class: heavy
      max_ram_mb: 768
      max_cpu_percent: 200
      max_pids: 128
    visor:
      class: heavy
      max_ram_mb: 1536
      max_cpu_percent: 400
      max_pids: 1024
    ground-station:
      class: heavy
      max_ram_mb: 512
      max_cpu_percent: 200
      max_pids: 256
    workstation:
      class: heavy
      max_ram_mb: 16384
      max_cpu_percent: 800
      max_pids: 1024
    compute:
      class: heavy
      max_ram_mb: 16384
      max_cpu_percent: 800
      max_pids: 1024
  # The processes serve the extension's HTTP API on the host-created socket
  # and meet each other on private sockets in the same directory.
  http: true
  binaries:
    world-engine-link:
      aarch64-linux: bin/aarch64-linux/world-engine-link
      x86_64-linux: bin/x86_64-linux/world-engine-link
      aarch64-macos: bin/aarch64-macos/world-engine-link
    world-engine-capture:
      aarch64-linux: bin/aarch64-linux/world-engine-capture
      x86_64-linux: bin/x86_64-linux/world-engine-capture
    world-engine-node:
      aarch64-linux: bin/aarch64-linux/world-engine-node
      x86_64-linux: bin/x86_64-linux/world-engine-node
      aarch64-macos: bin/aarch64-macos/world-engine-node
      x86_64-windows: bin/x86_64-windows/world-engine-node.exe
  # Fetched at install, verified against sha256 and size, and covered by the
  # archive signature because they are declared here. Only the entries that
  # apply to the node's profile and architecture are downloaded. The release
  # workflow writes the real source, sha256 and size_bytes.
  payloads:
    - path: bin/aarch64-linux/world-engine-link
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-link-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
    - path: bin/x86_64-linux/world-engine-link
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-link-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
    - path: bin/aarch64-macos/world-engine-link
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-link-aarch64-macos"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-macos
    - path: bin/aarch64-linux/world-engine-capture
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-capture-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
      profiles: [drone, visor]
    - path: bin/x86_64-linux/world-engine-capture
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-capture-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [drone, visor]
    - path: bin/aarch64-linux/world-engine-node
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-node-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
      profiles: [workstation, compute]
    - path: bin/x86_64-linux/world-engine-node
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-node-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [workstation, compute]
    - path: bin/aarch64-macos/world-engine-node
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-node-aarch64-macos"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-macos
      profiles: [workstation, compute]
    - path: bin/x86_64-windows/world-engine-node.exe
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.17/world-engine-node-x86_64-windows.exe"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-windows
      profiles: [workstation, compute]
    # Native capture helpers (x86_64-linux; aarch64-linux is a manual release
    # step, see agent/capture/basalt/README.md) with their licence texts, and
    # uv for the on-device KISS-ICP environment sync.
    - path: bin/x86_64-linux/basalt-ados
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-basalt-ados-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [drone, visor]
    - path: bin/x86_64-linux/LICENSE-basalt-ados.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-basalt-ados-LICENSES-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [drone, visor]
    - path: lib/x86_64-linux/liblivox_lidar_sdk_shared.so
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-livox-sdk2-x86_64-linux.so"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
    - path: lib/x86_64-linux/LICENSE-livox-sdk2.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-livox-sdk2-LICENSE-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
    - path: bin/aarch64-linux/uv
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-uv-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
      profiles: [visor]
    - path: bin/x86_64-linux/uv
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-uv-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
    - path: bin/aarch64-linux/LICENSE-uv.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-uv-LICENSE-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
      profiles: [visor]
    - path: bin/x86_64-linux/LICENSE-uv.txt
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/world-engine-uv-LICENSE-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [visor]
    # The Rerun web viewer's wasm, served to the GCS half as a plugin asset.
    # Every profile serves the GCS module, so every profile fetches it.
    - path: gcs/assets/re_viewer_bg.wasm
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/world-engine-v2.1.0/re_viewer_bg.wasm"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
  declared_capabilities:
    - id: plugin.world-engine.world.read
      risk: low
      description: "Read the world-model descriptors (point cloud, occupancy, splat and mesh) this drone's reconstructions publish."
  permissions:
    # link: pose/state republish, status telemetry, radio relay lane, the LAN
    # bearer and mDNS, cloud bearer and detection tee, offload return and
    # advertisement, config writes from the Atlas API.
    # capture: engine frames and the flight-controller pose.
    # node: the :8092 listener, GPU access, job records.
    - id: telemetry.extend
    - id: event.publish
    - id: telemetry.read
    - id: node.info.read
    - id: vision.frame.read
    - id: vision.detection.publish
    - id: vision.offload.advertise
    - id: radio.aux_stream
    - id: network.outbound
    - id: network.listen
    - id: hardware.gpu
    - id: cloud.publish
    - id: cloud.records
    # capture: sensor bus + clock, session storage, FC EKF messages, the
    # onboard display page and front-panel buttons; link: MCP tools.
    - id: sensor.stream.read
    - id: capture.storage.write
    - id: mavlink.read
    - id: display.oled.page
    - id: button.subscribe
    - id: mcp.expose
    # link: the agent WHEP preview relay and the rig write relay; capture:
    # the exposure lock on the capture cameras.
    - id: video.whep.relay
    - id: sensors.rig.write
    - id: camera.control.write
    # capture (visor): a serial-port LiDAR such as an RPLIDAR, opened through
    # its USB serial bridge. Optional: without it the LiDAR driver cannot open
    # the port and the visor captures without live LiDAR scans.
    - id: hardware.uart
      required: false
      degraded_behavior: "No live serial LiDAR: the visor captures without LiDAR scans or LiDAR pose."
  contributes:
    services:
      - name: capture
        command: "bin:world-engine-capture com.altnautica.world-engine"
        profiles: [drone, visor]
      - name: node
        command: "bin:world-engine-node com.altnautica.world-engine"
        profiles: [workstation, compute]
        listen_ports: [8092]
    shared_topics:
      - topic: plugin.world-engine.pose
        subscribe_capability: telemetry.read
      - topic: plugin.world-engine.pointcloud
        subscribe_capability: plugin.world-engine.world.read
      - topic: plugin.world-engine.occupancy
        subscribe_capability: plugin.world-engine.world.read
      - topic: plugin.world-engine.splat
        subscribe_capability: plugin.world-engine.world.read
      - topic: plugin.world-engine.mesh
        subscribe_capability: plugin.world-engine.world.read
      - topic: plugin.world-engine.scan
        subscribe_capability: telemetry.read
      - topic: plugin.world-engine.map_status
        subscribe_capability: telemetry.read
    tools:
      - name: capture_start
        description: "Start a capture session on this device, optionally tagged with site, floor and room."
        safety_class: safe_write
        inputSchema:
          type: object
          properties:
            site: { type: string }
            floor: { type: integer }
            room: { type: string }
          additionalProperties: false
      - name: capture_stop
        description: "Stop the capture session; returns the final capture state."
        safety_class: safe_write
        inputSchema: { type: object, properties: {}, additionalProperties: false }
      - name: capture_mark
        description: "Mark the room and floor the operator just entered; returns the segment number."
        safety_class: safe_write
        inputSchema:
          type: object
          properties:
            room: { type: string, minLength: 1 }
            floor: { type: integer }
          required: [room]
          additionalProperties: false
      - name: sessions_list
        description: "List the capture sessions on this device with size, rooms and upload state."
        safety_class: read
        inputSchema: { type: object, properties: {}, additionalProperties: false }
      - name: reconstruct
        description: "Submit a reconstruction of an uploaded session to the paired compute node; returns the job id."
        safety_class: safe_write
        inputSchema:
          type: object
          properties:
            session_id: { type: string }
            preset: { type: string, enum: [preview, hq, tour, warehouse, planar-sweep] }
          required: [session_id, preset]
          additionalProperties: false
      - name: job_status
        description: "Read a reconstruction job's stage, progress and error from the paired compute node."
        safety_class: read
        inputSchema:
          type: object
          properties:
            job_id: { type: string }
          required: [job_id]
          additionalProperties: false
      - name: tour_bundle
        description: "Get the walkthrough tour bundle URL a finished reconstruction job produced."
        safety_class: read
        inputSchema:
          type: object
          properties:
            job_id: { type: string }
          required: [job_id]
          additionalProperties: false

gcs:
  entrypoint: "gcs/world-engine.mjs"
  isolation: inline
  permissions:
    - id: ui.slot.node-agent-page
    - id: ui.slot.node-surface
    - id: cloud.records
    - id: perception.read
    - id: telemetry.subscribe.status
  contributes:
    agent_pages:
      - { id: world-model, title: "World Model", section: videoVision, profile: [drone] }
      - { id: world-model-setup, title: "World Model setup", setup_for: world-model, profile: [drone] }
      - { id: live-world, title: "Live World", section: videoVision, after: world-model, profile: [drone] }
      - { id: offload, title: "Perception offload", section: videoVision, after: vision, profile: [drone, workstation, compute] }
      - { id: atlas-relay, title: "Atlas relay", section: radioLink, profile: [ground-station] }
    node_surfaces:
      - { id: overview, title: "Compute", profile: [workstation, compute], group: status, order: 10 }
      - { id: compute, title: "Jobs & outputs", profile: [workstation, compute], group: compute, order: 20 }
      - { id: capture, title: "Capture", profile: [visor], group: status, order: 20 }
      - { id: sessions, title: "Sessions", profile: [visor, drone], group: status, order: 30 }
      - { id: calibration, title: "Calibration", profile: [visor], group: device, order: 20 }
  locales:
    - en
`;
