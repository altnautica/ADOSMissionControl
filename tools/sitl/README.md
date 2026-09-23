# altnautica-sitl

ArduPilot SITL launcher + TCP-to-WebSocket bridge for browser-based GCS.

Spawns real ArduPilot SITL (full 6-DOF physics, real autopilot code) and relays raw binary MAVLink v2 frames over WebSocket so browser-based ground control stations can connect directly.

## Architecture

```
sim_vehicle.py (ArduPilot SITL)
       │
   TCP 5760
       │
  ┌────┴────┐
  │ tcp-ws  │  raw binary relay (zero MAVLink parsing)
  │ bridge  │
  └────┬────┘
       │
  WS 5760
       │
  Browser GCS
```

## Prerequisites

- Node.js 20+
- Python 3
- ArduPilot source (built for SITL)

## Setup

```bash
# One-time: clone and build ArduPilot (~15 min)
cd tools/sitl
bash scripts/setup-ardupilot.sh

# Install Node deps
npm install
```

## Usage

```bash
# Single drone (default origin)
npx tsx src/index.ts

# Multiple drones
npx tsx src/index.ts --drones 3

# Custom location (New Delhi)
npx tsx src/index.ts --lat 28.6139 --lon 77.2090

# With wind (5 m/s from south)
npx tsx src/index.ts --wind 5,180

# Fast simulation
npx tsx src/index.ts --speedup 2

# Different vehicle
npx tsx src/index.ts --vehicle ArduPlane
```

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--drones` | `1` | Number of drone instances |
| `--ws-port` | `5760` | WebSocket port for GCS |
| `--ws-host` | `::1` | WebSocket bind address (IPv6 loopback; see below) |
| `--allow-origin` | — | Also accept a GCS page from this exact origin (repeatable) |
| `--lat` | `12.9716` | Home latitude (default origin) |
| `--lon` | `77.5946` | Home longitude |
| `--speedup` | `1` | Simulation speed multiplier |
| `--wind` | — | Wind speed,direction (e.g. `5,180`) |
| `--ardupilot` | `~/.ardupilot` | ArduPilot source path |
| `--vehicle` | `ArduCopter` | Vehicle type |
| `--no-dashboard` | false | Disable terminal UI |

## Connecting from Command GCS

1. Start SITL: `npx tsx src/index.ts`
2. Copy the `ws://[::1]:5760/?token=...` URL it prints (one per drone) and connect
   to it from Command GCS, `?token=` included. The token changes on every start.
3. Drone appears with real telemetry — arm, takeoff, fly with full physics

The WebSocket accepts only clients that present the token, and only browser
pages served from `localhost`, `127.0.0.1` or `[::1]` (plus any
`--allow-origin`). It binds the IPv6 loopback `::1` because each drone's
WebSocket shares its SITL TCP port number and SITL listens on IPv4, so an IPv4
loopback bind on the same port would collide with SITL itself.

## Multi-Drone

ArduPilot SITL natively supports multiple instances with `--auto-sysid`. Each gets a unique system ID and its own SITL TCP port: `--ws-port` (default 5760) for drone #1, then +10 per drone (5770, 5780, ...). The bridge runs one WebSocket server per drone on that drone's SITL port number, bound to `::1` (or `--ws-host`), and relays only that drone's TCP stream through it. The startup log prints one `ws://[::1]:<port>/?token=...` URL per drone; all share the same per-run token. Connect the GCS to each URL separately.

## What SITL Gives You

- Real ArduCopter/ArduPlane/ArduRover autopilot code
- 6-DOF flight dynamics
- GPS noise, IMU noise, wind, turbulence
- Full parameter set (800+ params)
- All flight modes with real transition logic
- Mission execution with real navigation
- EKF, failsafes, geofence, rally points
- Battery drain simulation

## License

GPL-3.0-only
