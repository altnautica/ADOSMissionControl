# Altnautica Command

**Open-source web GCS for autonomous drones. Configure, plan, fly, simulate.**

![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green.svg) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg) ![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg) [![Discord](https://img.shields.io/badge/Discord-Join-5865F2.svg)](https://discord.gg/uxbvuD4d5q)

<p align="center">
  <img src="public/screenshots/dashboard.png" alt="Fleet Dashboard" width="100%">
</p>

<p align="center">
  <strong><a href="https://command.altnautica.com">Live App</a></strong> |
  <strong><a href="https://command.altnautica.com/community/changelog">Changelog</a></strong> |
  <strong><a href="https://command.altnautica.com/community/roadmap">Roadmap</a></strong> |
  <strong><a href="https://discord.gg/uxbvuD4d5q">Discord</a></strong> |
  <strong><a href="https://command.altnautica.com/community/contact">Contact</a></strong>
</p>

---

## What Is This?

Altnautica Command is a web GCS that runs in any browser and also ships as a native desktop app (Electron). Connect to a flight controller over WebSocket or USB (WebSerial), configure it, plan missions, fly, and simulate. Works on tablets, laptops, and ground stations.

It replaces desktop-only tools like QGroundControl and Mission Planner with a modern web stack: React 19, TypeScript strict, real-time Zustand stores with ring-buffered telemetry, and a custom binary MAVLink v2 parser.

~98K lines of TypeScript. 38 FC configuration panels. 7 pattern generators. 83 MAVLink + 34 MSP message decoders. 34 Zustand stores. Full demo mode with zero setup.

**[Live App](https://command.altnautica.com)** · **[Website](https://altnautica.com/command)** · **[Discord](https://discord.gg/uxbvuD4d5q)**

---

## Quick Start

Try it immediately at [command.altnautica.com](https://command.altnautica.com). No install needed.

Or run locally:

```bash
git clone https://github.com/altnautica/ADOSMissionControl.git
cd ADOSMissionControl
npm install
npm run demo
```

Open [http://localhost:4000](http://localhost:4000) for 5 simulated drones with live telemetry, mission planning, and full FC configuration. No hardware needed.

---

## Screenshots

<table>
  <tr>
    <td><img src="public/screenshots/mission-planner.png" alt="Mission Planner" width="100%"><br><sub>Mission planning with pattern generators and terrain following</sub></td>
    <td><img src="public/screenshots/flight-control.png" alt="Flight Control" width="100%"><br><sub>Gamepad and HOTAS flight controls at 50Hz</sub></td>
  </tr>
  <tr>
    <td><img src="public/screenshots/3d-simulation.png" alt="3D Simulation" width="100%"><br><sub>Cesium 3D globe with flight path replay</sub></td>
    <td><img src="public/screenshots/configure.png" alt="FC Configuration" width="100%"><br><sub>38 panels for full flight controller setup</sub></td>
  </tr>
  <tr>
    <td><img src="public/screenshots/parameters.png" alt="FC Parameters" width="100%"><br><sub>Search, edit, and write all FC parameters</sub></td>
    <td><img src="public/screenshots/flashtool.png" alt="Firmware Flash Tool" width="100%"><br><sub>WebUSB firmware flashing for STM32 boards</sub></td>
  </tr>
</table>

---

## Features

### Flight Controller Configuration

- **38 configuration panels** covering calibration, receiver, outputs, PID tuning, failsafe, power, ports, OSD, firmware, PX4 airframe/actuator, Betaflight modes/motors/VTX/GPS/blackbox/rates/adjustments, and more
- **AI PID tuning** with FFT noise analysis, step response, tracking quality, and motor health. AI suggestions are rate-limited on the hosted version (3/week). Self-host with your own `GROQ_API_KEY` for unlimited use
- **Board auto-detection** with 9 profiles (SpeedyBee F405 Wing/V3/V4, Matek H743, Pixhawk 4/6C/6X) and STM32 timer group maps
- **Full parameter system** for searching, editing, and writing all FC parameters with real-time validation
- **Timer group conflict detection** with a visual diagram of STM32 hardware timers, color-coded by protocol (DShot vs PWM)
- **Sensor calibration wizards** for accelerometer 6-position, compass, gyro, baro, and RC calibration with live feedback
- **Sensor graphing** for real-time visualization of IMU, baro, and GPS data
- **MAVLink inspector** showing raw decoded messages and traffic stats
- **Debug console** for protocol-level troubleshooting

### Mission Planning

- Waypoint editor with drag-and-drop on an interactive map
- Altitude profile visualization with per-waypoint AGL control
- **Drawing tools** for polygon, circle, and measure operations with geodetic math
- **7 pattern generators** covering survey (boustrophedon), orbit, corridor, SAR (expanding square, sector search, parallel track), and structure scan
- **GSD calculator** with camera profiles. Auto-computes line spacing from altitude and sidelap
- **Terrain following** via Open Elevation API with LRU cache and terrain-aware altitude adjustment
- **Geofence editor** with inclusion/exclusion polygon and circle zones. Draw on map, upload to drone
- **Rally points** for emergency landing locations. Map placement, upload/download
- **Mission validation** through a pre-upload rule engine (takeoff check, altitude limits, geofence containment, distance warnings)
- **Mission transforms** to move, rotate, and scale entire missions as geometry operations
- **Batch editing** with multi-select waypoints (Ctrl+click, Shift+click) and bulk altitude/speed/command changes
- Plan library for saving, loading, duplicating, and organizing missions (IndexedDB)
- Import/export KML, KMZ, CSV, `.waypoints`, and `.plan` file formats

### 3D Simulation

- **Cesium.js globe** with real terrain, satellite imagery, and 3D building tiles
- **Drone entity** tracking with orientation, flight path trail, and altitude ribbon
- **Playback controls** with 1x-4x speed, timeline scrubbing, and pause/resume
- **3D waypoint visualization** showing waypoints, geofences, rally points, and pattern overlays on the globe
- **Simulation HUD** displaying speed, altitude, heading, and flight mode in an overlay
- **Camera presets** for chase, orbit, top-down, and free-look perspectives
- **Simulation history** for replaying past missions from the plan library

### Air Traffic

- **3D airspace visualization** on CesiumJS globe with semi-transparent extruded volumes for Class B/C/D/E airspace
- **Live ADS-B tracking** via adsb.lol and OpenSky Network with 10-second polling
- **TCAS-style threat classification** with CPA computation (Resolution Advisory, Traffic Advisory, Proximate, Other)
- **"Can I Fly Here?" assessment** for instant green/yellow/red flyability verdict at any point on the globe
- **Multi-jurisdiction support** for India (DGCA green/yellow/red zones), USA (FAA Class B/C/D, LAANC ceilings), and Australia (CASA aerodrome buffers)
- **Altitude slider** filtering which zones are active at your operational altitude
- **Timeline scrubber** for viewing time-dependent TFRs and NOTAMs
- **Country-specific CTAs** linking to Digital Sky, B4UFLY, CASA rules
- **Real-time alerts** for aircraft entering proximity radius

### Live Telemetry

- Real-time dashboard with attitude, position, velocity, and battery indicators
- EKF status, GPS fix quality, vibration levels, RSSI, and sensor health monitoring
- **Alert feed** for warnings, errors, and status messages from the flight controller
- **Pre-arm check visualization** showing which checks pass or fail before arming
- **RC input monitor** for live channel values and calibration verification
- Telemetry freshness tracking. Indicators go stale when data stops arriving
- Flight history with CSV export
- Ring-buffered stores for bounded memory during long sessions

### Flight Control

- **Gamepad, HOTAS, RC transmitter, and keyboard** input at 50Hz via Web Gamepad API
- **Arm/disarm, takeoff, land, RTL, and flight mode switching** through on-screen controls or bound inputs
- **Guided flight** for click-to-go-here waypoint commands
- **Mission execution** with start, pause, resume, and mission item jump
- **Kill switch** with confirmation dialog for emergency motor stop
- **Servo and relay control** for auxiliary outputs
- **Camera trigger and gimbal control** for payload management

### Firmware Management

- **WebUSB flashing** for STM32 boards in DFU mode. No external flasher needed
- **HEX and APJ file parsing** with validation and board matching
- **ArduPilot, PX4, and Betaflight** firmware download and flash
- **Parameter backup and restore** before and after firmware updates

### Protocol Support

- **MAVLink v2** binary parser with CRC validation and 83 message types
- **MSP v1/v2** binary codec with CRC8 DVB-S2, 19-state streaming parser, 34 decoders, 21 encoders
- **ArduPilot** with full support (all panels, calibration, missions, dataflash logs)
- **PX4** with full support including airframe selection, actuator configuration, MAVLink shell, and 90+ parameter mappings
- **Betaflight** with full support including 8 new panels, 7 adapted panels, ~105 virtual params, OSD config
- **iNav** architecture prepared, iNav-specific features planned
- Multi-firmware `DroneProtocol` abstraction. Components never call MAVLink or MSP directly

### Demo Mode

- 5 simulated drones with realistic telemetry (GPS tracks, battery drain, altitude profiles)
- Full mock MAVLink. All 38 FC panels work against simulated FC responses
- Zero setup: `npm run demo` or pass `?demo=true` in the URL

---

## Connecting to Hardware

### WebSocket

Connect to any MAVLink-over-WebSocket endpoint. Works with mavlink-router on a companion computer, or the SITL bridge for simulation.

```bash
# ArduPilot SITL via the companion bridge tool
npm run cli sitl
# Then in Command: connect to ws://localhost:5762
```

See [`tools/sitl/`](tools/sitl/) for full SITL setup (requires ArduPilot built from source).

### WebSerial (Direct USB)

Connect your FC via USB, open Command in Chrome 89+, click connect, pick the port. No drivers, no intermediate software.

---

## CLI

Command includes an interactive CLI for all development workflows:

```bash
npm run cli              # Interactive menu
npm run cli dev          # Dev server (port 4000)
npm run cli demo         # Demo mode — 5 simulated drones
npm run cli sitl         # Launch ArduPilot SITL + WebSocket bridge
npm run cli deploy       # Lint → build → start
npm run cli setup        # First-time setup wizard
npm run cli config       # Configure .env.local interactively
npm run cli sitl-setup   # Clone & build ArduPilot for SITL
npm run cli info         # Check system prerequisites
```

Run `npm run cli` with no arguments for an interactive menu:

```
   _   _ _                   _   _
  /_\ | | |_ _ _  __ _ _  _| |_(_)__ __ _
 / _ \| |  _| ' \/ _` | || |  _| / _/ _` |
/_/ \_\_|\__|_||_\__,_|\_,_|\__|_\__\__,_|

  C O M M A N D
  Ground Control Station

◆  What would you like to do?
│  ○ Start dev server (port 4000)
│  ○ Start demo mode (5 simulated drones)
│  ○ Launch SITL simulator (ArduPilot + WebSocket bridge)
│  ────────────────────────────────
│  ○ Build & deploy (lint → build → start)
│  ────────────────────────────────
│  ○ First-time setup (install deps, configure env)
│  ○ Configure environment (.env.local)
│  ○ Setup ArduPilot SITL (clone + build)
│  ○ System info (check prerequisites)
└
```

---

## Desktop App

The web version at [command.altnautica.com](https://command.altnautica.com) is recommended for most users. If you need offline access or prefer a standalone window, build the desktop app from source:

```bash
npm install
npm run desktop:build:mac   # macOS .dmg
npm run desktop:build:win   # Windows .exe installer
npm run desktop:build:linux # Linux .AppImage
```

Output goes to `release/`.

**macOS note:** The app is not code-signed. On first launch: right-click the app, then Open, then Open again. This is standard for open-source projects (Betaflight Configurator and INAV Configurator ship the same way).

**Windows note:** SmartScreen may warn on first run. Click "More info" then "Run anyway".

---

## Environment Variables

All optional. Command works standalone with zero config. Use `npm run cli config` to set these interactively, or create `.env.local` manually.

### Local (`.env.local`)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_DEMO_MODE` | `false` | 5 simulated drones with full mock MAVLink |
| `NEXT_PUBLIC_DEMO_DRONE_COUNT` | `5` | Number of simulated drones in demo mode (1, 3, 5, or 10) |
| `NEXT_PUBLIC_CONVEX_URL` | — | Convex backend for cloud fleet management |
| `GITHUB_TOKEN` | — | Raises PX4 releases API from 60 to 5000 req/hr |
| `GROQ_API_KEY` | — | AI PID tuning suggestions. Free at [console.groq.com](https://console.groq.com) |

### Convex Server (set via dashboard or `npx convex env set`)

These run inside Convex functions, not in Next.js. Only needed if you use cloud features.

| Variable | Description |
|----------|-------------|
| `CESIUM_ION_TOKEN` | 3D terrain for simulation. Free at [ion.cesium.com](https://ion.cesium.com). Without it, simulation falls back to ArcGIS elevation. |
| `GROQ_API_KEY` | AI changelog summaries + PID tuning suggestions. Free at [console.groq.com](https://console.groq.com). |
| `GITHUB_TOKEN` | GitHub API auth for changelog sync (5000 req/hr vs 60 unauthenticated). |
| `AI_PID_WEEKLY_LIMIT` | Max AI PID analyses per user per week. Default: 3. Self-hosted users can set this to any value. |

---

## Backend / Cloud Features

Command GCS works fully standalone with no backend. Field mode (direct WebSocket or WebSerial connection to a flight controller) needs nothing else.

Cloud features require a Convex deployment. These include:

- **Auth** (sign up, log in, profiles)
- **Cloud missions** (save/load missions from any device)
- **Fleet management** (paired drones, heartbeat, connection presets)
- **Community** (changelog, roadmap kanban, feature requests, bug reports, comments)
- **ADS-B caching** (server-side fetch from adsb.lol + OpenSky, served to all clients)
- **AI PID tuning** (usage tracking and rate limiting)

### Quick Start (Convex Cloud)

```bash
npx convex init              # Create a free cloud deployment
npx @convex-dev/auth          # Generate JWT keys for auth
npx convex dev                # Start dev backend + codegen
```

Set `NEXT_PUBLIC_CONVEX_URL` in `.env.local` to the URL shown by `npx convex dev`.

The first user to sign up automatically becomes admin.

### Self-Hosted

Deploy the [open-source Convex backend](https://github.com/get-convex/convex-backend) and point `NEXT_PUBLIC_CONVEX_URL` at it. Use `npx convex deploy --url <url> --admin-key <key>` to push functions.

For full cloud relay self-hosting (MQTT + video), see **[SELFHOSTING.md](SELFHOSTING.md)**.

### Cloud Mode

When the GCS is served over HTTPS (like at `command.altnautica.com`), it can't connect directly to a drone agent's local HTTP API due to mixed-content restrictions. Cloud mode solves this with a three-layer relay architecture:

1. **Convex HTTP relay** (baseline). Agent POSTs status every 5s, GCS reads via reactive Convex queries. Commands go the reverse direction. Works immediately, no extra infra.
2. **MQTT real-time telemetry** (optional). Agent publishes to `ados/{deviceId}/status` and `ados/{deviceId}/telemetry` topics via Mosquitto. GCS subscribes in the browser via `mqtt.js` over WebSocket. 2Hz+ update rate.
3. **Video streaming** (optional). Video relay converts RTSP from the agent to fragmented MP4 over WebSocket. Browser plays via native MediaSource Extensions. 0.5-1.5s latency.

The GCS auto-detects HTTPS and falls back to cloud mode. On HTTP (local dev), it connects directly to the agent.

**Convex environment variables for cloud mode** (set via `npx convex env set`):

| Variable | Example | Description |
|----------|---------|-------------|
| `MQTT_BROKER_URL` | `wss://mqtt.example.com/mqtt` | MQTT WebSocket broker URL |
| `VIDEO_RELAY_URL` | `wss://video.example.com` | Video relay WebSocket URL |

The GCS reads these from the `clientConfig` Convex query at runtime. No Next.js env vars needed.

### Tools

The `tools/` directory contains standalone infrastructure for self-hosting:

| Tool | Path | Description |
|------|------|-------------|
| SITL launcher | `tools/sitl/` | ArduPilot SITL + TCP-to-WebSocket bridge |
| MQTT bridge | `tools/mqtt-bridge/` | Mosquitto broker + MQTT-to-Convex bridge (Docker Compose) |
| Video relay | `tools/video-relay/` | RTSP-to-WebSocket fMP4 relay via ffmpeg (Docker Compose) |

Each tool has its own README, Docker Compose config, and `.env.example`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind v4 |
| State | Zustand 5 (ring-buffered telemetry) |
| Maps | Leaflet + react-leaflet |
| 3D | Cesium |
| Charts | Recharts |
| Protocol | Custom MAVLink v2 + MSP v1/v2 binary parsers/encoders |
| Transport | WebSocket + WebSerial + WebUSB |
| Storage | IndexedDB (offline plan library) |
| Backend | Convex (optional, for cloud fleet ops) |
| Desktop | Electron |
| Language | TypeScript (strict) |

---

## Firmware Support

| Firmware | Protocol | Status | Notes |
|----------|----------|--------|-------|
| ArduPilot (Copter/Plane/Rover/Sub) | MAVLink v2 | **Full** | 83 message types, 33 commands, all panels, calibration, missions, logs |
| PX4 | MAVLink v2 | **Full** | 90+ param mappings, airframe selection, actuator config, MAVLink shell, calibration, missions |
| Betaflight | MSP v1/v2 | **Full** | 34 decoders, 21 encoders, ~105 virtual params, 15 panels, OSD config |
| iNav | MSP v1/v2 | **Partial** | Architecture prepared, iNav-specific features planned |

---

## By the Numbers

| Metric | Count |
|--------|-------|
| Lines of TypeScript | ~98,000 |
| FC configuration panels | 38 |
| Zustand stores | 34 |
| MAVLink message decoders | 83 |
| MSP message decoders | 34 |
| MSP message encoders | 21 |
| MAV_CMD handlers | 33 |
| Pattern generators | 7 |
| Board profiles | 9 |
| File format handlers | 5 (KML, KMZ, CSV, .waypoints, .plan) |

---

## Community

- **[Discord](https://discord.gg/uxbvuD4d5q)**: Join the community, ask questions, share builds
- **[Changelog](https://command.altnautica.com/community/changelog)**: What shipped and when. Auto-synced from GitHub commits
- **[Roadmap](https://command.altnautica.com/community/roadmap)**: What's planned next, organized by priority
- **[Contact](https://command.altnautica.com/community/contact)**: Reach the team directly
- **[GitHub Issues](https://github.com/altnautica/ADOSMissionControl/issues)**: Bug reports and technical discussions

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

```bash
# Fork → clone → branch → code → test → PR
npm run demo   # Test against simulated drones
npm run lint   # Must pass before PR
```

Areas where help is especially useful: iNav MSP support, Betaflight hardware testing, new board profiles, UDP transport, unit tests, and new pattern generators.

---

## License

[GPL-3.0-only](LICENSE). Copyright 2026 Altnautica.

Free to use, modify, and distribute. Derivative works must also be GPL-3.0, same philosophy as ArduPilot.

---

## Links

- **Live app:** [command.altnautica.com](https://command.altnautica.com)
- **Website:** [altnautica.com/command](https://altnautica.com/command)
- **Discord:** [discord.gg/uxbvuD4d5q](https://discord.gg/uxbvuD4d5q)
- **Issues:** [github.com/altnautica/ADOSMissionControl/issues](https://github.com/altnautica/ADOSMissionControl/issues)
- **SITL tool:** [`tools/sitl/`](tools/sitl/)
- **MQTT bridge:** [`tools/mqtt-bridge/`](tools/mqtt-bridge/)
- **Video relay:** [`tools/video-relay/`](tools/video-relay/)
