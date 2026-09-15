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
| `--lat` | `12.9716` | Home latitude (default origin) |
| `--lon` | `77.5946` | Home longitude |
| `--speedup` | `1` | Simulation speed multiplier |
| `--wind` | — | Wind speed,direction (e.g. `5,180`) |
| `--ardupilot` | `~/.ardupilot` | ArduPilot source path |
| `--vehicle` | `ArduCopter` | Vehicle type |
| `--no-dashboard` | false | Disable terminal UI |

## Connecting from Command GCS

1. Start SITL: `npx tsx src/index.ts`
2. In Command GCS, connect to `ws://localhost:5760`
3. Drone appears with real telemetry — arm, takeoff, fly with full physics

## Multi-Drone

ArduPilot SITL natively supports multiple instances with `--auto-sysid`. Each gets a unique system ID. The bridge multiplexes all instances onto a single WebSocket port. The GCS demuxes by system ID from HEARTBEAT messages.

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
