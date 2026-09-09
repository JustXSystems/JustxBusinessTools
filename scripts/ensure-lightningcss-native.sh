#!/usr/bin/env bash
# Ensure lightningcss native .node is present for the current OS/arch.
# Windows-generated package-lock often omits Linux optional binaries; npm ci
# then leaves Tailwind/PostCSS unable to load lightningcss on Linux CI/VPS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" != "Linux" || "$ARCH" != "x86_64" ]]; then
  echo "==> ensure-lightningcss-native: skip (not Linux x64)"
  exit 0
fi

PKG="lightningcss-linux-x64-gnu"
VER="1.32.0"
NODE_NAME="lightningcss.linux-x64-gnu.node"

echo "==> ensure-lightningcss-native (${PKG}@${VER})"

# Install platform package at workspace root if missing
if [[ ! -d "node_modules/${PKG}" && ! -d "web/node_modules/${PKG}" ]]; then
  npm install --no-save --no-package-lock "${PKG}@${VER}"
fi

# Locate the downloaded native binary
SRC=""
for candidate in \
  "node_modules/${PKG}/${NODE_NAME}" \
  "web/node_modules/${PKG}/${NODE_NAME}" \
  "node_modules/${PKG}/lightningcss.${NODE_NAME#lightningcss.}" \
  ; do
  if [[ -f "$candidate" ]]; then
    SRC="$candidate"
    break
  fi
done

# Some package layouts nest the .node differently
if [[ -z "$SRC" ]]; then
  SRC="$(find node_modules web/node_modules -name "$NODE_NAME" 2>/dev/null | head -1 || true)"
fi

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "ERROR: could not find ${NODE_NAME} after installing ${PKG}" >&2
  ls -la "node_modules/${PKG}" 2>/dev/null || true
  ls -la "web/node_modules/${PKG}" 2>/dev/null || true
  exit 1
fi

echo "    native binary: $SRC"

# lightningcss/node/index.js requires ../lightningcss.linux-x64-gnu.node
copied=0
while IFS= read -r pkgjson; do
  dest_dir="$(dirname "$pkgjson")"
  dest="${dest_dir}/${NODE_NAME}"
  if [[ ! -f "$dest" ]]; then
    cp -f "$SRC" "$dest"
    echo "    copied → $dest"
    copied=$((copied + 1))
  else
    echo "    present  $dest"
  fi
done < <(find node_modules web/node_modules -path '*/lightningcss/package.json' 2>/dev/null || true)

if [[ "$copied" -eq 0 ]]; then
  # Still OK if already present; verify at least one lightningcss dir can load it
  if ! find node_modules web/node_modules -path "*/lightningcss/${NODE_NAME}" 2>/dev/null | grep -q .; then
    echo "ERROR: no lightningcss package dirs found to patch" >&2
    exit 1
  fi
fi

echo "==> ensure-lightningcss-native OK"
