#!/usr/bin/env bash
# MySQL database automation: create DB/user, backup, migrate, seed.

set -euo pipefail

# Resolve MySQL admin credentials (root via sudo mysql, or MYSQL_ROOT_PASSWORD / MYSQL_ADMIN_*)
mysql_admin() {
  local extra=("$@")
  if [[ -n "${MYSQL_ADMIN_USER:-}" ]]; then
    MYSQL_PWD="${MYSQL_ADMIN_PASSWORD:-}" mysql -h "${MYSQL_HOST:-127.0.0.1}" -P "${MYSQL_PORT:-3306}" \
      -u "$MYSQL_ADMIN_USER" "${extra[@]}"
  elif [[ -n "${MYSQL_ROOT_PASSWORD:-}" ]]; then
    MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -h "${MYSQL_HOST:-127.0.0.1}" -P "${MYSQL_PORT:-3306}" \
      -u root "${extra[@]}"
  else
    # Prefer socket auth as root via sudo (Ubuntu default)
    run_elevated mysql "${extra[@]}"
  fi
}

mysql_app() {
  local user="$1" pass="$2" db="$3"
  shift 3
  MYSQL_PWD="$pass" mysql -h "${MYSQL_HOST:-127.0.0.1}" -P "${MYSQL_PORT:-3306}" -u "$user" "$db" "$@"
}

database_ensure() {
  local db_name="$1"
  local db_user="$2"
  local cred_file="$3"

  log_step "Database automation (${db_name})"

  local db_pass=""
  if [[ -f "$cred_file" ]]; then
    db_pass="$(get_credential "$cred_file" "DB_PASSWORD" || true)"
  fi
  if [[ -z "$db_pass" ]]; then
    db_pass="$(generate_password 32)"
    log_info "Generated new database password"
  else
    log_info "Reusing existing database password from credentials store"
  fi

  # Create DB + user (idempotent)
  mysql_admin <<SQL
CREATE DATABASE IF NOT EXISTS \`${db_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${db_user}'@'localhost' IDENTIFIED BY '${db_pass}';
ALTER USER '${db_user}'@'localhost' IDENTIFIED BY '${db_pass}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES
  ON \`${db_name}\`.* TO '${db_user}'@'localhost';
FLUSH PRIVILEGES;
SQL

  # Verify connectivity
  if mysql_app "$db_user" "$db_pass" "$db_name" -e "SELECT 1" >/dev/null; then
    log_ok "Database ${db_name} ready (user ${db_user})"
  else
    die "Cannot connect to MySQL as ${db_user}"
  fi

  save_credentials "$cred_file" \
    "DB_HOST=${MYSQL_HOST:-127.0.0.1}" \
    "DB_PORT=${MYSQL_PORT:-3306}" \
    "DB_NAME=${db_name}" \
    "DB_USER=${db_user}" \
    "DB_PASSWORD=${db_pass}"

  DB_PASSWORD="$db_pass"
  export DB_PASSWORD
}

database_backup() {
  local db_name="$1"
  local db_user="$2"
  local db_pass="$3"
  local out_dir="$4"

  ensure_dir "$out_dir" 700
  local outfile="${out_dir}/db-$(timestamp).sql.gz"
  log_info "Backing up ${db_name} → ${outfile}"
  MYSQL_PWD="$db_pass" mysqldump -h "${MYSQL_HOST:-127.0.0.1}" -P "${MYSQL_PORT:-3306}" \
    -u "$db_user" --single-transaction --routines --triggers "$db_name" \
    | gzip -c > "$outfile"
  # Keep last BACKUP_KEEP dumps
  ls -1t "${out_dir}"/db-*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
  log_ok "Database backup complete"
  echo "$outfile"
}

database_migrate() {
  local app_dir="$1"
  local db_name="$2"
  local db_user="$3"
  local db_pass="$4"
  local sql_files="$5"   # space-separated relative paths
  local seed_cmd="${6:-}"

  log_step "Running database migrations"

  local marker_dir="${PROJECT_SHARED}/migrations"
  ensure_dir "$marker_dir" 700

  local f rel path marker
  for rel in $sql_files; do
    path="${app_dir}/${rel}"
    [[ -f "$path" ]] || { log_warn "SQL file missing, skip: $rel"; continue; }
    marker="${marker_dir}/$(echo "$rel" | tr '/' '_').applied"
    if [[ -f "$marker" ]]; then
      # Re-apply only if file content changed
      if cmp -s "$path" "${marker}.src" 2>/dev/null; then
        log_info "Already applied: $rel"
        continue
      fi
    fi
    log_info "Applying $rel"
    mysql_app "$db_user" "$db_pass" "$db_name" < "$path"
    cp "$path" "${marker}.src"
    touch "$marker"
    log_ok "Applied $rel"
  done

  if [[ -n "$seed_cmd" && "${SKIP_SEED:-0}" != "1" ]]; then
    local seed_marker="${marker_dir}/.seed.done"
    if [[ -f "$seed_marker" && "${FORCE_SEED:-0}" != "1" ]]; then
      log_info "Seed already applied (FORCE_SEED=1 to re-run)"
    else
      log_info "Running seed: $seed_cmd"
      (
        cd "$app_dir"
        # shellcheck disable=SC2086
        env DB_HOST="${MYSQL_HOST:-127.0.0.1}" DB_PORT="${MYSQL_PORT:-3306}" \
            DB_USER="$db_user" DB_PASSWORD="$db_pass" DB_NAME="$db_name" \
            bash -lc "$seed_cmd"
      ) && touch "$seed_marker" || log_warn "Seed command exited non-zero (may be idempotent / already seeded)"
    fi
  fi
}
