#!/usr/bin/env sh
# ADOS stack deployer bootstrap.
#
# One-line convenience:
#   curl -sSL https://raw.githubusercontent.com/altnautica/ADOSMissionControl/main/tools/deploy/deploy.sh | sh
#
# Local-first (repo-only): clone ADOSMissionControl, then run from inside it:
#   ./tools/deploy/deploy.sh          (prebuilt binary if present, else cargo)
#   cargo run --manifest-path tools/deploy/Cargo.toml
#
# The deployer operates on a repo checkout (it builds the Mission Control image
# and pushes Convex functions from it), so this ensures a checkout exists, then
# launches the Rust TUI. Any extra args are passed through to `ados-deploy`.
set -eu

REPO_URL="${ADOS_REPO_URL:-https://github.com/altnautica/ADOSMissionControl.git}"
DIR="${ADOS_DIR:-$HOME/ADOSMissionControl}"

say() { printf '  %s\n' "$*"; }

# 1. Locate (or fetch) a repo checkout.
if [ -f "tools/selfhost/docker-compose.yml" ]; then
  DIR="$(pwd)"
  say "using the current checkout: $DIR"
elif [ -d "$DIR/.git" ]; then
  say "updating existing checkout: $DIR"
  git -C "$DIR" pull --ff-only >/dev/null 2>&1 || say "(could not fast-forward; using as-is)"
else
  command -v git >/dev/null 2>&1 || { echo "git is required to fetch the repo"; exit 1; }
  say "cloning $REPO_URL -> $DIR"
  git clone --depth 1 "$REPO_URL" "$DIR"
fi

cd "$DIR/tools/deploy"

# 2. Launch. Preference order: a cached/committed prebuilt binary, then a
#    best-effort fetch of the matching GitHub release asset, then a cargo build.
OS="$(uname -s 2>/dev/null || echo unknown)"
BIN="./ados-deploy"
[ "$OS" = "Windows_NT" ] && BIN="./ados-deploy.exe"

if [ -x "$BIN" ]; then
  exec "$BIN" "$@"
fi

# Best-effort: download the prebuilt release binary for this platform + version.
# The release job publishes ados-deploy-<target> assets on ados-deploy-v* tags;
# a missing release / unsupported platform simply falls through to cargo.
ARCH="$(uname -m 2>/dev/null || echo unknown)"
TARGET=""
case "$OS" in
  Darwin) case "$ARCH" in arm64|aarch64) TARGET="aarch64-apple-darwin" ;; x86_64) TARGET="x86_64-apple-darwin" ;; esac ;;
  Linux)  case "$ARCH" in x86_64|amd64) TARGET="x86_64-unknown-linux-gnu" ;; esac ;;
esac
VER="$(grep -m1 '^version' Cargo.toml 2>/dev/null | tr -cd '0-9.')"
if [ -n "$TARGET" ] && [ -n "$VER" ] && command -v curl >/dev/null 2>&1; then
  ASSET="https://github.com/altnautica/ADOSMissionControl/releases/download/ados-deploy-v${VER}/ados-deploy-${TARGET}"
  say "fetching a prebuilt ados-deploy ($TARGET, v$VER)"
  if curl -fsSL "$ASSET" -o "$BIN.tmp" 2>/dev/null; then
    chmod +x "$BIN.tmp" && mv "$BIN.tmp" "$BIN" && exec "$BIN" "$@"
  fi
  rm -f "$BIN.tmp" 2>/dev/null || true
  say "(no prebuilt for this version/platform; building from source)"
fi

if command -v cargo >/dev/null 2>&1; then
  say "building ados-deploy (first run compiles; subsequent runs are instant)"
  exec cargo run --release --quiet -- "$@"
else
  echo "No prebuilt ados-deploy binary and Rust is not installed."
  echo "Install Rust from https://rustup.rs and re-run, or use a release binary."
  exit 1
fi
