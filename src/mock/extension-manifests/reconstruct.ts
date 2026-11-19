// Exempt from 300 LOC soft rule: verbatim manifest.
/**
 * @module mock/extension-manifests/reconstruct
 * @description The Reconstruct extension's manifest at the head of its repository,
 * which the demo install mirrors. It has no published release yet, so the
 * demo catalog carries no row for it.
 * @license GPL-3.0-only
 */

import type { DemoExtensionManifest } from "./types";

export const RECONSTRUCT: DemoExtensionManifest = {
  manifestYaml: `schema_version: 3
id: com.altnautica.reconstruct
name: "ADOS Reconstruct"
version: "1.0.0"
description: "Reconstruct captured sessions on a LAN compute node, and offload perception for drones without an accelerator."
description_long: |
  A workstation or compute node turns captured sessions into a Gaussian splat, point cloud, mesh, occupancy and indoor products (floorplan, rooms, aisles, a static tour), and serves them to Mission Control to view, measure and export. Sessions arrive from the Capture extension, resumably and checksum-verified.

  The same node runs perception offload: a drone without an on-board accelerator streams its camera to the node, the node runs the detector, and detections return to the drone's own detection bus, so Follow-Me, the gimbal and the cockpit overlay work unchanged. A stale or link-lost detection is treated as lost, never extrapolated.

  When a drone's Navigation extension places its map on the node, the drone streams its scans here and the node builds the full-resolution live map.
features:
  - "Staged reconstruction presets: preview, high fidelity, tour, warehouse and a LiDAR-only planar sweep"
  - "Gaussian splat, mesh, LAZ point cloud and occupancy with placement sidecars"
  - "Indoor products: floorplan, rooms, aisles, measurement, change detection and a static tour bundle"
  - "Perception offload for NPU-less drones with a freshness and link-loss safety gate"
  - "A full-resolution live map from a streaming drone's scans"
hardware_requirements:
  optional:
    - "An NVIDIA or Apple Silicon GPU on the node speeds reconstruction"
    - "COLMAP, a splat trainer and the converters pinned in agent/node/tools/tool-pins.json on the node"
    - "ffmpeg on the node for perception offload"
documentation_url: "https://docs.altnautica.com/drone-agent/extensions/reconstruct"
author: "Altnautica"
homepage: "https://github.com/altnautica/ADOSExtensions/tree/main/extensions/reconstruct"
license: "GPL-3.0-or-later"
risk: high

compatibility:
  ados_version: ">=0.104.0"
  gcs_version: ">=0.66.0"
  supported_boards: ["*"]

agent:
  # Every process is a compiled Rust binary shipped per architecture as a
  # release payload. The main process (\`reconstruct-offload\`) runs on every
  # profile and picks its mode from the node profile the host passes in
  # ADOS_NODE_PROFILE: on a drone it offloads perception, streams the live
  # map's scans and serves the MCP tools; on a workstation or compute node it
  # idles while the \`node\` service runs.
  runtime: rust
  isolation: subprocess
  entrypoint: "bin:reconstruct-offload"
  target_profiles: [drone, workstation, compute]
  resources:
    class: heavy
    max_ram_mb: 16384
    max_cpu_percent: 800
    max_pids: 1024
  resources_by_profile:
    drone:
      class: heavy
      max_ram_mb: 128
      max_cpu_percent: 40
      max_pids: 16
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
  # The processes serve the extension's HTTP API on the host-created socket.
  http: true
  binaries:
    reconstruct-offload:
      aarch64-linux: bin/aarch64-linux/reconstruct-offload
      x86_64-linux: bin/x86_64-linux/reconstruct-offload
      aarch64-macos: bin/aarch64-macos/reconstruct-offload
    reconstruct-node:
      aarch64-linux: bin/aarch64-linux/reconstruct-node
      x86_64-linux: bin/x86_64-linux/reconstruct-node
      aarch64-macos: bin/aarch64-macos/reconstruct-node
      x86_64-windows: bin/x86_64-windows/reconstruct-node.exe
  # Fetched at install, verified against sha256 and size, and covered by the
  # archive signature because they are declared here. Only the entries that
  # apply to the node's profile and architecture are downloaded. The release
  # workflow writes the real source, sha256 and size_bytes.
  payloads:
    - path: bin/aarch64-linux/reconstruct-offload
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/reconstruct-offload-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
    - path: bin/x86_64-linux/reconstruct-offload
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/reconstruct-offload-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
    - path: bin/aarch64-macos/reconstruct-offload
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/reconstruct-offload-aarch64-macos"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-macos
    - path: bin/aarch64-linux/reconstruct-node
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/reconstruct-node-aarch64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-linux
      profiles: [workstation, compute]
    - path: bin/x86_64-linux/reconstruct-node
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/reconstruct-node-x86_64-linux"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-linux
      profiles: [workstation, compute]
    - path: bin/aarch64-macos/reconstruct-node
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/reconstruct-node-aarch64-macos"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: aarch64-macos
      profiles: [workstation, compute]
    - path: bin/x86_64-windows/reconstruct-node.exe
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/reconstruct-node-x86_64-windows.exe"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
      arch_os: x86_64-windows
      profiles: [workstation, compute]
    # The Rerun web viewer's wasm, served to the GCS half as a plugin asset.
    # Every profile serves the GCS module, so every profile fetches it.
    - path: gcs/assets/re_viewer_bg.wasm
      source: "https://github.com/altnautica/ADOSExtensions/releases/download/reconstruct-v1.0.0/re_viewer_bg.wasm"
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      size_bytes: 1
  permissions:
    # offload (drone): the reconciler's frame tee and detection return, the
    # node advertisement, the LAN streams, Navigation's map status and placed
    # scans, MCP tools, the status telemetry.
    # node (workstation, compute): the :8092 listener, GPU access, the job
    # store, cloud job records, the status telemetry.
    - id: telemetry.extend
    - id: event.subscribe
    - id: telemetry.read
    - id: plugin.navigation.map.read
      required: false
      degraded_behavior: "No live map is streamed to the node; sessions still reconstruct after upload."
    - id: node.info.read
    - id: vision.frame.read
    - id: vision.detection.publish
    - id: vision.offload.advertise
    - id: network.outbound
    - id: network.listen
    - id: hardware.gpu
    - id: cloud.records
    - id: capture.storage.write
    - id: mcp.expose
  contributes:
    services:
      - name: node
        command: "bin:reconstruct-node com.altnautica.reconstruct"
        profiles: [workstation, compute]
        listen_ports: [8092]
    tools:
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
  entrypoint: "gcs/reconstruct.mjs"
  isolation: inline
  permissions:
    - id: ui.slot.node-surface
    - id: ui.slot.node-agent-page
    - id: telemetry.subscribe.status
    - id: perception.read
    - id: cloud.records
  contributes:
    node_surfaces:
      - { id: reconstruct, title: "Reconstruct", profile: [workstation, compute], group: status, order: 20 }
    agent_pages:
      - { id: offload, title: "Perception offload", section: videoVision, after: vision, order: 10, profile: [drone] }
  locales:
    - en
`,
};
