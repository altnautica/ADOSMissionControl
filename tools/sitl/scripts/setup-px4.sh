#!/usr/bin/env bash
# setup-px4.sh — Clone and build PX4 SITL
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

PX4_HOME="${PX4_HOME:-$HOME/.px4}"

echo "=== Altnautica SITL - PX4 Setup ==="
echo ""

# Check prerequisites
for cmd in python3 git make cmake; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd is required but not found. Install it first."
    exit 1
  fi
done

if [ -d "$PX4_HOME" ]; then
  echo "PX4 source found at $PX4_HOME"
  echo ""
  if [ -f "$PX4_HOME/build/px4_sitl_default/bin/px4" ]; then
    echo "PX4 SITL binary found. Ready to use."
    echo ""
    echo "To rebuild:  cd $PX4_HOME && make px4_sitl_default"
    echo "To update:   cd $PX4_HOME && git pull && git submodule update --init --recursive && make px4_sitl_default"
    exit 0
  else
    echo "WARNING: PX4 SITL binary not found. Rebuilding..."
    cd "$PX4_HOME"
    git submodule update --init --recursive
    make px4_sitl_default
    echo ""
    echo "Done!"
    exit 0
  fi
fi

echo "Cloning PX4-Autopilot to $PX4_HOME..."
echo "(This may take a while - large repo with submodules)"
echo ""
git clone --recursive https://github.com/PX4/PX4-Autopilot.git "$PX4_HOME"
cd "$PX4_HOME"

echo ""
echo "Building PX4 SITL..."
make px4_sitl_default

echo ""
echo "=== Setup Complete ==="
echo ""
echo "PX4 SITL built at: $PX4_HOME"
echo "Binary: $PX4_HOME/build/px4_sitl_default/bin/px4"
echo ""
echo "Add to your shell profile:"
echo "  export PX4_HOME=$PX4_HOME"
echo ""
echo "Run the simulator:"
echo "  cd tools/sitl && npx tsx src/index.ts"
