#!/usr/bin/env bash
# Ensure Linux x64 native CSS binaries exist after a Windows-generated lockfile
# install (npm optional-deps bug: https://github.com/npm/cli/issues/4828).
#
# Covers:
#   - lightningcss-linux-x64-gnu  (Tailwind/PostCSS)
#   - @tailwindcss/oxide-linux-x64-gnu
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" != "Linux" || "$ARCH" != "x86_64" ]]; then
  echo "==> ensure-css-native-linux: skip (not Linux x64)"
  exit 0
fi

LIGHTNING_PKG="lightningcss-linux-x64-gnu"
LIGHTNING_VER="1.32.0"
LIGHTNING_NODE="lightningcss.linux-x64-gnu.node"

OXIDE_PKG="@tailwindcss/oxide-linux-x64-gnu"
OXIDE_VER="4.3.3"

echo "==> ensure-css-native-linux"

has_oxide() {
  [[ -d "node_modules/${OXIDE_PKG}" ]] \
    || [[ -d "web/node_modules/${OXIDE_PKG}" ]] \
    || [[ -d "node_modules/@tailwindcss/oxide-linux-x64-gnu" ]] \
    || [[ -d "web/node_modules/@tailwindcss/oxide-linux-x64-gnu" ]]
}

has_lightning_pkg() {
  [[ -d "node_modules/${LIGHTNING_PKG}" ]] || [[ -d "web/node_modules/${LIGHTNING_PKG}" ]]
}

# Force-install platform packages into the web workspace (where Tailwind lives).
NEED_INSTALL=0
has_oxide || NEED_INSTALL=1
has_lightning_pkg || NEED_INSTALL=1

if [[ "$NEED_INSTALL" -eq 1 ]]; then
  echo "    installing ${OXIDE_PKG}@${OXIDE_VER} + ${LIGHTNING_PKG}@${LIGHTNING_VER}"
  npm install --no-save --no-package-lock -w web \
    "${OXIDE_PKG}@${OXIDE_VER}" \
    "${LIGHTNING_PKG}@${LIGHTNING_VER}"
fi

# --- lightningcss: copy .node next to lightningcss/ (relative require) ---
SRC="$(find node_modules web/node_modules -name "$LIGHTNING_NODE" 2>/dev/null | head -1 || true)"
if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "ERROR: could not find ${LIGHTNING_NODE}" >&2
  find node_modules web/node_modules -maxdepth 3 -iname '*lightningcss*' 2>/dev/null | head -40 || true
  exit 1
fi
echo "    lightningcss binary: $SRC"

while IFS= read -r pkgjson; do
  dest_dir="$(dirname "$pkgjson")"
  dest="${dest_dir}/${LIGHTNING_NODE}"
  if [[ ! -f "$dest" ]]; then
    cp -f "$SRC" "$dest"
    echo "    copied → $dest"
  fi
done < <(find node_modules web/node_modules -path '*/lightningcss/package.json' 2>/dev/null || true)

# --- oxide: verify the platform package is resolvable from web ---
if ! has_oxide; then
  echo "ERROR: ${OXIDE_PKG} still missing after install" >&2
  find node_modules web/node_modules -maxdepth 4 -iname '*oxide*' 2>/dev/null | head -40 || true
  exit 1
fi

# Smoke-check: Node can load oxide from the web package context
(
  cd web
  node -e "require('@tailwindcss/oxide'); console.log('    oxide: OK')"
)

echo "==> ensure-css-native-linux OK"
