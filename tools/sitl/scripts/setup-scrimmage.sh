#!/usr/bin/env bash
# setup-scrimmage.sh — Install SCRIMMAGE multi-agent simulator
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

echo "=== SCRIMMAGE Setup for ADOS SITL ==="
echo ""
echo "SCRIMMAGE is a multi-agent simulator for large swarm testing (50-100+ vehicles)."
echo "It integrates with ArduPilot via sim_vehicle.py -f scrimmage-copter"
echo ""

SCRIMMAGE_HOME="${SCRIMMAGE_HOME:-$HOME/.scrimmage}"

# Check platform
if [[ "$(uname)" == "Darwin" ]]; then
  echo "macOS detected. SCRIMMAGE requires Docker on macOS."
  echo ""
  echo "Option 1: Use Docker (recommended for macOS):"
  echo "  docker pull syllogismrxs/scrimmage:latest"
  echo "  docker run -it --rm syllogismrxs/scrimmage:latest"
  echo ""
  echo "Option 2: Build from source (requires many dependencies):"
  echo "  git clone https://github.com/gtri/scrimmage.git $SCRIMMAGE_HOME"
  echo "  cd $SCRIMMAGE_HOME"
  echo "  # Follow build instructions at:"
  echo "  # https://github.com/gtri/scrimmage/blob/master/docs/source/sphinx/install.rst"
  echo ""
  echo "For ArduPilot swarm testing without SCRIMMAGE, use:"
  echo "  sim_vehicle.py --count 50 --auto-sysid --no-mavproxy"
  echo ""
  exit 0
fi

# Linux build
if [ -d "$SCRIMMAGE_HOME" ]; then
  echo "SCRIMMAGE found at $SCRIMMAGE_HOME, updating..."
  cd "$SCRIMMAGE_HOME"
  git pull
else
  echo "Cloning SCRIMMAGE to $SCRIMMAGE_HOME..."
  git clone https://github.com/gtri/scrimmage.git "$SCRIMMAGE_HOME"
  cd "$SCRIMMAGE_HOME"
fi

# Install dependencies
echo "Installing dependencies..."
sudo apt-get update
sudo apt-get install -y \
  cmake build-essential \
  libprotobuf-dev protobuf-compiler \
  libeigen3-dev libboost-all-dev \
  libgeographic-dev librapidxml-dev \
  python3-dev python3-pip

# Build
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
sudo make install

# Source environment
source ~/.scrimmage/setup.bash 2>/dev/null || true

echo ""
echo "=== SCRIMMAGE setup complete! ==="
echo ""
echo "Usage with ArduPilot:"
echo "  cd ~/.ardupilot"
echo "  python3 Tools/autotest/sim_vehicle.py -f scrimmage-copter --count 50 --auto-sysid"
