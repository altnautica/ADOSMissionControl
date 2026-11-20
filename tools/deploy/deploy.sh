#!/usr/bin/env sh
# ADOS stack deployer bootstrap.
#
# One-line convenience:
#   curl -sSL https://raw.githubusercontent.com/altnautica/ADOSMissionControlGCS/main/tools/deploy/deploy.sh | sh
#
# Local-first (repo-only): clone ADOSMissionControlGCS, then run from inside it:
#   ./tools/deploy/deploy.sh          (verified prebuilt release binary, else cargo)
#   cargo run --manifest-path tools/deploy/Cargo.toml
#
# The deployer operates on a repo checkout (it builds the Mission Control image
# and pushes Convex functions from it), so this ensures a checkout exists, then
# launches the Rust TUI. Any extra args are passed through to `ados-deploy`.
set -eu

REPO_URL="${ADOS_REPO_URL:-https://github.com/altnautica/ADOSMissionControlGCS.git}"
DIR="${ADOS_DIR:-$HOME/ADOSMissionControlGCS}"
# The repository was named ADOSMissionControl before 0.66.0, and this script
# used to clone it to ~/ADOSMissionControl. Keep using that checkout (and the
# tools/selfhost/.env in it) instead of cloning an empty second one.
OLD_DIR="$HOME/ADOSMissionControl"

say() { printf '  %s\n' "$*"; }

# 1. Locate (or fetch) a repo checkout.
if [ -f "tools/selfhost/docker-compose.yml" ]; then
  DIR="$(pwd)"
  say "using the current checkout: $DIR"
elif [ -d "$DIR/.git" ]; then
  say "updating existing checkout: $DIR"
  git -C "$DIR" pull --ff-only >/dev/null 2>&1 || say "(could not fast-forward; using as-is)"
elif [ -z "${ADOS_DIR:-}" ] && [ -d "$OLD_DIR/.git" ]; then
  DIR="$OLD_DIR"
  say "using the existing checkout at $DIR (the repo is now ADOSMissionControlGCS; set ADOS_DIR to choose another)"
  say "updating existing checkout: $DIR"
  git -C "$DIR" pull --ff-only >/dev/null 2>&1 || say "(could not fast-forward; using as-is)"
else
  command -v git >/dev/null 2>&1 || { echo "git is required to fetch the repo"; exit 1; }
  say "cloning $REPO_URL -> $DIR"
  git clone --depth 1 "$REPO_URL" "$DIR"
fi

cd "$DIR/tools/deploy"

# 2. Launch. Preference order: a verified prebuilt cached for this exact
#    version, then a fresh download of the matching GitHub release asset that
#    must pass the release signature and checksum, then a cargo build. Nothing
#    downloaded is ever executed unverified.
RELEASE_PUBKEY="RWQ/CJ1+gk7rjVfGSoy6MOL50e8TmO30KD/J+goaEj+WMI1uzEf92rHN"
RELEASES="https://github.com/altnautica/ADOSMissionControlGCS/releases/download"

OS="$(uname -s 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
TARGET=""
EXT=""
case "$OS" in
  Darwin) case "$ARCH" in arm64|aarch64) TARGET="aarch64-apple-darwin" ;; x86_64) TARGET="x86_64-apple-darwin" ;; esac ;;
  Linux)  case "$ARCH" in x86_64|amd64) TARGET="x86_64-unknown-linux-gnu" ;; esac ;;
  MINGW*|MSYS*|CYGWIN*) case "$ARCH" in x86_64|amd64) TARGET="x86_64-pc-windows-msvc"; EXT=".exe" ;; esac ;;
esac
VER="$(grep -m1 '^version' Cargo.toml 2>/dev/null | tr -cd '0-9.')"

# Check one asset's line of a (signature-verified) SHA256SUMS in the cwd.
check_sum() {
  grep "  $1\$" SHA256SUMS > "$1.sha256" || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c --ignore-missing --status "$1.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c --status "$1.sha256"
  else
    return 1
  fi
}

# Download <asset>, SHA256SUMS and its signature into $DL_DIR, verify the
# signature against the release key and the asset against its checksum line,
# then move the binary into the versioned cache. Any failure leaves no file.
fetch_verified() {
  base="$RELEASES/ados-deploy-v$VER"
  rm -rf "$DL_DIR" && mkdir -p "$DL_DIR" || return 1
  curl -fsSL "$base/$ASSET" -o "$DL_DIR/$ASSET" 2>/dev/null &&
    curl -fsSL "$base/SHA256SUMS" -o "$DL_DIR/SHA256SUMS" 2>/dev/null &&
    curl -fsSL "$base/SHA256SUMS.minisig" -o "$DL_DIR/SHA256SUMS.minisig" 2>/dev/null || return 1
  (cd "$DL_DIR" && minisign -Vqm SHA256SUMS -P "$RELEASE_PUBKEY" >/dev/null 2>&1 && check_sum "$ASSET") || {
    say "(the prebuilt failed signature or checksum verification; refusing it)"
    return 1
  }
  chmod +x "$DL_DIR/$ASSET" && mv -f "$DL_DIR/$ASSET" "$BIN"
}

if [ -n "$TARGET" ] && [ -n "$VER" ]; then
  CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/ados-deploy/$VER"
  ASSET="ados-deploy-$TARGET$EXT"
  BIN="$CACHE/$ASSET"
  DL_DIR="$CACHE/.tmp"
  if [ -x "$BIN" ]; then
    exec "$BIN" "$@"
  fi
  if ! command -v minisign >/dev/null 2>&1; then
    say "minisign not found; building from source"
  elif command -v curl >/dev/null 2>&1; then
    say "fetching a prebuilt ados-deploy ($TARGET, v$VER)"
    if fetch_verified; then
      rm -rf "$DL_DIR"
      exec "$BIN" "$@"
    fi
    rm -rf "$DL_DIR" "$BIN" 2>/dev/null || true
    say "(no verified prebuilt for this version/platform; building from source)"
  fi
fi

if command -v cargo >/dev/null 2>&1; then
  say "building ados-deploy (first run compiles; subsequent runs are instant)"
  exec cargo run --release --quiet -- "$@"
else
  echo "No verified prebuilt ados-deploy binary and Rust is not installed."
  echo "Install Rust from https://rustup.rs and re-run, or use a release binary."
  exit 1
fi
