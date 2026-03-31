#!/usr/bin/env bash
# docker-sitl.sh — Docker SITL orchestrator
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/../docker"

usage() {
  cat <<EOF
Usage: docker-sitl.sh <profile> [options]

Profiles:
  ardupilot    ArduPilot multi-drone SITL (WS port 5760)
  px4          PX4 multi-drone SITL (WS port 14550)
  mixed        ArduPilot + PX4 simultaneously
  gazebo       Gazebo + ArduPilot with video feed
  down         Stop all running SITL containers

Options:
  --drones N   Number of drones (default: 3)
  --lat N      Home latitude (default: 12.9716)
  --lon N      Home longitude (default: 77.5946)
  --speedup N  Simulation speed (default: 1)
  --build      Force rebuild Docker images

Examples:
  ./docker-sitl.sh ardupilot --drones 5
  ./docker-sitl.sh px4 --drones 3
  ./docker-sitl.sh mixed
  ./docker-sitl.sh gazebo --drones 1
  ./docker-sitl.sh down
EOF
}

# Parse arguments
PROFILE="${1:-}"
shift || true

DRONE_COUNT=3
LAT=12.9716
LON=77.5946
SPEEDUP=1
BUILD_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --drones) DRONE_COUNT="$2"; shift 2 ;;
    --lat) LAT="$2"; shift 2 ;;
    --lon) LON="$2"; shift 2 ;;
    --speedup) SPEEDUP="$2"; shift 2 ;;
    --build) BUILD_FLAG="--build"; shift ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

case "$PROFILE" in
  ardupilot)
    echo "Starting ArduPilot SITL ($DRONE_COUNT drones)..."
    DRONE_COUNT=$DRONE_COUNT LAT=$LAT LON=$LON SPEEDUP=$SPEEDUP \
      docker compose -f "$DOCKER_DIR/docker-compose.ardupilot.yml" up -d $BUILD_FLAG
    echo "WebSocket bridge: ws://localhost:5760"
    ;;
  px4)
    echo "Starting PX4 SITL ($DRONE_COUNT drones)..."
    DRONE_COUNT=$DRONE_COUNT LAT=$LAT LON=$LON SPEEDUP=$SPEEDUP \
      docker compose -f "$DOCKER_DIR/docker-compose.px4.yml" up -d $BUILD_FLAG
    echo "WebSocket bridge: ws://localhost:14550"
    ;;
  mixed)
    echo "Starting mixed SITL (3 ArduPilot + 2 PX4)..."
    ARDUPILOT_COUNT=3 PX4_COUNT=2 LAT=$LAT LON=$LON SPEEDUP=$SPEEDUP \
      docker compose -f "$DOCKER_DIR/docker-compose.mixed.yml" up -d $BUILD_FLAG
    echo "ArduPilot bridge: ws://localhost:5760"
    echo "PX4 bridge: ws://localhost:14550"
    ;;
  gazebo)
    echo "Starting Gazebo + ArduPilot SITL ($DRONE_COUNT drones)..."
    DRONE_COUNT=$DRONE_COUNT LAT=$LAT LON=$LON HEADLESS=true \
      docker compose -f "$DOCKER_DIR/docker-compose.gazebo.yml" up -d $BUILD_FLAG
    echo "WebSocket bridge: ws://localhost:5760"
    echo "Video relay: ws://localhost:3001"
    ;;
  down)
    echo "Stopping all SITL containers..."
    for f in "$DOCKER_DIR"/docker-compose.*.yml; do
      docker compose -f "$f" down 2>/dev/null || true
    done
    echo "All containers stopped."
    ;;
  *)
    usage
    exit 1
    ;;
esac
