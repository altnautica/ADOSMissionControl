# Altnautica Mission Control

**Open-source web ground station for software-defined drones. ArduPilot, PX4, Betaflight, and iNav. Mission planning, AI tuning, and gamepad flight, in the browser.**

![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green.svg) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg) ![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg) [![Discord](https://img.shields.io/badge/Discord-Join-5865F2.svg)](https://discord.gg/uxbvuD4d5q)

Command any drone from any browser. ADOS Mission Control is a full ground control station for software-defined drones. Configure flight controllers panel by panel, plan missions with pattern generators, fly with a gamepad at 50 Hz, and tune PIDs with AI. No install. No locked hardware.

> **Part of the ADOS ecosystem.** Pairs with [ADOS Drone Agent](https://github.com/altnautica/ADOSDroneAgent), the Rust-first onboard companion, for the long-range data link, HD video, and cloud fleet management. Works standalone with any MAVLink drone over USB or WebSocket. Add features with [ADOS Extensions](https://github.com/altnautica/ADOSExtensions), the first-party plugin repo.

<p align="center">
  <strong><a href="https://command.altnautica.com">Live App</a></strong> |
  <strong><a href="https://docs.altnautica.com">Docs</a></strong> |
  <strong><a href="https://github.com/altnautica/ADOSExtensions">ADOS Extensions</a></strong> |
  <strong><a href="https://command.altnautica.com/community/changelog">Changelog</a></strong> |
  <strong><a href="https://discord.gg/uxbvuD4d5q">Discord</a></strong> |
  <strong><a href="mailto:team@altnautica.com">Email</a></strong> |
  <strong><a href="https://command.altnautica.com/community/contact">Contact</a></strong>
</p>

---

<p align="center">
  <img src="public/screenshots/dashboard.png" alt="Fleet Dashboard" width="100%">
</p>

---

<table>
  <tr>
    <td width="50%">
      <img src="public/screenshots/mission-planner.png" alt="Mission Planner" height="220" width="100%"><br>
      <sub>Mission planning with pattern generators and terrain following</sub>
    </td>
    <td width="50%">
      <img src="public/screenshots/flight-control.png" alt="Flight Control" height="220" width="100%"><br>
      <sub>Gamepad and HOTAS flight controls at 50 Hz</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="public/screenshots/3d-simulation.png" alt="3D Simulation" height="220" width="100%"><br>
      <sub>Cesium 3D globe with real terrain and flight path replay</sub>
    </td>
    <td width="50%">
      <img src="public/screenshots/configure.png" alt="FC Configuration" height="220" width="100%"><br>
      <sub>Nearly 60 panels for full flight controller setup</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="public/screenshots/parameters.png" alt="FC Parameters" height="220" width="100%"><br>
      <sub>Search, edit, and write all FC parameters</sub>
    </td>
    <td width="50%">
      <img src="public/screenshots/flashtool.png" alt="Firmware Flash Tool" height="220" width="100%"><br>
      <sub>WebUSB firmware flashing, no external flasher needed</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="public/screenshots/planning.png" alt="Mission Planning" height="220" width="100%"><br>
      <sub>Drag-and-drop waypoint editor with terrain profile and mission validation</sub>
    </td>
    <td width="50%">
      <img src="public/screenshots/drone-agent-overview.png" alt="Drone Agent Overview" height="220" width="100%"><br>
      <sub>Real-time agent monitoring with service status, system resources, and live logs</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="public/screenshots/drone-agent-fleet.png" alt="Fleet Network" height="220" width="100%"><br>
      <sub>MeshNet fleet enrollment, MQTT gateway status, mesh radio peers, and network topology</sub>
    </td>
    <td width="50%">
      <img src="public/screenshots/drone-agent-peripherals.png" alt="Peripherals" height="220" width="100%"><br>
      <sub>Connected peripheral detection with live sensor readings (IMU, GPS, barometer, camera, radio)</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="public/screenshots/simulate-3d.png" alt="3D Mission Simulation" height="220" width="100%"><br>
      <sub>3D mission simulation with waypoints over terrain, playback controls, and camera presets</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

---

## What it lets you do

- **Connect to any drone, no driver install.** Plug in over USB (WebSerial), point at a MAVLink WebSocket, or pair with an ADOS agent over your LAN.
- **Set up the whole flight controller.** Nearly 60 panels cover calibration, PID tuning, receivers, outputs, failsafe, power, ports, OSD, firmware flashing, and the iNav-specific surfaces.
- **Plan a mission by drawing it.** Drop waypoints on the map, generate survey, orbit, corridor, SAR, and structure-scan patterns, follow terrain, set geofences and rally points, then validate before upload.
- **Fly with a real controller.** Gamepad, HOTAS, RC transmitter, or keyboard at 50 Hz, with arm/disarm, mode switching, guided flight, and a kill switch.
- **Rehearse in 3D.** Replay a mission over real terrain on a Cesium globe before you fly it.
- **Tune PIDs with help.** FFT-driven noise and motor-health analysis suggests filter settings and PID values.
- **Manage a fleet from anywhere.** Cloud mode adds multi-drone dashboards, mission sync, and real-time telemetry over MQTT.
- **Sign your commands.** HMAC-SHA256 on every outbound MAVLink v2 frame, with the key held only in your browser.
- **Self-host all of it.** Field operations work fully offline, and the cloud relay can run entirely on your own servers.

## Quick Start

Try it right now at [command.altnautica.com](https://command.altnautica.com). No install needed. Demo mode loads simulated drones with live telemetry, mission planning, and full FC configuration.

Or run locally:

```bash
git clone https://github.com/altnautica/ADOSMissionControl.git
cd ADOSMissionControl
npm install
npm run demo
```

Open [http://localhost:4000](http://localhost:4000). Simulated drones, no hardware required.

---

## What ADOS Mission Control Is

- **Platform:** Browser-based. Runs on any OS with a modern browser. Optional Electron desktop build for WebSerial and WebUSB access.
- **Firmware:** ArduPilot, PX4, Betaflight, and iNav as first-class targets.
- **Protocol:** MAVLink v2 and MSP v1/v2 in the same app, behind a unified `DroneProtocol` adapter interface.
- **Flight control:** Gamepad, HOTAS, RC transmitter, or keyboard input at 50 Hz.
- **AI tuning:** PID and filter analysis with FFT-driven noise and motor-health diagnosis.
- **3D simulation:** CesiumJS globe with real terrain and flight path replay.
- **Fleet mode:** MQTT and Convex relay for multi-drone dashboards. Self-hostable end to end.
- **License:** GPL-3.0-only.

The browser side is TypeScript. The onboard agent it pairs with, [ADOS Drone Agent](https://github.com/altnautica/ADOSDroneAgent), is Rust-first, which is what carries the long-range link, HD video, and headless operation on small boards.

---

## What It Does

### Configure your flight controller

Nearly 60 panels covering calibration, PID tuning, receiver, outputs, failsafe, power, ports, OSD, firmware flashing, plus iNav-specific panels for safehomes, geozones, navigation config, profiles, output mapping, servos, temp sensors, MC braking, rate dynamics, and mission summary. Works with ArduPilot, PX4, Betaflight, and iNav. **AI PID tuning** analyzes FFT noise and motor health, then suggests filter settings and PID values. Board auto-detection for firmware flashing. WebUSB firmware flashing with no external tools.

### Plan missions

Drag waypoints on an interactive map. Pattern generators for survey (boustrophedon), orbit, corridor, SAR (expanding square, sector, parallel track), structure scan, plus automated landing approaches. Terrain following via the Open Elevation API. Geofence editor, rally points, batch waypoint editing, and mission validation before upload. Import and export KML, KMZ, CSV, `.waypoints`, `.plan`.

### Fly and simulate

Gamepad, HOTAS, RC transmitter, or keyboard input at 50 Hz. Arm/disarm, mode switching, guided flight, mission execution, kill switch. 3D Cesium globe simulation with real terrain, flight path replay, and camera presets.

### Monitor telemetry

Real-time attitude, GPS, battery, EKF status, vibration, RSSI, and sensor health. Pre-arm check visualization. Alert feed from the flight controller. Ring-buffered stores keep memory bounded across long sessions.

### Sign MAVLink commands

HMAC-SHA256 on every outbound MAVLink v2 frame. The 32-byte key lives only in your browser as a non-extractable Web Crypto key, and is enrolled with the flight controller once via `SETUP_SIGNING`. Flip require mode from the Configure tab Security panel to make the flight controller reject any unsigned command. ArduPilot 4.0 and newer supported today. See [docs](https://docs.altnautica.com/mission-control/mavlink-signing).

### Connect locally or over the cloud

ADOS is local-first. In field mode the GCS talks directly to hardware over WebSerial or WebSocket, or to an ADOS agent over the LAN by hostname or IP, with no cloud account. Cloud mode adds fleet management, mission sync, and MQTT telemetry relay for reaching drones across networks. When paired with ADOS Drone Agent, the GCS receives live telemetry at 2 Hz and faster and can send commands through the relay.

### Manage a ground station

When the paired agent runs in the ground-station profile, the node panel shows role-gated surfaces instead of the flight tabs: Network (uplink priority across WiFi, ethernet, and cellular, plus access-point management), Distributed RX (single-node link stats, relay list, combined stream stats), Mesh (batman-adv health, neighbors, gateways, and the pairing accept window), Display and Physical UI (OLED screens and button mappings), and Peripherals (connected USB and GPIO hardware). A role badge in the top bar shows at a glance whether a node is running as `direct`, `relay`, or `receiver`, and mesh events surface as non-blocking toasts.

---

## Firmware Support

| Firmware | Protocol | Status |
|----------|----------|--------|
| ArduPilot (Copter / Plane / Rover / Sub) | MAVLink v2 | Full |
| PX4 | MAVLink v2 | Full |
| Betaflight | MSP v1/v2 | Full |
| iNav | MSP v1/v2 | Full |

---

## By the Numbers

~98K lines of TypeScript. Nearly 60 FC panels. 83 MAVLink message decoders. 65 iNav decoders. 7 mission pattern generators. Over 60 ring-buffered Zustand stores. Full demo mode with zero setup.

---

## Platform Support

| Platform | Requirements | Notes |
|----------|-------------|-------|
| Web (recommended) | Chrome 89+ or Edge 89+ | WebSerial and WebUSB for FC connection and firmware flashing |
| Web (limited) | Firefox, Safari | No WebSerial or WebUSB. WebSocket connections work. |
| Desktop (macOS) | Intel or Apple Silicon | Electron app, not code-signed (same as Betaflight and iNav Configurator) |
| Desktop (Windows) | x64 | Electron app, `.exe` installer |
| Desktop (Linux) | x64 or arm64 | `.AppImage` |

3D features (simulation, terrain rendering) benefit from a dedicated GPU. Works without one, but frame rates will be lower.

---

## External Services

All optional. The GCS works fully offline for local FC configuration and field operations.

| Service | Purpose | Required? |
|---------|---------|-----------|
| [Convex](https://convex.dev) | Cloud fleet management, auth, community features | No (field mode works without) |
| [Open Elevation](https://open-elevation.com) | Terrain following for mission planning | No (defaults to flat terrain) |
| [Cesium Ion](https://cesium.com/ion) | 3D terrain tiles and satellite imagery | No (uses ArcGIS terrain by default) |
| [Groq](https://console.groq.com) | AI PID tuning analysis | No (AI features disabled without key) |
| [GitHub API](https://github.com) | PX4 firmware release fetching | No (raises rate limit from 60 to 5000/hr) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind v4 |
| State | Zustand 5 (ring-buffered telemetry) |
| Maps | Leaflet + react-leaflet |
| 3D simulation | CesiumJS |
| Protocol | Custom MAVLink v2 and MSP v1/v2 binary parsers |
| Transport | WebSocket, WebSerial, WebUSB |
| Backend | Convex (optional, cloud fleet and community features) |
| Desktop | Electron 41 |
| Language | TypeScript (strict) |

---

## Deployer (`ados-deploy`)

The stack ships with a full-screen terminal deployer that self-hosts the whole
cloud stack (Convex + Mission Control + MQTT + video relay) in one guided flow,
and also runs the web GCS, builds the desktop app, and manages a running stack.

```bash
# One-line convenience (clones the repo if needed, then launches the TUI):
curl -sSL https://raw.githubusercontent.com/altnautica/ADOSMissionControl/main/tools/deploy/deploy.sh | sh

# Local-first, from a checkout:
npm run deploy                    # interactive menu
npm run deploy -- deploy          # deploy the self-hosted stack (wizard)
npm run deploy -- deploy --plan   # preview the exact commands + files, run nothing
npm run deploy -- status          # a running stack's containers + reach links
```

The interactive menu covers: deploy the stack, manage a running stack (status /
logs / restart / upgrade / teardown), run the web GCS (dev), run demo mode,
build / run the desktop app, a system check, and the drone-agent install
one-liner. The primitive npm scripts (`dev`, `demo`, `build`, `desktop:*`,
`convex:*`) are what the deployer shells out to.

Prerequisites: Docker (with the daemon running) + Node 20+. See
[SELFHOSTING.md](SELFHOSTING.md) for the full self-host walkthrough.

---

## Connecting to Hardware

**WebSocket:** Connect to any MAVLink-over-WebSocket endpoint. Launch ArduPilot SITL with the bridge tool from [`tools/sitl/`](tools/sitl/) (`cd tools/sitl && npm run setup && npm start`).

**WebSerial (USB):** Plug in your FC, open Mission Control in Chrome 89+, click connect, pick the port. No drivers needed.

**ADOS agent (LAN):** Add a node by hostname or IP. Mission Control pairs with the agent directly over the local network. No cloud account required.

---

## Desktop App

```bash
npm run desktop:build:mac   # macOS .dmg
npm run desktop:build:win   # Windows .exe installer
npm run desktop:build:linux # Linux .AppImage
```

macOS: right-click the app, Open, then Open again. Not code-signed, same as Betaflight Configurator and iNav Configurator.

---

## Self-Hosted Web Server

A multi-stage `Dockerfile` ships at the repo root for running Mission Control as a long-lived web server (instead of the desktop app or local dev). Node 22 alpine base, Next.js standalone output, runs as an unprivileged user.

```bash
docker build \
  --build-arg NEXT_PUBLIC_CONVEX_URL=https://your-convex.example \
  -t ados-mission-control .

docker run -d \
  -p 4000:4000 \
  -e NEXT_PUBLIC_CONVEX_URL=https://your-convex.example \
  --restart unless-stopped \
  --name mission-control \
  ados-mission-control
```

Open `http://localhost:4000`.

**About `NEXT_PUBLIC_*` variables:** these get baked into the client JS bundle at build time. Pass them as `--build-arg` to `docker build` AND as `-e` to `docker run` (the runtime version is used by server components and route handlers). The Dockerfile declares each `NEXT_PUBLIC_*` as `ARG` plus `ENV` so build args propagate.

**Container orchestrators and PaaS:** the image works with anything that can build a Dockerfile. Point your tool at this repo, set the build pack to Dockerfile, expose port 4000, and configure the env vars above. No special framework integration is needed.

**Fronting with HTTPS:** the container serves plain HTTP on port 4000. Terminate TLS at any reverse proxy (Caddy, nginx, Traefik) or tunnel (Cloudflare Tunnel, Tailscale Funnel, ngrok). When fronting with a tunnel, route to `127.0.0.1:4000` rather than `localhost:4000`, since the standalone server binds IPv4 only.

For self-hosting the supporting cloud relay (Convex, MQTT, and video relay), see [SELFHOSTING.md](SELFHOSTING.md).

---

## Backend and Cloud Features

Field mode works with no backend. Cloud features need a Convex deployment:

```bash
npx convex init
npx @convex-dev/auth
npx convex dev
```

Set `NEXT_PUBLIC_CONVEX_URL` in `.env.local`. The first user to sign up becomes admin.

For self-hosted MQTT and video relay, run `npm run deploy -- deploy` for a guided wizard (port selection, conflict detection, config file generation, optional service start), or follow the manual steps in [SELFHOSTING.md](SELFHOSTING.md). Source for each service: [`tools/mqtt-bridge/`](tools/mqtt-bridge/), [`tools/video-relay/`](tools/video-relay/).

### Environment variables (`.env.local`)

All variables are optional. Set them by editing `.env.local` directly (or re-run the deployer). The file is gitignored and never committed.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_DEMO_MODE` | Enable demo mode with simulated drones |
| `NEXT_PUBLIC_DEMO_DRONE_COUNT` | Number of simulated drones (1, 3, 5, or 10) |
| `NEXT_PUBLIC_CONVEX_URL` | Convex backend URL for cloud fleet features |
| `GITHUB_TOKEN` | Raises the PX4 releases API limit from 60 to 5000 req/hr |
| `GROQ_API_KEY` | AI PID tuning suggestions. Free at [console.groq.com](https://console.groq.com) |
| `CESIUM_BASE_URL` | Self-hosted Cesium JS URL (falls back to CDN if unset) |

### Tools

| Tool | Path | Description |
|------|------|-------------|
| SITL launcher | `tools/sitl/` | ArduPilot SITL plus TCP-to-WebSocket bridge |
| MQTT bridge | `tools/mqtt-bridge/` | Mosquitto broker plus MQTT-to-Convex bridge (Docker Compose) |
| Video relay | `tools/video-relay/` | RTSP-to-WebSocket fMP4 relay via ffmpeg (Docker Compose) |

---

## Hardware Partners

Building and testing ADOS Mission Control on real hardware. Want to get involved? [Email us](mailto:team@altnautica.com).

<!-- Format: | [![Company](logo-url)](website) -->

*Interested in sponsoring or sending test hardware? See our [partnership info](mailto:team@altnautica.com).*

---

## Community

- **[Discord](https://discord.gg/uxbvuD4d5q)** - Join the community, ask questions, share builds
- **[LinkedIn](https://www.linkedin.com/company/altnautica/)** - Follow company updates
- **[Email](mailto:team@altnautica.com)** - team@altnautica.com
- **[Changelog](https://command.altnautica.com/community/changelog)** - What shipped and when
- **[GitHub Issues](https://github.com/altnautica/ADOSMissionControl/issues)** - Bug reports and technical discussions

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Good areas to start: real iNav 7.x hardware testing, map-based polygon geozone drawing, a dedicated iNav nav-PID panel, Betaflight hardware testing, new board profiles, UDP transport, unit tests, pattern generators.

```bash
npm run demo   # Test against simulated drones
npm run lint   # Must pass before PR
```

---

## License

[GPL-3.0-only](LICENSE). Copyright 2025-2026 Altnautica. Derivative works must also be GPL-3.0, same as ArduPilot.
