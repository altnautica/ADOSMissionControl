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

# 2. Launch: a committed/released prebuilt binary if present, else build with cargo.
OS="$(uname -s 2>/dev/null || echo unknown)"
BIN="./ados-deploy"
[ "$OS" = "Windows_NT" ] && BIN="./ados-deploy.exe"

if [ -x "$BIN" ]; then
  exec "$BIN" "$@"
elif command -v cargo >/dev/null 2>&1; then
  say "building ados-deploy (first run compiles; subsequent runs are instant)"
  exec cargo run --release --quiet -- "$@"
else
  echo "No prebuilt ados-deploy binary and Rust is not installed."
  echo "Install Rust from https://rustup.rs and re-run, or use a release binary."
  exit 1
fi
