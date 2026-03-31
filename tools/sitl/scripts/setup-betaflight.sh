#!/usr/bin/env bash
# setup-betaflight.sh — Clone and build Betaflight SITL
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

BF_HOME="${BF_HOME:-$HOME/.betaflight}"

echo "=== Altnautica SITL - Betaflight Setup ==="
echo ""

# Check prerequisites
for cmd in git make; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd is required but not found. Install it first."
    exit 1
  fi
done

if [ -d "$BF_HOME" ]; then
  echo "Betaflight source found at $BF_HOME"
  echo ""
  if [ -f "$BF_HOME/obj/main/betaflight_SITL.elf" ]; then
    echo "Betaflight SITL binary found. Ready to use."
    echo ""
    echo "To rebuild:  cd $BF_HOME && make TARGET=SITL"
    echo "To update:   cd $BF_HOME && git pull && make TARGET=SITL"
    exit 0
  else
    echo "WARNING: Betaflight SITL binary not found. Rebuilding..."
    cd "$BF_HOME"
    make TARGET=SITL
    echo ""
    echo "Done!"
    exit 0
  fi
fi

echo "Cloning Betaflight to $BF_HOME..."
git clone https://github.com/betaflight/betaflight.git "$BF_HOME"
cd "$BF_HOME"

# Check for ARM toolchain (needed even for SITL on some setups)
if ! command -v arm-none-eabi-gcc &>/dev/null; then
  echo ""
  echo "Installing ARM toolchain via Homebrew..."
  brew install --cask gcc-arm-embedded 2>/dev/null || brew install arm-none-eabi-gcc 2>/dev/null || {
    echo "WARNING: Could not install ARM toolchain automatically."
    echo "You may need to install it manually."
    echo "Try: brew tap osx-cross/arm && brew install arm-gcc-bin"
  }
fi

echo ""
echo "Building Betaflight SITL..."
make TARGET=SITL

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Betaflight SITL built at: $BF_HOME"
echo "Binary: $BF_HOME/obj/main/betaflight_SITL.elf"
echo ""
echo "Add to your shell profile:"
echo "  export BF_HOME=$BF_HOME"
echo ""
echo "To run manually: $BF_HOME/obj/main/betaflight_SITL.elf"
echo "MSP available on TCP port 5761"
