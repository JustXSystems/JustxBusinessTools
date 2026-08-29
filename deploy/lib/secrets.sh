#!/usr/bin/env bash
# Secure random secret generation and credential helpers.

set -euo pipefail

# Hex secret of N bytes (default 48 → 96 hex chars)
generate_secret() {
  local bytes="${1:-48}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | xxd -p -c "$bytes"
  fi
}

# Alphanumeric password safe for MySQL (no quotes/shell metacharacters)
generate_password() {
  local length="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 $((length * 2)) | tr -dc 'A-Za-z0-9' | head -c "$length"
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length"
  fi
  echo
}

# Validate secret length
validate_secret_length() {
  local secret="$1"
  local min="${2:-32}"
  [[ ${#secret} -ge $min ]]
}

# Load KEY=VALUE file into environment (does not export by default)
# Usage: load_env_file /path/to/file [export]
load_env_file() {
  local file="$1"
  local do_export="${2:-0}"
  [[ -f "$file" ]] || return 1
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    # strip surrounding quotes
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
    if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    printf -v "$key" '%s' "$val"
    if [[ "$do_export" == "1" ]]; then
      export "$key"
    fi
  done < "$file"
}

# Persist credentials file (600)
save_credentials() {
  local file="$1"
  shift
  local content=""
  local pair
  for pair in "$@"; do
    content+="${pair}"$'\n'
  done
  ensure_dir "$(dirname "$file")" 700
  printf '%s' "$content" | secure_write "$file" 600
}

get_credential() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2-
}
