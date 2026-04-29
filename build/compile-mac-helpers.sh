#!/usr/bin/env bash
# Compile all macOS Swift helpers in electron/helpers/*.swift into universal
# (arm64 + x86_64) Mach-O binaries placed alongside their .swift sources.
#
# Run on a macOS host. Used by:
#   - GitHub Actions release-mac job (before electron-builder packages),
#   - Local devs after editing or first-pulling the .swift sources.
#
# Why universal: macOS DMGs are built for both arm64 and x86_64
# (electron-builder.yml mac.target), so committed single-arch binaries break
# the wrong-arch DMG silently.
#
# Min target (10.15) matches Electron 33's macOS minimum.

set -euo pipefail

# Resolve repo root from this script's location so it works regardless of cwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPERS="$ROOT/electron/helpers"
TARGET_MIN="10.15"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "compile-mac-helpers.sh: must run on macOS (current: $(uname))" >&2
  exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "compile-mac-helpers.sh: swiftc not found — install Xcode Command Line Tools (xcode-select --install)" >&2
  exit 1
fi

shopt -s nullglob
sources=("$HELPERS"/*.swift)
shopt -u nullglob

if [[ ${#sources[@]} -eq 0 ]]; then
  echo "compile-mac-helpers.sh: no .swift sources in $HELPERS" >&2
  exit 0
fi

for src in "${sources[@]}"; do
  name="$(basename "$src" .swift)"
  out="$HELPERS/$name"
  arm="$out.arm64.tmp"
  x64="$out.x86_64.tmp"

  echo "→ Compiling $name (arm64 + x86_64 → universal)"

  swiftc -O -target "arm64-apple-macos$TARGET_MIN"   "$src" -o "$arm"
  swiftc -O -target "x86_64-apple-macos$TARGET_MIN"  "$src" -o "$x64"
  lipo -create -output "$out" "$arm" "$x64"
  rm -f "$arm" "$x64"
  chmod +x "$out"
  lipo -info "$out"
done

echo "compile-mac-helpers.sh: built ${#sources[@]} helper(s)"
