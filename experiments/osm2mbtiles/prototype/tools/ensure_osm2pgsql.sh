#!/usr/bin/env bash
set -Eeuo pipefail
BASE="$1"
MIN_VERSION=1.8.0
BUILD_VERSION=1.11.0
PREFIX="$BASE/native/osm2pgsql-$BUILD_VERSION"
LOCAL_BIN="$PREFIX/bin/osm2pgsql"
version_of() {
  local output version
  output="$("$1" --version 2>&1)" || return 1
  version="$(printf '%s\n' "$output" | grep -Eom1 '[0-9]+\.[0-9]+(\.[0-9]+)?' || true)"
  [[ -n "$version" ]] || return 1
  printf '%s\n' "$version"
}
compatible() { local v; v="$(version_of "$1")" || return 1; dpkg --compare-versions "$v" ge "$MIN_VERSION"; }
if [[ -x "$LOCAL_BIN" ]] && compatible "$LOCAL_BIN"; then printf '%s\n' "$LOCAL_BIN"; exit 0; fi
SYSTEM_BIN="$(command -v osm2pgsql || true)"
if [[ -n "$SYSTEM_BIN" ]] && compatible "$SYSTEM_BIN"; then printf '%s\n' "$SYSTEM_BIN"; exit 0; fi
echo "[FIX] osm2pgsql needs >=1.8.0, building private $BUILD_VERSION" >&2
sudo apt-get update
sudo apt-get install -y --no-install-recommends build-essential cmake pkg-config git libboost-dev libexpat1-dev zlib1g-dev libbz2-dev libpq-dev libproj-dev liblua5.3-dev lua5.3 nlohmann-json3-dev
SOURCE="$BASE/build-osm2pgsql-$BUILD_VERSION/source"
BUILD="$BASE/build-osm2pgsql-$BUILD_VERSION/build"
mkdir -p "$BASE/build-osm2pgsql-$BUILD_VERSION"
git clone --quiet --depth 1 --branch "$BUILD_VERSION" https://github.com/osm2pgsql-dev/osm2pgsql.git "$SOURCE"
cmake -S "$SOURCE" -B "$BUILD" -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF
cmake --build "$BUILD" --parallel 2
cmake --install "$BUILD"
[[ -x "$LOCAL_BIN" ]] && compatible "$LOCAL_BIN" || exit 4
printf '%s\n' "$LOCAL_BIN"
