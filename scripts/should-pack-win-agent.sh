#!/usr/bin/env bash
# Decide whether CI should rebuild JustX-Sync-Agent-win-x64.zip.
# Prints: pack=true|false and reason=...
# Exit 0 always (decision helper).
set -euo pipefail

FORCE="${FORCE_PACK_WIN_AGENT:-0}"
BEFORE_SHA="${BEFORE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-${GITHUB_SHA:-HEAD}}"

AGENT_PATHS=(
  "desktop-sync-agent"
  "scripts/pack-justx-sync-agent-win.mjs"
  "scripts/pack-agent-artifacts.mjs"
  "scripts/pack-desktop-sync-agent.mjs"
  "scripts/lib/zip-store.mjs"
  "web/lib/artifact-delivery/win-setup-pack.ts"
)

pack=false
reason="no agent-related changes"

if [[ "$FORCE" == "1" || "$FORCE" == "true" ]]; then
  pack=true
  reason="forced (pack_win_agent / FORCE_PACK_WIN_AGENT)"
elif [[ -n "$BEFORE_SHA" && "$BEFORE_SHA" != "0000000000000000000000000000000000000000" ]] \
  && git cat-file -e "${BEFORE_SHA}^{commit}" 2>/dev/null; then
  mapfile -t changed < <(git diff --name-only "$BEFORE_SHA" "$HEAD_SHA" -- "${AGENT_PATHS[@]}" || true)
  if [[ ${#changed[@]} -gt 0 && -n "${changed[0]:-}" ]]; then
    pack=true
    reason="agent-related paths changed since ${BEFORE_SHA:0:12}"
    printf 'changed:\n' >&2
    printf '  %s\n' "${changed[@]}" >&2
  else
    reason="no agent-related path changes since ${BEFORE_SHA:0:12}"
  fi
else
  # No usable base (shallow / first commit / dispatch without history).
  # Compare to HEAD~1 when available.
  if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    mapfile -t changed < <(git diff --name-only HEAD~1 HEAD -- "${AGENT_PATHS[@]}" || true)
    if [[ ${#changed[@]} -gt 0 && -n "${changed[0]:-}" ]]; then
      pack=true
      reason="agent-related paths changed vs HEAD~1"
      printf 'changed:\n' >&2
      printf '  %s\n' "${changed[@]}" >&2
    else
      reason="no agent-related path changes vs HEAD~1"
    fi
  else
    pack=true
    reason="no base commit available — packing win agent to avoid shipping a stale VPS zip"
  fi
fi

echo "pack=${pack}"
echo "reason=${reason}"
