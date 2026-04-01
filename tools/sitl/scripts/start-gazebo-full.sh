#!/usr/bin/env bash
# start-gazebo-full.sh — Launch complete Gazebo SITL + video pipeline
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MC_DIR="$(cd "$SITL_DIR/../.." && pwd)"
RELAY_DIR="$MC_DIR/tools/video-relay"

WORLD="bangalore-real"
HEADLESS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --world) WORLD="$2"; shift 2 ;;
    --headless) HEADLESS="--gazebo-headless"; shift ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

PID1="" PID2="" PID3="" PID4=""

cleanup() {
  echo ""
  echo "Shutting down all services..."
  [ -n "$PID1" ] && kill "$PID1" 2>/dev/null || true
  [ -n "$PID2" ] && kill "$PID2" 2>/dev/null || true
  [ -n "$PID3" ] && kill "$PID3" 2>/dev/null || true
  [ -n "$PID4" ] && kill "$PID4" 2>/dev/null || true
  pkill -f "gz sim" 2>/dev/null || true
  pkill -f "sim_vehicle" 2>/dev/null || true
  pkill -f "arducopter" 2>/dev/null || true
  pkill -f mediamtx 2>/dev/null || true
  echo "All services stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

export GZ_SIM_SYSTEM_PLUGIN_PATH="$HOME/.gazebo-ardupilot/build:${GZ_SIM_SYSTEM_PLUGIN_PATH:-}"
export GZ_SIM_RESOURCE_PATH="$HOME/.gazebo-ardupilot/models:$HOME/.gazebo-ardupilot/worlds:${GZ_SIM_RESOURCE_PATH:-}"

echo "============================================"
echo "  ADOS Gazebo SITL + Video Pipeline"
echo "============================================"
echo ""

# 1. mediamtx (with gazebo-cam path configured)
echo "[1/4] Starting mediamtx RTSP server on :8554..."
cp /opt/homebrew/etc/mediamtx/mediamtx.yml /tmp/mediamtx-sitl.yml
printf "\n  gazebo-cam:\n" >> /tmp/mediamtx-sitl.yml
mediamtx /tmp/mediamtx-sitl.yml > /tmp/mediamtx.log 2>&1 &
PID1=$!
sleep 2
echo "  OK (pid $PID1)"

# 2. SITL + Gazebo
echo "[2/4] Starting ArduPilot SITL + Gazebo ($WORLD)..."
cd "$SITL_DIR"
npx tsx src/index.ts --scenario bangalore-gazebo --no-dashboard > /tmp/gazebo-sitl.log 2>&1 &
PID2=$!
echo "  Waiting for SITL (15s)..."
sleep 15
echo "  OK (pid $PID2)"

# 2b. Enable camera streaming in Gazebo
echo "  Enabling camera streaming..."
# Enable camera streaming (world name may vary)
for world_name in ados_bangalore ados_multi_copter ados_urban ados_agriculture; do
  gz topic -t "/world/$world_name/model/iris_with_gimbal/model/gimbal/link/pitch_link/sensor/camera/image/enable_streaming" -m gz.msgs.Boolean -p 'data: true' 2>/dev/null || true
done

# 3. Video bridge
echo "[3/4] Starting video bridge (RTP:5600 -> RTSP:8554)..."
cd "$SITL_DIR"
npx tsx src/video/gazebo-video-bridge.ts > /tmp/video-bridge.log 2>&1 &
PID3=$!
sleep 2
echo "  OK (pid $PID3)"

# 4. Video relay
echo "[4/4] Starting video relay (RTSP:8554 -> WS:3001)..."
cd "$RELAY_DIR"
PORT=3001 RTSP_URL_PATTERN="rtsp://localhost:8554/{deviceId}" npx tsx src/index.ts > /tmp/video-relay.log 2>&1 &
PID4=$!
sleep 2
echo "  OK (pid $PID4)"

echo ""
echo "============================================"
echo "  All services running!"
echo "============================================"
echo ""
echo "  MAVLink:    ws://localhost:5760"
echo "  RTSP:       rtsp://localhost:8554/gazebo-cam"
echo "  Video WS:   ws://localhost:3001/ws/stream/gazebo-cam"
echo "  GCS:        http://localhost:4000"
echo ""
echo "  Test: ffprobe rtsp://localhost:8554/gazebo-cam"
echo "  Test: curl http://localhost:3001/"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""
wait
