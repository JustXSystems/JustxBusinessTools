#!/usr/bin/env bash
# Apply pending SQL files under mysql/migrations (same runner as API startup).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
npm run db:migrate -w server
