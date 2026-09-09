#!/usr/bin/env bash
# Pack a deployable release tarball (run on Linux CI after web build).
# Usage: ./scripts/pack-release.sh [output.tgz]
#
# Intentionally omits node_modules — VPS runs `npm ci --omit=dev` (or reuses
# live node_modules when package-lock.json is unchanged). Keeps SCP small/fast.
# Writes <output>.sha256 alongside the tarball.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-jbt-release.tgz}"
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
SHORT_SHA="$(echo "$SHA" | cut -c1-12)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NODE_VER="$(node -v)"

if [[ ! -d web/.next ]]; then
  echo "ERROR: web/.next missing — run production web build first." >&2
  exit 1
fi
if [[ ! -f package-lock.json ]]; then
  echo "ERROR: package-lock.json missing." >&2
  exit 1
fi

META_DIR="$(mktemp -d)"
trap 'rm -rf "$META_DIR"' EXIT

cat >"$META_DIR/RELEASE.json" <<EOF
{
  "sha": "$SHA",
  "shortSha": "$SHORT_SHA",
  "builtAt": "$BUILT_AT",
  "node": "$NODE_VER",
  "basePath": "${NEXT_PUBLIC_BASE_PATH:-/jbt}",
  "packager": "scripts/pack-release.sh",
  "includesNodeModules": false,
  "vpsInstall": "npm ci --omit=dev"
}
EOF

echo "==> Packing slim release ${SHORT_SHA} → ${OUT_ABS} (no node_modules)"

chmod +x scripts/*.sh 2>/dev/null || true

# Exclude bulky / non-runtime trees. web/.next is included (minus cache).
tar -czf "$OUT_ABS" \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.idea' \
  --exclude='.cursor' \
  --exclude='android' \
  --exclude='e2e' \
  --exclude='docs' \
  --exclude='deploy' \
  --exclude='test-results' \
  --exclude='playwright-report' \
  --exclude='blob-report' \
  --exclude='node_modules' \
  --exclude='**/node_modules' \
  --exclude='server/.env' \
  --exclude='server/uploads' \
  --exclude='uploads' \
  --exclude='web/.next/cache' \
  --exclude='web/.next/trace' \
  --exclude='desktop-sync-agent/.runtime-cache' \
  --exclude='jbt-release.tgz' \
  --exclude='jbt-release-*.tgz' \
  -C "$ROOT" \
  package.json \
  package-lock.json \
  ecosystem.config.cjs \
  .env.example \
  web \
  server \
  shared \
  scripts \
  mysql \
  desktop-sync-agent \
  -C "$META_DIR" \
  RELEASE.json

(
  cd "$(dirname "$OUT_ABS")"
  sha256sum "$(basename "$OUT_ABS")" | tee "$(basename "$OUT_ABS").sha256"
)
ls -lh "$OUT_ABS" "${OUT_ABS}.sha256"
echo "==> Pack OK (${SHORT_SHA}) — install deps on VPS"
