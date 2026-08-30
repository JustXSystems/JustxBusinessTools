#!/usr/bin/env bash
# Example monitoring hook — copy to on-deploy_ok.sh and chmod +x
# Args: $1=event $2=detail
echo "[justx-hook] event=$1 detail=${2:-}" >&2
