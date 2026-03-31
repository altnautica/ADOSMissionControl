#!/usr/bin/env bash
# setup-gazebo.sh — Install Gazebo Harmonic and ArduPilot Gazebo plugin on macOS
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

echo "=== Gazebo Harmonic Setup for ADOS SITL ==="
echo ""

# Check macOS
if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is for macOS. For Linux, use: sudo apt install gz-harmonic"
  exit 1
fi

# Install Gazebo Harmonic via Homebrew
echo "Step 1/4: Installing Gazebo Harmonic..."
brew tap osrf/simulation
brew install gz-harmonic

# Install GStreamer (for video pipeline)
echo "Step 2/4: Installing GStreamer..."
brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly

# Clone and build ardupilot_gazebo plugin
GAZEBO_PLUGIN_HOME="${GAZEBO_PLUGIN_HOME:-$HOME/.gazebo-ardupilot}"
echo "Step 3/4: Building ArduPilot Gazebo plugin..."

if [ -d "$GAZEBO_PLUGIN_HOME" ]; then
  echo "Plugin found at $GAZEBO_PLUGIN_HOME, updating..."
  cd "$GAZEBO_PLUGIN_HOME"
  git pull
else
  git clone https://github.com/ArduPilot/ardupilot_gazebo.git "$GAZEBO_PLUGIN_HOME"
  cd "$GAZEBO_PLUGIN_HOME"
fi

mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(sysctl -n hw.ncpu)

# Set environment variables
echo "Step 4/4: Setting environment variables..."
SHELL_RC="$HOME/.zshrc"
if [ -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

# Check if already configured
if ! grep -q "GZ_SIM_SYSTEM_PLUGIN_PATH" "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" << 'ENVEOF'

# Gazebo + ArduPilot SITL
export GZ_SIM_SYSTEM_PLUGIN_PATH="$HOME/.gazebo-ardupilot/build:$GZ_SIM_SYSTEM_PLUGIN_PATH"
export GZ_SIM_RESOURCE_PATH="$HOME/.gazebo-ardupilot/models:$HOME/.gazebo-ardupilot/worlds:$GZ_SIM_RESOURCE_PATH"
ENVEOF
  echo "Environment variables added to $SHELL_RC"
  echo "Run: source $SHELL_RC"
else
  echo "Environment variables already configured."
fi

echo ""
echo "=== Gazebo setup complete! ==="
echo ""
echo "Test with:"
echo "  gz sim -r shapes.sdf"
echo ""
echo "ArduPilot + Gazebo:"
echo "  cd ~/.ardupilot && python3 Tools/autotest/sim_vehicle.py -v ArduCopter -f gazebo-iris --model JSON"
